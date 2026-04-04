import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

supabase.from('rooms').select('*').limit(1).then(() => {});
fetch(`${supabaseUrl}/rest/v1/rooms?limit=1`, { headers: { apikey: supabaseAnonKey } })
  .then(res => res.json())
  .then(data => {
    if (data && data.length > 0) {
      console.log('rooms:', data[0]);
    } else {
      console.log('rooms is empty');
    }
  });
