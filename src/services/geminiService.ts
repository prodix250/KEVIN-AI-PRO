import kevin2Url from '../assets/kevin_2.jpg';

export interface AttachmentItem {
  data?: string;
  base64?: string;
  blob?: Blob;
  mimeType: string;
  name?: string;
  size?: string;
  textContent?: string;
}

export interface AgentPermissions {
  autoSend: boolean;
  autoCall: boolean;
  autoPlayYouTube: boolean;
  whatsappAutoReply: boolean;
  whatsappReplyStyle: string;
}

export interface NativeAgentStatus {
  isAndroid: boolean;
  hasSmsPermission?: boolean;
  hasCallPermission?: boolean;
  hasContactsPermission?: boolean;
  hasMicPermission?: boolean;
  hasAccessibility?: boolean;
  hasNotificationAccess?: boolean;
  isDefaultAssistant?: boolean;
  autoSendEnabled?: boolean;
  whatsappAutoReplyEnabled?: boolean;
  wakeWordEnabled?: boolean;
}

export interface AgentOutboxItem {
  id: string;
  channel: 'sms' | 'whatsapp' | 'whatsapp-autoreply' | 'call';
  recipient: string;
  incoming?: string;
  message: string;
  timestamp: string;
  status: 'sent' | 'queued';
}

export interface SavedContact {
  id: string;
  name: string;
  phone: string;
}

export const CHAT_HISTORY_STORAGE_KEY = 'kevin_ai_chat_history';
export const AGENT_PERMISSIONS_STORAGE_KEY = 'kevin_ai_agent_permissions';
export const AGENT_OUTBOX_STORAGE_KEY = 'kevin_ai_agent_outbox';
export const CONTACTS_STORAGE_KEY = 'kevin_ai_contacts';

const DEFAULT_AGENT_PERMISSIONS: AgentPermissions = {
  autoSend: true,
  autoCall: true,
  autoPlayYouTube: true,
  whatsappAutoReply: false,
  whatsappReplyStyle: '',
};

export function getAgentPermissions(): AgentPermissions {
  if (typeof window === 'undefined') return DEFAULT_AGENT_PERMISSIONS;
  try {
    const raw = window.localStorage.getItem(AGENT_PERMISSIONS_STORAGE_KEY);
    if (!raw) return DEFAULT_AGENT_PERMISSIONS;
    return { ...DEFAULT_AGENT_PERMISSIONS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_AGENT_PERMISSIONS;
  }
}

export function saveAgentPermissions(perms: AgentPermissions): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AGENT_PERMISSIONS_STORAGE_KEY, JSON.stringify(perms));
    const userName = window.localStorage.getItem('kevin_user_name')
      || window.localStorage.getItem('kevin_ai_user_name')
      || 'Kevin';
    const backendBaseUrl = isCapacitorApkRuntime() ? PRODUCTION_BACKEND_URL : window.location.origin;
    const bridge = (window as any).KevinAgentBridge;
    if (bridge?.setAgentConfig) {
      bridge.setAgentConfig(
        Boolean(perms.autoSend),
        Boolean(perms.whatsappAutoReply),
        perms.whatsappReplyStyle || '',
        userName,
        backendBaseUrl
      );
    }
    window.dispatchEvent(new CustomEvent('kevinAgentPermissionsUpdated', { detail: perms }));
  } catch (error) {
    console.error('Unable to save Kevin AI agent permissions.', error);
  }
}

export function getNativeAgentStatus(): NativeAgentStatus {
  if (typeof window === 'undefined') return { isAndroid: false };
  try {
    const bridge = (window as any).KevinAgentBridge;
    if (bridge?.getStatusJson) {
      return JSON.parse(bridge.getStatusJson()) as NativeAgentStatus;
    }
  } catch {
    // Not on Android
  }
  return { isAndroid: false };
}

export function getAgentOutbox(): AgentOutboxItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(AGENT_OUTBOX_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AgentOutboxItem[]) : [];
  } catch {
    return [];
  }
}

export function appendAgentOutbox(item: Omit<AgentOutboxItem, 'id' | 'timestamp'>): AgentOutboxItem {
  const entry: AgentOutboxItem = {
    ...item,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
  };
  if (typeof window !== 'undefined') {
    try {
      const prev = getAgentOutbox();
      const updated = [entry, ...prev].slice(0, 50);
      window.localStorage.setItem(AGENT_OUTBOX_STORAGE_KEY, JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent('kevinAgentOutboxUpdated', { detail: updated }));
    } catch {
      // Ignore storage failures
    }
  }
  return entry;
}

export function sanitizePhoneNumber(raw: string): string {
  return String(raw || '').trim().replace(/[^\d+*#]/g, '');
}

export function formatWhatsAppPhoneNumber(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('+')) {
    return trimmed.replace(/[^\d]/g, '');
  }

  let digits = trimmed.replace(/[^\d]/g, '');
  if (!digits) return '';

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (digits.startsWith('250')) {
    return digits;
  }

  // Rwandan local format with leading 0 (e.g. 078..., 079..., 072..., 073...) - 10 digits
  if (digits.startsWith('0') && digits.length === 10) {
    return `250${digits.slice(1)}`;
  }

  // Rwandan local format without leading 0 (e.g. 78..., 79..., 72..., 73...) - 9 digits
  if (digits.length === 9 && digits.startsWith('7')) {
    return `250${digits}`;
  }

  // Any 10-digit number starting with 0 in Rwanda
  if (digits.startsWith('0') && digits.length >= 9 && digits.length <= 11) {
    return `250${digits.replace(/^0+/, '')}`;
  }

  // Standard 9-digit Rwandan number
  if (digits.length === 9) {
    return `250${digits}`;
  }

  return digits;
}

export interface GroundingSource {
  title: string;
  url: string;
}

export function extractMarkdownUrls(text: string): GroundingSource[] {
  const sources: GroundingSource[] = [];
  const seen = new Set<string>();
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(text)) !== null) {
    const title = match[1].trim();
    const url = match[2].trim();
    if (url && !seen.has(url) && !url.includes('image.pollinations.ai') && !url.includes('localhost')) {
      seen.add(url);
      sources.push({ title, url });
    }
  }
  return sources;
}

export function isLikelyPhoneNumber(raw: string): boolean {
  const trimmed = String(raw || '').trim();
  if (!trimmed || /[a-zA-Z]/.test(trimmed)) return false;
  const digits = sanitizePhoneNumber(trimmed).replace(/[^\d]/g, '');
  return digits.length >= 3;
}

function normalizePhoneKey(phone: string): string {
  const clean = phone.replace(/[^\d]/g, '');
  if (clean.length >= 9) return clean.slice(-9);
  return clean;
}

export function getSavedContacts(): SavedContact[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CONTACTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((c: any) => ({
        id: String(c.id || c.phone || Math.random()),
        name: String(c.name || '').trim(),
        phone: sanitizePhoneNumber(c.phone || ''),
      })).filter((c: SavedContact) => c.name && c.phone);
    }
  } catch {
    // ignore
  }
  return [];
}

export function saveContact(name: string, phone: string): SavedContact[] {
  const cleanName = name.trim();
  const cleanPhone = sanitizePhoneNumber(phone);
  const contacts = getSavedContacts();
  const existingIndex = contacts.findIndex((c) => normalizePhoneKey(c.phone) === normalizePhoneKey(cleanPhone));
  const newContact: SavedContact = {
    id: existingIndex >= 0 ? contacts[existingIndex].id : `contact-${Date.now()}`,
    name: cleanName,
    phone: cleanPhone,
  };
  if (existingIndex >= 0) {
    contacts[existingIndex] = newContact;
  } else {
    contacts.unshift(newContact);
  }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
    window.dispatchEvent(new CustomEvent('kevinContactsUpdated', { detail: contacts }));
  }
  return contacts;
}

export function deleteSavedContact(id: string): SavedContact[] {
  if (typeof window === 'undefined') return getSavedContacts();
  const contacts = getSavedContacts().filter((c) => c.id !== id);
  window.localStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
  window.dispatchEvent(new CustomEvent('kevinContactsUpdated', { detail: contacts }));
  return contacts;
}

export function mergeContactsBatch(incoming: Array<{ name: string; phone: string }>): { added: number; contacts: SavedContact[] } {
  const current = getSavedContacts();
  const phoneMap = new Map<string, SavedContact>();
  for (const c of current) {
    phoneMap.set(normalizePhoneKey(c.phone), c);
  }
  let addedCount = 0;
  for (const item of incoming) {
    const cleanPhone = sanitizePhoneNumber(item.phone);
    const cleanName = item.name.trim();
    if (!cleanPhone || !cleanName || !isLikelyPhoneNumber(cleanPhone)) continue;
    const key = normalizePhoneKey(cleanPhone);
    if (!phoneMap.has(key)) {
      const newC: SavedContact = {
        id: `contact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: cleanName,
        phone: cleanPhone,
      };
      phoneMap.set(key, newC);
      current.push(newC);
      addedCount++;
    }
  }
  if (addedCount > 0 && typeof window !== 'undefined') {
    window.localStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(current));
    window.dispatchEvent(new CustomEvent('kevinContactsUpdated', { detail: current }));
  }
  return { added: addedCount, contacts: current };
}

export function importContactsFromVcfText(vcfText: string): { added: number; contacts: SavedContact[] } {
  const lines = vcfText.split(/\r?\n/);
  let fullName = '';
  const phones: string[] = [];
  const extracted: Array<{ name: string; phone: string }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('BEGIN:VCARD')) {
      fullName = '';
      phones.length = 0;
    } else if (trimmed.startsWith('FN:') || trimmed.startsWith('FN;')) {
      fullName = trimmed.split(':').slice(1).join(':').trim();
    } else if (trimmed.startsWith('N:') && !fullName) {
      const parts = trimmed.split(':').slice(1).join(':').split(';');
      const nameParts = [parts[1], parts[0]].filter(Boolean);
      if (nameParts.length > 0) fullName = nameParts.join(' ').trim();
    } else if (trimmed.startsWith('TEL') || trimmed.includes('TEL')) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx !== -1) {
        const num = sanitizePhoneNumber(trimmed.substring(colonIdx + 1));
        if (isLikelyPhoneNumber(num)) phones.push(num);
      }
    } else if (trimmed.startsWith('END:VCARD')) {
      if (fullName && phones.length > 0) {
        extracted.push({ name: fullName, phone: phones[0] });
      }
    }
  }

  if (fullName && phones.length > 0) {
    extracted.push({ name: fullName, phone: phones[0] });
  }

  return mergeContactsBatch(extracted);
}

export async function importContactsFromDevice(): Promise<{
  added: number;
  source: 'android' | 'web-picker' | 'needs_permission' | 'unsupported';
  contacts: SavedContact[];
}> {
  if (typeof window === 'undefined') {
    return { added: 0, source: 'unsupported', contacts: [] };
  }
  const bridge = (window as any).KevinAgentBridge;
  if (bridge?.lookupContactsJson) {
    const status = getNativeAgentStatus();
    if (!status.hasContactsPermission) {
      bridge.requestAgentPermissions?.();
      return { added: 0, source: 'needs_permission', contacts: getSavedContacts() };
    }
    try {
      const list = JSON.parse(bridge.lookupContactsJson('')) as Array<{ name: string; phone: string }>;
      const res = mergeContactsBatch(Array.isArray(list) ? list : []);
      return { ...res, source: 'android' };
    } catch {
      return { added: 0, source: 'android', contacts: getSavedContacts() };
    }
  }

  const navContacts = (navigator as any).contacts;
  if (navContacts?.select) {
    const picked = await navContacts.select(['name', 'tel'], { multiple: true }) as Array<{
      name?: string[];
      tel?: string[];
    }>;
    const entries: Array<{ name: string; phone: string }> = [];
    for (const person of picked || []) {
      const name = person.name?.[0]?.trim() || '';
      const tel = person.tel?.[0]?.trim() || '';
      if (name && tel) entries.push({ name, phone: tel });
    }
    const res = mergeContactsBatch(entries);
    return { ...res, source: 'web-picker' };
  }

  return { added: 0, source: 'unsupported', contacts: getSavedContacts() };
}

export function resolveContactMatches(query: string): SavedContact[] {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return [];
  const tokens = cleanQuery.split(/\s+/).filter(Boolean);

  const combined: SavedContact[] = [...getSavedContacts()];
  if (typeof window !== 'undefined') {
    const bridge = (window as any).KevinAgentBridge;
    if (bridge?.lookupContactsJson) {
      try {
        const nativeMatches = JSON.parse(bridge.lookupContactsJson(query)) as Array<{ name: string; phone: string }>;
        for (const item of nativeMatches || []) {
          if (item?.name && item?.phone) {
            combined.push({
              id: `native-${normalizePhoneKey(item.phone)}`,
              name: item.name,
              phone: sanitizePhoneNumber(item.phone),
            });
          }
        }
      } catch {
        // Ignore bridge errors
      }
    }
  }

  const deduped = new Map<string, SavedContact>();
  for (const c of combined) {
    const lowerName = c.name.toLowerCase();
    const matchesAll = tokens.every((t) => lowerName.includes(t) || c.phone.includes(t));
    if (!matchesAll) continue;
    const key = `${lowerName}|${normalizePhoneKey(c.phone)}`;
    if (!deduped.has(key)) deduped.set(key, c);
  }

  const allMatches = Array.from(deduped.values());
  const exactMatches = allMatches.filter((c) => c.name.toLowerCase() === cleanQuery);
  if (exactMatches.length === 1) return exactMatches;
  return allMatches.slice(0, 8);
}

export function loadChatHistory<T>(fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const saved = window.localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
    return saved ? JSON.parse(saved) as T : fallback;
  } catch (error) {
    console.error('Unable to load Kevin AI chat history.', error);
    return fallback;
  }
}

export function saveChatHistory(history: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch (error) {
    console.error('Unable to save Kevin AI chat history.', error);
  }
}

export interface DeviceAction {
  name: string;
  args: Record<string, any>;
  label: string;
  url?: string;
  intentUrl?: string;
  fallbackUrl?: string;
  embedUrl?: string;
  videoId?: string;
  videoTitle?: string;
  channel?: string;
  phoneNumber?: string;
  messageText?: string;
  contactName?: string;
  contactMatches?: SavedContact[];
  status?: 'executed' | 'needs_permission' | 'dialed_needs_permission' | 'choose_contact' | 'contact_not_found' | 'pending';
}

export function runDeviceAction(action: DeviceAction, forceExecute = false): boolean {
  const bridge = (window as any).KevinAgentBridge;
  const perms = getAgentPermissions();

  if (action.name === 'open_camera') {
    window.dispatchEvent(new CustomEvent("open-device-camera"));
    return true;
  }

  if (action.name === 'open_youtube') {
    const videoId = action.videoId || action.args?.videoId;
    const query = action.args?.query || '';
    if (bridge?.playYouTube) {
      bridge.playYouTube(videoId || '', query);
      return true;
    }
    if (action.embedUrl) {
      return true;
    }
    const target = action.fallbackUrl || action.url;
    if (target) {
      const link = document.createElement('a');
      link.href = target;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return true;
    }
    return false;
  }

  if (action.name === 'send_sms') {
    if (!perms.autoSend && !forceExecute) {
      action.status = 'needs_permission';
      return false;
    }
    const phone = sanitizePhoneNumber(action.phoneNumber || action.args?.phone_number || '');
    const msg = action.messageText || action.args?.message || '';
    if (!isLikelyPhoneNumber(phone)) return false;
    if (bridge?.sendSms) {
      const sent = bridge.sendSms(phone, msg);
      if (!sent) {
        bridge.requestAgentPermissions?.();
        action.status = 'needs_permission';
        return false;
      }
    }
    action.status = 'executed';
    appendAgentOutbox({
      channel: 'sms',
      recipient: action.contactName ? `${action.contactName} (${phone})` : phone,
      message: msg,
      status: 'sent',
    });
    return true;
  }

  if (action.name === 'open_whatsapp') {
    if (!perms.autoSend && !forceExecute) {
      action.status = 'needs_permission';
      return false;
    }
    const rawPhone = action.phoneNumber || action.args?.phone_number || '';
    const phone = formatWhatsAppPhoneNumber(rawPhone);
    const msg = action.messageText || action.args?.message || '';
    if (!isLikelyPhoneNumber(phone)) return false;
    if (bridge?.sendWhatsApp) {
      bridge.sendWhatsApp(phone, msg);
    } else {
      const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
      const link = document.createElement('a');
      link.href = waUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    action.status = 'executed';
    appendAgentOutbox({
      channel: 'whatsapp',
      recipient: action.contactName ? `${action.contactName} (${phone})` : phone,
      message: msg,
      status: 'sent',
    });
    return true;
  }

  if (action.name === 'make_call') {
    if (!perms.autoCall && !forceExecute) {
      action.status = 'needs_permission';
      return false;
    }
    const phone = sanitizePhoneNumber(action.phoneNumber || action.args?.phone_number || '');
    if (!isLikelyPhoneNumber(phone)) return false;
    if (bridge?.placeCall) {
      const result = bridge.placeCall(phone);
      if (result === 'invalid_number') return false;
      action.status = result === 'dialed_needs_permission' ? 'dialed_needs_permission' : 'executed';
    } else {
      const telUrl = `tel:${phone}`;
      const link = document.createElement('a');
      link.href = telUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      action.status = 'executed';
    }
    appendAgentOutbox({
      channel: 'call',
      recipient: action.contactName ? `${action.contactName} (${phone})` : phone,
      message: 'Outgoing Phone Call',
      status: 'sent',
    });
    return true;
  }

  if (action.name === 'configure_whatsapp_autoreply') {
    return true;
  }

  const intentUrl = action.intentUrl;
  const fallbackUrl = action.fallbackUrl || action.url;
  if (!intentUrl && !fallbackUrl) return false;

  if (intentUrl && bridge) {
    window.location.assign(intentUrl);
    if (fallbackUrl && fallbackUrl !== intentUrl) {
      window.setTimeout(() => {
        if (document.visibilityState === 'visible') {
          window.location.assign(fallbackUrl);
        }
      }, 900);
    }
    return true;
  }

  if (fallbackUrl) {
    const link = document.createElement('a');
    link.href = fallbackUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  }
  return false;
}

function executeDeviceAction(name: string, args: Record<string, any>): DeviceAction | null {
  const query = String(args.query || "");
  const rawPhoneNumber = String(args.phone_number || "");
  const messageText = String(args.message || "");
  const rawContactName = args.contact_name ? String(args.contact_name) : undefined;
  const appName = String(args.app_name || "").toLowerCase();
  const perms = getAgentPermissions();

  let url: string | undefined;
  let intentUrl: string | undefined;
  let fallbackUrl: string | undefined;
  let embedUrl: string | undefined;
  let videoId: string | undefined;
  let videoTitle: string | undefined;
  let channel: string | undefined;
  let label = name;

  if (name === "make_call" || name === "send_sms" || name === "open_whatsapp") {
    let resolvedPhone = isLikelyPhoneNumber(rawPhoneNumber) ? sanitizePhoneNumber(rawPhoneNumber) : "";
    let resolvedName = rawContactName?.trim() || (!resolvedPhone && rawPhoneNumber.trim() ? rawPhoneNumber.trim() : undefined);

    if (!resolvedPhone && resolvedName) {
      const matches = resolveContactMatches(resolvedName);
      if (matches.length === 1) {
        resolvedPhone = sanitizePhoneNumber(matches[0].phone);
        resolvedName = matches[0].name;
      } else if (matches.length > 1) {
        return {
          name,
          args,
          label: name === "make_call"
            ? `Hitamo uwo uhamagara (${resolvedName})`
            : `${name === "send_sms" ? "SMS" : "WhatsApp"} → ${resolvedName}`,
          contactName: resolvedName,
          messageText,
          contactMatches: matches,
          status: 'choose_contact',
        };
      } else {
        return {
          name,
          args,
          label: name === "make_call"
            ? `Hamagara ${resolvedName}`
            : `${name === "send_sms" ? "SMS" : "WhatsApp"} → ${resolvedName}`,
          contactName: resolvedName,
          messageText,
          status: 'contact_not_found',
        };
      }
    }

    const finalPhone = name === "open_whatsapp"
      ? formatWhatsAppPhoneNumber(resolvedPhone || rawPhoneNumber)
      : (resolvedPhone || rawPhoneNumber);
    label = name === "make_call"
      ? `Hamagara ${resolvedName ? `${resolvedName} (${finalPhone})` : finalPhone}`
      : name === "send_sms"
        ? `SMS → ${resolvedName ? `${resolvedName} (${finalPhone})` : finalPhone}`
        : `WhatsApp → ${resolvedName ? `${resolvedName} (${finalPhone})` : finalPhone}`;

    const actionObj: DeviceAction = {
      name,
      args: { ...args, phone_number: finalPhone, contact_name: resolvedName },
      label,
      phoneNumber: finalPhone,
      contactName: resolvedName,
      messageText,
      url: name === "open_whatsapp" ? `https://wa.me/${finalPhone}?text=${encodeURIComponent(messageText || '')}` : undefined,
      fallbackUrl: name === "open_whatsapp" ? `https://wa.me/${finalPhone}?text=${encodeURIComponent(messageText || '')}` : undefined,
      status: 'executed',
    };

    runDeviceAction(actionObj, false);
    return actionObj;
  }

  if (name === "open_youtube") {
    const q = query || "trending music";
    const resolvedVideoId = typeof args.videoId === 'string' && args.videoId.trim() ? args.videoId.trim() : undefined;
    const resolvedVideoTitle = typeof args.videoTitle === 'string' && args.videoTitle.trim() ? args.videoTitle.trim() : q;
    videoId = resolvedVideoId || (q.length === 11 && /^[a-zA-Z0-9_-]+$/.test(q) ? q : undefined);
    embedUrl = videoId ? `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1` : undefined;
    fallbackUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
    label = `Curanga: ${resolvedVideoTitle}`;
    const actionObj: DeviceAction = {
      name,
      args,
      label,
      url: fallbackUrl,
      fallbackUrl,
      embedUrl,
      videoId,
      videoTitle: resolvedVideoTitle,
      status: 'executed',
    };
    runDeviceAction(actionObj, false);
    return actionObj;
  }

  if (name === "open_camera") {
    label = "Fungura Kamera";
    const actionObj: DeviceAction = { name, args, label, status: 'executed' };
    runDeviceAction(actionObj, false);
    return actionObj;
  }

  if (name === "open_app" && appName && !appName.includes('google search')) {
    const rawApp = String(args.app_name || 'App').trim();
    label = `Fungura ${rawApp}`;
    const appUrls: Record<string, string> = {
      instagram: 'https://www.instagram.com',
      tiktok: 'https://www.tiktok.com',
      spotify: 'https://open.spotify.com',
      maps: 'https://maps.google.com',
      youtube: 'https://www.youtube.com',
    };
    const matchedUrl = Object.entries(appUrls).find(([key]) => appName.includes(key))?.[1];
    const actionObj: DeviceAction = {
      name,
      args,
      label,
      url: matchedUrl,
      fallbackUrl: matchedUrl,
      status: 'executed',
    };
    runDeviceAction(actionObj, false);
    return actionObj;
  }

  return null;
}

function actionConfirmation(action: DeviceAction): string {
  if (action.name === 'open_youtube') {
    return `▶ Yamaze gufungura YouTube ngo icurange: **${action.videoTitle || 'Indirimbo'}** 🎶✨`;
  }
  if (action.name === 'make_call') {
    if (action.status === 'executed') {
      return `📞 Hamagara yoherejwe kuri **${action.contactName || action.phoneNumber}**!`;
    }
    if (action.status === 'dialed_needs_permission') {
      return `📞 Dialer ifunguwe kuri **${action.contactName || action.phoneNumber}**.`;
    }
  }
  if (action.name === 'send_sms') {
    if (action.status === 'executed') {
      return `💬 SMS yoherejwe kuri **${action.contactName || action.phoneNumber}**!`;
    }
  }
  if (action.name === 'open_whatsapp') {
    return `💚 WhatsApp ifunguwe kuri **${action.contactName || action.phoneNumber}**!`;
  }
  if (action.name === 'open_camera') {
    return `📷 Kamera irafunguwe!`;
  }
  if (action.name === 'open_app') {
    return `📱 ${action.label || 'Porogaramu irafunguwe'}!`;
  }
  return `✨ Igikorwa cyakozwe neza.`;
}

export interface GeminiKeysPool {
  primary: string;
  backup1: string;
  backup2: string;
  backup3: string;
  backup4: string;
}

export const KEYS_POOL_STORAGE_KEY = 'kevin_ai_keys_pool';
export const KEYS_ARRAY_STORAGE_KEY = 'kevin_ai_keys';

function safeStorageGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

function safeStorageRemove(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

function parseStoredKeysList(raw: string | null): string[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((k): k is string => typeof k === 'string' && k.trim().length > 0).map(k => k.trim());
    }
    if (parsed && typeof parsed === 'object') {
      return [
        parsed.primary,
        parsed.backup1,
        parsed.backup2,
        parsed.backup3,
        parsed.backup4,
      ].filter((k): k is string => typeof k === 'string' && k.trim().length > 0).map(k => k.trim());
    }
  } catch {
    return raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  }
  return [];
}

export function getGeminiKeysPool(): GeminiKeysPool {
  if (typeof window === 'undefined') return { primary: '', backup1: '', backup2: '', backup3: '', backup4: '' };
  try {
    const raw = safeStorageGet(KEYS_POOL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        primary: String(parsed.primary || ''),
        backup1: String(parsed.backup1 || ''),
        backup2: String(parsed.backup2 || ''),
        backup3: String(parsed.backup3 || ''),
        backup4: String(parsed.backup4 || ''),
      };
    }
  } catch {}

  const kevinKeysArr = parseStoredKeysList(safeStorageGet(KEYS_ARRAY_STORAGE_KEY));
  const legacy = getUserCustomApiKey();
  return {
    primary: legacy || kevinKeysArr[0] || '',
    backup1: safeStorageGet('kevin_ai_key_backup1') || kevinKeysArr[1] || '',
    backup2: safeStorageGet('kevin_ai_key_backup2') || kevinKeysArr[2] || '',
    backup3: safeStorageGet('kevin_ai_key_backup3') || kevinKeysArr[3] || '',
    backup4: safeStorageGet('kevin_ai_key_backup4') || kevinKeysArr[4] || '',
  };
}

export function setGeminiKeysPool(pool: GeminiKeysPool): void {
  if (typeof window === 'undefined') return;
  const cleaned: GeminiKeysPool = {
    primary: (pool.primary || '').trim(),
    backup1: (pool.backup1 || '').trim(),
    backup2: (pool.backup2 || '').trim(),
    backup3: (pool.backup3 || '').trim(),
    backup4: (pool.backup4 || '').trim(),
  };
  safeStorageSet(KEYS_POOL_STORAGE_KEY, JSON.stringify(cleaned));
  const nonEmptyArray = [
    cleaned.primary,
    cleaned.backup1,
    cleaned.backup2,
    cleaned.backup3,
    cleaned.backup4,
  ].filter(Boolean);
  if (nonEmptyArray.length > 0) {
    safeStorageSet(KEYS_ARRAY_STORAGE_KEY, JSON.stringify(Array.from(new Set(nonEmptyArray))));
  } else {
    safeStorageRemove(KEYS_ARRAY_STORAGE_KEY);
  }
  setUserCustomApiKey(cleaned.primary);
  const backupEntries: Array<[string, string]> = [
    ['kevin_ai_key_backup1', cleaned.backup1],
    ['kevin_ai_key_backup2', cleaned.backup2],
    ['kevin_ai_key_backup3', cleaned.backup3],
    ['kevin_ai_key_backup4', cleaned.backup4],
  ];
  for (const [storageKey, val] of backupEntries) {
    if (val) {
      safeStorageSet(storageKey, val);
    } else {
      safeStorageRemove(storageKey);
    }
  }
}

export function getGeminiApiKeysArray(): string[] {
  const pool = getGeminiKeysPool();
  const kevinKeysArr = parseStoredKeysList(safeStorageGet(KEYS_ARRAY_STORAGE_KEY));
  const keys = [
    pool.primary,
    pool.backup1,
    pool.backup2,
    pool.backup3,
    pool.backup4,
    ...kevinKeysArr,
    getUserCustomApiKey(),
  ];
  return Array.from(new Set(
    keys.filter((k): k is string => typeof k === 'string' && k.trim().length > 0).map(k => k.trim())
  ));
}

export function getUserCustomApiKey(): string {
  if (typeof window === 'undefined') return '';
  return safeStorageGet('kevin_ai_key')?.trim()
    || safeStorageGet('gemini_api_key')?.trim()
    || safeStorageGet('apiKey')?.trim()
    || '';
}

export function setUserCustomApiKey(key: string): void {
  if (typeof window !== 'undefined') {
    const trimmed = key.trim();
    if (trimmed.length > 0) {
      safeStorageSet('kevin_ai_key', trimmed);
      safeStorageSet('gemini_api_key', trimmed);
      safeStorageSet('apiKey', trimmed);
    } else {
      safeStorageRemove('kevin_ai_key');
      safeStorageRemove('gemini_api_key');
      safeStorageRemove('apiKey');
    }
  }
}

export function isKevinPhotoRequest(text: string): boolean {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  const keywords = ['kevin', 'uwumukiza', 'ifoto ya kevin', 'creator photo'];
  return keywords.some(k => lower.includes(k));
}

export function getKevinPhotoUrl(): { url: string; caption: string } {
  return { url: kevin2Url, caption: "Dore ifoto ya Uwumukiza Kevin, umuremyi wa Kevin AI!" };
}

export function cleanBase64(dataUrl: string): string {
  try {
    if (typeof dataUrl !== "string") return "";
    const value = dataUrl.trim();
    if (!value) return "";
    const dataUrlMatch = value.match(/^data:[^;,]+;base64,(.*)$/is);
    const base64 = (dataUrlMatch ? dataUrlMatch[1] : value).replace(/\s/g, "");
    if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 === 1) {
      return "";
    }
    return base64;
  } catch (error) {
    console.error("Unable to parse image base64 data.", error);
    return "";
  }
}

const normalizeAudioMimeType = (mimeType: string): string => {
  const normalized = mimeType.split(';')[0].trim().toLowerCase();
  if (normalized === 'audio/x-wav' || normalized === 'audio/wave') return 'audio/wav';
  if (normalized === 'audio/mp3') return 'audio/mpeg';
  if (normalized === 'audio/webm' || normalized === 'audio/wav'
    || normalized === 'audio/mp4' || normalized === 'audio/aac'
    || normalized === 'audio/ogg' || normalized === 'audio/mpeg'
    || normalized === 'audio/m4a') return normalized;
  return 'audio/webm';
};

const isValidAudioBase64 = (data: string): boolean =>
  data.length > 100
  && data.length % 4 === 0
  && /^[A-Za-z0-9+/]+={0,2}$/.test(data);

const PRODUCTION_BACKEND_URL = 'https://kevin-ai-pro.onrender.com';

export function isCapacitorApkRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const cap = (window as any).Capacitor;
    if (cap?.isNativePlatform?.()) return true;
    const { protocol, hostname, port } = window.location;
    if (protocol === 'capacitor:' || protocol === 'ionic:' || protocol === 'file:') return true;
    // Capacitor Android serves bundled assets at https://localhost or http://localhost with no port
    if ((hostname === 'localhost' || hostname === '127.0.0.1') && !port) return true;
  } catch {}
  return false;
}

const getEndpoint = (path: string): string => {
  if (isCapacitorApkRuntime()) {
    return `${PRODUCTION_BACKEND_URL}${path}`;
  }
  if (
    typeof window !== 'undefined'
    && (window.location.hostname === 'localhost'
      || window.location.hostname === '127.0.0.1'
      || window.location.hostname.includes('ais-dev')
      || window.location.hostname.includes('ais-pre'))
  ) {
    return path;
  }
  return `${PRODUCTION_BACKEND_URL}${path}`;
};

const APK_DEVICE_ACTION_DECLARATIONS = [
  {
    name: 'open_youtube',
    description: 'Search and play a song or video on YouTube.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Song title, artist, or YouTube search query.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'send_sms',
    description: 'Send an SMS text message to a contact or phone number.',
    parameters: {
      type: 'OBJECT',
      properties: {
        phone_number: { type: 'STRING', description: 'Recipient phone number.' },
        contact_name: { type: 'STRING', description: 'Recipient name if known.' },
        message: { type: 'STRING', description: 'SMS message body.' },
      },
      required: ['message'],
    },
  },
  {
    name: 'make_call',
    description: 'Place a phone call to a contact or phone number.',
    parameters: {
      type: 'OBJECT',
      properties: {
        phone_number: { type: 'STRING', description: 'Recipient phone number.' },
        contact_name: { type: 'STRING', description: 'Recipient name if known.' },
      },
    },
  },
  {
    name: 'open_whatsapp',
    description: 'Open or send a WhatsApp message to a contact or phone number. For Rwanda numbers, include country code +250 (e.g. +250788123456 or 250788123456).',
    parameters: {
      type: 'OBJECT',
      properties: {
        phone_number: { type: 'STRING', description: 'Recipient phone number (include Rwanda country code +250, e.g. +250788123456 or 250788123456).' },
        contact_name: { type: 'STRING', description: 'Recipient name if known.' },
        message: { type: 'STRING', description: 'WhatsApp message text.' },
      },
      required: ['message'],
    },
  },
  {
    name: 'open_camera',
    description: 'Open the device camera.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
];

async function resolveYouTubeVideoForApk(query: string): Promise<{ videoId: string; title: string; channel: string } | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${PRODUCTION_BACKEND_URL}/api/youtube/resolve?q=${encodeURIComponent(trimmed)}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.videoId) {
      return {
        videoId: String(data.videoId),
        title: String(data.title || trimmed),
        channel: String(data.channel || 'YouTube'),
      };
    }
  } catch {}
  return null;
}

function buildApkCleanWebSearchQuery(rawQuery: string): string {
  const expanded = rawQuery
    .replace(/\bmancity\b/gi, 'Manchester City')
    .replace(/\bman\s*city\b/gi, 'Manchester City')
    .replace(/\bmanutd\b/gi, 'Manchester United')
    .replace(/\bbarca\b/gi, 'Barcelona');
  const stopWords = new Set([
    'wampaye', 'ampaye', 'mbonera', 'mbwira', 'shaka', 'kuri', 'internet', 'google',
    'amakuru', 'agezweho', 'mashya', 'mwikipe', 'ikipe', 'ya', 'yo', 'za', 'mu', 'muri',
    'ubu', 'uyu', 'munsi', 'niba', 'hari', 'icyo', 'uko', 'bimeze', 'please', 'tell',
    'me', 'about', 'what', 'is', 'are', 'the', 'in', 'on', 'for', 'of', 'latest', 'news',
    'current', 'today', 'now', 'give', 'search', 'online', 'live',
  ]);
  const tokens = expanded
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopWords.has(w.toLowerCase()));
  return tokens.length > 0 ? tokens.join(' ').slice(0, 120) : expanded.trim().slice(0, 120);
}

function parseRssXmlForApk(xml: string, cleanQuery: string): {
  contextText: string;
  sources: GroundingSource[];
} {
  if (!xml || !xml.includes('<item')) return { contextText: '', sources: [] };
  const items: Array<{ title: string; url: string; pubDate: string; sourceName: string }> = [];

  try {
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const nodes = Array.from(doc.querySelectorAll('item')).slice(0, 6);
      for (const node of nodes) {
        const title = node.querySelector('title')?.textContent?.trim() || '';
        const link = node.querySelector('link')?.textContent?.trim() || '';
        const pubDate = node.querySelector('pubDate')?.textContent?.trim() || '';
        const sourceEl = node.querySelector('source');
        const sourceName = sourceEl?.textContent?.trim() || '';
        const sourceUrl = sourceEl?.getAttribute('url')?.trim() || '';
        const url = link || sourceUrl;
        if (title && url) {
          items.push({ title, url, pubDate, sourceName });
        }
      }
    }
  } catch {}

  if (items.length === 0) return { contextText: '', sources: [] };

  const lines = items.map((it, idx) =>
    `${idx + 1}. "${it.title}"${it.sourceName ? ` (${it.sourceName})` : ''}${it.pubDate ? ` [${it.pubDate}]` : ''} — ${it.url}`
  );
  const contextText = `[LIVE INTERNET NEWS & WEB SEARCH RESULTS FOR "${cleanQuery}"]:\nUse these verified, up-to-date real-time articles below to answer the user's question accurately in their language. Do NOT say you lack live internet access — summarize the latest developments directly from these current articles:\n${lines.join('\n')}`;
  const sources: GroundingSource[] = items.map((it) => ({
    title: it.sourceName ? `${it.sourceName}: ${it.title}` : it.title,
    url: it.url,
  }));
  return { contextText, sources };
}

async function fetchLiveWebSearchForApk(rawQuery: string): Promise<{
  contextText: string;
  sources: GroundingSource[];
}> {
  const cleanQuery = buildApkCleanWebSearchQuery(rawQuery);
  if (!cleanQuery) return { contextText: '', sources: [] };

  // 1. Native Android bridge RSS fetch (zero CORS, works even if backend is unreachable)
  try {
    const bridge = (window as any).KevinAgentBridge;
    if (bridge?.fetchWebNewsRss) {
      const xml = String(bridge.fetchWebNewsRss(cleanQuery) || '');
      const parsed = parseRssXmlForApk(xml, cleanQuery);
      if (parsed.contextText) return parsed;
    }
  } catch {}

  // 2. Production backend /api/web-search fallback
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`${PRODUCTION_BACKEND_URL}/api/web-search?q=${encodeURIComponent(rawQuery)}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data?.contextText) {
        return {
          contextText: String(data.contextText),
          sources: Array.isArray(data.sources) ? data.sources : [],
        };
      }
    }
  } catch {}

  // 3. CORS-enabled Wikipedia Search API fallback
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const wikiRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQuery)}&srlimit=5&format=json&origin=*`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (wikiRes.ok) {
      const wikiJson = await wikiRes.json().catch(() => null);
      const searchHits: any[] = wikiJson?.query?.search || [];
      if (searchHits.length > 0) {
        const sources: GroundingSource[] = searchHits.map((hit) => ({
          title: `Wikipedia: ${String(hit.title || cleanQuery)}`,
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(hit.title || '').replace(/\s+/g, '_'))}`,
        }));
        const lines = searchHits.map((hit, idx) => {
          const snippet = String(hit.snippet || '').replace(/<[^>]+>/g, '').trim();
          return `${idx + 1}. "${hit.title}": ${snippet} — ${sources[idx].url}`;
        });
        return {
          contextText: `[WEB REFERENCE RESULTS FOR "${cleanQuery}"]:\n${lines.join('\n')}`,
          sources,
        };
      }
    }
  } catch {}

  return { contextText: '', sources: [] };
}

function buildApkSystemInstruction(
  userName: string,
  hasAudioAttachment: boolean,
  savedContacts: SavedContact[],
  perms: AgentPermissions
): string {
  const now = new Date();
  const realTimeContext = `[REAL-TIME CONTEXT: Today is ${now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Africa/Kigali',
  })}, and the current time in Rwanda is ${now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Kigali',
  })}.]`;
  const contactsList = savedContacts
    .filter((c) => c && c.name?.trim() && c.phone?.trim())
    .slice(0, 40)
    .map((c) => `${c.name.trim()}: ${c.phone.trim()}`);
  const customInstructions = safeStorageGet('kevin_ai_custom_instructions')?.trim() || '';

  return [
    `You are Kevin AI, created in Rwanda by Uwumukiza Kevin (born October 28, 2003, Rwamagana District, Gahengeri Sector; studies IT at University of Rwanda UR-CST; Motto: 'UKORA GAKE BIKAGENDA CYANE').`,
    `You have flawless native mastery of authentic Rwandan Kinyarwanda (as well as English, French, and Swahili). Reply naturally, warmly, and concisely in the user's language with friendly emojis (👋, ✨, 😊, 🚀). Avoid awkward literal English-to-Kinyarwanda translations.`,
    `The person chatting with you is named '${userName}'. Address them warmly and naturally.`,
    customInstructions ? `USER CUSTOM INSTRUCTIONS:\n${customInstructions}` : '',
    hasAudioAttachment
      ? `The user sent a voice note/audio message. Listen attentively in Kinyarwanda, English, French, or Swahili and respond directly or execute requested tool actions immediately.`
      : '',
    contactsList.length > 0 ? `[SAVED CONTACTS: ${contactsList.join(' | ')}]` : '',
    `[AGENT PERMISSIONS: autoSend=${Boolean(perms.autoSend)}, autoCall=${perms.autoCall !== false}, autoPlayYouTube=${perms.autoPlayYouTube !== false}, whatsappAutoReply=${Boolean(perms.whatsappAutoReply)}. When sending WhatsApp messages to Rwandan numbers, always use country code +250 (e.g. +250788123456 or 250788123456) so WhatsApp delivers immediately. Always execute requested device actions immediately using tool calls.]`,
    realTimeContext,
  ].filter(Boolean).join('\n\n');
}

export async function transcribeAudioWithSTT(
  audioBase64: string,
  audioMimeType = 'audio/webm'
): Promise<string> {
  const cleanAudio = cleanBase64(audioBase64);
  if (!isValidAudioBase64(cleanAudio)) {
    throw new Error('The recorded audio is empty or invalid.');
  }
  const normalizedMime = normalizeAudioMimeType(audioMimeType);
  const customApiKey = getUserCustomApiKey();
  const customApiKeys = getGeminiApiKeysArray();

  if (isCapacitorApkRuntime() && customApiKeys.length > 0) {
    for (const model of ['gemini-2.5-flash', 'gemini-3.1-flash-lite']) {
      for (const currentKey of customApiKeys) {
        try {
          const directRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(currentKey)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [
                  {
                    role: 'user',
                    parts: [
                      { inlineData: { mimeType: normalizedMime, data: cleanAudio } },
                      {
                        text: 'Transcribe the spoken audio verbatim in Kinyarwanda, English, French, or Swahili. Output ONLY the exact spoken words without quotes or extra explanation. Return empty string if silent.',
                      },
                    ],
                  },
                ],
              }),
            }
          );
          if (!directRes.ok) continue;
          const directJson = await directRes.json();
          const text = directJson?.candidates?.[0]?.content?.parts
            ?.map((p: any) => p?.text || '')
            .join('')
            .trim();
          if (text !== undefined) {
            return text === '""' || text === "''" ? '' : text;
          }
        } catch {}
      }
    }
  }

  try {
    const res = await fetch(getEndpoint('/api/stt'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64: cleanAudio,
        audioMimeType: normalizedMime,
        customApiKey,
        customApiKeys,
      }),
    });

    if (!res.ok) {
      let errMessage = 'STT transcription failed';
      try {
        const errJson = await res.json();
        if (errJson.error) errMessage = errJson.error;
      } catch {}
      throw new Error(errMessage);
    }

    const data = await res.json();
    return typeof data.transcript === 'string' ? data.transcript : '';
  } catch (err: any) {
    console.warn('STT failed:', err);
    return '';
  }
}

export async function generateWhatsAppAutoReply(
  sender: string,
  incomingMessage: string,
  replyStyle?: string
): Promise<string> {
  const userName = typeof window !== 'undefined'
    ? safeStorageGet('kevin_user_name') || safeStorageGet('kevin_ai_user_name') || 'Kevin'
    : 'Kevin';
  const customApiKey = getUserCustomApiKey();
  const customApiKeys = getGeminiApiKeysArray();

  if (isCapacitorApkRuntime() && customApiKeys.length > 0) {
    for (const model of ['gemini-2.5-flash', 'gemini-3.1-flash-lite']) {
      for (const currentKey of customApiKeys) {
        try {
          const directRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(currentKey)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: {
                  parts: [
                    {
                      text: [
                        `You are Kevin AI acting as ${userName}'s WhatsApp Auto-Reply Assistant.`,
                        `Reply directly and naturally to "${sender || 'Contact'}" in their language (Kinyarwanda, English, French, or Swahili), 1-3 concise sentences.`,
                        replyStyle?.trim() ? `Owner's Auto-Reply Instructions: ${replyStyle.trim()}` : '',
                      ].filter(Boolean).join('\n'),
                    },
                  ],
                },
                contents: [{ role: 'user', parts: [{ text: incomingMessage.trim() }] }],
              }),
            }
          );
          if (!directRes.ok) continue;
          const directJson = await directRes.json();
          const reply = directJson?.candidates?.[0]?.content?.parts
            ?.map((p: any) => p?.text || '')
            .join('')
            .trim();
          if (reply) return reply;
        } catch {}
      }
    }
  }

  try {
    const res = await fetch(getEndpoint('/api/whatsapp-reply'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender,
        incomingMessage,
        replyStyle,
        userName,
        customApiKey,
        customApiKeys,
      }),
    });
    if (!res.ok) return 'Muraho! Ndabona ubutumwa bwawe ubu gato.';
    const data = await res.json();
    return typeof data.reply === 'string' && data.reply.trim()
      ? data.reply.trim()
      : 'Muraho! Ndabona ubutumwa bwawe ubu gato.';
  } catch {
    return 'Muraho! Ndabona ubutumwa bwawe ubu gato.';
  }
}

export async function sendMessageToGemini(
  history: { sender: 'user' | 'kevin'; text: string; image?: string }[],
  latestMessage: string,
  onChunk?: (chunk: string) => void,
  attachments?: AttachmentItem | Blob | Array<AttachmentItem | Blob> | null,
  selectedModel?: string,
  onAction?: (action: DeviceAction) => void,
  audioBase64?: string,
  audioMimeType?: string,
  onSources?: (sources: GroundingSource[]) => void
): Promise<string> {
  const contents: any[] = history.map((msg: any) => {
    const historyParts: any[] = [{ text: msg.text || "..." }];
    if (typeof msg.image === "string" && msg.image && !/^https?:\/\//i.test(msg.image)) {
      const imageMimeType = msg.image.match(/^data:([^;]+);base64,/i)?.[1] || "image/jpeg";
      const imageData = cleanBase64(msg.image);
      if (imageData) {
        historyParts.push({
          inlineData: {
            mimeType: imageMimeType,
            data: imageData,
          },
        });
      }
    }
    return {
      role: msg.sender === "user" ? "user" : "model",
      parts: historyParts,
    };
  });

  const attachmentList: Array<AttachmentItem | Blob> = attachments
    ? (Array.isArray(attachments) ? attachments : [attachments])
    : [];
  const hasAudioAttachment = Boolean(audioBase64) || attachmentList.some(attachment => {
    if (typeof Blob !== 'undefined' && attachment instanceof Blob) {
      return attachment.type.toLowerCase().startsWith('audio/');
    }
    return (attachment as AttachmentItem).mimeType?.toLowerCase().startsWith('audio/');
  });
  const hasImageAttachment = attachmentList.some(attachment => {
    if (typeof Blob !== 'undefined' && attachment instanceof Blob) {
      return attachment.type.toLowerCase().startsWith('image/');
    }
    return (attachment as AttachmentItem).mimeType?.toLowerCase().startsWith('image/');
  });

  const isGenericAudioPlaceholder = !latestMessage?.trim() || latestMessage.trim() === '🎤 Voice Note' || latestMessage.trim() === 'Voice command';
  const prompt = isGenericAudioPlaceholder && hasAudioAttachment
    ? "Uyu mukoresha yoherereje ubutumwa bw'amajwi (Voice Note). Umva witonze ibyo yavuze mu Kinyarwanda cyangwa Icyongereza, umenye icyo asabye, hanyuma umusubize neza kandi mu buryo bunoze mu Kinyarwanda cy'umwimerere (cyangwa Icyongereza niba aricyo yakoresheje), cyangwa ukore igikorwa asabye ako kanya."
    : latestMessage?.trim() || (
        hasAudioAttachment
          ? "Uyu mukoresha yoherereje ubutumwa bw'amajwi. Umva witonze ibyo yavuze mu Kinyarwanda cyangwa Icyongereza, umusubize neza kandi bunoze."
          : hasImageAttachment
            ? 'Please analyze these images.'
            : ''
      );

  const parts: any[] = prompt ? [{ text: prompt }] : [];
  if (audioBase64 !== undefined) {
    const validatedAudio = cleanBase64(audioBase64);
    if (!isValidAudioBase64(validatedAudio)) {
      throw new Error('The recorded audio is empty or invalid. Please record your message again.');
    }
    parts.push({
      inlineData: {
        mimeType: normalizeAudioMimeType(audioMimeType || 'audio/mp4'),
        data: validatedAudio,
      },
    });
  }

  for (const attachment of attachmentList) {
    if (!attachment || typeof attachment !== "object") continue;
    let data = "";
    let mimeType = "image/jpeg";
    if (typeof Blob !== 'undefined' && attachment instanceof Blob) {
      if (audioBase64 !== undefined && attachment.type.toLowerCase().startsWith('audio/')) {
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to encode attachment.'));
        reader.onerror = () => reject(reader.error || new Error('Unable to read attachment.'));
        reader.readAsDataURL(attachment);
      });
      data = cleanBase64(dataUrl);
      mimeType = attachment.type || 'image/jpeg';
    } else {
      const att = attachment as AttachmentItem;
      if (att.textContent) {
        parts.push({ text: `[Attached file: ${att.name || 'Document'}]\n${att.textContent}` });
        continue;
      }
      data = cleanBase64(att.data || att.base64 || "");
      mimeType = att.mimeType || mimeType;
    }
    if (data) {
      parts.push({
        inlineData: { mimeType, data },
      });
    }
  }

  contents.push({ role: "user", parts });

  const userName = typeof window !== 'undefined'
    ? safeStorageGet('kevin_user_name') || safeStorageGet('kevin_ai_user_name') || 'Incuti yanjye'
    : 'Incuti yanjye';

  const customApiKey = getUserCustomApiKey();
  const customApiKeys = getGeminiApiKeysArray();
  const perms = getAgentPermissions();
  const savedContacts = getSavedContacts();
  const isApk = isCapacitorApkRuntime();

  const executeDirectApkGemini = async (requestContents: any[], includeAudioFlag: boolean) => {
    const apkSystemInstruction = buildApkSystemInstruction(userName, includeAudioFlag, savedContacts, perms);
    const latestUserText = Array.isArray(requestContents) && requestContents.length > 0
      ? ((requestContents[requestContents.length - 1] as any)?.parts || [])
          .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
          .join(' ')
          .trim()
      : '';
    const isExplicitDeviceCommand = /\b(hamagara|terefone|call|sms|ohereza|send|whatsapp|youtube|curanga|play|audiomack|lark|kamera|camera|fungura|open|instagram|tiktok|spotify|maps)\b/i.test(latestUserText);
    const shouldTryWebSearch = Boolean(
      latestUserText
      && !includeAudioFlag
      && !isExplicitDeviceCommand
      && /\b(news|amakuru|agezweho|ubu|weather|score|match|price|current|latest|internet|google|search|shaka|online|live|today|president|minister|winner|who won|what happened|2025|2026|iteganyagihe|igiciro|umukino|ikipe|perezida|uri he|amakuru mashya|mancity|man city|arsenal|chelsea|liverpool|real madrid|barcelona|rayon|apr)\b/i.test(latestUserText)
    );

    const phases: Array<'search' | 'rss_text' | 'device'> = shouldTryWebSearch
      ? ['search', 'rss_text']
      : ['device'];
    const invalidKeys = new Set<string>();
    let lastDirectErr: unknown = null;
    let rssCache: { contextText: string; sources: GroundingSource[] } | null = null;

    for (const phase of phases) {
      let phaseContents = requestContents;
      let phaseSources: GroundingSource[] = [];

      if (phase === 'rss_text') {
        if (!rssCache) {
          rssCache = await fetchLiveWebSearchForApk(latestUserText);
        }
        if (rssCache.contextText) {
          phaseSources = rssCache.sources;
          phaseContents = [
            ...requestContents,
            { role: 'user', parts: [{ text: rssCache.contextText }] },
          ];
        }
      }

      const apkModels = phase === 'search'
        ? ['gemini-2.5-flash', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite']
        : selectedModel === 'Kevin 1.3 Lite'
          ? ['gemini-2.5-flash', 'gemini-3.1-flash-lite']
          : ['gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-4-hydrogen'];

      for (const modelName of apkModels) {
        for (const currentKey of customApiKeys) {
          if (invalidKeys.has(currentKey)) continue;
          try {
            const payloadBody: Record<string, any> = {
              systemInstruction: { parts: [{ text: apkSystemInstruction }] },
              contents: phaseContents,
            };
            if (phase === 'search') {
              payloadBody.tools = [{ google_search: {} }];
            } else if (phase === 'device') {
              payloadBody.tools = [{ functionDeclarations: APK_DEVICE_ACTION_DECLARATIONS }];
            }

            const directRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(currentKey)}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadBody),
              }
            );

            const json = await directRes.json().catch(() => null);
            if (!directRes.ok) {
              const apiErrMsg = json?.error?.message || `HTTP ${directRes.status}`;
              const lowerErr = apiErrMsg.toLowerCase();
              if (directRes.status === 401 || directRes.status === 403 || lowerErr.includes('api key not valid') || lowerErr.includes('api_key_invalid')) {
                invalidKeys.add(currentKey);
              }
              lastDirectErr = new Error(apiErrMsg);
              continue;
            }

            const responseParts: any[] = json?.candidates?.[0]?.content?.parts || [];
            let streamedText = '';
            const streamedActions: DeviceAction[] = [];
            const directSources: GroundingSource[] = [...phaseSources];

            // Extract grounding chunks if available
            const gChunks = json?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
            for (const gc of gChunks) {
              const uri = gc?.web?.uri || gc?.maps?.uri;
              const title = gc?.web?.title || gc?.maps?.title || uri;
              if (uri && !directSources.some(s => s.url === uri)) {
                directSources.push({ title, url: uri });
              }
            }

            for (const part of responseParts) {
              if (part?.text) {
                streamedText += part.text;
              } else if (part?.functionCall?.name) {
                const fcName = String(part.functionCall.name);
                const fcArgs = { ...(part.functionCall.args || {}) };
                if (fcName === 'open_app' && String(fcArgs.app_name || '').toLowerCase().includes('google search')) {
                  continue;
                }
                if (fcName === 'open_youtube' && typeof fcArgs.query === 'string' && fcArgs.query.trim()) {
                  const resolved = await resolveYouTubeVideoForApk(fcArgs.query);
                  if (resolved) {
                    fcArgs.videoId = resolved.videoId;
                    fcArgs.videoTitle = resolved.title;
                    fcArgs.channel = resolved.channel;
                  }
                }
                const action = executeDeviceAction(fcName, fcArgs);
                if (action) streamedActions.push(action);
              }
            }

            if (directSources.length === 0) {
              const mdSources = extractMarkdownUrls(streamedText);
              directSources.push(...mdSources);
            }

            // If Gemini Search Grounding returned text without any sources and claimed it cannot browse live, fall through to rss_text
            if (phase === 'search' && directSources.length === 0) {
              const lowerReply = streamedText.toLowerCase();
              const looksUngrounded = lowerReply.includes('live search')
                || lowerReply.includes('real-time')
                || lowerReply.includes('ntabwo mbasha gushakisha')
                || lowerReply.includes('cannot access')
                || lowerReply.includes("don't have access");
              if (looksUngrounded) {
                continue;
              }
            }

            if (streamedText) {
              onChunk?.(streamedText);
            }

            if (directSources.length > 0) {
              onSources?.(directSources);
            }

            if (streamedText || streamedActions.length > 0) {
              return { streamedText, streamedActions, streamedSources: directSources };
            }
          } catch (directErr: any) {
            lastDirectErr = directErr;
          }
        }
      }
    }

    throw lastDirectErr instanceof Error
      ? lastDirectErr
      : new Error('Direct Gemini request failed in Android APK.');
  };

  const executeChatRequest = async (requestContents: any[], includeAudioFlag: boolean) => {
    const res = await fetch(getEndpoint('/api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: requestContents,
        userName,
        hasAudioAttachment: includeAudioFlag,
        selectedModel: selectedModel || 'Kevin 1.3 Pro',
        customApiKey,
        customApiKeys,
        agentPermissions: perms,
        savedContacts,
      }),
    });

    if (!res.ok) {
      let errMessage = 'Server error during chat';
      try {
        const errJson = await res.json();
        if (errJson.error) errMessage = errJson.error;
      } catch {
        const textErr = await res.text();
        if (textErr) errMessage = textErr;
      }
      throw new Error(errMessage);
    }

    if (!res.body) {
      throw new Error('No response body from server chat stream.');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let streamedText = '';
    const streamedActions: DeviceAction[] = [];
    const streamedSources: GroundingSource[] = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        let data: any;
        try {
          data = JSON.parse(line);
        } catch {
          // ignore incomplete JSON lines
          continue;
        }
        if (data.type === 'text' && data.text) {
          streamedText += data.text;
          onChunk?.(data.text);
        } else if (data.type === 'action' && data.name) {
          const action = executeDeviceAction(data.name, data.args || {});
          if (action) {
            streamedActions.push(action);
          }
        } else if (data.type === 'sources' && Array.isArray(data.sources)) {
          for (const s of data.sources) {
            if (s?.url && !streamedSources.some(existing => existing.url === s.url)) {
              streamedSources.push({ title: s.title || s.url, url: s.url });
            }
          }
          onSources?.(streamedSources);
        } else if (data.type === 'error') {
          throw new Error(data.error || 'Stream error');
        }
      }
    }

    if (streamedSources.length === 0) {
      const textSources = extractMarkdownUrls(streamedText);
      if (textSources.length > 0) {
        streamedSources.push(...textSources);
        onSources?.(streamedSources);
      }
    }

    return { streamedText, streamedActions, streamedSources };
  };

  let fullResponse = '';
  let actions: DeviceAction[] = [];

  if (isApk) {
    if (customApiKeys.length > 0) {
      try {
        const directResult = await executeDirectApkGemini(contents, hasAudioAttachment);
        fullResponse = directResult.streamedText;
        actions = directResult.streamedActions;
      } catch (directErr: any) {
        // Fallback to absolute production backend URL if direct Gemini call fails
        try {
          const backendResult = await executeChatRequest(contents, hasAudioAttachment);
          fullResponse = backendResult.streamedText;
          actions = backendResult.streamedActions;
        } catch {
          throw directErr;
        }
      }
    } else {
      // No keys stored yet in APK localStorage: try production backend first, else prompt user cleanly
      try {
        const backendResult = await executeChatRequest(contents, hasAudioAttachment);
        fullResponse = backendResult.streamedText;
        actions = backendResult.streamedActions;
      } catch {
        throw new Error('APK_NO_API_KEY: Nta Gemini API Key irabikwa muri porogaramu. Nyamuneka jya muri Settings > INJIZA KEVIN API KEYS ushyiremo API Key yawe.');
      }
    }
  } else {
    try {
      const result = await executeChatRequest(contents, hasAudioAttachment);
      fullResponse = result.streamedText;
      actions = result.streamedActions;
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isHighDemand = errMsg.includes('503')
        || errMsg.toLowerCase().includes('high demand')
        || errMsg.toLowerCase().includes('unavailable');

      // If audio inlineData hit high demand and we already have a transcribed prompt, seamlessly retry with text
      if (isHighDemand && hasAudioAttachment && !isGenericAudioPlaceholder && prompt) {
        const textOnlyContents = [
          ...contents.slice(0, -1),
          { role: 'user', parts: [{ text: prompt }] },
        ];
        const fallbackResult = await executeChatRequest(textOnlyContents, false);
        fullResponse = fallbackResult.streamedText;
        actions = fallbackResult.streamedActions;
      } else {
        throw err;
      }
    }
  }

  for (const action of actions) {
    onAction?.(action);
    const confirmation = actionConfirmation(action);
    fullResponse += `\n\n${confirmation}`;
    onChunk?.(`\n\n${confirmation}`);
  }

  if (!fullResponse.trim()) {
    const fallbackReply = "Mbabarira, sinabashije kubona igisubizo kuri iki kibazo ako kanya. Ongera ugerageze!";
    fullResponse = fallbackReply;
    onChunk?.(fallbackReply);
  }

  return fullResponse;
}

export function connectGeminiLiveSession(callbacks: any) {
  console.warn("Live voice session requires WebRTC/Live API credentials.");
  callbacks.onClose?.();
  return {
    sendAudio: () => {},
    sendText: () => {},
    close: () => {},
  };
}

export function isImageGenerationRequest(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  const imageKeywords = ['ifoto', 'shushanya', 'photo', 'image', 'picture', 'draw'];
  return imageKeywords.some(keyword => lower.includes(keyword));
}

export function generateAIImage(prompt: string): string {
  const encodedPrompt = encodeURIComponent(createEnglishImagePrompt(prompt));
  return `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true`;
}

export function cleanImagePrompt(text: string): string {
  return text
    .replace(/^(please\s+)?(generate|create|draw|make|shushanya|kora)\s+(an?\s+)?(image|photo|picture|ifoto|igishushanyo)?\s*(of|ya|rya)?\s*/i, '')
    .trim();
}

function createEnglishImagePrompt(text: string): string {
  const cleanedPrompt = cleanImagePrompt(text).toLowerCase();
  const translations: Record<string, string> = {
    'umusozi mwiza mu rwanda': 'breathtaking cinematic aerial view of the lush green rolling mountains of Rwanda with morning mist, terraced hills, vibrant nature',
    'umusozi': 'lush green mountain landscape',
    'imodoka nziza': 'sleek modern luxury sports car',
    'imodoka': 'modern car',
    'inka': 'a peaceful cow in a lush green meadow',
    'inzu': 'a beautiful traditional Rwandan home',
    'mu rwanda': 'in Rwanda',
    'mwiza': 'beautiful',
  };

  let translatedPrompt = cleanedPrompt;
  for (const [source, translation] of Object.entries(translations)) {
    translatedPrompt = translatedPrompt.replace(new RegExp(source, 'gi'), translation);
  }

  const containsKinyarwanda = /\b(umusozi|imodoka|inka|inzu|mwiza|rwanda|shushanya|ifoto|kora|ya|mu|muri)\b/i.test(cleanedPrompt);
  if (containsKinyarwanda) {
    const knownEnglish = Object.entries(translations)
      .filter(([source]) => cleanedPrompt.includes(source))
      .map(([, translation]) => translation)
      .join(', ');
    translatedPrompt = knownEnglish || 'a beautiful, richly detailed natural scene';
  }

  return `${translatedPrompt}, cinematic composition, photorealistic, ultra-detailed, 8k photography`;
}

export function compressImage(_file: any): Promise<any> { return Promise.resolve({ base64: "", mimeType: "" }); }
export function generateImagePrompt(text: string): Promise<string> { return Promise.resolve(createEnglishImagePrompt(text)); }
