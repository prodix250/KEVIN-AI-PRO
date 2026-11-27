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

const INITIAL_SAMPLE_CHATS: WhatsAppChatItem[] = [
  {
    id: 'wa_sample_1',
    sender: 'Aline Mugabo',
    phoneNumber: '+250788123456',
    message: 'Muraho Kevin! Waramutse ute? Ese warangije gusuzuma ya dosiye ya projet twavuganaga ejo?',
    timestamp: Date.now() - 18 * 60 * 1000,
    unread: true,
  },
  {
    id: 'wa_sample_2',
    sender: 'Eric Nkurunziza',
    phoneNumber: '+250789654321',
    message: 'Bite bro! Uyu munsi uraboneka saa cyenda (3:00 PM) tuganire ku kibazo cya system?',
    timestamp: Date.now() - 75 * 60 * 1000,
    unread: true,
  },
  {
    id: 'wa_sample_3',
    sender: 'Clarisse Umutoni',
    phoneNumber: '+250783112233',
    message: 'Urakoze cyane ku bufasha waduhaye. Waba uzi igihe gahunda nshya izatangirira?',
    timestamp: Date.now() - 210 * 60 * 1000,
    unread: false,
    repliedText: 'Muraho Clarisse! Gahunda izatangira ku wa Mbere mugitondo.',
  },
];

export function getStoredWhatsAppChats(): WhatsAppChatItem[] {
  if (typeof window === 'undefined') return INITIAL_SAMPLE_CHATS;
  try {
    const raw = localStorage.getItem(WHATSAPP_INBOX_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(WHATSAPP_INBOX_STORAGE_KEY, JSON.stringify(INITIAL_SAMPLE_CHATS));
      return INITIAL_SAMPLE_CHATS;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_SAMPLE_CHATS;
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

export async function sendWhatsAppReplyAction(
  chat: WhatsAppChatItem,
  replyText: string,
  overridePhone?: string
): Promise<{ success: boolean; method: 'native_app' | 'web_link' }> {
  const text = replyText.trim();
  if (!text) throw new Error('Igisubizo ntigishobora kuba cyera.');

  const effectivePhone =
    overridePhone?.trim() ||
    chat.phoneNumber?.trim() ||
    (isLikelyPhoneNumber(chat.sender) ? chat.sender : '');

  // Look up phone in contacts if not available
  let matchedPhone = effectivePhone;
  if (!matchedPhone) {
    const contacts = getSavedContacts();
    const match = contacts.find(
      (c) => c.name.toLowerCase() === chat.sender.toLowerCase()
    );
    if (match?.phone) {
      matchedPhone = match.phone;
    }
  }

  const bridge = (window as any).KevinAgentBridge;

  // 1. Native Android send via KevinAgentBridge
  if (bridge?.sendWhatsApp && matchedPhone) {
    try {
      bridge.sendWhatsApp(matchedPhone, text);
      appendAgentOutbox({
        channel: 'whatsapp',
        recipient: chat.sender || matchedPhone,
        incoming: chat.message,
        message: text,
        status: 'sent',
      });
      playWhatsAppSound('send');
      markWhatsAppChatAsReplied(chat.id, text);
      return { success: true, method: 'native_app' };
    } catch {
      // fallback
    }
  }

  // 2. Web or fallback: open WhatsApp link
  const formattedDigits = matchedPhone ? formatWhatsAppPhoneNumber(matchedPhone) : '';
  const waUrl = formattedDigits
    ? `https://wa.me/${formattedDigits}?text=${encodeURIComponent(text)}`
    : `https://web.whatsapp.com/send?text=${encodeURIComponent(text)}`;

  if (typeof window !== 'undefined') {
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  }

  appendAgentOutbox({
    channel: 'whatsapp',
    recipient: chat.sender || matchedPhone || 'WhatsApp Chat',
    incoming: chat.message,
    message: text,
    status: 'sent',
  });
  playWhatsAppSound('send');
  markWhatsAppChatAsReplied(chat.id, text);
  return { success: true, method: 'web_link' };
}

function markWhatsAppChatAsReplied(id: string, replyText: string): void {
  const chats = getStoredWhatsAppChats();
  const updated = chats.map((c) =>
    c.id === id ? { ...c, unread: false, repliedText: replyText } : c
  );
  saveStoredWhatsAppChats(updated);
}
