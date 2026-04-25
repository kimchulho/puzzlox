import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { getSupabasePublishableKey, getSupabaseUrl } from './supabaseEnv';
dotenv.config();

const supabaseUrl = getSupabaseUrl();
const supabasePublishableKey = getSupabasePublishableKey();
const supabase = createClient(supabaseUrl, supabasePublishableKey);

async function test() {
  const { error } = await supabase.from('pieces').upsert([{ room_id: 1, piece_index: 0, x: 0, y: 0, is_locked: false }], { onConflict: 'room_id, piece_index' });
  console.log('Error:', error);
}
test();

