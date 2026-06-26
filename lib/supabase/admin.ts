import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client authenticated with the service-role key. It bypasses RLS and
 * can read auth.users via the admin API, so it must ONLY ever be constructed in
 * server-side code (route handlers, server actions, scripts) — never in code
 * that ships to the browser. The key is read from a server-only env var.
 *
 * We disable session persistence/refresh because this client is stateless and
 * per-request: there is no user session to manage.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
