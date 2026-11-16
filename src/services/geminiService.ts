import { FunctionDeclaration, GoogleGenAI } from '@google/genai';
import kevin1Url from '../assets/kevin_1.jpg';
import kevin2Url from '../assets/kevin_2.jpg';
import kevin3Url from '../assets/kevin_3.jpg';

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

2. TONE & COMMUNICATION STYLE:
- Natural WhatsApp Vibe: Communicate naturally, concisely, and warmly like a smart companion on WhatsApp.
- Natural Emojis: Enrich responses with fitting, expressive emojis (e.g., 💡, 💻, 🚀, 📸, ✨, 😊, 🇷🇼).
- Concise Greetings Rule:
  * When greeted ('Hello', 'Muraho', 'Bite', 'Hi'): Keep it short and warm in 1 to 2 sentences (e.g., 'Muraho! 👋 Amakuru ki? Nakufasha iki uyu munsi? 😊').
  * NEVER dump a list of features or capabilities unprompted. Only explain what you do if explicitly asked.

3. MULTILINGUAL FLUENCY:
- Native Multilingualism: Understand and respond fluently in the language the user speaks (Kinyarwanda, English, French, Swahili, or natural mixed code-switching).
- If the user speaks Kinyarwanda, reply in rich, natural Kinyarwanda. If in English, reply in clean, modern English.

4. VOICE NOTE PROCESSING:
- When the user sends a voice note/audio message, listen to it, understand what they said in Kinyarwanda or English, and answer them directly in the chat.

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

DEVICE ACTIONS:
You have direct control over device apps. When the user asks you to open YouTube, play music, open Audiomack, Lark Player, WhatsApp, camera, or make a call in Kinyarwanda or English (e.g. 'fungura youtube uncurangire...', 'fungura audiomack', 'hamagara...', 'fungura lark player'), ALWAYS trigger the corresponding action function to immediately execute it on the user's device, while confirming warmly in your response.`;

export interface AttachmentItem {
  data?: string;
  base64?: string;
  blob?: Blob;
  mimeType: string;
  name?: string;
  size?: string;
  textContent?: string;
}

export const CHAT_HISTORY_STORAGE_KEY = 'kevin_ai_chat_history';

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
  args: Record<string, string>;
  label: string;
  url?: string;
  intentUrl?: string;
  fallbackUrl?: string;
}

const deviceActionDeclarations: FunctionDeclaration[] = [
  { name: "open_youtube", description: "Immediately open and autoplay the requested song or video on YouTube.", parametersJsonSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "open_audiomack", description: "Immediately open Audiomack and search for the requested song or artist.", parametersJsonSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "open_lark_player", description: "Open Lark Player and optionally search for the requested song or artist.", parametersJsonSchema: { type: "object", properties: { query: { type: "string" } } } },
  { name: "make_call", description: "Immediately open the native phone dialer for the supplied phone number or contact name.", parametersJsonSchema: { type: "object", properties: { phone_number: { type: "string" } }, required: ["phone_number"] } },
  { name: "open_whatsapp", description: "Open WhatsApp with a prefilled message.", parametersJsonSchema: { type: "object", properties: { phone_number: { type: "string" }, message: { type: "string" } }, required: ["phone_number", "message"] } },
  { name: "open_camera", description: "Open the device camera.", parametersJsonSchema: { type: "object", properties: {} } },
  { name: "open_app", description: "Open a common device app such as Instagram, TikTok, Spotify, or Maps.", parametersJsonSchema: { type: "object", properties: { app_name: { type: "string" } }, required: ["app_name"] } },
];

export function runDeviceAction(action: DeviceAction): boolean {
  const intentUrl = action.intentUrl;
  const fallbackUrl = action.fallbackUrl || action.url;

  if (action.name === 'open_camera') {
    window.dispatchEvent(new CustomEvent("open-device-camera"));
    return true;
  }
  if (!intentUrl && !fallbackUrl) return false;

  if (action.name === 'make_call' && fallbackUrl) {
    window.location.assign(fallbackUrl);
    return true;
  }

  if (intentUrl) {
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
    const openedWindow = window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
    if (!openedWindow) {
      window.location.assign(fallbackUrl);
    }
    return true;
  }
  return false;
}

function executeDeviceAction(name: string, args: Record<string, string>): DeviceAction | null {
  const query = args.query || "";
  const phoneNumber = args.phone_number || "";
  const appName = (args.app_name || "").toLowerCase();
  let url: string | undefined;
  let intentUrl: string | undefined;
  let fallbackUrl: string | undefined;
  let label = name;

  if (name === "open_youtube") {
    const encodedQuery = encodeURIComponent(query);
    intentUrl = `vnd.youtube://results?search_query=${encodedQuery}&autoplay=1`;
    fallbackUrl = `https://www.youtube.com/results?search_query=${encodedQuery}&autoplay=1`;
    url = fallbackUrl;
    label = `YouTube: ${query}`;
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
  } else if (name === "make_call") {
    url = `tel:${phoneNumber}`;
    label = `Hamagara ${phoneNumber}`;
  } else if (name === "open_whatsapp") {
    url = `https://wa.me/${phoneNumber.replace(/[^\d]/g, "")}?text=${encodeURIComponent(args.message || "")}`;
    label = `WhatsApp: ${phoneNumber}`;
  } else if (name === "open_camera") {
    label = "Camera";
    const action = { name, args, label };
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
  };
  runDeviceAction(action);
  return action;
}

function actionConfirmation(action: DeviceAction): string {
  if (action.name === "make_call") return `Ndaguhamagariye ${action.args.phone_number}! 📞🚀`;
  if (action.name === "open_whatsapp") return "Nfunguriye WhatsApp ubutumwa bwawe! 💬🚀";
  if (action.name === "open_camera") return "Nfunguriye camera yawe! 📸🚀";
  if (action.name === "open_youtube") return "Ndasize nshakiye kuri YouTube kandi ndayifunguye ngo icurangwe!";
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

const getAvailableKeys = (): string[] => {
  const customUserKey = typeof window !== 'undefined'
    ? localStorage.getItem('gemini_api_key')
      || localStorage.getItem('kevin_ai_custom_api_key')
      || localStorage.getItem('user_api_key')
      || localStorage.getItem('apiKey')
    : null;
  const keys = [
    customUserKey,
    import.meta.env.VITE_GEMINI_API_KEY,
    import.meta.env.VITE_GEMINI_API_KEY_BACKUP,
    import.meta.env.VITE_GEMINI_API_KEY_BACKUP_2,
  ];
  return Array.from(new Set(
    keys.filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
      .map(k => k.trim())
  ));
};

function getUserCustomInstructions(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('kevin_custom_instructions')?.trim()
    || localStorage.getItem('kevin_ai_custom_instructions')?.trim()
    || '';
}

export function getApiKeysList(): string[] {
  return getAvailableKeys();
}

function getClientForApiKey(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      apiVersion: "v1beta",
      headers: { "User-Agent": "aistudio-build" },
    },
  });
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

export interface VoiceRecordingSession {
  mimeType: string;
  stop: () => Promise<Blob>;
  cancel: () => void;
}

export async function createVoiceRecordingSession(): Promise<VoiceRecordingSession> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('Audio recording is not supported on this device.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const supportedMimeType = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ].find(type => MediaRecorder.isTypeSupported(type)) || '';

  const recorder = new MediaRecorder(
    stream,
    supportedMimeType ? { mimeType: supportedMimeType } : undefined
  );
  const recorderMimeType = (recorder.mimeType || supportedMimeType || 'audio/webm').split(';')[0];
  const chunks: Blob[] = [];
  let cancelled = false;
  let settled = false;
  let stopRequested = false;
  let resolveStop: (blob: Blob) => void = () => undefined;
  let rejectStop: (error: Error) => void = () => undefined;
  const stopped = new Promise<Blob>((resolve, reject) => {
    resolveStop = resolve;
    rejectStop = reject;
  });

  const cleanup = () => {
    stream.getTracks().forEach(track => track.stop());
  };
  const settle = (blob: Blob) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveStop(blob);
  };

  recorder.ondataavailable = event => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };
  recorder.onerror = () => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectStop(new Error('Microphone recording failed.'));
  };
  recorder.onstop = () => {
    settle(cancelled
      ? new Blob([], { type: recorder.mimeType || supportedMimeType || 'audio/webm' })
      : new Blob(chunks, { type: recorder.mimeType || supportedMimeType || 'audio/webm' }));
  };
  recorder.start(250);

  return {
    mimeType: recorderMimeType,
    stop: () => {
      if (recorder.state === 'inactive') {
        return Promise.resolve(new Blob(chunks, {
          type: recorderMimeType,
        }));
      }
      if (!stopRequested) {
        stopRequested = true;
        recorder.stop();
      }
      return stopped;
    },
    cancel: () => {
      cancelled = true;
      if (recorder.state === 'inactive') {
        cleanup();
        return;
      }
      if (!stopRequested) {
        stopRequested = true;
        recorder.stop();
      }
    },
  };
}

export async function sendMessageToGemini(
  history: { sender: 'user' | 'kevin'; text: string; image?: string }[],
  latestMessage: string,
  onChunk?: (chunk: string) => void,
  attachments?: AttachmentItem | Blob | Array<AttachmentItem | Blob> | null,
  selectedModel?: string,
  onAction?: (action: DeviceAction) => void
): Promise<string> {
  const availableKeys = getAvailableKeys();
  if (availableKeys.length === 0) {
    throw new Error("Nta Gemini API key yabonetse. Nyamuneka yishyireho muri Settings > Secrets panel.");
  }

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
  const hasAudioAttachment = attachmentList.some(attachment => {
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
      ? 'Listen to this voice message, understand it in Kinyarwanda or English, and reply naturally.'
      : hasImageAttachment
        ? 'Please analyze these images.'
        : ''
  );
  const parts: any[] = prompt ? [{ text: prompt }] : [];
  for (const attachment of attachmentList) {
    if (!attachment || typeof attachment !== "object") continue;
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
      mimeType = attachment.type || 'audio/webm';
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
      } else {
        data = cleanBase64(attachmentWithBlob.data || attachmentWithBlob.base64 || "");
      }
      mimeType = attachmentWithBlob.mimeType || mimeType;
    }
    if (!data) continue;
    parts.push({
      inlineData: {
        mimeType: mimeType.split(';')[0],
        data,
      },
    });
  }
  contents.push({ role: "user", parts });

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
  const userName = typeof window !== 'undefined'
    ? localStorage.getItem('kevin_user_name') || localStorage.getItem('kevin_ai_user_name') || 'Incuti yanjye'
    : 'Incuti yanjye';
  const usernameContext = `The person currently chatting with you is named '${userName}'. Always address them politely by their name during the conversation to make it personal and natural.`;
  const customInstructions = getUserCustomInstructions();
  const customInstructionsContext = customInstructions
    ? `USER CUSTOM INSTRUCTIONS:\n${customInstructions}\nFollow these instructions in addition to the core Kevin AI persona, without ignoring the creator profile, language fluency, real-time context, or other system requirements.`
    : '';
  const systemInstruction = [
    KEVIN_SYSTEM_INSTRUCTION,
    usernameContext,
    customInstructionsContext,
    realTimeContext,
  ].filter(Boolean).join('\n\n');
  /*

IDENTITY & CREATOR PROFILE:
- Name: Kevin AI.
- Creator and developer: Uwumukiza Kevin.
- Motto: "UKORA GAKE BIKAGENDA CYANE".
- Verified creator background:
  - Full name: Uwumukiza Kevin.
  - Date of birth: October 28, 2003.
  - Birthplace: Rwamagana District, Gahengeri Sector, Rwanda.
  - He is the firstborn (Imfura) of five children. He has a twin sister named Aline, younger twin siblings named Helve and Kelly, and the youngest sibling named Barame.
  - Primary school: Nyina wa Jambo Ruhita.
  - Ordinary Level (S1-S3): GS Appagie / Musha.
  - Advanced Level (S4-S6): ES Kabarondo, where he studied MCE (Mathematics, Computer Science, and Economics).
  - Higher education: Currently studying Information Technology at the University of Rwanda, College of Science and Technology (UR-CST).
- When asked who created you, who Kevin is, or about his family or background ("Waremwe nande?", "Kevin ni nde?", "Who made you?"), answer accurately, proudly, and respectfully using these verified facts.

TONE & COMMUNICATION STYLE:
- Communicate naturally, concisely, and warmly like a smart companion on WhatsApp.
- Enrich responses with fitting, expressive emojis such as 💡, 💻, 🚀, 📸, ✨, 😊, and 🇷🇼.
- When greeted with "Hello", "Muraho", "Bite", or "Hi", reply in only 1-2 short, warm sentences.
- Never dump a list of features or capabilities unless explicitly asked.

MULTILINGUAL FLUENCY:
- Understand and respond fluently in Kinyarwanda, English, French, Swahili, and natural mixed code-switching.
- If the user speaks Kinyarwanda, reply in rich, natural Kinyarwanda. If the user speaks English, reply in clean, modern English.

MULTIMODAL & DOCUMENT ANALYSIS:
- When an image, screenshot, or camera capture is attached, thoroughly analyze what you see, including diagrams, code screenshots, and recognizable objects.
- When a live screen capture frame is provided, describe what you see, analyze content, read text/code (OCR), and explain Instagram posts, products, or errors visible on the user's screen in clear Kinyarwanda or English.
- When PDF, Word, or text files are attached, read and summarize them, extract key points, or answer specific questions precisely.

CODE & MATH FORMATTING:
- Format all code snippets in standard fenced code blocks with a language tag, such as \`\`\`python or \`\`\`javascript.
- Format mathematical equations and tabular data with clear, structured Markdown tables and LaTeX notation without clutter.

Always reply directly, politely, and concisely. When spoken to in Kinyarwanda, use natural, authentic Kinyarwanda and never mix it with Turkish or Swahili.`;
  */
  let fullResponse = "";
  let lastErr: any = null;

  for (const key of availableKeys) {
    try {
      const ai = getClientForApiKey(key);
      const responseStream = await ai.models.generateContentStream({
        model: "gemini-2.5-flash",
        contents,
        config: {
          systemInstruction,
          temperature: 0.7,
          tools: [{ functionDeclarations: deviceActionDeclarations }],
        },
      });

      const actions: DeviceAction[] = [];
      for await (const chunk of responseStream) {
        const functionCalls = (chunk as any).functionCalls || [];
        for (const functionCall of functionCalls) {
          const action = executeDeviceAction(functionCall.name, functionCall.args || {});
          if (action) actions.push(action);
        }
        if (chunk.text) {
          fullResponse += chunk.text;
          onChunk?.(chunk.text);
        }
      }
      for (const action of actions) {
        onAction?.(action);
        const confirmation = actionConfirmation(action);
        fullResponse += `\n\n${confirmation}`;
        onChunk?.(`\n\n${confirmation}`);
      }
      return fullResponse;
    } catch (error: any) {
      lastErr = error;
      const errorText = error instanceof Error ? error.message : String(error);
      const isQuotaError = error?.status === 429
        || errorText.includes("429")
        || errorText.includes("RESOURCE_EXHAUSTED")
        || errorText.toLowerCase().includes("quota")
        || errorText.toLowerCase().includes("rate limit");
      if (isQuotaError) {
        console.warn(`Gemini key failed due to rate limit (429). Rotating to next available key...`);
      } else {
        console.warn("Direct key failed:", errorText);
      }
      if (isQuotaError) continue;
      throw error;
    }
  }

  const errorMessage = lastErr instanceof Error
    ? lastErr.message
    : typeof lastErr === 'string'
      ? lastErr
      : lastErr?.error?.message || lastErr?.message;

  throw new Error(errorMessage || "Failed to generate AI response");
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

export function compressImage(file: any): Promise<any> { return Promise.resolve({ base64: "", mimeType: "" }); }
export function generateImagePrompt(text: string): Promise<string> { return Promise.resolve(createEnglishImagePrompt(text)); }
