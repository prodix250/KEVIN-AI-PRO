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
  * Listen attentively to the audio in Kinyarwanda or English.
  * Understand natural Rwandan pronunciation, fast speech, local accents, and conversational phrasing.
  * Understand names of Rwandan people (Kevin, Aline, Helve, Kelly, Barame, Jean, Patrick, etc.), Rwandan places (Kigali, Rwamagana, Gahengeri, Huye, Musanze, Rubavu, etc.), and Rwandan musicians/artists (Meddy, Bruce Melodie, The Ben, Element, Juno Kizigenza, Chriss Eazy, etc.).
  * Respond directly, helpfully, and naturally in Kinyarwanda (or English), and immediately execute any requested device actions (open_youtube, make_call, send_sms, open_whatsapp).

5. MULTIMODAL & DOCUMENT ANALYSIS:
- Images/Vision: When the user attaches an image or screenshot, analyze what you see thoroughly (diagrams, OCR code reading, objects).
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
- Direct WhatsApp Sending: When the user explicitly asks to send or reply on WhatsApp (e.g., 'ohereza kuri whatsapp ya...', 'subiza kuri whatsapp...'), ALWAYS call open_whatsapp(phone_number, message, contact_name) immediately. For phone numbers in Rwanda, ensure the country code +250 is used (e.g. +250788123456 or 250788123456 instead of 0788123456) so WhatsApp can deliver the message immediately without missing country code errors.
- WhatsApp Auto-Reply Mode: When the user asks you to automatically reply to incoming WhatsApp messages on their behalf (e.g., 'ujye unsubiriza kuri whatsapp', 'enable whatsapp auto reply'), ALWAYS call configure_whatsapp_autoreply(enabled, reply_style).
- Calls & Other Apps: Use make_call, open_audiomack, open_lark_player, open_camera, or open_app immediately whenever requested.`;

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
    description: "Enable or disable automatic AI replying to incoming WhatsApp messages, and optionally set reply style instructions.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        enabled: { type: "boolean", description: "Whether WhatsApp auto-reply should be enabled." },
        reply_style: { type: "string", description: "Instructions for how Kevin AI should reply on WhatsApp." }
      },
      required: ["enabled"]
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

async function fetchLiveWebSearchContext(rawQuery: string): Promise<{
  contextText: string;
  sources: Array<{ title: string; url: string }>;
}> {
  const cleanQuery = buildCleanWebSearchQuery(rawQuery);
  if (!cleanQuery) return { contextText: '', sources: [] };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(cleanQuery)}&hl=en&gl=US&ceid=US:en`;
    const response = await fetch(rssUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });
    clearTimeout(timer);
    if (!response.ok) return { contextText: '', sources: [] };
    const xml = await response.text();
    const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 6);
    const items: Array<{ title: string; url: string; pubDate: string; sourceName: string }> = [];

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

    if (items.length === 0) return { contextText: '', sources: [] };

    const lines = items.map((it, idx) =>
      `${idx + 1}. "${it.title}"${it.sourceName ? ` (${it.sourceName})` : ''}${it.pubDate ? ` [${it.pubDate}]` : ''} — ${it.url}`
    );
    const contextText = `[LIVE INTERNET NEWS & WEB SEARCH RESULTS FOR "${cleanQuery}"]:\nUse these verified, up-to-date real-time articles below to answer the user's question accurately in their language. Do NOT say you lack live internet access — summarize the latest developments directly from these current articles:\n${lines.join('\n')}`;
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

      const mimeType = (audioMimeType || altMimeType || 'audio/webm').split(';')[0].trim().toLowerCase();
      const availableKeys = getServerApiKeys(customApiKeys || customApiKey);
      if (availableKeys.length === 0) {
        res.status(500).json({ error: 'Nta Gemini API key yabonetse.' });
        return;
      }

      const sttModels = ['gemini-3.5-transcribe', 'gemini-3.1-flash-lite', 'gemini-4-hydrogen'];
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
                    text: `You are an expert native Rwandan speech recognition and transcription assistant specializing in Kinyarwanda, English, French, and Swahili.
Listen very carefully to this audio recording:
1. If the speaker is speaking in Kinyarwanda, transcribe verbatim in standard, authentic Kinyarwanda orthography (intego y'imyandikire y'Ikinyarwanda).
   - Accurately recognize Rwandan words, phonemes, and phrasing (e.g., 'Amakuru', 'Bite', 'Muraho', 'Umeze ute', 'Curanga indirimbo...', 'Hamagara...', 'Ohereza ubutumwa...', 'Kora...', 'Shushanya...', 'Mbwira...').
2. If the speaker is speaking English, French, or Swahili, transcribe verbatim in that language.
3. Output ONLY the exact transcribed spoken words. Do NOT add preamble, quotes, explanations, or timestamps.
4. If there is only background silence, static, or no intelligible human speech, return strictly an empty string "".`,
                  },
                ],
              },
              ...(model === 'gemini-4-hydrogen'
                ? { config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } }
                : {}),
            });
            sttPromise.catch(() => {});

            const response = await Promise.race([
              sttPromise,
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('503 STT timed out')), 9000)
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
        `You are Kevin AI acting as ${ownerName}'s WhatsApp Auto-Reply Assistant.`,
        `Reply directly and naturally to the incoming WhatsApp message from "${sender || 'Contact'}".`,
        `Match the sender's language (Kinyarwanda, English, French, or Swahili).`,
        `Keep the reply concise, polite, helpful, and natural for WhatsApp (1-3 sentences max).`,
        `Do not say "As an AI..." — reply seamlessly on behalf of ${ownerName}.`,
        replyStyle?.trim() ? `Owner's Auto-Reply Instructions: ${replyStyle.trim()}` : '',
      ].filter(Boolean).join('\n');

      let lastErr: unknown = null;
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const invalidKeys = new Set<string>();
      const waModels = ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'];

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
              const reply = (response.text || '').trim();
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

      res.status(500).json({ error: extractReadableError(lastErr) });
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
        ? `[VOICE NOTE & AUDIO PROCESSING CONTEXT]:
- The user has sent a recorded voice note or voice message in audio format.
- You are an expert at listening to spoken Kinyarwanda, English, French, and Swahili with complete native comprehension.
- Listen attentively to their spoken words, Rwandan pronunciation, fast conversational speech, and intent.
- Respond directly, helpfully, and naturally in their spoken language (if spoken in Kinyarwanda, reply in authentic, fluent Kinyarwanda).
- If the user gave an action command (like playing a song on YouTube, calling someone, sending an SMS or WhatsApp message), immediately execute the corresponding tool function (open_youtube, make_call, send_sms, open_whatsapp).`
        : '';
      const contactsList = Array.isArray(savedContacts)
        ? savedContacts
            .filter((c) => c && typeof c.name === 'string' && typeof c.phone === 'string' && c.name.trim() && c.phone.trim())
            .slice(0, 40)
            .map((c) => `${c.name!.trim()}: ${c.phone!.trim()}`)
        : [];
      const contactsContext = contactsList.length > 0
        ? `[SAVED CONTACTS: ${contactsList.join(' | ')}]`
        : '';
      const agentContext = `[AGENT PERMISSIONS: autoSend=${Boolean(agentPermissions?.autoSend)}, autoCall=${agentPermissions?.autoCall !== false}, autoPlayYouTube=${agentPermissions?.autoPlayYouTube !== false}, whatsappAutoReply=${Boolean(agentPermissions?.whatsappAutoReply)}. Always execute requested actions immediately using tool calls.]`;

      const systemInstruction = [
        KEVIN_SYSTEM_INSTRUCTION,
        usernameContext,
        customInstructionsContext,
        audioInstruction,
        contactsContext,
        agentContext,
        realTimeContext,
      ].filter(Boolean).join('\n\n');

      let lastErr: unknown = null;
      let streamStarted = false;
      const latestUserText = Array.isArray(contents) && contents.length > 0
        ? ((contents[contents.length - 1] as any)?.parts || [])
            .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
            .join(' ')
            .trim()
        : '';
      const isExplicitDeviceCommand = /\b(hamagara|terefone|call|sms|ohereza|send|whatsapp|youtube|curanga|play|audiomack|lark|kamera|camera|fungura|open|instagram|tiktok|spotify|maps)\b/i.test(latestUserText);
      const shouldTryWebSearch = Boolean(
        latestUserText
        && !hasAudioAttachment
        && !isExplicitDeviceCommand
        && /\b(news|amakuru|agezweho|ubu|weather|score|match|price|current|latest|internet|google|search|shaka|online|live|today|president|minister|winner|who won|what happened|2025|2026|iteganyagihe|igiciro|umukino|ikipe|perezida|uri he|amakuru mashya|mancity|man city|arsenal|chelsea|liverpool|real madrid|barcelona|rayon|apr)\b/i.test(latestUserText)
      );
      const modelsToTry = shouldTryWebSearch
        ? ['gemini-2.5-flash', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite']
        : selectedModel === 'Prodix pro'
          ? ['gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-2.5-flash']
          : ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-4-hydrogen'];

      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const firstModelTimeoutMs = shouldTryWebSearch ? 12000 : (hasAudioAttachment ? 9500 : 5500);

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

      for (const phase of phases) {
        let phaseContents = contents as any[];
        let phaseSources: Array<{ title: string; url: string }> = [];

        if (phase === 'rss_text') {
          if (!rssCache) {
            rssCache = await fetchLiveWebSearchContext(latestUserText);
          }
          if (rssCache.contextText) {
            phaseSources = rssCache.sources;
            phaseContents = [
              ...(contents as any[]),
              { role: 'user', parts: [{ text: rssCache.contextText }] },
            ];
          }
        }

        const phaseModels = phase === 'rss_text'
          ? (selectedModel === 'Prodix pro'
              ? ['gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-2.5-flash']
              : ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-4-hydrogen'])
          : modelsToTry;

        for (const modelName of phaseModels) {
          const hasFallbackModel = modelName !== phaseModels[phaseModels.length - 1];
          const modelThinkingConfig = modelName === 'gemini-4-hydrogen'
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
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
              try {
                const seenSourceUrls = new Set<string>();
                const collectedSources: Array<{ title: string; url: string }> = [];
                for (const ps of phaseSources) {
                  if (ps.url && !seenSourceUrls.has(ps.url)) {
                    seenSourceUrls.add(ps.url);
                    collectedSources.push(ps);
                  }
                }
                let accumulatedText = '';

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
                    await writePayloadChunk(functionCalls, chunk.text);
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
                  || combinedText.includes('NOT_FOUND');

                if (streamStarted) {
                  res.write(JSON.stringify({ type: 'error', error: errorText }) + '\n');
                  res.end();
                  return;
                }

                if (phase === 'search') {
                  console.warn(`[Search Phase] ${modelName} key #${keyIdx + 1} failed (${errorText}). Trying next...`);
                  if (isInvalidApiKeyError(error, combinedText)) {
                    invalidKeys.add(key);
                  }
                  if (isModelNotFound) {
                    abortModelLoop = true;
                  }
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
                    await sleep(400);
                    continue;
                  }
                  // Try one bounded non-streaming generateContent call as final rescue
                  try {
                    const fallbackPromise = ai.models.generateContent({
                      model: modelName,
                      contents: phaseContents as any,
                      config: {
                        systemInstruction,
                        ...(phase === 'device' ? { tools: [{ functionDeclarations: deviceActionDeclarations }] } : {}),
                        ...modelThinkingConfig,
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
        res.status(500).json({ error: extractReadableError(lastErr) });
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
