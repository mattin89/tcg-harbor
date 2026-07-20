import type {
  DemoAdapterBackend,
  DemoAdapterUnsubscribe,
  DemoDataAdapter,
  DemoSessionRecord,
} from "./types";

interface StorageEnvelope<T> {
  schemaVersion: 1;
  writtenAt: string;
  value: T;
}

type UnknownListener = (value: unknown | null) => void;

function isStorageEnvelope(value: unknown): value is StorageEnvelope<unknown> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StorageEnvelope<unknown>>;
  return candidate.schemaVersion === 1 && typeof candidate.writtenAt === "string" && "value" in candidate;
}

/**
 * Local demo persistence only. Browser localStorage is user-controlled and is
 * not an authorization boundary; production data and sessions need a server.
 */
export class LocalDemoDataAdapter implements DemoDataAdapter {
  readonly namespace: string;
  private readonly injectedStorage?: Storage;
  private readonly memory = new Map<string, string>();
  private readonly listeners = new Map<string, Set<UnknownListener>>();
  private updateQueue: Promise<void> = Promise.resolve();

  constructor(namespace = "tcg-harbor-demo", storage?: Storage) {
    this.namespace = namespace;
    this.injectedStorage = storage;
  }

  get backend(): DemoAdapterBackend {
    return this.getBrowserStorage() ? "local-storage" : "memory";
  }

  async read<T>(key: string): Promise<T | null> {
    const serialized = this.readRaw(this.storageKey(key));
    if (serialized === null) return null;

    try {
      const parsed: unknown = JSON.parse(serialized);
      return isStorageEnvelope(parsed) ? (parsed.value as T) : null;
    } catch {
      // Corrupt user-controlled demo state is ignored, never interpreted.
      return null;
    }
  }

  async write<T>(key: string, value: T): Promise<void> {
    const envelope: StorageEnvelope<T> = {
      schemaVersion: 1,
      writtenAt: new Date().toISOString(),
      value,
    };
    this.writeRaw(this.storageKey(key), JSON.stringify(envelope));
    this.emit(key, value);
  }

  async update<T>(key: string, updater: (current: T | null) => T): Promise<T> {
    let resolveResult!: (value: T) => void;
    let rejectResult!: (reason: unknown) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    this.updateQueue = this.updateQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          const next = updater(await this.read<T>(key));
          await this.write(key, next);
          resolveResult(next);
        } catch (error) {
          rejectResult(error);
        }
      });

    return result;
  }

  async remove(key: string): Promise<void> {
    const fullKey = this.storageKey(key);
    const storage = this.getBrowserStorage();
    if (storage) {
      try {
        storage.removeItem(fullKey);
      } catch {
        // Continue with the in-memory mirror below.
      }
    }
    this.memory.delete(fullKey);
    this.emit(key, null);
  }

  getSession<TUser = unknown>(): Promise<DemoSessionRecord<TUser> | null> {
    return this.read<DemoSessionRecord<TUser>>(LocalDemoDataAdapter.SESSION_KEY);
  }

  setSession<TUser>(session: DemoSessionRecord<TUser>): Promise<void> {
    return this.write(LocalDemoDataAdapter.SESSION_KEY, session);
  }

  clearSession(): Promise<void> {
    return this.remove(LocalDemoDataAdapter.SESSION_KEY);
  }

  subscribe<T>(key: string, listener: (value: T | null) => void): DemoAdapterUnsubscribe {
    const unknownListener = listener as UnknownListener;
    const listenersForKey = this.listeners.get(key) ?? new Set<UnknownListener>();
    listenersForKey.add(unknownListener);
    this.listeners.set(key, listenersForKey);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== this.storageKey(key)) return;
      void this.read<T>(key).then(listener);
    };
    if (typeof window !== "undefined") window.addEventListener("storage", onStorage);

    return () => {
      listenersForKey.delete(unknownListener);
      if (listenersForKey.size === 0) this.listeners.delete(key);
      if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
    };
  }

  subscribeToSession<TUser>(
    listener: (session: DemoSessionRecord<TUser> | null) => void,
  ): DemoAdapterUnsubscribe {
    return this.subscribe(LocalDemoDataAdapter.SESSION_KEY, listener);
  }

  private static readonly SESSION_KEY = "auth.session";

  private storageKey(key: string): string {
    if (!key.trim()) throw new TypeError("Demo storage keys must not be empty.");
    return `${this.namespace}:${key}`;
  }

  private getBrowserStorage(): Storage | null {
    if (this.injectedStorage) return this.injectedStorage;
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  private readRaw(key: string): string | null {
    const storage = this.getBrowserStorage();
    if (storage) {
      try {
        const stored = storage.getItem(key);
        return stored ?? this.memory.get(key) ?? null;
      } catch {
        return this.memory.get(key) ?? null;
      }
    }
    return this.memory.get(key) ?? null;
  }

  private writeRaw(key: string, value: string): void {
    const storage = this.getBrowserStorage();
    if (storage) {
      try {
        storage.setItem(key, value);
        return;
      } catch {
        // Quota/security errors retain a functional in-memory demo.
      }
    }
    this.memory.set(key, value);
  }

  private emit(key: string, value: unknown | null): void {
    for (const listener of this.listeners.get(key) ?? []) listener(value);
  }
}

export const localDemoDataAdapter = new LocalDemoDataAdapter();
