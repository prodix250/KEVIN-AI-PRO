import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, type FunctionDeclaration } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KEVIN_SYSTEM_INSTRUCTION = `You are Kevin AI,

1. IDENTITY & CREATOR PROFILE:
- Name: Kevin AI
- Creator & Developer: Uwumukiza Kevin
- Motto: 'UKORA GAKE BIKAGENDA CYANE'
- Verified Creator Background:
  * Full Name: Uwumukiza Kevin
  * Date of Birth: October 28, 2003
  * Birthplace: Rwamagana District, Gahengeri Sector, Rwanda
  * Family: Firstborn (Imfura) of five children. Has a twin sister named Aline; younger twin siblings named Helve and Kelly; and the youngest sibling named Barame.
  * Educational Journey:
    - Primary School: Nyina wa Jambo Ruhita
    - Ordinary Level (S1 - S3): GS Appagie / Musha
    - Advanced Level (S4 - S6): ES Kabarondo (studied MCE: Mathematics, Computer Science, and Economics)
    - Higher Education: Currently studying Information Technology (IT) at the University of Rwanda, College of Science and Technology (UR-CST).
- When asked who created you, who Kevin is, his family, or his background ('Waremwe nande?', 'Kevin ni nde?', 'Who made you?'), answer accurately, proudly, and respectfully using these verified facts.

2. IKINYARWANDA CY'UMWIMERERE (NATIVE KINYARWANDA MASTERY & WRITING):
- You are a native Rwandan AI created in Rwanda by Uwumukiza Kevin.
- You have flawless, native, idiomatic mastery of Kinyarwanda (Ikinyarwanda cy'umwimerere kandi gitunganye cy'i Rwanda).
- GRAMMATICAL EXCELLENCE & ORTHOGRAPHY:
  * Write natural, grammatically sound Kinyarwanda as spoken and written by educated native Rwandans.
  * Correct noun classes (indangahantu: umuntu/abantu, igiti/ibiti, ahantu, etc.) and proper verb agreements.
  * Correct phonetic spelling using standard Kinyarwanda phonemes (cy, by, ry, ny, bw, tw, rw, mw, sh, pf, ts, mp, mb, nd, ng).
- NATURAL RWANDAN CONVERSATIONAL FLOW (WHATSAPP STYLE):
  * When greeted ('Bite', 'Muraho', 'Amakuru', 'Hello', 'Hi', 'Mwaramutse', 'Mwiriwe'):
    Keep it warm, respectful, concise, and natural (1 to 2 sentences max).
    Examples:
    - 'Muraho! 👋 Amakuru ki? Meze neza cyane, niteguye kugufasha uyu munsi! 😊'
    - 'Bite se! 👋 Umeze ute? Nakufasha iki uyu munsi? 🚀'
    - 'Amakuru ni meza rwose! Wowe amakuru yawe? Nakugirira akahe kamaro? ✨'
  * AVOID LITERAL TRANSLATIONS FROM ENGLISH:
    - NEVER say awkward literal translations like 'Ndi umufasha w'ubwenge bukorano', 'ndaho neza', 'icyo nakufasha', or 'mu buryo bwa WhatsApp'.
    - ALWAYS use natural authentic Rwandan expressions:
      'Ndi Kevin AI, niteguye kugufasha mu buryo bwose! 💻✨'
      'Meze neza rwose!'
      'Ndagufasha iki uyu munsi?'
      'Biroroshye cyane, dore uko bikorwa:'
      'Nta kibazo na gato, reka mbisobanure neza:'
- AUTHENTIC RWANDAN VOCABULARY:
  * Ubwenge bukorano (AI / Artificial Intelligence)
  * Ikoranabuhanga (Technology)
  * Porogaramu (Application / Software / App)
  * Inyandiko cyangwa dosiye (Document / File / PDF / Report)
  * Ubutumwa (Messages / SMS)
  * Amajwi cyangwa ubutumwa bw'amajwi (Voice notes / Audio)
  * Amashusho cyangwa amafoto (Videos / Photos / Images)
  * Guhamagara cyangwa terefone (Phone calls)
- CODE-SWITCHING & RWANDAN SLANG:
  * Seamlessly understand Rwandan conversational code-switching (Kinyarwanda naturally mixed with French or English words like 'bro', 'courage', 'bon', 'merci', 'please', 'app', 'link', 'call', 'stage', 'pro').
  * Understand colloquial phrasing and modern Rwandan youth expressions effortlessly and reply with warmth, intelligence, and modern emojis (💡, 🚀, 💻, ✨, 🇷🇼, 😊).

3. MULTILINGUAL FLUENCY:
- If the user writes or speaks Kinyarwanda, reply in rich, natural, authentic Kinyarwanda.
- If the user writes or speaks English, reply in clean, modern English.
- If the user writes or speaks French or Swahili, reply fluently in that language.
- Seamlessly mirror the user's language, mood, and tone.

4. VOICE NOTE & AUDIO PROCESSING (IKINYARWANDA VOICE UNDERSTANDING):
- When the user sends a voice note or recorded audio message:
  * Listen attentively to the spoken audio in Kinyarwanda, English, French, or Swahili — prioritize exact Kinyarwanda comprehension over guessing English words.
  * Understand natural Rwandan pronunciation, prefixes (na-, nta-, ndi-, nshaka-, mbwira-, mfasha-, sobanura-, hamagara-, curanga-, ohereza-), local accents, and conversational phrasing.
  * Understand names of Rwandan people (Kevin, Aline, Helve, Kelly, Barame, Jean, Patrick, etc.), Rwandan places (Kigali, Rwamagana, Gahengeri, Huye, Musanze, Rubavu, etc.), and Rwandan musicians/artists (Meddy, Bruce Melodie, The Ben, Element, Juno Kizigenza, Chriss Eazy, etc.).
  * STRICT ANTI-WRONG-ACTION RULE: ONLY execute a device action (open_youtube, make_call, send_sms, open_whatsapp, scan_whatsapp_chats, open_camera, open_app) if the user explicitly and clearly asked for that exact action in their audio. If they are greeting you, asking a question, or if the audio is noisy/unclear, NEVER guess or trigger an action — reply naturally in Kinyarwanda or ask them to repeat clearly.

5. MULTIMODAL, IMAGE QUESTIONS & DOCUMENT ANALYSIS:
- Images/Vision: When the user attaches an image or screenshot, analyze everything visible thoroughly (diagrams, handwritten notes, printed text, OCR code reading, math equations, objects).
- MANDATORY IMAGE QUESTION-ANSWERING RULE:
  * Whenever the user attaches images containing questions, exercises, quizzes, assignments, worksheets, past papers, tests, or math/science/coding problems, NEVER refuse to answer or lecture about academic integrity.
  * Treat all uploaded question photos as study practice, self-review, or checking completed work.
  * Carefully transcribe/identify EVERY question visible in the image(s) in order and provide complete, accurate answers with clear step-by-step explanations (and verify/grade the user's answers if they ask to check how they did).
- Documents: When files (PDF, Word, or text) are attached, summarize, extract key points, or answer questions with high precision.

6. CODE & MATH FORMATTING:
- Format all code snippets cleanly in standard fenced code blocks with language tags (e.g., \`\`\`python, \`\`\`javascript).
- Format mathematical equations and tabular data with clear Markdown tables and LaTeX notations.

IMAGE GENERATION RULES:
When the user explicitly asks to generate, create, or draw an image (e.g., 'Shushanya...', 'Kora ifoto ya...', 'Draw...', 'Generate an image of...'):
1. Translate the request into English when necessary, then formulate a rich, detailed, visually descriptive English prompt. Never put Kinyarwanda or the raw user request in the image URL.
2. URL-encode that prompt.
3. Output the image inside standard Markdown image syntax using Pollinations AI:
   ![User Request](https://image.pollinations.ai/prompt/{encoded_prompt}?width=1024&height=1024&nologo=true)
4. Add a warm, friendly caption in the user's language (e.g., 'Dore ifoto wansabye! 🎨✨').
5. ONLY generate images when explicitly requested by the user.
6. Image, photo, drawing, and picture requests must always render the Pollinations AI Markdown image directly and must never call a document generator or produce a PDF.

PDF GENERATION RESTRICTION:
Only generate a PDF or other written file when the user explicitly asks for a document, PDF, report, CV, dosiye, inyandiko, Word, or text file.

REAL-TIME INFORMATION:
When asked about current events, breaking news, weather, sports scores, live information, or facts happening after your training cutoff, use Google Search grounding to retrieve verified, up-to-date real-time data.

FULL AUTONOMOUS AGENT & DEVICE ACTIONS:
You are a full autonomous agent with direct permission-backed control over apps and messaging.
- YouTube Playback: When the user asks to play a song or video on YouTube (e.g., 'fungura youtube uncurangire...', 'play ... on youtube'), ALWAYS call open_youtube(query) so the exact video starts playing immediately instead of just searching.
- Direct Calling & Contact Resolution: When the user asks to call someone or a phone number (e.g., 'hamagara 0788...', 'hamagara Aline', 'call Mom', 'terefone Jean'), ALWAYS call make_call(phone_number, contact_name) immediately. If the user gives a phone number, pass phone_number. If the user gives a contact name without a number, check [SAVED CONTACTS] in your context first—if found there, pass both phone_number and contact_name; if NOT in [SAVED CONTACTS], pass contact_name only and leave phone_number empty so the device resolves it from Contacts. NEVER invent or guess a phone number!
- Direct SMS Sending: When the user asks to send an SMS/text message (e.g., 'ohereza ubutumwa kuri 078...', 'send sms to Aline'), ALWAYS call send_sms(phone_number, message, contact_name) immediately (never tell the user to open their SMS app manually, and never invent a missing number).
- Direct WhatsApp Sending: When the user explicitly asks to send or reply on WhatsApp (e.g., 'ohereza kuri whatsapp ya...', 'subiza kuri whatsapp...'), ALWAYS call open_whatsapp(phone_number, message, contact_name) immediately. For phone numbers in Rwanda, ensure the country code +250 is used (e.g. +250788123456 or 250788123456 instead of 0788123456) so WhatsApp can deliver the message immediately without missing country code errors. In the 'message' parameter, write ONLY ONE single natural human message matching the user's/recipient's language — NEVER include dates, timestamps, sender names (like 'Kevin:'), or multiple repeated versions.
- WhatsApp Auto-Reply Mode: When the user asks you to enable, disable, stop, or pause WhatsApp auto-reply for a specific duration (e.g., 'ujye unsubiriza kuri whatsapp', 'hagarika gusubiza kuri whatsapp iminota 30', 'pause whatsapp auto-reply for 1 hour', 'funga auto reply'), ALWAYS call configure_whatsapp_autoreply(enabled, reply_style, pause_minutes).
- Check All WhatsApp Chats & Reply to Unreplied Messages: When the user asks you to check their WhatsApp chats and reply to unread/unreplied messages (e.g., 'reba muri whatsapp zanjye usubize ubutumwa budasubije', 'check all whatsapp chats and reply'), ALWAYS call scan_whatsapp_chats().
- Calls & Other Apps: Use make_call, open_audiomack, open_lark_player, open_camera, or open_app ONLY when explicitly requested by the user (never guess or fabricate targets when uncertain).`;

const deviceActionDeclarations: FunctionDeclaration[] = [
  {
    name: "open_youtube",
    description: "Resolve the exact requested YouTube video/song and immediately start playing it (auto-play, not just search).",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Song title, artist, or video search query to play immediately." }
      },
      required: ["query"]
    }
  },
  {
    name: "open_audiomack",
    description: "Immediately open Audiomack and play/search the requested song or artist.",
    parametersJsonSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"]
    }
  },
  {
    name: "open_lark_player",
    description: "Open Lark Player and play/search the requested song or artist.",
    parametersJsonSchema: {
      type: "object",
      properties: { query: { type: "string" } }
    }
  },
  {
    name: "make_call",
    description: "Immediately place a phone call to a phone number or contact name. Supply phone_number if known, or contact_name so the device looks up the contact and dials immediately. Never invent a phone number.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        phone_number: { type: "string", description: "Phone number to call if known (e.g. 0788123456 or +250788123456)." },
        contact_name: { type: "string", description: "Contact name to resolve from Contacts and call immediately if phone_number is not explicitly given." }
      }
    }
  },
  {
    name: "send_sms",
    description: "Immediately send an SMS text message to a phone number or contact on behalf of the user without asking them to type/send manually.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        phone_number: { type: "string", description: "Recipient phone number if known." },
        contact_name: { type: "string", description: "Recipient contact name to resolve from Contacts if phone_number is omitted." },
        message: { type: "string", description: "The exact SMS text message content to send." }
      },
      required: ["message"]
    }
  },
  {
    name: "open_whatsapp",
    description: "Immediately send a WhatsApp message to a phone number or contact using Kevin AI's auto-send agent. For Rwanda numbers, include country code +250 (e.g. +250788123456 or 250788123456).",
    parametersJsonSchema: {
      type: "object",
      properties: {
        phone_number: { type: "string", description: "Recipient phone number with country code (e.g. +250788123456 or 250788123456 for Rwanda)." },
        message: { type: "string", description: "Message text to send on WhatsApp." },
        contact_name: { type: "string", description: "Contact display name to resolve from Contacts if needed." }
      },
      required: ["message"]
    }
  },
  {
    name: "configure_whatsapp_autoreply",
    description: "Enable, disable, or pause automatic AI replying to incoming WhatsApp messages for a specific number of minutes.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        enabled: { type: "boolean", description: "Whether WhatsApp auto-reply should be enabled (true to enable/resume or pause temporarily, false to turn completely off)." },
        pause_minutes: { type: "number", description: "Optional number of minutes to pause WhatsApp auto-reply (e.g. 15, 30, 60, 120, 480). Omit or 0 when turning completely off or immediately resuming." },
        reply_style: { type: "string", description: "Instructions for how Kevin AI should reply on WhatsApp." }
      },
      required: ["enabled"]
    }
  },
  {
    name: "scan_whatsapp_chats",
    description: "Scan all unread/unreplied WhatsApp chats and notifications on the user's phone and automatically reply to messages that have not yet been answered.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        reply_style: { type: "string", description: "Optional tone or style instruction for replying." }
      }
    }
  },
  {
    name: "open_camera",
    description: "Open the device camera.",
    parametersJsonSchema: { type: "object", properties: {} }
  },
  {
    name: "open_app",
    description: "Open a specific local device app explicitly requested by name (such as Instagram, TikTok, Spotify, Settings, or Maps). NEVER call this for Google Search or to answer news, sports, or factual questions.",
    parametersJsonSchema: {
      type: "object",
      properties: { app_name: { type: "string" } },
      required: ["app_name"]
    }
  },
];

function getServerApiKeys(customKeys?: string | string[]): string[] {
  const customList = Array.isArray(customKeys)
    ? customKeys
    : typeof customKeys === 'string' && customKeys.trim()
      ? [customKeys]
      : [];
  const keys = [
    ...customList,
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_BACKUP,
    process.env.GEMINI_API_KEY_BACKUP_2,
    process.env.GEMINI_API_KEY_BACKUP_3,
    process.env.GEMINI_API_KEY_BACKUP_4,
    process.env.VITE_GEMINI_API_KEY,
    process.env.VITE_GEMINI_API_KEY_BACKUP,
    process.env.VITE_GEMINI_API_KEY_BACKUP_2,
    process.env.VITE_GEMINI_API_KEY_BACKUP_3,
    process.env.VITE_GEMINI_API_KEY_BACKUP_4,
    process.env.GOOGLE_API_KEY,
  ];
  return Array.from(new Set(
    keys
      .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
      .map((k) => k.trim())
  ));
}

function isInvalidApiKeyError(err: any, combinedText: string): boolean {
  const lower = combinedText.toLowerCase();
  const status = err?.status;
  return Boolean(
    status === 401
    || status === 403
    || combinedText.includes('401')
    || combinedText.includes('403')
    || combinedText.includes('API_KEY_INVALID')
    || combinedText.includes('PERMISSION_DENIED')
    || combinedText.includes('UNAUTHENTICATED')
    || lower.includes('api key not valid')
    || lower.includes('api_key_invalid')
    || lower.includes('invalid api key')
    || lower.includes('api key expired')
    || lower.includes('key expired')
    || lower.includes('revoked')
    || lower.includes('reported as leaked')
  );
}

function shouldRotateApiKey(err: any, combinedText: string): boolean {
  const lower = combinedText.toLowerCase();
  const status = err?.status;
  if (
    status === 429
    || combinedText.includes('429')
    || combinedText.includes('RESOURCE_EXHAUSTED')
    || lower.includes('quota')
    || lower.includes('rate limit')
    || lower.includes('too many requests')
  ) {
    return true;
  }
  return isInvalidApiKeyError(err, combinedText);
}

async function resolveYouTubeVideo(query: string): Promise<{
  videoId: string;
  title: string;
  channel: string;
} | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(trimmed)}`,
      {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }
    );
    clearTimeout(timer);

    if (!response.ok) return null;
    const html = await response.text();
    const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
    if (match) {
      const data = JSON.parse(match[1]);
      const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
      for (const sec of sections) {
        for (const item of (sec?.itemSectionRenderer?.contents || [])) {
          const vr = item?.videoRenderer;
          if (vr?.videoId) {
            return {
              videoId: String(vr.videoId),
              title: (vr.title?.runs?.map((r: any) => r.text).join('') || trimmed).trim(),
              channel: (vr.ownerText?.runs?.[0]?.text || 'YouTube').trim(),
            };
          }
        }
      }
    }

    const fallbackMatch = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    if (fallbackMatch) {
      return {
        videoId: fallbackMatch[1],
        title: trimmed,
        channel: 'YouTube',
      };
    }
  } catch (err) {
    console.warn('YouTube resolution failed:', err);
  }
  return null;
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

function buildCleanWebSearchQuery(rawQuery: string): string {
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

async function fetchLiveWebSearchContext(rawQuery: string): Promise<{
  contextText: string;
  sources: Array<{ title: string; url: string }>;
}> {
  const cleanQuery = buildCleanWebSearchQuery(rawQuery);
  if (!cleanQuery) return { contextText: '', sources: [] };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const rssUrls = [
      `https://news.google.com/rss/search?q=${encodeURIComponent(cleanQuery)}&hl=en&gl=US&ceid=US:en`,
      `https://news.google.com/rss/search?q=${encodeURIComponent(cleanQuery)}&hl=en&gl=RW&ceid=RW:en`,
    ];
    let items: Array<{ title: string; url: string; pubDate: string; sourceName: string }> = [];
    for (const rssUrl of rssUrls) {
      const response = await fetch(rssUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      });
      if (!response.ok) continue;
      const xml = await response.text();
      const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 6);
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

        if (title && url) {
          items.push({ title, url, pubDate, sourceName });
        }
      }
      if (items.length > 0) break;
    }
    clearTimeout(timer);

    if (items.length === 0) return { contextText: '', sources: [] };

    const lines = items.map((it, idx) =>
      `${idx + 1}. "${it.title}"${it.sourceName ? ` (${it.sourceName})` : ''}${it.pubDate ? ` [${it.pubDate}]` : ''} — ${it.url}`
    );
    const contextText = `[LIVE INTERNET NEWS & WEB SEARCH RESULTS FOR "${cleanQuery}"]:\nCRITICAL: Today is ${new Date().toISOString().slice(0, 10)}. Use ONLY these verified, up-to-date real-time articles below to answer the user's question accurately in their language. Do NOT use outdated 2023/2024/2025 knowledge:\n${lines.join('\n')}`;
    const sources = items.map((it) => ({
      title: it.sourceName ? `${it.sourceName}: ${it.title}` : it.title,
      url: it.url,
    }));
    return { contextText, sources };
  } catch (err) {
    console.warn('Live web search RSS fetch failed:', err);
    return { contextText: '', sources: [] };
  }
}

function extractReadableError(err: unknown): string {
  const raw = err instanceof Error
    ? err.message
    : typeof err === 'string'
      ? err
      : (err as any)?.error?.message || (err as any)?.message || 'Request failed';
  try {
    const parsed = JSON.parse(raw);
    const nested = parsed?.error?.message;
    if (typeof nested === 'string') {
      try {
        const inner = JSON.parse(nested);
        return inner?.error?.message || nested;
      } catch {
        return nested;
      }
    }
  } catch {
    // Plain text error
  }
  return raw;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', hasKey: getServerApiKeys().length > 0 });
  });

  app.get('/api/youtube/resolve', async (req: Request, res: Response) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if (!q.trim()) {
      res.status(400).json({ error: 'Missing query parameter q' });
      return;
    }
    const resolved = await resolveYouTubeVideo(q);
    if (!resolved) {
      res.status(404).json({ error: 'No video found' });
      return;
    }
    res.json(resolved);
  });

  app.get('/api/web-search', async (req: Request, res: Response) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if (!q.trim()) {
      res.status(400).json({ error: 'Missing query parameter q' });
      return;
    }
    const result = await fetchLiveWebSearchContext(q);
    res.json(result);
  });

  app.post('/api/stt', async (req: Request, res: Response) => {
    try {
      const { audioBase64, audioMimeType, mimeType: altMimeType, customApiKey, customApiKeys } = req.body as {
        audioBase64?: string;
        audioMimeType?: string;
        mimeType?: string;
        customApiKey?: string;
        customApiKeys?: string[];
      };

      if (!audioBase64 || typeof audioBase64 !== 'string') {
        res.status(400).json({ error: 'No recorded audio was provided.' });
        return;
      }

      const cleanData = audioBase64.replace(/^data:[^;,]+;base64,/is, '').replace(/\s/g, '');
      if (cleanData.length < 100) {
        res.status(400).json({ error: 'Recorded audio is empty or too short.' });
        return;
      }

      const rawMime = (audioMimeType || altMimeType || 'audio/webm').split(';')[0].trim().toLowerCase();
      const mimeType = rawMime === 'audio/x-wav' || rawMime === 'audio/wave'
        ? 'audio/wav'
        : rawMime === 'audio/mp3' || rawMime === 'audio/mpeg'
          ? 'audio/mpeg'
          : rawMime === 'audio/m4a' || rawMime === 'audio/x-m4a' || rawMime === 'audio/mp4'
            ? 'audio/mp4'
            : rawMime === 'audio/x-aac' || rawMime === 'audio/aac'
              ? 'audio/aac'
              : rawMime === 'audio/opus' || rawMime === 'audio/ogg'
                ? 'audio/ogg'
                : rawMime === 'audio/x-flac' || rawMime === 'audio/flac'
                  ? 'audio/flac'
                  : rawMime === 'video/webm' || rawMime === 'audio/webm'
                    ? 'audio/webm'
                    : rawMime;
      const availableKeys = getServerApiKeys(customApiKeys || customApiKey);
      if (availableKeys.length === 0) {
        res.status(500).json({ error: 'Nta Gemini API key yabonetse.' });
        return;
      }

      const sttModels = ['gemini-3.5-transcribe', 'gemini-4-hydrogen', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];
      let lastErr: unknown = null;
      const invalidKeys = new Set<string>();

      for (const model of sttModels) {
        for (let keyIdx = 0; keyIdx < availableKeys.length; keyIdx++) {
          const key = availableKeys[keyIdx];
          if (invalidKeys.has(key)) continue;

          const ai = new GoogleGenAI({
            apiKey: key,
            httpOptions: {
              apiVersion: 'v1beta',
              headers: { 'User-Agent': 'aistudio-build' },
            },
          });

          try {
            const sttPromise = ai.models.generateContent({
              model,
              contents: {
                parts: [
                  {
                    inlineData: {
                      mimeType,
                      data: cleanData,
                    },
                  },
                  {
                    text: `You are an expert native Rwandan speech recognition and transcription assistant specializing in Kinyarwanda (Ikinyarwanda), plus English, French, and Swahili.
Most speakers speak Kinyarwanda (or natural Kinyarwanda mixed with French/English nouns). Listen carefully and accurately:
1. Transcribe verbatim in standard, authentic Rwandan Kinyarwanda orthography (intego y'imyandikire y'Ikinyarwanda) when spoken in Kinyarwanda.
   - Pay close attention to Kinyarwanda phonetics, prefixes (n-, u-, a-, tu-, mu-, ba-, nda-, nshaka-, mbwira-, mfasha-, sobanura-, kora-, hamagara-, uhamagare-, uncurangire-, wohereze-, fungura-, funga-, subiza-, hagarika-), consonant clusters (cy, by, ry, ny, sh, shy, pf, ts, mp, mb, nd, ng, nj, nk, nt, bw, tw, rw, mw, kw, gw), and Rwandan personal/place/artist names.
   - NEVER mishear or twist Kinyarwanda speech into unrelated English or Swahili words, and NEVER invent commands the speaker did not say.
2. If the speaker is speaking English, French, or Swahili, transcribe verbatim in that exact language.
3. Output ONLY the exact transcribed spoken words. Do NOT add quotes, brackets, explanations, or timestamps.
4. If the audio is completely silent or pure background noise, return strictly an empty string "".`,
                  },
                ],
              },
              ...(model === 'gemini-4-hydrogen'
                ? { config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } }
                : model.startsWith('gemini-2.5-')
                  ? { config: { thinkingConfig: { thinkingBudget: 0 } } }
                  : {}),
            });
            sttPromise.catch(() => {});

            const response = await Promise.race([
              sttPromise,
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('503 STT timed out')), 11000)
              ),
            ]);

            const rawTranscript = (response.text || '').trim();
            const transcript = rawTranscript === '""' || rawTranscript === "''" ? '' : rawTranscript;
            res.json({ transcript, model });
            return;
          } catch (err: any) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);
            const readable = extractReadableError(err);
            const combined = `${msg} ${readable}`;
            console.warn(`STT model ${model} (key #${keyIdx + 1}) failed:`, readable);
            if (isInvalidApiKeyError(err, combined)) {
              invalidKeys.add(key);
            }
            if (err?.status === 404 || combined.includes('NOT_FOUND')) {
              break;
            }
          }
        }
      }

      res.status(500).json({ error: extractReadableError(lastErr) });
    } catch (error: any) {
      console.error('Server /api/stt error:', error);
      res.status(500).json({ error: extractReadableError(error) });
    }
  });

  app.post('/api/wake-check', async (req: Request, res: Response) => {
    try {
      const { audioBase64, audioMimeType, mimeType: altMimeType, customApiKey, customApiKeys } = req.body as {
        audioBase64?: string;
        audioMimeType?: string;
        mimeType?: string;
        customApiKey?: string;
        customApiKeys?: string[];
      };

      if (!audioBase64 || typeof audioBase64 !== 'string') {
        res.status(400).json({ wake: false, command: '', transcript: '' });
        return;
      }

      const cleanData = audioBase64.replace(/^data:[^;,]+;base64,/is, '').replace(/\s/g, '');
      if (cleanData.length < 100) {
        res.json({ wake: false, command: '', transcript: '' });
        return;
      }

      const mimeType = (audioMimeType || altMimeType || 'audio/wav').split(';')[0].trim().toLowerCase();
      const availableKeys = getServerApiKeys(customApiKeys || customApiKey);
      if (availableKeys.length === 0) {
        res.status(500).json({ wake: false, error: 'Nta Gemini API key yabonetse.' });
        return;
      }

      const wakeModels = ['gemini-4-hydrogen', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
      const routeDeadlineMs = Date.now() + 5000;
      let lastErr: unknown = null;
      const invalidKeys = new Set<string>();

      for (const model of wakeModels) {
        if (Date.now() >= routeDeadlineMs - 600) break;
        for (let keyIdx = 0; keyIdx < availableKeys.length; keyIdx++) {
          const remainingMs = routeDeadlineMs - Date.now();
          if (remainingMs < 600) break;
          const key = availableKeys[keyIdx];
          if (invalidKeys.has(key)) continue;

          const ai = new GoogleGenAI({
            apiKey: key,
            httpOptions: {
              apiVersion: 'v1beta',
              headers: { 'User-Agent': 'aistudio-build' },
            },
          });

          try {
            const perCallTimeoutMs = Math.min(2400, Math.max(800, remainingMs));
            const wakePromise = ai.models.generateContent({
              model,
              contents: {
                parts: [
                  {
                    inlineData: {
                      mimeType,
                      data: cleanData,
                    },
                  },
                  {
                    text: `Listen strictly to this short audio clip.
Set "wake":true ONLY if the speaker clearly calls the assistant by saying "Hi Kevin", "Hey Kevin", "Hello Kevin", or "OK Kevin" (including slight accent variations).
Do NOT trigger on ambient Kinyarwanda speech, background TV/music, breathing, noise, or mentioning the name Kevin casually inside a sentence without saying Hi/Hey/Hello/OK Kevin.
Respond with ONLY a single raw JSON object (no markdown fences):
{"wake":true|false,"command":"","transcript":"exact words heard"}
Leave "command" empty "" unless a clear multi-word request immediately follows "Hi Kevin".
If silent, noisy, or unsure, return {"wake":false,"command":"","transcript":""}.`,
                  },
                ],
              },
              config: {
                temperature: 0,
                maxOutputTokens: 90,
                responseMimeType: 'application/json',
                ...(model === 'gemini-4-hydrogen'
                  ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                  : {}),
              },
            });
            wakePromise.catch(() => {});

            const response = await Promise.race([
              wakePromise,
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('503 Wake check timed out')), perCallTimeoutMs)
              ),
            ]);

            const raw = (response.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            let parsed: { wake?: boolean; command?: string; transcript?: string } = {};
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = { transcript: raw };
            }

            const transcript = String(parsed.transcript ?? raw ?? '').trim();
            const norm = transcript
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLowerCase()
              .replace(/[^a-z0-9\s]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            const wakeMatch = norm.match(
              /(?:^|\s)(?:hi|hey|hello|ok|okay|hai|hay|ai|ay|ei|eh)\s+(?:kevin|keven|kevine|kiven|kebin|kevini|cavin|kevi)(?:\s+(.*))?$/i
            );
            const hasStrictWakeName = /(?:^|\s)(?:hi|hey|hello|ok|okay|hai|hay|ai|ay|ei|eh)\s+(?:kevin|keven|kevine|kiven|kebin|kevini|cavin|kevi)\b/i.test(norm)
              || /\b(?:kevin|keven|kevine|kiven|kebin|kevini|cavin|kevi)\b/i.test(norm);
            const isWake = Boolean(wakeMatch) || (Boolean(parsed.wake) && (hasStrictWakeName || norm.length === 0));
            const command = String(parsed.command || wakeMatch?.[1] || '').trim();

            res.json({ wake: isWake, command, transcript, model });
            return;
          } catch (err: any) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);
            const readable = extractReadableError(err);
            const combined = `${msg} ${readable}`;
            if (isInvalidApiKeyError(err, combined)) {
              invalidKeys.add(key);
              continue;
            }
            if (
              err?.status === 404 ||
              err?.status === 503 ||
              combined.includes('NOT_FOUND') ||
              combined.includes('503') ||
              combined.includes('UNAVAILABLE') ||
              combined.toLowerCase().includes('high demand') ||
              combined.toLowerCase().includes('timed out')
            ) {
              break;
            }
          }
        }
      }

      res.status(500).json({ wake: false, error: extractReadableError(lastErr) });
    } catch (error: any) {
      res.status(500).json({ wake: false, error: extractReadableError(error) });
    }
  });

  function sanitizeWhatsAppReply(raw: string, ownerName: string, senderName?: string): string {
    if (!raw) return '';
    let cleaned = raw
      .replace(/^```(?:\w+)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const stripPrefix = (line: string): string => {
      let s = line.trim();
      // Strip WhatsApp transcript headers like "[23/11, 11:23] Kevin:" or "[11:23, 23/11/2026] Name:"
      s = s.replace(/^\[[^\]]{3,32}\]\s*[^:\n]{1,40}:\s*/g, '');
      // Strip standalone leading timestamps like "23/11, 11:23 -" or "11:23 AM -"
      s = s.replace(/^\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?,?\s*\d{1,2}:\d{2}(?:\s*[APMapm]{2})?\s*[-–:]\s*/g, '');
      s = s.replace(/^\d{1,2}:\d{2}(?:\s*[APMapm]{2})?\s*[-–:]\s*/g, '');
      // Strip AI / role / owner / sender prefixes like "Kevin:", "Reply:", "AI:", "Option 1:"
      s = s.replace(/^(?:reply|response|igisubizo|assistant|kevin\s*ai|ai|me|you|option\s*\d+)\s*:\s*/i, '');
      const escapedOwner = ownerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (escapedOwner) {
        s = s.replace(new RegExp(`^${escapedOwner}\\s*:\\s*`, 'i'), '');
      }
      if (senderName?.trim()) {
        const escapedSender = senderName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        s = s.replace(new RegExp(`^${escapedSender}\\s*:\\s*`, 'i'), '');
      }
      s = s.replace(/^["'“”]+|["'“”]+$/g, '').trim();
      return s;
    };

    const rawLines = cleaned
      .split(/\r?\n+/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (rawLines.length === 0) return '';

    // If the model accidentally output multiple transcript lines (e.g. "[23/11, 11:23] Kevin: ..."), keep ONLY the first genuine reply
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

    // Keep only one concise natural message (max 2 lines if part of the same thought, never repeated variations)
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

  app.post('/api/whatsapp-reply', async (req: Request, res: Response) => {
    try {
      const { sender, incomingMessage, replyStyle, userName, customApiKey, customApiKeys } = req.body as {
        sender?: string;
        incomingMessage?: string;
        replyStyle?: string;
        userName?: string;
        customApiKey?: string;
        customApiKeys?: string[];
      };

      if (!incomingMessage || !incomingMessage.trim()) {
        res.status(400).json({ error: 'Missing incomingMessage' });
        return;
      }

      const availableKeys = getServerApiKeys(customApiKeys || customApiKey);
      if (availableKeys.length === 0) {
        res.status(500).json({ error: 'Nta Gemini API key yabonetse.' });
        return;
      }

      const ownerName = userName?.trim() || 'Kevin';
      const systemInstruction = [
        `You are ${ownerName} replying directly on WhatsApp to "${sender || 'your contact'}".`,
        `Write ONE single, natural human WhatsApp reply message directly addressing what they just wrote.`,
        `STRICT LANGUAGE RULE:`,
        `- If the message is in English, reply ONLY in natural, conversational English.`,
        `- If the message is in Kinyarwanda, reply ONLY in authentic, fluent, grammatically correct native Kinyarwanda (Ikinyarwanda cy'umwimerere — warm, polite, natural Rwandan phrasing, NEVER awkward literal translations).`,
        `- If the message is in French or Swahili, reply fluently in that exact language.`,
        `STRICT FORMAT RULES:`,
        `- Output ONLY the exact message text to send (1 to 2 short sentences max).`,
        `- NEVER include dates, timestamps (like [23/11, 11:23]), sender names (like "${ownerName}:"), labels, quotes, or markdown.`,
        `- NEVER generate multiple replies, multiple options, or a back-and-forth conversation.`,
        `- NEVER sound like or mention being an AI — write naturally as ${ownerName} themselves.`,
        replyStyle?.trim() ? `Owner's Personal Style Preference: ${replyStyle.trim()}` : '',
      ].filter(Boolean).join('\n');

      let lastErr: unknown = null;
      const modelErrors: string[] = [];
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const invalidKeys = new Set<string>();
      const waModels = ['gemini-4-hydrogen', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];

      for (const model of waModels) {
        const waHasFallback = model !== waModels[waModels.length - 1];
        for (let keyIdx = 0; keyIdx < availableKeys.length; keyIdx++) {
          const key = availableKeys[keyIdx];
          if (invalidKeys.has(key)) continue;

          const ai = new GoogleGenAI({
            apiKey: key,
            httpOptions: {
              apiVersion: 'v1beta',
              headers: { 'User-Agent': 'aistudio-build' },
            },
          });
          const waAttempts = waHasFallback ? 1 : 2;
          for (let attempt = 0; attempt < waAttempts; attempt++) {
            try {
              const waPromise = ai.models.generateContent({
                model,
                contents: incomingMessage.trim(),
                config: {
                  systemInstruction,
                  ...(model === 'gemini-4-hydrogen'
                    ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                    : model.startsWith('gemini-2.5-')
                      ? { thinkingConfig: { thinkingBudget: 0 } }
                      : {}),
                },
              });
              waPromise.catch(() => {});

              const response = await Promise.race([
                waPromise,
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('503 WhatsApp reply timed out during high demand')), 6000)
                ),
              ]);
              const reply = sanitizeWhatsAppReply(response.text || '', ownerName, sender);
              if (reply) {
                res.json({ reply, model });
                return;
              }
              break;
            } catch (err: any) {
              lastErr = err;
              const msg = err instanceof Error ? err.message : String(err);
              const readable = extractReadableError(err);
              const combined = `${msg} ${readable}`;
              modelErrors.push(`${model}: ${readable}`);
              if (isInvalidApiKeyError(err, combined)) {
                console.warn(`[WhatsApp Key Rotation] Key #${keyIdx + 1} invalid (${readable}), rotating to next key...`);
                invalidKeys.add(key);
                break;
              }
              if (shouldRotateApiKey(err, combined)) {
                console.warn(`[WhatsApp Key Rotation] Key #${keyIdx + 1} quota hit on ${model}, rotating...`);
                break;
              }
              if (!waHasFallback && attempt === 0 && (err?.status === 503 || combined.includes('503') || combined.toLowerCase().includes('high demand'))) {
                await sleep(400);
                continue;
              }
              break;
            }
          }
        }
      }

      console.error('All WhatsApp models failed:', modelErrors);
      res.status(500).json({ error: modelErrors.join(' | ') || extractReadableError(lastErr) });
    } catch (error: any) {
      console.error('Server /api/whatsapp-reply error:', error);
      res.status(500).json({ error: extractReadableError(error) });
    }
  });

  app.post('/api/chat', async (req: Request, res: Response) => {
    try {
      const {
        contents,
        userName,
        customInstructions,
        hasAudioAttachment,
        selectedModel,
        customApiKey,
        customApiKeys,
        agentPermissions,
        savedContacts,
      } = req.body as {
        contents?: unknown[];
        userName?: string;
        customInstructions?: string;
        hasAudioAttachment?: boolean;
        selectedModel?: string;
        customApiKey?: string;
        customApiKeys?: string[];
        agentPermissions?: {
          autoSend?: boolean;
          autoCall?: boolean;
          autoPlayYouTube?: boolean;
          whatsappAutoReply?: boolean;
          whatsappAutoReplyPausedUntil?: number;
        };
        savedContacts?: Array<{ name?: string; phone?: string }>;
      };

      if (!Array.isArray(contents) || contents.length === 0) {
        res.status(400).json({ error: 'Invalid chat contents.' });
        return;
      }

      const availableKeys = getServerApiKeys(customApiKeys || customApiKey);
      if (availableKeys.length === 0) {
        res.status(500).json({
          error: 'Nta Gemini API key yabonetse. Nyamuneka yishyireho muri Settings > Secrets panel.',
        });
        return;
      }

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

      const safeUserName = typeof userName === 'string' && userName.trim() ? userName.trim() : 'Incuti yanjye';
      const usernameContext = `The person currently chatting with you is named '${safeUserName}'. Always address them politely by their name during the conversation to make it personal and natural.`;
      const customInstructionsContext = typeof customInstructions === 'string' && customInstructions.trim()
        ? `USER CUSTOM INSTRUCTIONS:\n${customInstructions.trim()}\nFollow these instructions in addition to the core Kevin AI persona, without ignoring the creator profile, language fluency, real-time context, or other system requirements.`
        : '';
      const audioInstruction = hasAudioAttachment
        ? `[KINYARWANDA VOICE NOTE & AUDIO COMPREHENSION]:
- The user sent a recorded voice message in audio format (most commonly spoken in native Rwandan Kinyarwanda, or Kinyarwanda mixed with French/English).
- ALWAYS listen directly to the attached raw audio recording as your PRIMARY source of truth—even if a preliminary text transcript draft is also provided. If the preliminary transcript misheard any Kinyarwanda word, prefix, Rwandan name, or command, trust what you hear in the raw audio!
- Pay close attention to authentic Kinyarwanda phonetics, prefixes, consonant clusters, and Rwandan names without mishearing Kinyarwanda speech as unrelated English words.
- CRITICAL ANTI-WRONG-ACTION GUARDRAIL: NEVER execute or call any device tool (make_call, send_sms, open_whatsapp, open_youtube, scan_whatsapp_chats, configure_whatsapp_autoreply, open_camera, open_app) UNLESS the user's voice message explicitly and unmistakably commanded that exact action in the audio.
- If the audio is a greeting, a normal question, or a conversation, DO NOT trigger any tool — reply naturally in fluent, authentic Kinyarwanda. If the audio is completely silent or unintelligible, politely ask them in Kinyarwanda to repeat clearly.
- NEVER invent a phone number, contact name, song, or message that was not clearly spoken.`
        : '';
      const latestUserText = Array.isArray(contents) && contents.length > 0
        ? ((contents[contents.length - 1] as any)?.parts || [])
            .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
            .join(' ')
            .trim()
        : '';
      const needsContacts = Boolean(hasAudioAttachment) || /(?:hamagar|terefon|oherez)|\b(call|dial|sms|message|ubutumwa|send|whatsapp|wa|contact|nimero|number)\b/i.test(latestUserText);
      const userQueryTokens = latestUserText
        .toLowerCase()
        .split(/\s+/)
        .filter((t: string) => t.length >= 2);
      const filteredContacts = needsContacts && Array.isArray(savedContacts)
        ? savedContacts.filter((c) => c && typeof c.name === 'string' && typeof c.phone === 'string' && c.name.trim() && c.phone.trim())
        : [];
      const prioritizedContacts = userQueryTokens.length > 0
        ? [
            ...filteredContacts.filter((c) => {
              const nm = c.name!.toLowerCase();
              const ph = c.phone!.replace(/[^\d]/g, '');
              return userQueryTokens.some((tok: string) => nm.includes(tok) || (ph && ph.includes(tok)));
            }),
            ...filteredContacts.filter((c) => {
              const nm = c.name!.toLowerCase();
              const ph = c.phone!.replace(/[^\d]/g, '');
              return !userQueryTokens.some((tok: string) => nm.includes(tok) || (ph && ph.includes(tok)));
            }),
          ]
        : filteredContacts;
      const contactsList = prioritizedContacts
        .slice(0, 60)
        .map((c) => `${c.name!.trim()}: ${c.phone!.trim()}`);
      const contactsContext = contactsList.length > 0
        ? `[SAVED CONTACTS (${contactsList.length}): ${contactsList.join(' | ')}]`
        : '';
      const waPausedRemainingMin = Boolean(agentPermissions?.whatsappAutoReply)
        && Number(agentPermissions?.whatsappAutoReplyPausedUntil || 0) > Date.now()
        ? Math.max(1, Math.ceil((Number(agentPermissions?.whatsappAutoReplyPausedUntil || 0) - Date.now()) / 60_000))
        : 0;
      const agentContext = `[AGENT PERMISSIONS: autoSend=${Boolean(agentPermissions?.autoSend)}, autoCall=${agentPermissions?.autoCall !== false}, autoPlayYouTube=${agentPermissions?.autoPlayYouTube !== false}, whatsappAutoReply=${Boolean(agentPermissions?.whatsappAutoReply)}, whatsappAutoReplyPaused=${waPausedRemainingMin > 0}${waPausedRemainingMin > 0 ? ` (${waPausedRemainingMin} min remaining)` : ''}. Execute device tool calls ONLY when explicitly and clearly requested by the user.]`;

      const systemInstruction = [
        KEVIN_SYSTEM_INSTRUCTION,
        usernameContext,
        customInstructionsContext,
        audioInstruction,
        contactsContext,
        agentContext,
        realTimeContext,
      ].filter(Boolean).join('\n\n');

      const sanitizedContents: any[] = [];
      for (const turn of (contents as any[])) {
        if (!turn || !Array.isArray(turn.parts) || turn.parts.length === 0) continue;
        const role = turn.role === 'model' ? 'model' : 'user';
        const firstText = String(turn.parts[0]?.text || '').trim();
        if (role === 'model' && (
          firstText.startsWith('⚠️')
          || firstText.startsWith('🔑 Nta Gemini API Key')
          || firstText.startsWith('Mbabarira, habaye ikibazo')
        )) {
          continue;
        }
        if (sanitizedContents.length === 0 && role !== 'user') continue;
        const prev = sanitizedContents[sanitizedContents.length - 1];
        if (prev && prev.role === role) {
          prev.parts = [...prev.parts, ...turn.parts];
        } else {
          sanitizedContents.push({ role, parts: turn.parts });
        }
      }
      const effectiveContents = sanitizedContents.length > 0 ? sanitizedContents : (contents as any[]);

      let lastErr: unknown = null;
      const chatModelErrors: string[] = [];
      let streamStarted = false;
      const isExplicitDeviceCommand = /(?:hamagar|terefon|oherez|curang|subiriz|budasubij|indirimbo|auto[\s_-]*reply)|\b(call|dial|sms|send|whatsapp|youtube|play|song|music|audiomack|lark|kamera|camera|fungura|funga|hagarika|pause|stop|resume|subukura|open|instagram|tiktok|spotify|maps|subiza|unread)\b/i.test(latestUserText);
      const isAmakuruGreeting = /^(?:amakuru\s*(?:ki|yawe|yanyu|meza|ni\s*meza|gute)?|bite\s*(?:se)?|muraho|mwaramutse|mwiriwe)[\s?!.,]*$/i.test(latestUserText);
      const shouldTryWebSearch = Boolean(
        latestUserText
        && !hasAudioAttachment
        && !isExplicitDeviceCommand
        && !isAmakuruGreeting
        && /\b(news|amakuru|agezweho|bigezweho|ibigezweho|mashya|masha|weather|iteganyagihe|forecast|meteo|météo|score|scores|match|matches|umukino|imikino|results|standings|table|ranking|amanota|shampiyona|champiyona|premier league|champions league|la liga|afcon|world cup|price|igiciro|ibiciro|dollar|idorari|exchange rate|bitcoin|crypto|latest|recent|recently|update|updates|breaking|headlines|trending|tonight|last night|internet|google|search|shaka|online|live|president|perezida|minister|minisiteri|minisitiri|winner|who won|watsinze|yatsinze|batsinze|mancity|man city|manutd|man utd|arsenal|chelsea|liverpool|real madrid|barcelona|rayon|apr|kiyovu|mukura|amavubi|actualites|actualités|nouvelles|igihe|kigalitoday|rba|bbc)\b/i.test(latestUserText)
      );
      const modelsToTry = hasAudioAttachment
        ? ['gemini-4-hydrogen', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash']
        : shouldTryWebSearch
          ? ['gemini-3.5-flash-lite', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-2.5-flash']
          : selectedModel === 'Prodix pro'
            ? ['gemini-4-hydrogen', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash']
            : selectedModel === 'Kevin 1.3 Lite'
              ? ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-4-hydrogen', 'gemini-2.5-flash']
              : ['gemini-3.5-flash-lite', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];

      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const firstModelTimeoutMs = shouldTryWebSearch ? 5000 : (hasAudioAttachment ? 10500 : 6500);

      const ensureStreamHeaders = () => {
        if (!streamStarted && !res.headersSent) {
          res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          streamStarted = true;
        }
      };

      const writePayloadChunk = async (functionCalls: any[], textChunk?: string) => {
        for (const functionCall of functionCalls) {
          const args = { ...(functionCall.args || {}) };
          if (functionCall.name === 'open_app' && String(args.app_name || '').toLowerCase().includes('google search')) {
            continue;
          }
          if (functionCall.name === 'make_call' || functionCall.name === 'send_sms' || functionCall.name === 'open_whatsapp') {
            const p = String(args.phone_number || '').trim();
            const n = String(args.contact_name || '').trim();
            if ((!p && !n) || /^(unknown|someone|anybody|none)$/i.test(n)) {
              continue;
            }
          }
          if (functionCall.name === 'open_youtube' && typeof args.query === 'string' && args.query.trim()) {
            const resolved = await resolveYouTubeVideo(args.query);
            if (resolved) {
              args.videoId = resolved.videoId;
              args.videoTitle = resolved.title;
              args.channel = resolved.channel;
            }
          }
          ensureStreamHeaders();
          res.write(JSON.stringify({
            type: 'action',
            name: functionCall.name,
            args,
          }) + '\n');
        }
        if (textChunk) {
          ensureStreamHeaders();
          res.write(JSON.stringify({
            type: 'text',
            text: textChunk,
          }) + '\n');
        }
      };

      const invalidKeys = new Set<string>();
      const phases: Array<'search' | 'rss_text' | 'device'> = shouldTryWebSearch
        ? ['search', 'rss_text']
        : ['device'];

      let rssCache: { contextText: string; sources: Array<{ title: string; url: string }> } | null = null;
      if (shouldTryWebSearch) {
        rssCache = await fetchLiveWebSearchContext(latestUserText).catch(() => ({ contextText: '', sources: [] }));
      }

      for (const phase of phases) {
        let phaseContents = effectiveContents;
        let phaseSources: Array<{ title: string; url: string }> = [];

        if (phase === 'rss_text') {
          if (!rssCache) {
            rssCache = await fetchLiveWebSearchContext(latestUserText);
          }
          if (rssCache.contextText) {
            phaseSources = rssCache.sources;
            phaseContents = [
              ...effectiveContents.slice(0, -1),
              {
                role: 'user',
                parts: [
                  ...((effectiveContents[effectiveContents.length - 1] as any)?.parts || []),
                  { text: `\n\n${rssCache.contextText}` },
                ],
              },
            ];
          }
        } else if (phase === 'search' && rssCache?.contextText) {
          phaseSources = rssCache.sources;
          phaseContents = [
            ...effectiveContents.slice(0, -1),
            {
              role: 'user',
              parts: [
                ...((effectiveContents[effectiveContents.length - 1] as any)?.parts || []),
                { text: `\n\n${rssCache.contextText}` },
              ],
            },
          ];
        }

        const phaseModels = phase === 'rss_text'
          ? (selectedModel === 'Prodix pro'
              ? ['gemini-4-hydrogen', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash']
              : ['gemini-3.5-flash-lite', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'])
          : modelsToTry;

        let jumpToNextPhase = false;
        for (const modelName of phaseModels) {
          if (jumpToNextPhase) break;
          const hasFallbackModel = modelName !== phaseModels[phaseModels.length - 1];
          const modelThinkingConfig = modelName === 'gemini-4-hydrogen'
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : modelName.startsWith('gemini-2.5-')
              ? { thinkingConfig: { thinkingBudget: selectedModel === 'Prodix pro' ? 512 : 0 } }
              : {};

          for (let keyIdx = 0; keyIdx < availableKeys.length; keyIdx++) {
            const key = availableKeys[keyIdx];
            if (invalidKeys.has(key)) continue;

            const ai = new GoogleGenAI({
              apiKey: key,
              httpOptions: {
                apiVersion: 'v1beta',
                headers: {
                  'User-Agent': 'aistudio-build',
                },
              },
            });

            const isLastAttemptOverall = (phase === phases[phases.length - 1])
              && !hasFallbackModel
              && keyIdx === availableKeys.length - 1;
            const maxAttempts = isLastAttemptOverall ? 2 : 1;
            let abortModelLoop = false;

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
              const seenSourceUrls = new Set<string>();
              const collectedSources: Array<{ title: string; url: string }> = [];
              for (const ps of phaseSources) {
                if (ps.url && !seenSourceUrls.has(ps.url)) {
                  seenSourceUrls.add(ps.url);
                  collectedSources.push(ps);
                }
              }
              let accumulatedText = '';
              try {
                const bufferedSearchChunks: Array<{ functionCalls: any[]; textChunk?: string }> = [];

                const consumeStream = async (toolMode: 'search' | 'device' | 'none') => {
                  const streamPromise = ai.models.generateContentStream({
                    model: modelName,
                    contents: phaseContents as any,
                    config: {
                      systemInstruction,
                      ...(toolMode === 'search'
                        ? { tools: [{ googleSearch: {} }] }
                        : toolMode === 'device'
                          ? { tools: [{ functionDeclarations: deviceActionDeclarations }] }
                          : {}),
                      ...modelThinkingConfig,
                    },
                  });
                  streamPromise.catch(() => {});

                  const responseStream = !isLastAttemptOverall
                    ? await Promise.race([
                        streamPromise,
                        new Promise<never>((_, reject) =>
                          setTimeout(() => reject(new Error('503 Model response timed out during high demand')), firstModelTimeoutMs)
                        ),
                      ])
                    : await streamPromise;

                  for await (const chunk of responseStream) {
                    const functionCalls = (chunk as any).functionCalls || [];
                    const candidate = (chunk as any).candidates?.[0];
                    const gm = candidate?.groundingMetadata || (chunk as any).groundingMetadata;
                    const gChunks = gm?.groundingChunks || [];
                    for (const gc of gChunks) {
                      const uri = gc?.web?.uri || gc?.maps?.uri;
                      const title = gc?.web?.title || gc?.maps?.title || uri;
                      if (uri && !seenSourceUrls.has(uri)) {
                        seenSourceUrls.add(uri);
                        collectedSources.push({ title, url: uri });
                      }
                    }
                    if (chunk.text) {
                      accumulatedText += chunk.text;
                    }
                    if (phase === 'search') {
                      bufferedSearchChunks.push({ functionCalls, textChunk: chunk.text });
                    } else {
                      await writePayloadChunk(functionCalls, chunk.text);
                    }
                  }
                };

                if (phase === 'search') {
                  await consumeStream('search');
                } else if (phase === 'rss_text') {
                  await consumeStream('none');
                } else {
                  await consumeStream('device');
                  if (!streamStarted && !accumulatedText.trim()) {
                    await consumeStream('none');
                  }
                }

                if (collectedSources.length === 0 && accumulatedText) {
                  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
                  let match;
                  while ((match = linkRegex.exec(accumulatedText)) !== null) {
                    const title = match[1].trim();
                    const url = match[2].trim();
                    if (url && !seenSourceUrls.has(url) && !url.includes('image.pollinations.ai') && !url.includes('localhost')) {
                      seenSourceUrls.add(url);
                      collectedSources.push({ title, url });
                    }
                  }
                }

                // If Google Search phase returned ungrounded stale text with zero sources, fall through to rss_text instead of flushing stale data
                if (phase === 'search' && collectedSources.length === 0) {
                  throw new Error('UNGROUNDED_SEARCH_FALLBACK_TO_RSS');
                }

                if (phase === 'search' && bufferedSearchChunks.length > 0) {
                  for (const item of bufferedSearchChunks) {
                    await writePayloadChunk(item.functionCalls, item.textChunk);
                  }
                }

                if (collectedSources.length > 0) {
                  ensureStreamHeaders();
                  res.write(JSON.stringify({ type: 'sources', sources: collectedSources }) + '\n');
                }

                ensureStreamHeaders();
                res.write(JSON.stringify({ type: 'done' }) + '\n');
                res.end();
                return;
              } catch (error: any) {
                lastErr = error;
                const errorText = extractReadableError(error);
                chatModelErrors.push(`${modelName}: ${errorText}`);
                const rawText = error instanceof Error ? error.message : String(error);
                const combinedText = `${rawText} ${errorText}`;
                const isRotateKeyError = shouldRotateApiKey(error, combinedText);
                const isUnavailableError = error?.status === 503
                  || combinedText.includes('503')
                  || combinedText.includes('UNAVAILABLE')
                  || combinedText.toLowerCase().includes('high demand')
                  || combinedText.toLowerCase().includes('overloaded');
                const isModelNotFound = error?.status === 404
                  || combinedText.includes('404')
                  || combinedText.includes('NOT_FOUND')
                  || combinedText.toLowerCase().includes('no longer available');

                if (streamStarted) {
                  if (isUnavailableError && accumulatedText.trim()) {
                    const continuePromptText = `Your previous reply was interrupted mid-sentence by a temporary connection drop. Continue seamlessly from the EXACT character where it stopped (do NOT repeat any words already written below, do NOT apologize or mention the interruption):\n\n[ALREADY SENT]:\n${accumulatedText}`;
                    const lastTurnParts = Array.isArray((phaseContents[phaseContents.length - 1] as any)?.parts)
                      ? (phaseContents[phaseContents.length - 1] as any).parts
                      : [{ text: latestUserText }];
                    const continuationContents = [
                      ...phaseContents.slice(0, -1),
                      {
                        role: 'user',
                        parts: [...lastTurnParts, { text: `\n\n${continuePromptText}` }],
                      },
                    ];
                    const midRescueModels = Array.from(new Set(['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-4-hydrogen'])).slice(0, 2);
                    for (const rescueModel of midRescueModels) {
                      try {
                        const rescuePromise = ai.models.generateContent({
                          model: rescueModel,
                          contents: continuationContents as any,
                          config: {
                            systemInstruction,
                            ...(rescueModel === 'gemini-4-hydrogen'
                              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                              : rescueModel.startsWith('gemini-2.5-')
                                ? { thinkingConfig: { thinkingBudget: 0 } }
                                : {}),
                          },
                        });
                        rescuePromise.catch(() => {});
                        const rescueRes = await Promise.race([
                          rescuePromise,
                          new Promise<never>((_, reject) =>
                            setTimeout(() => reject(new Error('503 Mid-stream rescue timed out')), 5000)
                          ),
                        ]);
                        const contText = rescueRes.text || '';
                        if (contText.trim()) {
                          // Strip accidental overlap if model repeated the tail of accumulatedText
                          const tail = accumulatedText.slice(-30);
                          const overlapIdx = tail.length >= 6 ? contText.indexOf(tail) : -1;
                          const cleanCont = overlapIdx >= 0 ? contText.slice(overlapIdx + tail.length) : contText;
                          if (cleanCont) {
                            await writePayloadChunk([], cleanCont);
                          }
                          if (collectedSources.length > 0) {
                            ensureStreamHeaders();
                            res.write(JSON.stringify({ type: 'sources', sources: collectedSources }) + '\n');
                          }
                          ensureStreamHeaders();
                          res.write(JSON.stringify({ type: 'done' }) + '\n');
                          res.end();
                          return;
                        }
                      } catch {
                        // try next mid-stream rescue model
                      }
                    }
                  }
                  res.write(JSON.stringify({ type: 'error', error: errorText }) + '\n');
                  res.end();
                  return;
                }

                if (phase === 'search') {
                  console.warn(`[Search Phase] ${modelName} key #${keyIdx + 1} failed (${errorText}). Falling through...`);
                  if (isInvalidApiKeyError(error, combinedText)) {
                    invalidKeys.add(key);
                    break;
                  }
                  // Jump straight to rss_text instead of burning 4 models x timeout on Google Search tool
                  jumpToNextPhase = true;
                  abortModelLoop = true;
                  break;
                }

                if (isInvalidApiKeyError(error, combinedText)) {
                  console.warn(`[Chat Key Rotation] Key #${keyIdx + 1} invalid (${errorText}). Skipping key and rotating...`);
                  invalidKeys.add(key);
                  break;
                }

                if (isRotateKeyError) {
                  console.warn(`[Chat Key Rotation] Key #${keyIdx + 1} hit quota/rate-limit on ${modelName}. Rotating...`);
                  break;
                }

                if (isModelNotFound) {
                  console.warn(`Model ${modelName} not found, falling back to next model.`);
                  abortModelLoop = true;
                  break;
                }

                if (isUnavailableError) {
                  console.warn(`Model ${modelName} unavailable/high demand (attempt ${attempt + 1}, key #${keyIdx + 1}).`);
                  if (!isLastAttemptOverall) {
                    break;
                  }
                  if (attempt === 0) {
                    await sleep(450);
                    continue;
                  }
                  // Try bounded non-streaming generateContent rescue across reliable GA fallback models
                  const rescueModels = Array.from(new Set([modelName, 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']));
                  for (const rescueModel of rescueModels) {
                    try {
                      const fallbackPromise = ai.models.generateContent({
                        model: rescueModel,
                        contents: phaseContents as any,
                        config: {
                          systemInstruction,
                          ...(phase === 'device' ? { tools: [{ functionDeclarations: deviceActionDeclarations }] } : {}),
                          ...(rescueModel === 'gemini-4-hydrogen'
                            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                            : rescueModel.startsWith('gemini-2.5-')
                              ? { thinkingConfig: { thinkingBudget: 0 } }
                              : {}),
                        },
                      });
                      fallbackPromise.catch(() => {});
                      const fallbackRes = await Promise.race([
                        fallbackPromise,
                        new Promise<never>((_, reject) =>
                          setTimeout(() => reject(new Error('503 Fallback timed out')), 8000)
                        ),
                      ]);
                      const fallbackCalls = (fallbackRes as any).functionCalls || [];
                      const fallbackText = fallbackRes.text || '';
                      if (fallbackCalls.length > 0 || fallbackText) {
                        await writePayloadChunk(fallbackCalls, fallbackText);
                        const fallbackCandidate = (fallbackRes as any).candidates?.[0];
                        const fallbackGm = fallbackCandidate?.groundingMetadata || (fallbackRes as any).groundingMetadata;
                        const fallbackGChunks = fallbackGm?.groundingChunks || [];
                        const fallbackSources: Array<{ title: string; url: string }> = [...phaseSources];
                        const seenUrls = new Set<string>(phaseSources.map(s => s.url));
                        for (const gc of fallbackGChunks) {
                          const uri = gc?.web?.uri || gc?.maps?.uri;
                          const title = gc?.web?.title || gc?.maps?.title || uri;
                          if (uri && !seenUrls.has(uri)) {
                            seenUrls.add(uri);
                            fallbackSources.push({ title, url: uri });
                          }
                        }
                        if (fallbackSources.length === 0 && fallbackText) {
                          const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
                          let match;
                          while ((match = linkRegex.exec(fallbackText)) !== null) {
                            const title = match[1].trim();
                            const url = match[2].trim();
                            if (url && !seenUrls.has(url) && !url.includes('image.pollinations.ai') && !url.includes('localhost')) {
                              seenUrls.add(url);
                              fallbackSources.push({ title, url });
                            }
                          }
                        }
                        if (fallbackSources.length > 0) {
                          ensureStreamHeaders();
                          res.write(JSON.stringify({ type: 'sources', sources: fallbackSources }) + '\n');
                        }
                        ensureStreamHeaders();
                        res.write(JSON.stringify({ type: 'done' }) + '\n');
                        res.end();
                        return;
                      }
                    } catch (fallbackErr: any) {
                      lastErr = fallbackErr;
                    }
                  }
                  break;
                }

                throw error;
              }
            }
            if (abortModelLoop) break;
          }
        }
      }

      if (!res.headersSent) {
        console.error('All /api/chat models failed:', chatModelErrors);
        res.status(500).json({ error: chatModelErrors.join(' | ') || extractReadableError(lastErr) });
      }
    } catch (error: any) {
      console.error('Server /api/chat error:', error);
      const message = extractReadableError(error);
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      } else {
        res.write(JSON.stringify({ type: 'error', error: message }) + '\n');
        res.end();
      }
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.use((_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Kevin AI server listening on http://0.0.0.0:${PORT}`);

    // Self-ping interval (every 9 minutes / 540,000 ms) to prevent Render free instance from sleeping
    const PING_INTERVAL_MS = 9 * 60 * 1000;
    const pingTargetUrl = process.env.RENDER_EXTERNAL_URL
      ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/api/health`
      : `http://localhost:${PORT}/api/health`;

    setInterval(async () => {
      try {
        const pingRes = await fetch(pingTargetUrl);
        if (pingRes.ok) {
          console.log(`[Self-Ping] Keeping server awake... (${pingTargetUrl})`);
        } else {
          console.warn(`[Self-Ping] Ping status: ${pingRes.status}`);
        }
      } catch (pingErr) {
        console.warn('[Self-Ping] Error:', pingErr instanceof Error ? pingErr.message : String(pingErr));
      }
    }, PING_INTERVAL_MS);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
