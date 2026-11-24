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
  whatsappAutoReplyPausedUntil?: number;
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
  whatsappAutoReplyPausedUntil?: number;
  whatsappAutoReplyPaused?: boolean;
  whatsappAutoReplyCurrentlyActive?: boolean;
  wakeWordEnabled?: boolean;
  wakeWordActive?: boolean;
  wakeWordEngine?: string;
  wakeWordDiag?: string;
  hasOverlayPermission?: boolean;
  hasNotificationPermission?: boolean;
  speechRecognizerAvailable?: boolean;
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
  whatsappAutoReplyPausedUntil: 0,
  whatsappReplyStyle: '',
};

export function getWhatsAppAutoReplyState(perms: AgentPermissions): {
  enabled: boolean;
  paused: boolean;
  active: boolean;
  pausedUntil: number;
  remainingMs: number;
} {
  const enabled = Boolean(perms.whatsappAutoReply);
  const rawUntil = Number(perms.whatsappAutoReplyPausedUntil || 0);
  const now = Date.now();
  const paused = enabled && rawUntil > now;
  return {
    enabled,
    paused,
    active: enabled && !paused,
    pausedUntil: paused ? rawUntil : 0,
    remainingMs: paused ? Math.max(0, rawUntil - now) : 0,
  };
}

export function formatRemainingPauseDuration(remainingMs: number): string {
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  if (totalMinutes < 60) {
    return totalMinutes === 1 ? 'umunota 1' : `iminota ${totalMinutes}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const hourStr = hours === 1 ? 'isaha 1' : `amasaha ${hours}`;
  if (mins === 0) return hourStr;
  return `${hourStr} n'iminota ${mins}`;
}

export function getAgentPermissions(): AgentPermissions {
  if (typeof window === 'undefined') return DEFAULT_AGENT_PERMISSIONS;
  try {
    const raw = window.localStorage.getItem(AGENT_PERMISSIONS_STORAGE_KEY);
    if (!raw) return DEFAULT_AGENT_PERMISSIONS;
    const parsed = { ...DEFAULT_AGENT_PERMISSIONS, ...JSON.parse(raw) } as AgentPermissions;
    if (!parsed.whatsappAutoReply || !parsed.whatsappAutoReplyPausedUntil || parsed.whatsappAutoReplyPausedUntil <= Date.now()) {
      parsed.whatsappAutoReplyPausedUntil = 0;
    }
    return parsed;
  } catch {
    return DEFAULT_AGENT_PERMISSIONS;
  }
}

export function saveAgentPermissions(perms: AgentPermissions): void {
  if (typeof window === 'undefined') return;
  try {
    const normalizedPausedUntil = perms.whatsappAutoReply
      && perms.whatsappAutoReplyPausedUntil
      && perms.whatsappAutoReplyPausedUntil > Date.now()
      ? perms.whatsappAutoReplyPausedUntil
      : 0;
    const normalizedPerms: AgentPermissions = {
      ...perms,
      whatsappAutoReplyPausedUntil: normalizedPausedUntil,
    };
    window.localStorage.setItem(AGENT_PERMISSIONS_STORAGE_KEY, JSON.stringify(normalizedPerms));
    const userName = window.localStorage.getItem('kevin_user_name')
      || window.localStorage.getItem('kevin_ai_user_name')
      || 'Kevin';
    const backendBaseUrl = isCapacitorApkRuntime() ? PRODUCTION_BACKEND_URL : window.location.origin;
    const bridge = (window as any).KevinAgentBridge;
    if (bridge?.setAgentConfig) {
      bridge.setAgentConfig(
        Boolean(normalizedPerms.autoSend),
        Boolean(normalizedPerms.whatsappAutoReply),
        normalizedPerms.whatsappReplyStyle || '',
        userName,
        backendBaseUrl
      );
    }
    if (bridge?.setWhatsAppAutoReplyPause) {
      bridge.setWhatsAppAutoReplyPause(Number(normalizedPausedUntil));
    }
    if (bridge?.setAgentApiKeys) {
      bridge.setAgentApiKeys(JSON.stringify(getGeminiApiKeysArray()));
    }
    window.dispatchEvent(new CustomEvent('kevinAgentPermissionsUpdated', { detail: normalizedPerms }));
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

function normalizeContactSearchText(val: string): string {
  return String(val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function resolveContactMatches(query: string): SavedContact[] {
  const cleanQuery = normalizeContactSearchText(query);
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
    const lowerName = normalizeContactSearchText(c.name);
    const digitsOnly = c.phone.replace(/[^\d]/g, '');
    const matchesAll = tokens.every((t) => {
      const tDigits = t.replace(/[^\d]/g, '');
      return lowerName.includes(t) || c.phone.includes(t) || (tDigits.length >= 2 && digitsOnly.includes(tDigits));
    });
    if (!matchesAll) continue;
    const key = `${lowerName}|${normalizePhoneKey(c.phone)}`;
    if (!deduped.has(key)) deduped.set(key, c);
  }

  const allMatches = Array.from(deduped.values());
  const exactMatches = allMatches.filter((c) => normalizeContactSearchText(c.name) === cleanQuery);
  if (exactMatches.length === 1) return exactMatches;
  return allMatches.slice(0, 12);
}

export function readNativeCompressedImage(
  uriOrPath: string,
  options?: { name?: string; maxDim?: number; quality?: number }
): AttachmentItem | null {
  if (typeof window === 'undefined' || !uriOrPath) return null;
  const bridge = (window as any).KevinAgentBridge;
  if (!bridge?.readAndCompressImage) return null;
  try {
    const rawJson = bridge.readAndCompressImage(
      uriOrPath,
      options?.maxDim ?? 1280,
      options?.quality ?? 82
    );
    if (!rawJson) return null;
    const parsed = JSON.parse(rawJson) as { base64?: string; sizeKb?: number };
    if (!parsed?.base64 || !cleanBase64(parsed.base64)) return null;
    return {
      base64: parsed.base64,
      mimeType: 'image/jpeg',
      name: options?.name || `image_${Date.now()}.jpg`,
      size: `${Math.max(1, parsed.sizeKb || 1)} KB`,
    };
  } catch {
    return null;
  }
}

export async function compressImageToAttachment(
  file: Blob,
  options?: { name?: string; mimeType?: string; maxDim?: number; quality?: number }
): Promise<AttachmentItem> {
  const maxDim = options?.maxDim ?? 1280;
  const quality = options?.quality ?? 0.82;
  const fileName = options?.name || (file instanceof File ? file.name : '') || `image_${Date.now()}.jpg`;
  const origType = options?.mimeType || file.type || 'image/jpeg';

  const readAsDataUrlSafe = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        typeof reader.result === 'string'
          ? resolve(reader.result)
          : reject(new Error('The selected image could not be read.'));
      reader.onerror = () => reject(reader.error || new Error('The selected image could not be read.'));
      reader.readAsDataURL(blob);
    });

  let dataUrl = '';
  let finalMime = origType;
  const needsHeavyResize =
    file.size > 350 * 1024 || origType === 'image/heic' || origType === 'image/heif';

  // Fast low-memory downsampled decode (avoids 100MB-400MB full RGBA allocation in WebView)
  if (needsHeavyResize && typeof document !== 'undefined' && typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file, {
        resizeWidth: Math.min(maxDim, 1024),
        resizeQuality: 'medium',
      });
      const srcW = bitmap.width || 0;
      const srcH = bitmap.height || 0;
      if (srcW > 0 && srcH > 0) {
        const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
        const targetW = Math.max(1, Math.round(srcW * scale));
        const targetH = Math.max(1, Math.round(srcH * scale));
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, targetW, targetH);
          ctx.drawImage(bitmap, 0, 0, targetW, targetH);
          dataUrl = canvas.toDataURL('image/jpeg', quality);
          finalMime = 'image/jpeg';
          canvas.width = 0;
          canvas.height = 0;
        }
      }
    } catch {
      // Fallback below
    } finally {
      try {
        bitmap?.close();
      } catch {
        // ignore
      }
    }
  }

  if (!dataUrl && typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Image decode failed'));
        image.src = objectUrl;
      });

      const srcW = img.naturalWidth || img.width || 0;
      const srcH = img.naturalHeight || img.height || 0;
      if (srcW > 0 && srcH > 0) {
        const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
        const targetW = Math.max(1, Math.round(srcW * scale));
        const targetH = Math.max(1, Math.round(srcH * scale));

        // Re-encode if image is larger than maxDim or file is > 350KB to avoid WebView OOM / quota crash
        if (scale < 1 || needsHeavyResize) {
          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, targetW, targetH);
            ctx.drawImage(img, 0, 0, targetW, targetH);
            dataUrl = canvas.toDataURL('image/jpeg', quality);
            finalMime = 'image/jpeg';
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      }
    } catch {
      // Fallback below if canvas decode fails
    } finally {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // ignore
      }
    }
  }

  if (!dataUrl) {
    if (file.size > 4_000_000) {
      throw new Error('Ifoto ni nini cyane ku buryo itabashije guhindurwa.');
    }
    dataUrl = await readAsDataUrlSafe(file);
  }

  if (!cleanBase64(dataUrl)) {
    throw new Error('The selected image could not be encoded.');
  }

  const approxBytes = Math.round((cleanBase64(dataUrl).length * 3) / 4);
  return {
    base64: dataUrl,
    mimeType: finalMime,
    name: fileName,
    size: `${Math.max(1, Math.round(approxBytes / 1024))} KB`,
  };
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

function stripHeavyMediaFromSessions(history: unknown, stripAllImages: boolean): unknown {
  if (!Array.isArray(history)) return history;
  return history.map((session, sIdx) => {
    if (!session || typeof session !== 'object') return session;
    const msgs = Array.isArray((session as any).messages) ? (session as any).messages : [];
    const prunedMsgs = msgs.map((msg: any, mIdx: number) => {
      if (!msg || typeof msg !== 'object') return msg;
      const hasLargeDataImage = typeof msg.image === 'string' && msg.image.startsWith('data:') && msg.image.length > 4096;
      const isRecent = sIdx === 0 && mIdx >= Math.max(0, msgs.length - 4);
      if (hasLargeDataImage && (stripAllImages || !isRecent)) {
        const { image: _dropped, ...rest } = msg;
        return rest;
      }
      return msg;
    });
    return { ...(session as any), messages: prunedMsgs };
  });
}

export function saveChatHistory(history: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = JSON.stringify(history);
    if (raw.length <= 2_000_000) {
      window.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, raw);
      return;
    }
    const recentOnly = JSON.stringify(stripHeavyMediaFromSessions(history, false));
    if (recentOnly.length <= 2_400_000) {
      window.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, recentOnly);
      return;
    }
    const textOnly = JSON.stringify(stripHeavyMediaFromSessions(history, true));
    window.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, textOnly);
  } catch {
    try {
      window.localStorage.removeItem('kevin_ai_chats');
      const textOnly = JSON.stringify(stripHeavyMediaFromSessions(history, true));
      window.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, textOnly);
    } catch (innerErr) {
      console.error('Unable to save Kevin AI chat history.', innerErr);
    }
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

export function playWhatsAppSound(type: 'pop' | 'send' | 'receive' = 'pop') {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      if (type === 'receive') {
        osc.frequency.setValueAtTime(750, now);
        osc.frequency.exponentialRampToValueAtTime(320, now + 0.08);
      } else {
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(680, now + 0.06);
      }

      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + (type === 'receive' ? 0.09 : 0.07));

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + (type === 'receive' ? 0.09 : 0.07));
      setTimeout(() => {
        try { void ctx.close(); } catch {}
      }, 150);
    }
  } catch {
    // ignore synth errors
  }

  try {
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcHCmS2+Czj00UHDuP4+DTDEWShO3Lq3MYHCGK0u3Vu3McHCRi5Ofv3rpxHCph9u7fvHEcLW3r+/v9+/s=');
    audio.volume = 0.6;
    void audio.play().catch(() => {});
  } catch {
    // fail silently if blocked by autoplay policy
  }
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
    const shouldAutoPlay = perms.autoPlayYouTube !== false || forceExecute;
    if (bridge?.playYouTube && shouldAutoPlay) {
      bridge.playYouTube(videoId || '', query);
      return true;
    }
    if (action.embedUrl && shouldAutoPlay) {
      return true;
    }
    const target = shouldAutoPlay
      ? (action.url || action.fallbackUrl)
      : (action.fallbackUrl || action.url);
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
    playWhatsAppSound('send');
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
    const pauseMinutes = Number(action.args?.pause_minutes || 0);
    const hasPause = Number.isFinite(pauseMinutes) && pauseMinutes > 0;
    const enabled = hasPause ? true : action.args?.enabled !== false;
    const pausedUntil = hasPause ? Date.now() + Math.round(pauseMinutes * 60_000) : 0;
    const replyStyle = typeof action.args?.reply_style === 'string' && action.args.reply_style.trim()
      ? action.args.reply_style.trim()
      : perms.whatsappReplyStyle;
    saveAgentPermissions({
      ...perms,
      whatsappAutoReply: enabled,
      whatsappAutoReplyPausedUntil: pausedUntil,
      whatsappReplyStyle: replyStyle,
    });
    if (enabled && !hasPause && bridge?.scanAndReplyWhatsAppChats) {
      try {
        const scanRaw = bridge.scanAndReplyWhatsAppChats();
        action.args = { ...action.args, scanResult: JSON.parse(scanRaw || '{}') };
      } catch {}
    }
    action.status = 'executed';
    return true;
  }

  if (action.name === 'scan_whatsapp_chats') {
    const replyStyle = typeof action.args?.reply_style === 'string' && action.args.reply_style.trim()
      ? action.args.reply_style.trim()
      : perms.whatsappReplyStyle;
    if (!perms.whatsappAutoReply || perms.whatsappAutoReplyPausedUntil || replyStyle !== perms.whatsappReplyStyle) {
      saveAgentPermissions({
        ...perms,
        whatsappAutoReply: true,
        whatsappAutoReplyPausedUntil: 0,
        whatsappReplyStyle: replyStyle,
      });
    }
    if (bridge?.scanAndReplyWhatsAppChats) {
      try {
        const parsed = JSON.parse(bridge.scanAndReplyWhatsAppChats() || '{}') as {
          activeNotifQueued?: number;
          openedWhatsAppForScan?: boolean;
          hasNotificationAccess?: boolean;
          hasAccessibility?: boolean;
        };
        action.args = { ...action.args, scanResult: parsed };
        if (!parsed.hasNotificationAccess && !parsed.hasAccessibility) {
          action.status = 'needs_permission';
          return false;
        }
        action.status = 'executed';
        return true;
      } catch {}
    }
    action.status = 'needs_permission';
    return false;
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

    if (!resolvedPhone && (!resolvedName || /^(unknown|someone|anybody|none)$/i.test(resolvedName))) {
      return null;
    }

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
    const resolvedChannel = typeof args.channel === 'string' && args.channel.trim() ? args.channel.trim() : undefined;
    videoId = resolvedVideoId || (q.length === 11 && /^[a-zA-Z0-9_-]+$/.test(q) ? q : undefined);
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
    const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}&autoplay=1` : undefined;
    embedUrl = videoId && perms.autoPlayYouTube !== false
      ? `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1&playsinline=1`
      : undefined;
    url = watchUrl || searchUrl;
    fallbackUrl = searchUrl;
    channel = resolvedChannel;
    label = `Curanga: ${resolvedVideoTitle}`;
    const actionObj: DeviceAction = {
      name,
      args,
      label,
      url,
      fallbackUrl,
      embedUrl,
      videoId,
      videoTitle: resolvedVideoTitle,
      channel,
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

  if (name === "configure_whatsapp_autoreply") {
    const pauseMinutes = Number(args.pause_minutes || 0);
    const hasPause = Number.isFinite(pauseMinutes) && pauseMinutes > 0;
    const enabled = hasPause ? true : args.enabled !== false;
    label = hasPause
      ? `Hagarika WhatsApp Auto-Reply (${formatRemainingPauseDuration(pauseMinutes * 60_000)})`
      : enabled
        ? "Fungura WhatsApp Auto-Reply"
        : "Funga WhatsApp Auto-Reply";
    const actionObj: DeviceAction = {
      name,
      args,
      label,
      status: 'executed',
    };
    runDeviceAction(actionObj, false);
    return actionObj;
  }

  if (name === "scan_whatsapp_chats") {
    label = "Reba & Subiza WhatsApp zose";
    const actionObj: DeviceAction = {
      name,
      args,
      label,
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
  if (action.name === 'configure_whatsapp_autoreply') {
    const pauseMinutes = Number(action.args?.pause_minutes || 0);
    if (Number.isFinite(pauseMinutes) && pauseMinutes > 0) {
      const durationStr = formatRemainingPauseDuration(pauseMinutes * 60_000);
      return `⏸️ WhatsApp Auto-Reply yahagaritsweho **${durationStr}**! Nta butumwa izasubiza kugeza icyo gihe kirangiye cyangwa uyisubukuye.`;
    }
    const enabled = action.args?.enabled !== false;
    return enabled
      ? `💬 WhatsApp Auto-Reply yafunguwe! Kevin AI irahita isubiza ubutumwa bwinjiye kuri WhatsApp.`
      : `🔕 WhatsApp Auto-Reply yafunzwe burundu kugeza igihe uzayifungurira.`;
  }
  if (action.name === 'scan_whatsapp_chats') {
    const sr = action.args?.scanResult || {};
    if (action.status === 'needs_permission') {
      return `⚠️ Kugira ngo Kevin AI irebe chat za WhatsApp zose, emera **WA Notif** cyangwa **Accessibility** muri **Kevin Permission**.`;
    }
    const notifCount = Number(sr.activeNotifQueued || 0);
    if (sr.openedWhatsAppForScan) {
      return `💬 Kevin AI ifunguye WhatsApp ngo irebe kandi isubize chat zose zitarasubizwa${notifCount > 0 ? ` (hamwe na notifications ${notifCount})` : ''}! ✨`;
    }
    return `💬 Kevin AI irimo gusuzuma no gusubiza ubutumwa bwa WhatsApp budasubije (notifications ${notifCount})!`;
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
    try {
      const bridge = (window as any).KevinAgentBridge;
      bridge?.setAgentApiKeys?.(JSON.stringify(getGeminiApiKeysArray()));
    } catch {
      // Ignore bridge unavailability on web
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
  const normalized = (mimeType || '').split(';')[0].trim().toLowerCase();
  if (normalized === 'audio/x-wav' || normalized === 'audio/wave') return 'audio/wav';
  if (normalized === 'audio/mp3' || normalized === 'audio/mpeg') return 'audio/mpeg';
  if (normalized === 'audio/m4a' || normalized === 'audio/x-m4a' || normalized === 'audio/mp4') return 'audio/mp4';
  if (normalized === 'audio/x-aac' || normalized === 'audio/aac') return 'audio/aac';
  if (normalized === 'audio/opus' || normalized === 'audio/ogg') return 'audio/ogg';
  if (normalized === 'audio/x-flac' || normalized === 'audio/flac') return 'audio/flac';
  if (normalized === 'video/webm' || normalized === 'audio/webm') return 'audio/webm';
  if (normalized === 'audio/wav' || normalized === 'audio/3gpp' || normalized === 'audio/amr') return normalized;
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
    name: 'configure_whatsapp_autoreply',
    description: 'Enable, disable, or pause automatic AI replying to incoming WhatsApp messages for a specific number of minutes.',
    parameters: {
      type: 'OBJECT',
      properties: {
        enabled: { type: 'BOOLEAN', description: 'Whether WhatsApp auto-reply should be enabled.' },
        pause_minutes: { type: 'NUMBER', description: 'Optional number of minutes to pause WhatsApp auto-reply (e.g. 15, 30, 60, 120, 480). Omit or 0 to turn completely off or immediately resume.' },
        reply_style: { type: 'STRING', description: 'Optional reply instructions.' },
      },
      required: ['enabled'],
    },
  },
  {
    name: 'scan_whatsapp_chats',
    description: 'Scan all unread/unreplied WhatsApp chats and notifications on the phone and automatically reply to messages that have not yet been answered.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reply_style: { type: 'STRING', description: 'Optional reply instructions.' },
      },
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
    const timer = setTimeout(() => controller.abort(), 2600);
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

// In-memory APK key/model health & contacts cache to avoid repeating dead/rate-limited keys or re-reading 5,000 contacts every turn
const apkDeadKeysSession = new Set<string>();
const apkRateLimitedUntil = new Map<string, number>();
let apkLastWorkingKey = '';
let apkCachedNativeContacts: SavedContact[] | null = null;
let apkCachedNativeContactsAt = 0;

function prioritizeApkKeys(keys: string[]): string[] {
  const now = Date.now();
  const active = keys.filter((k) => {
    if (apkDeadKeysSession.has(k)) return false;
    const cooldown = apkRateLimitedUntil.get(k) || 0;
    return cooldown <= now;
  });
  const candidates = active.length > 0 ? active : keys.filter((k) => !apkDeadKeysSession.has(k));
  const pool = candidates.length > 0 ? candidates : keys;
  if (apkLastWorkingKey && pool.includes(apkLastWorkingKey)) {
    return [apkLastWorkingKey, ...pool.filter((k) => k !== apkLastWorkingKey)];
  }
  return pool;
}

function getApkGenerationConfig(modelName: string, selectedModel?: string, disableThinking = false): Record<string, any> | undefined {
  if (modelName.startsWith('gemini-2.5-')) {
    const budget = (!disableThinking && selectedModel === 'Prodix pro') ? 512 : 0;
    return { thinkingConfig: { thinkingBudget: budget } };
  }
  if (modelName === 'gemini-4-hydrogen') {
    return { thinkingConfig: { thinkingLevel: disableThinking ? 'LOW' : (selectedModel === 'Prodix pro' ? 'MEDIUM' : 'LOW') } };
  }
  return undefined;
}

function buildApkCleanWebSearchQuery(rawQuery: string): string {
  const expanded = rawQuery
    .replace(/\bmancity\b/gi, 'Manchester City')
    .replace(/\bman\s*city\b/gi, 'Manchester City')
    .replace(/\bmanutd\b/gi, 'Manchester United')
    .replace(/\bman\s*utd\b/gi, 'Manchester United')
    .replace(/\bbarca\b/gi, 'Barcelona');
  const stopWords = new Set([
    'wampaye', 'ampaye', 'mbonera', 'mbwira', 'wambwira', 'nyibarize', 'shaka', 'kuri', 'internet', 'google',
    'amakuru', 'agezweho', 'bigezweho', 'ibigezweho', 'mashya', 'masha', 'mwikipe', 'ikipe', 'ya', 'yo', 'za', 'mu', 'muri',
    'ubu', 'ubungubu', 'uyu', 'uyumunsi', 'munsi', 'ejo', 'niba', 'hari', 'icyo', 'uko', 'bimeze', 'ese', 'iki', 'gute',
    'byagenze', 'byabaye', 'nde', 'ziri', 'kandi', 'cyane', 'yuyu', 'ryuyu', 'please', 'tell',
    'me', 'about', 'what', 'is', 'are', 'the', 'in', 'on', 'for', 'of', 'latest', 'news',
    'current', 'today', 'now', 'give', 'search', 'online', 'live', 'recent', 'recently', 'update', 'updates',
    'breaking', 'headlines', 'trending',
  ]);
  const tokens = expanded
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopWords.has(w.toLowerCase()));
  return tokens.length > 0 ? tokens.join(' ').slice(0, 120) : 'Rwanda world breaking news';
}

function decodeApkXmlEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
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

  if (items.length === 0) {
    const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 6);
    for (const match of itemMatches) {
      const block = match[1];
      const title = decodeApkXmlEntities(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '');
      const link = decodeApkXmlEntities(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '');
      const pubDate = decodeApkXmlEntities(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '');
      const sourceName = decodeApkXmlEntities(block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || '');
      const sourceUrl = decodeApkXmlEntities(block.match(/<source[^>]*url="([^"]+)"/)?.[1] || '');
      const url = link || sourceUrl;
      if (title && url) {
        items.push({ title, url, pubDate, sourceName });
      }
    }
  }

  if (items.length === 0) return { contextText: '', sources: [] };

  const lines = items.map((it, idx) =>
    `${idx + 1}. "${it.title}"${it.sourceName ? ` (${it.sourceName})` : ''}${it.pubDate ? ` [${it.pubDate}]` : ''} — ${it.url}`
  );
  const contextText = `[LIVE INTERNET NEWS & WEB SEARCH RESULTS FOR "${cleanQuery}"]:\nCRITICAL: Today is ${new Date().toISOString().slice(0, 10)}. Use ONLY these verified, up-to-date real-time articles below to answer the user's question accurately in their language. NEVER use outdated 2023/2024/2025 information:\n${lines.join('\n')}`;
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

  // 1. Native Android bridge RSS fetch (deferred off microtask, bounded to 2.4s so UI never freezes)
  try {
    const bridge = (window as any).KevinAgentBridge;
    if (bridge?.fetchWebNewsRss) {
      const nativeRss = await new Promise<{ contextText: string; sources: GroundingSource[] }>((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
          if (!done) {
            done = true;
            resolve({ contextText: '', sources: [] });
          }
        }, 2400);
        setTimeout(() => {
          try {
            const xml = String(bridge.fetchWebNewsRss(cleanQuery) || '');
            const parsed = parseRssXmlForApk(xml, cleanQuery);
            if (!done) {
              done = true;
              clearTimeout(timer);
              resolve(parsed);
            }
          } catch {
            if (!done) {
              done = true;
              clearTimeout(timer);
              resolve({ contextText: '', sources: [] });
            }
          }
        }, 0);
      });
      if (nativeRss.contextText) return nativeRss;
    }
  } catch {}

  // 2. Race fast Wikipedia API and backend /api/web-search (strict 2.2s cap to avoid Render cold-start stalls)
  const fetchBackendSearch = async (): Promise<{ contextText: string; sources: GroundingSource[] }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2200);
    try {
      const res = await fetch(`${PRODUCTION_BACKEND_URL}/api/web-search?q=${encodeURIComponent(rawQuery)}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('backend_search_failed');
      const data = await res.json().catch(() => null);
      if (data?.contextText) {
        return {
          contextText: String(data.contextText),
          sources: Array.isArray(data.sources) ? data.sources : [],
        };
      }
      throw new Error('empty_backend_search');
    } finally {
      clearTimeout(timer);
    }
  };

  const fetchWikiSearch = async (): Promise<{ contextText: string; sources: GroundingSource[] }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2200);
    try {
      const wikiRes = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQuery)}&srlimit=5&format=json&origin=*`,
        { signal: controller.signal }
      );
      if (!wikiRes.ok) throw new Error('wiki_failed');
      const wikiJson = await wikiRes.json().catch(() => null);
      const searchHits: any[] = wikiJson?.query?.search || [];
      if (searchHits.length === 0) throw new Error('empty_wiki');
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
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await Promise.any([fetchBackendSearch(), fetchWikiSearch()]);
  } catch {}

  return { contextText: '', sources: [] };
}

function buildApkSystemInstruction(
  userName: string,
  hasAudioAttachment: boolean,
  savedContacts: SavedContact[],
  perms: AgentPermissions,
  latestUserText = ''
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

  // Only inspect/attach contacts when the user is actually making a call/SMS/WhatsApp/contact request (saves ~8,000 tokens & UI thread bridge time!)
  const needsContacts = hasAudioAttachment || /(?:hamagar|terefon|oherez)|\b(call|dial|sms|message|ubutumwa|send|whatsapp|wa|contact|nimero|number)\b/i.test(latestUserText);
  let contactsList: string[] = [];
  if (needsContacts) {
    let effectiveContacts = savedContacts;
    const cacheValid = apkCachedNativeContacts && (Date.now() - apkCachedNativeContactsAt < 60_000);
    if (cacheValid && apkCachedNativeContacts && apkCachedNativeContacts.length > effectiveContacts.length) {
      effectiveContacts = apkCachedNativeContacts;
    } else if (typeof window !== 'undefined' && effectiveContacts.length < 50 && !cacheValid) {
      try {
        const bridge = (window as any).KevinAgentBridge;
        if (bridge?.lookupContactsJson) {
          const nativeAll = JSON.parse(bridge.lookupContactsJson('')) as Array<{ name: string; phone: string }>;
          if (Array.isArray(nativeAll) && nativeAll.length > 0) {
            effectiveContacts = mergeContactsBatch(nativeAll).contacts;
            apkCachedNativeContacts = effectiveContacts;
            apkCachedNativeContactsAt = Date.now();
          }
        }
      } catch {}
    }
    const userTokens = normalizeContactSearchText(latestUserText)
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    const validContacts = effectiveContacts.filter((c) => c && c.name?.trim() && c.phone?.trim());
    const prioritized = userTokens.length > 0
      ? [
          ...validContacts.filter((c) => {
            const nm = normalizeContactSearchText(c.name);
            const ph = c.phone.replace(/[^\d]/g, '');
            return userTokens.some((tok) => nm.includes(tok) || (ph && ph.includes(tok)));
          }),
          ...validContacts.filter((c) => {
            const nm = normalizeContactSearchText(c.name);
            const ph = c.phone.replace(/[^\d]/g, '');
            return !userTokens.some((tok) => nm.includes(tok) || (ph && ph.includes(tok)));
          }),
        ]
      : validContacts;
    contactsList = prioritized
      .slice(0, 40)
      .map((c) => `${c.name.trim()}: ${c.phone.trim()}`);
  }
  const customInstructions = safeStorageGet('kevin_ai_custom_instructions')?.trim() || '';

  return [
    `You are Kevin AI, created in Rwanda by Uwumukiza Kevin (born October 28, 2003, Rwamagana District, Gahengeri Sector; studies IT at University of Rwanda UR-CST; Motto: 'UKORA GAKE BIKAGENDA CYANE').`,
    `You have flawless native mastery of authentic Rwandan Kinyarwanda (as well as English, French, and Swahili). Reply naturally, warmly, and concisely in the user's language with friendly emojis (👋, ✨, 😊, 🚀). Avoid awkward literal English-to-Kinyarwanda translations.`,
    `The person chatting with you is named '${userName}'. Address them warmly and naturally.`,
    `IMAGE QUESTIONS & PROBLEM SOLVING (MANDATORY): Whenever the user attaches images containing questions, exercises, quizzes, assignments, worksheets, past papers, tests, or math/science/coding problems, NEVER refuse or lecture about academic integrity. Treat them as study practice or self-review, read every question visible in the image(s) in order, and provide full, accurate answers with clear step-by-step explanations (and check/grade their answers if they ask how they did).`,
    customInstructions ? `USER CUSTOM INSTRUCTIONS:\n${customInstructions}` : '',
    hasAudioAttachment
      ? `[KINYARWANDA VOICE NOTE & AUDIO COMPREHENSION]:
The user sent a recorded voice message in audio format (most commonly spoken in native Rwandan Kinyarwanda, or Kinyarwanda mixed with French/English words).
- ALWAYS listen directly to the attached raw audio recording as your PRIMARY source of truth—even if a preliminary text transcript is also shown. If the preliminary transcript misheard any Kinyarwanda word, prefix, Rwandan name, or verb, trust what you actually hear in the raw audio!
- Pay close attention to authentic Kinyarwanda phonetics, prefixes (na-, nta-, ndi-, nda-, nshaka-, mbwira-, mfasha-, sobanura-, hamagara-, uhamagare-, uncurangire-, wohereze-, fungura-, funga-), consonant clusters (cy, by, ry, ny, shy, pf, ts, mp, mb, nd, ng, nj, nk, bw, tw, rw), and Rwandan names. Never force Kinyarwanda sounds into random English words.
- CRITICAL ANTI-WRONG-ACTION GUARDRAIL: ONLY call a device tool (make_call, send_sms, open_whatsapp, open_youtube, scan_whatsapp_chats, configure_whatsapp_autoreply, open_camera) if the user explicitly and clearly commanded that exact action in their audio. If the user is chatting, asking a question, or greeting, reply naturally in authentic Kinyarwanda. If the recording is truly silent/noisy/unintelligible, politely ask them in Kinyarwanda to repeat.`
      : '',
    contactsList.length > 0 ? `[SAVED CONTACTS (${contactsList.length}): ${contactsList.join(' | ')}]` : '',
    `[AGENT PERMISSIONS: autoSend=${Boolean(perms.autoSend)}, autoCall=${perms.autoCall !== false}, autoPlayYouTube=${perms.autoPlayYouTube !== false}, whatsappAutoReply=${Boolean(perms.whatsappAutoReply)}, whatsappAutoReplyPaused=${Boolean(perms.whatsappAutoReply && perms.whatsappAutoReplyPausedUntil && perms.whatsappAutoReplyPausedUntil > Date.now())}. When sending WhatsApp messages to Rwandan numbers, always use country code +250 (e.g. +250788123456 or 250788123456) so WhatsApp delivers immediately. For WhatsApp messages, write ONLY ONE single natural human message matching the recipient's language — NEVER include dates, timestamps, sender names (like 'Kevin:'), or multiple repeated versions. When asked to check all WhatsApp chats or reply to unread/unreplied messages, ALWAYS call scan_whatsapp_chats(). When asked to pause WhatsApp auto-reply for X minutes, turn it off, or turn it back on, ALWAYS call configure_whatsapp_autoreply(). Execute device tool calls ONLY when explicitly requested by the user.]`,
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

  if ((isCapacitorApkRuntime() || customApiKeys.length > 0) && customApiKeys.length > 0) {
    const orderedKeys = prioritizeApkKeys(customApiKeys);
    for (const model of ['gemini-3.5-transcribe', 'gemini-4-hydrogen', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']) {
      let abortModel = false;
      for (const currentKey of orderedKeys) {
        if (apkDeadKeysSession.has(currentKey)) continue;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 9000);
        try {
          const genConfig = model === 'gemini-4-hydrogen' ? getApkGenerationConfig(model, undefined, true) : undefined;
          const bodyPayload: Record<string, any> = {
            contents: [
              {
                role: 'user',
                parts: [
                  { inlineData: { mimeType: normalizedMime, data: cleanAudio } },
                  {
                    text: 'You are an expert native Rwandan speech-to-text transcriber specializing in Kinyarwanda (Ikinyarwanda), plus English, French, and Swahili. Most speakers speak Kinyarwanda or Kinyarwanda mixed with French/English words. Listen carefully to exact Kinyarwanda phonetics, prefixes (n-, u-, a-, tu-, mu-, ba-, nda-, nshaka, mbwira, sobanura, hamagara, uncurangire, ohereza, fungura, funga), consonant clusters (cy, by, ry, ny, sh, shy, pf, ts, mp, mb, nd, ng, nj, nk, bw, tw, rw, kw, gw), and Rwandan names. NEVER twist Kinyarwanda speech into unrelated English or Swahili words. Output ONLY the exact verbatim spoken words with standard Kinyarwanda spelling and no quotes or explanations. If completely silent or pure noise, return empty string "".',
                  },
                ],
              },
            ],
            ...(genConfig ? { generationConfig: genConfig } : {}),
          };
          let directRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(currentKey)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(bodyPayload),
              signal: controller.signal,
            }
          );
          if (directRes.status === 400 && genConfig) {
            delete bodyPayload.generationConfig;
            directRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(currentKey)}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyPayload),
                signal: controller.signal,
              }
            );
          }
          if (!directRes.ok) {
            if (directRes.status === 401 || directRes.status === 403) apkDeadKeysSession.add(currentKey);
            if (directRes.status === 429) apkRateLimitedUntil.set(currentKey, Date.now() + 90_000);
            if (directRes.status === 404) { abortModel = true; break; }
            continue;
          }
          const directJson = await directRes.json();
          const text = directJson?.candidates?.[0]?.content?.parts
            ?.map((p: any) => p?.text || '')
            .join('')
            .trim();
          if (text !== undefined) {
            apkLastWorkingKey = currentKey;
            return text === '""' || text === "''" ? '' : text;
          }
        } catch {
          // try next key/model
        } finally {
          clearTimeout(timer);
        }
      }
      if (abortModel) continue;
    }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 11500);
    const res = await fetch(getEndpoint('/api/stt'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64: cleanAudio,
        audioMimeType: normalizedMime,
        customApiKey,
        customApiKeys,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

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

function sanitizeWhatsAppReplyText(raw: string, ownerName: string, senderName?: string): string {
  if (!raw) return '';
  const cleaned = raw
    .replace(/^```(?:\w+)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const stripPrefix = (line: string): string => {
    let s = line.trim();
    s = s.replace(/^\[[^\]]{3,32}\]\s*[^:\n]{1,40}:\s*/g, '');
    s = s.replace(/^\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?,?\s*\d{1,2}:\d{2}(?:\s*[APMapm]{2})?\s*[-–:]\s*/g, '');
    s = s.replace(/^\d{1,2}:\d{2}(?:\s*[APMapm]{2})?\s*[-–:]\s*/g, '');
    s = s.replace(/^(?:reply|response|igisubizo|assistant|kevin\s*ai|ai|me|you|option\s*\d+)\s*:\s*/i, '');
    const escapedOwner = ownerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (escapedOwner) {
      s = s.replace(new RegExp(`^${escapedOwner}\\s*:\\s*`, 'i'), '');
    }
    if (senderName?.trim()) {
      const escapedSender = senderName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      s = s.replace(new RegExp(`^${escapedSender}\\s*:\\s*`, 'i'), '');
    }
    return s.replace(/^["'“”]+|["'“”]+$/g, '').trim();
  };

  const rawLines = cleaned.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
  if (rawLines.length === 0) return '';

  const hasTranscriptHeaders = rawLines.filter((l) =>
    /^\[[^\]]{3,32}\]\s*[^:\n]{1,40}:/i.test(l) || /^(?:option\s*\d+|reply|\d+[.)])/i.test(l)
  ).length >= 2;

  if (hasTranscriptHeaders) {
    for (const l of rawLines) {
      const single = stripPrefix(l);
      if (single) return single;
    }
  }

  const cleanedLines = rawLines.map(stripPrefix).filter(Boolean);
  if (cleanedLines.length === 0) return '';

  if (cleanedLines.length > 1) {
    const first = cleanedLines[0];
    const second = cleanedLines[1];
    const firstWords = new Set(first.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    const secondWords = second.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const overlap = secondWords.filter((w) => firstWords.has(w)).length;
    if (cleanedLines.length >= 3 || overlap >= 2) {
      return first;
    }
    return `${first} ${second}`.trim();
  }

  return cleanedLines[0];
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
    const orderedKeys = prioritizeApkKeys(customApiKeys);
    for (const model of ['gemini-3.5-flash-lite', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-2.5-flash']) {
      let abortModel = false;
      for (const currentKey of orderedKeys) {
        if (apkDeadKeysSession.has(currentKey)) continue;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 7000);
        try {
          const genConfig = getApkGenerationConfig(model, undefined, true);
          const payload: Record<string, any> = {
            systemInstruction: {
              parts: [
                {
                  text: [
                    `You are ${userName} replying directly on WhatsApp to "${sender || 'your contact'}".`,
                    `Write ONE single, natural human WhatsApp reply message directly addressing what they just wrote.`,
                    `STRICT LANGUAGE RULE:`,
                    `- If the message is in English, reply ONLY in natural, conversational English.`,
                    `- If the message is in Kinyarwanda, reply ONLY in authentic, fluent, grammatically correct native Kinyarwanda (Ikinyarwanda cy'umwimerere — warm, polite, natural Rwandan phrasing, NEVER awkward literal translations).`,
                    `- If the message is in French or Swahili, reply fluently in that exact language.`,
                    `STRICT FORMAT RULES:`,
                    `- Output ONLY the exact message text to send (1 to 2 short sentences max).`,
                    `- NEVER include dates, timestamps (like [23/11, 11:23]), sender names (like "${userName}:"), labels, quotes, or markdown.`,
                    `- NEVER generate multiple replies, multiple options, or a back-and-forth conversation.`,
                    `- NEVER sound like or mention being an AI — write naturally as ${userName} themselves.`,
                    replyStyle?.trim() ? `Owner's Personal Style Preference: ${replyStyle.trim()}` : '',
                  ].filter(Boolean).join('\n'),
                },
              ],
            },
            contents: [{ role: 'user', parts: [{ text: incomingMessage.trim() }] }],
            ...(genConfig ? { generationConfig: genConfig } : {}),
          };
          let directRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(currentKey)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: controller.signal,
            }
          );
          if (directRes.status === 400 && genConfig) {
            delete payload.generationConfig;
            directRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(currentKey)}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal,
              }
            );
          }
          if (!directRes.ok) {
            if (directRes.status === 401 || directRes.status === 403) apkDeadKeysSession.add(currentKey);
            if (directRes.status === 429) apkRateLimitedUntil.set(currentKey, Date.now() + 90_000);
            if (directRes.status === 404) { abortModel = true; break; }
            continue;
          }
          const directJson = await directRes.json();
          const rawReply = directJson?.candidates?.[0]?.content?.parts
            ?.map((p: any) => p?.text || '')
            .join('')
            .trim();
          const reply = sanitizeWhatsAppReplyText(rawReply || '', userName, sender);
          if (reply) {
            apkLastWorkingKey = currentKey;
            return reply;
          }
        } catch {
          // try next key/model
        } finally {
          clearTimeout(timer);
        }
      }
      if (abortModel) continue;
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
    const cleaned = sanitizeWhatsAppReplyText(typeof data.reply === 'string' ? data.reply : '', userName, sender);
    return cleaned || 'Muraho! Ndabona ubutumwa bwawe ubu gato.';
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
  const cleanedHistory = history
    .filter((msg) => {
      const t = (msg?.text || '').trim();
      if (!t && !msg?.image) return false;
      if (msg.sender === 'kevin' && (
        t.startsWith('⚠️')
        || t.startsWith('🔑 Nta Gemini API Key')
        || t.startsWith('Mbabarira, habaye ikibazo')
      )) {
        return false;
      }
      return true;
    })
    .slice(-20);

  const rawContents: any[] = cleanedHistory.map((msg: any, idx: number) => {
    const historyParts: any[] = [{ text: msg.text || "..." }];
    const isRecentTurn = idx >= cleanedHistory.length - 2;
    if (isRecentTurn && typeof msg.image === "string" && msg.image && !/^https?:\/\//i.test(msg.image)) {
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

  // Ensure Gemini REST API turn rules: start with 'user' and strictly alternate user / model
  const contents: any[] = [];
  for (const turn of rawContents) {
    if (contents.length === 0 && turn.role !== 'user') {
      continue;
    }
    const prev = contents[contents.length - 1];
    if (prev && prev.role === turn.role) {
      prev.parts = [...prev.parts, ...turn.parts];
    } else {
      contents.push(turn);
    }
  }

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

  const trimmedLatest = (latestMessage || '').trim();
  const isGenericAudioPlaceholder = !trimmedLatest
    || trimmedLatest === '🎤 Voice Note'
    || trimmedLatest === 'Voice command'
    || trimmedLatest.startsWith('🎤 ')
    || trimmedLatest.startsWith('Listen to the attached voice message');
  const prompt = isGenericAudioPlaceholder && hasAudioAttachment
    ? "Uyu mukoresha yoherereje ubutumwa bw'amajwi (Voice Note). Umva witonze ibyo yavuze mu Kinyarwanda cyangwa urundi rurimi muri iyi audio, umusubize neza mu rurimi yavuze. NTUGAKORE igikorwa na kimwe (hamagara, SMS, WhatsApp, YouTube) utumvise neza ko yabigusabye mu buryo budashidikanywaho — niba amajwi atumvikana neza, musabe ko asubiramo mu Kinyarwanda."
    : hasAudioAttachment && trimmedLatest
      ? `[PRELIMINARY STT DRAFT (always listen directly to the attached raw audio as your primary source — if any Kinyarwanda word, name, or command differs from what you hear, ALWAYS trust the raw audio)]: "${trimmedLatest}"`
      : trimmedLatest || (
          hasImageAttachment
            ? 'Please read all questions, problems, or text shown in these images carefully and provide complete, accurate answers with clear explanations for each.'
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

  if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
    contents[contents.length - 1].parts.push(...parts);
  } else {
    contents.push({ role: "user", parts });
  }

  const userName = typeof window !== 'undefined'
    ? safeStorageGet('kevin_user_name') || safeStorageGet('kevin_ai_user_name') || 'Incuti yanjye'
    : 'Incuti yanjye';

  const customApiKey = getUserCustomApiKey();
  const customApiKeys = getGeminiApiKeysArray();
  const perms = getAgentPermissions();
  const savedContacts = getSavedContacts();
  const isApk = isCapacitorApkRuntime();

  const executeDirectGemini = async (requestContents: any[], includeAudioFlag: boolean) => {
    const latestUserText = Array.isArray(requestContents) && requestContents.length > 0
      ? ((requestContents[requestContents.length - 1] as any)?.parts || [])
          .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
          .join(' ')
          .trim()
      : '';
    const apkSystemInstruction = buildApkSystemInstruction(userName, includeAudioFlag, savedContacts, perms, latestUserText);
    const isExplicitDeviceCommand = /(?:hamagar|terefon|oherez|curang|subiriz|budasubij|indirimbo|auto[\s_-]*reply)|\b(call|dial|sms|send|whatsapp|youtube|play|song|music|audiomack|lark|kamera|camera|fungura|funga|hagarika|pause|stop|resume|subukura|open|instagram|tiktok|spotify|maps|subiza|unread)\b/i.test(latestUserText);
    const isAmakuruGreeting = /^(?:amakuru\s*(?:ki|yawe|yanyu|meza|ni\s*meza|gute)?|bite\s*(?:se)?|muraho|mwaramutse|mwiriwe)[\s?!.,]*$/i.test(latestUserText);
    const shouldTryWebSearch = Boolean(
      latestUserText
      && !includeAudioFlag
      && !isExplicitDeviceCommand
      && !isAmakuruGreeting
      && /\b(news|amakuru|agezweho|bigezweho|ibigezweho|mashya|masha|weather|iteganyagihe|forecast|meteo|météo|score|scores|match|matches|umukino|imikino|results|standings|table|ranking|amanota|shampiyona|champiyona|premier league|champions league|la liga|afcon|world cup|price|igiciro|ibiciro|dollar|idorari|exchange rate|bitcoin|crypto|latest|recent|recently|update|updates|breaking|headlines|trending|tonight|last night|internet|google|search|shaka|online|live|president|perezida|minister|minisiteri|minisitiri|winner|who won|watsinze|yatsinze|batsinze|mancity|man city|manutd|man utd|arsenal|chelsea|liverpool|real madrid|barcelona|rayon|apr|kiyovu|mukura|amavubi|actualites|actualités|nouvelles|igihe|kigalitoday|rba|bbc)\b/i.test(latestUserText)
    );

    // Kick off fast RSS/wiki lookup in parallel ONLY if search intent is detected (zero delay before starting Gemini!)
    const rssPromise: Promise<{ contextText: string; sources: GroundingSource[] }> | null = shouldTryWebSearch
      ? fetchLiveWebSearchForApk(latestUserText).catch(() => ({ contextText: '', sources: [] }))
      : null;
    let rssCache: { contextText: string; sources: GroundingSource[] } | null = null;
    let ungroundedSearchFallbackText = '';

    const phases: Array<'search' | 'rss_text' | 'device'> = shouldTryWebSearch
      ? ['search', 'rss_text']
      : ['device'];
    const orderedKeys = prioritizeApkKeys(customApiKeys);
    let lastDirectErr: unknown = null;

    for (const phase of phases) {
      let phaseContents = requestContents;
      let phaseSources: GroundingSource[] = [];

      if (phase === 'rss_text') {
        if (!rssCache && rssPromise) {
          rssCache = await rssPromise;
        }
        if (rssCache?.contextText) {
          phaseSources = rssCache.sources;
          phaseContents = [
            ...requestContents.slice(0, -1),
            {
              role: 'user',
              parts: [
                ...((requestContents[requestContents.length - 1] as any)?.parts || []),
                { text: `\n\n${rssCache.contextText}` },
              ],
            },
          ];
        } else if (ungroundedSearchFallbackText) {
          onChunk?.(ungroundedSearchFallbackText);
          return {
            streamedText: ungroundedSearchFallbackText,
            streamedActions: [],
            streamedSources: [],
          };
        }
      }

      const apkModels = includeAudioFlag
        ? ['gemini-4-hydrogen', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash']
        : phase === 'search'
          ? ['gemini-3.5-flash-lite', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-2.5-flash']
          : selectedModel === 'Kevin 1.3 Lite'
            ? ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-4-hydrogen', 'gemini-2.5-flash']
            : selectedModel === 'Prodix pro'
              ? ['gemini-4-hydrogen', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash']
              : ['gemini-3.5-flash-lite', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];

      let jumpToNextPhase = false;
      for (const modelName of apkModels) {
        if (jumpToNextPhase) break;
        const isLastApkModel = modelName === apkModels[apkModels.length - 1];
        let abortModelLoop = false;
        for (const currentKey of orderedKeys) {
          if (apkDeadKeysSession.has(currentKey)) continue;
          const maxDirectAttempts = isLastApkModel ? 2 : 1;
          for (let attempt = 0; attempt < maxDirectAttempts; attempt++) {
            const callStreamOrGenerate = async (
              useTools: boolean,
              useThinkingConfig: boolean,
              useStreaming: boolean
            ): Promise<{ res: Response; controller: AbortController; clearHeaderTimer: () => void }> => {
              const payloadBody: Record<string, any> = {
                systemInstruction: { parts: [{ text: apkSystemInstruction }] },
                contents: phaseContents,
              };
              const genConfig = useThinkingConfig ? getApkGenerationConfig(modelName, selectedModel) : undefined;
              if (genConfig) {
                payloadBody.generationConfig = genConfig;
              }
              if (useTools) {
                if (phase === 'search') {
                  payloadBody.tools = [{ google_search: {} }];
                } else if (phase === 'device' && (isExplicitDeviceCommand || includeAudioFlag)) {
                  payloadBody.tools = [{ functionDeclarations: APK_DEVICE_ACTION_DECLARATIONS }];
                }
              }
              const controller = new AbortController();
              const headerTimeoutMs = includeAudioFlag ? 10500 : (isLastApkModel ? 12000 : 7500);
              const timer = setTimeout(() => controller.abort(), headerTimeoutMs);
              const endpointUrl = useStreaming
                ? `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?alt=sse&key=${encodeURIComponent(currentKey)}`
                : `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(currentKey)}`;
              const res = await fetch(endpointUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadBody),
                signal: controller.signal,
              });
              const clearHeaderTimer = () => {
                clearTimeout(timer);
              };
              return { res, controller, clearHeaderTimer };
            };

            let activeController: AbortController | null = null;
            let clearTimer: (() => void) | null = null;
            try {
              const canStream = typeof ReadableStream !== 'undefined' && typeof TextDecoder !== 'undefined';
              const wantsTools = phase === 'search' || (phase === 'device' && (isExplicitDeviceCommand || includeAudioFlag));
              let useTools = wantsTools;
              let useThinking = true;

              let callResult = await callStreamOrGenerate(useTools, useThinking, canStream);
              activeController = callResult.controller;
              clearTimer = callResult.clearHeaderTimer;
              let directRes = callResult.res;

              if (directRes.status === 400 && (useTools || useThinking)) {
                clearTimer();
                // Retry cleanly without tools/thinkingConfig if rejected by model tier
                if (useThinking) {
                  useThinking = false;
                  callResult = await callStreamOrGenerate(useTools, false, canStream);
                  activeController = callResult.controller;
                  clearTimer = callResult.clearHeaderTimer;
                  directRes = callResult.res;
                }
                if (directRes.status === 400 && useTools) {
                  clearTimer();
                  if (phase === 'search') {
                    // Skip straight to rss_text instead of running ungrounded search phase
                    jumpToNextPhase = true;
                    abortModelLoop = true;
                    break;
                  }
                  useTools = false;
                  callResult = await callStreamOrGenerate(false, useThinking, canStream);
                  activeController = callResult.controller;
                  clearTimer = callResult.clearHeaderTimer;
                  directRes = callResult.res;
                }
              }

              if (!directRes.ok) {
                clearTimer();
                const json = await directRes.json().catch(() => null);
                const apiErrMsg = json?.error?.message || `HTTP ${directRes.status}`;
                const lowerErr = apiErrMsg.toLowerCase();
                if (directRes.status === 401 || directRes.status === 403 || lowerErr.includes('api key not valid') || lowerErr.includes('api_key_invalid')) {
                  apkDeadKeysSession.add(currentKey);
                  lastDirectErr = new Error(apiErrMsg);
                  break;
                }
                if (directRes.status === 429 || lowerErr.includes('quota') || lowerErr.includes('rate limit') || lowerErr.includes('resource_exhausted')) {
                  apkRateLimitedUntil.set(currentKey, Date.now() + 90_000);
                  lastDirectErr = new Error(apiErrMsg);
                  break;
                }
                const isNotFound = directRes.status === 404
                  || lowerErr.includes('not found')
                  || lowerErr.includes('no longer available')
                  || lowerErr.includes('deprecated')
                  || lowerErr.includes('not supported');
                if (!isNotFound || !lastDirectErr) {
                  lastDirectErr = new Error(apiErrMsg);
                }
                if (isNotFound) {
                  abortModelLoop = true;
                  break;
                }
                const isTransientBusy = directRes.status === 503
                  || lowerErr.includes('high demand')
                  || lowerErr.includes('unavailable')
                  || lowerErr.includes('overloaded');
                if (isTransientBusy && attempt + 1 < maxDirectAttempts) {
                  await new Promise((r) => setTimeout(r, 300));
                  continue;
                }
                break;
              }

              clearTimer();
              let streamedText = '';
              let bufferedSearchText = '';
              const pendingFunctionCalls: Array<{ name: string; args: Record<string, any> }> = [];
              const directSources: GroundingSource[] = [...phaseSources];

              let midStreamErrorMsg = '';
              const processCandidatePayload = (payload: any) => {
                if (payload?.error?.message) {
                  midStreamErrorMsg = String(payload.error.message);
                  return;
                }
                const candidate = payload?.candidates?.[0];
                const gChunks = candidate?.groundingMetadata?.groundingChunks || [];
                for (const gc of gChunks) {
                  const uri = gc?.web?.uri || gc?.maps?.uri;
                  const title = gc?.web?.title || gc?.maps?.title || uri;
                  if (uri && !directSources.some((s) => s.url === uri)) {
                    directSources.push({ title, url: uri });
                  }
                }
                const responseParts: any[] = candidate?.content?.parts || [];
                for (const part of responseParts) {
                  if (part?.text) {
                    streamedText += part.text;
                    if (phase === 'search' && directSources.length === 0) {
                      bufferedSearchText += part.text;
                    } else {
                      if (bufferedSearchText) {
                        onChunk?.(bufferedSearchText);
                        bufferedSearchText = '';
                      }
                      onChunk?.(part.text);
                    }
                  } else if (part?.functionCall?.name) {
                    pendingFunctionCalls.push({
                      name: String(part.functionCall.name),
                      args: { ...(part.functionCall.args || {}) },
                    });
                  }
                }
              };

              if (canStream && directRes.body) {
                const reader = directRes.body.getReader();
                const decoder = new TextDecoder();
                let sseBuffer = '';
                let stallTimer = setTimeout(() => activeController?.abort(), 16000);
                try {
                  while (true) {
                    const { value, done } = await reader.read();
                    clearTimeout(stallTimer);
                    if (done) break;
                    stallTimer = setTimeout(() => activeController?.abort(), 16000);
                    sseBuffer += decoder.decode(value, { stream: true });
                    const lines = sseBuffer.split(/\r?\n/);
                    sseBuffer = lines.pop() || '';
                    for (const line of lines) {
                      const trimmedLine = line.trim();
                      if (!trimmedLine.startsWith('data:')) continue;
                      const jsonStr = trimmedLine.slice(5).trim();
                      if (!jsonStr || jsonStr === '[DONE]') continue;
                      try {
                        processCandidatePayload(JSON.parse(jsonStr));
                      } catch {
                        // skip malformed partial chunk
                      }
                    }
                  }
                  if (sseBuffer.trim().startsWith('data:')) {
                    const jsonStr = sseBuffer.trim().slice(5).trim();
                    if (jsonStr && jsonStr !== '[DONE]') {
                      try {
                        processCandidatePayload(JSON.parse(jsonStr));
                      } catch {}
                    }
                  }
                } catch (readErr: any) {
                  if (!streamedText) {
                    throw readErr;
                  }
                  midStreamErrorMsg = readErr?.message || 'Stream interrupted';
                } finally {
                  clearTimeout(stallTimer);
                }
              } else {
                const json = await directRes.json().catch(() => null);
                processCandidatePayload(json);
              }

              // If stream failed mid-sentence after outputting partial text, finish cleanly via non-streaming generateContent
              if (midStreamErrorMsg && streamedText.trim()) {
                try {
                  const lastTurnParts = Array.isArray((phaseContents[phaseContents.length - 1] as any)?.parts)
                    ? (phaseContents[phaseContents.length - 1] as any).parts
                    : [{ text: latestUserText }];
                  const rescueBody: Record<string, any> = {
                    systemInstruction: { parts: [{ text: apkSystemInstruction }] },
                    contents: [
                      ...phaseContents.slice(0, -1),
                      {
                        role: 'user',
                        parts: [
                          ...lastTurnParts,
                          {
                            text: `\n\nContinue seamlessly from the EXACT character where your previous response stopped without repeating already sent text:\n\n[ALREADY SENT]:\n${streamedText}`,
                          },
                        ],
                      },
                    ],
                  };
                  const rescueRes = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(currentKey)}`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(rescueBody),
                    }
                  );
                  if (rescueRes.ok) {
                    const rescueJson = await rescueRes.json().catch(() => null);
                    const contText = rescueJson?.candidates?.[0]?.content?.parts
                      ?.map((p: any) => p?.text || '')
                      .join('') || '';
                    if (contText) {
                      const tail = streamedText.slice(-30);
                      const overlapIdx = tail.length >= 6 ? contText.indexOf(tail) : -1;
                      const cleanCont = overlapIdx >= 0 ? contText.slice(overlapIdx + tail.length) : contText;
                      if (cleanCont) {
                        streamedText += cleanCont;
                        if (phase === 'search' && directSources.length === 0) {
                          bufferedSearchText += cleanCont;
                        } else {
                          onChunk?.(cleanCont);
                        }
                      }
                      midStreamErrorMsg = '';
                    }
                  }
                } catch {}
              } else if (midStreamErrorMsg && !streamedText.trim()) {
                throw new Error(midStreamErrorMsg);
              }

              const streamedActions: DeviceAction[] = [];
              for (const fc of pendingFunctionCalls) {
                const fcName = fc.name;
                const fcArgs = fc.args;
                if (fcName === 'open_app' && String(fcArgs.app_name || '').toLowerCase().includes('google search')) {
                  continue;
                }
                if (fcName === 'make_call' || fcName === 'send_sms' || fcName === 'open_whatsapp') {
                  const p = String(fcArgs.phone_number || '').trim();
                  const n = String(fcArgs.contact_name || '').trim();
                  if ((!p && !n) || /^(unknown|someone|anybody|none)$/i.test(n)) {
                    continue;
                  }
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

              if (directSources.length === 0 && streamedText) {
                const mdSources = extractMarkdownUrls(streamedText);
                directSources.push(...mdSources);
              }

              // If Search returned an ungrounded answer, immediately check RSS (don't waste 3 more models first)
              if (phase === 'search' && directSources.length === 0) {
                if (streamedText.trim()) {
                  ungroundedSearchFallbackText = streamedText;
                  apkLastWorkingKey = currentKey;
                }
                jumpToNextPhase = true;
                abortModelLoop = true;
                break;
              }

              if (bufferedSearchText) {
                onChunk?.(bufferedSearchText);
                bufferedSearchText = '';
              }

              if (directSources.length > 0) {
                onSources?.(directSources);
              }

              if (streamedText || streamedActions.length > 0) {
                apkLastWorkingKey = currentKey;
                return { streamedText, streamedActions, streamedSources: directSources };
              }
              break;
            } catch (directErr: any) {
              clearTimer?.();
              lastDirectErr = directErr;
              if (directErr?.name === 'AbortError' && !isLastApkModel) {
                abortModelLoop = true;
                break;
              }
              if (attempt + 1 < maxDirectAttempts) {
                await new Promise((r) => setTimeout(r, 300));
                continue;
              }
            }
          }
          if (abortModelLoop) break;
        }
      }
    }

    throw lastDirectErr instanceof Error
      ? lastDirectErr
      : new Error('Direct Gemini request failed.');
  };

  const executeChatRequest = async (requestContents: any[], includeAudioFlag: boolean) => {
    const controller = new AbortController();
    const connectTimeoutMs = isApk ? 14000 : 30000;
    const connectTimer = setTimeout(() => controller.abort(), connectTimeoutMs);
    let res: Response;
    try {
      res = await fetch(getEndpoint('/api/chat'), {
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
        signal: controller.signal,
      });
    } finally {
      clearTimeout(connectTimer);
    }

    if (!res.ok) {
      let errMessage = `HTTP ${res.status} Server error during chat`;
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

  const isTransientHighDemandError = (err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err || '');
    const lower = msg.toLowerCase();
    return msg.includes('503')
      || lower.includes('high demand')
      || lower.includes('unavailable')
      || lower.includes('overloaded');
  };

  if (isApk) {
    if (customApiKeys.length > 0) {
      try {
        const directResult = await executeDirectGemini(contents, hasAudioAttachment);
        fullResponse = directResult.streamedText;
        actions = directResult.streamedActions;
      } catch (directErr: any) {
        if (isTransientHighDemandError(directErr)) {
          await new Promise((r) => setTimeout(r, 450));
          const retryResult = await executeDirectGemini(contents, hasAudioAttachment);
          fullResponse = retryResult.streamedText;
          actions = retryResult.streamedActions;
        } else {
          try {
            const backendResult = await executeChatRequest(contents, hasAudioAttachment);
            fullResponse = backendResult.streamedText;
            actions = backendResult.streamedActions;
          } catch {
            throw directErr;
          }
        }
      }
    } else {
      try {
        const backendResult = await executeChatRequest(contents, hasAudioAttachment);
        fullResponse = backendResult.streamedText;
        actions = backendResult.streamedActions;
      } catch (backendErr: any) {
        if (isTransientHighDemandError(backendErr)) {
          try {
            await new Promise((r) => setTimeout(r, 450));
            const retryBackend = await executeChatRequest(contents, hasAudioAttachment);
            fullResponse = retryBackend.streamedText;
            actions = retryBackend.streamedActions;
          } catch (retryErr: any) {
            throw retryErr;
          }
        } else {
          throw new Error('APK_NO_API_KEY: Nta Gemini API Key irabikwa muri porogaramu. Nyamuneka jya muri Settings > INJIZA KEVIN API KEYS ushyiremo API Key yawe.');
        }
      }
    }
  } else {
    try {
      const result = await executeChatRequest(contents, hasAudioAttachment);
      fullResponse = result.streamedText;
      actions = result.streamedActions;
    } catch (err: any) {
      const isHighDemand = isTransientHighDemandError(err);

      // If user has custom API key(s) saved on Web (Vercel/GitHub Pages) and backend failed/500, call Gemini directly
      if (customApiKeys.length > 0) {
        try {
          const directFallback = await executeDirectGemini(contents, hasAudioAttachment);
          fullResponse = directFallback.streamedText;
          actions = directFallback.streamedActions;
        } catch (directWebErr: any) {
          if (isHighDemand && hasAudioAttachment && !isGenericAudioPlaceholder && prompt) {
            const textOnlyContents = [
              ...contents.slice(0, -1),
              { role: 'user', parts: [{ text: prompt }] },
            ];
            const fallbackResult = await executeChatRequest(textOnlyContents, false);
            fullResponse = fallbackResult.streamedText;
            actions = fallbackResult.streamedActions;
          } else {
            throw directWebErr;
          }
        }
      } else if (isHighDemand && hasAudioAttachment && !isGenericAudioPlaceholder && prompt) {
        const textOnlyContents = [
          ...contents.slice(0, -1),
          { role: 'user', parts: [{ text: prompt }] },
        ];
        const fallbackResult = await executeChatRequest(textOnlyContents, false);
        fullResponse = fallbackResult.streamedText;
        actions = fallbackResult.streamedActions;
      } else if (isHighDemand) {
        await new Promise((r) => setTimeout(r, 850));
        const retryResult = await executeChatRequest(contents, hasAudioAttachment);
        fullResponse = retryResult.streamedText;
        actions = retryResult.streamedActions;
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
