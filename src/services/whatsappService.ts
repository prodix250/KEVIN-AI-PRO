/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  generateWhatsAppAutoReply,
  appendAgentOutbox,
  playWhatsAppSound,
  sanitizePhoneNumber,
  formatWhatsAppPhoneNumber,
  isLikelyPhoneNumber,
  getSavedContacts,
} from './geminiService';

export interface WhatsAppChatItem {
  id: string;
  sender: string;
  phoneNumber?: string;
  message: string;
  timestamp: number;
  unread: boolean;
  notificationKey?: string;
  canReplyDirectly?: boolean;
  repliedText?: string;
}

const WHATSAPP_INBOX_STORAGE_KEY = 'kevin_ai_whatsapp_inbox';

const INITIAL_SAMPLE_CHATS: WhatsAppChatItem[] = [];
const LEGACY_SAMPLE_IDS = new Set(['wa_sample_1', 'wa_sample_2', 'wa_sample_3']);

export function getStoredWhatsAppChats(): WhatsAppChatItem[] {
  if (typeof window === 'undefined') return INITIAL_SAMPLE_CHATS;
  try {
    const raw = localStorage.getItem(WHATSAPP_INBOX_STORAGE_KEY);
    if (!raw) return INITIAL_SAMPLE_CHATS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return INITIAL_SAMPLE_CHATS;
    const cleaned = parsed.filter(
      (c: any) => c && typeof c === 'object' && !LEGACY_SAMPLE_IDS.has(String(c.id || ''))
    );
    if (cleaned.length !== parsed.length) {
      localStorage.setItem(WHATSAPP_INBOX_STORAGE_KEY, JSON.stringify(cleaned));
    }
    return cleaned;
  } catch {
    return INITIAL_SAMPLE_CHATS;
  }
}

export function saveStoredWhatsAppChats(chats: WhatsAppChatItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(WHATSAPP_INBOX_STORAGE_KEY, JSON.stringify(chats));
  } catch (err) {
    console.error('Unable to save WhatsApp chats to localStorage:', err);
  }
}

export async function fetchActiveWhatsAppChats(): Promise<WhatsAppChatItem[]> {
  const stored = getStoredWhatsAppChats();
  const bridge = (window as any).KevinAgentBridge;

  if (bridge?.getActiveWhatsAppMessages) {
    try {
      const raw = bridge.getActiveWhatsAppMessages();
      const activeFromNative = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(activeFromNative) && activeFromNative.length > 0) {
        const merged = [...stored];
        for (const nativeItem of activeFromNative) {
          const existingIdx = merged.findIndex(
            (c) => c.sender.toLowerCase() === (nativeItem.sender || '').toLowerCase()
          );
          const formattedItem: WhatsAppChatItem = {
            id: nativeItem.id || `wa_notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            sender: nativeItem.sender || 'WhatsApp Contact',
            phoneNumber: nativeItem.phoneNumber || (isLikelyPhoneNumber(nativeItem.sender) ? nativeItem.sender : ''),
            message: nativeItem.message || '',
            timestamp: Number(nativeItem.timestamp || Date.now()),
            unread: true,
            notificationKey: nativeItem.id,
            canReplyDirectly: Boolean(nativeItem.canReplyDirectly),
          };

          if (existingIdx >= 0) {
            merged[existingIdx] = {
              ...merged[existingIdx],
              ...formattedItem,
              message: formattedItem.message || merged[existingIdx].message,
              timestamp: formattedItem.timestamp,
              unread: true,
            };
          } else {
            merged.unshift(formattedItem);
          }
        }
        saveStoredWhatsAppChats(merged);
        return merged;
      }
    } catch (e) {
      console.warn('Unable to parse native WhatsApp notifications:', e);
    }
  }

  return stored;
}

export function addIncomingWhatsAppChat(
  sender: string,
  message: string,
  phoneNumber?: string
): WhatsAppChatItem {
  const chats = getStoredWhatsAppChats();
  const cleanSender = sender.trim() || 'WhatsApp Contact';
  const cleanMessage = message.trim();
  const cleanPhone = phoneNumber ? sanitizePhoneNumber(phoneNumber) : '';

  const newChat: WhatsAppChatItem = {
    id: `wa_user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    sender: cleanSender,
    phoneNumber: cleanPhone,
    message: cleanMessage,
    timestamp: Date.now(),
    unread: true,
  };

  const updated = [newChat, ...chats.filter((c) => c.id !== newChat.id)];
  saveStoredWhatsAppChats(updated);
  return newChat;
}

export function markWhatsAppChatAsRead(id: string): void {
  const chats = getStoredWhatsAppChats();
  const updated = chats.map((c) => (c.id === id ? { ...c, unread: false } : c));
  saveStoredWhatsAppChats(updated);
}

export async function draftWhatsAppReplyWithAI(
  chat: WhatsAppChatItem,
  instruction?: string,
  _model?: string
): Promise<string> {
  const reply = await generateWhatsAppAutoReply(
    chat.sender,
    chat.message,
    instruction?.trim() || undefined
  );
  return reply;
}

export interface WhatsAppRecipientVerification {
  verified: boolean;
  resolvedPhone: string;
  resolvedName: string;
  existsInContacts: boolean;
  existsOnWhatsApp: boolean;
  viaNotification: boolean;
  whatsappInstalled: boolean;
  reason?: string;
}

export function isValidWhatsAppPhoneDigits(raw: string): boolean {
  const digits = formatWhatsAppPhoneNumber(raw).replace(/[^\d]/g, '');
  if (digits.length < 9 || digits.length > 15) return false;
  if (/^(\d)\1{6,}$/.test(digits)) return false;
  if (digits.startsWith('250')) {
    return /^2507[2389]\d{7}$/.test(digits);
  }
  return true;
}

export function verifyWhatsAppRecipient(
  chat: WhatsAppChatItem,
  overridePhone?: string
): WhatsAppRecipientVerification {
  const bridge = typeof window !== 'undefined' ? (window as any).KevinAgentBridge : null;
  const trimmedOverride = overridePhone?.trim() || '';
  const hasExplicitOverride = trimmedOverride.length > 0;

  let candidatePhone =
    trimmedOverride ||
    chat.phoneNumber?.trim() ||
    (isLikelyPhoneNumber(chat.sender) ? chat.sender : '');

  let matchedSavedName = '';
  const contacts = getSavedContacts();
  const exactSaved = contacts.find(
    (c) => c.name.toLowerCase() === (chat.sender || '').trim().toLowerCase()
  );
  if (!candidatePhone && exactSaved?.phone) {
    candidatePhone = exactSaved.phone;
    matchedSavedName = exactSaved.name;
  } else if (exactSaved) {
    matchedSavedName = exactSaved.name;
  }

  const candidateDigits = candidatePhone ? formatWhatsAppPhoneNumber(candidatePhone) : '';
  const viaNotification = Boolean(
    !hasExplicitOverride &&
      chat.notificationKey &&
      chat.canReplyDirectly &&
      bridge?.replyToWhatsAppNotification
  );

  let nativeInfo: {
    whatsappInstalled?: boolean;
    hasContactsPermission?: boolean;
    existsInContacts?: boolean;
    existsOnWhatsApp?: boolean;
    resolvedName?: string;
    resolvedPhone?: string;
  } | null = null;

  if (bridge?.verifyWhatsAppRecipientJson) {
    try {
      const queryTarget = candidateDigits || chat.sender || '';
      const raw = bridge.verifyWhatsAppRecipientJson(queryTarget);
      nativeInfo = JSON.parse(raw || '{}');
    } catch {
      nativeInfo = null;
    }
  }

  const whatsappInstalled = nativeInfo ? Boolean(nativeInfo.whatsappInstalled) : true;
  const nativePhone = nativeInfo?.resolvedPhone ? formatWhatsAppPhoneNumber(nativeInfo.resolvedPhone) : '';
  const finalDigits = isValidWhatsAppPhoneDigits(candidateDigits)
    ? candidateDigits
    : isValidWhatsAppPhoneDigits(nativePhone)
      ? nativePhone
      : '';
  const resolvedName =
    nativeInfo?.resolvedName?.trim() || matchedSavedName || chat.sender || (finalDigits ? `+${finalDigits}` : '');
  const existsInContacts = Boolean(exactSaved || nativeInfo?.existsInContacts);
  const existsOnWhatsApp = Boolean(viaNotification || nativeInfo?.existsOnWhatsApp);

  if (nativeInfo && !whatsappInstalled) {
    return {
      verified: false,
      resolvedPhone: finalDigits,
      resolvedName,
      existsInContacts,
      existsOnWhatsApp: false,
      viaNotification: false,
      whatsappInstalled: false,
      reason: 'WhatsApp App ntabwo irimo muri iyi telefone. Banza ushyiremo WhatsApp App mbere yo kohereza.',
    };
  }

  if (viaNotification) {
    return {
      verified: true,
      resolvedPhone: finalDigits,
      resolvedName,
      existsInContacts,
      existsOnWhatsApp: true,
      viaNotification: true,
      whatsappInstalled,
    };
  }

  if (!finalDigits) {
    if (hasExplicitOverride) {
      return {
        verified: false,
        resolvedPhone: '',
        resolvedName,
        existsInContacts,
        existsOnWhatsApp: false,
        viaNotification: false,
        whatsappInstalled,
        reason: 'Nimero washyizemo ntabwo yuzuye cyangwa ntabwo ari iyo kuri WhatsApp. Reba ko itangizwa na +2507... cyangwa code y’igihugu.',
      };
    }
    return {
      verified: false,
      resolvedPhone: '',
      resolvedName,
      existsInContacts,
      existsOnWhatsApp: false,
      viaNotification: false,
      whatsappInstalled,
      reason: `"${chat.sender}" nta nimero yemewe afite muri Contacts cyangwa kuri WhatsApp. Shyiramo nimero nyayo kugira ngo ubutumwa bugende muri WhatsApp App.`,
    };
  }

  if (!isValidWhatsAppPhoneDigits(finalDigits)) {
    return {
      verified: false,
      resolvedPhone: '',
      resolvedName,
      existsInContacts,
      existsOnWhatsApp: false,
      viaNotification: false,
      whatsappInstalled,
      reason: 'Iyi nimero ntabwo yemewe kuri WhatsApp. Nyamuneka shyiramo nimero y’ukuri.',
    };
  }

  return {
    verified: true,
    resolvedPhone: finalDigits,
    resolvedName,
    existsInContacts,
    existsOnWhatsApp,
    viaNotification: false,
    whatsappInstalled,
  };
}

export async function sendWhatsAppReplyAction(
  chat: WhatsAppChatItem,
  replyText: string,
  overridePhone?: string
): Promise<{
  success: boolean;
  method: 'native_direct' | 'native_app' | 'whatsapp_app';
  recipientName: string;
  recipientPhone: string;
}> {
  const text = replyText.trim();
  if (!text) throw new Error('Igisubizo ntigishobora kuba cyera.');

  const verification = verifyWhatsAppRecipient(chat, overridePhone);
  if (!verification.verified) {
    throw new Error(
      verification.reason || 'Uwahoze ategerejwe ntabwo abonetse kuri WhatsApp.'
    );
  }

  const bridge = typeof window !== 'undefined' ? (window as any).KevinAgentBridge : null;
  const recipientLabel = verification.resolvedName || chat.sender || verification.resolvedPhone;

  // 1. Direct silent reply via active WhatsApp notification RemoteInput
  if (verification.viaNotification && chat.notificationKey && bridge?.replyToWhatsAppNotification) {
    try {
      const directSent = Boolean(bridge.replyToWhatsAppNotification(chat.notificationKey, text));
      if (directSent) {
        appendAgentOutbox({
          channel: 'whatsapp',
          recipient: recipientLabel,
          incoming: chat.message,
          message: text,
          status: 'sent',
        });
        playWhatsAppSound('send');
        markWhatsAppChatAsReplied(chat.id, text);
        return {
          success: true,
          method: 'native_direct',
          recipientName: recipientLabel,
          recipientPhone: verification.resolvedPhone,
        };
      }
    } catch {
      // Fall through to WhatsApp App intent if notification expired
    }
  }

  if (!verification.resolvedPhone) {
    throw new Error('Notification ya WhatsApp yarangiye kandi nta nimero yemewe yabonetse. Shyiramo nimero ye ya WhatsApp.');
  }

  // 2. Native Android send via WhatsApp App (com.whatsapp / com.whatsapp.w4b + Accessibility auto-send)
  if (bridge?.sendWhatsApp) {
    const sent = Boolean(bridge.sendWhatsApp(verification.resolvedPhone, text));
    if (!sent) {
      throw new Error('WhatsApp App ntiyabashije gufunguka cyangwa nimero ntibaho muri WhatsApp.');
    }
    appendAgentOutbox({
      channel: 'whatsapp',
      recipient: verification.resolvedName
        ? `${verification.resolvedName} (+${verification.resolvedPhone})`
        : `+${verification.resolvedPhone}`,
      incoming: chat.message,
      message: text,
      status: 'sent',
    });
    playWhatsAppSound('send');
    markWhatsAppChatAsReplied(chat.id, text);
    return {
      success: true,
      method: 'native_app',
      recipientName: recipientLabel,
      recipientPhone: verification.resolvedPhone,
    };
  }

  // 3. Direct WhatsApp App URI scheme (never opens WhatsApp Web / wa.me)
  const waAppUrl = `whatsapp://send?phone=${verification.resolvedPhone}&text=${encodeURIComponent(text)}`;
  if (typeof document !== 'undefined') {
    const link = document.createElement('a');
    link.href = waAppUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  appendAgentOutbox({
    channel: 'whatsapp',
    recipient: verification.resolvedName
      ? `${verification.resolvedName} (+${verification.resolvedPhone})`
      : `+${verification.resolvedPhone}`,
    incoming: chat.message,
    message: text,
    status: 'sent',
  });
  playWhatsAppSound('send');
  markWhatsAppChatAsReplied(chat.id, text);
  return {
    success: true,
    method: 'whatsapp_app',
    recipientName: recipientLabel,
    recipientPhone: verification.resolvedPhone,
  };
}

function markWhatsAppChatAsReplied(id: string, replyText: string): void {
  const chats = getStoredWhatsAppChats();
  const updated = chats.map((c) =>
    c.id === id ? { ...c, unread: false, repliedText: replyText } : c
  );
  saveStoredWhatsAppChats(updated);
}
