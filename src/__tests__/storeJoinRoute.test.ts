import { describe, expect, it } from "vitest";
import {
  captureStoreJoinIntent,
  clearStoredStoreJoinIntent,
  peekStoreJoinIntent,
  persistStoreJoinEmailHandoff,
  storeJoinTokenFromLocation,
  storeJoinTokenFromPath,
  storeJoinTokenFromPayload,
  storeJoinUrl,
  type StorageLike,
} from "../production/storeJoinRoute";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe("production store join routes", () => {
  it("extracts a token from the server-invisible URL fragment", () => {
    expect(storeJoinTokenFromLocation("/join/store", "#token=thq_deadbeef")).toBe("thq_deadbeef");
  });

  it("keeps legacy production path tokens compatible", () => {
    expect(storeJoinTokenFromPath("/join/store/thq_deadbeef")).toBe("thq_deadbeef");
  });

  it("keeps the legacy demo route compatible", () => {
    expect(storeJoinTokenFromPath("/join/HARBOR-DRESDEN-A1")).toBe("HARBOR-DRESDEN-A1");
  });

  it("does not confuse a Supabase Auth callback fragment with a store token", () => {
    expect(storeJoinTokenFromLocation("/join/store", "#access_token=auth-token&refresh_token=refresh-token")).toBeNull();
  });

  it("extracts the token from a scanned absolute URL", () => {
    expect(storeJoinTokenFromPayload("https://tcg.example/join/store#token=thq_1234", "https://tcg.example")).toBe("thq_1234");
  });

  it("rejects unrelated absolute and relative URLs while accepting raw known token formats", () => {
    expect(storeJoinTokenFromPayload("https://example.org/not-a-join-link", "https://tcg.example")).toBeNull();
    expect(storeJoinTokenFromPayload("/pricing/cards", "https://tcg.example")).toBeNull();
    expect(storeJoinTokenFromPayload("thq_deadbeef", "https://tcg.example")).toBe("thq_deadbeef");
    expect(storeJoinTokenFromPayload("thj_deadbeef", "https://tcg.example")).toBe("thj_deadbeef");
    expect(storeJoinTokenFromPayload("HARBOR-DRESDEN-A1", "https://tcg.example")).toBe("HARBOR-DRESDEN-A1");
  });

  it("places new tokens in the fragment rather than the HTTP path", () => {
    expect(storeJoinUrl("https://tcg.example/", "thq_a/b")).toBe("https://tcg.example/join/store#token=thq_a%2Fb");
  });

  it("captures and immediately sanitizes both fragment and legacy path links", () => {
    for (const location of [
      { pathname: "/join/store", hash: "#token=thq_deadbeef" },
      { pathname: "/join/store/thq_deadbeef", hash: "" },
      { pathname: "/join/HARBOR-DRESDEN-A1", hash: "" },
    ]) {
      const session = new MemoryStorage();
      const local = new MemoryStorage();
      let replacement = "";
      const intent = captureStoreJoinIntent(location, {
        state: { existing: true },
        replaceState: (_state, _title, url) => { replacement = String(url); },
      }, session, local, 1_000);
      expect(intent?.token).toBe(location.pathname.includes("HARBOR") ? "HARBOR-DRESDEN-A1" : "thq_deadbeef");
      expect(replacement).toBe("/join/store");
      expect(peekStoreJoinIntent(session, 1_001)?.token).toBe(intent?.token);
    }
  });

  it("uses a one-time, 15-minute local handoff for email confirmation", () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    expect(persistStoreJoinEmailHandoff("thq_eeeeaaaa", local, 10_000)).toBe(true);

    const claimed = captureStoreJoinIntent(
      { pathname: "/join/store", hash: "#access_token=auth-token" },
      { state: null, replaceState: () => undefined },
      session,
      local,
      10_500,
    );
    expect(claimed?.token).toBe("thq_eeeeaaaa");

    const secondTab = captureStoreJoinIntent(
      { pathname: "/join/store", hash: "" },
      { state: null, replaceState: () => undefined },
      new MemoryStorage(),
      local,
      10_600,
    );
    expect(secondTab).toBeNull();
    clearStoredStoreJoinIntent(session, local);
    expect(peekStoreJoinIntent(session, 10_700)).toBeNull();
  });

  it("rejects an expired email handoff", () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    persistStoreJoinEmailHandoff("thq_eeeeeeee", local, 0);
    const intent = captureStoreJoinIntent(
      { pathname: "/join/store", hash: "" },
      { state: null, replaceState: () => undefined },
      session,
      local,
      15 * 60 * 1000 + 1,
    );
    expect(intent).toBeNull();
  });
});
