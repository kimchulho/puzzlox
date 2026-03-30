import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "Missing env: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_ANON_KEY fallback)."
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const usersResult = await supabase.from("pixi_users").select("*").limit(1);
  const identitiesResult = await supabase
    .from("pixi_user_identities")
    .select("*")
    .limit(1);

  if (usersResult.error) {
    console.error("pixi_users table check failed:", usersResult.error.message);
    process.exit(1);
  }

  if (identitiesResult.error) {
    console.error(
      "pixi_user_identities table check failed:",
      identitiesResult.error.message
    );
    process.exit(1);
  }

  const usersColumns = Object.keys(usersResult.data?.[0] || {});
  const identityColumns = Object.keys(identitiesResult.data?.[0] || {});

  console.log("pixi_users table reachable. columns(sample):", usersColumns);
  console.log(
    "pixi_user_identities table reachable. columns(sample):",
    identityColumns
  );
}

check().catch((error) => {
  console.error("Unexpected check error:", error);
  process.exit(1);
});
