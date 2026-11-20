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
  hasAccessibility?: boolean;
  hasNotificationAccess?: boolean;
  isDefaultAssistant?: boolean;
  autoSendEnabled?: boolean;
  whatsappAutoReplyEnabled?: boolean;
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
  autoSend: false,
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
    const backendBaseUrl = window.location.origin;
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
    const phone = sanitizePhoneNumber(action.phoneNumber || action.args?.phone_number || '');
    const msg = action.messageText || action.args?.message || '';
    if (!isLikelyPhoneNumber(phone)) return false;
    if (bridge?.sendWhatsApp) {
      bridge.sendWhatsApp(phone, msg);
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

    const finalPhone = resolvedPhone || rawPhoneNumber;
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
      status: 'executed',
    };

    runDeviceAction(actionObj, false);
    return actionObj;
  }

  if (name === "open_youtube") {
    const q = query || "trending music";
    videoId = q.length === 11 && /^[a-zA-Z0-9_-]+$/.test(q) ? q : undefined;
    embedUrl = videoId ? `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1` : undefined;
    fallbackUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
    label = `Curanga: ${q}`;
    const actionObj: DeviceAction = {
      name,
      args,
      label,
      url: fallbackUrl,
      fallbackUrl,
      embedUrl,
      videoId,
      videoTitle: q,
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
  return `✨ Igikorwa cyakozwe neza.`;
}

export interface GeminiKeysPool {
  primary: string;
  backup1: string;
  backup2: string;
}

export const KEYS_POOL_STORAGE_KEY = 'kevin_ai_keys_pool';

export function getGeminiKeysPool(): GeminiKeysPool {
  if (typeof window === 'undefined') return { primary: '', backup1: '', backup2: '' };
  try {
    const raw = localStorage.getItem(KEYS_POOL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        primary: String(parsed.primary || ''),
        backup1: String(parsed.backup1 || ''),
        backup2: String(parsed.backup2 || ''),
      };
    }
  } catch {}
  const legacy = getUserCustomApiKey();
  return {
    primary: legacy,
    backup1: localStorage.getItem('kevin_ai_key_backup1') || '',
    backup2: localStorage.getItem('kevin_ai_key_backup2') || '',
  };
}

export function setGeminiKeysPool(pool: GeminiKeysPool): void {
  if (typeof window === 'undefined') return;
  const cleaned = {
    primary: pool.primary.trim(),
    backup1: pool.backup1.trim(),
    backup2: pool.backup2.trim(),
  };
  localStorage.setItem(KEYS_POOL_STORAGE_KEY, JSON.stringify(cleaned));
  if (cleaned.primary) {
    setUserCustomApiKey(cleaned.primary);
  } else if (!cleaned.backup1 && !cleaned.backup2) {
    setUserCustomApiKey('');
  }
}

export function getGeminiApiKeysArray(): string[] {
  const pool = getGeminiKeysPool();
  const keys = [
    pool.primary,
    pool.backup1,
    pool.backup2,
    getUserCustomApiKey(),
  ];
  return Array.from(new Set(
    keys.filter((k): k is string => typeof k === 'string' && k.trim().length > 0).map(k => k.trim())
  ));
}

export function getUserCustomApiKey(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('kevin_ai_key')?.trim()
    || localStorage.getItem('gemini_api_key')?.trim()
    || localStorage.getItem('apiKey')?.trim()
    || '';
}

export function setUserCustomApiKey(key: string): void {
  if (typeof window !== 'undefined') {
    const trimmed = key.trim();
    if (trimmed.length > 0) {
      localStorage.setItem('kevin_ai_key', trimmed);
      localStorage.setItem('gemini_api_key', trimmed);
      localStorage.setItem('apiKey', trimmed);
    } else {
      localStorage.removeItem('kevin_ai_key');
      localStorage.removeItem('gemini_api_key');
      localStorage.removeItem('apiKey');
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

const getEndpoint = (path: string): string => {
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.includes('ais-dev') || window.location.hostname.includes('ais-pre'))) {
    return path;
  }
  return `https://kevin-ai-pro.onrender.com${path}`;
};

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
    ? localStorage.getItem('kevin_user_name') || localStorage.getItem('kevin_ai_user_name') || 'Kevin'
    : 'Kevin';
  const customApiKey = getUserCustomApiKey();
  const customApiKeys = getGeminiApiKeysArray();

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
  audioMimeType?: string
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
    ? localStorage.getItem('kevin_user_name') || localStorage.getItem('kevin_ai_user_name') || 'Incuti yanjye'
    : 'Incuti yanjye';

  const customApiKey = getUserCustomApiKey();
  const customApiKeys = getGeminiApiKeysArray();
  const perms = getAgentPermissions();
  const savedContacts = getSavedContacts();

  const res = await fetch(getEndpoint('/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      userName,
      hasAudioAttachment,
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
  let fullResponse = '';
  const actions: DeviceAction[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.type === 'text' && data.text) {
          fullResponse += data.text;
          onChunk?.(data.text);
        } else if (data.type === 'action' && data.name) {
          const action = executeDeviceAction(data.name, data.args || {});
          if (action) {
            actions.push(action);
          }
        } else if (data.type === 'error') {
          throw new Error(data.error || 'Stream error');
        }
      } catch (e: any) {
        if (e instanceof Error && e.message !== 'Stream error') {
          // ignore incomplete JSON lines
        } else {
          throw e;
        }
      }
    }
  }

  for (const action of actions) {
    onAction?.(action);
    const confirmation = actionConfirmation(action);
    fullResponse += `\n\n${confirmation}`;
    onChunk?.(`\n\n${confirmation}`);
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
