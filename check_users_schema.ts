import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { getSupabaseMigrationKey, getSupabaseUrl } from "./supabaseEnv";

dotenv.config();

const supabaseUrl = getSupabaseUrl();
const supabaseKey = getSupabaseMigrationKey();

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "Missing env: VITE_SUPABASE_URL and (SUPABASE_SECRET_KEY or VITE_SUPABASE_PUBLISHABLE_KEY / SUPABASE_PUBLISHABLE_KEY)."
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const usersResult = await supabase.from("users").select("*").limit(1);
  const identitiesResult = await supabase
    .from("user_identities")
    .select("*")
    .limit(1);

  if (usersResult.error) {
    console.error("users table check failed:", usersResult.error.message);
    process.exit(1);
  }

  if (identitiesResult.error) {
    console.error(
      "user_identities table check failed:",
      identitiesResult.error.message
    );
    process.exit(1);
  }

  const usersColumns = Object.keys(usersResult.data?.[0] || {});
  const identityColumns = Object.keys(identitiesResult.data?.[0] || {});

  console.log("users table reachable. columns(sample):", usersColumns);
  console.log(
    "user_identities table reachable. columns(sample):",
    identityColumns
  );
}

check().catch((error) => {
  console.error("Unexpected check error:", error);
  process.exit(1);
});

