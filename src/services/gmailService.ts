import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserPopupRedirectResolver,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  PopupRedirectResolver,
  signInWithPopup,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { isCapacitorApkRuntime, sendMessageToGemini } from './geminiService';

export type GmailUser = {
  uid?: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
};

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of GMAIL_SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({
  prompt: 'consent select_account',
  include_granted_scopes: 'true',
});

// Keep OAuth token exclusively in memory (never localStorage or sessionStorage).
let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedNativeUser: GmailUser | null = null;
let activeSignInPromise: Promise<{ user: GmailUser; accessToken: string }> | null = null;
let activePopupConsumer: any = null;
let activeNativeCancel: (() => void) | null = null;

type InternalResolverBase = {
  new (): {
    _initialize(authInstance: any): Promise<any>;
    _openPopup(authInstance: any, authProvider: any, authType: string, eventId: string): Promise<any>;
    _isIframeWebStorageSupported(authInstance: any, cb: (isSupported: boolean) => void): void;
  };
};

const BaseBrowserResolver = browserPopupRedirectResolver as unknown as InternalResolverBase;

/**
 * Guards against two known @firebase/auth popup bugs in cross-origin iframes & Chrome COOP:
 * 1. PopupOperation.onAuthEvent throwing `INTERNAL ASSERTION FAILED: Pending promise was never set`
 *    if `pendingPromise` is cleared while `getIdpTask` is awaiting.
 * 2. Chrome COOP reporting `popup.closed === true` prematurely on accounts.google.com and
 *    _isIframeWebStorageSupported throwing `auth/internal-error` after calling its callback.
 */
class SafePopupRedirectResolver extends BaseBrowserResolver {
  async _initialize(authInstance: any) {
    const manager = await super._initialize(authInstance);
    if (manager && !manager.__iziPatched) {
      manager.__iziPatched = true;
      const origRegisterConsumer = manager.registerConsumer.bind(manager);
      manager.registerConsumer = (consumer: any) => {
        if (consumer && !consumer.__iziPatched) {
          consumer.__iziPatched = true;
          activePopupConsumer = consumer;

          const origResolve = consumer.resolve.bind(consumer);
          const origReject = consumer.reject.bind(consumer);
          const origOnAuthEvent = consumer.onAuthEvent.bind(consumer);
          const origCleanUp = consumer.cleanUp.bind(consumer);

          consumer.resolve = (cred: any) => {
            if (!consumer.pendingPromise) return;
            origResolve(cred);
          };

          consumer.reject = (err: any) => {
            if (!consumer.pendingPromise) return;
            origReject(err);
          };

          consumer.onAuthEvent = async (event: any) => {
            if (!consumer.pendingPromise) return;
            try {
              await origOnAuthEvent(event);
            } catch (err) {
              if (consumer.pendingPromise) {
                origReject(err);
              }
            }
          };

          consumer.cleanUp = () => {
            if (activePopupConsumer === consumer) {
              activePopupConsumer = null;
            }
            origCleanUp();
          };
        }
        return origRegisterConsumer(consumer);
      };
    }
    return manager;
  }

  _isIframeWebStorageSupported(_authInstance: any, cb: (isSupported: boolean) => void) {
    queueMicrotask(() => cb(true));
  }

  async _openPopup(authInstance: any, authProvider: any, authType: string, eventId: string) {
    const authPopup = await super._openPopup(authInstance, authProvider, authType, eventId);
    const realWindow = authPopup?.window;
    if (!realWindow || !authPopup) {
      return authPopup;
    }
    const openedAt = Date.now();
    return {
      associatedEvent: authPopup.associatedEvent ?? null,
      close() {
        try {
          realWindow.close();
        } catch {
          // ignore cross-origin window close errors
        }
      },
      window: {
        get closed() {
          if (Date.now() - openedAt < 120_000) {
            return false;
          }
          try {
            return Boolean(realWindow.closed);
          } catch {
            return true;
          }
        },
        close() {
          try {
            realWindow.close();
          } catch {
            // ignore
          }
        },
        focus() {
          try {
            realWindow.focus();
          } catch {
            // ignore
          }
        },
      },
    };
  }
}

export type GmailMessage = {
  id: string;
  threadId: string;
  from: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  body: string;
  messageIdHeader: string;
  referencesHeader: string;
  unread: boolean;
};

export const initGmailAuth = (
  onAuthSuccess?: (user: GmailUser, token: string) => void,
  onAuthFailure?: (user: GmailUser | null) => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    const activeUser: GmailUser | null = user || cachedNativeUser;
    if (activeUser) {
      if (cachedAccessToken) {
        onAuthSuccess?.(activeUser, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.(activeUser);
      }
    } else if (!isSigningIn) {
      cachedAccessToken = null;
      cachedNativeUser = null;
      onAuthFailure?.(null);
    }
  });
};

const verifyGmailScopes = async (accessToken: string): Promise<string | null> => {
  try {
    const infoRes = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
    );
    if (infoRes.ok) {
      const info = await infoRes.json();
      const granted = String(info?.scope || '').split(/\s+/).filter(Boolean);
      const hasRead =
        granted.includes('https://www.googleapis.com/auth/gmail.readonly') ||
        granted.includes('https://mail.google.com/') ||
        granted.includes('https://www.googleapis.com/auth/gmail.modify');
      const hasSend =
        granted.includes('https://www.googleapis.com/auth/gmail.send') ||
        granted.includes('https://mail.google.com/') ||
        granted.includes('https://www.googleapis.com/auth/gmail.modify');
      if (!hasRead || !hasSend) {
        cachedAccessToken = null;
        throw new Error('GMAIL_MISSING_SCOPES');
      }
      return typeof info?.email === 'string' && info.email ? info.email : null;
    }
  } catch (scopeCheckErr: any) {
    if (scopeCheckErr?.message === 'GMAIL_MISSING_SCOPES') {
      throw scopeCheckErr;
    }
    // If tokeninfo is unreachable, let the Gmail API call proceed directly.
  }
  return null;
};

const fetchGoogleProfileForToken = async (
  accessToken: string,
  fallbackEmail: string | null
): Promise<GmailUser> => {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const profile = await res.json();
      return {
        uid: profile?.sub || undefined,
        email: profile?.email || fallbackEmail,
        displayName: profile?.name || profile?.email || fallbackEmail,
        photoURL: profile?.picture || null,
      };
    }
  } catch {
    // ignore userinfo failure; fall back to tokeninfo email
  }
  return {
    email: fallbackEmail,
    displayName: fallbackEmail,
    photoURL: null,
  };
};

const generateOAuthNonce = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/g, '');
    }
  } catch {
    // fallback below
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
};

const signInWithGoogleForGmailNativeApk = async (bridge: any): Promise<{
  user: GmailUser;
  accessToken: string;
}> => {
  const clientId = String(firebaseConfig.oAuthClientId || '').trim();
  const authDomain = String(firebaseConfig.authDomain || '').trim();
  if (!clientId || !authDomain) {
    throw new Error('Missing Firebase OAuth configuration.');
  }

  const redirectPrefix = `https://${authDomain}/__/auth/handler`;
  const expectedState = generateOAuthNonce();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectPrefix,
    response_type: 'token',
    scope: ['openid', 'email', 'profile', ...GMAIL_SCOPES].join(' '),
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
    state: expectedState,
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  const authDetail = await new Promise<{ accessToken: string }>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.removeEventListener('kevinGmailAuthResult', onResult as EventListener);
      activeNativeCancel = null;
    };

    const onResult = (ev: CustomEvent<any>) => {
      if (settled) return;
      settled = true;
      cleanup();
      const detail = ev?.detail || {};
      if (detail.ok && detail.accessToken) {
        resolve({ accessToken: String(detail.accessToken) });
        return;
      }
      if (detail.cancelled) {
        const cancelErr: any = new Error('Google sign-in cancelled.');
        cancelErr.code = 'auth/popup-closed-by-user';
        reject(cancelErr);
        return;
      }
      const msg = String(detail.errorDescription || detail.error || 'Kwinjira na Google byanze.');
      reject(new Error(msg));
    };

    activeNativeCancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const cancelErr: any = new Error('Google sign-in cancelled.');
      cancelErr.code = 'auth/popup-closed-by-user';
      reject(cancelErr);
    };

    window.addEventListener('kevinGmailAuthResult', onResult as EventListener);
    const launched = bridge.startGmailAuth(authUrl, redirectPrefix, expectedState);
    if (!launched) {
      settled = true;
      cleanup();
      reject(new Error('Failed to launch Google Sign-In screen.'));
    }
  });

  const tokenEmail = await verifyGmailScopes(authDetail.accessToken);
  const profileUser = await fetchGoogleProfileForToken(authDetail.accessToken, tokenEmail);
  cachedAccessToken = authDetail.accessToken;
  cachedNativeUser = profileUser;
  return { user: profileUser, accessToken: cachedAccessToken };
};

export const signInWithGoogleForGmail = async (): Promise<{
  user: GmailUser;
  accessToken: string;
}> => {
  if (activeSignInPromise) {
    return activeSignInPromise;
  }

  activeSignInPromise = (async () => {
    try {
      isSigningIn = true;
      const bridge = typeof window !== 'undefined' ? (window as any).KevinAgentBridge : null;
      if (isCapacitorApkRuntime() && typeof bridge?.startGmailAuth === 'function') {
        return await signInWithGoogleForGmailNativeApk(bridge);
      }

      const result = await signInWithPopup(
        auth,
        provider,
        SafePopupRedirectResolver as unknown as PopupRedirectResolver
      );
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error('Failed to obtain Google OAuth access token.');
      }

      // Verify granted OAuth scopes immediately so missing checkboxes on Google's consent
      // screen give clear instructions instead of a confusing 403 loop.
      await verifyGmailScopes(credential.accessToken);

      cachedAccessToken = credential.accessToken;
      cachedNativeUser = null;
      return { user: result.user, accessToken: cachedAccessToken };
    } finally {
      isSigningIn = false;
      activeSignInPromise = null;
    }
  })();

  return activeSignInPromise;
};

export const cancelGmailSignIn = (): void => {
  try {
    activePopupConsumer?.cancel?.();
  } catch {
    // ignore cleanup errors
  }
  try {
    activeNativeCancel?.();
  } catch {
    // ignore cleanup errors
  } finally {
    activePopupConsumer = null;
    activeNativeCancel = null;
    isSigningIn = false;
    activeSignInPromise = null;
  }
};

export const getGmailAccessToken = (): string | null => cachedAccessToken;

export const getCurrentGmailUser = (): GmailUser | null => auth.currentUser || cachedNativeUser;

export const signOutGmail = async (): Promise<void> => {
  cachedAccessToken = null;
  cachedNativeUser = null;
  try {
    await auth.signOut();
  } catch {
    // ignore Firebase signOut errors in APK native mode
  }
  try {
    const bridge = typeof window !== 'undefined' ? (window as any).KevinAgentBridge : null;
    bridge?.clearGmailAuthCookies?.();
  } catch {
    // ignore
  }
};

const decodeBase64UrlUtf8 = (input: string): string => {
  if (!input) return '';
  try {
    const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
};

const encodeUtf8ToBase64Url = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const encodeRfc2047Header = (value: string): string => {
  if (!value) return '';
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `=?UTF-8?B?${btoa(binary)}?=`;
};

const stripHtmlTags = (html: string): string => {
  if (!html) return '';
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return (doc.body?.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    } catch {
      // fallback below
    }
  }
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const extractEmailBodyFromPayload = (payload: any): string => {
  if (!payload) return '';

  const findPartBody = (node: any, targetMime: string): string => {
    if (!node) return '';
    if (node.mimeType === targetMime && node.body?.data) {
      return decodeBase64UrlUtf8(node.body.data);
    }
    if (Array.isArray(node.parts)) {
      for (const part of node.parts) {
        const found = findPartBody(part, targetMime);
        if (found) return found;
      }
    }
    return '';
  };

  const plainText = findPartBody(payload, 'text/plain');
  if (plainText.trim()) return plainText.trim();

  const htmlText = findPartBody(payload, 'text/html');
  if (htmlText.trim()) return stripHtmlTags(htmlText);

  if (payload.body?.data) {
    const raw = decodeBase64UrlUtf8(payload.body.data);
    return payload.mimeType === 'text/html' ? stripHtmlTags(raw) : raw.trim();
  }

  return '';
};

const parseSender = (fromHeader: string): { name: string; email: string } => {
  const clean = (fromHeader || '').trim();
  const angleMatch = clean.match(/^(?:"?([^"<]*)"?\s*)?<([^>\s]+@[^>\s]+)>$/);
  if (angleMatch) {
    const email = angleMatch[2].trim();
    const name = (angleMatch[1] || '').trim() || email;
    return { name, email };
  }
  const emailOnlyMatch = clean.match(/([^\s<>]+@[^\s<>]+)/);
  if (emailOnlyMatch) {
    return { name: emailOnlyMatch[1], email: emailOnlyMatch[1] };
  }
  return { name: clean || 'Unknown', email: '' };
};

const getHeaderValue = (headers: Array<{ name?: string; value?: string }> | undefined, target: string): string => {
  if (!Array.isArray(headers)) return '';
  const lowerTarget = target.toLowerCase();
  const found = headers.find((h) => h.name?.toLowerCase() === lowerTarget);
  return found?.value?.trim() || '';
};

const throwParsedGmailError = async (res: Response, fallbackLabel: string): Promise<never> => {
  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('GMAIL_AUTH_EXPIRED');
  }

  let errJson: any = null;
  let errText = '';
  try {
    errText = await res.text();
    errJson = JSON.parse(errText);
  } catch {
    // non-JSON response
  }

  const message = String(errJson?.error?.message || errText || res.statusText || '');
  const statusStr = String(errJson?.error?.status || '');
  const reasonStr = String(errJson?.error?.errors?.[0]?.reason || '');
  const detailsReasons = Array.isArray(errJson?.error?.details)
    ? errJson.error.details.map((d: any) => String(d?.reason || '')).join(' ')
    : '';
  const combined = `${statusStr} ${reasonStr} ${detailsReasons} ${message}`.toLowerCase();

  if (
    res.status === 403 &&
    (combined.includes('insufficient') ||
      combined.includes('access_token_scope_insufficient') ||
      combined.includes('scope'))
  ) {
    cachedAccessToken = null;
    throw new Error('GMAIL_MISSING_SCOPES');
  }

  if (
    res.status === 403 &&
    (combined.includes('service_disabled') ||
      combined.includes('accessnotconfigured') ||
      combined.includes('has not been used in project') ||
      combined.includes('is disabled'))
  ) {
    const urlMatch = message.match(/https:\/\/console\.developers\.google\.com\/[^\s"']+/i)
      || message.match(/https:\/\/console\.cloud\.google\.com\/[^\s"']+/i);
    const activationUrl =
      urlMatch?.[0] ||
      `https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=${firebaseConfig.messagingSenderId}`;
    throw new Error(`GMAIL_API_DISABLED:${activationUrl}`);
  }

  throw new Error(`${fallbackLabel} (${res.status}): ${message}`);
};

export const fetchRecentEmails = async (
  accessToken: string,
  maxResults = 15,
  query = 'in:inbox'
): Promise<GmailMessage[]> => {
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`;
  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!listRes.ok) {
    await throwParsedGmailError(listRes, 'Gmail list error');
  }

  const listData = await listRes.json();
  const refs: Array<{ id: string; threadId?: string }> = Array.isArray(listData?.messages)
    ? listData.messages
    : [];

  if (refs.length === 0) return [];

  const detailed = await Promise.all(
    refs.map(async (ref): Promise<GmailMessage | null> => {
      try {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(ref.id)}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!msgRes.ok) {
          if (msgRes.status === 401 || msgRes.status === 403) {
            await throwParsedGmailError(msgRes, 'Gmail message error');
          }
          return null;
        }
        const msg = await msgRes.json();
        const headers = msg.payload?.headers;
        const from = getHeaderValue(headers, 'From');
        const replyToHeader = getHeaderValue(headers, 'Reply-To');
        const to = getHeaderValue(headers, 'To');
        const subject = getHeaderValue(headers, 'Subject') || '(No Subject)';
        const date = getHeaderValue(headers, 'Date');
        const messageIdHeader = getHeaderValue(headers, 'Message-ID') || getHeaderValue(headers, 'Message-Id');
        const referencesHeader = getHeaderValue(headers, 'References');

        const parsedFrom = parseSender(from);
        const parsedReplyTo = replyToHeader ? parseSender(replyToHeader) : parsedFrom;
        const body = extractEmailBodyFromPayload(msg.payload) || msg.snippet || '';
        const labelIds: string[] = Array.isArray(msg.labelIds) ? msg.labelIds : [];

        return {
          id: msg.id,
          threadId: msg.threadId || ref.threadId || '',
          from,
          fromName: parsedFrom.name,
          fromEmail: parsedFrom.email,
          replyTo: parsedReplyTo.email || parsedFrom.email || from,
          to,
          subject,
          date,
          snippet: msg.snippet || '',
          body,
          messageIdHeader,
          referencesHeader,
          unread: labelIds.includes('UNREAD'),
        };
      } catch (err: any) {
        if (
          err?.message === 'GMAIL_AUTH_EXPIRED' ||
          err?.message === 'GMAIL_MISSING_SCOPES' ||
          String(err?.message || '').startsWith('GMAIL_API_DISABLED:')
        ) {
          throw err;
        }
        return null;
      }
    })
  );

  return detailed.filter((m): m is GmailMessage => Boolean(m));
};

export const formatReplySubject = (subject: string): string => {
  const trimmed = (subject || '').trim();
  if (!trimmed) return 'Re: (No Subject)';
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
};

export const sendGmailReply = async (
  accessToken: string,
  params: {
    to: string;
    subject: string;
    body: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
  }
): Promise<{ id: string; threadId: string }> => {
  const replySubject = formatReplySubject(params.subject);
  const refs = [params.references, params.inReplyTo].filter(Boolean).join(' ').trim();

  const headers: string[] = [
    `To: ${params.to.replace(/[\r\n]+/g, ' ').trim()}`,
    `Subject: ${encodeRfc2047Header(replySubject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];

  if (params.inReplyTo) {
    headers.push(`In-Reply-To: ${params.inReplyTo.replace(/[\r\n]+/g, ' ').trim()}`);
  }
  if (refs) {
    headers.push(`References: ${refs.replace(/[\r\n]+/g, ' ').trim()}`);
  }

  const rawMime = `${headers.join('\r\n')}\r\n\r\n${params.body}`;
  const raw = encodeUtf8ToBase64Url(rawMime);

  const payload: Record<string, string> = { raw };
  if (params.threadId) {
    payload.threadId = params.threadId;
  }

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    await throwParsedGmailError(res, 'Failed to send email');
  }

  return res.json();
};

export const draftEmailReplyWithIziAI = async (
  email: GmailMessage,
  userInstruction: string,
  selectedModel?: string
): Promise<string> => {
  const emailSnippetForAi = (email.body || email.snippet || '').slice(0, 3000);
  const instructionText = userInstruction.trim()
    ? userInstruction.trim()
    : 'Andika igisubizo cyiza, cyubaha kandi cyumvikana mu rurimi rw\'ubutumwa bwaje (cyangwa Ikinyarwanda niba bwanditswe mu Kinyarwanda).';

  const prompt = [
    'URI IZI AI. Umukoresha aragusaba kumwandikira igisubizo cyo kohereza kuri Email.',
    'TEGEKO RIKOMEYE: Tanga GUSA umubiri w\'igisubizo cya Email (email body) — ntushyireho amagambo yo hanze nka "Dore igisubizo:" cyangwa markdown code blocks cyangwa Subject line.',
    '',
    `Uwatanze Email (From): ${email.fromName} <${email.fromEmail || email.replyTo}>`,
    `Umutwe (Subject): ${email.subject}`,
    `Ubutumwa bwaje:\n"""\n${emailSnippetForAi}\n"""`,
    '',
    `Icyo umukoresha asaba ko ubandikira mu gisubizo: ${instructionText}`,
  ].join('\n');

  const draft = await sendMessageToGemini([], prompt, undefined, null, selectedModel);
  return draft
    .replace(/^```[\w]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .replace(/^(?:Subject|Umutwe)\s*:.*\n+/i, '')
    .trim();
};
