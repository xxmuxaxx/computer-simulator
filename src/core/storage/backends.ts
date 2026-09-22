/** Key/value storage abstraction so persistence can be swapped (or faked in tests). */
export interface StorageBackend {
  getMany(keys: readonly string[]): Promise<Record<string, unknown>>;
  setMany(entries: Record<string, unknown>): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryBackend implements StorageBackend {
  private data = new Map<string, unknown>();

  async getMany(keys: readonly string[]): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const k of keys) if (this.data.has(k)) out[k] = structuredClone(this.data.get(k));
    return out;
  }

  async setMany(entries: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(entries)) this.data.set(k, structuredClone(v));
  }

  async clear(): Promise<void> {
    this.data.clear();
  }
}

const STORE = 'state';

/** IndexedDB implementation. One object store, one record per key. */
export class IndexedDBBackend implements StorageBackend {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly dbName = 'computer-simulator',
    private readonly factory: IDBFactory = indexedDB,
  ) {}

  private open(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Cannot open IndexedDB'));
      request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
    });
    this.dbPromise.catch(() => {
      this.dbPromise = null;
    });
    return this.dbPromise;
  }

  private async run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let result: T;
      Promise.resolve(work(tx.objectStore(STORE))).then(
        (value) => {
          result = value;
        },
        (error) => {
          reject(error);
          tx.abort();
        },
      );
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  }

  private static request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  getMany(keys: readonly string[]): Promise<Record<string, unknown>> {
    return this.run('readonly', async (store) => {
      const out: Record<string, unknown> = {};
      const values = await Promise.all(keys.map((k) => IndexedDBBackend.request(store.get(k))));
      keys.forEach((k, i) => {
        if (values[i] !== undefined) out[k] = values[i];
      });
      return out;
    });
  }

  setMany(entries: Record<string, unknown>): Promise<void> {
    return this.run('readwrite', (store) => {
      for (const [k, v] of Object.entries(entries)) store.put(v, k);
    });
  }

  clear(): Promise<void> {
    return this.run('readwrite', (store) => {
      store.clear();
    });
  }
}
