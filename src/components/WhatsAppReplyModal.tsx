/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  MessageSquare,
  X,
  RefreshCw,
  Search,
  Sparkles,
  Send,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  Plus,
  Phone,
  User,
  Clock,
  ExternalLink,
  Copy,
  Check,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import {
  WhatsAppChatItem,
  getStoredWhatsAppChats,
  saveStoredWhatsAppChats,
  fetchActiveWhatsAppChats,
  addIncomingWhatsAppChat,
  markWhatsAppChatAsRead,
  draftWhatsAppReplyWithAI,
  sendWhatsAppReplyAction,
  verifyWhatsAppRecipient,
} from '../services/whatsappService';

interface WhatsAppReplyModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedModel: string;
  onToast: (message: string) => void;
}

const WHATSAPP_AVATARS = [
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&auto=format&fit=crop&q=80',
];

function getWhatsAppAvatarUrl(name: string): string {
  if (!name) return WHATSAPP_AVATARS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % WHATSAPP_AVATARS.length;
  return WHATSAPP_AVATARS[index];
}

export default function WhatsAppReplyModal({
  isOpen,
  onClose,
  selectedModel,
  onToast,
}: WhatsAppReplyModalProps) {
  const [chats, setChats] = useState<WhatsAppChatItem[]>(() => getStoredWhatsAppChats());
  const [filterMode, setFilterMode] = useState<'unread' | 'all'>('unread');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChat, setSelectedChat] = useState<WhatsAppChatItem | null>(null);

  const [aiInstruction, setAiInstruction] = useState('');
  const [replyText, setReplyText] = useState('');
  const [isDrafting, setIsDrafting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [recipientPhoneInput, setRecipientPhoneInput] = useState('');
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [copiedDraft, setCopiedDraft] = useState(false);

  // New Chat Manual Input Popup
  const [showAddChatModal, setShowAddChatModal] = useState(false);
  const [newChatSender, setNewChatSender] = useState('');
  const [newChatPhone, setNewChatPhone] = useState('');
  const [newChatMessage, setNewChatMessage] = useState('');

  const refreshChats = async () => {
    setIsRefreshing(true);
    try {
      const active = await fetchActiveWhatsAppChats();
      setChats(active);
      if (active.length > 0 && !selectedChat) {
        setSelectedChat(active[0]);
        setRecipientPhoneInput(active[0].phoneNumber || '');
      } else if (selectedChat) {
        const found = active.find((c) => c.id === selectedChat.id);
        if (found) {
          setSelectedChat(found);
          setRecipientPhoneInput(found.phoneNumber || '');
        }
      }
    } catch {
      // fallback
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    refreshChats();
  }, [isOpen]);

  useEffect(() => {
    if (selectedChat) {
      setRecipientPhoneInput(selectedChat.phoneNumber || '');
      if (selectedChat.unread) {
        markWhatsAppChatAsRead(selectedChat.id);
        setChats((prev) =>
          prev.map((c) => (c.id === selectedChat.id ? { ...c, unread: false } : c))
        );
      }
    }
  }, [selectedChat?.id]);

  const handleSelectChat = (chat: WhatsAppChatItem) => {
    setSelectedChat(chat);
    setReplyText(chat.repliedText || '');
    setAiInstruction('');
    setRecipientPhoneInput(chat.phoneNumber || '');
  };

  const handleGenerateAiDraft = async (presetInstruction?: string) => {
    if (!selectedChat) return;
    const instructionToUse = presetInstruction ?? aiInstruction;
    if (presetInstruction) {
      setAiInstruction(presetInstruction);
    }
    setIsDrafting(true);
    try {
      const draft = await draftWhatsAppReplyWithAI(
        selectedChat,
        instructionToUse,
        selectedModel
      );
      setReplyText(draft);
    } catch (err: any) {
      onToast(`⚠️ AI Draft Error: ${err?.message || 'Error'}`);
    } finally {
      setIsDrafting(false);
    }
  };

  const [sendError, setSendError] = useState<string | null>(null);

  const recipientVerification = useMemo(() => {
    if (!selectedChat) return null;
    return verifyWhatsAppRecipient(selectedChat, recipientPhoneInput);
  }, [selectedChat, recipientPhoneInput, isOpen]);

  const handleSendReply = async () => {
    if (!selectedChat || !replyText.trim()) return;
    setSendError(null);
    const verification = verifyWhatsAppRecipient(selectedChat, recipientPhoneInput);
    if (!verification.verified) {
      const msg = verification.reason || 'Uwahoze ategerejwe ntabwo abonetse kuri WhatsApp.';
      setSendError(msg);
      onToast(`⚠️ ${msg}`);
      return;
    }

    setIsSending(true);
    try {
      const res = await sendWhatsAppReplyAction(
        selectedChat,
        replyText.trim(),
        recipientPhoneInput.trim()
      );
      setShowSendConfirm(false);
      setSendError(null);
      onToast(
        res.method === 'native_direct'
          ? `💬 Igisubizo cyoherejwe ako kanya kuri WhatsApp ya ${res.recipientName}!`
          : res.method === 'native_app'
            ? `💬 Igisubizo cyoherejwe muri WhatsApp App kuri ${res.recipientName}!`
            : `💬 WhatsApp App ifunguwe kuri ${res.recipientName} ngo ubutumwa bugende ako kanya!`
      );
      setChats(getStoredWhatsAppChats());
      setSelectedChat((prev) =>
        prev
          ? {
              ...prev,
              unread: false,
              repliedText: replyText.trim(),
              phoneNumber: res.recipientPhone ? `+${res.recipientPhone}` : prev.phoneNumber,
            }
          : null
      );
    } catch (err: any) {
      const msg = err?.message || 'Ntibyashobotse kohereza muri WhatsApp App.';
      setSendError(msg);
      onToast(`⚠️ ${msg}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleAddNewChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatSender.trim() || !newChatMessage.trim()) {
      onToast('⚠️ Please enter sender name and incoming message.');
      return;
    }
    const created = addIncomingWhatsAppChat(
      newChatSender,
      newChatMessage,
      newChatPhone
    );
    setChats(getStoredWhatsAppChats());
    setSelectedChat(created);
    setRecipientPhoneInput(created.phoneNumber || '');
    setReplyText('');
    setNewChatSender('');
    setNewChatPhone('');
    setNewChatMessage('');
    setShowAddChatModal(false);
    onToast(`✅ Message from ${created.sender} added successfully!`);
  };

  const filteredChats = chats.filter((c) => {
    if (filterMode === 'unread' && !c.unread) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchSender = c.sender.toLowerCase().includes(q);
      const matchMsg = c.message.toLowerCase().includes(q);
      const matchPhone = (c.phoneNumber || '').toLowerCase().includes(q);
      return matchSender || matchMsg || matchPhone;
    }
    return true;
  });

  const unreadCount = chats.filter((c) => c.unread).length;

  const formatChatTime = (ts: number) => {
    if (!ts) return '';
    const date = new Date(ts);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    return isToday
      ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const copyToClipboard = () => {
    if (!replyText.trim()) return;
    navigator.clipboard.writeText(replyText.trim());
    setCopiedDraft(true);
    setTimeout(() => setCopiedDraft(false), 2000);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 select-none"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#313d45] shadow-2xl rounded-3xl w-full max-w-4xl h-[90vh] max-h-[780px] flex flex-col overflow-hidden relative"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-200 dark:border-[#2f3b43] bg-[#f8fafc] dark:bg-[#182229] shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-[#25D366]/15 text-[#25D366] flex items-center justify-center shrink-0 shadow-xs">
                  <svg viewBox="0 0 24 24" className="w-6 h-6 shrink-0 text-[#25D366]" fill="currentColor">
                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-2.646-1.025-5.13-2.887-6.99-1.863-1.86-4.345-2.888-6.99-2.888-5.449 0-9.886 4.434-9.889 9.885-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.124-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm sm:text-base text-gray-900 dark:text-white truncate">
                      WhatsApp AI Reply Assistant
                    </h3>
                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-[#25D366]/15 text-[#075E54] dark:text-[#00FF88] shrink-0">
                      WHATSAPP
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-[#8696a0] truncate">
                    Read unread messages, generate smart AI replies, and send via WhatsApp
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={refreshChats}
                  disabled={isRefreshing}
                  className="p-2 rounded-xl text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-200/60 dark:hover:bg-[#222c33] transition-colors cursor-pointer"
                  title="Refresh messages"
                >
                  <RefreshCw size={17} className={isRefreshing ? 'animate-spin text-[#25D366]' : ''} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddChatModal(true)}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#25D366]/15 hover:bg-[#25D366]/25 text-[#075E54] dark:text-[#00FF88] text-xs font-bold transition-all cursor-pointer"
                  title="Add incoming message"
                >
                  <Plus size={15} />
                  <span>Add Chat</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-xl hover:bg-gray-100 dark:hover:bg-[#252525] transition-colors cursor-pointer"
                >
                  <X size={19} />
                </button>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
              {/* Left Column: Chat List */}
              <div
                className={`w-full md:w-80 lg:w-88 border-r border-gray-200 dark:border-[#2f3b43] flex flex-col bg-[#fdfdfd] dark:bg-[#111b21] shrink-0 ${
                  selectedChat ? 'hidden md:flex' : 'flex'
                }`}
              >
                {/* Search Bar */}
                <div className="p-3 border-b border-gray-100 dark:border-[#222c33]">
                  <div className="relative">
                    <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search sender or message..."
                      className="w-full bg-gray-100 dark:bg-[#202c33] text-gray-900 dark:text-[#e9edef] pl-9 pr-8 py-2 rounded-xl text-xs border border-transparent focus:border-[#25D366] focus:outline-none transition-all placeholder:text-gray-400"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Filter Tabs */}
                <div className="grid grid-cols-2 p-1.5 mx-3 my-2 rounded-xl bg-gray-100 dark:bg-[#202c33] gap-1 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => filterMode !== 'unread' && setFilterMode('unread')}
                    className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      filterMode === 'unread'
                        ? 'bg-white dark:bg-[#111b21] text-[#075E54] dark:text-[#00FF88] shadow-xs'
                        : 'text-gray-500 hover:text-gray-900 dark:text-gray-400'
                    }`}
                  >
                    <span>Unread</span>
                    {unreadCount > 0 && (
                      <span className="w-4 h-4 rounded-full bg-[#25D366] text-white text-[10px] flex items-center justify-center">
                        {unreadCount}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => filterMode !== 'all' && setFilterMode('all')}
                    className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      filterMode === 'all'
                        ? 'bg-white dark:bg-[#111b21] text-[#075E54] dark:text-[#00FF88] shadow-xs'
                        : 'text-gray-500 hover:text-gray-900 dark:text-gray-400'
                    }`}
                  >
                    <span>All ({chats.length})</span>
                  </button>
                </div>

                {/* Chat Items List */}
                <div className="flex-1 overflow-y-auto px-2 space-y-1 scrollbar-thin">
                  {filteredChats.length === 0 ? (
                    <div className="py-12 text-center px-4">
                      <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-[#202c33] text-gray-400 flex items-center justify-center mx-auto mb-2">
                        <MessageSquare size={22} />
                      </div>
                      <p className="text-xs font-bold text-gray-700 dark:text-gray-300">
                        No messages found
                      </p>
                      <p className="text-[11px] text-gray-400 mt-1">
                        {filterMode === 'unread'
                          ? 'All unread messages have been replied.'
                          : 'No WhatsApp messages available.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowAddChatModal(true)}
                        className="mt-3 px-3 py-1.5 rounded-xl bg-[#25D366]/15 hover:bg-[#25D366]/25 text-[#075E54] dark:text-[#00FF88] text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1"
                      >
                        <Plus size={13} />
                        <span>Add message</span>
                      </button>
                    </div>
                  ) : (
                    filteredChats.map((chat) => {
                      const isSelected = selectedChat?.id === chat.id;
                      const avatarUrl = getWhatsAppAvatarUrl(chat.sender);
                      return (
                        <div
                          key={chat.id}
                          onClick={() => handleSelectChat(chat)}
                          className={`p-3 rounded-2xl cursor-pointer transition-all flex items-start gap-3 border ${
                            isSelected
                              ? 'bg-[#E1FFC7]/80 dark:bg-[#005c4b]/35 border-[#25D366]/50 shadow-xs'
                              : 'hover:bg-gray-100/80 dark:hover:bg-[#182229] border-transparent'
                          }`}
                        >
                          <div className="w-11 h-11 rounded-full bg-[#25D366]/20 text-[#25D366] font-extrabold text-sm flex items-center justify-center shrink-0 shadow-xs overflow-hidden border border-[#25D366]/40 relative">
                            <img
                              src={avatarUrl}
                              alt={chat.sender}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-[#075E54] dark:text-[#00FF88] bg-emerald-900/10" style={{ display: 'none' }}>
                              {chat.sender.charAt(0).toUpperCase()}
                            </span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1">
                              <h4 className="font-bold text-xs text-gray-900 dark:text-white truncate">
                                {chat.sender}
                              </h4>
                              <span className="text-[10px] text-gray-400 shrink-0 font-mono">
                                {formatChatTime(chat.timestamp)}
                              </span>
                            </div>

                            <p className="text-[11px] text-gray-500 dark:text-[#8696a0] line-clamp-2 mt-0.5">
                              {chat.message}
                            </p>

                            <div className="flex items-center justify-between mt-1.5">
                              <span className="text-[10px] text-gray-400 truncate">
                                {chat.phoneNumber || 'WhatsApp'}
                              </span>
                              {chat.unread ? (
                                <span className="w-2.5 h-2.5 rounded-full bg-[#25D366] shadow-xs"></span>
                              ) : chat.repliedText ? (
                                <span className="text-[10px] font-bold text-[#00a884] dark:text-[#00FF88] flex items-center gap-0.5">
                                  <CheckCircle2 size={11} /> Replied
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Column: Active Conversation & AI Reply Composer */}
              <div
                className={`flex-1 flex flex-col min-w-0 bg-white dark:bg-[#202c33] overflow-y-auto ${
                  selectedChat ? 'flex' : 'hidden md:flex'
                }`}
              >
                {selectedChat ? (
                  <div className="flex-1 flex flex-col min-h-0 p-4 sm:p-6 space-y-5 overflow-y-auto">
                    {/* Selected Contact Header */}
                    <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-[#2b3942] shrink-0">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setSelectedChat(null)}
                          className="md:hidden p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-[#182229]"
                        >
                          <ArrowLeft size={18} />
                        </button>
                        <div className="w-12 h-12 rounded-full bg-[#25D366]/20 text-[#25D366] font-extrabold text-base flex items-center justify-center shadow-md overflow-hidden border border-[#25D366]/40 relative shrink-0">
                          <img
                            src={getWhatsAppAvatarUrl(selectedChat.sender)}
                            alt={selectedChat.sender}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        </div>
                        <div>
                          <h3 className="font-extrabold text-sm sm:text-base text-gray-900 dark:text-white">
                            {selectedChat.sender}
                          </h3>
                          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-[#8696a0]">
                            <Phone size={12} className="text-[#25D366]" />
                            <span>{recipientPhoneInput || selectedChat.phoneNumber || 'No phone number'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-400 font-mono">
                          {formatChatTime(selectedChat.timestamp)}
                        </span>
                      </div>
                    </div>

                    {/* Incoming Message Card */}
                    <div className="space-y-1.5 shrink-0">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-gray-500 dark:text-[#8696a0] uppercase tracking-wider">
                          Incoming Message
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {selectedChat.sender}
                        </span>
                      </div>
                      <div className="p-4 rounded-2xl bg-[#E1FFC7]/60 dark:bg-[#005c4b]/25 border border-[#25D366]/30 text-gray-900 dark:text-white shadow-xs leading-relaxed text-sm relative">
                        <p className="whitespace-pre-wrap">{selectedChat.message}</p>
                        <div className="text-right mt-1.5">
                          <span className="text-[10px] text-gray-500 dark:text-gray-400 font-mono">
                            {formatChatTime(selectedChat.timestamp)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* AI Prompt / Instruction & Quick Tone buttons */}
                    <div className="space-y-3 p-4 rounded-2xl bg-gray-50 dark:bg-[#111b21] border border-gray-200 dark:border-[#2f3b43] shrink-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sparkles size={16} className="text-[#25D366]" />
                          <span className="text-xs font-bold text-gray-800 dark:text-white">
                            AI Reply Assistant & Tone Prompt
                          </span>
                        </div>
                        <span className="text-[10px] text-[#00a884] dark:text-[#00FF88] font-mono">
                          {selectedModel}
                        </span>
                      </div>

                      {/* Quick Presets (Only Kinyarwanda words as requested) */}
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { label: 'Emeza', prompt: 'Musubize wemeza ko ubikora kandi nta kibazo.' },
                          { label: 'Gushimira', prompt: 'Musubize umushimira cyane ku butumwa bwe.' },
                          { label: 'Gusaba Igihe', prompt: 'Musubize ko ugiye kubisuzuma uza kumusubiza mu kanya gato.' },
                          { label: 'Ibisobanuro', prompt: 'Musubize umuhe ibisobanuro birambuye kandi bisobanutse neza.' },
                          { label: 'Ndi mu nama', prompt: 'Musubize ko uri mu nama/uhuze, uraza kumuhamagara wifunguye.' },
                          { label: 'Kugerayo', prompt: 'Musubize ko uri mu nzira uza, ugera aho ari mu kanya.' },
                        ].map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => handleGenerateAiDraft(preset.prompt)}
                            disabled={isDrafting}
                            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#313d45] text-gray-800 dark:text-gray-200 hover:border-[#25D366] hover:text-[#075E54] dark:hover:text-[#00FF88] transition-all cursor-pointer shadow-2xs"
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>

                      {/* Custom Instruction input */}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={aiInstruction}
                          onChange={(e) => setAiInstruction(e.target.value)}
                          placeholder="Type custom instructions for AI reply..."
                          className="flex-1 bg-white dark:bg-[#202c33] text-gray-900 dark:text-[#e9edef] px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-[#313d45] focus:border-[#25D366] focus:outline-none text-xs transition-all shadow-2xs placeholder:text-gray-400"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleGenerateAiDraft();
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => handleGenerateAiDraft()}
                          disabled={isDrafting}
                          className="px-4 py-2.5 rounded-xl bg-[#00a884] hover:bg-[#075E54] text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer shrink-0"
                        >
                          {isDrafting ? (
                            <>
                              <Loader2 size={14} className="animate-spin" />
                              <span>Drafting...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles size={14} />
                              <span>Generate</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Reply Draft Textarea */}
                    <div className="space-y-2 shrink-0">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                          Review or Edit Reply Draft:
                        </label>
                        {replyText && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={copyToClipboard}
                              className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-white flex items-center gap-1 cursor-pointer"
                            >
                              {copiedDraft ? (
                                <>
                                  <Check size={12} className="text-[#25D366]" />
                                  <span className="text-[#25D366]">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy size={12} />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                            <span className="text-[10px] text-gray-400 font-mono">
                              {replyText.length} chars
                            </span>
                          </div>
                        )}
                      </div>

                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Click 'Generate' above or type your reply draft here..."
                        rows={4}
                        className="w-full bg-gray-50 dark:bg-[#111b21] text-gray-900 dark:text-[#e9edef] p-3.5 rounded-2xl border border-gray-300 dark:border-[#2f3b43] focus:border-[#25D366] focus:outline-none text-xs sm:text-sm leading-relaxed transition-all resize-none shadow-inner"
                      />
                    </div>

                    {/* Destination Phone Input if missing */}
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-[#111b21] border border-gray-200 dark:border-[#2f3b43] shrink-0">
                      <Phone size={16} className="text-[#25D366] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <label className="block text-[10px] font-bold text-gray-400 uppercase">
                          WhatsApp Phone Number:
                        </label>
                        <input
                          type="text"
                          value={recipientPhoneInput}
                          onChange={(e) => setRecipientPhoneInput(e.target.value)}
                          placeholder="e.g. +250788123456"
                          className="w-full bg-transparent text-gray-900 dark:text-white text-xs font-semibold focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Bottom Action Buttons */}
                    <div className="pt-2 pb-6 flex items-center justify-end gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={() => setReplyText('')}
                        disabled={!replyText}
                        className="px-4 py-2.5 rounded-xl text-xs font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-white transition-colors cursor-pointer"
                      >
                        Clear Draft
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSendError(null);
                          setShowSendConfirm(true);
                        }}
                        disabled={!replyText.trim() || isSending}
                        className={`px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md transition-all flex items-center gap-2 cursor-pointer ${
                          replyText.trim() && !isSending
                            ? 'bg-[#25D366] hover:bg-[#20ba59] text-white hover:scale-[1.01]'
                            : 'bg-gray-200 dark:bg-[#2a3942] text-gray-400 dark:text-gray-500 cursor-not-allowed'
                        }`}
                      >
                        {isSending ? (
                          <>
                            <Loader2 size={16} className="animate-spin" />
                            <span>Sending...</span>
                          </>
                        ) : (
                          <>
                            <Send size={16} />
                            <span>Send via WhatsApp</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                    <div className="w-16 h-16 rounded-full bg-[#25D366]/10 text-[#25D366] flex items-center justify-center mb-3">
                      <MessageSquare size={32} />
                    </div>
                    <h3 className="font-bold text-base text-gray-800 dark:text-white">
                      Select a message to reply
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-[#8696a0] max-w-sm mt-1">
                      Choose an incoming WhatsApp message from the list on the left to read and generate smart AI replies.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowAddChatModal(true)}
                      className="mt-4 px-4 py-2 rounded-xl bg-[#25D366] hover:bg-[#20ba59] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm transition-all"
                    >
                      <Plus size={15} />
                      <span>Add new message</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Send Confirmation Dialog */}
            <AnimatePresence>
              {showSendConfirm && selectedChat && (
                <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#313d45] shadow-2xl rounded-2xl p-6 w-full max-w-sm"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-[#25D366]/15 text-[#25D366] flex items-center justify-center shrink-0">
                        <Send size={20} />
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-bold text-sm text-gray-900 dark:text-white">
                          Confirm Reply Send
                        </h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          To: {recipientVerification?.resolvedName || selectedChat.sender}
                          {recipientVerification?.resolvedPhone ? ` (+${recipientVerification.resolvedPhone})` : ''}
                        </p>
                      </div>
                    </div>

                    {recipientVerification && (
                      <div
                        className={`p-2.5 mb-3 rounded-xl border text-[11px] flex items-start gap-2 ${
                          recipientVerification.verified
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                            : 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300'
                        }`}
                      >
                        {recipientVerification.verified ? (
                          <ShieldCheck size={15} className="shrink-0 mt-0.5 text-[#25D366]" />
                        ) : (
                          <AlertTriangle size={15} className="shrink-0 mt-0.5 text-red-500" />
                        )}
                        <span className="leading-snug">
                          {recipientVerification.verified
                            ? recipientVerification.viaNotification
                              ? 'Yemejwe kuri WhatsApp App (Direct Notification Reply ako kanya).'
                              : recipientVerification.existsOnWhatsApp
                                ? 'Yemejwe muri Contacts & WhatsApp App — ubutumwa burahita bwoherezwa.'
                                : recipientVerification.existsInContacts
                                  ? 'Yemejwe muri Contacts — irahita yohereza muri WhatsApp App.'
                                  : 'Nimero yemewe — irahita yohereza muri WhatsApp App.'
                            : recipientVerification.reason}
                        </span>
                      </div>
                    )}

                    {sendError && (
                      <div className="p-2.5 mb-3 rounded-xl bg-red-500/10 border border-red-500/30 text-[11px] text-red-600 dark:text-red-300">
                        {sendError}
                      </div>
                    )}

                    <div className="p-3 my-3 rounded-xl bg-gray-50 dark:bg-[#111b21] border border-gray-200 dark:border-[#2f3b43] text-xs text-gray-800 dark:text-[#e9edef] max-h-32 overflow-y-auto italic">
                      "{replyText}"
                    </div>

                    <div className="flex items-center justify-end gap-2 mt-4">
                      <button
                        type="button"
                        onClick={() => {
                          setSendError(null);
                          setShowSendConfirm(false);
                        }}
                        className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSendReply}
                        disabled={isSending || !recipientVerification?.verified}
                        className={`px-5 py-2 rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 ${
                          !isSending && recipientVerification?.verified
                            ? 'bg-[#25D366] hover:bg-[#20ba59] text-white cursor-pointer'
                            : 'bg-gray-200 dark:bg-[#2a3942] text-gray-400 dark:text-gray-500 cursor-not-allowed'
                        }`}
                      >
                        {isSending ? (
                          <>
                            <Loader2 size={13} className="animate-spin" />
                            <span>Sending...</span>
                          </>
                        ) : (
                          <>
                            <Check size={14} />
                            <span>Confirm & Send</span>
                          </>
                        )}
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            {/* Manual Add / Paste Chat Modal */}
            <AnimatePresence>
              {showAddChatModal && (
                <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#313d45] shadow-2xl rounded-2xl p-6 w-full max-w-md"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-[#25D366]/15 text-[#25D366] flex items-center justify-center">
                          <Plus size={18} />
                        </div>
                        <div>
                          <h4 className="font-bold text-sm text-gray-900 dark:text-white">
                            Add WhatsApp Message
                          </h4>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            Paste or add incoming WhatsApp message for AI reply
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowAddChatModal(false)}
                        className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        <X size={16} />
                      </button>
                    </div>

                    <form onSubmit={handleAddNewChat} className="space-y-3.5">
                      <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                          Sender Name:
                        </label>
                        <input
                          type="text"
                          value={newChatSender}
                          onChange={(e) => setNewChatSender(e.target.value)}
                          placeholder="e.g. Jean Claude, Aline, Eric..."
                          required
                          className="w-full bg-gray-50 dark:bg-[#111b21] text-gray-900 dark:text-white px-3 py-2 rounded-xl border border-gray-300 dark:border-[#2f3b43] focus:border-[#25D366] focus:outline-none text-xs"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                          Phone Number (Optional):
                        </label>
                        <input
                          type="text"
                          value={newChatPhone}
                          onChange={(e) => setNewChatPhone(e.target.value)}
                          placeholder="e.g. +250788123456"
                          className="w-full bg-gray-50 dark:bg-[#111b21] text-gray-900 dark:text-white px-3 py-2 rounded-xl border border-gray-300 dark:border-[#2f3b43] focus:border-[#25D366] focus:outline-none text-xs"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                          Incoming Message:
                        </label>
                        <textarea
                          value={newChatMessage}
                          onChange={(e) => setNewChatMessage(e.target.value)}
                          placeholder="Paste or type the WhatsApp message received here..."
                          required
                          rows={3}
                          className="w-full bg-gray-50 dark:bg-[#111b21] text-gray-900 dark:text-white p-3 rounded-xl border border-gray-300 dark:border-[#2f3b43] focus:border-[#25D366] focus:outline-none text-xs resize-none"
                        />
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100 dark:border-[#282828]">
                        <button
                          type="button"
                          onClick={() => setShowAddChatModal(false)}
                          className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="px-5 py-2 rounded-xl text-xs font-bold bg-[#25D366] hover:bg-[#20ba59] text-white shadow-sm flex items-center gap-1.5"
                        >
                          <Plus size={14} />
                          <span>Add Message</span>
                        </button>
                      </div>
                    </form>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
