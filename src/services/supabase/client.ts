import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseRuntimeConfig {
  url: string | null;
  anonKey: string | null;
  configured: boolean;
}

function readEnvironmentValue(name: "VITE_SUPABASE_URL" | "VITE_SUPABASE_PUBLISHABLE_KEY" | "VITE_SUPABASE_ANON_KEY"): string | null {
  const value = import.meta.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function getSupabaseRuntimeConfig(): SupabaseRuntimeConfig {
  const url = readEnvironmentValue("VITE_SUPABASE_URL");
  const anonKey = readEnvironmentValue("VITE_SUPABASE_PUBLISHABLE_KEY")
    ?? readEnvironmentValue("VITE_SUPABASE_ANON_KEY");
  return { url, anonKey, configured: Boolean(url && anonKey) };
}

export const isProductionSupabaseConfigured = getSupabaseRuntimeConfig().configured;

let singleton: SupabaseClient | null | undefined;

/**
 * Returns null when production credentials are intentionally absent. This lets
 * the existing local demo continue to run while a Supabase project is being
 * provisioned, without silently pretending that demo authentication is real.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (singleton !== undefined) return singleton;

  const config = getSupabaseRuntimeConfig();
  if (!config.configured || !config.url || !config.anonKey) {
    singleton = null;
    return singleton;
  }

  singleton = createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  });

  return singleton;
}
