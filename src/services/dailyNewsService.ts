import {
  DailyNewsBriefing,
  DailyNewsSlotKey,
  getDueDailyNewsSlots,
  getKigaliClockInfo,
} from './dailyNewsConfig';
import {
  getGeminiApiKeysArray,
  getUserCustomApiKey,
  playWhatsAppSound,
  resolveApiEndpoint,
} from './geminiService';

export const DELIVERED_NEWS_SLOTS_KEY = 'kevin_ai_delivered_news_slots_v1';
export const NEWS_PENDING_TOAST_EVENT = 'kevinNewsBriefingReceived';

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
  } catch {}
}

export function triggerHeadsUpNewsNotification(briefing: DailyNewsBriefing): void {
  if (typeof window === 'undefined') return;

  // 1. Play WhatsApp receive sound
  try {
    playWhatsAppSound('receive');
  } catch {}

  // 2. Android native heads-up pop-up notification at the top of the screen
  try {
    const bridge = (window as any).KevinAgentBridge;
    if (bridge?.showNewsNotification) {
      bridge.showNewsNotification(briefing.title, briefing.preview, briefing.slotId);
    }
  } catch (err) {
    console.warn('[DailyNews] Native notification error:', err);
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 16000);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deliveredIds,
        customApiKey,
        customApiKeys,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      return 0;
    }

    const data = await res.json().catch(() => null);
    const briefings: DailyNewsBriefing[] = Array.isArray(data?.briefings) ? data.briefings : [];

    for (const b of briefings) {
      if (!b || !b.slotId || !b.body) continue;
      const currentDelivered = getDeliveredSlotIds();
      if (currentDelivered.includes(b.slotId)) continue;

      markSlotIdDelivered(b.slotId);
      onDeliverBriefing(b);
      triggerHeadsUpNewsNotification(b);
      deliveredCount++;
    }
  } catch (err) {
    // If device is temporarily offline, this silently catches and will automatically
    // sync and deliver the moment the user turns on mobile bundle / internet!
  } finally {
    isSyncing = false;
  }

  return deliveredCount;
}

export function initDailyNewsDelivery(
  onDeliverBriefing: (briefing: DailyNewsBriefing) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const executeSync = () => {
    void fetchAndDeliverDueNewsBriefings(onDeliverBriefing);
  };

  // Immediate check on boot
  const initialTimer = setTimeout(executeSync, 1200);

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

  // Periodic heartbeat every 25 seconds
  const interval = setInterval(executeSync, 25000);

  return () => {
    clearTimeout(initialTimer);
    clearInterval(interval);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
