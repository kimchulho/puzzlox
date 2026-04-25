import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import path from "path";
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

async function main() {
  const sqlPath = path.join(
    process.cwd(),
    "migrations",
    "001_create_users_and_identities.sql"
  );
  const sql = readFileSync(sqlPath, "utf-8");

  const { error } = await supabase.rpc("exec_sql", {
    sql_string: sql,
  });

  if (error) {
    console.error("Migration failed via exec_sql RPC:", error.message);
    console.error(
      "If exec_sql is unavailable, run migrations/001_create_users_and_identities.sql in Supabase SQL Editor."
    );
    process.exit(1);
  }

  console.log("Migration applied: users + user_identities");
}

main().catch((error) => {
  console.error("Unexpected migration error:", error);
  process.exit(1);
});
