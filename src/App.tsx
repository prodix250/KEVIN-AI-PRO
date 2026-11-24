/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { Send, Mic, Paperclip, MoreVertical, Search, Phone, Video, Smile, Settings, X, Menu, Plus, Trash2, Camera as CameraIcon, Image as ImageIcon, FileText, Check, CheckCheck, Bot, Sparkles, Info, Copy, Download, Sun, Moon, Pencil, MessageSquare, Clock, History, AlertTriangle, Key, ShieldCheck, ExternalLink, User, Volume2, UserPlus, Upload, ChevronRight, Globe, ChevronDown, Pause, Play } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { App as CapApp } from '@capacitor/app';
import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera';
import { sendMessageToGemini, generateImagePrompt, generateAIImage, isImageGenerationRequest, cleanImagePrompt, cleanBase64, compressImageToAttachment, readNativeCompressedImage, playWhatsAppSound, AttachmentItem, DeviceAction, getUserCustomApiKey, setUserCustomApiKey, getGeminiKeysPool, setGeminiKeysPool, GeminiKeysPool, getGeminiApiKeysArray, isCapacitorApkRuntime, isKevinPhotoRequest, getKevinPhotoUrl, runDeviceAction, loadChatHistory, saveChatHistory, getAgentPermissions, saveAgentPermissions, getWhatsAppAutoReplyState, formatRemainingPauseDuration, getNativeAgentStatus, getAgentOutbox, appendAgentOutbox, transcribeAudioWithSTT, generateWhatsAppAutoReply, getSavedContacts, saveContact, deleteSavedContact, importContactsFromVcfText, importContactsFromDevice, sanitizePhoneNumber, formatWhatsAppPhoneNumber, isLikelyPhoneNumber, AgentPermissions, NativeAgentStatus, AgentOutboxItem, SavedContact, GroundingSource, playSongInLarkPlayer, executeLarkPlayerCommand, getDeviceSongs, DeviceSong } from './services/geminiService';
import { generatePdfBlobUrl, generateDocxBlobUrl, extractTextFromFile, generateDocument } from './services/documentService';
import MarkdownRenderer from './components/MarkdownRenderer';
import AssistantOverlay from './components/AssistantOverlay';
import { downloadAIImage, downloadDocumentFile } from './utils/download';

const THEME_LIGHT_DEFAULT_MIGRATION_KEY = 'kevin_ai_theme_light_default_migrated';

declare global {
  interface Window {
    KevinAssistantNative?: {
      onAssistantReady?: () => void;
      onAssistantVoiceStarted?: () => void;
      onAssistantVoiceStopped?: () => void;
      onGeminiResponse?: (response: string) => void;
      onGeminiError?: (message: string) => void;
    };
    KevinAssistantBridge?: {
      send: (requestJson: string) => Promise<void>;
      startVoice?: () => Promise<void>;
      stopVoice?: (imageBase64?: string) => Promise<void>;
    };
  }
}

const downloadImage = async (url: string, filename = 'kevin_ai_image.jpg', onSuccess?: () => void) => {
  try {
    await downloadAIImage(url, filename);
    if (onSuccess) onSuccess();
  } catch (err) {
    console.error('Download error:', err);
  }
};

const createImageAttachment = async (file: File): Promise<AttachmentItem> => {
  return compressImageToAttachment(file, {
    name: file.name,
    mimeType: file.type || 'image/jpeg',
    maxDim: 1280,
    quality: 0.82,
  });
};

type VoiceRecordingSession = {
  mimeType: string;
  stop: () => Promise<Blob>;
  cancel: () => void;
};

const createVoiceRecordingSession = async (): Promise<VoiceRecordingSession> => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('Audio recording is not supported on this device.');
    }

    const agentBridge = (window as any).KevinAgentBridge;
    if (agentBridge?.pauseWakeWord) {
      try {
        agentBridge.pauseWakeWord();
        await new Promise((resolve) => setTimeout(resolve, 140));
      } catch {
        // ignore
      }
    }

    let stream: MediaStream;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch (err) {
      try { agentBridge?.resumeWakeWord?.(); } catch { /* ignore */ }
      throw err;
    }
    const supportedMimeType = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/aac',
    ].find(type => MediaRecorder.isTypeSupported(type)) || '';
    if (!supportedMimeType) {
      stream.getTracks().forEach(track => track.stop());
      try { agentBridge?.resumeWakeWord?.(); } catch { /* ignore */ }
      throw new Error('This device cannot record audio.');
    }
    const recorder = new MediaRecorder(stream, supportedMimeType ? { mimeType: supportedMimeType } : undefined);
    const chunks: Blob[] = [];
    let cancelled = false;
    let settled = false;
    let stopRequested = false;
    let resolveStop: (blob: Blob) => void = () => undefined;
    let rejectStop: (error: Error) => void = () => undefined;
    const stopped = new Promise<Blob>((resolve, reject) => {
      resolveStop = resolve;
      rejectStop = reject;
    });
    const recorderMimeType = (recorder.mimeType || supportedMimeType || 'audio/webm').split(';')[0];
    const cleanup = () => {
      stream.getTracks().forEach(track => track.stop());
      try { agentBridge?.resumeWakeWord?.(); } catch { /* ignore */ }
    };

    recorder.ondataavailable = event => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectStop(new Error('Microphone recording failed.'));
    };
    recorder.onstop = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (chunks.length === 0) {
        console.warn('No audio chunks recorded.');
      }
      resolveStop(new Blob(cancelled ? [] : chunks, {
        type: recorder.mimeType || supportedMimeType || 'audio/webm',
      }));
    };
    recorder.start(200);

    return {
      mimeType: recorderMimeType,
      stop: () => {
        if (recorder.state === 'inactive') {
          return Promise.resolve(new Blob(chunks, { type: recorderMimeType }));
        }
        if (!stopRequested) {
          stopRequested = true;
          recorder.stop();
        }
        return stopped;
      },
      cancel: () => {
        cancelled = true;
        if (recorder.state === 'inactive') {
          cleanup();
        } else if (!stopRequested) {
          stopRequested = true;
          recorder.stop();
        }
      },
    };
};

const blobToBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => {
    const result = typeof reader.result === 'string' ? reader.result.split(',')[1] : '';
    result ? resolve(result) : reject(new Error('Unable to encode recorded audio.'));
  };
  reader.onerror = () => reject(reader.error || new Error('Unable to read recorded audio.'));
  reader.readAsDataURL(blob);
});

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return copied ? (
    <Check size={12} className="text-[#25D366]" />
  ) : (
    <Copy size={12} className="cursor-pointer hover:text-gray-800" onClick={handleCopy} />
  );
};

type MessageStatus = 'sent' | 'delivered' | 'read';

type Message = {
  id: string;
  text: string;
  sender: 'user' | 'kevin';
  timestamp: string;
  image?: string;
  audioUrl?: string;
  document?: {
    type: 'pdf' | 'docx' | 'pptx' | 'txt' | 'image' | 'doc';
    name: string;
    url?: string;
    size: string;
    thumbnail?: string;
    title?: string;
    content?: string;
    format?: 'pdf' | 'docx' | 'txt';
  };
  status?: MessageStatus;
  action?: DeviceAction;
  sources?: GroundingSource[];
};

const SearchSourcesBadge = ({ sources }: { sources: GroundingSource[] }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  if (!sources || sources.length === 0) return null;

  return (
    <div className="my-2 pt-2 border-t border-black/5 dark:border-white/5">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-[#075E54] dark:text-[#00FF88] border border-[#00a884]/30 transition-all cursor-pointer group shadow-2xs"
        title="Kanda urebe amasoko y'amakuru (Search sources)"
      >
        <Globe size={13} className="text-[#00a884] group-hover:rotate-12 transition-transform shrink-0" />
        <span>Sources ({sources.length})</span>
        <ChevronDown
          size={12}
          className={`transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-1.5 max-h-52 overflow-y-auto pr-1">
          {sources.map((s, idx) => {
            let domain = '';
            try {
              domain = new URL(s.url).hostname.replace(/^www\./, '');
            } catch {
              domain = 'web';
            }
            return (
              <a
                key={idx}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 p-2 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors text-xs text-gray-800 dark:text-[#e9edef] group cursor-pointer border border-black/5 dark:border-white/5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-5 h-5 rounded-full bg-[#00a884]/15 text-[#00a884] text-[10px] font-bold flex items-center justify-center shrink-0">
                    {idx + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium truncate group-hover:text-[#00a884] transition-colors">{s.title || s.url}</p>
                    <p className="text-[10px] text-gray-400 dark:text-[#8696a0] font-mono truncate">{domain}</p>
                  </div>
                </div>
                <ExternalLink size={12} className="shrink-0 text-gray-400 group-hover:text-[#00a884] transition-colors" />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
};

type ChatSession = {
  id: number;
  title: string;
  messages: Message[];
  timestamp: number;
};

export default function App() {
  const assistantStartVoiceRef = useRef<() => Promise<void>>(async () => undefined);
  const assistantStopVoiceRef = useRef<(imageBase64?: string) => Promise<void>>(
    async () => undefined
  );
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const persisted = loadChatHistory<unknown>(null);
    const legacy = localStorage.getItem('kevin_ai_chats');
    let legacySessions: unknown = null;
    if (legacy) {
      try {
        legacySessions = JSON.parse(legacy);
      } catch (error) {
        console.error('Unable to load legacy Kevin AI chat history.', error);
      }
    }
    const saved = Array.isArray(persisted) ? persisted : legacySessions;
    if (Array.isArray(saved) && saved.length > 0) {
      return saved as ChatSession[];
    }
    return [{ id: Date.now(), title: "New Chat", messages: [], timestamp: Date.now() }];
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (localStorage.getItem(THEME_LIGHT_DEFAULT_MIGRATION_KEY) !== 'true') {
      localStorage.setItem(THEME_LIGHT_DEFAULT_MIGRATION_KEY, 'true');
      localStorage.setItem('kevin_ai_theme', 'light');
      return 'light';
    }
    return (localStorage.getItem('kevin_ai_theme') as 'light' | 'dark') || 'light';
  });

  useEffect(() => {
    localStorage.setItem('kevin_ai_theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    const nativeBridge = window.KevinAssistantNative;
    if (!nativeBridge) return;

    window.KevinAssistantBridge = {
      send: async (requestJson: string) => {
        try {
          const request = JSON.parse(requestJson) as {
            prompt?: string;
            imageBase64?: string;
          };
          const prompt = request.prompt?.trim();
          if (!prompt) {
            throw new Error('Kevin AI received an empty assistant request.');
          }

          const attachment = request.imageBase64
            ? {
                base64: request.imageBase64,
                mimeType: 'image/jpeg',
                name: 'live-screen.jpg',
              }
            : undefined;
          const response = await sendMessageToGemini(
            [],
            prompt,
            undefined,
            attachment,
            'gemini-4-hydrogen'
          );
          nativeBridge.onGeminiResponse?.(response);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Kevin AI could not process the request.';
          nativeBridge.onGeminiError?.(message);
        }
      },
      startVoice: async () => {
        await assistantStartVoiceRef.current();
      },
      stopVoice: async (imageBase64?: string) => {
        await assistantStopVoiceRef.current(imageBase64);
      },
    };
    nativeBridge.onAssistantReady?.();

    return () => {
      delete window.KevinAssistantBridge;
    };
  }, []);

  const isDedicatedAssistantOverlay = typeof window !== 'undefined' && (
    new URLSearchParams(window.location.search).get('assistant') === '1' ||
    Boolean((window as any).KevinOverlayBridge?.isOverlay?.())
  );

  const toggleTheme = () => setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  const [showSplash, setShowSplash] = useState(() => !isDedicatedAssistantOverlay);
  const [splashFadeOut, setSplashFadeOut] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showAssistantOverlay, setShowAssistantOverlay] = useState(false);

  useEffect(() => {
    if (!isDedicatedAssistantOverlay) return;
    document.documentElement.style.backgroundColor = 'transparent';
    document.body.style.backgroundColor = 'transparent';
    return () => {
      document.documentElement.style.backgroundColor = '';
      document.body.style.backgroundColor = '';
    };
  }, [isDedicatedAssistantOverlay]);

  useEffect(() => {
    if (isDedicatedAssistantOverlay) return;
    const openOnWake = () => {
      setShowAssistantOverlay(true);
    };
    window.addEventListener('kevinWakeWordTriggered', openOnWake);
    return () => {
      window.removeEventListener('kevinWakeWordTriggered', openOnWake);
    };
  }, [isDedicatedAssistantOverlay]);

  useEffect(() => {
    if (isDedicatedAssistantOverlay) return;
    try {
      (window as any).KevinAgentBridge?.setInAppOverlayOpen?.(showAssistantOverlay);
    } catch {
      // ignore
    }
  }, [showAssistantOverlay, isDedicatedAssistantOverlay]);

  useEffect(() => {
    const startTime = Date.now();
    const duration = 2200;

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const current = Math.min(Math.floor((elapsed / duration) * 100), 100);
      setProgress(current);
      if (current >= 100) {
        clearInterval(interval);
      }
    }, 20);

    const timer = setTimeout(() => {
      setSplashFadeOut(true);
      setTimeout(() => setShowSplash(false), 700);
    }, duration);

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, []);
  const [currentSessionId, setCurrentSessionId] = useState<number>(() => {
    const savedId = localStorage.getItem('kevin_current_session_id');
    if (savedId) {
      const numId = Number(savedId);
      if (sessions.some(s => s.id === numId)) return numId;
    }
    return sessions[0].id;
  });
  const [messages, setMessages] = useState<Message[]>(() => {
    const savedId = localStorage.getItem('kevin_current_session_id');
    const numId = savedId ? Number(savedId) : null;
    const current = sessions.find(s => s.id === numId) || sessions[0];
    return current ? current.messages : sessions[0].messages;
  });

  useEffect(() => {
    const current = sessions.find(s => s.id === currentSessionId);
    if (current) {
      setMessages(current.messages);
    }
    try {
      localStorage.setItem('kevin_current_session_id', currentSessionId.toString());
    } catch {
      // ignore storage errors
    }
  }, [currentSessionId]);
  const [input, setInput] = useState('');
  const [screenSharingActive, setScreenSharingActive] = useState(false);
  const [latestScreenFrame, setLatestScreenFrame] = useState<AttachmentItem | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const latestSessionsRef = useRef(sessions);
  latestSessionsRef.current = sessions;

  useEffect(() => {
    if (!isGenerating) {
      saveChatHistory(sessions);
      return;
    }
    const timer = window.setTimeout(() => {
      saveChatHistory(latestSessionsRef.current);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [sessions, isGenerating]);

  useEffect(() => {
    const flushSessions = () => saveChatHistory(latestSessionsRef.current);
    window.addEventListener('pagehide', flushSessions);
    return () => {
      window.removeEventListener('pagehide', flushSessions);
      flushSessions();
    };
  }, []);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [attachmentPopupOpen, setAttachmentPopupOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [userName, setUserName] = useState<string>(() => localStorage.getItem('kevin_user_name') || localStorage.getItem('kevin_ai_user_name') || '');
  const [tempUserName, setTempUserName] = useState<string>(() => localStorage.getItem('kevin_user_name') || localStorage.getItem('kevin_ai_user_name') || '');
  const [showProfileModal, setShowProfileModal] = useState<boolean>(() => !localStorage.getItem('kevin_user_name') && !localStorage.getItem('kevin_ai_user_name'));

  const handleSaveUserName = () => {
    const trimmed = tempUserName.trim();
    if (!trimmed) {
      showToastMessage("⚠️ Nyamuneka shyiramo izina ryawe kugira ngo ukomeze!");
      return;
    }
    localStorage.setItem('kevin_user_name', trimmed);
    localStorage.setItem('kevin_ai_user_name', trimmed);
    setUserName(trimmed);
    showToastMessage(`✨ Muraho neza ${trimmed}! Izina ryawe ryabitswe.`);
    setShowProfileModal(false);
  };

  const [customInstructions, setCustomInstructions] = useState<string>(() => localStorage.getItem('kevin_custom_instructions') || localStorage.getItem('kevin_ai_custom_instructions') || '');
  const [tempCustomInstructions, setTempCustomInstructions] = useState<string>(() => localStorage.getItem('kevin_custom_instructions') || localStorage.getItem('kevin_ai_custom_instructions') || '');
  const [showCustomInstructionsModal, setShowCustomInstructionsModal] = useState<boolean>(false);

  const handleSaveCustomInstructions = () => {
    const trimmed = tempCustomInstructions.trim();
    if (trimmed) {
      localStorage.setItem('kevin_custom_instructions', trimmed);
      localStorage.setItem('kevin_ai_custom_instructions', trimmed);
      setCustomInstructions(trimmed);
      showToastMessage("✨ Custom Instructions zabitswe neza!");
    } else {
      localStorage.removeItem('kevin_custom_instructions');
      localStorage.removeItem('kevin_ai_custom_instructions');
      setCustomInstructions('');
      showToastMessage("✨ Custom Instructions zasibwe.");
    }
    setShowCustomInstructionsModal(false);
  };
  const [attachedImage, setAttachedImage] = useState<AttachmentItem | null>(null);
  const [attachedImages, setAttachedImages] = useState<AttachmentItem[]>([]);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLDivElement>(null);
  const attachmentPopupRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [currentSessionId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        emojiPickerOpen &&
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(event.target as Node) &&
        emojiButtonRef.current &&
        !emojiButtonRef.current.contains(event.target as Node)
      ) {
        setEmojiPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [emojiPickerOpen]);

  useEffect(() => {
    if (!attachmentPopupOpen) return;

    const handleOutsideAttachmentClick = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (attachmentPopupRef.current && !attachmentPopupRef.current.contains(target)) {
        setAttachmentPopupOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideAttachmentClick);
    document.addEventListener('touchstart', handleOutsideAttachmentClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideAttachmentClick);
      document.removeEventListener('touchstart', handleOutsideAttachmentClick);
    };
  }, [attachmentPopupOpen]);

  // Rename Inline State
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<number | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Model Selection State (Kevin pro, Prodix pro, Kevin 1.3 Lite)
  const [selectedModel, setSelectedModel] = useState<'Kevin pro' | 'Prodix pro' | 'Kevin 1.3 Lite'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('kevin_ai_selected_model') as any) || 'Kevin pro';
    }
    return 'Kevin pro';
  });
  const [showModelPicker, setShowModelPicker] = useState(false);

  // Multi-Key Rotation Pool Settings State
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [keysPool, setKeysPool] = useState<GeminiKeysPool>(() => getGeminiKeysPool());
  const [savedApiKeyStatus, setSavedApiKeyStatus] = useState<string | null>(null);

  const handleSaveKeysPool = () => {
    setGeminiKeysPool(keysPool);
    const hasAny = Boolean(keysPool.primary.trim() || keysPool.backup1.trim() || keysPool.backup2.trim() || keysPool.backup3.trim() || keysPool.backup4.trim());
    setSavedApiKeyStatus(hasAny ? "API Keys pool yabitswe neza!" : "Keys zose zakuwemo.");
    showToastMessage(hasAny ? "✅ INJIZA KEVIN API KEYS yabitswe neza!" : "ℹ️ Keys zakuwemo");
    setTimeout(() => {
      setShowApiKeyModal(false);
      setSavedApiKeyStatus(null);
    }, 1200);
  };

  // Full Agent Permissions, WhatsApp Auto-Reply & STT State
  const [agentPermissions, setAgentPermissions] = useState<AgentPermissions>(() => getAgentPermissions());
  const [nativeAgentStatus, setNativeAgentStatus] = useState<NativeAgentStatus>(() => getNativeAgentStatus());
  const [agentOutbox, setAgentOutbox] = useState<AgentOutboxItem[]>(() => getAgentOutbox());
  const [savedContacts, setSavedContacts] = useState<SavedContact[]>(() => getSavedContacts());
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [quickPhoneInputs, setQuickPhoneInputs] = useState<Record<string, string>>({});
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [waTestSender, setWaTestSender] = useState('Aline');
  const [waTestMessage, setWaTestMessage] = useState('');
  const [isTestingWaReply, setIsTestingWaReply] = useState(false);
  const [customPauseMinutes, setCustomPauseMinutes] = useState('');
  const [pauseNowTick, setPauseNowTick] = useState(() => Date.now());
  const [isTranscribingSTT, setIsTranscribingSTT] = useState(false);
  const vcfInputRef = useRef<HTMLInputElement | null>(null);
  const autoSyncedContactsRef = useRef(false);

  useEffect(() => {
    saveAgentPermissions(agentPermissions);
  }, []);

  useEffect(() => {
    const pausedUntil = Number(agentPermissions.whatsappAutoReplyPausedUntil || 0);
    if (!agentPermissions.whatsappAutoReply || pausedUntil <= Date.now()) {
      return;
    }
    const remaining = pausedUntil - Date.now();
    const intervalId = setInterval(() => {
      setPauseNowTick(Date.now());
    }, 10_000);
    const expiryTimer = setTimeout(() => {
      setPauseNowTick(Date.now());
      const latest = getAgentPermissions();
      if (latest.whatsappAutoReply && Number(latest.whatsappAutoReplyPausedUntil || 0) <= Date.now()) {
        const resumed = { ...latest, whatsappAutoReplyPausedUntil: 0 };
        setAgentPermissions(resumed);
        saveAgentPermissions(resumed);
        setNativeAgentStatus(getNativeAgentStatus());
        showToastMessage('💬 Igihe cyo guhagarika cyarangiye — WhatsApp Auto-Reply yongeye gutangira!');
      }
    }, Math.min(remaining + 120, 2_147_483_647));

    return () => {
      clearInterval(intervalId);
      clearTimeout(expiryTimer);
    };
  }, [agentPermissions.whatsappAutoReply, agentPermissions.whatsappAutoReplyPausedUntil]);

  useEffect(() => {
    if (!nativeAgentStatus.isAndroid || !nativeAgentStatus.hasContactsPermission || autoSyncedContactsRef.current) {
      return;
    }
    autoSyncedContactsRef.current = true;
    importContactsFromDevice()
      .then((res) => {
        if (Array.isArray(res.contacts) && res.contacts.length > 0) {
          setSavedContacts(res.contacts);
        }
      })
      .catch(() => {});
  }, [nativeAgentStatus.isAndroid, nativeAgentStatus.hasContactsPermission]);

  useEffect(() => {
    const handlePerms = (e: Event) => {
      const detail = (e as CustomEvent<AgentPermissions>).detail;
      if (detail) setAgentPermissions(detail);
    };
    const handleNativeStatus = (e: Event) => {
      const detail = (e as CustomEvent<NativeAgentStatus>).detail;
      if (detail) setNativeAgentStatus(detail);
    };
    const handleOutbox = (e: Event) => {
      const detail = (e as CustomEvent<AgentOutboxItem[]>).detail;
      if (detail) setAgentOutbox(detail);
    };
    const handleContacts = (e: Event) => {
      const detail = (e as CustomEvent<SavedContact[]>).detail;
      if (detail) setSavedContacts(detail);
    };
    const handleWaReplied = (e: Event) => {
      const detail = (e as CustomEvent<{ sender: string; incoming: string; reply: string }>).detail;
      if (!detail) return;
      playWhatsAppSound('receive');
      appendAgentOutbox({
        channel: 'whatsapp-autoreply',
        recipient: detail.sender || 'WhatsApp Contact',
        incoming: detail.incoming,
        message: detail.reply,
        status: 'sent',
      });
      showToastMessage(`💬 Kevin AI yasubije ${detail.sender} kuri WhatsApp!`);
    };

    window.addEventListener('kevinAgentPermissionsUpdated', handlePerms);
    window.addEventListener('kevinAgentStatus', handleNativeStatus);
    window.addEventListener('kevinAgentOutboxUpdated', handleOutbox);
    window.addEventListener('kevinContactsUpdated', handleContacts);
    window.addEventListener('kevinWhatsAppAutoReplied', handleWaReplied);
    return () => {
      window.removeEventListener('kevinAgentPermissionsUpdated', handlePerms);
      window.removeEventListener('kevinAgentStatus', handleNativeStatus);
      window.removeEventListener('kevinAgentOutboxUpdated', handleOutbox);
      window.removeEventListener('kevinContactsUpdated', handleContacts);
      window.removeEventListener('kevinWhatsAppAutoReplied', handleWaReplied);
    };
  }, []);

  useEffect(() => {
    if (!showAgentModal || !nativeAgentStatus.isAndroid) return;
    setNativeAgentStatus(getNativeAgentStatus());
    const id = setInterval(() => {
      setNativeAgentStatus(getNativeAgentStatus());
    }, 1200);
    return () => clearInterval(id);
  }, [showAgentModal, nativeAgentStatus.isAndroid]);

  const updateAgentPerms = (patch: Partial<AgentPermissions>) => {
    const next = { ...agentPermissions, ...patch };
    setAgentPermissions(next);
    saveAgentPermissions(next);
    setPauseNowTick(Date.now());
    setNativeAgentStatus(getNativeAgentStatus());
  };

  const waAutoReplyState = (() => {
    void pauseNowTick;
    return getWhatsAppAutoReplyState(agentPermissions);
  })();

  const pauseWhatsAppAutoReplyForMinutes = (minutes: number) => {
    const cleanMins = Math.max(1, Math.round(minutes));
    const pausedUntil = Date.now() + cleanMins * 60_000;
    updateAgentPerms({
      whatsappAutoReply: true,
      whatsappAutoReplyPausedUntil: pausedUntil,
    });
    const resumeAt = new Date(pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    showToastMessage(`⏸️ WhatsApp Auto-Reply yahagaritsweho ${formatRemainingPauseDuration(cleanMins * 60_000)} (izongera saa ${resumeAt}).`);
  };

  const stopWhatsAppAutoReplyCompletely = () => {
    updateAgentPerms({
      whatsappAutoReply: false,
      whatsappAutoReplyPausedUntil: 0,
    });
    showToastMessage('🔕 WhatsApp Auto-Reply yafunzwe kugeza igihe uzayifungurira.');
  };

  const resumeWhatsAppAutoReplyNow = () => {
    updateAgentPerms({
      whatsappAutoReply: true,
      whatsappAutoReplyPausedUntil: 0,
    });
    showToastMessage('💬 WhatsApp Auto-Reply yongeye gukora!');
  };

  const handleAddContact = () => {
    const cleanName = newContactName.trim();
    const cleanPhone = sanitizePhoneNumber(newContactPhone);
    if (!cleanName || !isLikelyPhoneNumber(cleanPhone)) {
      showToastMessage('Shyiramo izina na nimero ya telefoni yuzuye.');
      return;
    }
    const updated = saveContact(cleanName, cleanPhone);
    setSavedContacts(updated);
    setNewContactName('');
    setNewContactPhone('');
    showToastMessage(`📇 ${cleanName} yabitswe muri Contacts!`);
  };

  const handleImportContacts = async () => {
    try {
      const res = await importContactsFromDevice();
      setSavedContacts(res.contacts);
      if (res.source === 'needs_permission') {
        showToastMessage('Emera permission ya READ_CONTACTS kuri Android maze wongere ukande Import.');
      } else if (res.source === 'unsupported') {
        vcfInputRef.current?.click();
      } else {
        showToastMessage(`✅ Contacts ${res.added} zongerewe muri Kevin AI!`);
      }
    } catch (err) {
      showToastMessage(err instanceof Error ? err.message : 'Byanze kuvana contacts kuri telefone.');
    }
  };

  const handleVcfSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const res = importContactsFromVcfText(text);
      setSavedContacts(res.contacts);
      showToastMessage(`📇 Contacts ${res.added} zavuye muri ${file.name} zabitswe!`);
    } catch {
      showToastMessage('Ntibyashobotse gusoma dosiye ya .vcf.');
    }
  };

  const executeResolvedContactAction = (messageId: string, action: DeviceAction, name: string, phone: string) => {
    const cleanPhone = action.name === 'open_whatsapp' ? formatWhatsAppPhoneNumber(phone) : sanitizePhoneNumber(phone);
    if (!isLikelyPhoneNumber(cleanPhone)) {
      showToastMessage('Shyiramo nimero ya telefoni yemewe.');
      return;
    }
    const updatedAction: DeviceAction = {
      ...action,
      phoneNumber: cleanPhone,
      contactName: name || action.contactName,
      args: { ...action.args, phone_number: cleanPhone, contact_name: name || action.contactName },
      label: action.name === 'make_call'
        ? `Hamagara ${name ? `${name} (${cleanPhone})` : cleanPhone}`
        : action.name === 'send_sms'
          ? `SMS → ${name ? `${name} (${cleanPhone})` : cleanPhone}`
          : `WhatsApp → ${name || cleanPhone}`,
      url: action.name === 'make_call'
        ? `tel:${cleanPhone}`
        : action.name === 'send_sms'
          ? `sms:${cleanPhone}?body=${encodeURIComponent(action.messageText || '')}`
          : `https://wa.me/${formatWhatsAppPhoneNumber(cleanPhone)}?text=${encodeURIComponent(action.messageText || '')}`,
      fallbackUrl: action.name === 'make_call' ? `tel:${cleanPhone}` : action.fallbackUrl,
      contactMatches: undefined,
      status: 'executed',
    };
    runDeviceAction(updatedAction, true);
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, action: updatedAction } : m));
  };

  const handleTestWhatsAppReply = async () => {
    if (!waTestMessage.trim() || isTestingWaReply) return;
    setIsTestingWaReply(true);
    try {
      const reply = await generateWhatsAppAutoReply(
        waTestSender.trim() || 'Contact',
        waTestMessage.trim(),
        agentPermissions.whatsappReplyStyle
      );
      appendAgentOutbox({
        channel: 'whatsapp-autoreply',
        recipient: waTestSender.trim() || 'Contact',
        incoming: waTestMessage.trim(),
        message: reply,
        status: 'sent',
      });
      setWaTestMessage('');
      showToastMessage(`✅ Igisubizo cya WhatsApp cyoherejwe kuri ${waTestSender.trim() || 'Contact'}!`);
    } catch (err) {
      showToastMessage(err instanceof Error ? err.message : 'Byanze kohereza igisubizo.');
    } finally {
      setIsTestingWaReply(false);
    }
  };

  // Speech Recognition State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const voiceRecordingRef = useRef<VoiceRecordingSession | null>(null);
  const timerRef = useRef<any>(null);
  const voiceStoppingRef = useRef(false);
  const initialInputRef = useRef<string>('');
  const toastTimeoutRef = useRef<any>(null);
  const latestScreenFrameRef = useRef<AttachmentItem | null>(null);

  const showToastMessage = (msg: string) => {
    setToastMsg(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMsg(null), 3000);
  };

  const stopRecording = () => {
    if (voiceRecordingRef.current) {
      void finishVoiceRecording();
    }
  };

  const cancelRecording = () => {
    if (voiceRecordingRef.current) {
      voiceRecordingRef.current.cancel();
      resetVoiceRecordingState();
      showToastMessage('Amajwi yasibwe.');
    }
  };

  const resetVoiceRecordingState = () => {
    clearInterval(timerRef.current);
    voiceRecordingRef.current = null;
    setIsRecording(false);
  };

  const transcribeRecordingToInput = async () => {
    if (voiceStoppingRef.current) return;
    const recording = voiceRecordingRef.current;
    if (!recording) return;

    voiceStoppingRef.current = true;
    setIsTranscribingSTT(true);
    try {
      const audioBlob = await recording.stop();
      resetVoiceRecordingState();
      if (!audioBlob.size) {
        throw new Error('No audio was captured.');
      }
      const audioBase64 = await blobToBase64(audioBlob);
      const transcript = await transcribeAudioWithSTT(audioBase64, recording.mimeType);
      if (transcript) {
        setInput(prev => (prev ? `${prev.trim()} ${transcript}` : transcript));
        showToastMessage('🎙️ Byanditswe!');
      } else {
        showToastMessage('Ntacyo ijwi ryabashije kumvikana. Ongera ugerageze.');
      }
    } catch (error) {
      showToastMessage(error instanceof Error ? error.message : 'Byanze gusoma amajwi.');
    } finally {
      setIsTranscribingSTT(false);
      voiceStoppingRef.current = false;
      resetVoiceRecordingState();
    }
  };

  const finishVoiceRecording = async (imageBase64?: string, assistantRequest = false) => {
    if (voiceStoppingRef.current) return;
    const recording = voiceRecordingRef.current;
    if (!recording) return;

    voiceStoppingRef.current = true;
    try {
      const audioBlob = await recording.stop();
      resetVoiceRecordingState();
      if (!audioBlob.size || (!assistantRequest && audioBlob.size < 1400)) {
        if (!assistantRequest) {
          showToastMessage('🎙️ Ijwi ryabaye rigufi cyane. Ongera ufate amajwi neza.');
          return;
        }
        throw new Error('No audio was captured.');
      }

      const audioBase64 = await blobToBase64(audioBlob);
      if (audioBase64.length <= 200) {
        if (!assistantRequest) {
          showToastMessage('🎙️ Nta jwi ryumvikanye neza. Ongera uvuge.');
          return;
        }
        throw new Error('The recorded audio is empty or invalid. Please record your message again.');
      }

      let transcript = '';
      if (!assistantRequest) {
        setIsTranscribingSTT(true);
        try {
          transcript = await transcribeAudioWithSTT(audioBase64, recording.mimeType);
        } catch (sttErr) {
          console.warn('STT fallback to multimodal audio:', sttErr);
        } finally {
          setIsTranscribingSTT(false);
        }
      }

      const cleanTranscript = transcript.trim();

      if (assistantRequest) {
        const nativeBridge = window.KevinAssistantNative;
        const attachments: Array<Blob | AttachmentItem> = [audioBlob];
        if (imageBase64) {
          attachments.push({
            base64: imageBase64,
            mimeType: 'image/jpeg',
            name: 'live-screen.jpg',
          });
        }
        const response = await sendMessageToGemini(
          [],
          cleanTranscript || '🎤 Voice Note',
          undefined,
          attachments,
          'gemini-4-hydrogen',
          undefined,
          audioBase64,
          recording.mimeType
        );
        nativeBridge?.onGeminiResponse?.(response);
        return;
      }

      const audioUrl = URL.createObjectURL(audioBlob);
      void handleSendMessage(cleanTranscript || '🎤 Voice Note', audioBlob, audioBase64, recording.mimeType, audioUrl);
    } catch (error) {
      console.error("Audio processing error:", error);
      const message = error instanceof Error ? error.message : "Unable to process the voice message.";
      if (assistantRequest) {
        window.KevinAssistantNative?.onGeminiError?.(message);
      } else {
        showToastMessage(message);
      }
    } finally {
      setIsTranscribingSTT(false);
      voiceStoppingRef.current = false;
      resetVoiceRecordingState();
    }
  };

  const startVoiceRecording = async () => {
    if (voiceRecordingRef.current) return;
    try {
      const recording = await createVoiceRecordingSession();
      voiceRecordingRef.current = recording;
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (error) {
      console.error("Microphone recording start error:", error);
      resetVoiceRecordingState();
      throw error;
    }
  };

  const toggleRecording = async (startingText = input) => {
    if (isRecording) {
      stopRecording();
    } else {
      try {
        initialInputRef.current = startingText;
        await startVoiceRecording();
      } catch (error) {
        showToastMessage(error instanceof Error
          ? error.message
          : "Microphone permission denied or unavailable.");
      }
    }
  };

  const startAssistantVoice = async () => {
    await startVoiceRecording();
    window.KevinAssistantNative?.onAssistantVoiceStarted?.();
  };

  const stopAssistantVoice = async (imageBase64?: string) => {
    await finishVoiceRecording(imageBase64, true);
    window.KevinAssistantNative?.onAssistantVoiceStopped?.();
  };

  assistantStartVoiceRef.current = startAssistantVoice;
  assistantStopVoiceRef.current = stopAssistantVoice;

  useEffect(() => () => {
    clearInterval(timerRef.current);
    voiceRecordingRef.current?.cancel();
    voiceRecordingRef.current = null;
  }, []);

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const attachment = await createImageAttachment(file);
      setAttachedImages(prev => [...prev, attachment]);
      setAttachmentPopupOpen(false);
    } catch (error) {
      console.error('Image attachment failed:', error);
      showToastMessage('The selected image could not be attached.');
    }
  };

  const handleGalleryFilesSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;

    try {
      const selectedImages: AttachmentItem[] = [];
      for (const file of files) {
        try {
          const att = await createImageAttachment(file);
          selectedImages.push(att);
        } catch (itemErr) {
          console.warn('Skipping unreadable gallery file:', itemErr);
        }
      }
      if (selectedImages.length > 0) {
        setAttachedImages(prev => [...prev, ...selectedImages]);
        setAttachmentPopupOpen(false);
      } else {
        showToastMessage('Ifoto yahiswemo ntiyabashije gufunguka.');
      }
    } catch (error) {
      console.error('Gallery image attachment failed:', error);
      showToastMessage('One or more selected images could not be attached.');
    }
  };

  const openUniversalFileInput = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    document.getElementById('universal-file-input')?.click();
  };

  const handleTakePhoto = async () => {
    try {
      console.log('Camera button clicked - launching camera directly...');
      const photo = await CapCamera.getPhoto({
        quality: 70,
        width: 1024,
        height: 1024,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
        correctOrientation: true,
        saveToGallery: false,
      });
      const rawBase64 = cleanBase64(photo.base64String || '');
      const mime = photo.format ? `image/${photo.format === 'jpg' ? 'jpeg' : photo.format}` : 'image/jpeg';

      if (rawBase64) {
        const approxBytes = Math.round((rawBase64.length * 3) / 4);
        const rawDataUrl = `data:${mime};base64,${rawBase64}`;
        if (approxBytes > 350 * 1024) {
          const blob = await (await fetch(rawDataUrl)).blob();
          const compressed = await compressImageToAttachment(blob, {
            name: 'camera_photo.jpg',
            mimeType: mime,
            maxDim: 1280,
            quality: 0.82,
          });
          setAttachedImages(prev => [...prev, compressed]);
        } else {
          setAttachedImages(prev => [
            ...prev,
            {
              base64: rawDataUrl,
              mimeType: mime,
              name: 'camera_photo.jpg',
              size: `${Math.max(1, Math.round(approxBytes / 1024))} KB`,
            },
          ]);
        }
        setAttachmentPopupOpen(false);
        return;
      }

      if (photo.path || photo.webPath) {
        const nativeAtt = readNativeCompressedImage(photo.path || photo.webPath || '', {
          name: 'camera_photo.jpg',
          maxDim: 1280,
          quality: 82,
        });
        if (nativeAtt) {
          setAttachedImages(prev => [...prev, nativeAtt]);
          setAttachmentPopupOpen(false);
          return;
        }
      }

      if (photo.webPath) {
        const blob = await (await fetch(photo.webPath)).blob();
        const compressed = await compressImageToAttachment(blob, {
          name: 'camera_photo.jpg',
          mimeType: blob.type || mime,
          maxDim: 1280,
          quality: 0.82,
        });
        setAttachedImages(prev => [...prev, compressed]);
        setAttachmentPopupOpen(false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('User cancelled') || message.includes('cancelled')) return;
      console.error('Camera capture error:', error);
      if (/plugin|not implemented|not available/i.test(message)) {
        const fileInput = document.getElementById('camera-fallback-input') as HTMLInputElement | null;
        fileInput?.click();
      }
    }
  };

  const handleGalleryClick = async (event?: React.MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();

    try {
      const { results } = await CapCamera.chooseFromGallery({
        allowMultipleSelection: true,
        quality: 82,
        targetWidth: 1280,
        targetHeight: 1280,
        correctOrientation: true,
      });

      if (!results || results.length === 0) return;

      const selectedImages: AttachmentItem[] = [];
      for (let index = 0; index < results.length; index++) {
        const item = results[index];
        try {
          if (item.type && String(item.type).toLowerCase().includes('video')) continue;

          const itemName = `gallery_image_${Date.now()}_${index + 1}.jpg`;
          const nativeCompressed = readNativeCompressedImage(item.uri || item.webPath || '', {
            name: itemName,
            maxDim: 1280,
            quality: 82,
          });
          if (nativeCompressed) {
            selectedImages.push(nativeCompressed);
            continue;
          }

          let blob: Blob | null = null;
          if (item.webPath) {
            const response = await fetch(item.webPath);
            if (response.ok) {
              blob = await response.blob();
            }
          }
          if (!blob && item.thumbnail) {
            const thumbUrl = item.thumbnail.startsWith('data:')
              ? item.thumbnail
              : `data:image/jpeg;base64,${item.thumbnail}`;
            const thumbRes = await fetch(thumbUrl);
            if (thumbRes.ok) {
              blob = await thumbRes.blob();
            }
          }
          if (!blob || !blob.size) continue;
          if (blob.type && blob.type.startsWith('video/')) continue;

          const mimeType = blob.type || 'image/jpeg';
          const compressed = await compressImageToAttachment(blob, {
            name: itemName,
            mimeType,
            maxDim: 1280,
            quality: 0.82,
          });
          selectedImages.push(compressed);
        } catch (itemErr) {
          console.warn('Gallery item processing skipped:', itemErr);
        }
      }

      if (selectedImages.length > 0) {
        setAttachedImages(prev => [...prev, ...selectedImages]);
        setAttachmentPopupOpen(false);
      } else {
        showToastMessage('Ntihashoboye gukururwa ifoto muri gallery. Ongera ugerageze.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cancel|cancelled|canceled/i.test(message)) return;
      if (/plugin|not implemented|not available/i.test(message)) {
        const picker = document.getElementById('kevin-multi-picker') as HTMLInputElement | null;
        picker?.click();
        return;
      }

      console.error('Modern Photo Picker error:', error);
      showToastMessage('Could not select images. Please try again.');
    }
  };

  const backButtonHandlerRef = useRef<() => void>(() => {});
  backButtonHandlerRef.current = () => {
    if (previewImage) { setPreviewImage(null); return; }
    if (showAssistantOverlay) { setShowAssistantOverlay(false); return; }
    if (showAgentModal) { setShowAgentModal(false); return; }
    if (showSettingsModal) { setShowSettingsModal(false); return; }
    if (showApiKeyModal) { setShowApiKeyModal(false); return; }
    if (showCustomInstructionsModal) { setShowCustomInstructionsModal(false); return; }
    if (showAbout) { setShowAbout(false); return; }
    if (showClearConfirm) { setShowClearConfirm(false); return; }
    if (menuOpen) { setMenuOpen(false); return; }
    if (attachmentPopupOpen) { setAttachmentPopupOpen(false); return; }
    if (emojiPickerOpen) { setEmojiPickerOpen(false); return; }
    if (drawerOpen) { setDrawerOpen(false); return; }
    if (messages.length > 0) {
      const currentMsgs = messages;
      const updatedSessions = sessions.map(s => {
        if (s.id !== currentSessionId) return s;
        let title = s.title;
        if ((s.title === "New Chat" || s.title === "Ibiganiro bishya") && currentMsgs.length > 0) {
          const firstUserMsg = currentMsgs.find(m => m.sender === 'user');
          if (firstUserMsg && firstUserMsg.text.trim()) {
            const clean = firstUserMsg.text.trim().replace(/^[\s#*`\-]+/, '').slice(0, 36);
            title = clean.length > 0 ? clean : "Chat";
          }
        }
        return { ...s, messages: currentMsgs, title, timestamp: s.timestamp || Date.now() };
      });
      const existingEmpty = updatedSessions.find(s => s.id !== currentSessionId && s.messages.length === 0);
      if (existingEmpty) {
        saveChatHistory(updatedSessions);
        setSessions(updatedSessions);
        setCurrentSessionId(existingEmpty.id);
        setMessages([]);
      } else {
        const freshSession: ChatSession = {
          id: Date.now(),
          title: "New Chat",
          messages: [],
          timestamp: Date.now(),
        };
        const nextSessions = [freshSession, ...updatedSessions];
        saveChatHistory(nextSessions);
        setSessions(nextSessions);
        setCurrentSessionId(freshSession.id);
        setMessages([]);
      }
      return;
    }
    CapApp.exitApp();
  };

  useEffect(() => {
    let backButtonListener: any;
    const initBackButton = async () => {
      try {
        backButtonListener = await CapApp.addListener('backButton', () => {
          backButtonHandlerRef.current();
        });
      } catch (e) {
        console.log("CapApp backButton not supported on web preview", e);
      }
    };
    initBackButton();

    return () => {
      if (backButtonListener) {
        backButtonListener.remove();
      }
    };
  }, []);

  useEffect(() => {
    const handlePreview = (e: Event) => {
      const customEvt = e as CustomEvent<{ src: string }>;
      if (customEvt.detail?.src) {
        setPreviewImage(customEvt.detail.src);
      }
    };
    window.addEventListener('preview-image', handlePreview);
    return () => window.removeEventListener('preview-image', handlePreview);
  }, []);

  useEffect(() => {
    const handleToast = (e: Event) => {
      const customEvt = e as CustomEvent<{ message: string }>;
      if (customEvt.detail?.message) {
        showToastMessage(customEvt.detail.message);
      }
    };
    window.addEventListener('show-toast', handleToast);
    return () => window.removeEventListener('show-toast', handleToast);
  }, []);

  const updateSessionMessages = (newMessages: Message[]) => {
    setMessages(newMessages);
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        let title = s.title;
        if ((s.title === "New Chat" || s.title === "Ibiganiro bishya") && newMessages.length > 0) {
          const firstUserMsg = newMessages.find(m => m.sender === 'user');
          if (firstUserMsg && firstUserMsg.text.trim()) {
            const clean = firstUserMsg.text.trim().replace(/^[\s#*`\-]+/, '').slice(0, 36);
            title = clean.length > 0 ? clean : "Chat";
          }
        }
        return { ...s, messages: newMessages, title, timestamp: s.timestamp || Date.now() };
      }
      return s;
    }));
  };

  const renameSession = (id: number, newTitle: string) => {
    if (!newTitle.trim()) return;
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title: newTitle.trim() } : s));
  };
  
  const deleteSession = (id: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (sessions.length <= 1) {
      const newId = Date.now();
      const fresh: ChatSession = { id: newId, title: "New Chat", messages: [], timestamp: Date.now() };
      setSessions([fresh]);
      setCurrentSessionId(newId);
      setMessages([]);
      setSessionToDelete(null);
      return;
    }
    const newSessions = sessions.filter(s => s.id !== id);
    setSessions(newSessions);
    if (currentSessionId === id) {
      setCurrentSessionId(newSessions[0].id);
      setMessages(newSessions[0].messages);
    }
    setSessionToDelete(null);
    showToastMessage("Chat deleted.");
  };

  const clearAllSessions = () => {
    const timestamp = Date.now();
    const freshSession: ChatSession = {
      id: timestamp,
      title: "New Chat",
      messages: [],
      timestamp: timestamp,
    };
    setSessions([freshSession]);
    setCurrentSessionId(timestamp);
    setMessages([]);
    setShowClearConfirm(false);
    showToastMessage("All chat history cleared.");
  };

  const getGroupedSessions = () => {
    const filtered = sessions.filter(s => {
      if (!chatSearchQuery.trim()) return true;
      const q = chatSearchQuery.toLowerCase();
      const matchTitle = s.title.toLowerCase().includes(q);
      const matchMsg = s.messages.some(m => m.text?.toLowerCase().includes(q));
      return matchTitle || matchMsg;
    });

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const last7DaysStart = todayStart - 7 * 24 * 60 * 60 * 1000;
    const last30DaysStart = todayStart - 30 * 24 * 60 * 60 * 1000;

    const groups: { label: string; items: ChatSession[] }[] = [];
    const todayItems = filtered.filter(s => (s.timestamp || s.id) >= todayStart);
    const yesterdayItems = filtered.filter(s => {
      const t = s.timestamp || s.id;
      return t < todayStart && t >= yesterdayStart;
    });
    const past7DaysItems = filtered.filter(s => {
      const t = s.timestamp || s.id;
      return t < yesterdayStart && t >= last7DaysStart;
    });
    const past30DaysItems = filtered.filter(s => {
      const t = s.timestamp || s.id;
      return t < last7DaysStart && t >= last30DaysStart;
    });
    const olderItems = filtered.filter(s => (s.timestamp || s.id) < last30DaysStart);

    if (todayItems.length > 0) groups.push({ label: 'Today', items: todayItems });
    if (yesterdayItems.length > 0) groups.push({ label: 'Yesterday', items: yesterdayItems });
    if (past7DaysItems.length > 0) groups.push({ label: 'Previous 7 Days', items: past7DaysItems });
    if (past30DaysItems.length > 0) groups.push({ label: 'Previous 30 Days', items: past30DaysItems });
    if (olderItems.length > 0) groups.push({ label: 'Older', items: olderItems });

    return { groups, totalFiltered: filtered.length };
  };

  const exportAsPdf = async (text: string, title = 'KevinAI_Document') => {
    const url = generatePdfBlobUrl(title, text);
    const res = await downloadDocumentFile(url, `${title}.pdf`, text, title, 'pdf');
    if (res.success) {
      showToastMessage("📄 PDF yabitswe muri Downloads!");
    } else {
      showToastMessage("⚠️ Byanze kubika PDF.");
    }
  };

  const exportAsWord = async (text: string, title = 'KevinAI_Document') => {
    const url = generateDocxBlobUrl(title, text);
    const res = await downloadDocumentFile(url, `${title}.doc`, text, title, 'docx');
    if (res.success) {
      showToastMessage("📝 Word document yabitswe muri Downloads!");
    } else {
      showToastMessage("⚠️ Byanze kubika Word document.");
    }
  };

  const handleSendMessage = async (
    overrideInput?: string,
    overrideAttachment?: AttachmentItem | Blob,
    audioBase64?: string,
    audioMimeType?: string,
    audioUrl?: string
  ) => {
    const textToSend = overrideInput !== undefined ? overrideInput : input;
    if (textToSend.trim() === '' && attachedImages.length === 0 && !attachedImage && !overrideAttachment) return;
    
    setIsGenerating(true);
    setInput('');
    const selectedAttachments = overrideAttachment
      ? [overrideAttachment]
      : [...attachedImages, ...(attachedImage ? [attachedImage] : [])];
    const currentAttachment = selectedAttachments[0];
    const currentAttachmentMimeType = currentAttachment instanceof Blob
      ? currentAttachment.type
      : currentAttachment?.mimeType;
    const screenFrame = screenSharingActive ? latestScreenFrameRef.current : null;
    const attachmentsForSend = screenFrame
      ? [...selectedAttachments, screenFrame]
      : selectedAttachments;
    setAttachedImages([]);
    setAttachedImage(null);

    const userMessageId = Date.now().toString();
    const userMessage: Message = {
      id: userMessageId,
      text: textToSend,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      image: currentAttachmentMimeType?.startsWith('image/') && !(currentAttachment instanceof Blob)
        ? currentAttachment.base64
        : undefined,
      audioUrl: audioUrl || (currentAttachmentMimeType?.startsWith('audio/') && currentAttachment instanceof Blob
        ? URL.createObjectURL(currentAttachment)
        : undefined),
      document: currentAttachment && !(currentAttachment instanceof Blob) && !currentAttachmentMimeType?.startsWith('image/') && !currentAttachmentMimeType?.startsWith('audio/') ? {
        type: currentAttachmentMimeType === 'application/pdf' ? 'pdf' : 'docx',
        name: currentAttachment.name || 'Document',
        size: currentAttachment.size || 'Document',
      } : undefined,
      status: 'delivered' as MessageStatus,
    };
    
    updateSessionMessages([...messages, userMessage]);


    // Handle Kevin Creator Photo Requests
    if (isKevinPhotoRequest(textToSend) && selectedAttachments.length === 0) {
      try {
        setIsTyping(true);
        setMessages(prev => prev.map(msg => msg.sender === 'user' ? { ...msg, status: 'read' as MessageStatus } : msg));
        
        const { url: kevinPhotoUrl, caption } = getKevinPhotoUrl();
        const aiMessageId = (Date.now() + 1).toString();
        
        const aiReplyText = `${caption}\n\n![Uwumukiza Kevin](${kevinPhotoUrl})`;

        const aiMessage: Message = {
          id: aiMessageId,
          text: aiReplyText,
          sender: 'kevin',
          image: kevinPhotoUrl,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: 'read' as MessageStatus
        };

        const newMessages = [...messages, userMessage, aiMessage];
        updateSessionMessages(newMessages);
        playWhatsAppSound('receive');
        return;
      } catch (err) {
        console.warn("Kevin photo request handler error:", err);
      } finally {
        setIsTyping(false);
        setIsGenerating(false);
      }
    }

    // Handle Image Generation requests
    if (isImageGenerationRequest(textToSend) && selectedAttachments.length === 0) {
      try {
        setIsTyping(true);
        setMessages(prev => prev.map(msg => msg.sender === 'user' ? { ...msg, status: 'read' as MessageStatus } : msg));
        
        const cleanPrompt = cleanImagePrompt(textToSend) || textToSend;
        const imageUrl = generateAIImage(textToSend);
        const aiMessageId = (Date.now() + 1).toString();
        
        const lower = textToSend.toLowerCase();
        const isKinyarwanda = lower.includes('ifoto') || lower.includes('shushanya') || lower.includes('kora') || lower.includes('igishushanyo');
        
        const aiReplyText = isKinyarwanda 
          ? `🎨 **Ifoto yawe irabonetse:**\n*« ${cleanPrompt} »*\n\n![${cleanPrompt}](${imageUrl})`
          : `🎨 **Here is your generated image:**\n*« ${cleanPrompt} »*\n\n![${cleanPrompt}](${imageUrl})`;

        const aiMessage: Message = {
          id: aiMessageId,
          text: aiReplyText,
          sender: 'kevin',
          image: imageUrl,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: 'read' as MessageStatus
        };

        const newMessages = [...messages, userMessage, aiMessage];
        updateSessionMessages(newMessages);
        playWhatsAppSound('receive');
        return;
      } catch (imgErr) {
        console.warn("AI Image Generation failed, proceeding with text response:", imgErr);
      } finally {
        setIsTyping(false);
        setIsGenerating(false);
      }
    }

    try {
      setIsTyping(true);
      // Immediately mark user messages as read when AI starts processing
      setMessages(prev => prev.map(msg => msg.sender === 'user' ? { ...msg, status: 'read' as MessageStatus } : msg));
      
      let aiReplyText = "";
      const aiMessageId = (Date.now() + 1).toString();
      
      await sendMessageToGemini(messages, textToSend, (chunk) => {
        setIsTyping(false);
        aiReplyText += chunk;
        
        setMessages((prevMessages) => {
          const existingAiMessage = prevMessages.find(m => m.id === aiMessageId);
          
          const newMessages = existingAiMessage 
            ? prevMessages.map(m => m.id === aiMessageId ? { ...m, text: aiReplyText } : m)
            : [...prevMessages.map(m => m.id === userMessageId ? { ...m, status: 'read' as MessageStatus } : m), {
                id: aiMessageId,
                text: aiReplyText,
                sender: 'kevin' as const,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                status: 'read' as MessageStatus
              }];
          
          setSessions(prev => prev.map(s => {
            if (s.id === currentSessionId) {
              let title = s.title;
              if (s.title === "New Chat" && newMessages.length > 0) {
                const firstUserMsg = newMessages.find(m => m.sender === 'user');
                if (firstUserMsg) {
                  title = firstUserMsg.text.substring(0, 30);
                }
              }
              return { ...s, messages: newMessages, title };
            }
            return s;
          }));

          return newMessages;
        });
      }, attachmentsForSend || undefined, selectedModel, (action) => {
        setMessages(prevMessages => {
          const existingAiMessage = prevMessages.find(m => m.id === aiMessageId);
          const updatedMessages = existingAiMessage
            ? prevMessages.map(message => message.id === aiMessageId ? { ...message, action } : message)
            : [...prevMessages, {
                id: aiMessageId,
                text: aiReplyText || action.label,
                sender: 'kevin' as const,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                status: 'read' as MessageStatus,
                action
              }];
          setSessions(prev => prev.map(session =>
            session.id === currentSessionId ? { ...session, messages: updatedMessages } : session
          ));
          return updatedMessages;
        });
      }, audioBase64, audioMimeType, (sources) => {
        setMessages(prevMessages => {
          const updatedMessages = prevMessages.map(message =>
            message.id === aiMessageId ? { ...message, sources } : message
          );
          setSessions(prev => prev.map(session =>
            session.id === currentSessionId ? { ...session, messages: updatedMessages } : session
          ));
          return updatedMessages;
        });
      });
      playWhatsAppSound('receive');
      // Automatically generate and attach professional document if requested or export-oriented
      const lowerText = textToSend.toLowerCase();
      const isImageRequest = isImageGenerationRequest(textToSend);
      const isDocReq = !isImageRequest && (
        lowerText.includes('pdf') ||
        lowerText.includes('dosiye') ||
        lowerText.includes('inyandiko') ||
        lowerText.includes('document') ||
        lowerText.includes('report') ||
        lowerText.includes('cv') ||
        lowerText.includes('word') ||
        lowerText.includes('docx') ||
        lowerText.includes('doc') ||
        lowerText.includes('txt')
      );
      
      if (isDocReq && aiReplyText.trim().length > 10) {
        let format: 'pdf' | 'docx' | 'txt' = 'pdf';
        if (lowerText.includes('word') || lowerText.includes('docx') || lowerText.includes('doc')) format = 'docx';
        else if (lowerText.includes('txt')) format = 'txt';

        let docTitle = 'Document_Report';
        const extractedSubject = textToSend
          .replace(/create|generate|nkorera|make|give|on|pdf|word|docx|document|file|report|about|in/gi, '')
          .trim()
          .substring(0, 32)
          .replace(/[^a-zA-Z0-9_\s]/g, '')
          .trim()
          .replace(/\s+/g, '_');
          
        if (extractedSubject.length > 2) {
          docTitle = extractedSubject;
        }

        const docUrl = await generateDocument(docTitle, aiReplyText, format);
        const docName = `${docTitle}.${format === 'docx' ? 'doc' : format === 'txt' ? 'txt' : 'pdf'}`;
        const docSize = `${Math.max(1, Math.round(aiReplyText.length / 1024 * 10) / 10)} KB`;

        const isKinyarwandaMsg = lowerText.includes('kinyarwanda') || lowerText.includes('nkorera') || lowerText.includes('inyandiko') || lowerText.includes('muri') || lowerText.includes('ya') || lowerText.includes('kura');
        
        const cleanNotification = isKinyarwandaMsg
          ? `📄 **Dore dosiye ya ${format.toUpperCase()} wasabye iratunganye neza!**\n\nKanda kuri dosiye ya **${docName}** hano hasi kugira ngo uyimanure (download) uyisome neza.`
          : `📄 **Here is your generated ${format.toUpperCase()} document!**\n\nClick the **${docName}** file below to download and view the complete document.`;

        setMessages(prev => prev.map(m => m.id === aiMessageId ? {
          ...m,
          text: cleanNotification,
          document: {
            type: format === 'docx' ? 'docx' : format === 'txt' ? 'txt' : 'pdf',
            name: docName,
            url: docUrl,
            size: docSize,
            title: docTitle,
            content: aiReplyText,
            format: format
          }
        } : m));
      }
    } catch (error: any) {
      console.error("Error:", error);
      setIsTyping(false);
      const rawErrMsg = error?.message || String(error);
      let errMsg = rawErrMsg;
      try {
        const parsed = JSON.parse(rawErrMsg);
        if (parsed?.error?.message) errMsg = String(parsed.error.message);
        else if (parsed?.error && typeof parsed.error === 'string') errMsg = parsed.error;
      } catch {}
      const isLocalPreview = typeof window !== 'undefined' && (
        window.location.hostname === 'localhost'
        || window.location.hostname === '127.0.0.1'
        || window.location.hostname.includes('ais-dev')
        || window.location.hostname.includes('ais-pre')
      ) && !isCapacitorApkRuntime();
      const isApkMissingKey = errMsg.includes('APK_NO_API_KEY')
        || (getGeminiApiKeysArray().length === 0 && !isLocalPreview && (errMsg.includes('Nta Gemini API key') || errMsg.includes('API key') || errMsg.includes('Failed to fetch')));
      const isQuotaError = errMsg.toLowerCase().includes('resource_exhausted') || errMsg.includes('Quota exceeded') || errMsg.includes('429') || errMsg.toLowerCase().includes('quota');
      const isHighDemandError = errMsg.includes('503') || errMsg.toLowerCase().includes('high demand') || errMsg.toLowerCase().includes('unavailable');
      const isAuthError = errMsg.includes('API key not valid') || errMsg.includes('401') || errMsg.includes('UNAUTHENTICATED') || errMsg.includes('Secrets') || errMsg.includes('Nta Gemini API key');
      let displayMsg = "Mbabarira, habaye ikibazo cyo kohereza ubutumwa. Ongera ugerageze.";
      if (isApkMissingKey) {
        displayMsg = "🔑 Nta Gemini API Key irashyirwaho kuri iyi porogaramu. Nyamuneka jya muri Settings > INJIZA KEVIN API KEYS ushyiremo API Key yawe kugira ngo Kevin AI ikore neza.";
        setKeysPool(getGeminiKeysPool());
        setShowApiKeyModal(true);
      } else if (isQuotaError) {
        displayMsg = "⚠️ Umubare w'ubutumwa wemerewe muri aka kanya wuzuye (Rate Limit / Quota). Nyamuneka ongera ugerageze nyuma y'iminota mike cyangwa ushyiremo izindi Kevin API Keys muri Settings.";
      } else if (isHighDemandError) {
        displayMsg = "⚠️ Seriveri irimo gukoreshwa n'abantu benshi cyane muri aka kanya. Nyamuneka ongera wohereze nyuma y'amasegonda make.";
      } else if (isAuthError) {
        displayMsg = isCapacitorApkRuntime() || !isLocalPreview
          ? "⚠️ API Key yawe ntiyemeye cyangwa ntabwo irashyirwaho. Nyamuneka genzura keys zawe muri Settings > INJIZA KEVIN API KEYS."
          : "⚠️ Nta API Key yabonetse cyangwa ntabwo yashyizweho neza. Nyamuneka yishyireho muri Settings > Secrets panel.";
      } else if (errMsg && errMsg.length < 360 && !errMsg.includes("[object")) {
        displayMsg = `⚠️ ${errMsg}`;
      }

      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        text: displayMsg,
        sender: 'kevin',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'read' as MessageStatus
      };
      updateSessionMessages([...messages, userMessage, errorMsg]);
    } finally {
      setIsTyping(false);
      setIsGenerating(false);
    }
  };

  const startNewChat = () => {
    const timestamp = Date.now();
    const newSession: ChatSession = {
      id: timestamp,
      title: "New Chat",
      messages: [],
      timestamp: timestamp,
    };
    setSessions([newSession, ...sessions]);
    setCurrentSessionId(newSession.id);
    setMessages([]);
    setDrawerOpen(false);
  };

  useEffect(() => {
    const handleScreenCaptured = (event: Event) => {
      const detail = (event as CustomEvent<{ base64Image?: string }>).detail;
      if (!detail?.base64Image) return;
      const frame: AttachmentItem = {
        base64: detail.base64Image,
        mimeType: 'image/jpeg',
        name: 'live-screen.jpg',
      };
      latestScreenFrameRef.current = frame;
      setLatestScreenFrame(frame);
    };
    const handleScreenSharingState = (event: Event) => {
      const active = Boolean((event as CustomEvent<{ active?: boolean }>).detail?.active);
      setScreenSharingActive(active);
      if (!active) {
        latestScreenFrameRef.current = null;
        setLatestScreenFrame(null);
      }
    };
    window.addEventListener('screenCaptured', handleScreenCaptured);
    window.addEventListener('screenSharingState', handleScreenSharingState);
    return () => {
      window.removeEventListener('screenCaptured', handleScreenCaptured);
      window.removeEventListener('screenSharingState', handleScreenSharingState);
    };
  }, []);

  const toggleScreenSharing = () => {
    const bridge = (window as Window & {
      KevinScreenCapture?: { start?: () => void; stop?: () => void };
    }).KevinScreenCapture;
    if (!bridge) {
      showToastMessage("Live screen vision is available in the Android app.");
      return;
    }
    if (screenSharingActive) {
      bridge.stop?.();
    } else {
      bridge.start?.();
    }
  };

  if (isDedicatedAssistantOverlay) {
    return (
      <div className="min-h-screen w-screen bg-transparent font-sans">
        <AssistantOverlay
          isOpen
          isDedicatedOverlay
          selectedModel={selectedModel}
          onClose={() => undefined}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen min-h-screen w-screen overflow-hidden bg-[#ECE5DD] dark:bg-[#111b21] font-sans text-gray-900 dark:text-[#e9edef] relative">
      {/* Animated Splash Screen */}
      {showSplash && (
        <div className={`absolute inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-to-br from-[#075E54] via-[#0b141a] to-[#111b21] text-white transition-opacity duration-700 ${splashFadeOut ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          <div className="relative mb-6 flex flex-col items-center">
            <div className="relative w-28 h-28 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shadow-2xl shadow-emerald-500/30 ring-4 ring-emerald-400/30 animate-pulse">
              <span className="text-6xl animate-wave">👋</span>
            </div>
            <div className="absolute -inset-4 rounded-full border border-emerald-500/20 animate-ping pointer-events-none"></div>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight mb-2">
            Kevin <span className="text-[#00FF88]">AI</span>
          </h1>
          <p className="text-sm font-bold text-orange-500 tracking-wider uppercase mb-8">UKORA GAKE BIKAGENDA CYANE</p>
          
          {/* Loading bar */}
          <div className="w-56 mb-12 flex flex-col items-center">
            <div className="flex justify-between w-full mb-2 px-1 text-xs font-mono">
              <span className="text-gray-400">Loading</span>
              <span className="text-[#00FF88] font-bold tracking-widest">{progress}%</span>
            </div>
            <div className="w-full h-2 bg-gray-800/80 rounded-full overflow-hidden shadow-inner border border-gray-700/50">
              <div 
                className="h-full bg-gradient-to-r from-emerald-500 to-[#00FF88] rounded-full transition-all duration-75 ease-out shadow-sm shadow-[#00FF88]/50"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
          </div>

          <footer className="absolute bottom-8 text-xs text-white font-bold">
            Crafted by Uwumukiza Kevin
          </footer>
        </div>
      )}

      {/* Header */}
      <header className="bg-[#075E54] dark:bg-[#202c33] dark:border-b dark:border-[#222e35] text-white shadow-sm sticky top-0 z-30">
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-3">
            <Menu className="w-6 h-6 cursor-pointer" onClick={() => setDrawerOpen(true)} />
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#075E54] to-[#128C7E] flex items-center justify-center font-bold text-lg text-white shadow-md">
              K
            </div>
            <div>
              <h1 className="font-semibold text-base sm:text-lg flex items-center">
                <span className="text-white font-bold">Kevin</span>
                <span className="text-[#00FF88] font-extrabold ml-1">AI</span>
              </h1>
              <p className="text-[11px] text-green-100 dark:text-[#8696a0] flex items-center gap-1.5 mt-0.5 min-h-[16px]">
                {(isTyping || isTranscribingSTT) ? (
                  <span className="text-[#00FF88] font-medium">typing...</span>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-[#25D366] inline-block"></span>
                    <span>online</span>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 relative">
            <button onClick={startNewChat} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors" title="New Chat">
              <Plus className="w-5 h-5 text-[#00FF88]" />
            </button>
            <MoreVertical className="w-5 h-5 cursor-pointer" onClick={() => setMenuOpen(!menuOpen)} />
            
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-[80] bg-black/20 dark:bg-black/40 backdrop-blur-[0.5px]" onClick={() => setMenuOpen(false)} />
                <div className="absolute top-10 right-0 bg-[#fcfcfc] dark:bg-[#111b21] border border-gray-200 dark:border-[#2f3b43] text-gray-800 dark:text-[#e9edef] rounded-2xl shadow-2xl p-2 w-72 sm:w-80 z-[90]">
                  <div className="pb-1.5 mb-1.5 border-b border-gray-200 dark:border-[#2f3b43]/60">
                    <div className="px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-[#202c33] rounded-xl cursor-pointer flex items-center gap-2.5 text-xs font-semibold text-gray-700 dark:text-gray-200" onClick={() => { startNewChat(); setMenuOpen(false); }}>
                      <Plus size={16} className="text-[#00FF88]" />
                      <span>New Chat</span>
                    </div>
                    <div className="px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-[#202c33] rounded-xl cursor-pointer flex items-center gap-2.5 text-xs font-semibold text-gray-700 dark:text-gray-200" onClick={() => { toggleTheme(); setMenuOpen(false); }}>
                      {theme === 'dark' ? <Sun size={16} className="text-amber-400" /> : <Moon size={16} className="text-indigo-500" />} 
                      <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
                    </div>
                    <div
                      className="px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-[#202c33] rounded-xl cursor-pointer flex items-center justify-between gap-2.5 text-xs font-semibold text-gray-700 dark:text-gray-200"
                      onClick={() => { setNativeAgentStatus(getNativeAgentStatus()); setMenuOpen(false); setShowAgentModal(true); }}
                    >
                      <div className="flex items-center gap-2.5">
                        <Bot size={16} className="text-[#00a884]" />
                        <span>Kevin Permission</span>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        waAutoReplyState.paused
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          : agentPermissions.autoSend || waAutoReplyState.active
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : 'text-gray-400 dark:text-gray-500'
                      }`}>
                        {waAutoReplyState.paused
                          ? 'PAUSED'
                          : agentPermissions.autoSend || waAutoReplyState.active
                            ? 'ACTIVE'
                            : 'SETUP'}
                      </span>
                    </div>
                    {agentPermissions.whatsappAutoReply && (
                      <div className="mx-1 my-1 px-2.5 py-2 rounded-xl bg-gray-100/90 dark:bg-[#202c33] border border-gray-200 dark:border-[#2f3b43] space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
                          <span className={waAutoReplyState.paused ? 'text-amber-600 dark:text-amber-400' : 'text-[#075E54] dark:text-[#00FF88]'}>
                            {waAutoReplyState.paused
                              ? `⏸️ WA Auto-Reply yahagaritswe (${formatRemainingPauseDuration(waAutoReplyState.remainingMs)})`
                              : '💬 WA Auto-Reply irakora'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {waAutoReplyState.paused ? (
                            <button
                              type="button"
                              onClick={() => { resumeWhatsAppAutoReplyNow(); setMenuOpen(false); }}
                              className="flex-1 py-1 px-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-[10px] font-bold flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <Play size={10} /> Subukura
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => { pauseWhatsAppAutoReplyForMinutes(30); setMenuOpen(false); }}
                                className="flex-1 py-1 px-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 text-[10px] font-bold cursor-pointer"
                              >
                                ⏸️ 30m
                              </button>
                              <button
                                type="button"
                                onClick={() => { pauseWhatsAppAutoReplyForMinutes(60); setMenuOpen(false); }}
                                className="flex-1 py-1 px-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 text-[10px] font-bold cursor-pointer"
                              >
                                ⏸️ 1h
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => { stopWhatsAppAutoReplyCompletely(); setMenuOpen(false); }}
                            className="flex-1 py-1 px-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-600 dark:text-red-400 text-[10px] font-bold cursor-pointer"
                          >
                            ⏹️ Funga
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-[#202c33] rounded-xl cursor-pointer flex items-center gap-2.5 text-xs font-semibold text-gray-700 dark:text-gray-200" onClick={() => { setShowAbout(true); setMenuOpen(false); }}>
                      <Info size={16} className="text-blue-400" />
                      <span>About Kevin AI</span>
                    </div>
                  </div>

                  {/* AI Model Selector Section inside 3-dots Menu */}
                  <div className="px-3 py-1 text-[10px] font-bold text-gray-400 dark:text-gray-400 uppercase tracking-wider flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Sparkles size={12} className="text-[#00FF88]" />
                      <span>Hitamo AI Model</span>
                    </div>
                    <span className="text-[9px] text-[#00a884] dark:text-[#00FF88] font-mono font-bold">{selectedModel}</span>
                  </div>

                  <div className="space-y-1 mt-1">
                    {[
                      {
                        id: 'Kevin pro' as const,
                        title: 'Kevin pro',
                        desc: 'Fast answers',
                        badge: 'Default',
                        badgeStyle: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
                      },
                      {
                        id: 'Prodix pro' as const,
                        title: 'Prodix pro',
                        desc: 'Gukora research na analysis',
                        badge: 'Pro',
                        badgeStyle: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30',
                      },
                      {
                        id: 'Kevin 1.3 Lite' as const,
                        title: 'Kevin 1.3 Lite',
                        desc: 'Ultra fast answers',
                        badge: 'Lite',
                        badgeStyle: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
                      },
                    ].map((model) => {
                      const isSelected = selectedModel === model.id;
                      return (
                        <div
                          key={model.id}
                          onClick={() => {
                            setSelectedModel(model.id);
                            if (typeof window !== 'undefined') {
                              localStorage.setItem('kevin_ai_selected_model', model.id);
                            }
                            setMenuOpen(false);
                            showToastMessage(`✨ Model yahindutse: ${model.title}`);
                          }}
                          className={`p-2 rounded-xl flex items-center justify-between cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-[#00a884]/20 border border-[#00a884]/50'
                              : 'hover:bg-gray-100 dark:hover:bg-[#202c33] border border-transparent'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 pr-1">
                            <div className="w-4 h-4 flex items-center justify-center shrink-0">
                              {isSelected && <Check size={15} className="text-[#00a884] dark:text-[#00FF88]" />}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-xs text-gray-900 dark:text-white truncate">{model.title}</span>
                                <span className={`text-[8px] font-bold px-1.5 py-0.2 rounded-full border ${model.badgeStyle}`}>
                                  {model.badge}
                                </span>
                              </div>
                              <p className="text-[10px] text-gray-500 dark:text-[#8696a0] mt-0.5 leading-tight">{model.desc}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="absolute inset-0 z-50 bg-black/60 backdrop-blur-xs" 
            onClick={() => setDrawerOpen(false)}
          >
            <motion.div 
              initial={{ x: -320 }} 
              animate={{ x: 0 }} 
              exit={{ x: -320 }} 
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="w-80 max-w-[85vw] h-full bg-[#fbfbfb] dark:bg-[#181818] p-3.5 flex flex-col border-r border-gray-200 dark:border-[#282828] shadow-2xl" 
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-3 mb-2 border-b border-gray-200 dark:border-[#282828]">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#075E54] to-[#128C7E] flex items-center justify-center font-bold text-sm text-white shadow-sm">
                    K
                  </div>
                  <div>
                    <span className="font-bold text-sm text-gray-800 dark:text-[#e9edef] block leading-tight">Kevin AI</span>
                    <span className="text-[11px] text-gray-500 dark:text-[#8696a0]">Chat History</span>
                  </div>
                </div>
                <button 
                  onClick={() => setDrawerOpen(false)} 
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#252525] transition-colors"
                  aria-label="Close menu"
                >
                  <X size={18} />
                </button>
              </div>

              {/* New Chat Button */}
              <button 
                onClick={startNewChat} 
                className="w-full bg-gradient-to-r from-[#075E54] to-[#128C7E] hover:from-[#086a5f] hover:to-[#169d8d] dark:from-[#00a884] dark:to-[#008f6f] text-white p-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 shadow-sm transition-all mb-3 text-sm group cursor-pointer"
              >
                <Plus size={18} className="group-hover:rotate-90 transition-transform duration-200" /> 
                <span>New Chat</span>
              </button>

              {/* Search Past Chats */}
              <div className="relative mb-3">
                <Search size={15} className="absolute left-3 top-2.5 text-gray-400 dark:text-[#8696a0]" />
                <input
                  type="text"
                  value={chatSearchQuery}
                  onChange={(e) => setChatSearchQuery(e.target.value)}
                  placeholder="Search conversations..."
                  className="w-full bg-gray-100 dark:bg-[#222222] text-gray-800 dark:text-[#e9edef] pl-8.5 pr-8 py-2 rounded-xl text-xs border border-transparent focus:border-[#075E54] dark:focus:border-[#00a884] focus:outline-none transition-all placeholder-gray-400 dark:placeholder-[#8696a0]"
                />
                {chatSearchQuery && (
                  <button 
                    onClick={() => setChatSearchQuery('')} 
                    className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Chat History List (Chronologically Grouped like ChatGPT) */}
              <div className="flex-1 overflow-y-auto pr-1 space-y-4 scrollbar-thin">
                {(() => {
                  const { groups, totalFiltered } = getGroupedSessions();
                  if (totalFiltered === 0) {
                    return (
                      <div className="py-12 text-center px-4">
                        <History size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Nta kiganiro kigaragara</p>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Nta kiganiro gihuye n'ibyo ushatse.</p>
                        {chatSearchQuery && (
                          <button 
                            onClick={() => setChatSearchQuery('')} 
                            className="mt-3 text-xs text-[#075E54] dark:text-[#00a884] font-medium hover:underline cursor-pointer"
                          >
                            Kura ibyo ushatsemo
                          </button>
                        )}
                      </div>
                    );
                  }

                  return groups.map((group, gIdx) => (
                    <div key={gIdx} className="space-y-1">
                      <div className="flex items-center justify-between px-2 py-1">
                        <h4 className="text-[10px] font-bold text-gray-400 dark:text-[#8696a0] tracking-wider uppercase">
                          {group.label}
                        </h4>
                        <span className="text-[10px] text-gray-400 dark:text-[#8696a0] font-mono">
                          {group.items.length}
                        </span>
                      </div>

                      <div className="space-y-1">
                        {group.items.map(s => {
                          const isActive = currentSessionId === s.id;
                          const isEditing = editingSessionId === s.id;

                          return (
                            <div 
                              key={s.id} 
                              className={`group relative flex items-center justify-between px-2.5 py-2 rounded-xl cursor-pointer transition-all duration-150 ${
                                isActive 
                                  ? 'bg-[#E1FFC7]/80 dark:bg-[#005c4b]/40 border border-[#25D366]/40 dark:border-[#00a884]/40 shadow-xs' 
                                  : 'hover:bg-gray-100 dark:hover:bg-[#222222] border border-transparent'
                              }`} 
                              onClick={() => { 
                                if (!isEditing) {
                                  setCurrentSessionId(s.id); 
                                  setMessages(s.messages); 
                                  setDrawerOpen(false); 
                                }
                              }}
                            >
                              <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                                <MessageSquare 
                                  size={15} 
                                  className={`shrink-0 ${
                                    isActive 
                                      ? 'text-[#075E54] dark:text-[#00FF88]' 
                                      : 'text-gray-400 dark:text-[#8696a0] group-hover:text-gray-600 dark:group-hover:text-gray-300'
                                  }`} 
                                />

                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={editingTitle}
                                    onChange={(e) => setEditingTitle(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        renameSession(s.id, editingTitle);
                                        setEditingSessionId(null);
                                      } else if (e.key === 'Escape') {
                                        setEditingSessionId(null);
                                      }
                                    }}
                                    onBlur={() => {
                                      renameSession(s.id, editingTitle);
                                      setEditingSessionId(null);
                                    }}
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full text-xs bg-white dark:bg-[#111b21] px-1.5 py-0.5 rounded border border-[#075E54] dark:border-[#00a884] focus:outline-none text-gray-900 dark:text-white"
                                  />
                                ) : (
                                  <span className={`truncate text-xs ${
                                    isActive 
                                      ? 'text-[#075E54] dark:text-[#e9edef] font-semibold' 
                                      : 'text-gray-700 dark:text-[#8696a0] group-hover:text-gray-900 dark:group-hover:text-gray-200'
                                  }`}>
                                    {s.title || "Chat"}
                                  </span>
                                )}
                              </div>

                              {/* Action Buttons (Always visible) */}
                              {!isEditing && (
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    title="Rename chat"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingSessionId(s.id);
                                      setEditingTitle(s.title);
                                    }}
                                    className="p-1.5 text-gray-400 hover:text-[#075E54] dark:hover:text-[#00FF88] rounded-lg hover:bg-gray-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
                                  >
                                    <Pencil size={13} />
                                  </button>

                                  <button
                                    title="Delete chat"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSessionToDelete(s.id);
                                    }}
                                    className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()}
              </div>

              {/* Bottom Quick Tools & Profile */}
              <div className="pt-3 mt-auto border-t border-gray-200 dark:border-[#282828] space-y-1.5">
                <div 
                  onClick={() => setShowClearConfirm(true)}
                  className="flex items-center justify-between p-2 rounded-xl text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Trash2 size={15} />
                    <span>Clear All Chats</span>
                  </div>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">{sessions.length} chats</span>
                </div>

                <div 
                  onClick={() => { setShowSettingsModal(true); setDrawerOpen(false); }}
                  className="flex items-center justify-between p-2 rounded-xl text-xs font-medium text-gray-700 dark:text-[#8696a0] hover:text-[#075E54] dark:hover:text-[#00FF88] hover:bg-gray-100 dark:hover:bg-[#222222] cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Settings size={15} className="text-[#00a884]" />
                    <span>Settings</span>
                  </div>
                  <ChevronRight size={14} className="text-gray-400 dark:text-gray-500" />
                </div>

                <div 
                  onClick={() => { setShowAbout(true); setDrawerOpen(false); }}
                  className="flex items-center justify-between p-2 rounded-xl text-xs font-medium text-gray-700 dark:text-[#8696a0] hover:text-[#075E54] dark:hover:text-[#00FF88] hover:bg-gray-100 dark:hover:bg-[#222222] cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Info size={15} />
                    <span>Ibyerekeye Kevin AI</span>
                  </div>
                  <span className="text-[10px] font-bold text-amber-600">Amakuru</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Single Chat Delete Confirmation Modal */}
      <AnimatePresence>
        {sessionToDelete !== null && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.9, opacity: 0 }} 
              className="bg-white dark:bg-[#1e2428] rounded-2xl p-5 max-w-sm w-full shadow-2xl border border-gray-200 dark:border-[#2f3b43]"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950/50 flex items-center justify-center text-red-600 dark:text-red-400">
                  <Trash2 size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-gray-900 dark:text-white">Delete conversation?</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">This will permanently remove this chat.</p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 mt-5">
                <button 
                  onClick={() => setSessionToDelete(null)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => deleteSession(sessionToDelete)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-sm transition-colors cursor-pointer"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Clear All Chats Confirmation Modal */}
      <AnimatePresence>
        {showClearConfirm && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.9, opacity: 0 }} 
              className="bg-white dark:bg-[#1e2428] rounded-2xl p-5 max-w-sm w-full shadow-2xl border border-gray-200 dark:border-[#2f3b43]"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950/50 flex items-center justify-center text-red-600 dark:text-red-400">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-gray-900 dark:text-white">Clear all conversations?</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">All saved conversations and history will be cleared.</p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 mt-5">
                <button 
                  onClick={() => setShowClearConfirm(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  onClick={clearAllSessions}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-sm transition-colors cursor-pointer"
                >
                  Clear All
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Chat Area */}
      <main ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 relative">
        {(messages.length === 0 || (messages.length === 1 && messages[0].sender === 'kevin' && messages[0].text.includes("Hello! I'm Kevin AI"))) ? (
          <div className="flex flex-col items-center justify-center min-h-[80%] text-center py-10 px-4">
            <div className="mb-6 animate-float">
              <div className="relative w-32 h-32 flex items-center justify-center shadow-xl shadow-emerald-500/20 ring-4 ring-emerald-500/20 rounded-full p-4 bg-emerald-500/10 backdrop-blur-sm">
                <span className="text-6xl">😊</span>
                <span className="text-5xl absolute -top-1 -right-2 animate-wave">👋</span>
              </div>
            </div>
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            >
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-black mb-4 text-gray-900 dark:text-white tracking-tight">
                Happy {new Date().toLocaleDateString('en-US', { weekday: 'long' })} {userName || localStorage.getItem('kevin_user_name') || localStorage.getItem('kevin_ai_user_name') || 'Kevin'}!
              </h1>
            </motion.div>
            <p className="text-gray-600 dark:text-[#8696a0] mb-10 max-w-md leading-relaxed" dangerouslySetInnerHTML={{ __html: "<span class='text-amber-600 dark:text-amber-500 font-bold'>Uwumukiza Kevin</span> ni we wandemye. Ubu ushobora kumbaza ikibazo icyo ari cyose, niteguye guhita nkugufasha?" }}></p>
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 w-full max-w-md mx-auto">
              {[
                { q: "Kevin ni muntu ki?", s: "Menya Kevin" },
                { q: "Nkorera ifoto y'umusozi mwiza mu Rwanda", s: "🎨 Kora Ifoto (AI Image)" },
                { q: "Nyereka ifoto y'uwakuremye (Kevin)", s: "📸 Ifoto y'Uwakuremye" },
                { q: "Yize ayahe mashuri?", s: "Amashuri yize" },
              ].map((card, i) => (
                <div key={i} className="bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#222e35] p-2.5 sm:p-3 rounded-2xl cursor-pointer hover:shadow-md hover:border-[#25D366] dark:hover:border-[#00a884] transition-all text-left group flex flex-col justify-center" onClick={() => { setInput(card.q); handleSendMessage(card.q); }}>
                  <p className="text-xs sm:text-sm font-semibold text-gray-800 dark:text-[#e9edef] group-hover:text-[#075E54] dark:group-hover:text-[#00FF88] transition-colors">{card.q}</p>
                  <p className="text-[10px] sm:text-xs text-gray-500 dark:text-[#8696a0] mt-1">{card.s}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <AnimatePresence>
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[88%] sm:max-w-[82%] p-3.5 sm:p-4 rounded-2xl shadow-xs ${
                      message.sender === 'user'
                        ? 'bg-[#DCF8C6] dark:bg-[#005c4b] rounded-tr-none text-gray-900 dark:text-[#e9edef]'
                        : 'bg-white dark:bg-[#202c33] rounded-tl-none text-gray-900 dark:text-[#e9edef]'
                    }`}
                  >
                    {message.image && (!message.text || !message.text.includes(message.image)) && (
                      <div className="relative group mb-2.5 rounded-xl overflow-hidden bg-black/5 dark:bg-black/30 border border-black/10 dark:border-white/10">
                        <img 
                          src={message.image} 
                          className="w-full rounded-xl max-h-96 object-cover cursor-pointer hover:opacity-95 transition-opacity" 
                          alt="AI generated visual" 
                          onClick={() => setPreviewImage(message.image!)}
                        />
                        {message.sender === 'kevin' && (
                          <div className="absolute bottom-2.5 right-2.5 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-sm text-xs font-semibold flex items-center gap-1.5 shadow-md border border-white/20 select-none pointer-events-none z-20">
                            <span className="text-white">Kevin</span>
                            <span className="text-[#FF6B00] font-bold">AI</span>
                          </div>
                        )}
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadImage(message.image!, `kevin_ai_${Date.now()}.jpg`, () => {
                              showToastMessage("✨ Ifoto yabitswe ifite watermark ya Kevin AI!");
                            });
                          }}
                          className="absolute top-2 right-2 px-3 py-1.5 rounded-full bg-black/80 hover:bg-black text-white shadow-md backdrop-blur-xs transition-all hover:scale-105 cursor-pointer flex items-center gap-1.5 text-xs font-medium border border-white/10 z-20"
                          title="Download Image"
                        >
                          <Download size={13} className="text-[#FF6B00]" />
                          <span className="text-[11px] font-semibold">Bika ifoto</span>
                        </button>
                      </div>
                    )}
                    {message.document && (
                      <div className="my-2.5 p-3 bg-[#F0F2F5] dark:bg-[#2a3942] rounded-xl border border-gray-200 dark:border-[#222e35] flex items-center gap-3">
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold text-white text-base ${message.document.type === 'pdf' ? 'bg-red-500' : 'bg-blue-600'}`}>
                          {message.document.type === 'pdf' ? '📄' : '📝'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-800 dark:text-[#e9edef] truncate">{message.document.name}</p>
                          <p className="text-xs text-gray-500 dark:text-[#8696a0] uppercase">{message.document.type} • {message.document.size}</p>
                        </div>
                        <button 
                          onClick={async (e) => {
                            e.stopPropagation();
                            const doc = message.document!;
                            const res = await downloadDocumentFile(doc.url || '', doc.name, doc.content, doc.title, doc.format);
                            if (res.success) {
                              showToastMessage(`✨ Inyandiko "${doc.name}" yabitswe muri Downloads!`);
                            } else {
                              showToastMessage(`⚠️ Byanze kubika inyandiko.`);
                            }
                          }}
                          className="w-9 h-9 rounded-full bg-[#075E54] hover:bg-[#128C7E] dark:bg-[#00a884] dark:hover:bg-[#008f6f] text-white flex items-center justify-center shadow-sm cursor-pointer shrink-0"
                          title="Download Document"
                        >
                          <Download size={16} />
                        </button>
                      </div>
                    )}
                    {message.audioUrl && (
                      <div className="mb-2.5 flex items-center gap-2 rounded-xl bg-black/5 dark:bg-black/25 p-2 border border-black/10 dark:border-white/10">
                        <Volume2 size={16} className="text-[#075E54] dark:text-[#00FF88] shrink-0" />
                        <audio controls src={message.audioUrl} className="h-8 w-full max-w-[240px]" />
                      </div>
                    )}
                    {message.action && (
                      <div className="my-2.5 rounded-xl border border-[#25D366]/30 bg-[#f0fdf4] dark:bg-[#182229] p-3 space-y-2.5">
                        {message.action.name === 'open_youtube' && message.action.embedUrl && agentPermissions.autoPlayYouTube && (
                          <div className="rounded-xl overflow-hidden bg-black aspect-video w-full shadow-md border border-black/20">
                            <iframe
                              src={message.action.embedUrl}
                              title={message.action.videoTitle || message.action.label}
                              className="w-full h-full"
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowFullScreen
                            />
                          </div>
                        )}
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-[#075E54] text-white flex items-center justify-center text-lg shrink-0">
                            {message.action.name === 'open_youtube' || message.action.name === 'open_audiomack' ? '▶️' :
                              message.action.name === 'open_lark_player' || message.action.name === 'query_device_music' ? '🎵' :
                              message.action.name === 'make_call' ? '📞' :
                              message.action.name === 'send_sms' ? '📩' :
                              message.action.name === 'open_whatsapp' || message.action.name === 'configure_whatsapp_autoreply' || message.action.name === 'scan_whatsapp_chats' ? '💬' :
                              message.action.name === 'open_camera' ? '📸' : '🚀'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-gray-800 dark:text-[#e9edef] truncate">{message.action.label}</p>
                            <p className="text-xs text-gray-500 dark:text-[#8696a0] truncate">
                              {message.action.name === 'open_youtube' && message.action.channel
                                ? `${message.action.channel} • Playing Now`
                                : message.action.status === 'choose_contact'
                                  ? 'Hitamo contact imwe hasi'
                                  : message.action.status === 'contact_not_found'
                                    ? 'Contact ntirabikwa — shyiramo nimero cyangwa import'
                                    : message.action.status === 'dialed_needs_permission'
                                      ? 'Dialer yafunguwe — emera Direct Call permission'
                                      : message.action.status === 'needs_permission'
                                        ? 'Permission ikenewe kugira ngo ikore ako kanya'
                                        : message.action.status === 'executed'
                                          ? 'Byakozwe ako kanya (Full Agent)'
                                          : 'Kevin AI Device Action'}
                            </p>
                          </div>
                          {(message.action.name === 'open_lark_player' || message.action.name === 'query_device_music') && (
                            <button
                              type="button"
                              onClick={() => {
                                const act = String(message.action!.args?.action || '').toLowerCase();
                                const q = message.action!.songTitle || message.action!.args?.query || '';
                                if (act && act !== 'play' && act !== 'list_songs') {
                                  executeLarkPlayerCommand({
                                    action: act,
                                    query: q,
                                    songTitle: message.action!.songTitle,
                                    artist: message.action!.artist,
                                    playlistName: message.action!.playlistName,
                                    tab: message.action!.args?.tab,
                                  });
                                } else {
                                  playSongInLarkPlayer(q, message.action!.songTitle, message.action!.artist);
                                }
                                showToastMessage(
                                  message.action!.playlistName
                                    ? `🎵 Fungura "${message.action!.playlistName}" muri Lark Player!`
                                    : message.action!.songTitle
                                      ? `🎵 Curanga "${message.action!.songTitle}" muri Lark Player!`
                                      : '🎵 Fungura Lark Player!'
                                );
                              }}
                              className="shrink-0 rounded-full bg-[#075E54] hover:bg-[#128C7E] dark:bg-[#00a884] px-3.5 py-1.5 text-xs font-bold text-white cursor-pointer shadow-sm flex items-center gap-1.5"
                            >
                              <Play size={12} fill="currentColor" /> Lark Player
                            </button>
                          )}
                          {message.action.status === 'needs_permission' ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (message.action!.name === 'scan_whatsapp_chats') {
                                  setNativeAgentStatus(getNativeAgentStatus());
                                  setShowAgentModal(true);
                                  showToastMessage('Emera WA Notif cyangwa Accessibility muri Kevin Permission.');
                                  return;
                                }
                                if (message.action!.name === 'make_call') {
                                  updateAgentPerms({ autoCall: true });
                                } else {
                                  updateAgentPerms({ autoSend: true });
                                }
                                const updatedAction: DeviceAction = { ...message.action!, status: 'executed' };
                                runDeviceAction(updatedAction, true);
                                setMessages(prev => prev.map(m => m.id === message.id ? { ...m, action: updatedAction } : m));
                                showToastMessage(
                                  message.action!.name === 'make_call'
                                    ? '📞 Permission yemejwe! Ariko arahoza guhamagara...'
                                    : '✅ Permission yemejwe! Ubutumwa bwoherejwe ako kanya.'
                                );
                              }}
                              className="shrink-0 rounded-full bg-[#25D366] hover:bg-[#1ebe5b] px-3 py-1.5 text-xs font-bold text-white cursor-pointer shadow-sm"
                            >
                              {message.action.name === 'make_call'
                                ? 'Emerera & Hamagara'
                                : message.action.name === 'scan_whatsapp_chats'
                                  ? 'Fungura Permission'
                                  : 'Emerera & Ohereza'}
                            </button>
                          ) : message.action.status === 'dialed_needs_permission' ? (
                            <button
                              type="button"
                              onClick={() => {
                                (window as any).KevinAgentBridge?.requestAgentPermissions?.();
                                showToastMessage('Emera CALL_PHONE & READ_CONTACTS kugira ngo ubutaha ihite ihamagara.');
                              }}
                              className="shrink-0 rounded-full bg-amber-500 hover:bg-amber-600 px-3 py-1.5 text-xs font-bold text-white cursor-pointer shadow-sm"
                            >
                              Emerera Direct Call
                            </button>
                          ) : message.action.url && message.action.status !== 'choose_contact' && message.action.status !== 'contact_not_found' ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (message.action!.name === 'make_call'
                                  || (message.action!.name === 'open_youtube' && (window as any).KevinAgentBridge?.playYouTube)) {
                                  const updated = { ...message.action! };
                                  runDeviceAction(updated, true);
                                  return;
                                }
                                const target = message.action!.url || message.action!.fallbackUrl!;
                                const link = document.createElement('a');
                                link.href = target;
                                link.target = '_blank';
                                link.rel = 'noopener noreferrer';
                                document.body.appendChild(link);
                                link.click();
                                document.body.removeChild(link);
                              }}
                              className="shrink-0 rounded-full bg-[#075E54] hover:bg-[#128C7E] dark:bg-[#00a884] px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
                            >
                              {message.action.name === 'open_youtube'
                                ? 'YouTube App'
                                : message.action.name === 'make_call'
                                  ? 'Hamagara Nanone'
                                  : 'Fungura'}
                            </button>
                          ) : null}
                        </div>

                        {(message.action.name === 'open_lark_player' || message.action.name === 'query_device_music') && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            {[
                              { cmd: 'previous', label: '⏮️ Prev' },
                              { cmd: 'toggle', label: '⏯️ Play/Pause' },
                              { cmd: 'next', label: '⏭️ Next' },
                              { cmd: 'shuffle', label: '🔀 Shuffle' },
                              { cmd: 'equalizer', label: '🎚️ EQ' },
                              { cmd: 'list_playlists', label: '📋 Playlists' },
                            ].map((ctrl) => (
                              <button
                                key={ctrl.cmd}
                                type="button"
                                onClick={() => {
                                  executeLarkPlayerCommand({ action: ctrl.cmd });
                                  showToastMessage(`🎵 Lark Player: ${ctrl.label}`);
                                }}
                                className="rounded-full bg-white dark:bg-[#111b21] hover:border-[#00a884] border border-gray-200 dark:border-[#2f3b43] px-2.5 py-1 text-[11px] font-semibold text-gray-700 dark:text-[#d1d7db] cursor-pointer"
                              >
                                {ctrl.label}
                              </button>
                            ))}
                          </div>
                        )}

                        {(message.action.name === 'open_lark_player' || message.action.name === 'query_device_music') && message.action.songs && message.action.songs.length > 0 && (
                          <div className="space-y-1.5 pt-1.5">
                            <div className="flex items-center justify-between text-[11px] font-bold text-gray-600 dark:text-gray-300 px-1">
                              <span>Indirimbo zo muri telefone ({message.action.songs.length}):</span>
                              <span className="text-[#00a884]">Lark Player Ready 🎧</span>
                            </div>
                            <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                              {message.action.songs.slice(0, 20).map((song) => (
                                <div
                                  key={song.id || song.uri}
                                  className="flex items-center justify-between gap-2 rounded-lg bg-white dark:bg-[#111b21] px-3 py-2 border border-gray-200 dark:border-[#2f3b43] hover:border-[#00a884] transition-colors"
                                >
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold text-gray-800 dark:text-[#e9edef] truncate">{song.title}</p>
                                    <p className="text-[11px] text-gray-500 dark:text-[#8696a0] truncate">
                                      {song.artist || 'Unknown Artist'}{song.album ? ` • ${song.album}` : ''}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      playSongInLarkPlayer(song.uri || song.id, song.title, song.artist);
                                      showToastMessage(`🎵 Curanga "${song.title}" muri Lark Player!`);
                                    }}
                                    className="shrink-0 rounded-full bg-[#00a884] hover:bg-[#075E54] px-3 py-1 text-[11px] font-bold text-white cursor-pointer flex items-center gap-1"
                                  >
                                    <Play size={10} fill="currentColor" /> Curanga
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {message.action.status === 'choose_contact' && message.action.contactMatches && (
                          <div className="space-y-1.5 pt-1">
                            {message.action.contactMatches.map((contact) => (
                              <div
                                key={contact.id}
                                className="flex items-center justify-between gap-2 rounded-lg bg-white dark:bg-[#111b21] px-3 py-2 border border-gray-200 dark:border-[#2f3b43]"
                              >
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-gray-800 dark:text-[#e9edef] truncate">{contact.name}</p>
                                  <p className="text-[11px] text-gray-500 dark:text-[#8696a0] font-mono">{contact.phone}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => executeResolvedContactAction(message.id, message.action!, contact.name, contact.phone)}
                                  className="shrink-0 rounded-full bg-[#00a884] hover:bg-[#075E54] px-3 py-1 text-[11px] font-bold text-white cursor-pointer"
                                >
                                  {message.action!.name === 'make_call' ? '📞 Hamagara' : 'Ohereza'}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {message.action.status === 'contact_not_found' && (
                          <div className="space-y-2 rounded-lg bg-white/90 dark:bg-[#111b21]/80 p-2.5 border border-gray-200 dark:border-[#2f3b43]">
                            <div className="flex flex-col sm:flex-row gap-2">
                              <input
                                type="tel"
                                value={quickPhoneInputs[message.id] || ''}
                                onChange={(e) => setQuickPhoneInputs(prev => ({ ...prev, [message.id]: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const phoneVal = quickPhoneInputs[message.id] || '';
                                    if (isLikelyPhoneNumber(phoneVal)) {
                                      const contactLabel = message.action!.contactName || 'Contact';
                                      setSavedContacts(saveContact(contactLabel, phoneVal));
                                      executeResolvedContactAction(message.id, message.action!, contactLabel, phoneVal);
                                    }
                                  }
                                }}
                                placeholder={`Shyiramo nimero ya ${message.action.contactName || 'contact'} (ex: 0788...)`}
                                className="flex-1 bg-gray-50 dark:bg-[#202c33] text-gray-900 dark:text-[#e9edef] px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-[#2f3b43] focus:border-[#00a884] focus:outline-none text-xs"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const phoneVal = quickPhoneInputs[message.id] || '';
                                  if (!isLikelyPhoneNumber(phoneVal)) {
                                    showToastMessage('Andika nimero ya telefoni yuzuye.');
                                    return;
                                  }
                                  const contactLabel = message.action!.contactName || 'Contact';
                                  setSavedContacts(saveContact(contactLabel, phoneVal));
                                  executeResolvedContactAction(message.id, message.action!, contactLabel, phoneVal);
                                  showToastMessage(`📇 ${contactLabel} yabitswe!`);
                                }}
                                className="rounded-lg bg-[#00a884] hover:bg-[#075E54] px-3 py-1.5 text-xs font-bold text-white cursor-pointer shrink-0"
                              >
                                {message.action.name === 'make_call' ? 'Bika & Hamagara' : 'Bika & Ohereza'}
                              </button>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void handleImportContacts()}
                                className="text-[11px] font-semibold text-[#075E54] dark:text-[#00FF88] hover:underline cursor-pointer"
                              >
                                📇 Import Contacts (Phone / .vcf)
                              </button>
                              {nativeAgentStatus.isAndroid && !nativeAgentStatus.hasContactsPermission && (
                                <button
                                  type="button"
                                  onClick={() => (window as any).KevinAgentBridge?.requestAgentPermissions?.()}
                                  className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                                >
                                  🔐 Emerera Android Contacts
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        {(message.action.name === 'send_sms' || message.action.name === 'open_whatsapp') && message.action.messageText && (
                          <div className="rounded-lg bg-white/80 dark:bg-[#111b21]/70 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 border border-gray-200/70 dark:border-[#2f3b43]">
                            <span className="font-semibold">Ubutumwa:</span> "{message.action.messageText}"
                          </div>
                        )}
                      </div>
                    )}
                    <MarkdownRenderer content={message.text} />
                    {message.sources && message.sources.length > 0 && (
                      <SearchSourcesBadge sources={message.sources} />
                    )}
                    <div className="text-xs text-gray-500 dark:text-[#8696a0] flex items-center justify-end gap-2 mt-1.5 font-medium">
                      <CopyButton text={message.text} />
                      <span>{message.timestamp}</span>
                      {message.sender === 'user' && (
                        <span className={message.status === 'read' ? 'text-[#53bdeb] text-[15px] font-bold leading-none' : 'text-gray-400 dark:text-[#8696a0] text-[15px] leading-none'}>
                          ✓✓
                        </span>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
              {(isTyping || isTranscribingSTT) && (
                <motion.div key="typing-indicator" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex justify-start">
                  <div className="bg-white dark:bg-[#202c33] px-4 py-3.5 rounded-2xl shadow-xs rounded-tl-none flex gap-1.5 items-center">
                    <motion.span
                      animate={{ y: [0, -5, 0], opacity: [0.45, 1, 0.45] }}
                      transition={{ repeat: Infinity, duration: 0.9, delay: 0, ease: 'easeInOut' }}
                      className="w-2 h-2 bg-gray-500 dark:bg-[#8696a0] rounded-full"
                    />
                    <motion.span
                      animate={{ y: [0, -5, 0], opacity: [0.45, 1, 0.45] }}
                      transition={{ repeat: Infinity, duration: 0.9, delay: 0.16, ease: 'easeInOut' }}
                      className="w-2 h-2 bg-gray-500 dark:bg-[#8696a0] rounded-full"
                    />
                    <motion.span
                      animate={{ y: [0, -5, 0], opacity: [0.45, 1, 0.45] }}
                      transition={{ repeat: Infinity, duration: 0.9, delay: 0.32, ease: 'easeInOut' }}
                      className="w-2 h-2 bg-gray-500 dark:bg-[#8696a0] rounded-full"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </main>

      {/* Input Area */}
      <footer className="p-2.5 bg-[#F0F2F5] dark:bg-[#202c33] dark:border-t dark:border-[#222e35] flex flex-col gap-2 sticky bottom-0 relative">
        <input
          id="universal-file-input"
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />
        <input
          id="camera-fallback-input"
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />
        <input
          id="kevin-multi-picker"
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleGalleryFilesSelected}
        />
        <AnimatePresence>
          {toastMsg && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute -top-12 left-1/2 -translate-x-1/2 bg-gray-800 dark:bg-[#111b21] dark:border dark:border-[#222e35] text-white text-sm py-2 px-4 rounded-full shadow-lg z-50 whitespace-nowrap">
              {toastMsg}
            </motion.div>
          )}
        </AnimatePresence>
        {attachedImages.length > 0 && (
          <div className="flex gap-2 overflow-x-auto bg-white dark:bg-[#2a3942] p-2.5 rounded-xl border border-gray-200 dark:border-[#222e35] shadow-sm mx-2 mb-1">
            {attachedImages.map((attachment, index) => (
              <div key={`${attachment.name || 'image'}-${index}`} className="relative shrink-0">
                <img src={attachment.base64} className="w-16 h-16 object-cover rounded-lg" alt={`Selected image ${index + 1}`} />
                <button
                  type="button"
                  aria-label={`Remove image ${index + 1}`}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center shadow"
                  onClick={() => setAttachedImages(prev => prev.filter((_, imageIndex) => imageIndex !== index))}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {attachedImage && (
          <div className="flex items-center justify-between bg-white dark:bg-[#2a3942] p-2.5 rounded-xl border border-gray-200 dark:border-[#222e35] shadow-sm mx-2 mb-1">
            <div className="flex items-center gap-3">
              {attachedImage.mimeType?.startsWith('image/') ? (
                <img src={attachedImage.base64} className="w-11 h-11 object-cover rounded-lg" alt="preview" />
              ) : (
                <div className="w-11 h-11 bg-red-500 rounded-lg flex items-center justify-center text-white font-bold text-sm">
                  📄
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-800 dark:text-[#e9edef] truncate">{attachedImage.name || 'Attachment'}</p>
                <p className="text-xs text-gray-500 dark:text-[#8696a0]">{attachedImage.size || 'Ready'}</p>
              </div>
            </div>
            <X size={18} className="cursor-pointer text-gray-400 dark:text-[#8696a0] hover:text-red-500" onClick={() => setAttachedImage(null)} />
          </div>
        )}
        <div className="flex items-center gap-2">
          {!isRecording && (
            <>
              <div ref={emojiButtonRef} className="inline-flex items-center">
                <Smile className="w-6 h-6 text-gray-500 dark:text-[#8696a0] cursor-pointer shrink-0" onClick={() => setEmojiPickerOpen(!emojiPickerOpen)} />
              </div>
              <Paperclip className="w-6 h-6 text-gray-500 dark:text-[#8696a0] cursor-pointer shrink-0" onClick={() => setAttachmentPopupOpen(!attachmentPopupOpen)} />
            </>
          )}
          
          {isRecording ? (
            <div className="flex-1 px-3 py-2 rounded-full bg-white dark:bg-[#2a3942] text-sm sm:text-base flex items-center justify-between gap-2 shadow-inner">
              <div className="flex items-center gap-2 text-red-500 min-w-0">
                <button
                  type="button"
                  onClick={cancelRecording}
                  className="p-1 rounded-full hover:bg-red-50 dark:hover:bg-red-950/40 text-gray-500 hover:text-red-500 cursor-pointer shrink-0"
                  title="Siba amajwi"
                >
                  <X size={16} />
                </button>
                <div className="flex items-end gap-0.5 h-4 shrink-0">
                  <motion.div animate={{height: ["20%", "100%", "20%"]}} transition={{repeat: Infinity, duration: 0.8}} className="w-1 bg-red-500 rounded-t-sm"></motion.div>
                  <motion.div animate={{height: ["40%", "100%", "40%"]}} transition={{repeat: Infinity, duration: 1, delay: 0.2}} className="w-1 bg-red-500 rounded-t-sm"></motion.div>
                  <motion.div animate={{height: ["60%", "100%", "60%"]}} transition={{repeat: Infinity, duration: 0.9, delay: 0.4}} className="w-1 bg-red-500 rounded-t-sm"></motion.div>
                </div>
                <span className="font-medium animate-pulse truncate text-xs sm:text-sm">Recording...</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void transcribeRecordingToInput()}
                  className="px-2.5 py-1 rounded-full bg-[#075E54] hover:bg-[#128C7E] dark:bg-[#00a884] text-white text-[11px] font-bold cursor-pointer"
                  title="Andika amajwi"
                >
                  Text
                </button>
                <span className="text-gray-500 dark:text-[#8696a0] font-mono text-xs">
                  {Math.floor(recordingTime / 60).toString().padStart(2, '0')}:
                  {(recordingTime % 60).toString().padStart(2, '0')}
                </span>
              </div>
            </div>
          ) : (
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Type a message..."
              className="flex-1 px-4 py-2.5 rounded-full bg-white dark:bg-[#2a3942] text-[15px] sm:text-base font-bold focus:outline-none text-gray-900 dark:text-[#e9edef] placeholder:text-gray-400 dark:placeholder:text-[#8696a0] placeholder:font-normal"
            />
          )}

          {input.trim() || attachedImages.length > 0 || attachedImage ? (
            <button
              type="button"
              aria-label="Send message"
              className="pointer-events-auto z-[50] w-10 h-10 rounded-full bg-[#075E54] dark:bg-[#00a884] flex items-center justify-center cursor-pointer shadow-md transform transition-transform hover:scale-105 touch-manipulation relative"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void handleSendMessage();
              }}
            >
              <Send className="w-5 h-5 text-white ml-0.5" />
            </button>
          ) : null}
          <button
            type="button"
            aria-label={isRecording ? 'Stop listening' : 'Start listening'}
            className={`pointer-events-auto z-[50] w-10 h-10 rounded-full flex items-center justify-center cursor-pointer shadow-md transform transition-transform hover:scale-105 touch-manipulation relative ${
              isRecording ? 'bg-red-500 animate-pulse' : 'bg-[#075E54] dark:bg-[#00a884]'
            }`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void toggleRecording();
            }}
          >
            <Mic className="w-5 h-5 text-white" />
          </button>
        </div>
        {emojiPickerOpen && (
          <div ref={emojiPickerRef} className="absolute bottom-full left-0 mb-2 w-full max-w-sm sm:max-w-md grid grid-cols-8 gap-2 p-3 bg-white dark:bg-[#2a3942] rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 max-h-48 overflow-y-auto z-50">
            {[
              '😊', '😂', '😅', '🤣', '😍', '😭', '🙈', '❤️', '👍', '🔥', '🎉', '💡', '🤖',
              '🤘', '🙏', '😤', '✅', '☝️', '✊', '🇷🇼', '🔫', '🎂', '🤌', '🏃', '🤟', '👏',
              '❌', '🤝', '👈', '⚽', '👑', '🖕', '🙋', '❗', '‼️', '💋', '🥂', '😲', '🍡'
            ].map(emoji => (
              <span 
                key={emoji} 
                className="cursor-pointer text-2xl flex items-center justify-center hover:bg-gray-100 dark:hover:bg-[#374248] rounded p-1.5 transition-colors" 
                onClick={() => {
                  setInput(prev => prev + emoji);
                }}
              >
                {emoji}
              </span>
            ))}
          </div>
        )}
        {attachmentPopupOpen && (
          <div ref={attachmentPopupRef} className="absolute bottom-full left-0 right-0 p-4 bg-[#075E54] rounded-t-2xl shadow-xl border-t border-emerald-600/30 flex justify-around z-40">
            <button
              type="button"
              className="flex flex-col items-center gap-1 cursor-pointer relative z-30 touch-manipulation active:scale-95"
              onClick={(event) => {
                event.stopPropagation();
                void handleTakePhoto();
              }}
            >
              <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center">
                <CameraIcon className="w-5 h-5 text-[#075E54]" />
              </div>
              <span className="text-white font-medium text-[10px]">Fata Ifoto</span>
            </button>
            <div className="flex flex-col items-center gap-1 cursor-pointer" onClick={handleGalleryClick}>
              <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center">
                <ImageIcon className="w-5 h-5 text-[#075E54]" />
              </div>
              <span className="text-white font-medium text-[10px]">Select Images</span>
            </div>
            <label className="flex flex-col items-center gap-1 cursor-pointer">
              <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center">
                <FileText className="w-5 h-5 text-[#075E54]" />
              </div>
              <span className="text-white font-medium text-[10px]">Docs/Audio</span>
              <input type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.csv,.md,.json,.ts,.js,.py,.html,.css,.mp3,.wav,.m4a,.ogg,.webm,.aac,audio/*" className="hidden" onChange={async (e) => { 
                const f = e.target.files?.[0]; 
                if(f) { 
                  const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
                  const isAudio = f.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|webm|aac)$/i.test(f.name);
                  if (isAudio) {
                    setAttachmentPopupOpen(false);
                    setIsTranscribingSTT(true);
                    try {
                      const audioBase64 = await blobToBase64(f);
                      const mimeType = f.type || 'audio/mpeg';
                      const transcript = await transcribeAudioWithSTT(audioBase64, mimeType);
                      const audioUrl = URL.createObjectURL(f);
                      void handleSendMessage(transcript || `🎤 ${f.name}`, f, audioBase64, mimeType, audioUrl);
                    } catch (err) {
                      showToastMessage(err instanceof Error ? err.message : 'Byanze gusoma amajwi (STT).');
                    } finally {
                      setIsTranscribingSTT(false);
                    }
                    return;
                  }
                  if (isPdf) {
                    const reader = new FileReader(); 
                    reader.onload = () => setAttachedImage({ 
                      base64: reader.result as string, 
                      mimeType: 'application/pdf', 
                      name: f.name, 
                      size: `${Math.round(f.size / 1024)} KB` 
                    });
                    reader.readAsDataURL(f);
                  } else {
                    const text = await extractTextFromFile(f);
                    const reader = new FileReader(); 
                    reader.onload = () => setAttachedImage({ 
                      base64: reader.result as string, 
                      mimeType: f.type || 'text/plain', 
                      name: f.name, 
                      size: `${Math.round(f.size / 1024)} KB`,
                      textContent: text
                    });
                    reader.readAsDataURL(f);
                  }
                  setAttachmentPopupOpen(false); 
                } 
              }}/>
            </label>
            <div 
              className="flex flex-col items-center gap-1 cursor-pointer group" 
              onClick={() => {
                setAttachmentPopupOpen(false);
                setInput("Nkorera ifoto ya ");
              }}
            >
              <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-400 to-rose-500 flex items-center justify-center shadow-md group-hover:scale-105 transition-transform">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <span className="text-white font-medium text-[10px]">Kora Ifoto</span>
            </div>
          </div>
        )}
      </footer>
      {/* About Modal */}
      {showAbout && (
        <div className="absolute inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowAbout(false)}>
          <div className="bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#313d45] shadow-2xl rounded-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3">Ibyerekeye Kevin AI</h2>
            <p className="text-gray-700 dark:text-[#d1d7db] leading-relaxed mb-6 text-sm">
              Kevin AI ni umufasha wawe w'ubwenge buhangano (AI), yakozwe na <strong className="text-[#00FF88] font-bold">Uwumukiza Kevin</strong> wizera ko <strong className="text-amber-400 font-bold">UKORA GAKE BIKAGENDA CYANE</strong>.
            </p>
            <button onClick={() => setShowAbout(false)} className="bg-[#00a884] hover:bg-[#075E54] text-white font-semibold py-2.5 px-4 rounded-xl w-full transition-colors shadow-md">Funga</button>
          </div>
        </div>
      )}

      {/* User Profile Modal */}
      <AnimatePresence>
        {showProfileModal && (
          <div 
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4" 
            onClick={() => {
              if (userName.trim()) {
                setShowProfileModal(false);
              } else {
                showToastMessage("⚠️ Nyamuneka shyiramo izina ryawe kugira ngo ukomeze!");
              }
            }}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.9, opacity: 0 }} 
              className="bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#313d45] shadow-2xl rounded-2xl p-6 w-full max-w-md" 
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-bold">
                    <User size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-gray-900 dark:text-white">Witwa nde? (Your Name)</h3>
                    <p className="text-xs text-gray-500 dark:text-[#8696a0]">Bwira Kevin AI izina ryawe kugira ngo akwiture neza</p>
                  </div>
                </div>
                {userName.trim() ? (
                  <button 
                    onClick={() => setShowProfileModal(false)}
                    className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    <X size={18} />
                  </button>
                ) : null}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                    Izina ryawe (Name / Nickname):
                  </label>
                  <input 
                    type="text"
                    value={tempUserName}
                    onChange={(e) => setTempUserName(e.target.value)}
                    placeholder="Urugero: Kevin, Alice, Jean..."
                    required
                    className="w-full bg-gray-50 dark:bg-[#111b21] text-gray-900 dark:text-[#e9edef] px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-[#2f3b43] focus:border-[#00a884] focus:outline-none text-sm transition-all placeholder:text-gray-400 dark:placeholder:text-gray-500"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSaveUserName();
                      }
                    }}
                    autoFocus
                  />
                </div>

                <div className="pt-2 border-t border-gray-100 dark:border-[#282828]">
                  <button 
                    onClick={handleSaveUserName}
                    disabled={!tempUserName.trim()}
                    className={`w-full py-2.5 rounded-xl text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-1.5 ${
                      tempUserName.trim()
                        ? 'bg-[#00a884] hover:bg-[#075E54] text-white cursor-pointer hover:scale-[1.01]'
                        : 'bg-gray-200 dark:bg-[#2a3942] text-gray-400 dark:text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    <Check size={14} />
                    <span>Bika Izina</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Instructions Modal */}
      <AnimatePresence>
        {showCustomInstructionsModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4" onClick={() => setShowCustomInstructionsModal(false)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.9, opacity: 0 }} 
              className="bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#313d45] shadow-2xl rounded-2xl p-6 w-full max-w-lg" 
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center font-bold">
                    <Sparkles size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-gray-900 dark:text-white">Custom Instructions</h3>
                    <p className="text-xs text-gray-500 dark:text-[#8696a0]">Bwira Kevin AI uko ushaka ko yitwara cyangwa akitaba</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowCustomInstructionsModal(false)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                    Amabwiriza yawe (Custom Instructions):
                  </label>
                  <textarea 
                    value={tempCustomInstructions}
                    onChange={(e) => setTempCustomInstructions(e.target.value)}
                    placeholder="Urugero: Always reply in friendly Kinyarwanda with examples, be concise, etc..."
                    rows={5}
                    className="w-full bg-gray-50 dark:bg-[#111b21] text-gray-900 dark:text-[#e9edef] px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-[#2f3b43] focus:border-[#00a884] focus:outline-none text-sm transition-all placeholder:text-gray-400 dark:placeholder:text-gray-500 resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100 dark:border-[#282828]">
                  <button 
                    onClick={() => setShowCustomInstructionsModal(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    Reka
                  </button>
                  <button 
                    onClick={handleSaveCustomInstructions}
                    className="px-5 py-2 rounded-xl text-xs font-bold bg-[#00a884] hover:bg-[#075E54] text-white shadow-sm transition-colors flex items-center gap-1.5"
                  >
                    <Check size={14} />
                    <span>Bika Amabwiriza</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Settings Hub Modal */}
      <AnimatePresence>
        {showSettingsModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4" onClick={() => setShowSettingsModal(false)}>
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#313d45] shadow-2xl rounded-2xl p-5 sm:p-6 w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#00a884]/15 text-[#00a884] flex items-center justify-center">
                    <Settings size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-gray-900 dark:text-white">Settings</h3>
                    <p className="text-xs text-gray-500 dark:text-[#8696a0]">Igenamiterere rya Kevin AI</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(false)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-1.5">
                <div
                  onClick={() => { setTempUserName(userName); setShowSettingsModal(false); setShowProfileModal(true); }}
                  className="flex items-center justify-between p-2.5 rounded-xl text-xs font-medium text-gray-700 dark:text-[#e9edef] hover:text-[#075E54] dark:hover:text-[#00FF88] hover:bg-gray-100 dark:hover:bg-[#111b21] cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <User size={16} className="text-emerald-500" />
                    <span>Izina ryawe (Profile)</span>
                  </div>
                  <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500 truncate max-w-[120px]">
                    {userName || 'Ntago ryashyizweho'}
                  </span>
                </div>

                <div
                  onClick={() => { setTempCustomInstructions(customInstructions); setShowSettingsModal(false); setShowCustomInstructionsModal(true); }}
                  className="flex items-center justify-between p-2.5 rounded-xl text-xs font-medium text-gray-700 dark:text-[#e9edef] hover:text-[#075E54] dark:hover:text-[#00FF88] hover:bg-gray-100 dark:hover:bg-[#111b21] cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <Settings size={16} className="text-purple-500" />
                    <span>Custom Instructions</span>
                  </div>
                  <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500 truncate max-w-[120px]">
                    {customInstructions ? 'Birakora (Active)' : 'Ntayo'}
                  </span>
                </div>

                <div
                  onClick={() => { setKeysPool(getGeminiKeysPool()); setShowSettingsModal(false); setShowApiKeyModal(true); }}
                  className="flex items-center justify-between p-2.5 rounded-xl text-xs font-medium text-gray-700 dark:text-[#e9edef] hover:text-[#075E54] dark:hover:text-[#00FF88] hover:bg-gray-100 dark:hover:bg-[#111b21] cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <Key size={16} className="text-amber-500" />
                    <span>INJIZA KEVIN API KEYS</span>
                  </div>
                  <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500">
                    {getGeminiApiKeysArray().length > 0 ? `${getGeminiApiKeysArray().length} Keys Active` : 'Default'}
                  </span>
                </div>

                <div
                  onClick={() => { setNativeAgentStatus(getNativeAgentStatus()); setShowSettingsModal(false); setShowAgentModal(true); }}
                  className="flex items-center justify-between p-2.5 rounded-xl text-xs font-medium text-gray-700 dark:text-[#e9edef] hover:text-[#075E54] dark:hover:text-[#00FF88] hover:bg-gray-100 dark:hover:bg-[#111b21] cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <Bot size={16} className="text-[#00a884]" />
                    <span>Kevin Permission</span>
                  </div>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    agentPermissions.autoSend || agentPermissions.whatsappAutoReply
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'text-gray-400 dark:text-gray-500'
                  }`}>
                    {agentPermissions.autoSend || agentPermissions.whatsappAutoReply ? 'ACTIVE' : 'SETUP'}
                  </span>
                </div>

                <div
                  onClick={() => { setShowSettingsModal(false); setShowAssistantOverlay(true); }}
                  className="flex items-center justify-between p-2.5 rounded-xl text-xs font-medium text-gray-700 dark:text-[#e9edef] hover:text-[#075E54] dark:hover:text-[#00FF88] hover:bg-gray-100 dark:hover:bg-[#111b21] cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <Sparkles size={16} className="text-[#00FF88]" />
                    <span>Assistant Box (Home)</span>
                  </div>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#00a884]/15 text-[#075E54] dark:text-[#00FF88]">
                    PREVIEW
                  </span>
                </div>

                <div
                  onClick={toggleTheme}
                  className="flex items-center justify-between p-2.5 rounded-xl text-xs font-medium text-gray-700 dark:text-[#e9edef] hover:bg-gray-100 dark:hover:bg-[#111b21] cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    {theme === 'dark' ? <Sun size={16} className="text-amber-400" /> : <Moon size={16} className="text-indigo-500" />}
                    <span>Theme</span>
                  </div>
                  <span className="text-[11px] font-semibold capitalize">{theme}</span>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Kevin AI Key Settings Modal */}
      <AnimatePresence>
        {showApiKeyModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4" onClick={() => setShowApiKeyModal(false)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.9, opacity: 0 }} 
              className="bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#313d45] shadow-2xl rounded-2xl p-6 w-full max-w-md" 
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center font-bold">
                    <Key size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-gray-900 dark:text-white">INJIZA KEVIN API KEYS</h3>
                    <p className="text-xs text-gray-500 dark:text-[#8696a0]">aha niho ushyira API KEYS zawe niba uzifite.</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowApiKeyModal(false)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-3.5 max-h-[70vh] overflow-y-auto pr-1">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    1. Primary API Key:
                  </label>
                  <input 
                    type="password"
                    value={keysPool.primary}
                    onChange={(e) => setKeysPool(prev => ({ ...prev, primary: e.target.value }))}
                    placeholder="Shyiramo Primary API Key hano..."
                    className="w-full bg-gray-50 dark:bg-[#111b21] text-gray-900 dark:text-[#e9edef] px-3.5 py-2 rounded-xl border border-gray-300 dark:border-[#2f3b43] focus:border-[#00a884] focus:outline-none text-xs font-mono tracking-wider transition-all placeholder:font-sans placeholder:tracking-normal"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    2. Backup Key 1:
                  </label>
                  <input 
                    type="password"
                    value={keysPool.backup1}
                    onChange={(e) => setKeysPool(prev => ({ ...prev, backup1: e.target.value }))}
                    placeholder="Shyiramo Backup Key 1 hano..."
                    className="w-full bg-gray-50 dark:bg-[#111b21] text-gray-900 dark:text-[#e9edef] px-3.5 py-2 rounded-xl border border-gray-300 dark:border-[#2f3b43] focus:border-[#00a884] focus:outline-none text-xs font-mono tracking-wider transition-all placeholder:font-sans placeholder:tracking-normal"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    3. Backup Key 2:
                  </label>
                  <input 
                    type="password"
                    value={keysPool.backup2}
                    onChange={(e) => setKeysPool(prev => ({ ...prev, backup2: e.target.value }))}
                    placeholder="Shyiramo Backup Key 2 hano..."
                    className="w-full bg-gray-50 dark:bg-[#111b21] text-gray-900 dark:text-[#e9edef] px-3.5 py-2 rounded-xl border border-gray-300 dark:border-[#2f3b43] focus:border-[#00a884] focus:outline-none text-xs font-mono tracking-wider transition-all placeholder:font-sans placeholder:tracking-normal"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    4. Backup Key 3:
                  </label>
                  <input 
                    type="password"
                    value={keysPool.backup3}
                    onChange={(e) => setKeysPool(prev => ({ ...prev, backup3: e.target.value }))}
                    placeholder="Shyiramo Backup Key 3 hano..."
                    className="w-full bg-gray-50 dark:bg-[#111b21] text-gray-900 dark:text-[#e9edef] px-3.5 py-2 rounded-xl border border-gray-300 dark:border-[#2f3b43] focus:border-[#00a884] focus:outline-none text-xs font-mono tracking-wider transition-all placeholder:font-sans placeholder:tracking-normal"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    5. Backup Key 4:
                  </label>
                  <input 
                    type="password"
                    value={keysPool.backup4}
                    onChange={(e) => setKeysPool(prev => ({ ...prev, backup4: e.target.value }))}
                    placeholder="Shyiramo Backup Key 4 hano..."
                    className="w-full bg-gray-50 dark:bg-[#111b21] text-gray-900 dark:text-[#e9edef] px-3.5 py-2 rounded-xl border border-gray-300 dark:border-[#2f3b43] focus:border-[#00a884] focus:outline-none text-xs font-mono tracking-wider transition-all placeholder:font-sans placeholder:tracking-normal"
                  />
                </div>

                <p className="text-[11px] text-gray-500 dark:text-[#8696a0] flex items-center justify-between">
                  <span>Keys zibikwa muri localStorage yawe gusa.</span>
                  <a 
                    href="https://aistudio.google.com/app/apikey" 
                    target="_blank" 
                    rel="noreferrer" 
                    className="text-[#075E54] dark:text-[#00FF88] hover:underline flex items-center gap-1 font-medium"
                  >
                    Fata Key Hano <ExternalLink size={10} />
                  </a>
                </p>

                {savedApiKeyStatus && (
                  <motion.div 
                    initial={{ opacity: 0, y: -5 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    className="p-2.5 rounded-xl bg-[#00a884]/15 border border-[#00a884]/40 text-[#00a884] text-xs font-semibold flex items-center gap-2"
                  >
                    <Check size={15} />
                    <span>{savedApiKeyStatus}</span>
                  </motion.div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100 dark:border-[#282828]">
                  <button 
                    onClick={() => setShowApiKeyModal(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    Reka
                  </button>
                  <button 
                    onClick={handleSaveKeysPool}
                    className="px-5 py-2 rounded-xl text-xs font-bold bg-[#00a884] hover:bg-[#075E54] text-white shadow-sm transition-colors flex items-center gap-1.5"
                  >
                    <Check size={14} />
                    <span>Bika Keys Pool</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Full Agent Permissions, WhatsApp Auto-Reply & Outbox Modal */}
      <AnimatePresence>
        {showAgentModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4" onClick={() => setShowAgentModal(false)}>
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              className="bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#313d45] shadow-2xl rounded-2xl p-5 sm:p-6 w-full max-w-lg max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#00a884]/15 text-[#00a884] flex items-center justify-center">
                    <Bot size={22} />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-gray-900 dark:text-white">Kevin Permissions</h3>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAgentModal(false)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="overflow-y-auto space-y-4 pr-1 flex-1">
                {/* Assistant Overlay Preview & Home-Button Setup */}
                <div className="p-3 rounded-xl bg-gradient-to-r from-[#075E54]/10 via-[#00a884]/10 to-[#00FF88]/10 border border-[#00a884]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#075E54] dark:text-[#00FF88] flex items-center gap-1.5">
                      <Sparkles size={14} /> Floating Assistant Box (Home Long-Press)
                    </p>
                    <p className="text-[11px] text-gray-600 dark:text-[#8696a0]">
                      Hafunguka ka box gato hasi udafunguye app yose, nko gukanda Home button cyane.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAgentModal(false);
                      setShowAssistantOverlay(true);
                    }}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-[#075E54] hover:bg-[#128C7E] dark:bg-[#00a884] text-white text-xs font-bold cursor-pointer shadow-xs"
                  >
                    ✨ Gerageza Overlay
                  </button>
                </div>

                {/* Permission Toggles */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-gray-50 dark:bg-[#111b21] border border-gray-200 dark:border-[#2a3942]">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 dark:text-[#e9edef]">▶️ YouTube Auto-Play</p>
                      <p className="text-xs text-gray-500 dark:text-[#8696a0]">
                        Iyo usabye indirimbo, ihita ikinwa ako kanya aho guhagararira muri search.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={agentPermissions.autoPlayYouTube}
                      onClick={() => updateAgentPerms({ autoPlayYouTube: !agentPermissions.autoPlayYouTube })}
                      className={`w-11 h-6 rounded-full transition-colors p-0.5 shrink-0 cursor-pointer ${
                        agentPermissions.autoPlayYouTube ? 'bg-[#00a884]' : 'bg-gray-300 dark:bg-gray-700'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${agentPermissions.autoPlayYouTube ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-gray-50 dark:bg-[#111b21] border border-gray-200 dark:border-[#2a3942]">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 dark:text-[#e9edef]">📞 Direct Auto-Call & Contacts</p>
                      <p className="text-xs text-gray-500 dark:text-[#8696a0]">
                        Iyo usabye guhamagara umuntu cyangwa nimero, ahita ahamagara ako kanya akoresheje Contacts.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={agentPermissions.autoCall}
                      onClick={() => updateAgentPerms({ autoCall: !agentPermissions.autoCall })}
                      className={`w-11 h-6 rounded-full transition-colors p-0.5 shrink-0 cursor-pointer ${
                        agentPermissions.autoCall ? 'bg-[#00a884]' : 'bg-gray-300 dark:bg-gray-700'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${agentPermissions.autoCall ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-gray-50 dark:bg-[#111b21] border border-gray-200 dark:border-[#2a3942]">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 dark:text-[#e9edef]">📩 Auto-Send Messages (SMS & WhatsApp)</p>
                      <p className="text-xs text-gray-500 dark:text-[#8696a0]">
                        Yemerera Kevin AI kohereza ubutumwa ako kanya ku nimero uyihaye nta guhagarara.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={agentPermissions.autoSend}
                      onClick={() => updateAgentPerms({ autoSend: !agentPermissions.autoSend })}
                      className={`w-11 h-6 rounded-full transition-colors p-0.5 shrink-0 cursor-pointer ${
                        agentPermissions.autoSend ? 'bg-[#00a884]' : 'bg-gray-300 dark:bg-gray-700'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${agentPermissions.autoSend ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {nativeAgentStatus.isAndroid && (
                    <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#111b21] border border-gray-200 dark:border-[#2a3942] space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-bold text-gray-900 dark:text-[#e9edef]">🎙️ &ldquo;Hi Kevin&rdquo; Voice Wake Word</p>
                            {nativeAgentStatus.wakeWordEnabled && (
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  nativeAgentStatus.wakeWordActive
                                    ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                                    : 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                                }`}
                              >
                                {nativeAgentStatus.wakeWordActive
                                  ? `Irumva (${nativeAgentStatus.wakeWordEngine || 'Active'})`
                                  : 'Ikeneye Mic'}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 dark:text-[#8696a0]">
                            Iyo uvuze &ldquo;Hi Kevin&rdquo;, Assistant AI ihita ifunguka igahita yumva icyo uyisaba.
                          </p>
                          {nativeAgentStatus.wakeWordEnabled && nativeAgentStatus.wakeWordDiag && (
                            <p className="text-[11px] font-medium text-[#075E54] dark:text-[#00a884] mt-1 truncate">
                              • {nativeAgentStatus.wakeWordDiag}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={Boolean(nativeAgentStatus.wakeWordEnabled)}
                          onClick={() => {
                            const next = !nativeAgentStatus.wakeWordEnabled;
                            (window as any).KevinAgentBridge?.setWakeWordEnabled?.(next);
                            setTimeout(() => {
                              const updatedStatus = getNativeAgentStatus();
                              setNativeAgentStatus(updatedStatus);
                              if (next && updatedStatus.hasOverlayPermission === false) {
                                showToastMessage('Emerera "Display over other apps" hasi kugira ngo Hi Kevin ifunguke muri apps zose.');
                              }
                            }, 250);
                          }}
                          className={`w-11 h-6 rounded-full transition-colors p-0.5 shrink-0 cursor-pointer ${
                            nativeAgentStatus.wakeWordEnabled ? 'bg-[#00a884]' : 'bg-gray-300 dark:bg-gray-700'
                          }`}
                        >
                          <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${nativeAgentStatus.wakeWordEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                      </div>
                      {nativeAgentStatus.wakeWordEnabled && nativeAgentStatus.hasOverlayPermission === false && (
                        <button
                          type="button"
                          onClick={() => (window as any).KevinAgentBridge?.openOverlayPermissionSettings?.()}
                          className="w-full py-1.5 px-3 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-800 dark:text-amber-200 text-[11px] font-bold text-left cursor-pointer"
                        >
                          🪟 Kanda hano wemerere &ldquo;Display over other apps&rdquo; kugira ngo Hi Kevin ihite ifunguka hejuru ya apps zose
                        </button>
                      )}
                      {nativeAgentStatus.wakeWordEnabled && nativeAgentStatus.hasNotificationPermission === false && (
                        <button
                          type="button"
                          onClick={() => (window as any).KevinAgentBridge?.requestAgentPermissions?.()}
                          className="w-full py-1.5 px-3 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-800 dark:text-amber-200 text-[11px] font-bold text-left cursor-pointer"
                        >
                          🔔 Kanda hano wemerere Notifications kugira ngo &ldquo;Hi Kevin&rdquo; igaragare mu kirahure cyo hejuru
                        </button>
                      )}
                    </div>
                  )}

                  <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#111b21] border border-gray-200 dark:border-[#2a3942] space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold text-gray-900 dark:text-[#e9edef]">💬 WhatsApp Auto-Reply Agent</p>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                            waAutoReplyState.active
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : waAutoReplyState.paused
                                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                          }`}>
                            {waAutoReplyState.active
                              ? 'Irakora'
                              : waAutoReplyState.paused
                                ? `Yahagaritswe (${formatRemainingPauseDuration(waAutoReplyState.remainingMs)})`
                                : 'Irafunze'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-[#8696a0]">
                          Kevin AI ajya areba chat za WhatsApp zose akagusubiriza ubutumwa butarasubizwa.
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={agentPermissions.whatsappAutoReply}
                        onClick={() => {
                          if (agentPermissions.whatsappAutoReply) {
                            stopWhatsAppAutoReplyCompletely();
                          } else {
                            resumeWhatsAppAutoReplyNow();
                          }
                        }}
                        className={`w-11 h-6 rounded-full transition-colors p-0.5 shrink-0 cursor-pointer ${
                          waAutoReplyState.active
                            ? 'bg-[#00a884]'
                            : waAutoReplyState.paused
                              ? 'bg-amber-500'
                              : 'bg-gray-300 dark:bg-gray-700'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${agentPermissions.whatsappAutoReply ? 'translate-x-5' : 'translate-x-0'}`} />
                      </button>
                    </div>

                    {waAutoReplyState.paused && (
                      <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-2">
                        <div className="flex items-center justify-between gap-2 text-xs font-semibold text-amber-800 dark:text-amber-200">
                          <span className="flex items-center gap-1.5">
                            <Pause size={13} />
                            Yahagaritsweho {formatRemainingPauseDuration(waAutoReplyState.remainingMs)}
                          </span>
                          <span className="text-[11px] opacity-90">
                            Izongera saa {new Date(waAutoReplyState.pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={resumeWhatsAppAutoReplyNow}
                            className="flex-1 py-1.5 px-3 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Play size={12} /> Subukura Ubu
                          </button>
                          <button
                            type="button"
                            onClick={stopWhatsAppAutoReplyCompletely}
                            className="py-1.5 px-3 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-600 dark:text-red-300 text-xs font-bold cursor-pointer"
                          >
                            Funga Burundu
                          </button>
                        </div>
                      </div>
                    )}

                    {agentPermissions.whatsappAutoReply && (
                      <div className="p-2.5 rounded-lg bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#2f3b43] space-y-2">
                        <p className="text-[11px] font-bold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                          <Clock size={12} className="text-amber-500" />
                          <span>Hagarika gusubiza mu gihe runaka (Pause Auto-Reply):</span>
                        </p>
                        <div className="grid grid-cols-3 gap-1.5">
                          {[
                            { label: '15 min', mins: 15 },
                            { label: '30 min', mins: 30 },
                            { label: '1 isaha', mins: 60 },
                            { label: '2 amasaha', mins: 120 },
                            { label: '8 amasaha', mins: 480 },
                          ].map((preset) => (
                            <button
                              key={preset.mins}
                              type="button"
                              onClick={() => pauseWhatsAppAutoReplyForMinutes(preset.mins)}
                              className="py-1.5 px-2 rounded-lg bg-amber-500/12 hover:bg-amber-500/22 border border-amber-500/30 text-amber-800 dark:text-amber-200 text-[11px] font-bold cursor-pointer transition-colors"
                            >
                              ⏸️ {preset.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={stopWhatsAppAutoReplyCompletely}
                            className="py-1.5 px-2 rounded-lg bg-red-500/12 hover:bg-red-500/22 border border-red-500/30 text-red-700 dark:text-red-300 text-[11px] font-bold cursor-pointer transition-colors"
                          >
                            ⏹️ Funga
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <input
                            type="number"
                            min={1}
                            max={1440}
                            value={customPauseMinutes}
                            onChange={(e) => setCustomPauseMinutes(e.target.value)}
                            placeholder="Ibindi (iminota, urugero 45)"
                            className="flex-1 min-w-0 bg-gray-50 dark:bg-[#111b21] text-gray-900 dark:text-[#e9edef] px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-[#2f3b43] focus:border-[#00a884] focus:outline-none text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const mins = parseInt(customPauseMinutes, 10);
                              if (!Number.isFinite(mins) || mins < 1) {
                                showToastMessage('Shyiramo umubare w\'iminota (urugero 15 cyangwa 45).');
                                return;
                              }
                              pauseWhatsAppAutoReplyForMinutes(Math.min(1440, mins));
                              setCustomPauseMinutes('');
                            }}
                            className="py-1.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shrink-0 cursor-pointer"
                          >
                            Hagarika
                          </button>
                        </div>
                      </div>
                    )}

                    {nativeAgentStatus.isAndroid && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!waAutoReplyState.active) {
                            resumeWhatsAppAutoReplyNow();
                          }
                          const raw = (window as any).KevinAgentBridge?.scanAndReplyWhatsAppChats?.();
                          try {
                            const res = JSON.parse(raw || '{}') as {
                              activeNotifQueued?: number;
                              openedWhatsAppForScan?: boolean;
                              hasNotificationAccess?: boolean;
                              hasAccessibility?: boolean;
                              whatsappInstalled?: boolean;
                            };
                            if (!res.hasNotificationAccess && !res.hasAccessibility) {
                              showToastMessage('Emera "WA Notif" cyangwa "Accessibility" hasi kugira ngo Kevin AI isubize chat za WhatsApp.');
                            } else if (res.openedWhatsAppForScan) {
                              setShowAgentModal(false);
                              showToastMessage(`💬 Kevin AI ifunguye WhatsApp ngo isubize ubutumwa budasubije!`);
                            } else {
                              showToastMessage(
                                res.activeNotifQueued && res.activeNotifQueued > 0
                                  ? `💬 Kevin AI irimo gusubiza notifications ${res.activeNotifQueued} za WhatsApp!`
                                  : '💬 Notifications za WhatsApp zarasuzumwe. Emera na Accessibility kugira ngo inarebe chat zose.'
                              );
                            }
                          } catch {
                            showToastMessage('💬 Gusuzuma WhatsApp byatangiye!');
                          }
                        }}
                        className="w-full py-2 px-3 rounded-lg bg-[#00a884]/15 hover:bg-[#00a884]/25 border border-[#00a884]/35 text-[#075E54] dark:text-[#00FF88] text-xs font-bold cursor-pointer flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <span>🔎 Reba &amp; Subiza Chat za WhatsApp zose</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* WhatsApp Auto-Reply Style */}
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#111b21] border border-gray-200 dark:border-[#2a3942] space-y-2">
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300">
                    Uburyo Kevin AI asubiza kuri WhatsApp (Reply Style):
                  </label>
                  <textarea
                    rows={2}
                    value={agentPermissions.whatsappReplyStyle}
                    onChange={(e) => updateAgentPerms({ whatsappReplyStyle: e.target.value })}
                    placeholder="Urugero: Subiza mu Kinyarwanda cyiza kandi gitonze nk'umuntu wiyubashye..."
                    className="w-full bg-white dark:bg-[#202c33] text-gray-900 dark:text-[#e9edef] px-3 py-2 rounded-lg border border-gray-300 dark:border-[#2f3b43] focus:border-[#00a884] focus:outline-none text-xs resize-none"
                  />
                </div>

                {/* Android Native Bridge Permissions */}
                {nativeAgentStatus.isAndroid && (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-[#11241f] border border-emerald-200 dark:border-emerald-900/50 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                        <ShieldCheck size={15} /> Android Native Agent Status
                      </span>
                      <button
                        type="button"
                        onClick={() => setNativeAgentStatus(getNativeAgentStatus())}
                        className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 underline cursor-pointer"
                      >
                        Refresh
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                      <div className={`px-2.5 py-1.5 rounded-lg font-semibold ${nativeAgentStatus.hasSmsPermission ? 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-200' : 'bg-amber-500/20 text-amber-800 dark:text-amber-200'}`}>
                        SMS: {nativeAgentStatus.hasSmsPermission ? 'Yemewe' : 'Ntiraboneka'}
                      </div>
                      <div className={`px-2.5 py-1.5 rounded-lg font-semibold ${nativeAgentStatus.hasCallPermission ? 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-200' : 'bg-amber-500/20 text-amber-800 dark:text-amber-200'}`}>
                        Direct Call: {nativeAgentStatus.hasCallPermission ? 'Yemewe' : 'Ntiraboneka'}
                      </div>
                      <div className={`px-2.5 py-1.5 rounded-lg font-semibold ${nativeAgentStatus.hasContactsPermission ? 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-200' : 'bg-amber-500/20 text-amber-800 dark:text-amber-200'}`}>
                        Contacts: {nativeAgentStatus.hasContactsPermission ? 'Yemewe' : 'Ntiraboneka'}
                      </div>
                      <div className={`px-2.5 py-1.5 rounded-lg font-semibold ${nativeAgentStatus.hasMusicPermission ? 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-200' : 'bg-amber-500/20 text-amber-800 dark:text-amber-200'}`}>
                        Music Access: {nativeAgentStatus.hasMusicPermission ? 'Yemewe' : 'Ntiraboneka'}
                      </div>
                      <div className={`px-2.5 py-1.5 rounded-lg font-semibold ${nativeAgentStatus.larkPlayerInstalled ? 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-200' : 'bg-blue-500/20 text-blue-800 dark:text-blue-200'}`}>
                        Lark Player: {nativeAgentStatus.larkPlayerInstalled ? 'Installed' : 'Ready'}
                      </div>
                      <button
                        type="button"
                        onClick={() => (window as any).KevinAgentBridge?.openAccessibilitySettings?.()}
                        className={`px-2.5 py-1.5 rounded-lg font-semibold text-left cursor-pointer ${nativeAgentStatus.hasAccessibility ? 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-200' : 'bg-amber-500/20 text-amber-800 dark:text-amber-200'}`}
                      >
                        Accessibility: {nativeAgentStatus.hasAccessibility ? 'Active' : 'Fungura'}
                      </button>
                      <button
                        type="button"
                        onClick={() => (window as any).KevinAgentBridge?.openNotificationListenerSettings?.()}
                        className={`px-2.5 py-1.5 rounded-lg font-semibold text-left cursor-pointer ${nativeAgentStatus.hasNotificationAccess ? 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-200' : 'bg-amber-500/20 text-amber-800 dark:text-amber-200'}`}
                      >
                        WA Notif: {nativeAgentStatus.hasNotificationAccess ? 'Active' : 'Fungura'}
                      </button>
                      <button
                        type="button"
                        onClick={() => (window as any).KevinAgentBridge?.openAssistantSettings?.()}
                        className={`px-2.5 py-1.5 rounded-lg font-semibold text-left cursor-pointer ${nativeAgentStatus.isDefaultAssistant ? 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-200' : 'bg-amber-500/20 text-amber-800 dark:text-amber-200'}`}
                      >
                        Home Assist: {nativeAgentStatus.isDefaultAssistant ? 'Active' : 'Shyiraho'}
                      </button>
                    </div>
                    {!nativeAgentStatus.hasAccessibility && (
                      <p className="text-[11px] text-amber-800 dark:text-amber-200">
                        Kanda &ldquo;Accessibility: Fungura&rdquo; wemerere &ldquo;Kevin AI Full Agent&rdquo; kugira ngo ubutumwa bwa WhatsApp buhite bukanda Send ako kanya.
                      </p>
                    )}
                    {(!nativeAgentStatus.hasSmsPermission || !nativeAgentStatus.hasCallPermission || !nativeAgentStatus.hasContactsPermission || !nativeAgentStatus.hasMicPermission || !nativeAgentStatus.hasMusicPermission) && (
                      <button
                        type="button"
                        onClick={() => (window as any).KevinAgentBridge?.requestAgentPermissions?.()}
                        className="w-full py-2 rounded-lg bg-[#00a884] hover:bg-[#075E54] text-white text-xs font-bold cursor-pointer"
                      >
                        Saba Permissions (SMS, Call, Contacts, Mic &amp; Audio Music)
                      </button>
                    )}
                  </div>
                )}

                {/* Saved Contacts Book & Import */}
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#111b21] border border-gray-200 dark:border-[#2a3942] space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-bold text-gray-800 dark:text-[#e9edef] flex items-center gap-1.5">
                      <Phone size={13} className="text-[#00a884]" /> Contacts zawe ({savedContacts.length})
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleImportContacts()}
                        className="px-2.5 py-1 rounded-lg bg-[#00a884]/15 text-[#075E54] dark:text-[#00FF88] hover:bg-[#00a884]/25 text-[11px] font-bold cursor-pointer flex items-center gap-1"
                      >
                        <Upload size={11} /> Import Phone
                      </button>
                      <button
                        type="button"
                        onClick={() => vcfInputRef.current?.click()}
                        className="px-2.5 py-1 rounded-lg bg-gray-200 dark:bg-[#2a3942] text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-[#374248] text-[11px] font-bold cursor-pointer"
                      >
                        .VCF File
                      </button>
                      <input
                        ref={vcfInputRef}
                        type="file"
                        accept=".vcf,text/vcard,text/x-vcard"
                        className="hidden"
                        onChange={(e) => void handleVcfSelected(e)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                    <input
                      type="text"
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                      placeholder="Izina (ex: Aline)"
                      className="sm:col-span-2 bg-white dark:bg-[#202c33] text-gray-900 dark:text-[#e9edef] px-3 py-1.5 rounded-lg border border-gray-300 dark:border-[#2f3b43] focus:border-[#00a884] focus:outline-none text-xs"
                    />
                    <input
                      type="tel"
                      value={newContactPhone}
                      onChange={(e) => setNewContactPhone(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddContact(); }}
                      placeholder="Nimero (0788...)"
                      className="sm:col-span-2 bg-white dark:bg-[#202c33] text-gray-900 dark:text-[#e9edef] px-3 py-1.5 rounded-lg border border-gray-300 dark:border-[#2f3b43] focus:border-[#00a884] focus:outline-none text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleAddContact}
                      className="bg-[#075E54] hover:bg-[#128C7E] dark:bg-[#00a884] text-white rounded-lg px-3 py-1.5 text-xs font-bold cursor-pointer flex items-center justify-center gap-1"
                    >
                      <UserPlus size={12} /> Bika
                    </button>
                  </div>
                  {savedContacts.length > 0 && (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {savedContacts.map((c) => (
                        <div key={c.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#2a3942] text-xs">
                          <div className="min-w-0">
                            <span className="font-bold text-gray-800 dark:text-[#e9edef]">{c.name}</span>
                            <span className="text-gray-500 dark:text-[#8696a0] ml-2 font-mono text-[11px]">{c.phone}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                runDeviceAction({
                                  name: 'make_call',
                                  args: { phone_number: c.phone, contact_name: c.name },
                                  label: `Hamagara ${c.name}`,
                                  url: `tel:${c.phone}`,
                                  fallbackUrl: `tel:${c.phone}`,
                                  phoneNumber: c.phone,
                                  contactName: c.name,
                                }, true);
                                showToastMessage(`📞 Ariko arahamagara ${c.name}...`);
                              }}
                              className="p-1.5 rounded-lg bg-[#00a884]/15 text-[#075E54] dark:text-[#00FF88] hover:bg-[#00a884]/25 cursor-pointer"
                              title={`Hamagara ${c.name}`}
                            >
                              <Phone size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setSavedContacts(deleteSavedContact(c.id))}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 cursor-pointer"
                              title="Siba"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* WhatsApp Auto-Reply Live Tester */}
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#111b21] border border-gray-200 dark:border-[#2a3942] space-y-2.5">
                  <p className="text-xs font-bold text-gray-800 dark:text-[#e9edef]">
                    🧪 Gerageza WhatsApp Auto-Reply (Live AI Reply)
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={waTestSender}
                      onChange={(e) => setWaTestSender(e.target.value)}
                      placeholder="Uwohereje (ex: Aline)"
                      className="bg-white dark:bg-[#202c33] text-gray-900 dark:text-[#e9edef] px-3 py-2 rounded-lg border border-gray-300 dark:border-[#2f3b43] focus:border-[#00a884] focus:outline-none text-xs"
                    />
                    <input
                      type="text"
                      value={waTestMessage}
                      onChange={(e) => setWaTestMessage(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleTestWhatsAppReply(); }}
                      placeholder="Ubutumwa bwinjiye kuri WhatsApp..."
                      className="sm:col-span-2 bg-white dark:bg-[#202c33] text-gray-900 dark:text-[#e9edef] px-3 py-2 rounded-lg border border-gray-300 dark:border-[#2f3b43] focus:border-[#00a884] focus:outline-none text-xs"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleTestWhatsAppReply()}
                    disabled={isTestingWaReply || !waTestMessage.trim()}
                    className={`w-full py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${
                      isTestingWaReply || !waTestMessage.trim()
                        ? 'bg-gray-200 dark:bg-[#2a3942] text-gray-400 cursor-not-allowed'
                        : 'bg-[#075E54] hover:bg-[#128C7E] dark:bg-[#00a884] text-white cursor-pointer'
                    }`}
                  >
                    <Send size={13} />
                    <span>{isTestingWaReply ? 'Ariko arategura igisubizo...' : 'Gerageza Gusubiza kuri WhatsApp'}</span>
                  </button>
                </div>

                {/* Agent Outbox / Sent Log */}
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#111b21] border border-gray-200 dark:border-[#2a3942] space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-gray-800 dark:text-[#e9edef]">
                      📤 Agent Outbox ({agentOutbox.length})
                    </p>
                    {agentOutbox.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          localStorage.removeItem('kevin_ai_agent_outbox');
                          setAgentOutbox([]);
                        }}
                        className="text-[11px] font-semibold text-red-500 hover:underline cursor-pointer flex items-center gap-1"
                      >
                        <Trash2 size={12} /> Siba Log
                      </button>
                    )}
                  </div>
                  {agentOutbox.length === 0 ? (
                    <p className="text-xs text-gray-500 dark:text-[#8696a0]">
                      Nta butumwa cyangwa call byoherejwe na Full Agent birabikwa hano.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                      {agentOutbox.map((item) => (
                        <div key={item.id} className="p-2.5 rounded-lg bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#2a3942] text-xs space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-[#075E54] dark:text-[#00FF88] uppercase text-[10px]">
                              {item.channel === 'whatsapp-autoreply'
                                ? 'WA Auto-Reply'
                                : item.channel === 'call'
                                  ? '📞 CALL'
                                  : item.channel.toUpperCase()} • {item.recipient}
                            </span>
                            <span className="text-[10px] text-gray-400">
                              {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          {item.incoming && (
                            <p className="text-[11px] text-gray-500 dark:text-[#8696a0] italic">
                              In: "{item.incoming}"
                            </p>
                          )}
                          <p className="text-gray-800 dark:text-[#e9edef]">{item.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-3 mt-3 border-t border-gray-100 dark:border-[#282828] flex justify-end shrink-0">
                <button
                  type="button"
                  onClick={() => setShowAgentModal(false)}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-[#00a884] hover:bg-[#075E54] text-white shadow-sm cursor-pointer"
                >
                  Funga
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>

        {/* Fullscreen Image Preview Lightbox */}
        {previewImage && (
          <div 
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 select-none"
            onClick={() => setPreviewImage(null)}
          >
            <div className="absolute top-4 right-4 flex items-center gap-3 z-10" onClick={(e) => e.stopPropagation()}>
              <button 
                onClick={() => {
                  downloadImage(previewImage!, `kevin_ai_${Date.now()}.jpg`, () => {
                    showToastMessage("✨ Ifoto yabitswe ifite watermark ya Kevin AI!");
                  });
                }}
                className="px-4 py-2 rounded-full bg-black/80 hover:bg-black text-white text-xs font-bold backdrop-blur-md flex items-center gap-2 transition-all cursor-pointer border border-white/20 shadow-lg"
                title="Download Image"
              >
                <Download size={15} className="text-[#FF6B00]" />
                <span>Bika ifoto</span>
              </button>
              <button 
                onClick={() => setPreviewImage(null)}
                className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-colors cursor-pointer"
                title="Funga"
              >
                <X size={20} />
              </button>
            </div>

            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.9, opacity: 0 }} 
              className="max-w-4xl max-h-[85vh] flex items-center justify-center relative group"
              onClick={(e) => e.stopPropagation()}
            >
              <img 
                src={previewImage} 
                alt="Enlarged preview" 
                className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl block"
              />
              <div className="absolute bottom-2.5 right-2.5 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-sm text-xs font-semibold flex items-center gap-1.5 shadow-md border border-white/20 select-none pointer-events-none z-20">
                <span className="text-white">Kevin</span>
                <span className="text-[#FF6B00] font-bold">AI</span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AssistantOverlay
        isOpen={showAssistantOverlay}
        selectedModel={selectedModel}
        onClose={() => setShowAssistantOverlay(false)}
        onExpandToFullApp={(prompt, reply, action) => {
          setShowAssistantOverlay(false);
          if (prompt && reply) {
            const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const newMsgs: Message[] = [
              ...messages,
              {
                id: Date.now().toString(),
                text: prompt,
                sender: 'user',
                timestamp: nowStr,
                status: 'read',
              },
              {
                id: (Date.now() + 1).toString(),
                text: reply,
                sender: 'kevin',
                timestamp: nowStr,
                status: 'read',
                action: action || undefined,
              },
            ];
            updateSessionMessages(newMsgs);
          }
        }}
      />
    </div>
  );
}
