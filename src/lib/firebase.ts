import { getApp, getApps, initializeApp } from 'firebase/app';
import type { FirebaseApp, FirebaseOptions } from 'firebase/app';
import { ReCaptchaEnterpriseProvider, initializeAppCheck } from 'firebase/app-check';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

const EMULATOR_FLAG_KEY = '__SEVENO_EMULATORS_CONNECTED__';
const APPCHECK_FLAG_KEY = '__SEVENO_APPCHECK_INITIALIZED__';

const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || undefined,
};

let activeFirebaseConfig: FirebaseOptions = { ...firebaseConfig };

export function isFirebaseConfigured(config: FirebaseOptions = activeFirebaseConfig): boolean {
  return Boolean(config.apiKey && config.projectId && config.appId);
}

/**
 * Optional helper for Classic Firebase Hosting deployments where `/__/firebase/init.json`
 * supplies runtime configuration when `VITE_FIREBASE_*` build env vars are omitted.
 */
export async function loadHostingFirebaseConfig(): Promise<FirebaseOptions | null> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return null;
  }
  try {
    const response = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }
    const parsed = (await response.json()) as FirebaseOptions;
    return isFirebaseConfigured(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function initializeAppCheckIfConfigured(app: FirebaseApp): void {
  if (typeof window === 'undefined') {
    return;
  }

  const globalBag = globalThis as Record<string, unknown>;
  if (globalBag[APPCHECK_FLAG_KEY]) {
    return;
  }

  const debugToken = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
  if (debugToken) {
    (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugToken === 'true' ? true : debugToken;
  }

  const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
  if (!siteKey) {
    return;
  }

  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
    globalBag[APPCHECK_FLAG_KEY] = true;
  } catch (err) {
    console.warn('App Check initialization skipped (non-fatal):', err);
  }
}

function connectEmulatorsIfEnabled(firestore: Firestore, authInstance: Auth): void {
  if (import.meta.env.VITE_USE_EMULATORS !== 'true') {
    return;
  }

  const globalBag = globalThis as Record<string, unknown>;
  if (globalBag[EMULATOR_FLAG_KEY]) {
    return;
  }

  try {
    connectFirestoreEmulator(firestore, 'localhost', 8080);
    connectAuthEmulator(authInstance, 'http://localhost:9099', { disableWarnings: true });
    globalBag[EMULATOR_FLAG_KEY] = true;
  } catch (err) {
    console.warn('Emulator connection skipped:', err);
  }
}

let initializedApp: FirebaseApp | null = null;
let initializedDb: Firestore | null = null;
let initializedAuth: Auth | null = null;

export let firebaseApp: FirebaseApp | null = null;
export let db: Firestore | null = null;
export let auth: Auth | null = null;

function initializeFirebaseWithConfig(config: FirebaseOptions): void {
  initializedApp = getApps().length > 0 ? getApp() : initializeApp(config);
  initializedDb = getFirestore(initializedApp);
  initializedAuth = getAuth(initializedApp);
  activeFirebaseConfig = { ...config };
  firebaseApp = initializedApp;
  db = initializedDb;
  auth = initializedAuth;
  connectEmulatorsIfEnabled(initializedDb, initializedAuth);
  initializeAppCheckIfConfigured(initializedApp);
}

if (isFirebaseConfigured(firebaseConfig)) {
  initializeFirebaseWithConfig(firebaseConfig);
}

let hostingInitPromise: Promise<boolean> | null = null;

/**
 * Bootstraps Firebase at runtime from Classic Firebase Hosting's `/__/firebase/init.json`
 * when `VITE_FIREBASE_*` build-time env vars are omitted.
 */
export function initializeFirebaseFromHosting(): Promise<boolean> {
  if (initializedApp !== null) {
    return Promise.resolve(true);
  }
  if (!hostingInitPromise) {
    hostingInitPromise = (async () => {
      try {
        const hostingConfig = await loadHostingFirebaseConfig();
        if (!hostingConfig || !isFirebaseConfigured(hostingConfig)) {
          return false;
        }
        initializeFirebaseWithConfig(hostingConfig);
        return true;
      } catch {
        return false;
      } finally {
        if (initializedApp === null) {
          hostingInitPromise = null;
        }
      }
    })();
  }
  return hostingInitPromise;
}

export function getFirebaseApp(): FirebaseApp {
  if (!initializedApp) {
    throw new Error('Firebase er ikke konfigurert. Kontroller VITE_FIREBASE_*-miljøvariablene.');
  }
  return initializedApp;
}

export function getDb(): Firestore {
  if (!initializedDb) {
    throw new Error('Firebase Firestore er ikke konfigurert. Kontroller VITE_FIREBASE_*-miljøvariablene.');
  }
  return initializedDb;
}

export function getAuthInstance(): Auth {
  if (!initializedAuth) {
    throw new Error('Firebase Auth er ikke konfigurert. Kontroller VITE_FIREBASE_*-miljøvariablene.');
  }
  return initializedAuth;
}

export async function ensureAnonymousUserUid(
  authInstance: Auth | null = initializedAuth,
): Promise<string> {
  if (!authInstance) {
    throw new Error('Firebase Auth er ikke konfigurert. Kontroller VITE_FIREBASE_*-miljøvariablene.');
  }

  if (typeof authInstance.authStateReady === 'function') {
    await authInstance.authStateReady();
  }

  if (authInstance.currentUser?.uid) {
    return authInstance.currentUser.uid;
  }

  try {
    const credential = await signInAnonymously(authInstance);
    if (!credential.user?.uid) {
      throw new Error('Manglende bruker-ID etter anonym innlogging.');
    }
    return credential.user.uid;
  } catch (error) {
    throw new Error(
      'Kunne ikke opprette gjestesesjon for utsjekk. Kontroller at anonym innlogging er aktivert, eller prøv igjen.',
      { cause: error },
    );
  }
}
