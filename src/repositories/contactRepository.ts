import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { db, getDb, isFirebaseConfigured } from '../lib/firebase';
import { ValidationError, validateContactMessageInput } from '../lib/validators';
import type {
  ContactMessage,
  ContactMessageStatus,
  CreateContactMessageInput,
} from '../types/domain';
import { runFirestoreWriteWithTimeout } from './firestoreUtils';

export interface IContactRepository {
  create(input: CreateContactMessageInput): Promise<ContactMessage>;
  listAll(): Promise<ContactMessage[]>;
}

function toIsoString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date().toISOString();
}

function mapDocToContactMessage(id: string, data: Record<string, unknown>): ContactMessage {
  return {
    id,
    name: String(data.name ?? ''),
    email: String(data.email ?? ''),
    subject: String(data.subject ?? ''),
    message: String(data.message ?? ''),
    status: (data.status as ContactMessageStatus) ?? 'new',
    createdAt: toIsoString(data.createdAt),
  };
}

export class FirestoreContactRepository implements IContactRepository {
  private readonly db: Firestore;

  constructor(db: Firestore = getDb()) {
    this.db = db;
  }

  async create(input: CreateContactMessageInput): Promise<ContactMessage> {
    const validation = validateContactMessageInput(input);
    if (!validation.valid || !validation.value) {
      throw new ValidationError('Ugyldig kontaktskjema.', validation.errors);
    }

    const validated = validation.value;
    const nowIso = new Date().toISOString();
    const docRef = doc(collection(this.db, 'contact_messages'));

    // Never call getDoc() readback here — contact_messages read is admin-only.
    await runFirestoreWriteWithTimeout(() =>
      setDoc(docRef, {
        name: validated.name,
        email: validated.email,
        subject: validated.subject,
        message: validated.message,
        status: 'new',
        createdAt: serverTimestamp(),
      }),
    );

    return {
      id: docRef.id,
      name: validated.name,
      email: validated.email,
      subject: validated.subject,
      message: validated.message,
      status: 'new',
      createdAt: nowIso,
    };
  }

  async listAll(): Promise<ContactMessage[]> {
    const q = query(collection(this.db, 'contact_messages'), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) =>
      mapDocToContactMessage(docSnap.id, docSnap.data() as Record<string, unknown>),
    );
  }
}

const DEFAULT_LOCAL_CONTACT_STORAGE_KEY = 'seveno_contact_messages';

function readLocalContactMessages(storageKey: string): ContactMessage[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is ContactMessage =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as ContactMessage).id === 'string' &&
        typeof (item as ContactMessage).name === 'string' &&
        typeof (item as ContactMessage).email === 'string' &&
        typeof (item as ContactMessage).subject === 'string' &&
        typeof (item as ContactMessage).message === 'string',
    );
  } catch {
    return [];
  }
}

function writeLocalContactMessages(storageKey: string, messages: ContactMessage[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(messages));
  } catch {
    // Ignore storage quota or private browsing failures
  }
}

export class LocalContactRepository implements IContactRepository {
  private readonly storageKey: string;
  private readonly memoryStore: ContactMessage[] = [];
  private sequence = 0;

  constructor(storageKey: string = DEFAULT_LOCAL_CONTACT_STORAGE_KEY) {
    this.storageKey = storageKey;
  }

  async create(input: CreateContactMessageInput): Promise<ContactMessage> {
    const validation = validateContactMessageInput(input);
    if (!validation.valid || !validation.value) {
      throw new ValidationError('Ugyldig kontaktskjema.', validation.errors);
    }

    const validated = validation.value;
    this.sequence += 1;
    const message: ContactMessage = {
      id: `local-contact-${Date.now()}-${this.sequence}`,
      name: validated.name,
      email: validated.email,
      subject: validated.subject,
      message: validated.message,
      status: 'new',
      createdAt: new Date().toISOString(),
    };

    this.memoryStore.unshift(message);
    const existing = readLocalContactMessages(this.storageKey);
    const merged = [message, ...existing.filter((item) => item.id !== message.id)];
    writeLocalContactMessages(this.storageKey, merged);

    return message;
  }

  async listAll(): Promise<ContactMessage[]> {
    const stored = readLocalContactMessages(this.storageKey);
    const byId = new Map<string, ContactMessage>();

    for (const item of this.memoryStore) {
      byId.set(item.id, item);
    }
    for (const item of stored) {
      if (!byId.has(item.id)) {
        byId.set(item.id, item);
      }
    }

    return Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

const localContactRepoSingleton = new LocalContactRepository();

export function getContactRepository(): IContactRepository {
  if (isFirebaseConfigured() && db !== null) {
    return new FirestoreContactRepository(db);
  }
  return localContactRepoSingleton;
}
