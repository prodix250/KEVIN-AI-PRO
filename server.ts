import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, type FunctionDeclaration } from '@google/genai';
import { startDailyNewsScheduler, syncDueNewsBriefings } from './serverNewsScheduler';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KEVIN_SYSTEM_INSTRUCTION = `You are Izi AI,

1. IDENTITY & CREATOR PROFILE:
- Name: Izi AI
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
      'Ndi Izi AI, niteguye kugufasha mu buryo bwose! 💻✨'
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

3. MULTILINGUAL FLUENCY & 100% PER-TURN LANGUAGE SWITCHING:
- ALWAYS reply in the EXACT language of the user's LATEST message (100% match, zero exceptions).
- If the user writes or speaks in Kinyarwanda (even mixed with English/French tech words), reply 100% in rich, natural, authentic Kinyarwanda.
- If the user writes or speaks in English, reply 100% in clean, natural English.
- MID-CONVERSATION SWITCHING RULE: Even if earlier turns in the conversation history were in Kinyarwanda, as soon as the user sends a message in English, switch IMMEDIATELY and reply 100% in English. Likewise, if they switch from English to Kinyarwanda, switch IMMEDIATELY and reply 100% in Kinyarwanda.
- If the user writes or speaks French or Swahili, reply fluently in that language.

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
- YouTube Playback (Direct Autoplay): When the user asks to play a song or video on YouTube (e.g., 'fungura youtube uncurangire...', 'play ... on youtube'), ALWAYS call open_youtube(query) so the exact video starts playing immediately instead of just searching.
- Direct Calling & Contact Resolution: When the user asks to call someone or a phone number (e.g., 'hamagara 0788...', 'hamagara Aline', 'call Mom', 'terefone Jean'), ALWAYS call make_call(phone_number, contact_name) immediately. If the user gives a phone number, pass phone_number. If the user gives a contact name without a number, check [SAVED CONTACTS] in your context first—if found there, pass both phone_number and contact_name; if NOT in [SAVED CONTACTS], pass contact_name only and leave phone_number empty so the device resolves it from Contacts. NEVER invent or guess a phone number!
- Direct SMS Sending: When the user asks to send an SMS/text message (e.g., 'ohereza ubutumwa kuri 078...', 'send sms to Aline'), ALWAYS call send_sms(phone_number, message, contact_name) immediately (never tell the user to open their SMS app manually, and never invent a missing number).
- Direct WhatsApp Sending: When the user explicitly asks to send or reply on WhatsApp (e.g., 'ohereza kuri whatsapp ya...', 'subiza kuri whatsapp...'), ALWAYS call open_whatsapp(phone_number, message, contact_name) immediately. For phone numbers in Rwanda, ensure the country code +250 is used (e.g. +250788123456 or 250788123456 instead of 0788123456) so WhatsApp can deliver the message immediately without missing country code errors. In the 'message' parameter, write ONLY ONE single natural human message matching the user's/recipient's language — NEVER include dates, timestamps, sender names (like 'Kevin:'), or multiple repeated versions.
- WhatsApp Auto-Reply Mode: When the user asks you to enable, disable, stop, or pause WhatsApp auto-reply for a specific duration (e.g., 'ujye unsubiriza kuri whatsapp', 'hagarika gusubiza kuri whatsapp iminota 30', 'pause whatsapp auto-reply for 1 hour', 'funga auto reply'), ALWAYS call configure_whatsapp_autoreply(enabled, reply_style, pause_minutes).
- Check All WhatsApp Chats & Reply to Unreplied Messages: When the user asks you to check their WhatsApp chats and reply to unread/unreplied messages (e.g., 'reba muri whatsapp zanjye usubize ubutumwa budasubije', 'check all whatsapp chats and reply'), ALWAYS call scan_whatsapp_chats().
- Lark Player & Local Phone Music (100% Full Autonomous Control + Equalizer + Direct Autoplay):
  * You have 100% full autonomous access to Lark Player and all local audio songs, playlists, artists, albums, Equalizer settings, and playback controls on the user's phone.
  * When the user asks to open Lark Player, play a song/artist/album/all songs on Lark Player or local phone audio (e.g., 'fungura lark player', 'curanga ... kuri Lark Player', 'play ... on Lark Player', 'curanga indirimbo zo muri telefone'), ALWAYS call open_lark_player(..., action='play') immediately so it autoplays directly (never pass 'search' unless they explicitly asked only to search without playing).
  * Autonomous Equalizer Control inside Lark Player & AudioFX: You can enter Lark Player's Equalizer automatically and configure everything without user taps! Use open_lark_player with action='equalizer' (or 'set_equalizer' / 'toggle_equalizer' / 'bass_boost') and pass eq_enabled (true/false), eq_preset (Normal, Classical, Dance, Flat, Folk, Heavy Metal, Hip Hop, Jazz, Pop, Rock, Custom, Bass Boost, Vocal, Acoustic, Electronic, R&B), bass_boost (0-100), virtualizer (0-100), reverb (None, Small Room, Medium Room, Large Room, Medium Hall, Large Hall, Plate), loudness (0-100), and eq_bands ([60Hz, 230Hz, 910Hz, 3.6kHz, 14kHz] in 0-100% or -15..+15 dB). If the user asks to configure equalizer, bass boost, 3D surround, reverb, or sound preset without specifying an app, default to open_lark_player(..., action='equalizer').
  * You can do EVERYTHING inside Lark Player via open_lark_player: play/search songs, pause/resume/toggle/stop/next/previous/seek, volume_up/volume_down/set_volume/mute/unmute, create_playlist (with optional songs array), add_to_playlist, play_playlist, delete_playlist, list_playlists/list_artists/list_albums/list_folders/list_songs, shuffle/play_all/shuffle_all, repeat/loop, favorite/like, equalizer/set_equalizer/toggle_equalizer/bass_boost, sleep_timer, lyrics, queue/add_to_queue/play_next, open_tab (songs/playlists/artists/albums/folders/videos/downloads/settings), share, ringtone, speed, and now_playing.
  * When the user asks to list local songs or browse library, call query_device_music(query) or open_lark_player(..., action='list_songs').
- Audiomack (100% Full Control + Direct Autoplay + Equalizer):
  * You have 100% full autonomous access to Audiomack for streaming, searching, and managing music.
  * When the user asks to play a song/artist/album/mixtape/trending track on Audiomack (e.g. 'fungura audiomack', 'curanga ... kuri audiomack', 'play ... on audiomack'), ALWAYS call open_audiomack(query, song_title, artist, playlist_name, action='play') immediately so it opens and autoplays directly!
  * You can perform ALL Audiomack actions via open_audiomack: open, play, search, create_playlist, add_to_playlist, play_playlist, list_playlists, download, favorite (like), repost, follow, queue, add_to_queue, play_next, pause, resume, toggle, stop, next, previous, fast_forward, rewind, seek, shuffle, repeat, equalizer, set_equalizer, toggle_equalizer, bass_boost, sleep_timer, lyrics, share, open_tab (home, feed, trending, search, library, playlists, downloads, favorites, offline), volume_up, volume_down, set_volume, mute, unmute, now_playing.
- Calls & Other Apps: Use make_call, open_camera, or open_app ONLY when explicitly requested by the user (never guess or fabricate targets when uncertain).`;

type ServerTurnDetectedLanguage = 'rw' | 'en' | 'fr' | 'sw' | 'auto';

function detectServerTurnLanguage(rawText: string): ServerTurnDetectedLanguage {
  const cleaned = String(rawText || '')
    .replace(/\[PRELIMINARY STT DRAFT[^\]]*\]:/gi, '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .trim();
  if (!cleaned) return 'auto';

  const lower = cleaned.toLowerCase();

  if (/(?:\b(?:in|into|to|speak|reply\s+in|answer\s+in|write\s+in|explain\s+in|switch\s+to)\s+english\b|\b(?:mu|muri|vuga|subiza\s+mu)\s*(?:i)?cyongereza\b|\bmuri\s+english\b)/i.test(lower)) {
    return 'en';
  }
  if (/(?:\b(?:in|into|to|speak|reply\s+in|answer\s+in|write\s+in|explain\s+in|switch\s+to)\s+kinyarwanda\b|\b(?:mu|muri|vuga|subiza\s+mu)\s*(?:i)?kinyarwanda\b)/i.test(lower)) {
    return 'rw';
  }
  if (/(?:\b(?:in|into|to|en|speak|reply\s+in)\s+(?:french|français|francais)\b|\b(?:mu|muri)\s*(?:i)?gifaransa\b)/i.test(lower)) {
    return 'fr';
  }
  if (/(?:\b(?:in|into|to|kwa|speak|reply\s+in)\s+(?:swahili|kiswahili)\b|\b(?:mu|muri)\s*(?:i)?giswahili\b)/i.test(lower)) {
    return 'sw';
  }

  const rwExactWords = new Set([
    'muraho', 'amakuru', 'bite', 'mwaramutse', 'mwiriwe', 'ijoro', 'urakoze', 'wakoze', 'murakoze', 'mwakoze',
    'yego', 'oya', 'ntabwo', 'nta', 'ntacyo', 'ndabona', 'ndumva', 'nshaka', 'ndashaka', 'nkunda', 'ndakunda',
    'mbwira', 'mfasha', 'sobanura', 'kora', 'nkorera', 'unkorere', 'subiza', 'vuga', 'soma', 'andika', 'fungura',
    'funga', 'hamagara', 'ohereza', 'curanga', 'shushanya', 'reka', 'dore', 'ngaho', 'nyamuneka', 'bimeze',
    'umeze', 'meze', 'muri', 'kuri', 'kuva', 'kugera', 'kubera', 'kugira', 'ngo', 'kandi', 'cyangwa', 'ariko',
    'ubwo', 'rero', 'rwose', 'cyane', 'neza', 'gusa', 'byose', 'hose', 'bose', 'abantu', 'umuntu', 'ikintu',
    'ibintu', 'iki', 'inde', 'nde', 'ryari', 'hehe', 'gute', 'kuki', 'uko', 'niba', 'ko', 'ari', 'hari',
    'yanjye', 'yawe', 'yanje', 'wanjye', 'wawe', 'byanjye', 'byawe', 'icyo', 'ibyo', 'iyo', 'aho', 'ikihe',
    'iyihe', 'ibihe', 'amafranga', 'amafaranga', 'ifoto', 'indirimbo', 'ubutumwa', 'ikibazo', 'igisubizo',
    'porogaramu', 'ikoranabuhanga', 'cyiza', 'mwiza', 'nziza', 'meza', 'byiza', 'mfite', 'ufite', 'afite',
    'dufite', 'mufite', 'bafite', 'ndi', 'uri', 'turi', 'bari', 'nzi', 'sinzi', 'uzi', 'ntuzi', 'azi', 'tuzi',
    'ndimo', 'urimo', 'arimo', 'turimo', 'murimo', 'barimo', 'ngomba', 'ugomba', 'agomba', 'tugomba', 'mugomba',
    'bagomba', 'nkeneye', 'ukeneye', 'akeneye', 'dukeneye', 'bakeneye', 'nakoze', 'yakoze', 'twakoze', 'bakoze',
    'nzakora', 'uzakora', 'azakora', 'tuzakora', 'wowe', 'jyewe', 'njye', 'twebwe', 'mwebwe', 'nawe', 'nanjye',
    'yanyu', 'yabo', 'ryawe', 'ryanjye', 'cyawe', 'cyanjye', 'byabo', 'nkaho', 'kuko', 'kugirango', 'kujya',
    'biri', 'ziri', 'kiri', 'hano', 'hariya', 'ejo', 'ubu', 'none', 'cyera', 'vuba', 'gato', 'rwanda',
  ]);
  const rwConnectors = new Set(['ni', 'na', 'ya', 'wa', 'za', 'ba', 'rya', 'cya', 'bya', 'kwa', 'mwa', 'twa']);
  const enExactWords = new Set([
    'the', 'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being', 'what', 'why', 'how', 'when', 'where',
    'who', 'which', 'whose', 'whom', 'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must',
    'do', 'does', 'did', 'have', 'has', 'had', 'this', 'that', 'these', 'those', 'with', 'from', 'into', 'onto',
    'about', 'between', 'through', 'during', 'before', 'after', 'because', 'although', 'however', 'therefore',
    'actually', 'really', 'very', 'please', 'thank', 'thanks', 'sorry', 'hello', 'hi', 'hey', 'good', 'morning',
    'afternoon', 'evening', 'night', 'today', 'tomorrow', 'yesterday', 'explain', 'describe', 'tell', 'show',
    'help', 'write', 'create', 'build', 'make', 'fix', 'give', 'need', 'want', 'like', 'know', 'think',
    'understand', 'mean', 'means', 'meaning', 'english', 'question', 'answer', 'example', 'examples', 'step',
    'steps', 'difference', 'compare', 'summary', 'summarize', 'translate', 'your', 'you', 'my', 'me', 'we',
    'us', 'they', 'them', 'their', 'our', 'his', 'her', 'its', 'there', 'here', 'not', "don't", "doesn't",
    "didn't", "won't", "can't", "couldn't", "shouldn't", "wouldn't", "isn't", "aren't", "what's", "how's",
    "it's", "i'm", "you're", "we're", "they're", 'yes', 'no', 'okay', 'sure', 'fine', 'great', 'nice',
    'if', 'and', 'or', 'but', 'for', 'of', 'to', 'in', 'on', 'at', 'as', 'an', 'i',
  ]);
  const frExactWords = new Set([
    'bonjour', 'salut', 'bonsoir', 'merci', 'comment', 'pourquoi', 'quand', 'avec', 'dans', 'pour', 'est',
    'sont', 'suis', 'nous', 'vous', 'ils', 'elles', 'mais', 'ou', 'donc', 'alors', 'oui', 'non', 'sil',
    "s'il", 'plait', 'plaît', 'parlez', 'francais', 'français', 'expliquer', 'ecrire', 'écrire', 'quel', 'quelle',
  ]);
  const swExactWords = new Set([
    'habari', 'mambo', 'jambo', 'shikamoo', 'asante', 'tafadhali', 'ndiyo', 'hapana', 'sawa', 'kwamba',
    'lakini', 'naomba', 'eleza', 'msaada', 'karibu', 'vipi', 'sasa', 'leo', 'kesho', 'jana', 'nini', 'kwanini',
  ]);

  const tokens = lower.split(/[\s,.;:!?()[\]{}"“”«»<>\\/]+/).filter(Boolean);
  let rwScore = 0;
  let enScore = 0;
  let frScore = 0;
  let swScore = 0;

  for (const tok of tokens) {
    if (rwExactWords.has(tok) || /^(?:nda|ndi|ntabwo|ntacyo|ntib|nshak|urakoz|wakoz|mwaram|mwiriw|mbwir|mfash|sobanur|fungur|oherez|hamagar|curang|shushany)/.test(tok)) {
      rwScore += 2;
    } else if (rwConnectors.has(tok)) {
      rwScore += 1;
    }
    if (enExactWords.has(tok)) {
      enScore += tok.length <= 2 ? 1 : 2;
    }
    if (frExactWords.has(tok)) {
      frScore += 2;
    }
    if (swExactWords.has(tok)) {
      swScore += 2;
    }
  }

  if (rwScore === 0 && enScore === 0 && frScore === 0 && swScore === 0) {
    return 'auto';
  }
  if (rwScore > 0 && rwScore >= enScore && rwScore >= frScore && rwScore >= swScore) {
    return 'rw';
  }
  if (enScore > rwScore && enScore >= frScore && enScore >= swScore) {
    return 'en';
  }
  if (frScore > rwScore && frScore > enScore && frScore >= swScore) {
    return 'fr';
  }
  if (swScore > rwScore && swScore > enScore && swScore > frScore) {
    return 'sw';
  }
  return 'auto';
}

function buildServerPerTurnLanguageDirective(lang: ServerTurnDetectedLanguage, hasAudioAttachment = false): string {
  if (lang === 'en') {
    return `[STRICT PER-TURN LANGUAGE LOCK: ENGLISH — MANDATORY OVERRIDE]
The user's LATEST message is in ENGLISH. Even if earlier turns in this conversation were in Kinyarwanda or another language, you MUST switch immediately and write 100% of your reply ONLY in clear, natural ENGLISH. Never reply in Kinyarwanda unless the user specifically asks for a Kinyarwanda translation/example.`;
  }
  if (lang === 'rw') {
    return `[STRICT PER-TURN LANGUAGE LOCK: KINYARWANDA — MANDATORY OVERRIDE]
Ubutumwa bwa NYUMA bw'ukoresha buri mu KINYARWANDA. Niyo ibiganiro byabanje byaba byari mu Cyongereza cyangwa urundi rurimi, UGOMBA guhita uhindura ugasubiza 100% mu KINYARWANDA cy'umwimerere gusa.`;
  }
  if (lang === 'fr') {
    return `[STRICT PER-TURN LANGUAGE LOCK: FRENCH — MANDATORY OVERRIDE]
The user's LATEST message is in FRENCH. Regardless of earlier conversation history, write 100% of your reply in natural FRENCH only.`;
  }
  if (lang === 'sw') {
    return `[STRICT PER-TURN LANGUAGE LOCK: SWAHILI — MANDATORY OVERRIDE]
The user's LATEST message is in SWAHILI. Regardless of earlier conversation history, write 100% of your reply in natural SWAHILI only.`;
  }
  return `[STRICT PER-TURN LANGUAGE MATCHING — MANDATORY]
Detect the EXACT language of the user's LATEST ${hasAudioAttachment ? 'voice audio or text message' : 'message'} ONLY and NEVER carry over a different language from previous turns:
- If the LATEST message is in Kinyarwanda (or Kinyarwanda mixed with tech words), reply 100% in authentic Rwandan Kinyarwanda.
- If the LATEST message is in English, switch immediately and reply 100% in natural English.
- If the LATEST message is in French or Swahili, reply 100% in that exact language.`;
}

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
    description: "Full control over Audiomack: open app, search/play songs directly (immediate autoplay), artists, albums or playlists, create/add/play playlists, download for offline, favorite/like, repost, follow artists, queue/play next, playback controls (pause, resume, next, previous, stop, seek, shuffle, repeat), full Equalizer control (eq_enabled, eq_preset, bass_boost, virtualizer, reverb, loudness, eq_bands), sleep timer, lyrics, share, tabs, volume, and now playing.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Song title, artist, album, playlist name, or search query for Audiomack." },
        song_title: { type: "string", description: "Exact song title to search, play, download, like, or add." },
        artist: { type: "string", description: "Artist name to search, play, or follow." },
        playlist_name: { type: "string", description: "Playlist name to create, update, or play on Audiomack." },
        tab: { type: "string", description: "Optional Audiomack tab to open (home, feed, trending, search, library, playlists, downloads, favorites, offline)." },
        volume_percent: { type: "number", description: "Volume percentage (0-100) when action is set_volume." },
        seek_seconds: { type: "number", description: "Position in seconds when action is seek." },
        eq_enabled: { type: "boolean", description: "Turn Equalizer ON (true) or OFF (false)." },
        eq_preset: { type: "string", description: "Equalizer preset: Normal, Classical, Dance, Flat, Folk, Heavy Metal, Hip Hop, Jazz, Pop, Rock, Custom, Bass Boost, Vocal, Acoustic, Electronic, R&B." },
        bass_boost: { type: "number", description: "Bass Boost intensity percentage (0-100)." },
        virtualizer: { type: "number", description: "Virtualizer / 3D surround sound percentage (0-100)." },
        reverb: { type: "string", description: "Reverb room preset: None, Small Room, Medium Room, Large Room, Medium Hall, Large Hall, Plate." },
        loudness: { type: "number", description: "Loudness / Preamp boost percentage (0-100)." },
        eq_bands: {
          type: "array",
          items: { type: "number" },
          description: "Optional 5-band EQ levels (60Hz, 230Hz, 910Hz, 3.6kHz, 14kHz) as 0-100 percentages (50 is flat 0dB) or -15 to +15 dB."
        },
        action: {
          type: "string",
          enum: [
            "open", "play", "search",
            "create_playlist", "add_to_playlist", "play_playlist", "list_playlists",
            "download", "favorite", "like", "repost", "follow",
            "queue", "add_to_queue", "play_next",
            "pause", "resume", "toggle", "stop", "next", "previous", "fast_forward", "rewind", "seek",
            "shuffle", "repeat", "equalizer", "set_equalizer", "toggle_equalizer", "bass_boost", "sleep_timer", "lyrics", "share", "open_tab",
            "volume_up", "volume_down", "set_volume", "mute", "unmute", "now_playing"
          ],
          description: "Action to perform in Audiomack (default: play)."
        }
      }
    }
  },
  {
    name: "open_lark_player",
    description: "Full autonomous control over Lark Player: open app, play/search songs directly (immediate autoplay), create/edit/play/delete playlists, control playback (pause, resume, next, previous, stop, seek, shuffle, repeat), volume, full autonomous Equalizer UI + AudioFX control (entering Lark Player Equalizer automatically to toggle eq_enabled, choose eq_preset, adjust 5-band eq_bands, bass_boost, virtualizer, reverb, loudness), sleep timer, lyrics, queue, favorites, tabs, and now playing.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Song title, artist, album, playlist name, or search query for Lark Player." },
        song_title: { type: "string", description: "Exact song title to play or add." },
        artist: { type: "string", description: "Artist name of the song or playlist." },
        playlist_name: { type: "string", description: "Playlist name to create, update, play, or delete." },
        songs: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of song titles/queries to include when creating or updating a playlist."
        },
        tab: { type: "string", description: "Optional Lark Player tab to open (songs, playlists, artists, albums, folders, videos, downloads, settings)." },
        volume_percent: { type: "number", description: "Volume percentage (0-100) when action is set_volume." },
        seek_seconds: { type: "number", description: "Position in seconds when action is seek." },
        eq_enabled: { type: "boolean", description: "Turn Equalizer ON (true) or OFF (false) inside Lark Player." },
        eq_preset: { type: "string", description: "Equalizer preset: Normal, Classical, Dance, Flat, Folk, Heavy Metal, Hip Hop, Jazz, Pop, Rock, Custom, Bass Boost, Vocal, Acoustic, Electronic, R&B." },
        bass_boost: { type: "number", description: "Bass Boost slider intensity percentage (0-100)." },
        virtualizer: { type: "number", description: "Virtualizer / 3D surround sound slider percentage (0-100)." },
        reverb: { type: "string", description: "Reverb preset: None, Small Room, Medium Room, Large Room, Medium Hall, Large Hall, Plate." },
        loudness: { type: "number", description: "Loudness / Preamp gain percentage (0-100)." },
        eq_bands: {
          type: "array",
          items: { type: "number" },
          description: "Optional 5-band EQ levels (60Hz, 230Hz, 910Hz, 3.6kHz, 14kHz) as 0-100 percentages (50 is flat 0dB) or -15 to +15 dB."
        },
        action: {
          type: "string",
          enum: [
            "open", "play", "play_all", "shuffle_all", "search",
            "create_playlist", "add_to_playlist", "play_playlist", "delete_playlist",
            "list_songs", "list_playlists", "list_artists", "list_albums", "list_folders",
            "pause", "resume", "toggle", "stop", "next", "previous", "fast_forward", "rewind", "seek",
            "volume_up", "volume_down", "set_volume", "mute", "unmute",
            "shuffle", "repeat", "favorite", "equalizer", "set_equalizer", "toggle_equalizer", "bass_boost", "sleep_timer", "lyrics",
            "queue", "add_to_queue", "play_next", "open_tab", "share", "ringtone", "speed", "now_playing"
          ],
          description: "Action to perform in Lark Player (default: play)."
        }
      }
    }
  },
  {
    name: "query_device_music",
    description: "Scan, search, and list local audio/music songs stored on the user's phone to browse the library or create a playlist.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query or artist name to filter device songs, or leave empty to list library." },
        genre: { type: "string", description: "Optional genre filter." }
      }
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
    description: "Immediately send a WhatsApp message to a phone number or contact using Izi AI's auto-send agent. For Rwanda numbers, include country code +250 (e.g. +250788123456 or 250788123456).",
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
        reply_style: { type: "string", description: "Instructions for how Izi AI should reply on WhatsApp." }
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
    description: "Open any local device app explicitly requested by name (such as Instagram, TikTok, Spotify, Settings, Maps, Facebook, Chrome, etc.). NEVER call this for Google Search or to answer news, sports, or factual questions.",
    parametersJsonSchema: {
      type: "object",
      properties: { app_name: { type: "string" } },
      required: ["app_name"]
    }
  },
];

function inferServerFallbackDeviceAction(rawInput: string): { name: string; args: Record<string, any> } | null {
  if (!rawInput || typeof rawInput !== 'string') return null;
  if (rawInput.startsWith("Uyu mukoresha yoherereje ubutumwa bw'amajwi")) return null;

  let text = rawInput.trim();
  const sttMatch = text.match(/^\[PRELIMINARY STT DRAFT[^\]]*\]:\s*"([\s\S]*)"$/i);
  if (sttMatch) {
    text = sttMatch[1].trim();
  }
  if (!text) return null;

  const lower = text.toLowerCase();

  const extractEqualizerArgs = (src: string, srcLower: string): Record<string, any> | null => {
    const hasExplicitEqTerm = /\b(?:equalizer|eq|bass\s*boost|virtualizer|surround|reverb|loudness|preamp|treble)\b/i.test(srcLower)
      || /(?:60\s*hz|230\s*hz|910\s*hz|3\.6\s*khz|14\s*khz)/i.test(srcLower)
      || (/\bbass\b/i.test(srcLower) && /(?:ongera|gabanya|shyira|hindur|fungur|funga|zimya|\bboost\b|\bset\b|\bmax\b|\bfull\b|\blow\b|\bhigh\b|\d+\s*%)/i.test(srcLower))
      || (/\b3d\b/i.test(srcLower) && /(?:sound|audio|ijwi|surround|ongera|shyira|fungur|funga|\d+\s*%)/i.test(srcLower));

    const presetRules: Array<[RegExp, string]> = [
      [/\b(?:hip[\s-]*hop|rap)\b/i, 'Hip Hop'],
      [/\b(?:heavy\s*metal|metal)\b/i, 'Heavy Metal'],
      [/\bbass\s*boost\b/i, 'Bass Boost'],
      [/\bclassical\b/i, 'Classical'],
      [/\belectronic\b|\bedm\b/i, 'Electronic'],
      [/\bacoustic\b/i, 'Acoustic'],
      [/\bvocal\b/i, 'Vocal'],
      [/\br\s*&\s*b\b|\brnb\b/i, 'R&B'],
      [/\bdance\b/i, 'Dance'],
      [/\brock\b/i, 'Rock'],
      [/\bpop\b/i, 'Pop'],
      [/\bjazz\b/i, 'Jazz'],
      [/\bfolk\b/i, 'Folk'],
      [/\bflat\b/i, 'Flat'],
      [/\bnormal\b/i, 'Normal'],
      [/\bcustom\b/i, 'Custom'],
    ];
    let matchedPreset = '';
    for (const [rx, label] of presetRules) {
      if (rx.test(srcLower)) {
        matchedPreset = label;
        break;
      }
    }

    const hasPresetCommand = Boolean(matchedPreset) && (
      hasExplicitEqTerm
      || /(?:preset|sound|audio|lark|audiomack|shyira|koresha|hindur|set|mode)/i.test(srcLower)
    );
    if (!hasExplicitEqTerm && !hasPresetCommand) return null;

    const eqArgs: Record<string, any> = {};
    const wantsOff = /(?:funga|zimya|hagarika|\bturn\s*off\b|\bdisable\b|\boff\b)/i.test(srcLower)
      && !/(?:fungur|\bon\b|\benable\b|ongera|shyira)/i.test(srcLower);
    eqArgs.eq_enabled = !wantsOff;

    if (matchedPreset) {
      eqArgs.eq_preset = matchedPreset;
    }

    const bassNumMatch = src.match(/\bbass(?:\s*boost)?\s*(?:kuri|at|to|=|:)?\s*(\d{1,3})\s*%?/i);
    if (bassNumMatch?.[1]) {
      eqArgs.bass_boost = Math.max(0, Math.min(100, Number(bassNumMatch[1])));
    } else if (/\bbass\b/i.test(srcLower)) {
      if (/(?:max|full|cyane|hejuru)/i.test(srcLower)) eqArgs.bass_boost = 95;
      else if (/(?:gabanya|gake|low)/i.test(srcLower)) eqArgs.bass_boost = 25;
      else if (/(?:zero|none|funga|zimya|0%)/i.test(srcLower)) eqArgs.bass_boost = 0;
      else if (!wantsOff) eqArgs.bass_boost = 85;
    }

    const virtMatch = src.match(/(?:virtualizer|surround|3d(?:\s*(?:sound|audio|ijwi))?)\s*(?:kuri|at|to|=|:)?\s*(\d{1,3})\s*%?/i);
    if (virtMatch?.[1]) {
      eqArgs.virtualizer = Math.max(0, Math.min(100, Number(virtMatch[1])));
    } else if (/\b(?:virtualizer|surround)\b/i.test(srcLower) || (/\b3d\b/i.test(srcLower) && /(?:sound|audio|ijwi|surround)/i.test(srcLower))) {
      eqArgs.virtualizer = wantsOff ? 0 : 75;
    }

    const loudMatch = src.match(/(?:loudness|preamp)\s*(?:kuri|at|to|=|:)?\s*(\d{1,3})\s*%?/i);
    if (loudMatch?.[1]) {
      eqArgs.loudness = Math.max(0, Math.min(100, Number(loudMatch[1])));
    } else if (/\b(?:loudness|preamp)\b/i.test(srcLower)) {
      eqArgs.loudness = wantsOff ? 0 : 65;
    }

    if (/\breverb\b/i.test(srcLower)) {
      if (/plate/i.test(srcLower)) eqArgs.reverb = 'Plate';
      else if (/large\s*hall/i.test(srcLower)) eqArgs.reverb = 'Large Hall';
      else if (/medium\s*hall|\bhall\b/i.test(srcLower)) eqArgs.reverb = 'Medium Hall';
      else if (/large\s*room/i.test(srcLower)) eqArgs.reverb = 'Large Room';
      else if (/medium\s*room/i.test(srcLower)) eqArgs.reverb = 'Medium Room';
      else if (/small\s*room|\broom\b/i.test(srcLower)) eqArgs.reverb = 'Small Room';
      else if (/none|off|funga/i.test(srcLower)) eqArgs.reverb = 'None';
      else eqArgs.reverb = 'Medium Hall';
    }

    const bandsMatch = src.match(/(?:[+-]?\d{1,3})\s*(?:,\s*[+-]?\d{1,3}\s*){4}/);
    if (bandsMatch?.[0]) {
      const nums = bandsMatch[0].split(',').map((n) => Number(n.trim())).filter((n) => Number.isFinite(n));
      if (nums.length === 5) eqArgs.eq_bands = nums;
    } else if (/\btreble\b|amajwi\s+yo\s+hejuru/i.test(srcLower)) {
      eqArgs.eq_bands = [55, 52, 54, 72, 82];
    }

    return eqArgs;
  };

  const eqParsed = extractEqualizerArgs(text, lower);
  const hasAppVerb = Boolean(eqParsed) || /(?:fungur|fungir|curang|shakish|nshakir|kora|ongera|shyira|hindur|zimya|hagarik|komeza|subiramo|vanga|umvir|erekan|reb|siba)|\b(open|launch|start|play|search|find|create|make|add|download|like|favorite|repost|follow|pause|resume|stop|next|prev|previous|shuffle|repeat|loop|equalizer|eq|bass\s*boost|virtualizer|surround|reverb|loudness|preamp|sleep|lyrics|queue|list|show|delete|now\s*playing|set|adjust|tune)\b/i.test(lower);
  if (!hasAppVerb) return null;

  const cleanMusicQuery = (src: string): string => src
    .replace(/\[PRELIMINARY STT DRAFT[^\]]*\]:/gi, ' ')
    .replace(/(?:audio\s*mack|audiomack|lark\s*player|larkplayer|\blark\b)/gi, ' ')
    .replace(/\b(?:please|nyamuneka|ubu|nonaha|kevin|hey|hi|mfasha|unshakire|nshakira|shakisha|nshaka|mfungurira|fungurira|fungura|open|launch|start|play|curanga|uncurangire|ndumva|umva|kuri|muri|on|in|from|indirimbo|yitwa|song|music|track|playlist|named|called|kora|create|make|add|ongera|download|like|favorite|repost|follow|search|for|the|ya|za|rya|wa)\b/gi, ' ')
    .replace(/["'“”?!.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const extractPlaylistName = (src: string): string => {
    const named = src.match(/(?:yitwa|named|called|name\s*is)\s+["']?([^"'\n,.!?]{2,40})["']?/i);
    if (named?.[1]) return named[1].trim();
    const quoted = src.match(/["']([^"']{2,40})["']/);
    if (quoted?.[1]) return quoted[1].trim();
    const afterPlaylist = src.match(/playlist\s+(?:ya|za|of|for)?\s*([^.!?\n]{2,35})/i);
    if (afterPlaylist?.[1]) {
      const cleaned = afterPlaylist[1].replace(/\b(?:kuri|muri|on|in|audiomack|audio\s*mack|lark\s*player|larkplayer|lark)\b.*$/i, '').trim();
      if (cleaned.length >= 2) return cleaned;
    }
    return 'Kevin Mix';
  };

  const detectMusicSubAction = (srcLower: string, hasQuery: boolean): string => {
    if (eqParsed) return 'equalizer';
    if (/\b(?:delete|siba|remove)\b.*playlist/i.test(srcLower)) return 'delete_playlist';
    if (/(?:kora|tangira|\bcreate\b|\bmake\b|\bnew\b).*playlist/i.test(srcLower)) return 'create_playlist';
    if (/(?:ongera|shyira|\badd\b).*playlist/i.test(srcLower)) return 'add_to_playlist';
    if (/(?:curanga|\bplay\b|fungur).*playlist/i.test(srcLower)) return 'play_playlist';
    if (/(?:urutonde|reb|erekan|\blist\b|\bshow\b).*playlist/i.test(srcLower)) return 'list_playlists';
    if (/\bdownload\b|manura/i.test(srcLower)) return 'download';
    if (/\b(?:favorite|favourite|like|kunda)\b/i.test(srcLower)) return 'favorite';
    if (/\brepost\b/i.test(srcLower)) return 'repost';
    if (/\bfollow\b|kurikira/i.test(srcLower)) return 'follow';
    if (/\b(?:pause|hagarika)\b/i.test(srcLower)) return 'pause';
    if (/\b(?:resume|komeza|subukura)\b/i.test(srcLower)) return 'resume';
    if (/\bstop\b/i.test(srcLower)) return 'stop';
    if (/\b(?:next|ikurikira|simbuka)\b/i.test(srcLower)) return 'next';
    if (/\b(?:previous|prev|ibanza)\b/i.test(srcLower)) return 'previous';
    if (/\b(?:shuffle\s*all)\b/i.test(srcLower)) return 'shuffle_all';
    if (/\bshuffle\b|vanga/i.test(srcLower)) return 'shuffle';
    if (/\b(?:repeat|loop)\b|subiramo/i.test(srcLower)) return 'repeat';
    if (/\b(?:equalizer|eq)\b/i.test(srcLower)) return 'equalizer';
    if (/\b(?:sleep\s*timer)\b/i.test(srcLower)) return 'sleep_timer';
    if (/\blyrics\b/i.test(srcLower)) return 'lyrics';
    if (/\b(?:queue|up\s*next)\b/i.test(srcLower)) return 'queue';
    if (/\bnow\s*playing\b/i.test(srcLower)) return 'now_playing';
    if (/(?:shakish|nshakir|\bsearch\b|\bfind\b)/i.test(srcLower) && !/(?:curang|\bplay\b)/i.test(srcLower)) return hasQuery ? 'search' : 'open';
    if (/(?:curang|\bplay\b|umvir)/i.test(srcLower)) return hasQuery ? 'play' : 'play_all';
    return hasQuery ? 'play' : 'open';
  };

  if (/audiomack|audio\s+mack/i.test(lower)) {
    const q = eqParsed ? '' : cleanMusicQuery(text);
    let act = detectMusicSubAction(lower, q.length > 0);
    if (act === 'play_all') act = 'play';
    const args: Record<string, any> = { action: act, ...(eqParsed || {}) };
    if (q) args.query = q;
    if (act === 'create_playlist' || act === 'add_to_playlist' || act === 'play_playlist') {
      args.playlist_name = extractPlaylistName(text);
    } else if (q && (act === 'play' || act === 'search' || act === 'download' || act === 'favorite')) {
      args.song_title = q;
    }
    return { name: 'open_audiomack', args };
  }

  if (/lark\s*player|larkplayer|\blark\b/i.test(lower)) {
    const q = eqParsed ? '' : cleanMusicQuery(text);
    const act = detectMusicSubAction(lower, q.length > 0);
    const args: Record<string, any> = { action: act, ...(eqParsed || {}) };
    if (q) args.query = q;
    if (act === 'create_playlist' || act === 'add_to_playlist' || act === 'play_playlist' || act === 'delete_playlist') {
      args.playlist_name = extractPlaylistName(text);
    } else if (q && (act === 'play' || act === 'search')) {
      args.song_title = q;
    }
    return { name: 'open_lark_player', args };
  }

  if (eqParsed) {
    return {
      name: 'open_lark_player',
      args: {
        action: 'equalizer',
        ...eqParsed,
      },
    };
  }

  if (/(?:kora|tangira|\bcreate\b|\bmake\b)\s+(?:a\s+|new\s+)?playlist\b/i.test(lower) && !/\b(?:youtube|spotify)\b/i.test(lower)) {
    const q = cleanMusicQuery(text);
    return {
      name: 'open_lark_player',
      args: {
        action: 'create_playlist',
        playlist_name: extractPlaylistName(text),
        ...(q ? { query: q } : {}),
      },
    };
  }

  if (/(?:curanga|play)\s+(?:indirimbo\s+(?:zo\s+)?muri\s+telefone|local\s+music|my\s+songs|all\s+songs)/i.test(lower)) {
    return { name: 'open_lark_player', args: { action: 'play_all' } };
  }

  const openMatch = text.match(/^(?:(?:hey|hi|ok|please|nyamuneka|kevin)[,\s]+)*(?:mfungurira|fungurira|fungura|open|launch|start)\s+(?:app\s+(?:ya\s+)?|porogaramu\s+(?:ya\s+)?)?([A-Za-z0-9\s._-]{2,32})/i);
  if (openMatch?.[1]) {
    const rawTarget = openMatch[1]
      .replace(/\b(?:please|nyamuneka|ubu|nonaha|na|kandi|ugacuranga|ucurange|ngo|play)\b[\s\S]*$/i, '')
      .trim();
    const targetLower = rawTarget.toLowerCase();
    if (targetLower && !targetLower.includes('auto') && !targetLower.includes('google search')) {
      if (targetLower.includes('camera') || targetLower.includes('kamera')) {
        return { name: 'open_camera', args: {} };
      }
      if (!targetLower.includes('whatsapp') && !targetLower.includes('youtube')) {
        return { name: 'open_app', args: { app_name: rawTarget } };
      }
    }
  }

  return null;
}

function getServerApiKeys(customKeys?: string | string[]): string[] {
  const customList = Array.isArray(customKeys)
    ? customKeys
    : typeof customKeys === 'string' && customKeys.trim()
      ? [customKeys]
      : [];
  const keys = [
    ...customList,
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_BACKUP,
    process.env.GEMINI_API_KEY_BACKUP_2,
    process.env.GEMINI_API_KEY_BACKUP_3,
    process.env.GEMINI_API_KEY_BACKUP_4,
    process.env.VITE_GEMINI_API_KEY,
    process.env.VITE_GEMINI_API_KEY_2,
    process.env.VITE_GEMINI_API_KEY_3,
    process.env.VITE_GEMINI_API_KEY_4,
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

  app.post('/api/news-briefings/sync', async (req: Request, res: Response) => {
    try {
      const { deliveredIds, customApiKey, customApiKeys, newsCustomInstructions } = (req.body || {}) as {
        deliveredIds?: string[];
        customApiKey?: string;
        customApiKeys?: string[];
        newsCustomInstructions?: string;
      };
      const result = await syncDueNewsBriefings({
        deliveredIds: Array.isArray(deliveredIds) ? deliveredIds : [],
        customApiKeys: customApiKeys || customApiKey,
        newsCustomInstructions: typeof newsCustomInstructions === 'string' ? newsCustomInstructions : '',
        getServerApiKeys,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({
        error: extractReadableError(error),
        briefings: [],
      });
    }
  });

  app.get('/api/news-briefings/pending', async (req: Request, res: Response) => {
    try {
      const rawDelivered = typeof req.query.deliveredIds === 'string' ? req.query.deliveredIds : '';
      const newsCustomInstructions = typeof req.query.newsCustomInstructions === 'string' ? req.query.newsCustomInstructions : '';
      const deliveredIds = rawDelivered
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const result = await syncDueNewsBriefings({
        deliveredIds,
        newsCustomInstructions,
        getServerApiKeys,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({
        error: extractReadableError(error),
        briefings: [],
      });
    }
  });

  const LIVE_SCORE_SERVER_LEAGUES: Array<{
    slug: string;
    name: string;
    region: 'europe' | 'africa';
    countryLabel: string;
    continentalCup?: boolean;
  }> = [
    { slug: 'uefa.champions', name: 'UEFA Champions League', region: 'europe', countryLabel: 'Europe', continentalCup: true },
    { slug: 'uefa.europa', name: 'UEFA Europa League', region: 'europe', countryLabel: 'Europe', continentalCup: true },
    { slug: 'uefa.europa.conf', name: 'UEFA Conference League', region: 'europe', countryLabel: 'Europe', continentalCup: true },
    { slug: 'eng.1', name: 'Premier League', region: 'europe', countryLabel: 'England' },
    { slug: 'esp.1', name: 'LaLiga', region: 'europe', countryLabel: 'Spain' },
    { slug: 'ita.1', name: 'Serie A', region: 'europe', countryLabel: 'Italy' },
    { slug: 'ger.1', name: 'Bundesliga', region: 'europe', countryLabel: 'Germany' },
    { slug: 'fra.1', name: 'Ligue 1', region: 'europe', countryLabel: 'France' },
    { slug: 'por.1', name: 'Liga Portugal', region: 'europe', countryLabel: 'Portugal' },
    { slug: 'ned.1', name: 'Eredivisie', region: 'europe', countryLabel: 'Netherlands' },
    { slug: 'bel.1', name: 'Belgian Pro League', region: 'europe', countryLabel: 'Belgium' },
    { slug: 'tur.1', name: 'Turkish Super Lig', region: 'europe', countryLabel: 'Turkey' },
    { slug: 'caf.champions', name: 'CAF Champions League', region: 'africa', countryLabel: 'Africa', continentalCup: true },
    { slug: 'caf.confed', name: 'CAF Confederation Cup', region: 'africa', countryLabel: 'Africa', continentalCup: true },
    { slug: 'caf.nations', name: 'Africa Cup of Nations', region: 'africa', countryLabel: 'Africa', continentalCup: true },
    { slug: 'caf.nations_qual', name: 'AFCON Qualifiers', region: 'africa', countryLabel: 'Africa', continentalCup: true },
    { slug: 'fifa.worldq.caf', name: 'CAF World Cup Qualifiers', region: 'africa', countryLabel: 'Africa', continentalCup: true },
    { slug: 'rsa.1', name: 'South African Premiership', region: 'africa', countryLabel: 'South Africa' },
    { slug: 'nga.1', name: 'Nigeria Premier League', region: 'africa', countryLabel: 'Nigeria' },
    { slug: 'ken.1', name: 'Kenyan Premier League', region: 'africa', countryLabel: 'Kenya' },
    { slug: 'gha.1', name: 'Ghana Premier League', region: 'africa', countryLabel: 'Ghana' },
    { slug: 'uga.1', name: 'Uganda Premier League', region: 'africa', countryLabel: 'Uganda' },
  ];

  let liveScoresCache: { matches: any[]; updatedAt: number } | null = null;
  const matchDetailCache = new Map<string, { data: any; updatedAt: number }>();
  const teamProfileCache = new Map<string, { data: any; updatedAt: number }>();

  const runServerTasksWithConcurrency = async <T,>(
    factories: Array<() => Promise<T>>,
    concurrency = 10
  ): Promise<T[]> => {
    const results: T[] = new Array(factories.length);
    let nextIdx = 0;
    const worker = async () => {
      while (true) {
        const idx = nextIdx++;
        if (idx >= factories.length) break;
        results[idx] = await factories[idx]();
      }
    };
    const workers = Array.from({ length: Math.min(concurrency, factories.length) }, () => worker());
    await Promise.all(workers);
    return results;
  };

  const fetchEspnJsonServer = async (url: string, timeoutMs = 9000): Promise<any | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const espnRes = await fetch(url, { signal: controller.signal });
      if (!espnRes.ok) return null;
      return await espnRes.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const formatKigaliDateYYYYMMDD = (offsetDays: number): string => {
    const d = new Date(Date.now() + offsetDays * 86_400_000);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Kigali',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const y = parts.find((p) => p.type === 'year')?.value || String(d.getUTCFullYear());
    const m = parts.find((p) => p.type === 'month')?.value || String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = parts.find((p) => p.type === 'day')?.value || String(d.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  };

  const extractStandingsRowsServer = (standingsObj: any): any[] => {
    const groups = Array.isArray(standingsObj?.groups)
      ? standingsObj.groups
      : Array.isArray(standingsObj?.children)
        ? standingsObj.children
        : [];
    const targetGroup = groups[0];
    const entries = Array.isArray(targetGroup?.standings?.entries)
      ? targetGroup.standings.entries
      : Array.isArray(standingsObj?.standings?.entries)
        ? standingsObj.standings.entries
        : [];

    return entries.map((entry: any, idx: number) => {
      const statsMap = new Map<string, string>();
      if (Array.isArray(entry?.stats)) {
        for (const st of entry.stats) {
          if (st?.name) statsMap.set(String(st.name), String(st.displayValue ?? st.value ?? '0'));
        }
      }
      const teamName =
        typeof entry?.team === 'string'
          ? entry.team
          : String(entry?.team?.displayName || entry?.team?.shortDisplayName || entry?.team?.name || 'Team');
      const teamId = String(entry?.id || entry?.team?.id || '');
      const teamLogo = typeof entry?.team === 'object' ? entry.team?.logos?.[0]?.href || entry.team?.logo : undefined;
      return {
        rank: Number(statsMap.get('rank') || entry?.note?.rank || idx + 1),
        teamId,
        teamName,
        teamLogo,
        played: statsMap.get('gamesPlayed') || '0',
        wins: statsMap.get('wins') || '0',
        draws: statsMap.get('ties') || '0',
        losses: statsMap.get('losses') || '0',
        goalsFor: statsMap.get('pointsFor') || '0',
        goalsAgainst: statsMap.get('pointsAgainst') || '0',
        goalDiff: statsMap.get('pointDifferential') || '0',
        points: statsMap.get('points') || '0',
        note: entry?.note?.description || undefined,
      };
    });
  };

  app.get('/api/live-scores', async (req: Request, res: Response) => {
    try {
      const forceRefresh = req.query.refresh === '1';
      if (!forceRefresh && liveScoresCache && Date.now() - liveScoresCache.updatedAt < 20_000) {
        res.json(liveScoresCache);
        return;
      }

      const yesterday = formatKigaliDateYYYYMMDD(-1);
      const today = formatKigaliDateYYYYMMDD(0);
      const tomorrow = formatKigaliDateYYYYMMDD(1);
      const now = Date.now();
      const maxPastMs = 5 * 86_400_000;
      const maxFutureMs = 7 * 86_400_000;

      const taskFactories: Array<() => Promise<any[]>> = [];
      for (const league of LIVE_SCORE_SERVER_LEAGUES) {
        const dateParams = league.continentalCup ? ['', today, tomorrow] : ['', today, tomorrow, yesterday];
        for (const dateStr of dateParams) {
          const url = dateStr
            ? `https://site.api.espn.com/apis/site/v2/sports/soccer/${league.slug}/scoreboard?dates=${dateStr}`
            : `https://site.api.espn.com/apis/site/v2/sports/soccer/${league.slug}/scoreboard`;

          taskFactories.push(async () => {
            const json = await fetchEspnJsonServer(url, 9500);
            if (!json) return [];
            const events = Array.isArray(json?.events) ? json.events : [];
            const leagueMeta = Array.isArray(json?.leagues) ? json.leagues[0] : null;
            const leagueLogo = leagueMeta?.logos?.[0]?.href || undefined;
            const leagueName = leagueMeta?.name || league.name;
            const parsed: any[] = [];

            for (const ev of events) {
              const comp = ev?.competitions?.[0];
              if (!comp || !Array.isArray(comp.competitors)) continue;
              const stateRaw = String(ev?.status?.type?.state || comp?.status?.type?.state || 'pre').toLowerCase();
              const statusState = stateRaw === 'in' ? 'in' : stateRaw === 'post' ? 'post' : 'pre';
              const dateIso = String(ev?.date || comp?.date || '');
              const kickoffMs = Date.parse(dateIso);
              if (Number.isFinite(kickoffMs) && statusState !== 'in') {
                if (kickoffMs < now - maxPastMs || kickoffMs > now + maxFutureMs) continue;
              }

              const homeRaw = comp.competitors.find((c: any) => c.homeAway === 'home') || comp.competitors[0];
              const awayRaw = comp.competitors.find((c: any) => c.homeAway === 'away') || comp.competitors[1];
              if (!homeRaw?.team || !awayRaw?.team) continue;

              const parseScore = (raw: any): number | null => {
                if (statusState === 'pre') return null;
                const n = Number(raw?.score);
                return Number.isFinite(n) ? n : 0;
              };

              const teamMap = new Map<string, string>();
              if (homeRaw.team.id) teamMap.set(String(homeRaw.team.id), String(homeRaw.team.displayName || homeRaw.team.name || ''));
              if (awayRaw.team.id) teamMap.set(String(awayRaw.team.id), String(awayRaw.team.displayName || awayRaw.team.name || ''));

              const matchEvents: any[] = [];
              if (Array.isArray(comp.details)) {
                for (const d of comp.details) {
                  const isGoal = Boolean(d?.scoringPlay);
                  const isRed = Boolean(d?.redCard);
                  const isYellow = Boolean(d?.yellowCard);
                  if (!isGoal && !isRed && !isYellow) continue;
                  const player = d?.athletesInvolved?.[0]?.displayName || d?.athletesInvolved?.[0]?.shortName || '';
                  const minute = String(d?.clock?.displayValue || '').trim();
                  const teamId = String(d?.team?.id || '');
                  const evType = isGoal
                    ? d?.ownGoal
                      ? 'own_goal'
                      : d?.penaltyKick
                        ? 'penalty'
                        : 'goal'
                    : isRed
                      ? 'red_card'
                      : 'yellow_card';
                  matchEvents.push({
                    minute,
                    type: evType,
                    teamId,
                    teamName: teamMap.get(teamId) || '',
                    playerName: player || (isGoal ? 'Goal' : isRed ? 'Red Card' : 'Yellow Card'),
                  });
                }
              }

              const statusDetail = String(
                ev?.status?.type?.shortDetail ||
                  comp?.status?.type?.shortDetail ||
                  ev?.status?.displayClock ||
                  (statusState === 'pre' ? 'Scheduled' : statusState === 'post' ? 'FT' : 'LIVE')
              ).trim();

              parsed.push({
                id: `${league.slug}:${String(ev.id)}`,
                eventId: String(ev.id),
                leagueSlug: league.slug,
                leagueName,
                leagueLogo,
                region: league.region,
                countryLabel: league.countryLabel,
                dateIso,
                statusState,
                statusDetail,
                clock: ev?.status?.displayClock ? String(ev.status.displayClock) : undefined,
                venue: comp?.venue?.fullName || ev?.venue?.fullName || undefined,
                homeTeam: {
                  id: String(homeRaw.team.id || 'home'),
                  name: String(homeRaw.team.displayName || homeRaw.team.name || 'Home'),
                  shortName: String(homeRaw.team.abbreviation || homeRaw.team.shortDisplayName || homeRaw.team.name || 'HOM'),
                  logo: homeRaw.team.logo || undefined,
                  score: parseScore(homeRaw),
                  winner: Boolean(homeRaw.winner),
                },
                awayTeam: {
                  id: String(awayRaw.team.id || 'away'),
                  name: String(awayRaw.team.displayName || awayRaw.team.name || 'Away'),
                  shortName: String(awayRaw.team.abbreviation || awayRaw.team.shortDisplayName || awayRaw.team.name || 'AWY'),
                  logo: awayRaw.team.logo || undefined,
                  score: parseScore(awayRaw),
                  winner: Boolean(awayRaw.winner),
                },
                events: matchEvents,
              });
            }
            return parsed;
          });
        }
      }

      const settled = await runServerTasksWithConcurrency(taskFactories, 12);
      const deduped = new Map<string, any>();
      for (const list of settled) {
        if (!Array.isArray(list)) continue;
        for (const match of list) {
          const existing = deduped.get(match.id);
          if (!existing || match.statusState === 'in' || match.events.length > existing.events.length) {
            deduped.set(match.id, match);
          }
        }
      }

      const rank = (s: string) => (s === 'in' ? 0 : s === 'pre' ? 1 : 2);
      const matches = Array.from(deduped.values()).sort((a, b) => {
        const diff = rank(a.statusState) - rank(b.statusState);
        if (diff !== 0) return diff;
        const tA = Date.parse(a.dateIso) || 0;
        const tB = Date.parse(b.dateIso) || 0;
        if (a.statusState === 'pre') return tA - tB;
        return tB - tA;
      });

      // Never wipe valid cached matches if an upstream transient failure returned 0
      if (matches.length === 0 && liveScoresCache && liveScoresCache.matches.length > 0) {
        res.json(liveScoresCache);
        return;
      }

      liveScoresCache = { matches, updatedAt: Date.now() };
      res.json(liveScoresCache);
    } catch (error: any) {
      if (liveScoresCache && liveScoresCache.matches.length > 0) {
        res.json(liveScoresCache);
        return;
      }
      res.status(500).json({
        error: extractReadableError(error),
        matches: [],
        updatedAt: Date.now(),
      });
    }
  });

  app.get('/api/live-scores/match', async (req: Request, res: Response) => {
    try {
      const league = String(req.query.league || '').trim();
      const eventId = String(req.query.eventId || '').trim();
      if (!league || !eventId || !/^[a-z0-9._-]+$/i.test(league) || !/^[a-z0-9_-]+$/i.test(eventId)) {
        res.status(400).json({ error: 'Invalid league or eventId.' });
        return;
      }

      const cacheKey = `${league}:${eventId}`;
      const cached = matchDetailCache.get(cacheKey);
      if (cached && Date.now() - cached.updatedAt < 25_000) {
        res.json(cached.data);
        return;
      }

      const [sum, leagueStd] = await Promise.all([
        fetchEspnJsonServer(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/summary?event=${eventId}`, 9500),
        fetchEspnJsonServer(`https://site.api.espn.com/apis/v2/sports/soccer/${league}/standings`, 8000),
      ]);

      if (!sum) {
        res.status(404).json({ error: 'Match detail unavailable.' });
        return;
      }

      const boxTeams = Array.isArray(sum?.boxscore?.teams) ? sum.boxscore.teams : [];
      const parseStats = (teamEntry: any) =>
        (Array.isArray(teamEntry?.statistics) ? teamEntry.statistics : []).map((st: any) => ({
          name: String(st?.name || ''),
          label: String(st?.label || st?.name || ''),
          value: String(st?.displayValue ?? st?.value ?? '0'),
        }));

      const homeBox = boxTeams[0];
      const awayBox = boxTeams[1];

      let rosters = (Array.isArray(sum?.rosters) ? sum.rosters : []).map((r: any) => ({
        teamId: String(r?.team?.id || ''),
        teamName: String(r?.team?.displayName || r?.team?.name || ''),
        homeAway: r?.homeAway === 'away' ? 'away' : 'home',
        formation: r?.formation ? String(r.formation) : undefined,
        isPossibleLineup: false,
        coach: Array.isArray(r?.coach) && r.coach[0] ? [r.coach[0].firstName, r.coach[0].lastName].filter(Boolean).join(' ') : undefined,
        players: (Array.isArray(r?.roster) ? r.roster : []).map((p: any) => ({
          id: String(p?.athlete?.id || ''),
          name: String(p?.athlete?.displayName || p?.athlete?.shortName || 'Player'),
          jersey: p?.jersey ? String(p.jersey) : p?.athlete?.jersey ? String(p.athlete.jersey) : '',
          position: String(p?.position?.abbreviation || p?.position?.displayName || ''),
          starter: Boolean(p?.starter),
          subbedIn: Boolean(p?.subbedIn),
          subbedOut: Boolean(p?.subbedOut),
        })),
      }));

      // If official roster has no players, build a realistic squad-based Possible Lineup
      const hasStarters = rosters.some((r: any) => r.players.some((p: any) => p.starter));
      if (!hasStarters) {
        const homeId = String(homeBox?.team?.id || sum?.header?.competitions?.[0]?.competitors?.[0]?.team?.id || '');
        const awayId = String(awayBox?.team?.id || sum?.header?.competitions?.[0]?.competitors?.[1]?.team?.id || '');
        const homeName = String(homeBox?.team?.displayName || sum?.header?.competitions?.[0]?.competitors?.[0]?.team?.displayName || 'Home Team');
        const awayName = String(awayBox?.team?.displayName || sum?.header?.competitions?.[0]?.competitors?.[1]?.team?.displayName || 'Away Team');

        const [homeRosterRes, awayRosterRes] = await Promise.all([
          homeId ? fetchEspnJsonServer(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/teams/${homeId}/roster`, 7000) : null,
          awayId ? fetchEspnJsonServer(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/teams/${awayId}/roster`, 7000) : null,
        ]);

        const buildPossibleTeamLineup = (teamId: string, teamName: string, homeAway: 'home' | 'away', rosterData: any) => {
          const athletes: any[] = Array.isArray(rosterData?.athletes) ? rosterData.athletes : [];
          const coachEntry = Array.isArray(rosterData?.coach) ? rosterData.coach[0] : null;
          const coachName = coachEntry ? [coachEntry.firstName, coachEntry.lastName].filter(Boolean).join(' ') : undefined;

          const gks = athletes.filter((a: any) => String(a?.position?.abbreviation || a?.position?.name || '').toUpperCase().startsWith('G'));
          const dfs = athletes.filter((a: any) => String(a?.position?.abbreviation || a?.position?.name || '').toUpperCase().startsWith('D'));
          const mfs = athletes.filter((a: any) => String(a?.position?.abbreviation || a?.position?.name || '').toUpperCase().startsWith('M'));
          const fws = athletes.filter((a: any) => String(a?.position?.abbreviation || a?.position?.name || '').toUpperCase().startsWith('F'));

          const chosenStarters: any[] = [
            ...gks.slice(0, 1),
            ...dfs.slice(0, 4),
            ...mfs.slice(0, 3),
            ...fws.slice(0, 3),
          ];

          const remainingPool = athletes.filter((a: any) => !chosenStarters.includes(a));
          while (chosenStarters.length < 11 && remainingPool.length > 0) {
            chosenStarters.push(remainingPool.shift());
          }

          const bench = athletes.filter((a: any) => !chosenStarters.includes(a));

          return {
            teamId,
            teamName,
            homeAway,
            formation: '4-3-3 (Possible Lineup)',
            isPossibleLineup: true,
            coach: coachName,
            players: [
              ...chosenStarters.map((a: any) => ({
                id: String(a?.id || ''),
                name: String(a?.displayName || a?.fullName || 'Player'),
                jersey: a?.jersey ? String(a.jersey) : '',
                position: String(a?.position?.abbreviation || a?.position?.displayName || 'Starter'),
                starter: true,
                subbedIn: false,
                subbedOut: false,
              })),
              ...bench.map((a: any) => ({
                id: String(a?.id || ''),
                name: String(a?.displayName || a?.fullName || 'Player'),
                jersey: a?.jersey ? String(a.jersey) : '',
                position: String(a?.position?.abbreviation || a?.position?.displayName || 'Sub'),
                starter: false,
                subbedIn: false,
                subbedOut: false,
              })),
            ],
          };
        };

        rosters = [
          buildPossibleTeamLineup(homeId, homeName, 'home', homeRosterRes),
          buildPossibleTeamLineup(awayId, awayName, 'away', awayRosterRes),
        ];
      }

      const lastFiveGames = (Array.isArray(sum?.lastFiveGames) ? sum.lastFiveGames : []).map((lf: any) => ({
        teamId: String(lf?.team?.id || ''),
        teamName: String(lf?.team?.displayName || lf?.team?.name || ''),
        teamLogo: lf?.team?.logo || undefined,
        games: (Array.isArray(lf?.events) ? lf.events : []).map((g: any) => ({
          id: String(g?.id || ''),
          date: String(g?.gameDate || ''),
          score: String(g?.score || ''),
          result: String(g?.gameResult || ''),
          opponent: String(g?.opponent?.displayName || g?.opponent?.shortDisplayName || g?.opponent?.abbreviation || ''),
          opponentLogo: g?.opponent?.logo || undefined,
          homeAway: String(g?.atVs || ''),
          leagueName: String(g?.leagueAbbreviation || g?.leagueName || ''),
        })),
      }));

      const primaryOdds = Array.isArray(sum?.odds) && sum.odds[0]
        ? {
            provider: String(sum.odds[0]?.provider?.name || 'Odds'),
            details: sum.odds[0]?.details ? String(sum.odds[0].details) : undefined,
            overUnder: sum.odds[0]?.overUnder ?? undefined,
            homeMoneyLine: sum.odds[0]?.homeTeamOdds?.moneyLine ?? undefined,
            awayMoneyLine: sum.odds[0]?.awayTeamOdds?.moneyLine ?? undefined,
            drawMoneyLine: sum.odds[0]?.drawOdds?.moneyLine ?? undefined,
          }
        : undefined;

      const standings = extractStandingsRowsServer(sum?.standings || leagueStd);

      const venueObj = sum?.gameInfo?.venue;
      const payload = {
        eventId,
        leagueSlug: league,
        venue: venueObj?.fullName ? String(venueObj.fullName) : undefined,
        venueCity: venueObj?.address?.city ? `${venueObj.address.city}${venueObj.address.country ? `, ${venueObj.address.country}` : ''}` : undefined,
        attendance: typeof sum?.gameInfo?.attendance === 'number' ? sum.gameInfo.attendance : undefined,
        referee: sum?.gameInfo?.officials?.[0]?.fullName || sum?.gameInfo?.officials?.[0]?.displayName || undefined,
        odds: primaryOdds,
        stats: {
          homeTeamId: String(homeBox?.team?.id || ''),
          awayTeamId: String(awayBox?.team?.id || ''),
          home: parseStats(homeBox),
          away: parseStats(awayBox),
        },
        rosters,
        lastFiveGames,
        standings,
        news: (Array.isArray(sum?.news?.articles) ? sum.news.articles : []).slice(0, 4).map((a: any) => ({
          headline: String(a?.headline || ''),
          published: String(a?.published || ''),
          link: a?.links?.web?.href || undefined,
        })),
        updatedAt: Date.now(),
      };

      matchDetailCache.set(cacheKey, { data: payload, updatedAt: Date.now() });
      res.json(payload);
    } catch (error: any) {
      res.status(500).json({ error: extractReadableError(error) });
    }
  });

  const standingsCache = new Map<string, { data: any; updatedAt: number }>();

  app.get('/api/live-scores/standings', async (req: Request, res: Response) => {
    try {
      const league = String(req.query.league || 'eng.1').trim();
      const cached = standingsCache.get(league);
      if (cached && Date.now() - cached.updatedAt < 60_000) {
        res.json(cached.data);
        return;
      }
      const raw = await fetchEspnJsonServer(`https://site.api.espn.com/apis/v2/sports/soccer/${league}/standings`, 8000);
      const rows = extractStandingsRowsServer(raw);
      const payload = {
        leagueSlug: league,
        leagueName: String(raw?.name || league),
        standings: rows,
        updatedAt: Date.now(),
      };
      standingsCache.set(league, { data: payload, updatedAt: Date.now() });
      res.json(payload);
    } catch (error: any) {
      res.status(500).json({ error: extractReadableError(error), standings: [] });
    }
  });

  app.get('/api/live-scores/team', async (req: Request, res: Response) => {
    try {
      const league = String(req.query.league || '').trim();
      const teamId = String(req.query.teamId || '').trim();
      if (!league || !teamId || !/^[a-z0-9._-]+$/i.test(league) || !/^[a-z0-9_-]+$/i.test(teamId)) {
        res.status(400).json({ error: 'Invalid league or teamId.' });
        return;
      }

      const cacheKey = `${league}:${teamId}`;
      const cached = teamProfileCache.get(cacheKey);
      if (cached && Date.now() - cached.updatedAt < 60_000) {
        res.json(cached.data);
        return;
      }

      const [teamRes, rosterRes, scheduleRes, standingsRes] = await Promise.all([
        fetchEspnJsonServer(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/teams/${teamId}`, 9000),
        fetchEspnJsonServer(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/teams/${teamId}/roster`, 9000),
        fetchEspnJsonServer(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/teams/${teamId}/schedule`, 9000),
        fetchEspnJsonServer(`https://site.api.espn.com/apis/v2/sports/soccer/${league}/standings`, 8000),
      ]);

      const t = teamRes?.team;
      if (!t && !rosterRes && !scheduleRes) {
        res.status(404).json({ error: 'Team info unavailable.' });
        return;
      }

      const recordStats = new Map<string, string>();
      const recordItems = Array.isArray(t?.record?.items) ? t.record.items : [];
      const overallRecord = recordItems[0];
      if (Array.isArray(overallRecord?.stats)) {
        for (const st of overallRecord.stats) {
          if (st?.name) recordStats.set(String(st.name), String(st.displayValue ?? st.value ?? '0'));
        }
      }

      const coachEntry = Array.isArray(rosterRes?.coach) ? rosterRes.coach[0] : null;
      const coachName = coachEntry
        ? [coachEntry.firstName, coachEntry.lastName].filter(Boolean).join(' ').trim() || undefined
        : undefined;

      const athletes = (Array.isArray(rosterRes?.athletes) ? rosterRes.athletes : []).map((a: any) => {
        const statValues = new Map<string, string>();
        const cats = Array.isArray(a?.statistics?.splits?.categories) ? a.statistics.splits.categories : [];
        for (const c of cats) {
          for (const st of Array.isArray(c?.stats) ? c.stats : []) {
            if (st?.name) statValues.set(String(st.name), String(st.displayValue ?? st.value ?? '0'));
          }
        }
        return {
          id: String(a?.id || ''),
          name: String(a?.displayName || a?.fullName || 'Player'),
          shortName: String(a?.shortName || a?.displayName || ''),
          jersey: a?.jersey ? String(a.jersey) : '',
          position: String(a?.position?.displayName || a?.position?.name || ''),
          positionAbbr: String(a?.position?.abbreviation || ''),
          age: typeof a?.age === 'number' ? a.age : undefined,
          height: a?.displayHeight ? String(a.displayHeight) : undefined,
          nationality: a?.citizenship ? String(a.citizenship) : undefined,
          flagUrl: a?.flag?.href || undefined,
          appearances: statValues.get('appearances') || '0',
          goals: statValues.get('totalGoals') || statValues.get('goals') || '0',
          assists: statValues.get('goalAssists') || statValues.get('assists') || '0',
          yellowCards: statValues.get('yellowCards') || '0',
          redCards: statValues.get('redCards') || '0',
        };
      });

      const scheduleEvents = (Array.isArray(scheduleRes?.events) ? scheduleRes.events : []).map((ev: any) => {
        const comp = ev?.competitions?.[0];
        const home = comp?.competitors?.find((c: any) => c.homeAway === 'home') || comp?.competitors?.[0];
        const away = comp?.competitors?.find((c: any) => c.homeAway === 'away') || comp?.competitors?.[1];
        const stateRaw = String(comp?.status?.type?.state || ev?.status?.type?.state || 'pre').toLowerCase();
        const statusState = stateRaw === 'in' ? 'in' : stateRaw === 'post' ? 'post' : 'pre';
        const parseScore = (c: any) => {
          if (statusState === 'pre') return null;
          const v = c?.score?.value ?? c?.score?.displayValue ?? c?.score;
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        };
        return {
          id: `${league}:${String(ev?.id || '')}`,
          eventId: String(ev?.id || ''),
          leagueSlug: league,
          dateIso: String(ev?.date || comp?.date || ''),
          competitionName: String(ev?.seasonType?.name || ev?.league?.name || t?.defaultLeague?.name || league),
          statusState,
          statusDetail: String(comp?.status?.type?.shortDetail || ev?.status?.type?.shortDetail || ''),
          venue: comp?.venue?.fullName || undefined,
          homeTeam: {
            id: String(home?.team?.id || ''),
            name: String(home?.team?.displayName || home?.team?.name || 'Home'),
            shortName: String(home?.team?.abbreviation || 'HOM'),
            logo: home?.team?.logos?.[0]?.href || home?.team?.logo || undefined,
            score: parseScore(home),
            winner: Boolean(home?.winner),
          },
          awayTeam: {
            id: String(away?.team?.id || ''),
            name: String(away?.team?.displayName || away?.team?.name || 'Away'),
            shortName: String(away?.team?.abbreviation || 'AWY'),
            logo: away?.team?.logos?.[0]?.href || away?.team?.logo || undefined,
            score: parseScore(away),
            winner: Boolean(away?.winner),
          },
        };
      });

      const standings = extractStandingsRowsServer(standingsRes);
      const standingRow = standings.find((r) => r.teamId === teamId);

      const nextEv = Array.isArray(t?.nextEvent) && t.nextEvent[0]
        ? {
            id: String(t.nextEvent[0]?.id || ''),
            name: String(t.nextEvent[0]?.name || ''),
            dateIso: String(t.nextEvent[0]?.date || ''),
            venue: t.nextEvent[0]?.competitions?.[0]?.venue?.fullName || undefined,
          }
        : undefined;

      const payload = {
        team: {
          id: String(t?.id || teamId),
          name: String(t?.displayName || t?.name || 'Team'),
          shortName: String(t?.abbreviation || t?.shortDisplayName || ''),
          logo: t?.logos?.[0]?.href || undefined,
          color: t?.color ? `#${t.color}` : undefined,
          leagueSlug: league,
          leagueName: String(t?.defaultLeague?.name || scheduleRes?.team?.league?.name || league),
          standingSummary: t?.standingSummary ? String(t.standingSummary) : undefined,
          recordSummary: overallRecord?.summary ? String(overallRecord.summary) : undefined,
          coach: coachName,
          venue: t?.venue?.fullName || standingRow?.note || undefined,
          stats: {
            gamesPlayed: recordStats.get('gamesPlayed') || standingRow?.played || '0',
            wins: recordStats.get('wins') || standingRow?.wins || '0',
            draws: recordStats.get('ties') || standingRow?.draws || '0',
            losses: recordStats.get('losses') || standingRow?.losses || '0',
            points: recordStats.get('points') || standingRow?.points || '0',
            goalsFor: recordStats.get('pointsFor') || standingRow?.goalsFor || '0',
            goalsAgainst: recordStats.get('pointsAgainst') || standingRow?.goalsAgainst || '0',
            goalDiff: recordStats.get('pointDifferential') || standingRow?.goalDiff || '0',
            homeRecord: `${recordStats.get('homeWins') || '0'}W-${recordStats.get('homeTies') || '0'}D-${recordStats.get('homeLosses') || '0'}L`,
            awayRecord: `${recordStats.get('awayWins') || '0'}W-${recordStats.get('awayTies') || '0'}D-${recordStats.get('awayLosses') || '0'}L`,
          },
          nextEvent: nextEv,
        },
        roster: athletes,
        schedule: scheduleEvents,
        standings,
        updatedAt: Date.now(),
      };

      teamProfileCache.set(cacheKey, { data: payload, updatedAt: Date.now() });
      res.json(payload);
    } catch (error: any) {
      res.status(500).json({ error: extractReadableError(error) });
    }
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

  app.post('/api/tts', async (req: Request, res: Response) => {
    try {
      const { text, voiceType, customApiKey, customApiKeys } = (req.body || {}) as {
        text?: string;
        voiceType?: 'female' | 'male' | 'child';
        customApiKey?: string;
        customApiKeys?: string[];
      };

      if (!text || typeof text !== 'string' || !text.trim()) {
        res.status(400).json({ error: 'Nta nyandiko yo gusoma yabonetse.' });
        return;
      }

      const availableKeys = getServerApiKeys(customApiKeys || customApiKey);
      if (availableKeys.length === 0) {
        res.status(500).json({ error: 'Nta kevin API key yabonetse. Nyamuneka yishyireho muri Settings > Secrets panel.' });
        return;
      }

      const cleanSpoken = text
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/^\s*[-*•]\s+/gm, '. ')
        .replace(/(\d+)\s*%/g, '$1 ku ijana')
        .replace(/\s*&\s*/g, ' na ')
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, ' ')
        .replace(/\r?\n+/g, '. ')
        .replace(/\.\s*\./g, '.')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 2200);

      if (!cleanSpoken) {
        res.status(400).json({ error: 'Nta magambo yo gusoma abonetse.' });
        return;
      }

      const selectedVoice = voiceType === 'male' ? 'male' : voiceType === 'child' ? 'child' : 'female';

      const voiceConfigMap = {
        female: {
          models: ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'],
          voiceNames: ['Kore', 'Zephyr'],
          style:
            "Warm, articulate adult Rwandan woman (age ~28) from Kigali speaking fluent, authentic native Kinyarwanda (Ikinyarwanda cy'umwimerere). Pronounce Kinyarwanda vowels (a, e, i, o, u), tonal cadence, and consonant clusters (cy, by, ry, ny, sh, shy, pf, ts, mp, mb, nd, ng, rw, bw, tw, mw, kw) naturally and smoothly like a native Rwandan speaker. Speak any embedded English or French words cleanly.",
        },
        male: {
          models: ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'],
          voiceNames: ['Charon', 'Fenrir'],
          style:
            "Warm, confident, deep adult Rwandan man (age ~32) from Kigali speaking fluent, authentic native Kinyarwanda (Ikinyarwanda cy'umwimerere). Pronounce Kinyarwanda vowels (a, e, i, o, u), tonal rhythm, and consonant clusters (cy, by, ry, ny, sh, shy, pf, ts, mp, mb, nd, ng, rw, bw, tw, mw, kw) clearly with steady, natural Rwandan intonation. Speak any embedded English or French words cleanly.",
        },
        child: {
          models: ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'],
          voiceNames: ['Zephyr', 'Puck'],
          style:
            "Bright, cheerful, natural young Rwandan child (age 8 to 10) from Kigali with a genuinely youthful, higher-pitched child voice timbre, speaking fluent, authentic native Kinyarwanda (Ikinyarwanda cy'umwimerere). Articulate Kinyarwanda vowels (a, e, i, o, u) and consonant clusters (cy, by, ry, ny, sh, shy, pf, ts, mp, mb, nd, ng, rw, bw, tw, mw, kw) cleanly with natural childlike warmth and clarity.",
        },
      } as const;

      const profile = voiceConfigMap[selectedVoice];
      const invalidKeys = new Set<string>();
      let lastErr: unknown = null;

      for (const model of profile.models) {
        for (const voiceName of profile.voiceNames) {
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
              const ttsPromise = ai.models.generateContent({
                model,
                contents: [
                  {
                    role: 'user',
                    parts: [
                      {
                        text: cleanSpoken,
                        speechMetadata: {
                          style: profile.style,
                        },
                      } as any,
                    ],
                  },
                ],
                config: {
                  responseModalities: ['AUDIO'],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName },
                    },
                  },
                },
              });
              ttsPromise.catch(() => {});

              const response = await Promise.race([
                ttsPromise,
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('503 TTS timed out')), 24000)
                ),
              ]);

              const parts = response.candidates?.[0]?.content?.parts || [];
              const audioPart = parts.find((p: any) => p?.inlineData?.data);
              const rawBase64 = audioPart?.inlineData?.data;
              const rawMime = audioPart?.inlineData?.mimeType || 'audio/wav';

              if (rawBase64 && rawBase64.length > 100) {
                let finalBase64 = rawBase64;
                let finalMime = rawMime;
                const buf = Buffer.from(rawBase64, 'base64');
                const isRiff = buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === 'RIFF';

                if (!isRiff && (rawMime.toLowerCase().includes('l16') || rawMime.toLowerCase().includes('pcm'))) {
                  const header = Buffer.alloc(44);
                  const dataSize = buf.length;
                  const sampleRate = 24000;
                  const numChannels = 1;
                  const bitsPerSample = 16;
                  header.write('RIFF', 0);
                  header.writeUInt32LE(36 + dataSize, 4);
                  header.write('WAVE', 8);
                  header.write('fmt ', 12);
                  header.writeUInt32LE(16, 16);
                  header.writeUInt16LE(1, 20);
                  header.writeUInt16LE(numChannels, 22);
                  header.writeUInt32LE(sampleRate, 24);
                  header.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
                  header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
                  header.writeUInt16LE(bitsPerSample, 34);
                  header.write('data', 36);
                  header.writeUInt32LE(dataSize, 40);
                  finalBase64 = Buffer.concat([header, buf]).toString('base64');
                  finalMime = 'audio/wav';
                }

                res.json({
                  audioBase64: finalBase64,
                  mimeType: finalMime.startsWith('audio/') ? finalMime : 'audio/wav',
                  voiceType: selectedVoice,
                });
                return;
              }
            } catch (err: any) {
              lastErr = err;
              const msg = extractReadableError(err).toLowerCase();
              const combined = `${msg} ${(err?.message || '').toLowerCase()}`;
              if (err?.status === 400 || err?.status === 403 || combined.includes('api key')) {
                invalidKeys.add(key);
              }
              if (err?.status === 404 || combined.includes('not_found')) {
                break;
              }
            }
          }
          // Try next key or next model/voice cleanly
        }
      }

      res.status(500).json({ error: extractReadableError(lastErr || 'Ntibyashobotse gukora ijwi.') });
    } catch (error: any) {
      console.error('Server /api/tts error:', error);
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
          error: 'Nta kevin API key yabonetse. Nyamuneka yishyireho muri Settings > Secrets panel.',
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

      const latestUserText = Array.isArray(contents) && contents.length > 0
        ? ((contents[contents.length - 1] as any)?.parts || [])
            .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
            .join(' ')
            .trim()
        : '';
      const turnLang = detectServerTurnLanguage(latestUserText);
      const turnLanguageDirective = buildServerPerTurnLanguageDirective(turnLang, Boolean(hasAudioAttachment));
      const safeUserName = typeof userName === 'string' && userName.trim()
        ? userName.trim()
        : (turnLang === 'en' ? 'Friend' : 'Incuti yanjye');
      const usernameContext = `The person currently chatting with you is named '${safeUserName}'. Always address them politely by their name during the conversation to make it personal and natural.`;
      const customInstructionsContext = typeof customInstructions === 'string' && customInstructions.trim()
        ? `USER CUSTOM INSTRUCTIONS:\n${customInstructions.trim()}\nFollow these instructions in addition to the core Izi AI persona, without ignoring the creator profile, language fluency, real-time context, or other system requirements.`
        : '';
      const audioInstruction = hasAudioAttachment
        ? `[KINYARWANDA & MULTILINGUAL VOICE NOTE COMPREHENSION]:
- The user sent a recorded voice message in audio format (most commonly spoken in native Rwandan Kinyarwanda, English, or Kinyarwanda mixed with French/English).
- ALWAYS listen directly to the attached raw audio recording as your PRIMARY source of truth—even if a preliminary text transcript draft is also provided. If the preliminary transcript misheard any Kinyarwanda word, prefix, Rwandan name, or command, trust what you hear in the raw audio!
- Pay close attention to authentic Kinyarwanda phonetics, prefixes, consonant clusters, and Rwandan names without mishearing Kinyarwanda speech as unrelated English words.
- CRITICAL ANTI-WRONG-ACTION GUARDRAIL: NEVER execute or call any device tool (make_call, send_sms, open_whatsapp, open_youtube, scan_whatsapp_chats, configure_whatsapp_autoreply, open_camera, open_app) UNLESS the user's voice message explicitly and unmistakably commanded that exact action in the audio.
- If the audio is a greeting, a normal question, or a conversation, DO NOT trigger any tool — reply naturally in the EXACT language spoken by the user in the audio (Kinyarwanda if spoken in Kinyarwanda, English if spoken in English). If the audio is completely silent or unintelligible, politely ask them to repeat clearly in their language.
- NEVER invent a phone number, contact name, song, or message that was not clearly spoken.`
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
      const buildServerFootballContext = (text = ''): string => {
        const isFootballQuery = /(?:football|soccer|umupira|match|matches|score|scores|live\s*score|imikino|shampiyona|standings|lineup|arsenal|chelsea|man\s*(?:city|utd)|real\s*madrid|barcelona|liverpool|bayern|psg|juventus|inter|milan|rayon|apr|premier\s*league|champions\s*league|la\s*liga|serie\s*a|bundesliga|ligue\s*1|eredivisie|afcon|caf|watsinze|yatsinze|batsinze|gutsinda|igitego|ibitego|table|amanota)/i.test(text);
        if (!isFootballQuery || !liveScoresCache || !Array.isArray(liveScoresCache.matches) || liveScoresCache.matches.length === 0) {
          return '';
        }
        const liveMatches = liveScoresCache.matches.filter((m: any) => m.statusState === 'in');
        const postMatches = liveScoresCache.matches.filter((m: any) => m.statusState === 'post').slice(0, 15);
        const preMatches = liveScoresCache.matches.filter((m: any) => m.statusState === 'pre').slice(0, 10);

        const lines: string[] = ['[REAL-TIME FOOTBALL LIVE SCORE & RESULTS DATABASE (DIRECT ACCESS)]:'];
        lines.push('You have complete, direct access to the live score database for European & African football:');
        if (liveMatches.length > 0) {
          lines.push('LIVE MATCHES HAPPENING RIGHT NOW:');
          for (const m of liveMatches) {
            const goals = Array.isArray(m.events)
              ? m.events.filter((e: any) => e.type === 'goal' || e.type === 'penalty').map((e: any) => `${e.playerName} ${e.minute}`).join(', ')
              : '';
            lines.push(`• [LIVE ${m.clock || m.statusDetail}] ${m.homeTeam.name} ${m.homeTeam.score} - ${m.awayTeam.score} ${m.awayTeam.name} (${m.leagueName})${goals ? ` [Goals: ${goals}]` : ''}`);
          }
        } else {
          lines.push('CURRENT LIVE MATCHES: Nta mukino uri kuba LIVE muri aka kanya.');
        }

        if (postMatches.length > 0) {
          lines.push('\nRECENT FINISHED MATCH RESULTS (UKO BYAGENZE):');
          for (const m of postMatches.slice(0, 10)) {
            const goals = Array.isArray(m.events)
              ? m.events.filter((e: any) => e.type === 'goal' || e.type === 'penalty').map((e: any) => `${e.playerName} ${e.minute}`).join(', ')
              : '';
            lines.push(`• [FT] ${m.homeTeam.name} ${m.homeTeam.score} - ${m.awayTeam.score} ${m.awayTeam.name} (${m.leagueName})${goals ? ` [Goals: ${goals}]` : ''}`);
          }
        }

        if (preMatches.length > 0) {
          lines.push('\nUPCOMING SCHEDULED MATCHES:');
          for (const m of preMatches.slice(0, 8)) {
            lines.push(`• ${m.homeTeam.name} vs ${m.awayTeam.name} (${m.leagueName}) - ${m.dateIso}`);
          }
        }

        lines.push('\nWhen the user asks in Kinyarwanda or English about football scores, match results, how a game went ("uko byagenze"), who scored, or upcoming games, use these exact real facts and numbers directly!');
        return lines.join('\n');
      };

      const footballContext = buildServerFootballContext(latestUserText);

      const systemInstruction = [
        turnLanguageDirective,
        KEVIN_SYSTEM_INSTRUCTION,
        usernameContext,
        customInstructionsContext,
        audioInstruction,
        contactsContext,
        agentContext,
        footballContext,
        realTimeContext,
        turnLanguageDirective,
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
      const isExplicitDeviceCommand = /(?:hamagar|terefon|oherez|curang|subiriz|budasubij|indirimbo|muzika|umuzik|miziki|ijwi|komeza|subiramo|ongeraho|fungur|fungir|shakish|nshakir|mpamagar|umvir|urutonde|auto[\s_-]*reply)|\b(call|dial|sms|send|whatsapp|youtube|play|song|music|audio\s*mack|audiomack|lark\s*player|larkplayer|lark|playlist|shuffle|repeat|loop|equalizer|eq|bass\s*boost|virtualizer|surround|reverb|loudness|preamp|treble|sleep\s*timer|lyrics|queue|next|previous|prev|volume|mute|unmute|favorite|repost|follow|download|offline|trending|library|ringtone|artists|albums|folders|now\s*playing|kamera|camera|funga|hagarika|pause|stop|resume|subukura|open|instagram|tiktok|spotify|maps|facebook|chrome|settings|subiza|unread)\b/i.test(latestUserText) || /(?:60\s*hz|230\s*hz|910\s*hz|3\.6\s*khz|14\s*khz)/i.test(latestUserText) || (/\bbass\b/i.test(latestUserText) && /(?:ongera|gabanya|shyira|hindur|fungur|funga|zimya|\bboost\b|\bset\b|\d+\s*%)/i.test(latestUserText));
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
              let emittedFunctionCallCount = 0;
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
                    emittedFunctionCallCount += functionCalls.length;
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
                  if (emittedFunctionCallCount === 0) {
                    const fallbackCall = inferServerFallbackDeviceAction(latestUserText);
                    if (fallbackCall) {
                      emittedFunctionCallCount++;
                      await writePayloadChunk([fallbackCall]);
                    }
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
    startDailyNewsScheduler(() => getServerApiKeys());

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
