import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Minimal HTML page response helper.
function page(title: string, message: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="font-family:system-ui,-apple-system,sans-serif;background:#fff;color:#1f2937;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
    <div style="max-width:360px;text-align:center;padding:24px">
      <h1 style="font-size:18px;font-weight:600;margin:0 0 8px">${title}</h1>
      <p style="font-size:14px;color:#6b7280;margin:0">${message}</p>
    </div>
  </body>
</html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * One-click unsubscribe from reminder emails. The link in each email points
 * here with the recipient's user id (?u=<id>); we flip their
 * profiles.email_reminders to false using the service-role client.
 */
export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get("u");

  if (!userId) {
    return page(
      "Invalid link",
      "This unsubscribe link is missing its account reference.",
      400
    );
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("profiles")
    .update({ email_reminders: false })
    .eq("id", userId);

  if (error) {
    return page(
      "Something went wrong",
      "We couldn't update your preferences. Please try again later.",
      500
    );
  }

  return page(
    "You're unsubscribed",
    "You won't receive daily routine reminders anymore. You can re-enable them anytime from your profile."
  );
}
