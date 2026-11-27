import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { GmailUser } from './gmailService';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

export type AuthAccountMethod = 'google' | 'email' | 'phone';

export interface RegisteredAccountResult {
  uid: string;
  displayName: string;
  identifier: string;
  method: AuthAccountMethod;
}

const UID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const E164_PATTERN = /^\+[1-9][0-9]{6,14}$/;

function sanitizeDisplayName(rawName: string): string {
  const clean = (rawName || '').trim().slice(0, 100);
  return clean || 'Umukoresha';
}

export function phoneToAuthEmail(e164Phone: string): string {
  const digits = e164Phone.replace(/^\+/, '').replace(/\D/g, '');
  return `phone.${digits}@iziai.app`;
}

async function writeAtomicUserDocs(params: {
  user: User;
  method: AuthAccountMethod;
  displayName: string;
  identifier: string;
  email?: string;
  phone?: string;
  photoURL?: string | null;
}): Promise<void> {
  const { user, method, displayName, identifier, email, phone, photoURL } = params;
  const uid = user.uid;
  if (!UID_PATTERN.test(uid) || uid.length > 128) {
    throw new Error('Invalid user UID format.');
  }

  const safeDisplayName = sanitizeDisplayName(displayName);
  const safeIdentifier = identifier.trim().slice(0, 160);
  const profileRef = doc(db, 'users', uid);
  const privateRef = doc(db, 'users', uid, 'private', 'info');

  const profilePayload = {
    uid,
    displayName: safeDisplayName,
    method,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const privatePayload: Record<string, unknown> = {
    uid,
    method,
    identifier: safeIdentifier,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (email) {
    privatePayload.email = email.trim().slice(0, 160);
  }
  if (phone && E164_PATTERN.test(phone)) {
    privatePayload.phone = phone.slice(0, 32);
  }
  if (photoURL && photoURL.trim()) {
    privatePayload.photoURL = photoURL.trim().slice(0, 500);
  }

  const batch = writeBatch(db);
  batch.set(profileRef, profilePayload);
  batch.set(privateRef, privatePayload);

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }
}

export async function createDatabaseAccount(params: {
  method: 'email' | 'phone';
  identifier: string;
  displayName: string;
  password: string;
}): Promise<RegisteredAccountResult> {
  const { method, identifier, displayName, password } = params;
  const authEmail =
    method === 'phone' ? phoneToAuthEmail(identifier) : identifier.trim().toLowerCase();

  const credential = await createUserWithEmailAndPassword(auth, authEmail, password);
  const user = credential.user;
  const safeName = sanitizeDisplayName(displayName);

  try {
    await updateProfile(user, { displayName: safeName });
  } catch {
    // Non-fatal if displayName update fails
  }

  try {
    await writeAtomicUserDocs({
      user,
      method,
      displayName: safeName,
      identifier: method === 'phone' ? identifier : authEmail,
      email: method === 'email' ? authEmail : undefined,
      phone: method === 'phone' ? identifier : undefined,
    });
  } catch (dbErr) {
    // Roll back auth session so user cannot remain logged in without a database record
    try {
      await signOut(auth);
    } catch {
      // ignore signOut failure
    }
    throw dbErr;
  }

  return {
    uid: user.uid,
    displayName: safeName,
    identifier: method === 'phone' ? identifier : authEmail,
    method,
  };
}

export async function loginWithDatabaseAccount(params: {
  method: 'email' | 'phone';
  identifier: string;
  password: string;
  preferredDisplayName?: string;
}): Promise<RegisteredAccountResult> {
  const { method, identifier, password, preferredDisplayName } = params;
  const authEmail =
    method === 'phone' ? phoneToAuthEmail(identifier) : identifier.trim().toLowerCase();

  const credential = await signInWithEmailAndPassword(auth, authEmail, password);
  const user = credential.user;

  const profilePath = `users/${user.uid}`;
  let profileSnap;
  try {
    profileSnap = await getDoc(doc(db, 'users', user.uid));
  } catch (error) {
    await signOut(auth).catch(() => undefined);
    handleFirestoreError(error, OperationType.GET, profilePath);
  }

  if (!profileSnap.exists()) {
    await signOut(auth).catch(() => undefined);
    const missingErr: any = new Error('ACCOUNT_NOT_IN_DATABASE');
    missingErr.code = 'izi/account-not-in-database';
    throw missingErr;
  }

  const profileData = profileSnap.data() as { displayName?: string; method?: AuthAccountMethod };
  let resolvedDisplayName = (profileData?.displayName || user.displayName || '').trim();
  const preferredClean = (preferredDisplayName || '').trim().slice(0, 100);

  if (preferredClean && preferredClean !== resolvedDisplayName) {
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        displayName: preferredClean,
        updatedAt: serverTimestamp(),
      });
      resolvedDisplayName = preferredClean;
      await updateProfile(user, { displayName: preferredClean }).catch(() => undefined);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, profilePath);
    }
  }

  let resolvedIdentifier = method === 'phone' ? identifier : authEmail;

  try {
    const privateSnap = await getDoc(doc(db, 'users', user.uid, 'private', 'info'));
    if (privateSnap.exists()) {
      const priv = privateSnap.data() as { identifier?: string };
      if (priv?.identifier) {
        resolvedIdentifier = priv.identifier;
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${user.uid}/private/info`);
  }

  return {
    uid: user.uid,
    displayName: resolvedDisplayName || resolvedIdentifier,
    identifier: resolvedIdentifier,
    method: profileData?.method || method,
  };
}

export async function ensureGoogleUserInDatabase(googleUser: GmailUser): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    // Capacitor native OAuth mode may not populate Firebase Auth currentUser directly.
    return;
  }

  const uid = currentUser.uid;
  const profilePath = `users/${uid}`;
  let profileSnap;
  try {
    profileSnap = await getDoc(doc(db, 'users', uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, profilePath);
  }

  const emailToStore = currentUser.email || googleUser.email || '';
  const displayName = sanitizeDisplayName(
    currentUser.displayName || googleUser.displayName || emailToStore || 'Umukoresha'
  );

  if (!profileSnap.exists() && emailToStore && currentUser.emailVerified) {
    await writeAtomicUserDocs({
      user: currentUser,
      method: 'google',
      displayName,
      identifier: emailToStore,
      email: emailToStore,
      photoURL: currentUser.photoURL || googleUser.photoURL || null,
    });
  }
}

export async function signOutFirebaseAuth(): Promise<void> {
  try {
    await signOut(auth);
  } catch {
    // ignore signOut errors
  }
}
