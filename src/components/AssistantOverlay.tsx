import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, Camera, Keyboard, Send, X, Maximize2, Sparkles, Phone, Play, MessageSquare, RotateCcw } from 'lucide-react';
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
} from '../services/geminiService';

interface AssistantOverlayProps {
  isOpen: boolean;
  isDedicatedOverlay?: boolean;
  selectedModel?: string;
  onClose: () => void;
  onExpandToFullApp?: (prompt?: string, reply?: string, action?: DeviceAction | null) => void;
}

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Could not read audio recording.'));
    reader.onerror = () => reject(reader.error || new Error('Could not read audio recording.'));
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
  const [replyText, setReplyText] = useState('');
  const [action, setAction] = useState<DeviceAction | null>(null);
  const [attachedImage, setAttachedImage] = useState<AttachmentItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [quickPhone, setQuickPhone] = useState('');
  const [perms, setPerms] = useState<AgentPermissions>(() => getAgentPermissions());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isOpen) {
      setPerms(getAgentPermissions());
      setTimeout(() => textareaRef.current?.focus(), 180);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [isOpen]);

  const handleDismiss = () => {
    stopStreamCleanly();
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

  const stopStreamCleanly = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
    } catch {
      // ignore
    }
    recorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
    setRecordingSec(0);
  };

  const handleSend = async (
    overrideText?: string,
    audioBase64?: string,
    audioMimeType?: string
  ) => {
    const text = (overrideText ?? promptText).trim();
    if (!text && !attachedImage && !audioBase64) return;
    if (isLoading) return;

    setErrorMsg(null);
    setSubmittedPrompt(text || (attachedImage ? '📸 Ifoto yoherejwe' : '🎤 Voice command'));
    setReplyText('');
    setAction(null);
    setIsLoading(true);
    const currentImage = attachedImage;
    setPromptText('');
    setAttachedImage(null);

    try {
      const response = await sendMessageToGemini(
        [],
        text,
        (chunk) => setReplyText((prev) => prev + chunk),
        currentImage || undefined,
        selectedModel,
        (act) => setAction(act),
        audioBase64,
        audioMimeType
      );
      if (response) {
        setReplyText(response);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Habaye ikibazo mu gusubiza.');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleVoice = async () => {
    if (isRecording) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      const rec = recorderRef.current;
      if (!rec) return;

      const mimeType = rec.mimeType || 'audio/webm';
      const blob = await new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          resolve(new Blob(chunksRef.current, { type: mimeType }));
        };
        rec.stop();
      });
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      recorderRef.current = null;
      setIsRecording(false);
      setRecordingSec(0);

      if (blob.size < 200) return;
      setIsTranscribing(true);
      try {
        const audioBase64 = await blobToBase64(blob);
        const transcript = await transcribeAudioWithSTT(audioBase64, mimeType);
        await handleSend(transcript || '🎤 Voice command', audioBase64, mimeType);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Mic STT yanze.');
      } finally {
        setIsTranscribing(false);
      }
      return;
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        setErrorMsg('Mic ntishobora gukoreshwa kuri iki gikoresho.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const candidateMime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
        .find((m) => MediaRecorder.isTypeSupported(m)) || '';
      const rec = candidateMime ? new MediaRecorder(stream, { mimeType: candidateMime }) : new MediaRecorder(stream);
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorderRef.current = rec;
      rec.start(200);
      setIsRecording(true);
      setRecordingSec(0);
      timerRef.current = setInterval(() => setRecordingSec((s) => s + 1), 1000);
    } catch {
      setErrorMsg('Emerera Kevin AI gukoresha Microphone.');
    }
  };

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await blobToBase64(file);
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
    setReplyText('');
    setAction(null);
    setErrorMsg(null);
    setPromptText('');
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const executeQuickCallOrSend = (name: string, phone: string) => {
    if (!action) return;
    const cleanPhone = sanitizePhoneNumber(phone);
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
      url: action.name === 'make_call' ? `tel:${cleanPhone}` : action.url,
      fallbackUrl: action.name === 'make_call' ? `tel:${cleanPhone}` : action.fallbackUrl,
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
                        ? 'Ndabishyira mu nyandiko...'
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
                  <div className="flex justify-end">
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
                  </div>
                )}

                {errorMsg && (
                  <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-xl px-3 py-2">
                    {errorMsg}
                  </div>
                )}
              </div>
            )}

            {/* Main Prompt Box (Spacious & Clean like the Reference Photo, Kevin AI Styled) */}
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
                  submittedPrompt || replyText
                    ? 'Baza ikindi cyangwa utegeke...'
                    : 'Andika, vuga, cyangwa usangize ifoto...'
                }
                className={`w-full bg-transparent resize-none focus:outline-none text-gray-900 dark:text-[#e9edef] placeholder:text-gray-400 dark:placeholder:text-[#8696a0] ${
                  submittedPrompt || replyText
                    ? 'text-sm py-1.5'
                    : 'text-lg sm:text-xl font-medium py-2 leading-snug'
                }`}
              />

              {/* Quick Agent Suggestion Chips before first prompt */}
              {!submittedPrompt && !replyText && (
                <div className="flex flex-wrap gap-1.5 pb-1">
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
                </div>
              )}
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
                  title={isRecording ? 'Hagarika amajwi' : 'Vuga (Voice + STT)'}
                  className={`w-12 h-12 rounded-full flex items-center justify-center text-white shadow-lg transition-all cursor-pointer relative ${
                    isRecording
                      ? 'bg-red-500 animate-pulse ring-4 ring-red-500/30 scale-105'
                      : 'bg-gradient-to-tr from-[#075E54] to-[#00a884] hover:scale-105 ring-4 ring-[#00FF88]/25'
                  }`}
                >
                  <Mic size={21} />
                  {isRecording && (
                    <span className="absolute -top-6 px-2 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-mono font-bold shadow">
                      {Math.floor(recordingSec / 60).toString().padStart(2, '0')}:
                      {(recordingSec % 60).toString().padStart(2, '0')}
                    </span>
                  )}
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
                {(promptText.trim() || attachedImage) && (
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
