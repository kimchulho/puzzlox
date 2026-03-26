import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

fetch(`${supabaseUrl}/rest/v1/puzzle_scores?select=*&limit=1`, { headers: { apikey: supabaseAnonKey } })
  .then(res => res.json())
  .then(data => {
    console.log(data);
  });
