// IndexedDB access shared by both threads: the worker writes `saves` (M1), main writes `meta`.
// Every open has a timeout and the cached connection is dropped on close/versionchange,
// because WebKit connections can hang or die after the app is backgrounded.

export const DB_NAME = 'laphat';
export const DB_VERSION = 1;
export const STORE = { saves: 'saves', meta: 'meta' } as const;

let cached: Promise<IDBDatabase> | null = null;

export function openDb(timeoutMs = 4000): Promise<IDBDatabase> {
  if (cached) return cached;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error('indexedDB open timed out'));
    }, timeoutMs);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      // Ordered upgrades: add `if (old < 2) { … }` blocks; never edit old ones.
      if (!db.objectStoreNames.contains(STORE.saves)) db.createObjectStore(STORE.saves);
      if (!db.objectStoreNames.contains(STORE.meta)) db.createObjectStore(STORE.meta);
    };
    req.onsuccess = () => {
      const db = req.result;
      clearTimeout(timer);
      if (done) {
        db.close();
        return;
      }
      done = true;
      db.onclose = () => (cached = null);
      db.onversionchange = () => {
        db.close();
        cached = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      clearTimeout(timer);
      if (done) return;
      done = true;
      reject(req.error ?? new Error('indexedDB open failed'));
    };
  });
  cached = p;
  p.catch(() => (cached = null));
  return p;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? new Error('transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
      }),
  );
}

export function dbGet<T>(store: string, key: string): Promise<T | undefined> {
  return run<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
}

export function dbPut(store: string, key: string, value: unknown): Promise<void> {
  return run(store, 'readwrite', (s) => s.put(value, key)).then(() => undefined);
}

/** Never throws: storage being unavailable (private mode, quota) must not stop the game. */
export async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}
