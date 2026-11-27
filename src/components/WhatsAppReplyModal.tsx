/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
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
} from '../services/whatsappService';

interface WhatsAppReplyModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedModel: string;
  onToast: (message: string) => void;
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
      onToast(`⚠️ Byanze gutegura igisubizo: ${err?.message || 'Error'}`);
    } finally {
      setIsDrafting(false);
    }
  };

  const handleSendReply = async () => {
    if (!selectedChat || !replyText.trim()) return;
    setIsSending(true);
    try {
      const res = await sendWhatsAppReplyAction(
        selectedChat,
        replyText.trim(),
        recipientPhoneInput.trim()
      );
      setShowSendConfirm(false);
      onToast(
        res.method === 'native_app'
          ? `💬 Igisubizo cyohererejwe ${selectedChat.sender} kuri WhatsApp!`
          : `💬 WhatsApp yafunguwe kuri ${selectedChat.sender} kugira ngo wohereze!`
      );
      setChats(getStoredWhatsAppChats());
      setSelectedChat((prev) =>
        prev ? { ...prev, unread: false, repliedText: replyText.trim() } : null
      );
    } catch (err: any) {
      onToast(`⚠️ Byanze kohereza: ${err?.message || 'Error'}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleAddNewChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatSender.trim() || !newChatMessage.trim()) {
      onToast('⚠️ Shyiramo izina ry’uwakwandikiye n’ubutumwa yohereje.');
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
    onToast(`✅ Ubutumwa bwa ${created.sender} bwashyizwemo neza!`);
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
                  <MessageSquare size={22} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm sm:text-base text-gray-900 dark:text-white truncate">
                      Subiza ubutumwa kuri WhatsApp
                    </h3>
                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-[#25D366]/15 text-[#075E54] dark:text-[#00FF88] shrink-0">
                      WHATSAPP
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-[#8696a0] truncate">
                    Soma ubutumwa butasomwe, utegure igisubizo na AI, ucyoherereze kuri WhatsApp
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={refreshChats}
                  disabled={isRefreshing}
                  className="p-2 rounded-xl text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-200/60 dark:hover:bg-[#222c33] transition-colors cursor-pointer"
                  title="Ongera ushake ubutumwa (Refresh)"
                >
                  <RefreshCw size={17} className={isRefreshing ? 'animate-spin text-[#25D366]' : ''} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddChatModal(true)}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#25D366]/15 hover:bg-[#25D366]/25 text-[#075E54] dark:text-[#00FF88] text-xs font-bold transition-all cursor-pointer"
                  title="Shyiramo ubutumwa bushya wahawe"
                >
                  <Plus size={15} />
                  <span>Ongeramo</span>
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
                      placeholder="Shakisha umuntu cyangwa ubutumwa..."
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
                    onClick={() => setFilterMode('unread')}
                    className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      filterMode === 'unread'
                        ? 'bg-white dark:bg-[#111b21] text-[#075E54] dark:text-[#00FF88] shadow-xs'
                        : 'text-gray-500 hover:text-gray-900 dark:text-gray-400'
                    }`}
                  >
                    <span>Butasomwe</span>
                    {unreadCount > 0 && (
                      <span className="w-4 h-4 rounded-full bg-[#25D366] text-white text-[10px] flex items-center justify-center">
                        {unreadCount}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode('all')}
                    className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      filterMode === 'all'
                        ? 'bg-white dark:bg-[#111b21] text-[#075E54] dark:text-[#00FF88] shadow-xs'
                        : 'text-gray-500 hover:text-gray-900 dark:text-gray-400'
                    }`}
                  >
                    <span>Byose ({chats.length})</span>
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
                        Nta butumwa bubonetse
                      </p>
                      <p className="text-[11px] text-gray-400 mt-1">
                        {filterMode === 'unread'
                          ? 'Ubutumwa bwose butasomwe bwarangiye.'
                          : 'Nta butumwa bwa WhatsApp burakoreshwa.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowAddChatModal(true)}
                        className="mt-3 px-3 py-1.5 rounded-xl bg-[#25D366]/15 hover:bg-[#25D366]/25 text-[#075E54] dark:text-[#00FF88] text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1"
                      >
                        <Plus size={13} />
                        <span>Ongeramo ubutumwa</span>
                      </button>
                    </div>
                  ) : (
                    filteredChats.map((chat) => {
                      const isSelected = selectedChat?.id === chat.id;
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
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#075E54] to-[#128C7E] text-white font-extrabold text-sm flex items-center justify-center shrink-0 shadow-xs">
                            {chat.sender.charAt(0).toUpperCase()}
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
                                  <CheckCircle2 size={11} /> Yasubijwe
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
                className={`flex-1 flex flex-col min-w-0 bg-white dark:bg-[#202c33] ${
                  selectedChat ? 'flex' : 'hidden md:flex'
                }`}
              >
                {selectedChat ? (
                  <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 sm:p-6 space-y-5">
                    {/* Selected Contact Header */}
                    <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-[#2b3942]">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setSelectedChat(null)}
                          className="md:hidden p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-[#182229]"
                        >
                          <ArrowLeft size={18} />
                        </button>
                        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#075E54] to-[#25D366] text-white font-extrabold text-base flex items-center justify-center shadow-md">
                          {selectedChat.sender.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h3 className="font-extrabold text-sm sm:text-base text-gray-900 dark:text-white">
                            {selectedChat.sender}
                          </h3>
                          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-[#8696a0]">
                            <Phone size={12} className="text-[#25D366]" />
                            <span>{recipientPhoneInput || selectedChat.phoneNumber || 'Nta nimero ibonetse'}</span>
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
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-gray-500 dark:text-[#8696a0] uppercase tracking-wider">
                          Ubutumwa bwakiriwe (Incoming Message)
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
                    <div className="space-y-3 p-4 rounded-2xl bg-gray-50 dark:bg-[#111b21] border border-gray-200 dark:border-[#2f3b43]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sparkles size={16} className="text-[#25D366]" />
                          <span className="text-xs font-bold text-gray-800 dark:text-white">
                            Bwira Izi AI uko igusubiriza (AI Reply Prompt)
                          </span>
                        </div>
                        <span className="text-[10px] text-[#00a884] dark:text-[#00FF88] font-mono">
                          {selectedModel}
                        </span>
                      </div>

                      {/* Quick Presets */}
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { label: 'Emeza (Confirm)', prompt: 'Musubize wemeza ko ubikora kandi nta kibazo.' },
                          { label: 'Gushimira (Thank)', prompt: 'Musubize umushimira cyane ku butumwa bwe.' },
                          { label: 'Gusaba Igihe (Give Time)', prompt: 'Musubize ko ugiye kubisuzuma uza kumusubiza mu kanya gato.' },
                          { label: 'Ibisobanuro (Details)', prompt: 'Musubize umuhe ibisobanuro birambuye kandi bisobanutse neza.' },
                          { label: 'Ndi mu nama (Busy)', prompt: 'Musubize ko uri mu nama/uhuze, uraza kumuhamagara wifunguye.' },
                          { label: 'Kugerayo (On my way)', prompt: 'Musubize ko uri mu nzira uza, ugera aho ari mu kanya.' },
                        ].map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => handleGenerateAiDraft(preset.prompt)}
                            disabled={isDrafting}
                            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#313d45] text-gray-700 dark:text-gray-300 hover:border-[#25D366] hover:text-[#075E54] dark:hover:text-[#00FF88] transition-all cursor-pointer shadow-2xs"
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
                          placeholder="Urugero: Musubize ko nzamureba ejo saa munani za mugitondo..."
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
                              <span>Birategurwa...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles size={14} />
                              <span>Tegura</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Reply Draft Textarea */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                          Igisubizo giteguye (Edit or Review Reply):
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
                                  <span className="text-[#25D366]">Byakoporowe</span>
                                </>
                              ) : (
                                <>
                                  <Copy size={12} />
                                  <span>Koporora</span>
                                </>
                              )}
                            </button>
                            <span className="text-[10px] text-gray-400 font-mono">
                              {replyText.length} inyuguti
                            </span>
                          </div>
                        )}
                      </div>

                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Kanda kuri 'Tegura' hejuru cyangwa wandike igisubizo cyawe hano..."
                        rows={4}
                        className="w-full bg-gray-50 dark:bg-[#111b21] text-gray-900 dark:text-[#e9edef] p-3.5 rounded-2xl border border-gray-300 dark:border-[#2f3b43] focus:border-[#25D366] focus:outline-none text-xs sm:text-sm leading-relaxed transition-all resize-none shadow-inner"
                      />
                    </div>

                    {/* Destination Phone Input if missing */}
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-[#111b21] border border-gray-200 dark:border-[#2f3b43]">
                      <Phone size={16} className="text-[#25D366] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <label className="block text-[10px] font-bold text-gray-400 uppercase">
                          Nimero ya Telefoni yo koherezaho (WhatsApp Number):
                        </label>
                        <input
                          type="text"
                          value={recipientPhoneInput}
                          onChange={(e) => setRecipientPhoneInput(e.target.value)}
                          placeholder="e.g. +250788123456 cyangwa 0788123456"
                          className="w-full bg-transparent text-gray-900 dark:text-white text-xs font-semibold focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Bottom Action Buttons */}
                    <div className="pt-2 flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setReplyText('')}
                        disabled={!replyText}
                        className="px-4 py-2.5 rounded-xl text-xs font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-white transition-colors cursor-pointer"
                      >
                        Siba igisubizo
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowSendConfirm(true)}
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
                            <span>Birakora...</span>
                          </>
                        ) : (
                          <>
                            <Send size={16} />
                            <span>Ohereza kuri WhatsApp</span>
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
                      Hitamo ubutumwa ushaka gusubiza
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-[#8696a0] max-w-sm mt-1">
                      Kanda ku butumwa bwa WhatsApp mu rutonde rw'ibumoso kugira ngo usome ubutumwa bwose, Izi AI igutegurire igisubizo cyiza.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowAddChatModal(true)}
                      className="mt-4 px-4 py-2 rounded-xl bg-[#25D366] hover:bg-[#20ba59] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm transition-all"
                    >
                      <Plus size={15} />
                      <span>Shyiramo ubutumwa bushya</span>
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
                      <div>
                        <h4 className="font-bold text-sm text-gray-900 dark:text-white">
                          Emeza kohereza igisubizo
                        </h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Kuri: {selectedChat.sender}
                        </p>
                      </div>
                    </div>

                    <div className="p-3 my-3 rounded-xl bg-gray-50 dark:bg-[#111b21] border border-gray-200 dark:border-[#2f3b43] text-xs text-gray-800 dark:text-[#e9edef] max-h-32 overflow-y-auto italic">
                      "{replyText}"
                    </div>

                    <div className="flex items-center justify-end gap-2 mt-4">
                      <button
                        type="button"
                        onClick={() => setShowSendConfirm(false)}
                        className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                      >
                        Reka (Cancel)
                      </button>
                      <button
                        type="button"
                        onClick={handleSendReply}
                        disabled={isSending}
                        className="px-5 py-2 rounded-xl text-xs font-bold bg-[#25D366] hover:bg-[#20ba59] text-white shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        {isSending ? (
                          <>
                            <Loader2 size={13} className="animate-spin" />
                            <span>Kohereza...</span>
                          </>
                        ) : (
                          <>
                            <Check size={14} />
                            <span>Emeza Wohereze</span>
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
                            Ongeramo Ubutumwa bwa WhatsApp
                          </h4>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            Shyiramo ubutumwa bwo gusubiza ukoresheje Izi AI
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
                          Izina ry'uwakwandikiye (Sender Name):
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
                          Nimero ya Telefoni (Phone Number - Optional):
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
                          Ubutumwa yohereje (Message text):
                        </label>
                        <textarea
                          value={newChatMessage}
                          onChange={(e) => setNewChatMessage(e.target.value)}
                          placeholder="Koporora cyangwa wandike ubutumwa wakiriye kuri WhatsApp hano..."
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
                          Reka
                        </button>
                        <button
                          type="submit"
                          className="px-5 py-2 rounded-xl text-xs font-bold bg-[#25D366] hover:bg-[#20ba59] text-white shadow-sm flex items-center gap-1.5"
                        >
                          <Plus size={14} />
                          <span>Ongeramo</span>
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
