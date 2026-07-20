import type { PricingResult } from "./types";

export interface PricingCache {
  get(key: string): Promise<PricingResult | null>;
  set(key: string, value: PricingResult, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

interface CacheEntry {
  value: PricingResult;
  expiresAt: number;
}

/** Process-local cache. Use a shared server cache in multi-instance production. */
export class MemoryPricingCache implements PricingCache {
  private readonly entries = new Map<string, CacheEntry>();

  async get(key: string): Promise<PricingResult | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: PricingResult, ttlMs: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: Date.now() + Math.max(0, ttlMs) });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

