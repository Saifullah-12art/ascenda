import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "@/lib/supabase/server";

/**
 * Resolves the caller of an API route from EITHER auth transport:
 *
 * - `Authorization: Bearer <supabase access token>` — used by the native
 *   mobile app, which holds a Supabase session directly and can't send the
 *   web app's session cookies.
 * - Session cookies via @supabase/ssr — the existing web path, unchanged.
 *
 * The Bearer token is validated server-side with `auth.getUser(token)` (a
 * round-trip to Supabase Auth — signature, expiry, and revocation are all
 * checked; nothing is decoded locally). The returned client carries the
 * caller's token on every request, so RLS runs as that user on both paths.
 *
 * Returns `user: null` when neither transport authenticates; callers should
 * respond 401.
 */
export async function getRequestUser(request: Request): Promise<{
  user: User | null;
  supabase: SupabaseClient;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (bearerToken) {
    // Stateless per-request client; the user's token rides along on every
    // DB request so PostgREST enforces RLS as them (never the anon role).
    const supabase = createSupabaseClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${bearerToken}` } },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser(bearerToken);

    return { user, supabase };
  }

  // No Bearer header — fall through to the cookie-session client exactly as
  // routes did before this helper existed.
  const supabase = await createCookieClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { user, supabase };
}
