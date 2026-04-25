/**
 * Supabase new API keys (sb_publishable_… / sb_secret_…) replace legacy JWT
 * "anon" and "service_role" keys. Use the same @supabase/supabase-js createClient.
 */

export function getSupabaseUrl(): string {
  return (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
}

/** Low-privilege key (browser + server public client), subject to RLS. */
export function getSupabasePublishableKey(): string {
  return (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "")
    .trim();
}

/** Elevated key (server only) — full access, bypasses RLS. */
export function getSupabaseSecretKey(): string {
  return (process.env.SUPABASE_SECRET_KEY || "").trim();
}

/** Scripts that used service or anon: prefer secret, then publishable. */
export function getSupabaseMigrationKey(): string {
  const s = getSupabaseSecretKey();
  if (s) return s;
  return getSupabasePublishableKey();
}
