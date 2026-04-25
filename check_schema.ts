import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { getSupabasePublishableKey, getSupabaseUrl } from './supabaseEnv';
dotenv.config();

const supabaseUrl = getSupabaseUrl();
const supabasePublishableKey = getSupabasePublishableKey();

const supabase = createClient(supabaseUrl, supabasePublishableKey);

supabase.from('rooms').select('*').limit(1).then(() => {});
fetch(`${supabaseUrl}/rest/v1/rooms?limit=1`, { headers: { apikey: supabasePublishableKey } })
  .then(res => res.json())
  .then(data => {
    if (data && data.length > 0) {
      console.log('rooms:', data[0]);
    } else {
      console.log('rooms is empty');
    }
  });
