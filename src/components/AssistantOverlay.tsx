import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, Camera, Keyboard, Send, X, Maximize2, Sparkles, Phone, Play, MessageSquare, RotateCcw, MonitorUp, Square, Globe, ChevronDown, ExternalLink } from 'lucide-react';
import kevin2Url from '../assets/kevin_2.jpg';
import MarkdownRenderer from './MarkdownRenderer';
import {
  AttachmentItem,
  DeviceAction,
  AgentPermissions,
  cleanBase64,
  getAgentPermissions,
  saveAgentPermissions,
  runDeviceAction,
  sendMessageToGemini,
  transcribeAudioWithSTT,
  saveContact,
  isLikelyPhoneNumber,
  sanitizePhoneNumber,
  formatWhatsAppPhoneNumber,
  GroundingSource,
} from '../services/geminiService';

interface AssistantOverlayProps {
  isOpen: boolean;
  isDedicatedOverlay?: boolean;
  selectedModel?: string;
  onClose: () => void;
  onExpandToFullApp?: (prompt?: string, reply?: string, action?: DeviceAction | null) => void;
}

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
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
  ].find((type) => MediaRecorder.isTypeSupported(type)) || '';

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, supportedMimeType ? { mimeType: supportedMimeType } : undefined);
  } catch (err) {
    stream.getTracks().forEach((track) => track.stop());
    try { agentBridge?.resumeWakeWord?.(); } catch { /* ignore */ }
    throw err instanceof Error ? err : new Error('This device cannot record audio.');
  }

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
    stream.getTracks().forEach((track) => track.stop());
    try { agentBridge?.resumeWakeWord?.(); } catch { /* ignore */ }
  };

  recorder.ondataavailable = (event) => {
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
    resolveStop(
      new Blob(cancelled ? [] : chunks, {
        type: recorder.mimeType || supportedMimeType || 'audio/webm',
      })
    );
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

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Could not read file.'));
    reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
    reader.readAsDataURL(blob);
  });

const blobToRawBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result.split(',')[1] : '';
      result ? resolve(result) : reject(new Error('Unable to encode recorded audio.'));
    };
    reader.onerror = () => reject(reader.error || new Error('Unable to read recorded audio.'));
    reader.readAsDataURL(blob);
  });

export default function AssistantOverlay({
  isOpen,
  isDedicatedOverlay = false,
  selectedModel = 'Kevin pro',
  onClose,
  onExpandToFullApp,
}: AssistantOverlayProps) {
  const [promptText, setPromptText] = useState('');
  const [submittedPrompt, setSubmittedPrompt] = useState('');
  const [submittedAudioUrl, setSubmittedAudioUrl] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [action, setAction] = useState<DeviceAction | null>(null);
  const [attachedImage, setAttachedImage] = useState<AttachmentItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [audioStatusNote, setAudioStatusNote] = useState<string | null>(null);
  const [quickPhone, setQuickPhone] = useState('');
  const [perms, setPerms] = useState<AgentPermissions>(() => getAgentPermissions());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLiveScreen, setIsLiveScreen] = useState(false);
  const [liveScreenFrame, setLiveScreenFrame] = useState<string | null>(null);
  const [sources, setSources] = useState<GroundingSource[]>([]);
  const [showSources, setShowSources] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const voiceRecordingRef = useRef<VoiceRecordingSession | null>(null);
  const voiceStoppingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittedAudioUrlRef = useRef<string | null>(null);
  const liveStreamRef = useRef<MediaStream | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const awaitingFirstLiveExplainRef = useRef(false);
  const liveFrameRef = useRef<string | null>(null);
  const isLiveScreenRef = useRef(false);
  const cleanFrameWaitersRef = useRef<Array<(frame: string) => void>>([]);
  const sendingLockRef = useRef(false);
  const lastWakeIdRef = useRef<number>(0);
  const wakeHandlersRef = useRef<{
    handleSend: (overrideText?: string) => Promise<void>;
    startVoiceRecording: () => Promise<void>;
  }>({
    handleSend: async () => undefined,
    startVoiceRecording: async () => undefined,
  });

  const showAudioStatus = (msg: string) => {
    setAudioStatusNote(msg);
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    statusTimeoutRef.current = setTimeout(() => setAudioStatusNote(null), 2600);
  };

  const replaceSubmittedAudioUrl = (nextUrl: string | null) => {
    if (submittedAudioUrlRef.current && submittedAudioUrlRef.current !== nextUrl) {
      URL.revokeObjectURL(submittedAudioUrlRef.current);
    }
    submittedAudioUrlRef.current = nextUrl;
    setSubmittedAudioUrl(nextUrl);
  };

  const stopLiveScreen = () => {
    awaitingFirstLiveExplainRef.current = false;
    if (liveIntervalRef.current) {
      clearInterval(liveIntervalRef.current);
      liveIntervalRef.current = null;
    }
    if (liveStreamRef.current) {
      liveStreamRef.current.getTracks().forEach((t) => t.stop());
      liveStreamRef.current = null;
    }
    if (liveVideoRef.current) {
      liveVideoRef.current.srcObject = null;
      liveVideoRef.current = null;
    }
    const nativeCapture = (window as any).KevinScreenCapture;
    if (nativeCapture?.stop && isLiveScreenRef.current) {
      try {
        nativeCapture.stop();
      } catch {
        // ignore
      }
    }
    isLiveScreenRef.current = false;
    liveFrameRef.current = null;
    cleanFrameWaitersRef.current = [];
    setLiveScreenFrame(null);
    setIsLiveScreen(false);
  };

  const resetVoiceRecordingState = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    voiceRecordingRef.current = null;
    setIsRecording(false);
    setRecordingSec(0);
  };

  const stopStreamCleanly = () => {
    if (voiceRecordingRef.current) {
      voiceRecordingRef.current.cancel();
    }
    voiceStoppingRef.current = false;
    resetVoiceRecordingState();
  };

  useEffect(() => {
    if (isOpen) {
      setPerms(getAgentPermissions());
      setTimeout(() => textareaRef.current?.focus(), 180);
    } else {
      stopStreamCleanly();
      stopLiveScreen();
    }
    return () => {
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
      stopStreamCleanly();
      stopLiveScreen();
      if (submittedAudioUrlRef.current) {
        URL.revokeObjectURL(submittedAudioUrlRef.current);
        submittedAudioUrlRef.current = null;
      }
    };
  }, [isOpen]);

  useEffect(() => {
    const onNativeFrame = (event: Event) => {
      const b64 = (event as CustomEvent<{ base64Image?: string }>).detail?.base64Image;
      if (!b64) return;
      const dataUrl = b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`;
      liveFrameRef.current = dataUrl;
      isLiveScreenRef.current = true;
      setLiveScreenFrame(dataUrl);
      setIsLiveScreen(true);
      if (cleanFrameWaitersRef.current.length > 0) {
        const waiters = cleanFrameWaitersRef.current.splice(0);
        waiters.forEach((resolve) => resolve(dataUrl));
      }
      if (awaitingFirstLiveExplainRef.current) {
        awaitingFirstLiveExplainRef.current = false;
        void explainLiveScreenNow(dataUrl);
      }
    };
    const onNativeState = (event: Event) => {
      const active = Boolean((event as CustomEvent<{ active?: boolean }>).detail?.active);
      isLiveScreenRef.current = active;
      setIsLiveScreen(active);
      if (!active) {
        liveFrameRef.current = null;
        setLiveScreenFrame(null);
      }
    };
    window.addEventListener('screenCaptured', onNativeFrame);
    window.addEventListener('screenSharingState', onNativeState);

    const processWakeWordDetail = (detail?: { id?: number; command?: string }) => {
      if (!detail) return;
      const wakeId = typeof detail.id === 'number' ? detail.id : Date.now();
      if (wakeId && lastWakeIdRef.current === wakeId) return;
      lastWakeIdRef.current = wakeId;
      try {
        delete (window as any).__kevinPendingWakeWord;
      } catch {
        (window as any).__kevinPendingWakeWord = undefined;
      }
      const cmd = (detail.command || '').trim();
      if (cmd) {
        void wakeHandlersRef.current.handleSend(cmd);
      } else {
        showAudioStatus('🎙️ Ndakumva! Mbwira icyo ushaka...');
        setTimeout(() => {
          void wakeHandlersRef.current.startVoiceRecording();
        }, 250);
      }
    };

    const onWakeWord = (event: Event) => {
      processWakeWordDetail((event as CustomEvent<{ id?: number; command?: string }>).detail);
    };
    window.addEventListener('kevinWakeWordTriggered', onWakeWord);
    const pendingWake = (window as any).__kevinPendingWakeWord;
    if (pendingWake) {
      processWakeWordDetail(pendingWake);
    }

    return () => {
      window.removeEventListener('screenCaptured', onNativeFrame);
      window.removeEventListener('screenSharingState', onNativeState);
      window.removeEventListener('kevinWakeWordTriggered', onWakeWord);
    };
  }, []);

  const handleDismiss = () => {
    stopStreamCleanly();
    stopLiveScreen();
    const overlayBridge = (window as any).KevinOverlayBridge;
    if (isDedicatedOverlay && overlayBridge?.dismissAssistant) {
      overlayBridge.dismissAssistant();
      return;
    }
    onClose();
  };

  const handleExpand = () => {
    stopStreamCleanly();
    const overlayBridge = (window as any).KevinOverlayBridge;
    if (isDedicatedOverlay && overlayBridge?.openFullApp) {
      overlayBridge.openFullApp();
      return;
    }
    onExpandToFullApp?.(submittedPrompt || promptText, replyText, action);
  };

  const requestFreshCleanFrame = (): Promise<string | null> => {
    const nativeCapture = (window as any).KevinScreenCapture;
    if (!nativeCapture?.captureCleanFrame || !isLiveScreenRef.current) {
      return Promise.resolve(liveFrameRef.current || liveScreenFrame);
    }
    return new Promise((resolve) => {
      let settled = false;
      const done = (frame: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(frame);
      };
      const onFrame = (frame: string) => done(frame);
      const timer = setTimeout(() => {
        cleanFrameWaitersRef.current = cleanFrameWaitersRef.current.filter((w) => w !== onFrame);
        done(liveFrameRef.current || liveScreenFrame);
      }, 900);
      cleanFrameWaitersRef.current.push(onFrame);
      try {
        nativeCapture.captureCleanFrame();
      } catch {
        cleanFrameWaitersRef.current = cleanFrameWaitersRef.current.filter((w) => w !== onFrame);
        done(liveFrameRef.current || liveScreenFrame);
      }
    });
  };

  const explainLiveScreenNow = async (frameOverride?: string) => {
    if (isLoading || sendingLockRef.current) return;
    const frame = frameOverride || (await requestFreshCleanFrame());
    if (!frame) return;
    await handleSend(
      'User amaze kwatsa Live Screen Share. Reba neza ibiri kuri iyi screen ubu, ubisobanure mu magambo magufi yumvikana mu Kinyarwanda, unamubaze icyo wamufashaho.',
      undefined,
      undefined,
      {
        base64: frame,
        mimeType: 'image/jpeg',
        name: 'live-screen.jpg',
      },
      '📺 Sobanura ibiri kuri screen ubu'
    );
  };

  const toggleLiveScreenShare = async () => {
    if (isLiveScreen) {
      stopLiveScreen();
      return;
    }
    setErrorMsg(null);
    const nativeCapture = (window as any).KevinScreenCapture;
    if (nativeCapture?.start) {
      awaitingFirstLiveExplainRef.current = true;
      nativeCapture.start();
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setErrorMsg('Live Screen Share ntikora kuri iyi browser; gerageza muri Chrome cyangwa Android APK.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 2, max: 5 } },
        audio: false,
      });
      liveStreamRef.current = stream;
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      liveVideoRef.current = video;
      await video.play();

      const canvas = document.createElement('canvas');
      const captureFrame = () => {
        if (!liveVideoRef.current || liveVideoRef.current.readyState < 2) return null;
        const vw = liveVideoRef.current.videoWidth || 1280;
        const vh = liveVideoRef.current.videoHeight || 720;
        const scale = Math.min(1, 1024 / Math.max(vw, vh));
        canvas.width = Math.max(1, Math.round(vw * scale));
        canvas.height = Math.max(1, Math.round(vh * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(liveVideoRef.current, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.72);
      };

      stream.getVideoTracks().forEach((track) => {
        track.onended = () => stopLiveScreen();
      });

      isLiveScreenRef.current = true;
      setIsLiveScreen(true);
      awaitingFirstLiveExplainRef.current = true;

      setTimeout(() => {
        const firstFrame = captureFrame();
        if (firstFrame) {
          liveFrameRef.current = firstFrame;
          setLiveScreenFrame(firstFrame);
          if (awaitingFirstLiveExplainRef.current) {
            awaitingFirstLiveExplainRef.current = false;
            void explainLiveScreenNow(firstFrame);
          }
        }
      }, 250);

      liveIntervalRef.current = setInterval(() => {
        const frame = captureFrame();
        if (frame) {
          liveFrameRef.current = frame;
          setLiveScreenFrame(frame);
        }
      }, 1500);
    } catch {
      stopLiveScreen();
    }
  };

  const handleSend = async (
    overrideText?: string,
    audioBase64?: string,
    audioMimeType?: string,
    imageOverride?: AttachmentItem,
    displayPromptOverride?: string,
    audioUrlOverride?: string | null
  ) => {
    const text = (overrideText ?? promptText).trim();
    if (!text && !imageOverride && !attachedImage && !audioBase64 && !(isLiveScreenRef.current && liveFrameRef.current)) return;
    if (isLoading || sendingLockRef.current) return;

    sendingLockRef.current = true;
    try {
      let liveScreenCapture = liveFrameRef.current;
      if (!imageOverride && !attachedImage && isLiveScreenRef.current && (text || audioBase64)) {
        liveScreenCapture = await requestFreshCleanFrame();
      }

      const screenAttachment = !attachedImage && !imageOverride && isLiveScreenRef.current && liveScreenCapture
        ? { base64: liveScreenCapture, mimeType: 'image/jpeg', name: 'live-screen.jpg' }
        : undefined;
      const effectiveAttachment = imageOverride || attachedImage || screenAttachment;

      if (!text && !effectiveAttachment && !audioBase64) return;

      setErrorMsg(null);
      replaceSubmittedAudioUrl(audioUrlOverride || null);
      setSubmittedPrompt(
        displayPromptOverride
          || text
          || (effectiveAttachment ? '📺 Screen yoherejwe' : '🎤 Voice Note')
      );
      setReplyText('');
      setAction(null);
      setIsLoading(true);
      setPromptText('');
      setAttachedImage(null);
      setSources([]);
      setShowSources(false);

      const response = await sendMessageToGemini(
        [],
        text,
        (chunk) => setReplyText((prev) => prev + chunk),
        effectiveAttachment,
        selectedModel,
        (act) => setAction(act),
        audioBase64,
        audioMimeType,
        (srcs) => setSources(srcs)
      );
      if (response) {
        setReplyText(response);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Habaye ikibazo mu gusubiza.');
    } finally {
      sendingLockRef.current = false;
      setIsLoading(false);
    }
  };

  // Chat-identical audio recording controls
  const startVoiceRecording = async () => {
    if (voiceRecordingRef.current) return;
    try {
      setErrorMsg(null);
      const recording = await createVoiceRecordingSession();
      voiceRecordingRef.current = recording;
      setIsRecording(true);
      setRecordingSec(0);
      timerRef.current = setInterval(() => {
        setRecordingSec((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      resetVoiceRecordingState();
      setErrorMsg(error instanceof Error ? error.message : 'Emerera Kevin AI gukoresha Microphone.');
    }
  };

  const cancelRecording = () => {
    if (voiceRecordingRef.current) {
      voiceRecordingRef.current.cancel();
      resetVoiceRecordingState();
      showAudioStatus('Amajwi yasibwe.');
    }
  };

  const transcribeRecordingToInput = async () => {
    if (voiceStoppingRef.current) return;
    const recording = voiceRecordingRef.current;
    if (!recording) return;

    voiceStoppingRef.current = true;
    setIsTranscribing(true);
    try {
      const audioBlob = await recording.stop();
      resetVoiceRecordingState();
      if (!audioBlob.size) {
        throw new Error('No audio was captured.');
      }
      const audioBase64 = await blobToRawBase64(audioBlob);
      const transcript = await transcribeAudioWithSTT(audioBase64, recording.mimeType);
      if (transcript) {
        setPromptText((prev) => (prev ? `${prev.trim()} ${transcript}` : transcript));
        showAudioStatus('🎙️ Amajwi yahinduwe inyandiko (STT)!');
        setTimeout(() => textareaRef.current?.focus(), 60);
      } else {
        showAudioStatus('Ntacyo ijwi ryabashije kumvikana. Ongera ugerageze.');
      }
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'STT transcription failed.');
    } finally {
      setIsTranscribing(false);
      voiceStoppingRef.current = false;
      resetVoiceRecordingState();
    }
  };

  const finishVoiceRecording = async () => {
    if (voiceStoppingRef.current) return;
    const recording = voiceRecordingRef.current;
    if (!recording) return;

    voiceStoppingRef.current = true;
    try {
      const audioBlob = await recording.stop();
      resetVoiceRecordingState();
      if (!audioBlob.size) {
        throw new Error('No audio was captured.');
      }

      const audioBase64 = await blobToRawBase64(audioBlob);
      if (audioBase64.length <= 100) {
        throw new Error('The recorded audio is empty or invalid. Please record your message again.');
      }

      let transcript = '';
      setIsTranscribing(true);
      try {
        transcript = await transcribeAudioWithSTT(audioBase64, recording.mimeType);
      } catch (sttErr) {
        console.warn('STT fallback to multimodal audio:', sttErr);
      } finally {
        setIsTranscribing(false);
      }

      const prompt = transcript || 'Listen to the attached voice message, understand it in Kinyarwanda or English, and answer or execute any requested action.';
      const audioUrl = URL.createObjectURL(audioBlob);
      await handleSend(prompt, audioBase64, recording.mimeType, undefined, transcript || '🎤 Voice Note', audioUrl);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Unable to process the voice message.');
    } finally {
      setIsTranscribing(false);
      voiceStoppingRef.current = false;
      resetVoiceRecordingState();
    }
  };

  const toggleVoice = async () => {
    if (isRecording) {
      await finishVoiceRecording();
    } else {
      await startVoiceRecording();
    }
  };

  wakeHandlersRef.current = {
    handleSend: (overrideText?: string) => handleSend(overrideText),
    startVoiceRecording,
  };

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await blobToDataUrl(file);
      if (!cleanBase64(dataUrl)) return;
      setAttachedImage({
        base64: dataUrl,
        mimeType: file.type || 'image/jpeg',
        name: file.name,
      });
      textareaRef.current?.focus();
    } catch {
      setErrorMsg('Ifoto ntiyashoboye gusomwa.');
    }
  };

  const resetConversation = () => {
    setSubmittedPrompt('');
    replaceSubmittedAudioUrl(null);
    setReplyText('');
    setAction(null);
    setErrorMsg(null);
    setAudioStatusNote(null);
    setPromptText('');
    setSources([]);
    setShowSources(false);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const executeQuickCallOrSend = (name: string, phone: string) => {
    if (!action) return;
    const cleanPhone = action.name === 'open_whatsapp' ? formatWhatsAppPhoneNumber(phone) : sanitizePhoneNumber(phone);
    if (!isLikelyPhoneNumber(cleanPhone)) return;
    const updated: DeviceAction = {
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
      fallbackUrl: action.name === 'make_call'
        ? `tel:${cleanPhone}`
        : action.name === 'send_sms'
          ? `sms:${cleanPhone}`
          : `https://wa.me/${formatWhatsAppPhoneNumber(cleanPhone)}?text=${encodeURIComponent(action.messageText || '')}`,
      contactMatches: undefined,
      status: 'executed',
    };
    runDeviceAction(updated, true);
    setAction(updated);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className={`fixed inset-0 z-[120] flex flex-col justify-end p-2.5 sm:p-5 ${
            isDedicatedOverlay ? 'bg-black/25' : 'bg-black/45 backdrop-blur-[2px]'
          }`}
          onClick={handleDismiss}
        >
          <motion.div
            initial={{ y: 90, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 90, opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md mx-auto rounded-[28px] overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.45)] border border-[#00FF88]/30 bg-white dark:bg-[#111b21] text-gray-900 dark:text-[#e9edef]"
          >
            {/* Kevin AI Emerald Top Accent */}
            <div className="h-1 w-full bg-gradient-to-r from-[#075E54] via-[#00a884] to-[#00FF88]" />

            {/* Compact Header */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="relative shrink-0">
                  <img
                    src={kevin2Url}
                    alt="Kevin AI"
                    className="w-8 h-8 rounded-full object-cover ring-2 ring-[#00FF88]/70"
                  />
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#00FF88] ring-2 ring-white dark:ring-[#111b21]" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-extrabold tracking-tight text-[#075E54] dark:text-[#00FF88]">
                      Kevin AI
                    </span>
                    <Sparkles size={13} className="text-[#00a884]" />
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-[#8696a0] truncate">
                    {isRecording
                      ? 'Ndumva... Vuga icyo ushaka'
                      : isTranscribing
                        ? 'Guhindura amajwi mu nyandiko (STT)...'
                        : isLoading
                          ? 'Ndabikora ako kanya...'
                          : 'Nakufasha iki uyu munsi?'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {(submittedPrompt || replyText) && (
                  <button
                    type="button"
                    onClick={resetConversation}
                    title="Ikibazo gishya"
                    className="p-2 rounded-full text-gray-500 hover:text-[#075E54] dark:text-[#8696a0] dark:hover:text-[#00FF88] hover:bg-gray-100 dark:hover:bg-[#202c33] transition-colors cursor-pointer"
                  >
                    <RotateCcw size={16} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleExpand}
                  title="Fungura Kevin AI yose"
                  className="p-2 rounded-full text-gray-500 hover:text-[#075E54] dark:text-[#8696a0] dark:hover:text-[#00FF88] hover:bg-gray-100 dark:hover:bg-[#202c33] transition-colors cursor-pointer"
                >
                  <Maximize2 size={16} />
                </button>
                <button
                  type="button"
                  onClick={handleDismiss}
                  title="Funga"
                  className="p-2 rounded-full text-gray-500 hover:text-red-500 dark:text-[#8696a0] hover:bg-gray-100 dark:hover:bg-[#202c33] transition-colors cursor-pointer"
                >
                  <X size={17} />
                </button>
              </div>
            </div>

            {/* Compact Response Area (when active) */}
            {(submittedPrompt || replyText || action || errorMsg) && (
              <div className="max-h-[38vh] overflow-y-auto px-4 py-2 space-y-2.5 border-t border-gray-100 dark:border-[#202c33]">
                {submittedPrompt && (
                  <div className="flex flex-col items-end gap-1">
                    {submittedAudioUrl && (
                      <audio
                        controls
                        src={submittedAudioUrl}
                        className="h-8 max-w-[230px]"
                      />
                    )}
                    <span className="inline-block max-w-[88%] rounded-2xl rounded-tr-xs bg-[#075E54] text-white px-3 py-1.5 text-xs font-medium shadow-xs">
                      {submittedPrompt}
                    </span>
                  </div>
                )}

                {action && (
                  <div className="rounded-2xl border border-[#00a884]/30 bg-[#f0fdf4] dark:bg-[#182229] p-2.5 space-y-2">
                    {action.name === 'open_youtube' && action.embedUrl && perms.autoPlayYouTube && (
                      <div className="rounded-xl overflow-hidden bg-black aspect-video w-full">
                        <iframe
                          src={action.embedUrl}
                          title={action.videoTitle || action.label}
                          className="w-full h-full"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-800 dark:text-[#e9edef] truncate">
                          {action.label}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-[#8696a0] truncate">
                          {action.status === 'executed'
                            ? 'Byakozwe ako kanya (Full Agent)'
                            : action.status === 'needs_permission'
                              ? 'Emerera Kevin AI hasi'
                              : action.status === 'contact_not_found'
                                ? 'Nimero ntiraboneka muri Contacts'
                                : 'Hitamo hasi'}
                        </p>
                      </div>
                      {action.status === 'needs_permission' && (
                        <button
                          type="button"
                          onClick={() => {
                            const next = {
                              ...perms,
                              ...(action.name === 'make_call' ? { autoCall: true } : { autoSend: true }),
                            };
                            setPerms(next);
                            saveAgentPermissions(next);
                            const updated = { ...action, status: 'executed' as const };
                            runDeviceAction(updated, true);
                            setAction(updated);
                          }}
                          className="shrink-0 rounded-full bg-[#25D366] px-3 py-1 text-[11px] font-bold text-white cursor-pointer"
                        >
                          {action.name === 'make_call' ? 'Emerera & Hamagara' : 'Emerera & Ohereza'}
                        </button>
                      )}
                    </div>

                    {action.status === 'choose_contact' && action.contactMatches && (
                      <div className="space-y-1">
                        {action.contactMatches.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => executeQuickCallOrSend(c.name, c.phone)}
                            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#2f3b43] text-xs cursor-pointer"
                          >
                            <span className="font-bold truncate">{c.name}</span>
                            <span className="text-[#00a884] font-mono text-[11px]">{c.phone}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {action.status === 'contact_not_found' && (
                      <div className="flex gap-1.5">
                        <input
                          type="tel"
                          value={quickPhone}
                          onChange={(e) => setQuickPhone(e.target.value)}
                          placeholder={`Nimero ya ${action.contactName || 'contact'}...`}
                          className="flex-1 bg-white dark:bg-[#111b21] px-2.5 py-1 rounded-lg border border-gray-300 dark:border-[#2f3b43] text-xs focus:outline-none focus:border-[#00a884]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (!isLikelyPhoneNumber(quickPhone)) return;
                            const name = action.contactName || 'Contact';
                            saveContact(name, quickPhone);
                            executeQuickCallOrSend(name, quickPhone);
                            setQuickPhone('');
                          }}
                          className="px-3 py-1 rounded-lg bg-[#00a884] text-white text-xs font-bold cursor-pointer"
                        >
                          Bika & Kora
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {replyText && (
                  <div className="text-sm leading-relaxed text-gray-800 dark:text-[#e9edef] bg-gray-50 dark:bg-[#202c33]/70 rounded-2xl px-3.5 py-2.5">
                    <MarkdownRenderer content={replyText} />
                    {sources && sources.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-black/5 dark:border-white/5">
                        <button
                          type="button"
                          onClick={() => setShowSources(!showSources)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-[#075E54] dark:text-[#00FF88] border border-[#00a884]/30 transition-all cursor-pointer shadow-2xs group"
                          title="Kanda urebe amasoko y'amakuru (Sources)"
                        >
                          <Globe size={12} className="text-[#00a884] group-hover:rotate-12 transition-transform shrink-0" />
                          <span>Sources ({sources.length})</span>
                          <ChevronDown size={11} className={`transition-transform shrink-0 ${showSources ? 'rotate-180' : ''}`} />
                        </button>
                        {showSources && (
                          <div className="mt-1.5 space-y-1 max-h-36 overflow-y-auto pr-1">
                            {sources.map((s, idx) => {
                              let domain = '';
                              try { domain = new URL(s.url).hostname.replace(/^www\./, ''); } catch { domain = 'web'; }
                              return (
                                <a
                                  key={idx}
                                  href={s.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors text-xs text-gray-800 dark:text-[#e9edef]"
                                >
                                  <div className="min-w-0">
                                    <p className="font-medium truncate text-[11px]">{s.title || s.url}</p>
                                    <p className="text-[9px] text-gray-400 font-mono truncate">{domain}</p>
                                  </div>
                                  <ExternalLink size={11} className="shrink-0 text-gray-400" />
                                </a>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {errorMsg && (
                  <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-xl px-3 py-2 space-y-2">
                    <p>{errorMsg}</p>
                    {errorMsg.includes('APK_NO_API_KEY') && isDedicatedOverlay && (
                      <button
                        type="button"
                        onClick={handleExpand}
                        className="inline-flex items-center px-3 py-1 rounded-full bg-[#075E54] text-white text-[11px] font-bold cursor-pointer"
                      >
                        Fungura Settings (INJIZA KEVIN API KEYS)
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Live Screen Vision Preview Strip */}
            {isLiveScreen && (
              <div className="mx-4 mt-1 mb-2 flex items-center gap-2.5 rounded-2xl border border-[#00a884]/40 bg-[#f0fdf4] dark:bg-[#102a23] px-2.5 py-2">
                {liveScreenFrame ? (
                  <img
                    src={liveScreenFrame}
                    alt="Live screen preview"
                    className="w-11 h-11 rounded-lg object-cover border border-[#00a884]/40 shrink-0"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-lg bg-[#075E54]/20 flex items-center justify-center shrink-0">
                    <MonitorUp size={18} className="text-[#00a884]" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-[#075E54] dark:text-[#00FF88] truncate">
                    Live Screen Share irakora
                  </p>
                  <p className="text-[11px] text-gray-600 dark:text-[#8696a0] truncate">
                    Kevin AI irareba ibiri kuri screen yawe
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void explainLiveScreenNow()}
                  disabled={!liveScreenFrame || isLoading}
                  className="shrink-0 min-h-[36px] px-3 py-1.5 rounded-lg bg-[#00a884] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  Sobanura
                </button>
                <button
                  type="button"
                  onClick={stopLiveScreen}
                  title="Hagarika Live Screen"
                  className="shrink-0 w-9 h-9 rounded-lg bg-red-500/15 text-red-600 dark:text-red-400 flex items-center justify-center cursor-pointer"
                >
                  <Square size={14} />
                </button>
              </div>
            )}

            {/* Main Prompt Box (Spacious & Clean like Photo 1, Kevin AI Styled) */}
            <div className="px-4 pt-2 pb-2">
              {attachedImage && (
                <div className="mb-2 flex items-center gap-2 bg-gray-50 dark:bg-[#202c33] p-1.5 rounded-xl border border-gray-200 dark:border-[#2f3b43]">
                  <img
                    src={attachedImage.base64}
                    alt="Attached"
                    className="w-10 h-10 rounded-lg object-cover"
                  />
                  <span className="text-xs text-gray-600 dark:text-[#8696a0] truncate flex-1">
                    {attachedImage.name || 'Photo ready'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAttachedImage(null)}
                    className="p-1 text-gray-400 hover:text-red-500 cursor-pointer"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {audioStatusNote && (
                <div className="mb-1.5 px-3 py-1 rounded-full bg-gray-100 dark:bg-[#202c33] text-[11px] font-medium text-[#075E54] dark:text-[#00FF88] inline-block">
                  {audioStatusNote}
                </div>
              )}

              {isRecording ? (
                <div className="my-2 px-3 py-2.5 rounded-full bg-gray-100 dark:bg-[#2a3942] text-sm flex items-center justify-between gap-2 shadow-inner">
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
                      <motion.div
                        animate={{ height: ['20%', '100%', '20%'] }}
                        transition={{ repeat: Infinity, duration: 0.8 }}
                        className="w-1 bg-red-500 rounded-t-sm"
                      />
                      <motion.div
                        animate={{ height: ['40%', '100%', '40%'] }}
                        transition={{ repeat: Infinity, duration: 1, delay: 0.2 }}
                        className="w-1 bg-red-500 rounded-t-sm"
                      />
                      <motion.div
                        animate={{ height: ['60%', '100%', '60%'] }}
                        transition={{ repeat: Infinity, duration: 0.9, delay: 0.4 }}
                        className="w-1 bg-red-500 rounded-t-sm"
                      />
                    </div>
                    <span className="font-medium animate-pulse truncate text-xs sm:text-sm">
                      Recording...
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void transcribeRecordingToInput()}
                      className="px-2.5 py-1 rounded-full bg-[#075E54] hover:bg-[#128C7E] dark:bg-[#00a884] text-white text-[11px] font-bold cursor-pointer"
                      title="Hindura amajwi mu nyandiko (STT)"
                    >
                      STT → Text
                    </button>
                    <span className="text-gray-500 dark:text-[#8696a0] font-mono text-xs">
                      {Math.floor(recordingSec / 60).toString().padStart(2, '0')}:
                      {(recordingSec % 60).toString().padStart(2, '0')}
                    </span>
                  </div>
                </div>
              ) : (
                <textarea
                  ref={textareaRef}
                  rows={submittedPrompt || replyText ? 1 : 2}
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder={
                    isTranscribing
                      ? 'Guhindura amajwi mu nyandiko (STT)...'
                      : submittedPrompt || replyText
                        ? 'Baza ikindi cyangwa utegeke...'
                        : 'Andika, vuga, cyangwa usangize ifoto...'
                  }
                  className={`w-full bg-transparent resize-none focus:outline-none text-gray-900 dark:text-[#e9edef] placeholder:text-gray-400 dark:placeholder:text-[#8696a0] ${
                    submittedPrompt || replyText
                      ? 'text-sm py-1.5'
                      : 'text-lg sm:text-xl font-medium py-2 leading-snug'
                  }`}
                />
              )}

              {/* Quick Agent Suggestion & Live Screen Controls */}
              <div className="flex flex-wrap gap-1.5 pb-1">
                <button
                  type="button"
                  onClick={() => void toggleLiveScreenShare()}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold cursor-pointer transition-colors ${
                    isLiveScreen
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-[#00a884] text-white hover:bg-[#075E54]'
                  }`}
                >
                  <MonitorUp size={12} />
                  {isLiveScreen ? 'Hagarika Live Screen' : 'Share Live Screen'}
                </button>
                {!submittedPrompt && !replyText && (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleSend('Fungura YouTube uncurangire Meddy Slowly')}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#075E54]/10 dark:bg-[#00a884]/15 text-[#075E54] dark:text-[#00FF88] text-[11px] font-semibold hover:bg-[#075E54]/20 cursor-pointer"
                    >
                      <Play size={11} /> Curanga indirimbo
                    </button>
                    <button
                      type="button"
                      onClick={() => setPromptText('Hamagara ')}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#075E54]/10 dark:bg-[#00a884]/15 text-[#075E54] dark:text-[#00FF88] text-[11px] font-semibold hover:bg-[#075E54]/20 cursor-pointer"
                    >
                      <Phone size={11} /> Hamagara
                    </button>
                    <button
                      type="button"
                      onClick={() => setPromptText('Ohereza ubutumwa kuri ')}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#075E54]/10 dark:bg-[#00a884]/15 text-[#075E54] dark:text-[#00FF88] text-[11px] font-semibold hover:bg-[#075E54]/20 cursor-pointer"
                    >
                      <MessageSquare size={11} /> Ohereza SMS
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Bottom Floating Pill Controls (Keyboard | Glowing Mic | Camera + Send) */}
            <div className="px-4 pb-4 pt-1 flex items-center justify-between gap-2">
              <div className="w-9 shrink-0" />

              <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-gray-100 dark:bg-[#202c33] border border-gray-200 dark:border-[#2f3b43] shadow-inner">
                <button
                  type="button"
                  onClick={() => textareaRef.current?.focus()}
                  title="Andika"
                  className="w-9 h-9 rounded-full flex items-center justify-center text-gray-600 dark:text-[#d1d7db] hover:bg-white dark:hover:bg-[#2a3942] transition-colors cursor-pointer"
                >
                  <Keyboard size={18} />
                </button>

                <button
                  type="button"
                  onClick={() => void toggleVoice()}
                  title={isRecording ? 'Ohereza amajwi' : 'Fata amajwi (Voice + STT)'}
                  className={`w-12 h-12 rounded-full flex items-center justify-center text-white shadow-lg transition-all cursor-pointer relative ${
                    isRecording
                      ? 'bg-red-500 animate-pulse ring-4 ring-red-500/30 scale-105'
                      : 'bg-gradient-to-tr from-[#075E54] to-[#00a884] hover:scale-105 ring-4 ring-[#00FF88]/25'
                  }`}
                >
                  <Mic size={21} />
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Sangiza ifoto"
                  className="w-9 h-9 rounded-full flex items-center justify-center text-gray-600 dark:text-[#d1d7db] hover:bg-white dark:hover:bg-[#2a3942] transition-colors cursor-pointer"
                >
                  <Camera size={18} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => void handleImagePick(e)}
                />
              </div>

              <div className="w-9 flex justify-end shrink-0">
                {(promptText.trim() || attachedImage) && !isRecording && (
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={isLoading}
                    title="Ohereza"
                    className="w-9 h-9 rounded-full bg-[#075E54] dark:bg-[#00a884] hover:bg-[#128C7E] text-white flex items-center justify-center shadow-md cursor-pointer"
                  >
                    <Send size={16} className="ml-0.5" />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
