import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("Missing env: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const isBcryptHash = (value: string) => /^\$2[aby]\$\d{2}\$/.test(value);

async function main() {
  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, username, password")
    .not("username", "is", null);

  if (usersError) {
    console.error("Failed to read users:", usersError.message);
    process.exit(1);
  }

  if (!users || users.length === 0) {
    console.log("No users found for backfill.");
    return;
  }

  let created = 0;
  let skipped = 0;

  for (const user of users) {
    const username = (user.username ?? "").toString().trim().toLowerCase();
    const passwordRaw = (user.password ?? "").toString();

    if (!username || !passwordRaw) {
      skipped += 1;
      continue;
    }

    const { data: existingIdentity, error: existingError } = await supabase
      .from("user_identities")
      .select("id")
      .eq("provider", "web_local")
      .eq("provider_user_id", username)
      .maybeSingle();

    if (existingError) {
      console.error(`Failed to check identity for ${username}:`, existingError.message);
      skipped += 1;
      continue;
    }

    if (existingIdentity) {
      skipped += 1;
      continue;
    }

    const passwordHash = isBcryptHash(passwordRaw)
      ? passwordRaw
      : await bcrypt.hash(passwordRaw, 10);

    const { error: insertError } = await supabase.from("user_identities").insert({
      user_id: user.id,
      provider: "web_local",
      provider_user_id: username,
      password_hash: passwordHash,
      last_login_at: new Date().toISOString(),
    });

    if (insertError) {
      console.error(`Failed to create identity for ${username}:`, insertError.message);
      skipped += 1;
      continue;
    }

    created += 1;
  }

  console.log(`Backfill completed. created=${created}, skipped=${skipped}, total=${users.length}`);
}

main().catch((error) => {
  console.error("Unexpected backfill error:", error);
  process.exit(1);
});

