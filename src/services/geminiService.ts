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
  const digits = String(phone || '').replace(/[^\d]/g, '');
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

export function getSavedContacts(): SavedContact[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CONTACTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistContacts(contacts: SavedContact[]): SavedContact[] {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
      window.dispatchEvent(new CustomEvent('kevinContactsUpdated', { detail: contacts }));
    } catch {
      // Ignore storage errors
    }
  }
  return contacts;
}

export function saveContact(name: string, phone: string): SavedContact[] {
  const cleanName = name.trim();
  const cleanPhone = sanitizePhoneNumber(phone);
  if (!cleanName || !isLikelyPhoneNumber(cleanPhone)) {
    return getSavedContacts();
  }
  const existing = getSavedContacts();
  const phoneKey = normalizePhoneKey(cleanPhone);
  const filtered = existing.filter(
    (c) => normalizePhoneKey(c.phone) !== phoneKey && c.name.toLowerCase() !== cleanName.toLowerCase()
  );
  const next: SavedContact[] = [
    { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: cleanName, phone: cleanPhone },
    ...filtered,
  ].slice(0, 300);
  return persistContacts(next);
}

export function deleteSavedContact(id: string): SavedContact[] {
  const next = getSavedContacts().filter((c) => c.id !== id);
  return persistContacts(next);
}

export function mergeContactsBatch(entries: Array<{ name: string; phone: string }>): { added: number; contacts: SavedContact[] } {
  const current = getSavedContacts();
  const seen = new Set(current.map((c) => `${c.name.toLowerCase()}|${normalizePhoneKey(c.phone)}`));
  let added = 0;
  const merged = [...current];

  for (const item of entries) {
    const cleanName = (item.name || '').trim();
    const cleanPhone = sanitizePhoneNumber(item.phone || '');
    if (!cleanName || !isLikelyPhoneNumber(cleanPhone)) continue;
    const key = `${cleanName.toLowerCase()}|${normalizePhoneKey(cleanPhone)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: cleanName,
      phone: cleanPhone,
    });
    added++;
  }

  merged.sort((a, b) => a.name.localeCompare(b.name));
  return { added, contacts: persistContacts(merged.slice(0, 300)) };
}

export function importContactsFromVcfText(vcfText: string): { added: number; contacts: SavedContact[] } {
  const unfolded = vcfText.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const cards = unfolded.split(/BEGIN:VCARD/i);
  const extracted: Array<{ name: string; phone: string }> = [];

  for (const card of cards) {
    if (!card.trim()) continue;
    const lines = card.split(/\r?\n/);
    let fullName = '';
    const phones: string[] = [];

    for (const line of lines) {
      if (/^FN[;:]/i.test(line)) {
        fullName = line.split(':').slice(1).join(':').trim();
      } else if (!fullName && /^N[;:]/i.test(line)) {
        const parts = line.split(':').slice(1).join(':').split(';').filter(Boolean);
        if (parts.length >= 2) fullName = `${parts[1]} ${parts[0]}`.trim();
        else if (parts.length === 1) fullName = parts[0].trim();
      } else if (/^TEL[;:]/i.test(line)) {
        const num = line.split(':').slice(1).join(':').replace(/^tel:/i, '').trim();
        if (num) phones.push(num);
      }
    }

    if (fullName && phones.length > 0) {
      extracted.push({ name: fullName, phone: phones[0] });
    }
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

function getRelevantContactsForPrompt(promptText: string): Array<{ name: string; phone: string }> {
  const saved = getSavedContacts().map((c) => ({ name: c.name, phone: c.phone }));
  if (typeof window === 'undefined') return saved.slice(0, 40);

  const bridge = (window as any).KevinAgentBridge;
  if (!bridge?.lookupContactsJson) return saved.slice(0, 40);

  const words = promptText
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 8);

  const merged = new Map<string, { name: string; phone: string }>();
  for (const c of saved) {
    merged.set(`${c.name.toLowerCase()}|${normalizePhoneKey(c.phone)}`, c);
  }
  for (const word of words) {
    try {
      const nativeHits = JSON.parse(bridge.lookupContactsJson(word)) as Array<{ name: string; phone: string }>;
      for (const hit of nativeHits || []) {
        if (hit?.name && hit?.phone) {
          merged.set(`${hit.name.toLowerCase()}|${normalizePhoneKey(hit.phone)}`, {
            name: hit.name,
            phone: sanitizePhoneNumber(hit.phone),
          });
        }
      }
    } catch {
      // ignore
    }
  }
  return Array.from(merged.values()).slice(0, 40);
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
      return true; // Embedded autoplay iframe handles immediate playback on web
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

    if (!resolvedPhone) return null;

    if (name === "make_call") {
      url = `tel:${resolvedPhone}`;
      fallbackUrl = url;
      label = resolvedName ? `Hamagara ${resolvedName} (${resolvedPhone})` : `Hamagara ${resolvedPhone}`;
      const action: DeviceAction = {
        name,
        args: { ...args, phone_number: resolvedPhone, contact_name: resolvedName },
        label,
        url,
        fallbackUrl,
        phoneNumber: resolvedPhone,
        contactName: resolvedName,
        status: perms.autoCall ? 'executed' : 'needs_permission',
      };
      runDeviceAction(action);
      return action;
    }

    if (name === "send_sms") {
      url = `sms:${resolvedPhone}?body=${encodeURIComponent(messageText)}`;
      fallbackUrl = url;
      label = resolvedName ? `SMS → ${resolvedName} (${resolvedPhone})` : `SMS → ${resolvedPhone}`;
      const action: DeviceAction = {
        name,
        args: { ...args, phone_number: resolvedPhone, contact_name: resolvedName },
        label,
        url,
        fallbackUrl,
        phoneNumber: resolvedPhone,
        messageText,
        contactName: resolvedName,
        status: perms.autoSend ? 'executed' : 'needs_permission',
      };
      runDeviceAction(action);
      return action;
    }

    const digits = resolvedPhone.replace(/[^\d]/g, "");
    url = `https://wa.me/${digits}?text=${encodeURIComponent(messageText)}`;
    fallbackUrl = url;
    label = `WhatsApp → ${resolvedName || resolvedPhone}`;
    const waAction: DeviceAction = {
      name,
      args: { ...args, phone_number: resolvedPhone, contact_name: resolvedName },
      label,
      url,
      fallbackUrl,
      phoneNumber: resolvedPhone,
      messageText,
      contactName: resolvedName,
      status: perms.autoSend ? 'executed' : 'needs_permission',
    };
    runDeviceAction(waAction);
    return waAction;
  }

  if (name === "open_youtube") {
    videoId = args.videoId ? String(args.videoId) : undefined;
    videoTitle = args.videoTitle ? String(args.videoTitle) : (query || "YouTube Video");
    channel = args.channel ? String(args.channel) : "YouTube";

    if (videoId) {
      embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0`;
      intentUrl = `vnd.youtube://${videoId}`;
      fallbackUrl = `https://www.youtube.com/watch?v=${videoId}&autoplay=1`;
    } else {
      const encodedQuery = encodeURIComponent(query);
      intentUrl = `vnd.youtube://results?search_query=${encodedQuery}&autoplay=1`;
      fallbackUrl = `https://www.youtube.com/results?search_query=${encodedQuery}`;
    }
    url = fallbackUrl;
    label = videoTitle;
  } else if (name === "open_audiomack") {
    const encodedQuery = encodeURIComponent(query);
    intentUrl = `audiomack://search/${encodedQuery}`;
    fallbackUrl = `https://audiomack.com/search?q=${encodedQuery}`;
    url = fallbackUrl;
    label = `Audiomack: ${query}`;
  } else if (name === "open_lark_player") {
    const encodedQuery = encodeURIComponent(query);
    intentUrl = query ? `larkplayer://search?query=${encodedQuery}` : "larkplayer://";
    fallbackUrl = query
      ? `https://www.google.com/search?q=${encodeURIComponent(`Lark Player ${query}`)}`
      : "https://play.google.com/store/apps/details?id=com.starcloudd.larkplayer";
    url = fallbackUrl;
    label = "Lark Player";
  } else if (name === "configure_whatsapp_autoreply") {
    const enabled = Boolean(args.enabled);
    const nextPerms: AgentPermissions = {
      ...perms,
      whatsappAutoReply: enabled,
      whatsappReplyStyle: typeof args.reply_style === 'string' && args.reply_style.trim()
        ? args.reply_style.trim()
        : perms.whatsappReplyStyle,
    };
    saveAgentPermissions(nextPerms);
    label = enabled ? "WhatsApp Auto-Reply: ON" : "WhatsApp Auto-Reply: OFF";
    return {
      name,
      args,
      label,
      status: 'executed',
    };
  } else if (name === "open_camera") {
    label = "Camera";
    const action: DeviceAction = { name, args, label, status: 'executed' };
    runDeviceAction(action);
    return action;
  } else if (name === "open_app") {
    const appUrls: Record<string, string> = {
      instagram: "https://www.instagram.com/",
      tiktok: "https://www.tiktok.com/",
      spotify: "https://open.spotify.com/",
      maps: "https://maps.google.com/",
    };
    url = appUrls[appName];
    fallbackUrl = url;
    label = appName ? appName.charAt(0).toUpperCase() + appName.slice(1) : "App";
  }

  if (!url) return null;
  const action: DeviceAction = {
    name,
    args,
    label,
    url,
    intentUrl,
    fallbackUrl,
    embedUrl,
    videoId,
    videoTitle,
    channel,
    phoneNumber: rawPhoneNumber || undefined,
    messageText,
    contactName: rawContactName,
    status: 'executed',
  };
  runDeviceAction(action);
  return action;
}

function actionConfirmation(action: DeviceAction): string {
  const targetDisplay = action.contactName
    ? `${action.contactName}${action.phoneNumber ? ` (${action.phoneNumber})` : ''}`
    : (action.phoneNumber || action.args?.phone_number || '');

  if (action.status === 'choose_contact') {
    return `Nabonye abantu benshi bitwa **${action.contactName}**. Hitamo uwo ushaka hasi 👇`;
  }
  if (action.status === 'contact_not_found') {
    return `Sinabonye nimero ya **${action.contactName}** muri Contacts. Shyiramo nimero hasi cyangwa ukore **Import Contacts** kugira ngo mbikore ako kanya! 📇`;
  }

  if (action.name === "make_call") {
    if (action.status === 'needs_permission') {
      return `Guhamagara **${targetDisplay}** biteguye. Kanda **"Emerera & Hamagara"** hasi kugira ngo mpitemo mpite mpamagara! 🔐📞`;
    }
    if (action.status === 'dialed_needs_permission') {
      return `📞 Nfunguye dialer kuri **${targetDisplay}**. Emeza **Direct Call** permission kugira ngo ubutaha ujye uhita uhamagara ako kanya! 📱`;
    }
    return `📞 Ndahamagaye **${targetDisplay}** ako kanya! 🚀`;
  }
  if (action.name === "send_sms") {
    if (action.status === 'needs_permission') {
      return `Ubutumwa bwateguwe (${targetDisplay}). Kanda **"Emerera Kevin AI"** hasi kugira ngo mbwohereze ako kanya! 🔐`;
    }
    return `✅ Ubutumwa (SMS) bwoherejwe kuri **${targetDisplay}** ako kanya! 📩🚀`;
  }
  if (action.name === "open_whatsapp") {
    if (action.status === 'needs_permission') {
      return `Ubutumwa bwa WhatsApp bwateguwe (${targetDisplay}). Kanda **"Emerera Kevin AI"** hasi kugira ngo mbwohereze ako kanya! 🔐`;
    }
    return `✅ Ubutumwa bwa WhatsApp bwoherejwe kuri **${targetDisplay}** ako kanya! 💬🚀`;
  }
  if (action.name === "configure_whatsapp_autoreply") {
    return Boolean(action.args?.enabled)
      ? "✅ WhatsApp Auto-Reply yashyizwe ku murongo! Kevin AI izajya ihita isubiza ubutumwa bwa WhatsApp bwinjiye."
      : "⏸️ WhatsApp Auto-Reply yahagaritswe.";
  }
  if (action.name === "open_camera") return "Nfunguriye camera yawe! 📸🚀";
  if (action.name === "open_youtube") {
    return action.videoId
      ? `▶️ Ndahise ncuranga **${action.videoTitle || action.args.query}** kuri YouTube! 🎵🚀`
      : `▶️ Nfunguye YouTube kuri **${action.args.query}**! 🎵🚀`;
  }
  if (action.name === "open_audiomack") return `Nfunguriye Audiomack ngushakirire ${action.args.query}! 🎵🚀`;
  return `Nfunguriye ${action.label}! 🚀`;
}

export function getUserCustomApiKey(): string {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('gemini_api_key')?.trim()
      || localStorage.getItem('kevin_ai_custom_api_key')?.trim()
      || '';
  }
  return '';
}

export function setUserCustomApiKey(key: string): void {
  if (typeof window !== 'undefined') {
    const trimmed = key.trim();
    if (trimmed.length > 0) {
      localStorage.setItem('gemini_api_key', trimmed);
      localStorage.setItem('kevin_ai_custom_api_key', trimmed);
    } else {
      localStorage.removeItem('gemini_api_key');
      localStorage.removeItem('kevin_ai_custom_api_key');
    }
  }
}

function getUserCustomInstructions(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('kevin_custom_instructions')?.trim()
    || localStorage.getItem('kevin_ai_custom_instructions')?.trim()
    || '';
}

export function getApiKeysList(): string[] {
  const custom = getUserCustomApiKey();
  return custom ? [custom] : [];
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
  throw new Error(`Unsupported audio format "${normalized || 'unknown'}". Please record audio as WebM, MP4, OGG, or WAV.`);
};

const isValidAudioBase64 = (data: string): boolean =>
  data.length > 100
  && data.length % 4 === 0
  && /^[A-Za-z0-9+/]+={0,2}$/.test(data);

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

  const response = await fetch('/api/stt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audioBase64: cleanAudio,
      audioMimeType: normalizedMime,
      customApiKey: customApiKey || undefined,
    }),
  });

  if (!response.ok) {
    let errMsg = 'Speech-to-Text failed';
    try {
      const data = await response.json();
      if (data?.error) errMsg = data.error;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }

  const data = await response.json() as { transcript?: string };
  return (data.transcript || '').trim();
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

  const response = await fetch('/api/whatsapp-reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender,
      incomingMessage,
      replyStyle,
      userName,
      customApiKey: customApiKey || undefined,
    }),
  });

  if (!response.ok) {
    let errMsg = 'WhatsApp auto-reply generation failed';
    try {
      const data = await response.json();
      if (data?.error) errMsg = data.error;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }

  const data = await response.json() as { reply?: string };
  return (data.reply || '').trim();
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
  const prompt = latestMessage?.trim() || (
    hasAudioAttachment
      ? 'The user sent a voice message. Listen to the audio, understand their speech in Kinyarwanda or English, and answer directly, helpfully, and naturally.'
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
    const attachmentMimeType = typeof Blob !== 'undefined' && attachment instanceof Blob
      ? attachment.type
      : (attachment as AttachmentItem).mimeType || '';
    if (audioBase64 && attachmentMimeType.toLowerCase().startsWith('audio/')) continue;

    if (!(typeof Blob !== 'undefined' && attachment instanceof Blob)) {
      const attItem = attachment as AttachmentItem;
      if (attItem.textContent) {
        parts.push({
          text: `[Attached file: ${attItem.name || 'Document'}]\n${attItem.textContent}`,
        });
        continue;
      }
    }

    let data = "";
    let mimeType = "image/jpeg";
    if (typeof Blob !== 'undefined' && attachment instanceof Blob) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string'
          ? resolve(reader.result)
          : reject(new Error('Unable to encode the audio attachment.'));
        reader.onerror = () => reject(reader.error || new Error('Unable to read the audio attachment.'));
        reader.readAsDataURL(attachment);
      });
      data = cleanBase64(dataUrl);
      mimeType = attachment.type || 'audio/mp4';
    } else {
      const attachmentWithBlob = attachment as AttachmentItem;
      if (attachmentWithBlob.blob) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === 'string'
            ? resolve(reader.result)
            : reject(new Error('Unable to encode the audio attachment.'));
          reader.onerror = () => reject(reader.error || new Error('Unable to read the audio attachment.'));
          reader.readAsDataURL(attachmentWithBlob.blob as Blob);
        });
        data = cleanBase64(dataUrl);
        mimeType = attachmentWithBlob.blob.type || attachmentWithBlob.mimeType || 'audio/webm';
      } else {
        data = cleanBase64(attachmentWithBlob.data || attachmentWithBlob.base64 || "");
        mimeType = attachmentWithBlob.mimeType || mimeType;
      }
    }
    if (mimeType.toLowerCase().startsWith('audio/')) {
      mimeType = normalizeAudioMimeType(mimeType);
      if (!isValidAudioBase64(data)) {
        throw new Error('The recorded audio is empty or invalid. Please record your message again.');
      }
    } else if (!data) {
      continue;
    }
    parts.push({
      inlineData: {
        mimeType,
        data,
      },
    });
  }
  contents.push({ role: "user", parts });

  const userName = typeof window !== 'undefined'
    ? localStorage.getItem('kevin_user_name') || localStorage.getItem('kevin_ai_user_name') || 'Incuti yanjye'
    : 'Incuti yanjye';
  const customInstructions = getUserCustomInstructions();
  const customApiKey = getUserCustomApiKey();
  const agentPermissions = getAgentPermissions();
  const savedContacts = getRelevantContactsForPrompt(prompt);

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      userName,
      customInstructions,
      hasAudioAttachment,
      selectedModel,
      customApiKey: customApiKey || undefined,
      agentPermissions,
      savedContacts,
    }),
  });

  if (!response.ok) {
    let errorMessage = 'Failed to generate AI response';
    try {
      const errData = await response.json();
      if (errData?.error) errorMessage = errData.error;
    } catch {
      const text = await response.text();
      if (text) errorMessage = text;
    }
    throw new Error(errorMessage);
  }

  if (!response.body) {
    throw new Error('No response stream received from server.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullResponse = '';
  const actions: DeviceAction[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: any;
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (event.type === 'text' && event.text) {
        fullResponse += event.text;
        onChunk?.(event.text);
      } else if (event.type === 'action' && event.name) {
        const action = executeDeviceAction(event.name, event.args || {});
        if (action) actions.push(action);
      } else if (event.type === 'error') {
        throw new Error(event.error || 'Failed to generate AI response');
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
