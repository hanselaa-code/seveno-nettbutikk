import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockApp = { name: '[DEFAULT]' };
const mockDb = { type: 'firestore' };
const mockAuth = { name: 'auth' };

const firebaseAppMocks = vi.hoisted(() => ({
  getApps: vi.fn(() => [] as unknown[]),
  getApp: vi.fn(() => mockApp),
  initializeApp: vi.fn(() => mockApp),
}));

const firestoreMocks = vi.hoisted(() => ({
  getFirestore: vi.fn(() => mockDb),
  connectFirestoreEmulator: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  getAuth: vi.fn(() => mockAuth),
  connectAuthEmulator: vi.fn(),
  signInAnonymously: vi.fn(),
}));

vi.mock('firebase/app', () => ({
  getApps: firebaseAppMocks.getApps,
  getApp: firebaseAppMocks.getApp,
  initializeApp: firebaseAppMocks.initializeApp,
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: firestoreMocks.getFirestore,
  connectFirestoreEmulator: firestoreMocks.connectFirestoreEmulator,
}));

vi.mock('firebase/auth', () => ({
  getAuth: authMocks.getAuth,
  connectAuthEmulator: authMocks.connectAuthEmulator,
  signInAnonymously: authMocks.signInAnonymously,
}));

describe('M5 Runtime Hosting Firebase Initialization', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    firebaseAppMocks.getApps.mockReturnValue([]);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('initializes Firebase from /__/firebase/init.json and updates live module bindings', async () => {
    const hostingConfig = {
      apiKey: 'mock-runtime-key-for-test-only',
      authDomain: 'seveno-test.firebaseapp.com',
      projectId: 'seveno-test',
      storageBucket: 'seveno-test.firebasestorage.app',
      messagingSenderId: '1234567890',
      appId: '1:1234567890:web:abcdef123456',
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => hostingConfig,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const mod = await import('../../src/lib/firebase');

    // Synchronous module-load state remains unconfigured when VITE_FIREBASE_* are omitted
    expect(mod.isFirebaseConfigured()).toBe(false);
    expect(mod.firebaseApp).toBeNull();
    expect(mod.db).toBeNull();
    expect(mod.auth).toBeNull();

    // Concurrent calls share the same initialization promise
    const [firstResult, secondResult] = await Promise.all([
      mod.initializeFirebaseFromHosting(),
      mod.initializeFirebaseFromHosting(),
    ]);

    expect(firstResult).toBe(true);
    expect(secondResult).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/__/firebase/init.json', { cache: 'no-store' });

    expect(firebaseAppMocks.initializeApp).toHaveBeenCalledWith(hostingConfig);
    expect(mod.isFirebaseConfigured()).toBe(true);
    expect(mod.firebaseApp).toBe(mockApp);
    expect(mod.db).toBe(mockDb);
    expect(mod.auth).toBe(mockAuth);
    expect(mod.getFirebaseApp()).toBe(mockApp);
    expect(mod.getDb()).toBe(mockDb);
    expect(mod.getAuthInstance()).toBe(mockAuth);

    // Subsequent call returns true immediately without refetching
    expect(await mod.initializeFirebaseFromHosting()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns false cleanly on 404 or network failure without throwing or configuring Firebase', async () => {
    const fetch404 = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    });
    globalThis.fetch = fetch404 as unknown as typeof fetch;

    const mod = await import('../../src/lib/firebase');

    expect(await mod.initializeFirebaseFromHosting()).toBe(false);
    expect(mod.isFirebaseConfigured()).toBe(false);
    expect(mod.firebaseApp).toBeNull();
    expect(mod.db).toBeNull();
    expect(mod.auth).toBeNull();

    // Network rejection also resolves cleanly to false
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof fetch;
    expect(await mod.initializeFirebaseFromHosting()).toBe(false);
    expect(mod.isFirebaseConfigured()).toBe(false);
    expect(firebaseAppMocks.initializeApp).not.toHaveBeenCalled();
  });

  it('returns false cleanly when /__/firebase/init.json lacks required Firebase fields', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ projectId: 'missing-api-key-and-app-id' }),
    }) as unknown as typeof fetch;

    const mod = await import('../../src/lib/firebase');

    expect(await mod.initializeFirebaseFromHosting()).toBe(false);
    expect(mod.isFirebaseConfigured()).toBe(false);
    expect(mod.firebaseApp).toBeNull();
  });
});
