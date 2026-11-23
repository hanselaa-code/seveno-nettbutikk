export const FIRESTORE_WRITE_TIMEOUT_MS = 10_000;

export class FirestoreNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirestoreNetworkError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function assertBrowserOnline(
  offlineMessage = 'Ingen internettforbindelse. Kontroller nettverket og prøv igjen.',
): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new FirestoreNetworkError(offlineMessage);
  }
}

export async function runFirestoreWriteWithTimeout<T>(
  operation: () => Promise<T>,
  options: {
    timeoutMs?: number;
    offlineMessage?: string;
    timeoutMessage?: string;
  } = {},
): Promise<T> {
  assertBrowserOnline(options.offlineMessage);

  const timeoutMs = options.timeoutMs ?? FIRESTORE_WRITE_TIMEOUT_MS;
  const operationPromise = operation();
  // Prevent unhandled rejection if timeout fires first
  operationPromise.catch(() => undefined);

  let timerId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operationPromise,
      new Promise<never>((_, reject) => {
        timerId = setTimeout(() => {
          reject(
            new FirestoreNetworkError(
              options.timeoutMessage ??
                'Nettverksfeil: forespørselen mot databasen tok for lang tid. Kontroller internettforbindelsen og prøv igjen.',
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
  }
}
