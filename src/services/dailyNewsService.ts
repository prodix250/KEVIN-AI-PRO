import {
  DailyNewsBriefing,
  DailyNewsSlotKey,
  DailyNewsSlotMeta,
  getDueDailyNewsSlots,
  getKigaliClockInfo,
} from './dailyNewsConfig';
import {
  getGeminiApiKeysArray,
  getUserCustomApiKey,
  isCapacitorApkRuntime,
  playNewsNotificationSound,
  resolveApiEndpoint,
} from './geminiService';

export const DELIVERED_NEWS_SLOTS_KEY = 'kevin_ai_delivered_news_slots_v1';
export const NEWS_PENDING_TOAST_EVENT = 'kevinNewsBriefingReceived';
export const NEWS_CUSTOM_INSTRUCTIONS_KEY = 'kevin_news_custom_instructions';
export const NEWS_CUSTOM_INSTRUCTIONS_LEGACY_KEY = 'kevin_ai_news_custom_instructions';

export function getNewsCustomInstructions(): string {
  if (typeof window === 'undefined') return '';
  try {
    const local = (
      window.localStorage.getItem(NEWS_CUSTOM_INSTRUCTIONS_KEY) ||
      window.localStorage.getItem(NEWS_CUSTOM_INSTRUCTIONS_LEGACY_KEY) ||
      ''
    ).trim();
    if (local) return local;
    const bridge = (window as any).KevinAgentBridge;
    if (bridge?.getNewsCustomInstructions) {
      const nativeVal = String(bridge.getNewsCustomInstructions() || '').trim();
      if (nativeVal) {
        window.localStorage.setItem(NEWS_CUSTOM_INSTRUCTIONS_KEY, nativeVal);
        window.localStorage.setItem(NEWS_CUSTOM_INSTRUCTIONS_LEGACY_KEY, nativeVal);
        return nativeVal;
      }
    }
  } catch {}
  return '';
}

export function saveNewsCustomInstructions(raw: string): string {
  const trimmed = (raw || '').trim();
  if (typeof window === 'undefined') return trimmed;
  try {
    if (trimmed) {
      window.localStorage.setItem(NEWS_CUSTOM_INSTRUCTIONS_KEY, trimmed);
      window.localStorage.setItem(NEWS_CUSTOM_INSTRUCTIONS_LEGACY_KEY, trimmed);
    } else {
      window.localStorage.removeItem(NEWS_CUSTOM_INSTRUCTIONS_KEY);
      window.localStorage.removeItem(NEWS_CUSTOM_INSTRUCTIONS_LEGACY_KEY);
    }
    const bridge = (window as any).KevinAgentBridge;
    if (bridge?.setNewsCustomInstructions) {
      bridge.setNewsCustomInstructions(trimmed);
    }
  } catch {}
  return trimmed;
}

export function getDeliveredSlotIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DELIVERED_NEWS_SLOTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function markSlotIdDelivered(slotId: string): void {
  if (typeof window === 'undefined' || !slotId) return;
  try {
    const current = getDeliveredSlotIds();
    if (!current.includes(slotId)) {
      const updated = [...current.slice(-60), slotId];
      window.localStorage.setItem(DELIVERED_NEWS_SLOTS_KEY, JSON.stringify(updated));
    }
    const bridge = (window as any).KevinAgentBridge;
    if (bridge?.syncDeliveredSlotId) {
      bridge.syncDeliveredSlotId(slotId);
    }
  } catch {}
}

export function triggerHeadsUpNewsNotification(briefing: DailyNewsBriefing): void {
  if (typeof window === 'undefined') return;

  // 1. Android native heads-up pop-up notification (plays custom R.raw.kevin_news_whistle via NotificationChannel)
  let nativePlayedSound = false;
  try {
    const bridge = (window as any).KevinAgentBridge;
    if (bridge?.showNewsNotification) {
      nativePlayedSound = Boolean(
        bridge.showNewsNotification(briefing.title, briefing.preview, briefing.slotId)
      );
    }
  } catch (err) {
    console.warn('[DailyNews] Native notification error:', err);
  }

  // 2. Play custom news whistle sound on Web/Desktop/PWA or APK fallback if notifications are disabled
  if (!nativePlayedSound) {
    try {
      playNewsNotificationSound();
    } catch {}
  }

  // 3. Web Notification API (Browser / PWA / Desktop)
  try {
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        const notif = new Notification(briefing.title, {
          body: briefing.preview,
          icon: '/assets/aistudio/image_020a0787.png',
          tag: briefing.slotId,
        });
        notif.onclick = () => {
          window.focus();
          notif.close();
        };
      } else if (Notification.permission === 'default') {
        Notification.requestPermission().then((perm) => {
          if (perm === 'granted') {
            new Notification(briefing.title, {
              body: briefing.preview,
              icon: '/assets/aistudio/image_020a0787.png',
              tag: briefing.slotId,
            });
          }
        }).catch(() => {});
      }
    }
  } catch {}

  // 4. Dispatch in-app top pop-up notification event
  try {
    window.dispatchEvent(
      new CustomEvent(NEWS_PENDING_TOAST_EVENT, {
        detail: briefing,
      })
    );
  } catch {}
}

let isSyncing = false;
let lastSyncAt = 0;

function buildApkSlotSearchQueries(slotKey: DailyNewsSlotKey): string[] {
  if (slotKey === 'morning_tech') {
    return [
      'artificial intelligence OpenAI Google AI Anthropic release',
      'technology Apple Microsoft Nvidia Meta cybersecurity',
    ];
  }
  if (slotKey === 'noon_world') {
    return [
      'Rwanda Africa world breaking news today',
      'football Premier League Champions League today',
    ];
  }
  if (slotKey === 'afternoon_sports_analysis') {
    return [
      'football tactical analysis Premier League Champions League',
      'Real Madrid Barcelona Arsenal Manchester City Liverpool Bayern Munich',
    ];
  }
  if (slotKey === 'evening_rwanda') {
    return [
      'Rwanda Kigali Musanze Rubavu Huye Rusizi Nyagatare',
      'Rwanda news IGIHE Kigali Today RBA New Times',
    ];
  }
  return [
    'artificial intelligence OpenAI Google AI Anthropic news today',
    'technology Apple Microsoft Nvidia Meta software update',
  ];
}

function parseRssXmlItems(xml: string): Array<{ title: string; url: string; sourceName: string }> {
  if (!xml) return [];
  const decode = (s: string) =>
    s
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .trim();

  const matches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 12);
  const out: Array<{ title: string; url: string; sourceName: string }> = [];
  for (const m of matches) {
    const block = m[1];
    const title = decode(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '');
    const url = decode(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '');
    const sourceName = decode(block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || '');
    if (title && url) out.push({ title, url, sourceName });
  }
  return out;
}

async function generateBriefingDirectlyInApk(
  due: { slotId: string; kigaliDate: string; meta: DailyNewsSlotMeta; scheduledAtMs: number },
  apiKeys: string[],
  newsCustomInstructions: string
): Promise<DailyNewsBriefing | null> {
  if (apiKeys.length === 0) return null;
  const bridge = (window as any).KevinAgentBridge;
  const articles: Array<{ title: string; url: string; sourceName: string }> = [];
  const seenUrls = new Set<string>();

  if (bridge?.fetchWebNewsRss) {
    for (const q of buildApkSlotSearchQueries(due.meta.key)) {
      try {
        const xml = String(bridge.fetchWebNewsRss(q) || '');
        for (const item of parseRssXmlItems(xml)) {
          if (!seenUrls.has(item.url)) {
            seenUrls.add(item.url);
            articles.push(item);
          }
          if (articles.length >= 10) break;
        }
      } catch {}
      if (articles.length >= 10) break;
    }
  }

  const articlesBlock = articles.length > 0
    ? articles.map((a, i) => `${i + 1}. "${a.title}"${a.sourceName ? ` (${a.sourceName})` : ''} — ${a.url}`).join('\n')
    : '(Use verified live Google Search grounding for today’s breaking news only.)';

  const cleanCustom = (newsCustomInstructions || '').trim();
  const customNote = cleanCustom
    ? `\n\nUSER CUSTOM INSTRUCTION NEWS (PREFERENCES):\n${cleanCustom}\n- Prioritize requested topics ONLY when verified fresh articles exist; NEVER lie or invent facts, and NEVER say "Nta makuru mashya ahari" when verified articles exist.`
    : '';

  const clock = getKigaliClockInfo(new Date());
  const systemInstruction = `You are Izi AI, Rwanda's intelligent WhatsApp-style assistant created by Uwumukiza Kevin.
Write a scheduled daily news briefing in authentic, fluent Rwandan Kinyarwanda (${clock.displayDateRw} / ${due.kigaliDate}).
STRICT FRESHNESS & TRUTHFULNESS RULE:
- ONLY report genuinely fresh, real news from today / the last 12 to 18 hours. NEVER include old news.
- ZERO HALLUCINATION / NTUKABESHYE: Base every fact strictly on the verified articles or live Google Search results. Never invent facts, scores, or quotes.
- Format cleanly with 4 to 6 crisp bullet items (bold title + 1-2 short factual sentences) and friendly emojis.${customNote}`;

  const slotKey = due.meta.key;
  let userPrompt = '';
  if (slotKey === 'morning_tech') {
    userPrompt = `Tangira uti: "Mwaramutse neza! ☀️💻 Dore amakuru mashya y'ikoranabuhanga na AI yavugwaga muri iri joro ku isi:"\nTanga inkuru 4-6 z'ukuri z'ikoranabuhanga na AI.`;
  } else if (slotKey === 'noon_world') {
    userPrompt = `Tangira uti: "Mwiriwe neza! 🌍⚽ Dore amakuru mashya y'isi n'imikino (Sport) agezweho kuri uyu munsi saa sita:"\nHATARIMO ikoranabuhanga/AI; vuga imikino, ubukungu, politiki n'amakuru yo mu Rwanda, Afurika n'isi.`;
  } else if (slotKey === 'afternoon_sports_analysis') {
    userPrompt = `Tangira uti: "Mwiriwe neza! ⚽📊 Dore ubusesenguzi bwimbitse bw'amakipe n'imikino yo ku isi (by'umwihariko ku mugabane w'Uburayi) bwiriwe buvugwa uyu munsi:"\nTanga ubusesenguzi nyabwo bw'imikinire, ingamba z'abatoza n'isoko ry'abakinnyi cyane cyane i Burayi n'iyindi migabane.`;
  } else if (slotKey === 'evening_rwanda') {
    userPrompt = `Tangira uti: "Mwiriwe neza! 🇷🇼📰 Dore amakuru mashya yo mu Rwanda hose n'uko byiriwe byifashe hirya no hino mu duce tw'igihugu uyu munsi:"\nIbanze ku makuru mashya y'ukuri yiriwe avugwa mu Mujyi wa Kigali no mu ntara zose z'u Rwanda.`;
  } else {
    userPrompt = `Tangira uti: "Mwiriwe neza! 🌆🤖 Dore amakuru mashya y'ikoranabuhanga na AI yiriwe avugwa uyu munsi ku isi:"\nTanga inkuru 4-6 z'ukuri z'ibyiriwe bivugwa mu ikoranabuhanga na AI.`;
  }

  const effectivePrompt = `${userPrompt}\n\nAMAKURU MASHYA YABONETSE KURI INTERNET:\n${articlesBlock}`;
  const modelsToTry = ['gemini-3.5-flash-lite', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];
  const modes: Array<'search' | 'rss'> = articles.length < 3 ? ['search', 'rss'] : ['rss', 'search'];

  for (const mode of modes) {
    if (mode === 'rss' && articles.length === 0) continue;
    for (const model of modelsToTry) {
      for (const key of apiKeys) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 11000);
        try {
          const payload: Record<string, any> = {
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ role: 'user', parts: [{ text: effectivePrompt }] }],
          };
          if (mode === 'search') {
            payload.tools = [{ google_search: {} }];
          }
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: controller.signal,
            }
          );
          if (!res.ok) continue;
          const json = await res.json().catch(() => null);
          const candidate = json?.candidates?.[0];
          const text = (candidate?.content?.parts || [])
            .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
            .join('')
            .trim();
          if (!text || text.length < 40) continue;
          if (articles.length >= 3 && text.length < 520 && /nta makuru (mashya|yihariye|abonetse|ahari)/i.test(text)) {
            continue;
          }

          const sources: Array<{ title: string; url: string }> = [];
          const seenSrc = new Set<string>();
          for (const gc of candidate?.groundingMetadata?.groundingChunks || []) {
            const uri = gc?.web?.uri;
            const title = gc?.web?.title || uri;
            if (uri && !seenSrc.has(uri)) {
              seenSrc.add(uri);
              sources.push({ title, url: uri });
            }
          }
          for (const a of articles) {
            if (!seenSrc.has(a.url)) {
              seenSrc.add(a.url);
              sources.push({ title: a.sourceName ? `${a.sourceName}: ${a.title}` : a.title, url: a.url });
            }
          }
          if (mode === 'search' && sources.length === 0) continue;

          const cleanPreview = text
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/[*_`#>]/g, '')
            .replace(/\s+/g, ' ')
            .trim();

          return {
            slotId: due.slotId,
            kigaliDate: due.kigaliDate,
            slotKey: due.meta.key,
            scheduledLabel: due.meta.scheduledLabel,
            title: `${due.meta.emoji} ${due.meta.titleRw}`,
            preview: cleanPreview.length > 140 ? `${cleanPreview.slice(0, 137)}...` : cleanPreview,
            body: text,
            sources: sources.slice(0, 10),
            generatedAtMs: Date.now(),
            scheduledAtMs: due.scheduledAtMs,
            category:
              slotKey === 'noon_world'
                ? 'world_sports'
                : slotKey === 'afternoon_sports_analysis'
                  ? 'sports_analysis'
                  : slotKey === 'evening_rwanda'
                    ? 'rwanda_news'
                    : 'tech_ai',
          };
        } catch {
          // try next key/model
        } finally {
          clearTimeout(timer);
        }
      }
    }
  }
  return null;
}

export async function fetchAndDeliverDueNewsBriefings(
  onDeliverBriefing: (briefing: DailyNewsBriefing) => void
): Promise<number> {
  if (typeof window === 'undefined') return 0;
  if (isSyncing) return 0;
  const now = Date.now();
  if (now - lastSyncAt < 7000) return 0;

  isSyncing = true;
  lastSyncAt = now;
  let deliveredCount = 0;

  try {
    const deliveredIds = getDeliveredSlotIds();
    const endpoint = resolveApiEndpoint('/api/news-briefings/sync');
    const customApiKey = getUserCustomApiKey();
    const customApiKeys = getGeminiApiKeysArray();
    const newsCustomInstructions = getNewsCustomInstructions();
    const dueSlotsNow = getDueDailyNewsSlots().filter((d) => !deliveredIds.includes(d.slotId));

    let briefings: DailyNewsBriefing[] = [];
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 26000);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveredIds,
          customApiKey,
          customApiKeys,
          ...(newsCustomInstructions ? { newsCustomInstructions } : {}),
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (Array.isArray(data?.briefings)) {
          briefings = data.briefings;
        }
      }
    } catch {
      // Backend unreachable or timed out — fall through to direct APK generation if available
    }

    const deliveredFromBackend = new Set<string>();
    for (const b of briefings) {
      if (!b || !b.slotId || !b.body) continue;
      deliveredFromBackend.add(b.slotId);
      const currentDelivered = getDeliveredSlotIds();
      if (currentDelivered.includes(b.slotId)) continue;

      markSlotIdDelivered(b.slotId);
      onDeliverBriefing(b);
      triggerHeadsUpNewsNotification(b);
      deliveredCount++;
    }

    // Direct APK fallback if backend timed out, is outdated, or missed any due slot
    if (isCapacitorApkRuntime() && customApiKeys.length > 0 && dueSlotsNow.length > 0) {
      for (const due of dueSlotsNow) {
        if (deliveredFromBackend.has(due.slotId)) continue;
        if (getDeliveredSlotIds().includes(due.slotId)) continue;
        const directBriefing = await generateBriefingDirectlyInApk(due, customApiKeys, newsCustomInstructions);
        if (directBriefing && directBriefing.body) {
          markSlotIdDelivered(directBriefing.slotId);
          onDeliverBriefing(directBriefing);
          triggerHeadsUpNewsNotification(directBriefing);
          deliveredCount++;
        }
      }
    }
  } catch (err) {
    // If device is temporarily offline, this silently catches and will automatically
    // sync and deliver the moment the user turns on mobile bundle / internet!
  } finally {
    isSyncing = false;
  }

  return deliveredCount;
}

export const NATIVE_NEWS_EVENT = 'kevinNewsBriefingNativeReceived';

export function consumeNativePendingBriefings(
  onDeliverBriefing: (briefing: DailyNewsBriefing) => void
): number {
  if (typeof window === 'undefined') return 0;
  let count = 0;
  const deliveredInPass = new Set<string>();

  const deliverItem = (b: any) => {
    if (b && b.slotId && b.body && !deliveredInPass.has(b.slotId)) {
      deliveredInPass.add(b.slotId);
      markSlotIdDelivered(b.slotId);
      onDeliverBriefing(b);
      count++;
    }
  };

  try {
    const winQueue = (window as any).__kevinPendingNativeBriefings;
    if (Array.isArray(winQueue) && winQueue.length > 0) {
      (window as any).__kevinPendingNativeBriefings = [];
      for (const item of winQueue) {
        deliverItem(item);
      }
    }

    const bridge = (window as any).KevinAgentBridge;
    if (bridge?.consumePendingNewsBriefingsJson) {
      const raw = bridge.consumePendingNewsBriefingsJson();
      if (raw && raw !== '[]' && raw !== '{}') {
        const parsed = JSON.parse(raw);
        const list: DailyNewsBriefing[] = Array.isArray(parsed) ? parsed : [parsed];
        for (const b of list) {
          deliverItem(b);
        }
      }
    }
  } catch (err) {
    console.warn('[DailyNews] consumeNativePendingBriefings error:', err);
  }
  return count;
}

export function initDailyNewsDelivery(
  onDeliverBriefing: (briefing: DailyNewsBriefing) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  // Sync any slot IDs, API keys & Custom Instruction News to/from Android native prefs
  try {
    const bridge = (window as any).KevinAgentBridge;
    const keys = getGeminiApiKeysArray();
    if (keys.length > 0 && bridge?.setAgentApiKeys) {
      bridge.setAgentApiKeys(JSON.stringify(keys));
    }
    const localNewsInstr = getNewsCustomInstructions();
    if (localNewsInstr && bridge?.setNewsCustomInstructions) {
      bridge.setNewsCustomInstructions(localNewsInstr);
    }
    if (bridge?.getDeliveredNewsSlotIdsJson) {
      const nativeDeliveredRaw = bridge.getDeliveredNewsSlotIdsJson();
      const nativeDelivered: string[] = JSON.parse(nativeDeliveredRaw || '[]');
      for (const id of nativeDelivered) {
        if (id) markSlotIdDelivered(id);
      }
    }
  } catch {}

  // Check if any news briefings arrived while app was closed or outside
  consumeNativePendingBriefings(onDeliverBriefing);

  const executeSync = () => {
    consumeNativePendingBriefings(onDeliverBriefing);
    void fetchAndDeliverDueNewsBriefings(onDeliverBriefing);
  };

  // Immediate check on boot
  const initialTimer = setTimeout(executeSync, 1200);

  // When native Android service dispatches a briefing
  const onNativeNews = (e: Event) => {
    try {
      const detail = (e as CustomEvent<DailyNewsBriefing | DailyNewsBriefing[]>).detail;
      if (!detail) return;
      const list = Array.isArray(detail) ? detail : [detail];
      let deliveredAny = false;
      for (const b of list) {
        if (b && b.slotId && b.body) {
          markSlotIdDelivered(b.slotId);
          onDeliverBriefing(b);
          deliveredAny = true;
        }
      }
      if (deliveredAny) {
        (window as any).__kevinPendingNativeBriefings = [];
        try {
          (window as any).KevinAgentBridge?.consumePendingNewsBriefingsJson?.();
        } catch {}
      }
    } catch {}
  };
  window.addEventListener(NATIVE_NEWS_EVENT, onNativeNews);

  // When internet comes back / user turns on bundle
  const onOnline = () => {
    console.log('[DailyNews] Internet connection restored — syncing scheduled news...');
    setTimeout(executeSync, 800);
  };
  window.addEventListener('online', onOnline);

  // When tab/app becomes visible
  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      executeSync();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onVisibility);

  // Periodic heartbeat every 25 seconds
  const interval = setInterval(executeSync, 25000);

  return () => {
    clearTimeout(initialTimer);
    clearInterval(interval);
    window.removeEventListener(NATIVE_NEWS_EVENT, onNativeNews);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', onVisibility);
  };
}
