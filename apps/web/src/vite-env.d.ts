/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable key (replaces legacy JWT anon key) */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}
