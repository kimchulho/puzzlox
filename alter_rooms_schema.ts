import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { getSupabasePublishableKey, getSupabaseUrl } from './supabaseEnv';
dotenv.config();

const supabaseUrl = getSupabaseUrl();
const supabaseKey = getSupabasePublishableKey();
const supabase = createClient(supabaseUrl, supabaseKey);

async function alter() {
  const { error } = await supabase.rpc('exec_sql', {
    sql_string: 'ALTER TABLE rooms ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;'
  });
  if (error) {
    console.error('RPC Error:', error);
    // Fallback if exec_sql doesn't exist
    console.log('Trying to insert a dummy record to trigger schema error or just use REST API');
  } else {
    console.log('Successfully added last_active_at column via RPC.');
  }
}
alter();

