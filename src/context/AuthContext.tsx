import {
  GoogleAuthProvider,
  getIdTokenResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import type { Auth, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { auth, db } from '../lib/firebase';

export const ADMIN_ALLOWLIST_EMAIL = 'hanselaa@gmail.com';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  isAnonymous: boolean;
}

export interface AuthContextValue {
  user: AuthUser | null;
  isAdmin: boolean;
  loading: boolean;
  error: string | null;
  isFirebaseAuthAvailable: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

export interface AuthProviderProps {
  children: ReactNode;
  authInstance?: Auth | null;
  dbInstance?: Firestore | null;
  initialUser?: AuthUser | null;
  initialIsAdmin?: boolean;
  onSignInWithEmail?: (email: string, password: string) => Promise<void>;
  onSignInWithGoogle?: () => Promise<void>;
  onSignOut?: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function mapFirebaseUser(firebaseUser: User): AuthUser {
  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email ?? null,
    displayName: firebaseUser.displayName ?? null,
    emailVerified: Boolean(firebaseUser.emailVerified),
    isAnonymous: Boolean(firebaseUser.isAnonymous),
  };
}

export function mapFirebaseAuthError(error: unknown): string {
  const code =
    error !== null && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Feil e-postadresse eller passord.';
    case 'auth/invalid-email':
      return 'Ugyldig e-postadresse.';
    case 'auth/user-disabled':
      return 'Denne brukerkontoen er deaktivert.';
    case 'auth/too-many-requests':
      return 'For mange innloggingsforsøk. Prøv igjen om litt.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google-innlogging ble avbrutt.';
    case 'auth/popup-blocked':
      return 'Nettleseren blokkerte innloggingsvinduet. Tillat popup-vinduer og prøv igjen.';
    case 'auth/network-request-failed':
      return 'Nettverksfeil under innlogging. Kontroller tilkoblingen og prøv igjen.';
    default:
      if (error instanceof Error && error.message.trim().length > 0 && !code.startsWith('auth/')) {
        return error.message;
      }
      return 'Kunne ikke logge inn. Kontroller opplysningene og prøv igjen.';
  }
}

/**
 * Mirrors `firestore.rules` `isAdmin()` RBAC logic:
 * 1) Custom token claim `admin === true`
 * 2) Verified email matching `ADMIN_ALLOWLIST_EMAIL` (`hanselaa@gmail.com`)
 * 3) Document existence at `admins/{uid}` in Firestore
 * Always fails closed (`false`) for anonymous users or errors.
 */
export async function verifyUserIsAdmin(
  firebaseUser: User,
  dbInstance: Firestore | null = db,
): Promise<boolean> {
  if (!firebaseUser || firebaseUser.isAnonymous) {
    return false;
  }

  if (
    firebaseUser.email?.toLowerCase() === ADMIN_ALLOWLIST_EMAIL &&
    firebaseUser.emailVerified === true
  ) {
    return true;
  }

  try {
    const tokenResult = await getIdTokenResult(firebaseUser);
    if (tokenResult?.claims?.admin === true) {
      return true;
    }
    if (
      typeof tokenResult?.claims?.email === 'string' &&
      tokenResult.claims.email.toLowerCase() === ADMIN_ALLOWLIST_EMAIL &&
      tokenResult.claims.email_verified === true
    ) {
      return true;
    }
  } catch {
    // Fail closed on token inspection failure and proceed to Firestore check
  }

  if (dbInstance !== null) {
    try {
      const adminSnap = await getDoc(doc(dbInstance, 'admins', firebaseUser.uid));
      return adminSnap.exists();
    } catch {
      return false;
    }
  }

  return false;
}

export function AuthProvider({
  children,
  authInstance,
  dbInstance,
  initialUser,
  initialIsAdmin,
  onSignInWithEmail,
  onSignInWithGoogle,
  onSignOut,
}: AuthProviderProps) {
  const hasInjectedTestAuth = initialUser !== undefined || initialIsAdmin !== undefined;
  const resolvedAuth = authInstance !== undefined ? authInstance : auth;
  const resolvedDb = dbInstance !== undefined ? dbInstance : db;
  const isFirebaseAuthAvailable = Boolean(resolvedAuth || onSignInWithEmail || onSignInWithGoogle);

  const [user, setUser] = useState<AuthUser | null>(() => {
    if (hasInjectedTestAuth) {
      return initialUser ?? null;
    }
    return null;
  });

  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    if (hasInjectedTestAuth) {
      return Boolean(initialUser && !initialUser.isAnonymous && initialIsAdmin);
    }
    return false;
  });

  const [loading, setLoading] = useState<boolean>(() => {
    if (hasInjectedTestAuth) {
      return false;
    }
    return resolvedAuth !== null;
  });

  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (hasInjectedTestAuth) {
      setUser(initialUser ?? null);
      setIsAdmin(Boolean(initialUser && !initialUser.isAnonymous && initialIsAdmin));
      setLoading(false);
    }
  }, [hasInjectedTestAuth, initialUser, initialIsAdmin]);

  useEffect(() => {
    if (hasInjectedTestAuth || resolvedAuth === null) {
      return;
    }

    setLoading(true);
    const unsubscribe = onAuthStateChanged(resolvedAuth, (fbUser) => {
      const reqId = ++requestIdRef.current;

      if (!fbUser) {
        if (isMountedRef.current && reqId === requestIdRef.current) {
          setUser(null);
          setIsAdmin(false);
          setLoading(false);
        }
        return;
      }

      if (fbUser.isAnonymous) {
        if (isMountedRef.current && reqId === requestIdRef.current) {
          setUser(mapFirebaseUser(fbUser));
          setIsAdmin(false);
          setLoading(false);
        }
        return;
      }

      if (isMountedRef.current) {
        setLoading(true);
      }

      void verifyUserIsAdmin(fbUser, resolvedDb)
        .then((adminOk) => {
          if (!isMountedRef.current || reqId !== requestIdRef.current) {
            return;
          }
          setUser(mapFirebaseUser(fbUser));
          setIsAdmin(adminOk);
          setLoading(false);
        })
        .catch(() => {
          if (!isMountedRef.current || reqId !== requestIdRef.current) {
            return;
          }
          setUser(mapFirebaseUser(fbUser));
          setIsAdmin(false);
          setLoading(false);
        });
    });

    return () => {
      requestIdRef.current += 1;
      unsubscribe();
    };
  }, [hasInjectedTestAuth, resolvedAuth, resolvedDb]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const signInWithEmail = useCallback(
    async (email: string, password: string): Promise<void> => {
      setError(null);
      try {
        if (onSignInWithEmail) {
          await onSignInWithEmail(email, password);
          return;
        }
        if (!resolvedAuth) {
          throw new Error(
            'Firebase Auth er ikke konfigurert. Kontroller VITE_FIREBASE_*-miljøvariablene.',
          );
        }
        await signInWithEmailAndPassword(resolvedAuth, email.trim(), password);
      } catch (err) {
        const message = mapFirebaseAuthError(err);
        if (isMountedRef.current) {
          setError(message);
        }
        throw new Error(message, { cause: err });
      }
    },
    [onSignInWithEmail, resolvedAuth],
  );

  const signInWithGoogle = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      if (onSignInWithGoogle) {
        await onSignInWithGoogle();
        return;
      }
      if (!resolvedAuth) {
        throw new Error(
          'Firebase Auth er ikke konfigurert. Kontroller VITE_FIREBASE_*-miljøvariablene.',
        );
      }
      const provider = new GoogleAuthProvider();
      await signInWithPopup(resolvedAuth, provider);
    } catch (err) {
      const message = mapFirebaseAuthError(err);
      if (isMountedRef.current) {
        setError(message);
      }
      throw new Error(message, { cause: err });
    }
  }, [onSignInWithGoogle, resolvedAuth]);

  const signOut = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      if (onSignOut) {
        await onSignOut();
        if (hasInjectedTestAuth && isMountedRef.current) {
          setUser(null);
          setIsAdmin(false);
        }
        return;
      }
      if (hasInjectedTestAuth) {
        if (isMountedRef.current) {
          setUser(null);
          setIsAdmin(false);
        }
        return;
      }
      if (resolvedAuth) {
        await firebaseSignOut(resolvedAuth);
      }
    } catch (err) {
      const message = mapFirebaseAuthError(err);
      if (isMountedRef.current) {
        setError(message);
      }
      throw new Error(message, { cause: err });
    }
  }, [hasInjectedTestAuth, onSignOut, resolvedAuth]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAdmin,
      loading,
      error,
      isFirebaseAuthAvailable,
      signInWithEmail,
      signInWithGoogle,
      signOut,
      clearError,
    }),
    [
      user,
      isAdmin,
      loading,
      error,
      isFirebaseAuthAvailable,
      signInWithEmail,
      signInWithGoogle,
      signOut,
      clearError,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth må brukes innenfor en AuthProvider.');
  }
  return ctx;
}

export function useOptionalAuth(): AuthContextValue | undefined {
  return useContext(AuthContext);
}
