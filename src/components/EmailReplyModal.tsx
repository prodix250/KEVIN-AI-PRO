import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import {
  Mail,
  X,
  RefreshCw,
  LogOut,
  Search,
  Sparkles,
  Send,
  ArrowLeft,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Inbox,
} from 'lucide-react';
import {
  cancelGmailSignIn,
  draftEmailReplyWithIziAI,
  fetchRecentEmails,
  formatReplySubject,
  getCurrentGmailUser,
  getGmailAccessToken,
  GmailMessage,
  initGmailAuth,
  sendGmailReply,
  signInWithGoogleForGmail,
  signOutGmail,
} from '../services/gmailService';

interface EmailReplyModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedModel: string;
  onToast: (message: string) => void;
}

export default function EmailReplyModal({
  isOpen,
  onClose,
  selectedModel,
  onToast,
}: EmailReplyModalProps) {
  const [user, setUser] = useState<User | null>(() => getCurrentGmailUser());
  const [accessToken, setAccessToken] = useState<string | null>(() => getGmailAccessToken());
  const [needsAuth, setNeedsAuth] = useState<boolean>(() => !getGmailAccessToken());
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [filterMode, setFilterMode] = useState<'inbox' | 'unread'>('inbox');
  const [searchInput, setSearchInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('in:inbox');
  const [emails, setEmails] = useState<GmailMessage[]>([]);
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [emailLoadError, setEmailLoadError] = useState<string | null>(null);

  const [selectedEmail, setSelectedEmail] = useState<GmailMessage | null>(null);
  const [aiInstruction, setAiInstruction] = useState('');
  const [replyText, setReplyText] = useState('');
  const [isDrafting, setIsDrafting] = useState(false);

  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentSuccessId, setSentSuccessId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = initGmailAuth(
      (authedUser, token) => {
        setUser(authedUser);
        setAccessToken(token);
        setNeedsAuth(false);
      },
      (maybeUser) => {
        setUser(maybeUser);
        setAccessToken(null);
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, []);

  const applyGmailError = (err: any, fallbackMessage: string) => {
    const rawMsg = String(err?.message || '');
    if (rawMsg === 'GMAIL_MISSING_SCOPES') {
      setAccessToken(null);
      setNeedsAuth(true);
      setEmails([]);
      setAuthError(
        'Ntiwahisemo uburenganzira bwa Gmail kuri Google. Ongera ukande "Sign in with Google", hanyuma ushyire akamenyetso (✓) mu tuzu twose twemerera gusoma no kohereza Gmail mbere yo gukanda Continue.'
      );
      return;
    }
    if (rawMsg === 'GMAIL_AUTH_EXPIRED') {
      setAccessToken(null);
      setNeedsAuth(true);
      setEmails([]);
      setAuthError('Uburenganzira bwa Gmail bwarangiye. Ongera winjire na Google.');
      return;
    }
    if (rawMsg.startsWith('GMAIL_API_DISABLED:')) {
      setEmailLoadError(rawMsg);
      return;
    }
    setEmailLoadError(rawMsg || fallbackMessage);
  };

  const loadEmails = async (tokenToUse: string, queryToRun: string) => {
    setIsLoadingEmails(true);
    setEmailLoadError(null);
    try {
      const list = await fetchRecentEmails(tokenToUse, 15, queryToRun);
      setEmails(list);
      if (list.length > 0 && !selectedEmail) {
        setSelectedEmail(list[0]);
      } else if (list.length > 0 && selectedEmail) {
        const refreshedSelected = list.find((m) => m.id === selectedEmail.id);
        if (refreshedSelected) setSelectedEmail(refreshedSelected);
      }
    } catch (err: any) {
      applyGmailError(err, 'Ntibishoboye gusoma ubutumwa bwa Gmail.');
    } finally {
      setIsLoadingEmails(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const currentTok = getGmailAccessToken();
    if (currentTok) {
      setAccessToken(currentTok);
      setNeedsAuth(false);
      loadEmails(currentTok, activeQuery);
    } else {
      setNeedsAuth(true);
    }
  }, [isOpen, activeQuery]);

  const handleGoogleSignIn = async () => {
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      const result = await signInWithGoogleForGmail();
      setUser(result.user);
      setAccessToken(result.accessToken);
      setNeedsAuth(false);
      await loadEmails(result.accessToken, activeQuery);
      onToast(`✅ Konti ya ${result.user.email || 'Google'} yahujwe na Izi AI!`);
    } catch (err: any) {
      const rawMsg = String(err?.message || '');
      const msg =
        rawMsg === 'GMAIL_MISSING_SCOPES'
          ? 'Ntiwahisemo uburenganzira bwa Gmail kuri Google. Ongera ukande "Sign in with Google", hanyuma ushyire akamenyetso (✓) mu tuzu twose twa Gmail mbere yo gukanda Continue.'
          : err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request'
            ? 'Wafunze cyangwa wahagaritse kwinjira na Google. Ongera ugerageze.'
            : rawMsg || 'Kwinjira na Google byanze. Ongera ugerageze.';
      setAuthError(msg);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleCancelGoogleSignIn = () => {
    cancelGmailSignIn();
    setIsLoggingIn(false);
    setAuthError(null);
  };

  const handleSignOut = async () => {
    await signOutGmail();
    setUser(null);
    setAccessToken(null);
    setNeedsAuth(true);
    setEmails([]);
    setSelectedEmail(null);
    setReplyText('');
    setShowSendConfirm(false);
    onToast('Wasohotse muri konti ya Gmail.');
  };

  const handleSelectFilter = (mode: 'inbox' | 'unread') => {
    setFilterMode(mode);
    const searchTerm = searchInput.trim();
    const base = mode === 'unread' ? 'is:unread in:inbox' : 'in:inbox';
    setActiveQuery(searchTerm ? `${base} ${searchTerm}` : base);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const base = filterMode === 'unread' ? 'is:unread in:inbox' : 'in:inbox';
    const searchTerm = searchInput.trim();
    setActiveQuery(searchTerm ? `${base} ${searchTerm}` : base);
  };

  const handleSelectEmail = (email: GmailMessage) => {
    setSelectedEmail(email);
    setReplyText('');
    setSendError(null);
    setSentSuccessId(null);
    setShowSendConfirm(false);
  };

  const handleGenerateAiDraft = async (presetInstruction?: string) => {
    if (!selectedEmail) return;
    const instructionToUse = presetInstruction ?? aiInstruction;
    if (presetInstruction) {
      setAiInstruction(presetInstruction);
    }
    setIsDrafting(true);
    setSendError(null);
    try {
      const draft = await draftEmailReplyWithIziAI(selectedEmail, instructionToUse, selectedModel);
      setReplyText(draft);
    } catch (err: any) {
      onToast(`⚠️ Byanze kwandika igisubizo: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsDrafting(false);
    }
  };

  const handleConfirmedSend = async () => {
    if (!selectedEmail || !replyText.trim()) return;
    const token = accessToken || getGmailAccessToken();
    if (!token) {
      setShowSendConfirm(false);
      setNeedsAuth(true);
      return;
    }

    setIsSending(true);
    setSendError(null);
    try {
      await sendGmailReply(token, {
        to: selectedEmail.replyTo || selectedEmail.fromEmail,
        subject: selectedEmail.subject,
        body: replyText.trim(),
        threadId: selectedEmail.threadId,
        inReplyTo: selectedEmail.messageIdHeader,
        references: selectedEmail.referencesHeader,
      });
      setShowSendConfirm(false);
      setSentSuccessId(selectedEmail.id);
      setReplyText('');
      setAiInstruction('');
      onToast(`📧 Igisubizo cyoherejwe kuri ${selectedEmail.replyTo || selectedEmail.fromEmail}!`);
    } catch (err: any) {
      const rawMsg = String(err?.message || '');
      if (rawMsg === 'GMAIL_MISSING_SCOPES') {
        setShowSendConfirm(false);
        setAccessToken(null);
        setNeedsAuth(true);
        setAuthError(
          'Ntiwahisemo uburenganzira bwo kohereza Gmail. Ongera winjire na Google ushyire akamenyetso (✓) ku burenganzira bwose bwa Gmail.'
        );
      } else if (rawMsg === 'GMAIL_AUTH_EXPIRED') {
        setShowSendConfirm(false);
        setAccessToken(null);
        setNeedsAuth(true);
        setAuthError('Uburenganzira bwa Gmail bwarangiye. Injira nanone kugira ngo wohereze.');
      } else if (rawMsg.startsWith('GMAIL_API_DISABLED:')) {
        setShowSendConfirm(false);
        setEmailLoadError(rawMsg);
      } else {
        setSendError(rawMsg || 'Kohereza Email byanze. Ongera ugerageze.');
      }
    } finally {
      setIsSending(false);
    }
  };

  const formatEmailDate = (rawDate: string) => {
    if (!rawDate) return '';
    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) return rawDate.slice(0, 16);
    const now = new Date();
    const sameDay = parsed.toDateString() === now.toDateString();
    return sameDay
      ? parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : parsed.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#313d45] shadow-2xl rounded-2xl w-full max-w-4xl h-[88vh] max-h-[760px] flex flex-col overflow-hidden relative"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-[#2f3b43] bg-[#f8fafc] dark:bg-[#182229] shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                  <Mail size={20} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-sm sm:text-base text-gray-900 dark:text-white truncate">
                    Subiza ubutumwa kuri Email
                  </h3>
                  <p className="text-[11px] text-gray-500 dark:text-[#8696a0] truncate">
                    {!needsAuth && user?.email
                      ? `Yahujwe: ${user.email}`
                      : 'Soma kandi usubize ubutumwa bwa Gmail ukoresheje Izi AI'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {!needsAuth && accessToken && (
                  <>
                    <button
                      type="button"
                      onClick={() => loadEmails(accessToken, activeQuery)}
                      disabled={isLoadingEmails}
                      title="Refresh Inbox"
                      className="p-2 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-[#2a3942] transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw size={16} className={isLoadingEmails ? 'animate-spin' : ''} />
                    </button>
                    <button
                      type="button"
                      onClick={handleSignOut}
                      title="Sign out"
                      className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-[#2a3942] transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <LogOut size={14} />
                      <span className="hidden sm:inline">Sohoka</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close Email modal"
                  className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-xl hover:bg-gray-200/70 dark:hover:bg-[#2a3942] transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Body */}
            {needsAuth || !accessToken ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-[#f0f2f5]/50 dark:bg-[#111b21]/50">
                <div className="w-16 h-16 rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center mb-4">
                  <Mail size={32} />
                </div>
                <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                  Huza konti yawe ya Gmail
                </h4>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-[#8696a0] max-w-md mb-6 leading-relaxed">
                  Injira ukoresheje Google kugira ngo Izi AI igufashe gusoma ubutumwa bwawe bwa Gmail no gutegura ibisubizo. Nta butumwa bwoherezwa utabanje kubyemeza wowe ubwawe.
                </p>

                {authError && (
                  <div className="mb-4 max-w-md w-full rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
                    {authError}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={isLoggingIn}
                  className="gsi-material-button shadow-sm"
                >
                  <div className="gsi-material-button-state"></div>
                  <div className="gsi-material-button-content-wrapper">
                    <div className="gsi-material-button-icon">
                      <svg
                        version="1.1"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 48 48"
                        style={{ display: 'block' }}
                      >
                        <path
                          fill="#EA4335"
                          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                        />
                        <path
                          fill="#4285F4"
                          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                        />
                        <path
                          fill="#34A853"
                          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                        />
                        <path fill="none" d="M0 0h48v48H0z" />
                      </svg>
                    </div>
                    <span className="gsi-material-button-contents">
                      {isLoggingIn ? 'Tegereza...' : 'Sign in with Google'}
                    </span>
                    <span style={{ display: 'none' }}>Sign in with Google</span>
                  </div>
                </button>

                {isLoggingIn && (
                  <button
                    type="button"
                    onClick={handleCancelGoogleSignIn}
                    className="mt-3 text-xs font-semibold text-gray-500 hover:text-gray-800 dark:text-[#8696a0] dark:hover:text-white underline cursor-pointer"
                  >
                    Hagarika / Ongera ugerageze (Cancel)
                  </button>
                )}
              </div>
            ) : (
              <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12">
                {/* Left Column: Inbox List */}
                <div
                  className={`${
                    selectedEmail ? 'hidden md:flex' : 'flex'
                  } md:col-span-5 flex-col border-r border-gray-200 dark:border-[#2f3b43] min-h-0 bg-white dark:bg-[#1b262c]`}
                >
                  <div className="p-3 border-b border-gray-200 dark:border-[#2f3b43] space-y-2 shrink-0">
                    <form onSubmit={handleSearchSubmit} className="relative flex items-center gap-1.5">
                      <div className="relative flex-1">
                        <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
                        <input
                          type="text"
                          value={searchInput}
                          onChange={(e) => setSearchInput(e.target.value)}
                          placeholder="Shakisha muri Email..."
                          className="w-full bg-gray-100 dark:bg-[#2a3942] text-gray-900 dark:text-[#e9edef] text-xs pl-8 pr-3 py-2 rounded-xl border border-transparent focus:border-[#00a884] focus:outline-none"
                        />
                      </div>
                      <button
                        type="submit"
                        className="px-3 py-2 rounded-xl bg-[#075E54] hover:bg-[#128C7E] dark:bg-[#00a884] text-white text-xs font-semibold cursor-pointer shrink-0"
                      >
                        Shaka
                      </button>
                    </form>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSelectFilter('inbox')}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                          filterMode === 'inbox'
                            ? 'bg-[#075E54] dark:bg-[#00a884] text-white'
                            : 'bg-gray-100 dark:bg-[#2a3942] text-gray-600 dark:text-gray-300'
                        }`}
                      >
                        Inbox yose
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectFilter('unread')}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                          filterMode === 'unread'
                            ? 'bg-[#075E54] dark:bg-[#00a884] text-white'
                            : 'bg-gray-100 dark:bg-[#2a3942] text-gray-600 dark:text-gray-300'
                        }`}
                      >
                        Izitasomwe (Unread)
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-[#2a3942]">
                    {isLoadingEmails ? (
                      <div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-[#8696a0] gap-2">
                        <Loader2 size={24} className="animate-spin text-[#00a884]" />
                        <span className="text-xs">Turimo gusoma Inbox...</span>
                      </div>
                    ) : emailLoadError ? (
                      <div className="p-4 text-center space-y-2.5">
                        {emailLoadError.startsWith('GMAIL_API_DISABLED:') ? (
                          <>
                            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                              Gmail API ntabwo irafungurwa kuri iyi porogaramu muri Google Cloud Project. Kanda hasi uyifungure maze ugaruke ukande Refresh.
                            </p>
                            <div className="flex flex-wrap items-center justify-center gap-2">
                              <a
                                href={emailLoadError.replace('GMAIL_API_DISABLED:', '')}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-3 py-1.5 rounded-lg bg-[#075E54] hover:bg-[#128C7E] text-white text-xs font-bold inline-block"
                              >
                                Fungura Gmail API
                              </a>
                              <button
                                type="button"
                                onClick={() => loadEmails(accessToken, activeQuery)}
                                className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-[#2a3942] text-xs font-semibold text-gray-800 dark:text-white cursor-pointer"
                              >
                                Ongera ugerageze
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="text-xs text-red-600 dark:text-red-400">{emailLoadError}</p>
                            <button
                              type="button"
                              onClick={() => loadEmails(accessToken, activeQuery)}
                              className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-[#2a3942] text-xs font-semibold text-gray-800 dark:text-white cursor-pointer"
                            >
                              Ongera ugerageze
                            </button>
                          </>
                        )}
                      </div>
                    ) : emails.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 px-4 text-center text-gray-400 dark:text-[#8696a0]">
                        <Inbox size={28} className="mb-2 opacity-60" />
                        <p className="text-xs font-medium">Nta butumwa bwabonetse.</p>
                      </div>
                    ) : (
                      emails.map((email) => {
                        const isSelected = selectedEmail?.id === email.id;
                        return (
                          <button
                            key={email.id}
                            type="button"
                            onClick={() => handleSelectEmail(email)}
                            className={`w-full text-left p-3 transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-emerald-50 dark:bg-[#005c4b]/35 border-l-4 border-[#00a884]'
                                : 'hover:bg-gray-50 dark:hover:bg-[#202c33]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-0.5">
                              <span className="flex items-center gap-1.5 min-w-0">
                                {email.unread && (
                                  <span className="w-2 h-2 rounded-full bg-[#25D366] shrink-0" />
                                )}
                                <span
                                  className={`text-xs truncate ${
                                    email.unread
                                      ? 'font-bold text-gray-900 dark:text-white'
                                      : 'font-semibold text-gray-700 dark:text-gray-200'
                                  }`}
                                >
                                  {email.fromName}
                                </span>
                              </span>
                              <span className="text-[10px] text-gray-400 dark:text-[#8696a0] shrink-0">
                                {formatEmailDate(email.date)}
                              </span>
                            </div>
                            <p
                              className={`text-xs truncate ${
                                email.unread
                                  ? 'font-semibold text-gray-900 dark:text-[#e9edef]'
                                  : 'text-gray-700 dark:text-[#cbd5e1]'
                              }`}
                            >
                              {email.subject}
                            </p>
                            <p className="text-[11px] text-gray-500 dark:text-[#8696a0] line-clamp-2 mt-0.5">
                              {email.snippet}
                            </p>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Right Column: Selected Email & Reply Composer */}
                <div
                  className={`${
                    selectedEmail ? 'flex' : 'hidden md:flex'
                  } md:col-span-7 flex-col min-h-0 bg-[#f8fafc] dark:bg-[#111b21]`}
                >
                  {!selectedEmail ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-gray-400 dark:text-[#8696a0]">
                      <Mail size={36} className="mb-2 opacity-50" />
                      <p className="text-sm font-medium">Hitamo Email ibumoso kugira ngo uyisome kandi uyisubize</p>
                    </div>
                  ) : (
                    <>
                      {/* Email Detail Header */}
                      <div className="p-3.5 border-b border-gray-200 dark:border-[#2f3b43] bg-white dark:bg-[#202c33] shrink-0">
                        <button
                          type="button"
                          onClick={() => setSelectedEmail(null)}
                          className="md:hidden inline-flex items-center gap-1 text-xs font-semibold text-[#075E54] dark:text-[#00FF88] mb-2 cursor-pointer"
                        >
                          <ArrowLeft size={14} /> Subira kuri Inbox
                        </button>
                        <h4 className="text-sm sm:text-base font-bold text-gray-900 dark:text-white leading-snug">
                          {selectedEmail.subject}
                        </h4>
                        <div className="flex flex-wrap items-center justify-between gap-2 mt-1 text-xs text-gray-600 dark:text-[#8696a0]">
                          <span className="truncate">
                            <strong className="text-gray-800 dark:text-gray-200">{selectedEmail.fromName}</strong>{' '}
                            {selectedEmail.fromEmail ? `<${selectedEmail.fromEmail}>` : ''}
                          </span>
                          <span className="text-[11px]">{formatEmailDate(selectedEmail.date)}</span>
                        </div>
                      </div>

                      {/* Email Body */}
                      <div className="flex-1 overflow-y-auto p-4 text-xs sm:text-sm text-gray-800 dark:text-[#e9edef] whitespace-pre-wrap leading-relaxed bg-white/70 dark:bg-[#111b21]">
                        {selectedEmail.body || selectedEmail.snippet || '(Nta magambo arimo)'}
                      </div>

                      {/* Composer Section */}
                      <div className="p-3.5 border-t border-gray-200 dark:border-[#2f3b43] bg-white dark:bg-[#202c33] space-y-2.5 shrink-0">
                        {sentSuccessId === selectedEmail.id && (
                          <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 size={15} />
                            <span>Igisubizo cyoherejwe neza kuri {selectedEmail.replyTo || selectedEmail.fromEmail}!</span>
                          </div>
                        )}

                        {sendError && (
                          <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                            {sendError}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-semibold text-gray-500 dark:text-[#8696a0] mr-1">
                            Izi AI Draft:
                          </span>
                          {[
                            { label: 'Kinyarwanda (Nshimira)', prompt: 'Subiza mu Kinyarwanda cyiza wubaha kandi ushimira.' },
                            { label: 'English (Polite)', prompt: 'Write a clear, polite and professional reply in English.' },
                            { label: 'Emeza gahunda', prompt: 'Subiza wemeza ko wakiriye ubutumwa kandi witeguye gahunda.' },
                          ].map((preset) => (
                            <button
                              key={preset.label}
                              type="button"
                              disabled={isDrafting}
                              onClick={() => handleGenerateAiDraft(preset.prompt)}
                              className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-emerald-50 dark:bg-[#2a3942] dark:hover:bg-[#005c4b]/40 text-[11px] font-medium text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-[#374248] transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={aiInstruction}
                            onChange={(e) => setAiInstruction(e.target.value)}
                            placeholder="Bwira Izi AI icyo yandika mu gisubizo (urugero: mubwire ko nzaza ejo)..."
                            className="flex-1 bg-gray-100 dark:bg-[#2a3942] text-gray-900 dark:text-[#e9edef] text-xs px-3 py-2 rounded-xl border border-transparent focus:border-[#00a884] focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleGenerateAiDraft()}
                            disabled={isDrafting}
                            className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 dark:bg-[#00a884] dark:hover:bg-[#008f6f] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60 shrink-0"
                          >
                            {isDrafting ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Sparkles size={14} />
                            )}
                            <span>{isDrafting ? 'Arimo kwandika...' : 'Andikisha AI'}</span>
                          </button>
                        </div>

                        <textarea
                          rows={4}
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder={`Andika igisubizo kuri ${selectedEmail.replyTo || selectedEmail.fromEmail}...`}
                          className="w-full bg-gray-50 dark:bg-[#111b21] text-gray-900 dark:text-[#e9edef] text-xs sm:text-sm p-3 rounded-xl border border-gray-200 dark:border-[#313d45] focus:border-[#00a884] focus:outline-none resize-y"
                        />

                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-gray-500 dark:text-[#8696a0] truncate">
                            Kuri: {selectedEmail.replyTo || selectedEmail.fromEmail}
                          </span>
                          <button
                            type="button"
                            disabled={!replyText.trim() || isSending}
                            onClick={() => setShowSendConfirm(true)}
                            className="px-4 py-2 rounded-xl bg-[#075E54] hover:bg-[#128C7E] dark:bg-[#00a884] dark:hover:bg-[#008f6f] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm shrink-0"
                          >
                            <Send size={14} />
                            <span>Ohereza Igisubizo</span>
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Explicit User Confirmation Dialog Before Sending Email */}
            {showSendConfirm && selectedEmail && (
              <div
                className="absolute inset-0 z-20 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
                onClick={() => !isSending && setShowSendConfirm(false)}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="bg-white dark:bg-[#1e2930] border border-gray-200 dark:border-[#374248] rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                      <AlertTriangle size={20} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-gray-900 dark:text-white">
                        Emeza kohereza iyi Email?
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-[#8696a0]">
                        Iyi Email irahita yoherezwa kuri konti yawe ya Gmail.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl bg-gray-50 dark:bg-[#111b21] border border-gray-200 dark:border-[#2f3b43] p-3 space-y-1.5 text-xs">
                    <p className="text-gray-700 dark:text-gray-200 break-all">
                      <strong>Kuri (To):</strong> {selectedEmail.replyTo || selectedEmail.fromEmail}
                    </p>
                    <p className="text-gray-700 dark:text-gray-200 break-words">
                      <strong>Umutwe (Subject):</strong> {formatReplySubject(selectedEmail.subject)}
                    </p>
                    <div className="pt-1.5 border-t border-gray-200 dark:border-[#2f3b43]">
                      <p className="font-semibold text-gray-600 dark:text-gray-400 mb-1">Ubutumwa:</p>
                      <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-gray-800 dark:text-[#e9edef]">
                        {replyText.trim()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={isSending}
                      onClick={() => setShowSendConfirm(false)}
                      className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2a3942] cursor-pointer"
                    >
                      Reka (Cancel)
                    </button>
                    <button
                      type="button"
                      disabled={isSending}
                      onClick={handleConfirmedSend}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-[#075E54] hover:bg-[#128C7E] dark:bg-[#00a884] text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                    >
                      {isSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      <span>{isSending ? 'Irkoherezwa...' : 'Emeza & Ohereza'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
