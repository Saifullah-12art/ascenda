import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Where a logged-in user should land based on their onboarding status.
 *
 * `profiles.onboarding_answers` is null until onboarding is finished, so:
 *   - null  → "/onboarding" (they still need to complete it)
 *   - set   → "/today"      (they're all set up)
 *
 * Shared by the auth pages so post-sign-in and "already logged in" redirects
 * stay consistent.
 */
export async function getPostAuthRoute(
  supabase: SupabaseClient,
  user: User
): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_answers")
    .eq("id", user.id)
    .single();

  return profile?.onboarding_answers ? "/today" : "/onboarding";
}
