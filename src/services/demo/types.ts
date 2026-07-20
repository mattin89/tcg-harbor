export interface DemoSessionRecord<TUser = unknown> {
  id: string;
  userId: string;
  user: TUser;
  createdAt: string;
  expiresAt: string;
}

export type DemoAdapterBackend = "local-storage" | "memory";
export type DemoAdapterUnsubscribe = () => void;

export interface DemoDataAdapter {
  readonly namespace: string;
  readonly backend: DemoAdapterBackend;
  read<T>(key: string): Promise<T | null>;
  write<T>(key: string, value: T): Promise<void>;
  update<T>(key: string, updater: (current: T | null) => T): Promise<T>;
  remove(key: string): Promise<void>;
  getSession<TUser = unknown>(): Promise<DemoSessionRecord<TUser> | null>;
  setSession<TUser>(session: DemoSessionRecord<TUser>): Promise<void>;
  clearSession(): Promise<void>;
  subscribe<T>(key: string, listener: (value: T | null) => void): DemoAdapterUnsubscribe;
  subscribeToSession<TUser>(
    listener: (session: DemoSessionRecord<TUser> | null) => void,
  ): DemoAdapterUnsubscribe;
}

