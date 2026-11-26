import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
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
  fromCustomQuery?: boolean;
}

type CachedDailyNewsBriefing = DailyNewsBriefing & {
  customSig?: string;
};

const CACHE_FILE_PATH = path.join(os.tmpdir(), 'kevin-ai-daily-news-cache-v1.json');
const briefingCache = new Map<string, CachedDailyNewsBriefing>();
const inFlightGenerations = new Map<string, Promise<DailyNewsBriefing | null>>();
const usedMorningUrlsByDate = new Map<string, Set<string>>();
let cacheLoaded = false;

function normalizeNewsCustomInstructions(raw?: string): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 1200);
}

function getNewsCustomSignature(cleanCustom: string): string {
  if (!cleanCustom) return 'default';
  return crypto.createHash('sha256').update(`v3:${cleanCustom}`).digest('hex').slice(0, 12);
}

function makeBriefingCacheKey(slotId: string, customSig: string): string {
  return customSig === 'default' ? slotId : `${slotId}__${customSig}`;
}

function isSportsHeadline(title: string): boolean {
  return /\b(nba|nfl|mlb|nhl|ncaa|ivy\s*league|uefa|fifa|premier league|champions league|la liga|bundesliga|serie a|football|soccer|basketball|baseball|tennis|golf|cricket|rugby|boxing|ufc|f1|formula 1|playoffs|quarterback|touchdown|goalkeeper|striker|coach|transfer)\b/i.test(title);
}

function buildCustomNewsRssUrl(cleanCustom: string): string | null {
  if (!cleanCustom) return null;
  const kinyarwandaTopicMap: Record<string, string> = {
    ikoranabuhanga: 'technology',
    telefone: 'smartphone',
    telefoni: 'smartphone',
    amaterefoni: 'smartphone',
    mudasobwa: 'computer',
    imikino: 'sports',
    siporo: 'sports',
    umupira: 'football',
    amaguru: 'football',
    ubukungu: 'economy',
    ubuzima: 'health',
    politiki: 'politics',
    ubwenge: 'AI',
    ubukorano: 'AI',
    imodoka: 'automotive',
    ingufu: 'energy',
    amashanyarazi: 'energy',
    ubucuruzi: 'business',
    amafaranga: 'finance',
  };

  const stopWords = new Set([
    'amakuru', 'jya', 'wibanda', 'wibande', 'wibanza', 'cyane', 'kuri', 'ku', 'mu', 'muri', 'na', 'no', 'n',
    'nshaka', 'ndifuza', 'shaka', 'ko', 'uzajya', 'ajya', 'zajya', 'izajya', 'umpa', 'mpere', 'unyohereze',
    'nyohereza', 'ohereza', 'gusa', 'kandi', 'ariko', 'cyangwa', 'yerekeye', 'yerekeyeho', 'bijyanye', 'birebana',
    'ibyerekeye', 'byerekeye', 'byiriwe', 'byavugwaga', 'yiriwe', 'yavugwaga', 'avugwa', 'bivugwa', 'zasohotse',
    'yasohotse', 'basohoye', 'asohoka', 'mashya', 'masha', 'amashya', 'agezweho', 'bigezweho', 'neza', 'uko',
    'wandika', 'wandike', 'incamake', 'muzi', 'kwisi', 'isi', 'yose', 'y', 'ya', 'wa', 'ba', 'za', 'rya', 'bya',
    'nk', 'nka', 'ayo', 'aya', 'ibyo', 'ibi', 'ibishya', 'ibintu', 'mbwira', 'umbwire', 'ushyire', 'uburyo',
    'ubwoko', 'nkuko', 'kubona', 'kumenya', 'ziza', 'yiza', 'meza', 'byose', 'hose', 'kose', 'hano', 'noneho',
    'ubu', 'ejo', 'ijoro', 'munsi', 'umunsi', 'amanywa', 'mugitondo', 'nimugoroba', 'isaha', 'amasaha', 'ryari',
    'igihe', 'buri', 'byinshi', 'imibare', 'amanota', 'yihariye', 'cyari', 'yari', 'ari', 'aba', 'iyo', 'aho',
    'news', 'focus', 'about', 'only', 'please', 'write', 'send', 'always', 'give', 'tell', 'want', 'prefer',
    'update', 'updates', 'latest', 'fresh', 'today', 'report', 'briefing', 'summary', 'format', 'topic', 'topics',
    'bullet', 'points', 'short', 'detailed', 'style', 'tone', 'more', 'most', 'very', 'just', 'with', 'related',
    'from', 'into', 'that', 'this', 'the', 'and', 'for', 'you', 'your', 'are', 'have', 'will', 'new', 'using',
  ]);

  const rawTokens = cleanCustom
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);

  const uniqueTokens: string[] = [];
  const seen = new Set<string>();
  for (const rawTok of rawTokens) {
    const low = rawTok.toLowerCase();
    if (stopWords.has(low)) continue;
    const mapped = kinyarwandaTopicMap[low] || rawTok;
    if (mapped.length < 2) continue;
    // Skip unknown non-ASCII/long Kinyarwanda words that weren't in the topic map to avoid random fuzzy matches
    const isMappedTopic = Boolean(kinyarwandaTopicMap[low]);
    const isShortAcronym = /^(ai|uk|us|eu|ev|5g|f1)$/i.test(mapped);
    if (!isMappedTopic && !isShortAcronym && mapped.length < 3) continue;
    if (!isMappedTopic && /^(kug|kub|kumen|kwib|guha|gush|bya|iby|muri|uko|iyo)/.test(low)) continue;

    const dedupKey = mapped.toLowerCase();
    if (!seen.has(dedupKey)) {
      seen.add(dedupKey);
      uniqueTokens.push(mapped);
    }
    if (uniqueTokens.length >= 6) break;
  }
  if (uniqueTokens.length === 0) return null;
  const query = `(${uniqueTokens.map((t) => encodeURIComponent(t)).join('+OR+')})+when:1d`;
  return `https://news.google.com/rss/search?q=${query}&hl=en&gl=US&ceid=US:en`;
}

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
          const cachedItem = item as CachedDailyNewsBriefing;
          const cacheKey = makeBriefingCacheKey(cachedItem.slotId, cachedItem.customSig || 'default');
          briefingCache.set(cacheKey, cachedItem);
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
      const cacheKey = makeBriefingCacheKey(it.slotId, it.customSig || 'default');
      briefingCache.set(cacheKey, it);
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

async function fetchFreshRssForSlot(
  slotKey: DailyNewsSlotKey,
  kigaliDate: string,
  cleanCustomNews = ''
): Promise<RssArticleItem[]> {
  const nowMs = Date.now();
  const maxAgeHours = slotKey === 'evening_tech' ? 14 : 18;
  const minPubMs = nowMs - maxAgeHours * 3600 * 1000;

  const baseFeedUrls =
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
      : slotKey === 'evening_rwanda'
      ? [
          // Rwanda regional & national news across Kigali & all provinces (today)
          'https://news.google.com/rss/search?q=(Rwanda+OR+Kigali+OR+Musanze+OR+Rubavu+OR+Huye+OR+Rusizi+OR+Nyagatare+OR+Muhanga+OR+Rwamagana+OR+Karongi)+when:1d&hl=en&gl=RW&ceid=RW:en',
          'https://news.google.com/rss/search?q=(Rwanda+news+OR+IGIHE+OR+%22Kigali+Today%22+OR+RBA+OR+%22New+Times+Rwanda%22+OR+Umuseke)+when:1d&hl=en&gl=RW&ceid=RW:en',
          'https://news.google.com/rss/search?q=(Rwanda+OR+%22Northern+Province%22+OR+%22Southern+Province%22+OR+%22Eastern+Province%22+OR+%22Western+Province%22+OR+Amajyaruguru+OR+Amajyepfo+OR+Iburasirazuba+OR+Iburengerazuba)+when:1d&hl=en&gl=RW&ceid=RW:en',
        ]
      : [
          // Technology & AI global breaking news (overnight or today)
          'https://news.google.com/rss/search?q=(%22artificial+intelligence%22+OR+OpenAI+OR+Google+AI+OR+Anthropic+OR+new+AI+model+OR+AI+release)+when:1d&hl=en&gl=US&ceid=US:en',
          'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en',
          'https://news.google.com/rss/search?q=(technology+news+OR+software+update+OR+cybersecurity+OR+Apple+OR+Microsoft+OR+Nvidia+OR+Meta)+when:1d&hl=en&gl=US&ceid=US:en',
        ];

  const customFeedUrl = buildCustomNewsRssUrl(cleanCustomNews);
  const customPromise = customFeedUrl
    ? fetchRssUrl(customFeedUrl).then((items) =>
        items.map((it) => ({ ...it, fromCustomQuery: true }))
      )
    : Promise.resolve([] as RssArticleItem[]);

  const [customItems, ...baseArrays] = await Promise.all([
    customPromise,
    ...baseFeedUrls.map((u) => fetchRssUrl(u)),
  ]);

  const baseRaw = baseArrays.flat();
  const seenKeys = new Set<string>();
  const morningUsed = slotKey === 'evening_tech' ? (usedMorningUrlsByDate.get(kigaliDate) || new Set<string>()) : new Set<string>();
  const customAsksSports = Boolean(
    cleanCustomNews && /\b(sport|sports|siporo|imikino|football|soccer|umupira|arsenal|chelsea|liverpool|barcelona|madrid|bayern|psg|nba|mlb|nfl|uefa|premier|champions)\b/i.test(cleanCustomNews)
  );
  const isTechSlot = slotKey === 'morning_tech' || slotKey === 'evening_tech';

  const filterList = (list: RssArticleItem[], isCustom: boolean): RssArticleItem[] => {
    const kept: RssArticleItem[] = [];
    for (const item of list) {
      if (item.pubMs < minPubMs) continue;
      if (!isCustom && (slotKey === 'noon_world' || slotKey === 'afternoon_sports_analysis') && isTechOrAiArticle(item.title)) continue;
      if (isCustom && isTechSlot && !customAsksSports && isSportsHeadline(item.title) && !isTechOrAiArticle(item.title)) continue;
      if (slotKey === 'evening_tech' && morningUsed.has(item.url)) continue;

      const normTitle = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 48);
      if (!normTitle || seenKeys.has(normTitle) || seenKeys.has(item.url)) continue;
      seenKeys.add(normTitle);
      seenKeys.add(item.url);
      kept.push(item);
    }
    kept.sort((a, b) => b.pubMs - a.pubMs);
    return kept;
  };

  const keptCustom = filterList(customItems, true).slice(0, 4);
  const keptBase = filterList(baseRaw, false).slice(0, 12 - keptCustom.length);
  return [...keptCustom, ...keptBase].slice(0, 12);
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
  rssItems: RssArticleItem[],
  cleanCustomNews = ''
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

  const customInstructionsBlock = cleanCustomNews
    ? `\n\nUSER'S CUSTOM INSTRUCTION NEWS (PREFERENCES):
"""
${cleanCustomNews}
"""
- Prioritize topics, companies, teams, or formatting/tone requested above ONLY when verified fresh articles about them actually exist in the sources below or live search results.
- STRICT TRUTHFULNESS: NEVER lie, fabricate, exaggerate, or force-fit a story to satisfy a custom preference. Only state facts explicitly confirmed in the verified sources.
- CRITICAL: NEVER output a message saying "Nta makuru mashya ahari / yihariye" ("no news available") as long as there are verified fresh articles for this time slot!
- If today's fresh stories cover other major verified developments in this time slot (e.g., Nvidia, Meta, Apple, AI, sports, world news) rather than one specific custom keyword, STILL report 4 to 6 real, well-verified breaking news items from the provided sources in the user's preferred style.`
    : '';

  const systemInstruction = `You are Kevin AI, Rwanda's intelligent WhatsApp-style assistant created by Uwumukiza Kevin.
You are sending a scheduled daily news WhatsApp briefing in authentic, natural, grammatically fluent Rwandan Kinyarwanda (Ikinyarwanda cy'umwimerere).
STRICT FRESHNESS & TRUTHFULNESS RULE (AMAKURU Y'UKURI AHAGAZEHO NEZA):
- Current Rwanda time is ${displayDateRw} (${kigaliDate}) at ${nowKigaliTime} (Africa/Kigali).
- ONLY report genuinely BREAKING / FRESH, REAL news from the last 12 to 16 hours. NEVER include old news from days, weeks, or years ago.
- ZERO HALLUCINATION / NTUKABESHYE: Base EVERY single fact, name, score, figure, date, and claim STRICTLY on the verified live articles / Google Search grounding results provided. NEVER invent, guess, extrapolate, or fabricate any news, quotes, releases, or numbers. If a detail is not explicitly confirmed in the verified sources, DO NOT include it.
- Give solid, accurate, well-grounded news only ("amakuru y'ukuri nyayo ahagazeho neza").
- Format like a clean, scannable WhatsApp briefing with 4 to 6 crisp bullet items (bold headline + 1-2 short clear sentences explaining verified facts), friendly emojis, and warm Rwandan tone.${customInstructionsBlock}`;

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

  if (slotKey === 'evening_rwanda') {
    return {
      systemInstruction,
      userPrompt: `Tegura ubutumwa bwa saa mbiri z'umugoroba (20:00 / 8:00 PM Rwanda) bw'AMAKURU MASHYA YO MU RWANDA HOSE N'UKO BYIRIWE BYIFASHE HIRYA NO HINO MU DUCE DUTANDUKANYE TW'IGIHUGU uyu munsi.
Ibyo ubandikaho:
- Tangira uti: "Mwiriwe neza! 🇷🇼📰 Dore amakuru mashya yo mu Rwanda hose n'uko byiriwe byifashe hirya no hino mu duce tw'igihugu uyu munsi:"
- Ibanze ku makuru nyayo kandi mashya yiriwe avugwa uyu munsi mu Rwanda mbere ya saa mbiri: mu Mujyi wa Kigali no mu ntara zose (Amajyaruguru, Amajyepfo, Iburasirazuba, Iburengerazuba — uturere nka Musanze, Rubavu, Huye, Rusizi, Nyagatare, Muhanga, Rwamagana, Karongi, n'ahandi habonetse inkuru z'ukuri).
- Vuga ibyiriwe bibera mu Rwanda mu bukungu, iterambere, ibikorwaremezo, ubuhinzi, uburezi, ubuzima, imibereho y'abaturage, umutekano, ibyemezo by'inzego cyangwa imikino/umuco mu Rwanda (uhereye ku makuru y'ukuri yiriwe avugwa uyu munsi gusa).
- NTUKABESHYE, NTUKARANGAGE, kandi NTUSHIRMO amakuru ashaje y'iminsi yashize cyangwa ayo hanze atari ayo mu Rwanda.
- Soza ubaza mu Kinyarwanda niba hari akarere cyangwa inkuru yo mu Rwanda bifuza ko ubasobanurira birambuye.

AMAKURU MASHYA YO MU RWANDA YABONETSE KURI INTERNET:
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
  forceGenerate = false,
  newsCustomInstructions = ''
): Promise<DailyNewsBriefing | null> {
  loadCacheFromDisk();
  const cleanCustomNews = normalizeNewsCustomInstructions(newsCustomInstructions);
  const customSig = getNewsCustomSignature(cleanCustomNews);
  const slotId = buildNewsSlotId(kigaliDate, slotKey);
  const cacheKey = makeBriefingCacheKey(slotId, customSig);

  const existing = briefingCache.get(cacheKey);
  if (existing && !forceGenerate) {
    return existing;
  }

  const pending = inFlightGenerations.get(cacheKey);
  if (pending) {
    return pending;
  }

  const slotMeta = DAILY_NEWS_SLOTS.find((s) => s.key === slotKey)!;
  const scheduledAtMs = computeKigaliSlotEpochMs(kigaliDate, slotMeta.hourKigali, slotMeta.minuteKigali);
  const [yr, mo, dy] = kigaliDate.split('-');
  const displayDateRw = `${dy}/${mo}/${yr}`;

  const task = (async (): Promise<DailyNewsBriefing | null> => {
    const rssItems = await fetchFreshRssForSlot(slotKey, kigaliDate, cleanCustomNews);
    if (apiKeys.length === 0) {
      return null;
    }

    const { systemInstruction, userPrompt } = buildNewsGenerationPrompt(
      slotKey,
      kigaliDate,
      displayDateRw,
      rssItems,
      cleanCustomNews
    );
    const effectiveUserPrompt = cleanCustomNews
      ? `${userPrompt}\n\nAMABWIRIZA YIHARIYE Y'UMUKORESHA (CUSTOM INSTRUCTION NEWS — Icyitonderwa: niba hari inkuru z'ukuri zihuje n'ibyo yasabye uzishyire imbere, NTUKABESHYE cyangwa ngo uhimbe inkuru udafiteho gihamya. Nanone NTUKAVUGE ngo nta makuru ahari igihe hari inkuru nyinshi z'ukuri zigezweho muri iri tangazo — andika inkuru 4 kugeza kuri 6 z'ukuri kandi zihagazeho neza mu buryo yasabye):\n${cleanCustomNews}`
      : userPrompt;

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
              contents: effectiveUserPrompt,
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
            if (
              rssItems.length >= 3 &&
              text.length < 520 &&
              /nta makuru (mashya|yihariye|abonetse|ahari)/i.test(text)
            ) {
              continue;
            }

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

            const briefing: CachedDailyNewsBriefing = {
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
              category: slotKey === 'noon_world'
                ? 'world_sports'
                : slotKey === 'afternoon_sports_analysis'
                  ? 'sports_analysis'
                  : slotKey === 'evening_rwanda'
                    ? 'rwanda_news'
                    : 'tech_ai',
              ...(customSig !== 'default' ? { customSig } : {}),
            };
            briefingCache.set(cacheKey, briefing);
            saveCacheToDisk();
            console.log(`[NewsScheduler] Generated fresh briefing for ${cacheKey} (${collectedSources.length} sources)`);
            const { customSig: _omitSig, ...publicBriefing } = briefing;
            return publicBriefing;
          } catch (err) {
            console.warn(`[NewsScheduler] ${cacheKey} (${model}, ${mode}) attempt failed:`, err instanceof Error ? err.message : String(err));
          }
        }
      }
    }

    return null;
  })();

  inFlightGenerations.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inFlightGenerations.delete(cacheKey);
  }
}

export async function syncDueNewsBriefings(params: {
  deliveredIds?: string[];
  customApiKeys?: string | string[];
  newsCustomInstructions?: string;
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
    const item = await generateOrGetBriefingForSlot(
      due.meta.key,
      due.kigaliDate,
      apiKeys,
      false,
      params.newsCustomInstructions || ''
    );
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
