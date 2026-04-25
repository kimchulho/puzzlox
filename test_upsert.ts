import * as dotenv from 'dotenv';
import { getSupabasePublishableKey, getSupabaseUrl } from './supabaseEnv';
dotenv.config();

const supabaseUrl = getSupabaseUrl();
const supabasePublishableKey = getSupabasePublishableKey();

fetch(`${supabaseUrl}/rest/v1/puzzle_scores?select=*&limit=1`, { headers: { apikey: supabasePublishableKey } })
  .then(res => res.json())
  .then(data => {
    console.log(data);
  });
