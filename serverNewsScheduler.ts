import fs from 'fs';
import os from 'os';
import path from 'path';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  buildNewsSlotId,
  computeKigaliSlotEpochMs,
  DAILY_NEWS_SLOTS,
  DailyNewsBriefing,
  DailyNewsSlotKey,
  getDueDailyNewsSlots,
  getKigaliClockInfo,
} from './src/services/dailyNewsConfig';

interface RssArticleItem {
  title: string;
  url: string;
  pubDate: string;
  pubMs: number;
  sourceName: string;
}

const CACHE_FILE_PATH = path.join(os.tmpdir(), 'kevin-ai-daily-news-cache-v1.json');
const briefingCache = new Map<string, DailyNewsBriefing>();
const inFlightGenerations = new Map<string, Promise<DailyNewsBriefing | null>>();
const usedMorningUrlsByDate = new Map<string, Set<string>>();
let cacheLoaded = false;

function decodeXmlEntities(text: string): string {
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

function loadCacheFromDisk() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    if (!fs.existsSync(CACHE_FILE_PATH)) return;
    const raw = fs.readFileSync(CACHE_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
      for (const item of parsed) {
        if (item && typeof item.slotId === 'string' && typeof item.body === 'string' && (item.generatedAtMs || 0) >= cutoff) {
          briefingCache.set(item.slotId, item as DailyNewsBriefing);
          if (item.slotKey === 'morning_tech' && Array.isArray(item.sources)) {
            usedMorningUrlsByDate.set(
              item.kigaliDate,
              new Set(item.sources.map((s: any) => String(s?.url || '')).filter(Boolean))
            );
          }
        }
      }
    }
  } catch (err) {
    console.warn('[NewsScheduler] Unable to load disk cache:', err);
  }
}

function saveCacheToDisk() {
  try {
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    const items = Array.from(briefingCache.values()).filter((it) => it.generatedAtMs >= cutoff);
    briefingCache.clear();
    for (const it of items) {
      briefingCache.set(it.slotId, it);
    }
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(items), 'utf8');
  } catch (err) {
    console.warn('[NewsScheduler] Unable to save disk cache:', err);
  }
}

function isTechOrAiArticle(title: string): boolean {
  return /\b(ai|artificial intelligence|openai|chatgpt|gpt-\d|gpt\s*\d|anthropic|claude|gemini|deepmind|llm|machine learning|nvidia|semiconductor|chipmaker|tsmc|apple|iphone|ios|android|google|microsoft|meta|tesla|cybersecurity|ransomware|hacker|software|startup|silicon valley|robotics|robot|quantum|tech|gadget|smartphone|vr|ar)\b/i.test(title);
}

async function fetchRssUrl(rssUrl: string, timeoutMs = 4500): Promise<RssArticleItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(rssUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
    });
    if (!response.ok) return [];
    const xml = await response.text();
    const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 16);
    const out: RssArticleItem[] = [];
    for (const match of itemMatches) {
      const block = match[1];
      const rawTitle = block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
      const rawLink = block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '';
      const rawDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '';
      const rawSource = block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || '';
      const sourceUrl = block.match(/<source[^>]*url="([^"]+)"/)?.[1] || '';

      const title = decodeXmlEntities(rawTitle);
      const url = decodeXmlEntities(rawLink) || decodeXmlEntities(sourceUrl);
      const pubDate = decodeXmlEntities(rawDate);
      const sourceName = decodeXmlEntities(rawSource);
      const parsedMs = pubDate ? Date.parse(pubDate) : Date.now();
      const pubMs = Number.isFinite(parsedMs) ? parsedMs : Date.now();

      if (title && url) {
        out.push({ title, url, pubDate, pubMs, sourceName });
      }
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFreshRssForSlot(slotKey: DailyNewsSlotKey, kigaliDate: string): Promise<RssArticleItem[]> {
  const nowMs = Date.now();
  const maxAgeHours = slotKey === 'evening_tech' ? 14 : 18;
  const minPubMs = nowMs - maxAgeHours * 3600 * 1000;

  const feedUrls =
    slotKey === 'afternoon_sports_analysis'
      ? [
          // In-depth European & World Football Club Analysis, tactics & transfers
          'https://news.google.com/rss/search?q=(%22tactical+analysis%22+OR+%22football+analysis%22+OR+%22match+preview%22+OR+%22Premier+League%22+OR+%22Champions+League%22+OR+%22Real+Madrid%22+OR+%22Barcelona%22+OR+%22Arsenal%22+OR+%22Manchester+City%22+OR+%22Liverpool%22+OR+%22Bayern+Munich%22)+when:1d&hl=en&gl=US&ceid=US:en',
          'https://news.google.com/rss/search?q=(football+tactics+OR+club+analysis+OR+manager+analysis+OR+squad+depth+OR+transfer+analysis)+when:1d&hl=en&gl=GB&ceid=GB:en',
          'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp1ZEdvU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en',
        ]
      : slotKey === 'noon_world'
      ? [
          // World general news + Sports + Rwanda/Africa breaking news (1d recency filter)
          'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en',
          'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp1ZEdvU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en',
          'https://news.google.com/rss/search?q=(Rwanda+OR+Africa+OR+world+breaking+news+OR+football+OR+Champions+League+OR+Premier+League)+when:1d&hl=en&gl=RW&ceid=RW:en',
        ]
      : [
          // Technology & AI global breaking news (overnight or today)
          'https://news.google.com/rss/search?q=(%22artificial+intelligence%22+OR+OpenAI+OR+Google+AI+OR+Anthropic+OR+new+AI+model+OR+AI+release)+when:1d&hl=en&gl=US&ceid=US:en',
          'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en',
          'https://news.google.com/rss/search?q=(technology+news+OR+software+update+OR+cybersecurity+OR+Apple+OR+Microsoft+OR+Nvidia+OR+Meta)+when:1d&hl=en&gl=US&ceid=US:en',
        ];

  const fetchedArrays = await Promise.all(feedUrls.map((u) => fetchRssUrl(u)));
  const merged = fetchedArrays.flat();
  const seenKeys = new Set<string>();
  const morningUsed = slotKey === 'evening_tech' ? (usedMorningUrlsByDate.get(kigaliDate) || new Set<string>()) : new Set<string>();

  const fresh: RssArticleItem[] = [];
  for (const item of merged) {
    if (item.pubMs < minPubMs) continue;
    if ((slotKey === 'noon_world' || slotKey === 'afternoon_sports_analysis') && isTechOrAiArticle(item.title)) continue;
    if (slotKey === 'evening_tech' && morningUsed.has(item.url)) continue;

    const normTitle = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 48);
    if (!normTitle || seenKeys.has(normTitle) || seenKeys.has(item.url)) continue;
    seenKeys.add(normTitle);
    seenKeys.add(item.url);
    fresh.push(item);
  }

  fresh.sort((a, b) => b.pubMs - a.pubMs);
  return fresh.slice(0, 10);
}

function buildBriefingPreview(text: string): string {
  const clean = text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > 140 ? `${clean.slice(0, 137)}...` : clean;
}

function buildNewsGenerationPrompt(
  slotKey: DailyNewsSlotKey,
  kigaliDate: string,
  displayDateRw: string,
  rssItems: RssArticleItem[]
): { systemInstruction: string; userPrompt: string } {
  const nowKigaliTime = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Africa/Kigali',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const articlesBlock = rssItems.length > 0
    ? rssItems
        .map((it, idx) => {
          const kigaliPub = new Date(it.pubMs).toLocaleString('en-GB', {
            timeZone: 'Africa/Kigali',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          });
          return `${idx + 1}. "${it.title}"${it.sourceName ? ` (${it.sourceName})` : ''} [Published Kigali: ${kigaliPub}] — ${it.url}`;
        })
        .join('\n')
    : '(No pre-fetched RSS rows; rely strictly on verified Google Search results from the last 14 hours only.)';

  const systemInstruction = `You are Kevin AI, Rwanda's intelligent WhatsApp-style assistant created by Uwumukiza Kevin.
You are sending a scheduled daily news WhatsApp briefing in authentic, natural, grammatically fluent Rwandan Kinyarwanda (Ikinyarwanda cy'umwimerere).
STRICT FRESHNESS RULE:
- Current Rwanda time is ${displayDateRw} (${kigaliDate}) at ${nowKigaliTime} (Africa/Kigali).
- ONLY report genuinely BREAKING / FRESH news from the last 12 to 16 hours. NEVER include old news from days, weeks, or years ago.
- Base every fact ONLY on the verified live articles / Google Search grounding results provided. Never invent news or scores.
- Format like a clean, scannable WhatsApp briefing with 4 to 6 crisp bullet items (bold headline + 1-2 short clear sentences explaining what happened), friendly emojis, and warm Rwandan tone.`;

  if (slotKey === 'morning_tech') {
    return {
      systemInstruction,
      userPrompt: `Tegura ubutumwa bwa mugitondo saa kumi n'ebyiri (06:00 AM Rwanda) bw'amakuru mashya y'IKORANABUHANGA n'UBWENGE BUKORANO (AI) yavugwaga muri iri joro ku isi yose.
Ibyo ubandikaho:
- Tangira uti: "Mwaramutse neza! ☀️💻 Dore amakuru mashya y'ikoranabuhanga na AI yavugwaga muri iri joro ku isi:"
- Garagaza gusa ibintu bishya byasohotse cyangwa byavugwaga muri iri joro: AI nshya zasohotse, ibishya byongewe muri AI zisanzwe (ChatGPT, Gemini, Claude, n'izindi), porogaramu nshya, ibikoresho by'ikoranabuhanga, cyangwa umutekano w'ikoranabuhanga.
- NTUSHIRMO amakuru ashaje cyangwa ay'iminsi yashize.
- Soza ubaza mu Kinyarwanda niba hari inkuru bifuza ko ubasobanurira birambuye.

AMAKURU MASHYA YABONETSE KURI INTERNET:
${articlesBlock}`,
    };
  }

  if (slotKey === 'noon_world') {
    return {
      systemInstruction,
      userPrompt: `Tegura ubutumwa bwa saa sita z'amanywa (12:00 PM Rwanda) bw'amakuru ASANZWE mashya ku isi hose, mu Rwanda/Afurika, n'ay'IMIKINO (Sport).
ITEGEKO RIKOMEYE:
- HATARIMO IKORANABUHANGA NA BUSA (NO technology news, NO AI news, NO apps/phones/software/cyber news).
- Tangira uti: "Mwiriwe neza! 🌍⚽ Dore amakuru mashya y'isi n'imikino (Sport) agezweho kuri uyu munsi saa sita:"
- Vuga amakuru y'imikino (football, shampiyona, imikino y'uyu munsi/ijoro ryashize), ubukungu, politiki cyangwa amakuru akomeye yo mu Rwanda, Afurika n'ahandi ku isi.
- NTUSHIRMO amakuru ashaje.
- Soza ubaza niba hari inkuru bifuza gusobanuza byimbitse.

AMAKURU MASHYA YABONETSE KURI INTERNET:
${articlesBlock}`,
    };
  }

  if (slotKey === 'afternoon_sports_analysis') {
    return {
      systemInstruction,
      userPrompt: `Tegura ubutumwa bwa saa cyenda z'amanywa (15:00 / 3:00 PM Rwanda) bw'UBUSESENGUZI NYABWO BW'AMAKIPE N'IMIKINO YO KU ISI (Sports & Football Tactical Analysis).
ITEGEKO RIKOMEYE RY'UBUSESENGUZI NYABWO:
- Iki ntabwo ari amakuru asanzwe gusa y'amanota cyangwa ibitego—ahubwo ni UBUSESENGUZI BUHAMYE ("Ubusesenguzi nyabwo bw'amakipe n'abatoza").
- Ibanze cyane ku makipe yo ku mugabane w'Uburayi (Premier League mu Bwongereza, UEFA Champions League, La Liga muri Esipanye, Serie A mu Butaliyani, Bundesliga mu Budage, amakipe nka Real Madrid, Barcelona, Arsenal, Manchester City, Liverpool, Chelsea, Bayern Munich, PSG, n'ayandi), ariko uvanzemo n'ubusesenguzi bucye ku yandi makipe akomeye yo ku yindi migabane (Afurika nka CAF Champions League, Amerika y'Epfo, cyangwa Saudi Pro League) mu buryo buringaniye.
- Tanga ubusesenguzi bw'ukuri ku byiriwe bivugwa uyu munsi mbere ya saa cyenda:
  * Imyiteguro n'ingamba z'abatoza n'amakipe (tactical breakdown, formations, ibisubizo bya tekiniki mu kibuga).
  * Ubusesenguzi ku mikinire n'ubushobozi bw'abakinnyi, n'imvune z'ingenzi zizahindura imikinire y'ikipe.
  * Ubusesenguzi ku isoko ry'abakinnyi (transfers, amasezerano, cyangwa gahunda zo kubaka ikipe).
  * Uko amakipe ahagaze n'ubusesenguzi ku mikino ikomeye yegereje.
- Tangira uti: "Mwiriwe neza! ⚽📊 Dore ubusesenguzi bwimbitse bw'amakipe n'imikino yo ku isi (by'umwihariko ku mugabane w'Uburayi) bwiriwe buvugwa uyu munsi:"
- NTUSHIRMO amakuru ashaje cyangwa iby'ikoranabuhanga/AI.
- Soza ubaza ikipe bifuza ko ubasobanurira cyangwa ubakorera ubusesenguzi bwayo bwihariye.

UBUSESENGUZI BUKOMEYE BWAVUZWE KURI INTERNET UYU MUNSI:
${articlesBlock}`,
    };
  }

  return {
    systemInstruction,
    userPrompt: `Tegura ubutumwa bwa nimugoroba saa kumi n'ebyiri (18:00 / 6:00 PM Rwanda) bw'amakuru mashya y'IBYIRIWE BIVUGWA MU IKORANABUHANGA n'UBWENGE BUKORANO (AI) uyu munsi ku isi yose.
Ibyo ubandikaho:
- Tangira uti: "Mwiriwe neza! 🌆🤖 Dore amakuru mashya y'ikoranabuhanga na AI yiriwe avugwa uyu munsi ku isi:"
- Garagaza gusa ibiriwe bivugwa uyu munsi mu ikoranabuhanga na AI (ibishya byasohotse uyu munsi muri AI, amavugurura mashya, ibyabereye mu bigo bikomeye by'ikoranabuhanga, n'ibindi bishya).
- NTUSHIRMO amakuru ashaje cyangwa ay'iminsi yashize.
- Soza ubaza mu Kinyarwanda niba hari icyo bifuza ko ubasobanurira kurushaho.

AMAKURU MASHYA YABONETSE KURI INTERNET:
${articlesBlock}`,
  };
}

export async function generateOrGetBriefingForSlot(
  slotKey: DailyNewsSlotKey,
  kigaliDate: string,
  apiKeys: string[],
  forceGenerate = false
): Promise<DailyNewsBriefing | null> {
  loadCacheFromDisk();
  const slotId = buildNewsSlotId(kigaliDate, slotKey);
  const existing = briefingCache.get(slotId);
  if (existing && !forceGenerate) {
    return existing;
  }

  const pending = inFlightGenerations.get(slotId);
  if (pending) {
    return pending;
  }

  const slotMeta = DAILY_NEWS_SLOTS.find((s) => s.key === slotKey)!;
  const scheduledAtMs = computeKigaliSlotEpochMs(kigaliDate, slotMeta.hourKigali, slotMeta.minuteKigali);
  const [yr, mo, dy] = kigaliDate.split('-');
  const displayDateRw = `${dy}/${mo}/${yr}`;

  const task = (async (): Promise<DailyNewsBriefing | null> => {
    const rssItems = await fetchFreshRssForSlot(slotKey, kigaliDate);
    if (apiKeys.length === 0) {
      return null;
    }

    const { systemInstruction, userPrompt } = buildNewsGenerationPrompt(
      slotKey,
      kigaliDate,
      displayDateRw,
      rssItems
    );

    const rssSources = rssItems.map((it) => ({
      title: it.sourceName ? `${it.sourceName}: ${it.title}` : it.title,
      url: it.url,
    }));

    const modelsToTry = ['gemini-3.5-flash-lite', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];
    const useSearchFirst = rssItems.length < 3;
    const modes: Array<'search' | 'rss'> = useSearchFirst ? ['search', 'rss'] : ['rss', 'search'];

    for (const mode of modes) {
      if (mode === 'rss' && rssItems.length === 0) continue;
      for (const model of modelsToTry) {
        for (const key of apiKeys) {
          try {
            const ai = new GoogleGenAI({
              apiKey: key,
              httpOptions: {
                apiVersion: 'v1beta',
                headers: { 'User-Agent': 'aistudio-build' },
              },
            });
            const genPromise = ai.models.generateContent({
              model,
              contents: userPrompt,
              config: {
                systemInstruction,
                ...(mode === 'search' ? { tools: [{ googleSearch: {} }] } : {}),
                ...(model === 'gemini-4-hydrogen'
                  ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                  : model.startsWith('gemini-2.5-')
                    ? { thinkingConfig: { thinkingBudget: 0 } }
                    : {}),
              },
            });
            genPromise.catch(() => {});

            const res = await Promise.race([
              genPromise,
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error('News generation timeout')), 12000)),
            ]);

            const text = (res.text || '').trim();
            if (!text || text.length < 40) continue;

            const collectedSources: Array<{ title: string; url: string }> = [];
            const seenUrls = new Set<string>();
            const gChunks = (res as any).candidates?.[0]?.groundingMetadata?.groundingChunks || [];
            for (const gc of gChunks) {
              const uri = gc?.web?.uri;
              const title = gc?.web?.title || uri;
              if (uri && !seenUrls.has(uri)) {
                seenUrls.add(uri);
                collectedSources.push({ title, url: uri });
              }
            }
            for (const rs of rssSources) {
              if (rs.url && !seenUrls.has(rs.url)) {
                seenUrls.add(rs.url);
                collectedSources.push(rs);
              }
            }
            if (mode === 'search' && collectedSources.length === 0) {
              continue;
            }

            if (slotKey === 'morning_tech') {
              usedMorningUrlsByDate.set(
                kigaliDate,
                new Set(collectedSources.map((s) => s.url).filter(Boolean))
              );
            }

            const briefing: DailyNewsBriefing = {
              slotId,
              kigaliDate,
              slotKey,
              scheduledLabel: slotMeta.scheduledLabel,
              title: `${slotMeta.emoji} ${slotMeta.titleRw}`,
              preview: buildBriefingPreview(text),
              body: text,
              sources: collectedSources.slice(0, 10),
              generatedAtMs: Date.now(),
              scheduledAtMs,
              category: slotKey === 'noon_world' ? 'world_sports' : slotKey === 'afternoon_sports_analysis' ? 'sports_analysis' : 'tech_ai',
            };
            briefingCache.set(slotId, briefing);
            saveCacheToDisk();
            console.log(`[NewsScheduler] Generated fresh briefing for ${slotId} (${collectedSources.length} sources)`);
            return briefing;
          } catch (err) {
            console.warn(`[NewsScheduler] ${slotId} (${model}, ${mode}) attempt failed:`, err instanceof Error ? err.message : String(err));
          }
        }
      }
    }

    return null;
  })();

  inFlightGenerations.set(slotId, task);
  try {
    return await task;
  } finally {
    inFlightGenerations.delete(slotId);
  }
}

export async function syncDueNewsBriefings(params: {
  deliveredIds?: string[];
  customApiKeys?: string | string[];
  getServerApiKeys: (customKeys?: string | string[]) => string[];
}): Promise<{
  serverTimeMs: number;
  kigaliDate: string;
  briefings: DailyNewsBriefing[];
}> {
  loadCacheFromDisk();
  const now = new Date();
  const clock = getKigaliClockInfo(now);
  const dueSlots = getDueDailyNewsSlots(now);
  const deliveredSet = new Set(Array.isArray(params.deliveredIds) ? params.deliveredIds : []);
  const apiKeys = params.getServerApiKeys(params.customApiKeys);

  const briefings: DailyNewsBriefing[] = [];
  for (const due of dueSlots) {
    if (deliveredSet.has(due.slotId)) continue;
    const item = await generateOrGetBriefingForSlot(due.meta.key, due.kigaliDate, apiKeys, false);
    if (item) {
      briefings.push(item);
    }
  }

  return {
    serverTimeMs: Date.now(),
    kigaliDate: clock.kigaliDate,
    briefings,
  };
}

let schedulerInterval: NodeJS.Timeout | null = null;

export function startDailyNewsScheduler(getServerApiKeys: () => string[]): void {
  loadCacheFromDisk();
  if (schedulerInterval) return;

  const tick = async () => {
    try {
      const apiKeys = getServerApiKeys();
      if (apiKeys.length === 0) return;
      const dueSlots = getDueDailyNewsSlots(new Date());
      for (const due of dueSlots) {
        if (!briefingCache.has(due.slotId)) {
          await generateOrGetBriefingForSlot(due.meta.key, due.kigaliDate, apiKeys, false);
        }
      }
    } catch (err) {
      console.warn('[NewsScheduler] Tick error:', err);
    }
  };

  setTimeout(() => {
    void tick();
  }, 4000);
  schedulerInterval = setInterval(() => {
    void tick();
  }, 30_000);
}
