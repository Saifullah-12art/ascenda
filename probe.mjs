import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const { data: all, error: allErr } = await supabase
  .from("profiles")
  .select("id, email_reminders, onboarding_answers");
console.log("ALL PROFILES:", allErr ?? "");
for (const p of all ?? []) {
  console.log(
    `  ${p.id}  email_reminders=${JSON.stringify(p.email_reminders)}  (typeof ${typeof p.email_reminders})  onboarded=${p.onboarding_answers != null}`
  );
}

const { data: filtered, error: fErr } = await supabase
  .from("profiles")
  .select("id, email_reminders")
  .eq("email_reminders", true)
  .not("onboarding_answers", "is", null);
console.log("\n.eq('email_reminders', true) RETURNS:", fErr ?? "");
for (const p of filtered ?? []) {
  console.log(`  ${p.id}  email_reminders=${JSON.stringify(p.email_reminders)}`);
}
