import {
  getGeminiApiKeysArray,
  getUserCustomApiKey,
  isCapacitorApkRuntime,
  resolveApiEndpoint,
} from './geminiService';

export type KevinTtsVoiceType = 'female' | 'male' | 'child';

export interface KevinTtsVoiceOption {
  id: KevinTtsVoiceType;
  label: string;
  subtitle: string;
  emoji: string;
}

export const KEVIN_TTS_VOICE_OPTIONS: KevinTtsVoiceOption[] = [
  {
    id: 'female',
    label: "Ijwi ry'Umugore",
    subtitle: 'Ikinyarwanda gisukuye & gituje',
    emoji: '👩',
  },
  {
    id: 'male',
    label: "Ijwi ry'Umugabo",
    subtitle: 'Ijwi rikomeye kandi risobanutse',
    emoji: '👨',
  },
  {
    id: 'child',
    label: "Ijwi ry'Umwana",
    subtitle: 'Ijwi rito ryishimye kandi ryoroshye',
    emoji: '🧒',
  },
];

const VOICE_STYLE_PROFILES: Record<
  KevinTtsVoiceType,
  { models: string[]; voiceNames: string[]; style: string }
> = {
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
};

export function cleanTextForSpeech(rawText: string): string {
  if (!rawText) return '';
  return rawText
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
    .trim();
}

function splitIntoSpeechChunks(cleanText: string, maxChunkChars = 850): string[] {
  if (!cleanText) return [];
  if (cleanText.length <= maxChunkChars) return [cleanText];

  const sentences = cleanText.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    if ((current ? `${current} ${trimmed}` : trimmed).length <= maxChunkChars) {
      current = current ? `${current} ${trimmed}` : trimmed;
    } else {
      if (current) chunks.push(current);
      if (trimmed.length <= maxChunkChars) {
        current = trimmed;
      } else {
        for (let i = 0; i < trimmed.length; i += maxChunkChars) {
          chunks.push(trimmed.slice(i, i + maxChunkChars));
        }
        current = '';
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.slice(0, 8);
}

const audioUrlCache = new Map<string, string>();
let activeAbortController: AbortController | null = null;
let activeAudioEl: HTMLAudioElement | null = null;
let activePlaybackToken = 0;
let activeOnStopCallback: (() => void) | null = null;

function base64ToWavUrl(audioBase64: string, mimeType = 'audio/wav'): string {
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const isRiff =
    bytes.length >= 4 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46;

  let finalBytes: Uint8Array = bytes;
  let finalMime = mimeType || 'audio/wav';

  if (!isRiff && (finalMime.toLowerCase().includes('l16') || finalMime.toLowerCase().includes('pcm'))) {
    const wavBytes = new Uint8Array(44 + bytes.length);
    const view = new DataView(wavBytes.buffer);
    const writeAscii = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) wavBytes[offset + i] = str.charCodeAt(i);
    };
    writeAscii(0, 'RIFF');
    view.setUint32(4, 36 + bytes.length, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 24000, true);
    view.setUint32(28, 48000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(36, 'data');
    view.setUint32(40, bytes.length, true);
    wavBytes.set(bytes, 44);
    finalBytes = wavBytes;
    finalMime = 'audio/wav';
  }

  const normalizedBuffer = new ArrayBuffer(finalBytes.byteLength);
  new Uint8Array(normalizedBuffer).set(finalBytes);
  const blob = new Blob([normalizedBuffer], { type: finalMime });
  return URL.createObjectURL(blob);
}

async function synthesizeChunkAudioUrl(
  chunkText: string,
  voiceType: KevinTtsVoiceType,
  signal: AbortSignal
): Promise<string> {
  const cacheKey = `${voiceType}::${chunkText}`;
  const cached = audioUrlCache.get(cacheKey);
  if (cached) return cached;

  const customApiKey = getUserCustomApiKey();
  const customApiKeys = getGeminiApiKeysArray();

  // 1. Call server-side /api/tts endpoint
  try {
    const res = await fetch(resolveApiEndpoint('/api/tts'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: chunkText,
        voiceType,
        customApiKey,
        customApiKeys,
      }),
      signal,
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.audioBase64) {
        const url = base64ToWavUrl(data.audioBase64, data.mimeType || 'audio/wav');
        if (audioUrlCache.size > 40) {
          const oldestKey = audioUrlCache.keys().next().value;
          if (oldestKey) {
            const oldUrl = audioUrlCache.get(oldestKey);
            if (oldUrl) URL.revokeObjectURL(oldUrl);
            audioUrlCache.delete(oldestKey);
          }
        }
        audioUrlCache.set(cacheKey, url);
        return url;
      }
    } else if (!isCapacitorApkRuntime() || customApiKeys.length === 0) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson?.error || 'Ntibyashobotse gukora ijwi.');
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    if (!isCapacitorApkRuntime() || customApiKeys.length === 0) {
      throw err instanceof Error ? err : new Error('Ntibyashobotse gukora ijwi.');
    }
  }

  // 2. Capacitor APK fallback with user's custom key if remote backend hasn't deployed /api/tts yet
  const profile = VOICE_STYLE_PROFILES[voiceType];
  let lastErr: Error | null = null;
  for (const model of profile.models) {
    for (const voiceName of profile.voiceNames) {
      for (const apiKey of customApiKeys) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [
                  {
                    role: 'user',
                    parts: [
                      {
                        text: chunkText,
                        speechMetadata: { style: profile.style },
                      },
                    ],
                  },
                ],
                generationConfig: {
                  responseModalities: ['AUDIO'],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName },
                    },
                  },
                },
              }),
              signal,
            }
          );
          if (!res.ok) continue;
          const json = await res.json();
          const parts = json?.candidates?.[0]?.content?.parts || [];
          const audioPart = parts.find((p: any) => p?.inlineData?.data);
          if (audioPart?.inlineData?.data) {
            const url = base64ToWavUrl(
              audioPart.inlineData.data,
              audioPart.inlineData.mimeType || 'audio/wav'
            );
            audioUrlCache.set(cacheKey, url);
            return url;
          }
        } catch (err: any) {
          if (err?.name === 'AbortError') throw err;
          lastErr = err instanceof Error ? err : new Error('TTS request failed');
        }
      }
    }
  }

  throw lastErr || new Error('Ntibyashobotse kubona ijwi. Reba interineti cyangwa API key.');
}

export function stopReplySpeech(): void {
  activePlaybackToken++;
  if (activeAbortController) {
    try {
      activeAbortController.abort();
    } catch {}
    activeAbortController = null;
  }
  if (activeAudioEl) {
    try {
      activeAudioEl.onended = null;
      activeAudioEl.onerror = null;
      activeAudioEl.pause();
      activeAudioEl.currentTime = 0;
    } catch {}
    activeAudioEl = null;
  }
  if (activeOnStopCallback) {
    const cb = activeOnStopCallback;
    activeOnStopCallback = null;
    cb();
  }
}

export async function speakReplyText(
  rawText: string,
  voiceType: KevinTtsVoiceType,
  callbacks?: {
    onPlaybackStarted?: () => void;
    onFinished?: () => void;
    onError?: (message: string) => void;
  }
): Promise<void> {
  stopReplySpeech();

  const cleanText = cleanTextForSpeech(rawText);
  if (!cleanText) {
    callbacks?.onError?.('Nta magambo yo gusoma ari muri ubu butumwa.');
    return;
  }

  const chunks = splitIntoSpeechChunks(cleanText, 850);
  if (chunks.length === 0) {
    callbacks?.onError?.('Nta magambo yo gusoma ari muri ubu butumwa.');
    return;
  }

  const myToken = activePlaybackToken;
  const controller = new AbortController();
  activeAbortController = controller;
  activeOnStopCallback = () => {
    callbacks?.onFinished?.();
  };

  try {
    let nextPromise: Promise<string> | null = synthesizeChunkAudioUrl(
      chunks[0],
      voiceType,
      controller.signal
    );

    for (let i = 0; i < chunks.length; i++) {
      if (myToken !== activePlaybackToken || controller.signal.aborted) return;

      const audioUrl = await nextPromise!;
      if (myToken !== activePlaybackToken || controller.signal.aborted) return;

      // Prefetch next chunk while playing current chunk
      nextPromise =
        i + 1 < chunks.length
          ? synthesizeChunkAudioUrl(chunks[i + 1], voiceType, controller.signal)
          : null;

      if (i === 0) {
        callbacks?.onPlaybackStarted?.();
      }

      await new Promise<void>((resolve, reject) => {
        if (myToken !== activePlaybackToken) {
          resolve();
          return;
        }
        const audio = new Audio(audioUrl);
        activeAudioEl = audio;
        audio.onended = () => {
          if (activeAudioEl === audio) activeAudioEl = null;
          resolve();
        };
        audio.onerror = () => {
          if (activeAudioEl === audio) activeAudioEl = null;
          reject(new Error('Byanze gucuranga ijwi kuri iyi telefone.'));
        };
        const playResult = audio.play();
        if (playResult && typeof playResult.catch === 'function') {
          playResult.catch((err) => {
            if (activeAudioEl === audio) activeAudioEl = null;
            reject(err);
          });
        }
      });
    }

    if (myToken === activePlaybackToken) {
      activeAbortController = null;
      activeOnStopCallback = null;
      callbacks?.onFinished?.();
    }
  } catch (err: any) {
    if (err?.name === 'AbortError' || myToken !== activePlaybackToken) return;
    activeAbortController = null;
    activeAudioEl = null;
    activeOnStopCallback = null;
    const msg = err instanceof Error ? err.message : 'Ntibyashobotse gusoma ubutumwa.';
    callbacks?.onError?.(msg);
  }
}
