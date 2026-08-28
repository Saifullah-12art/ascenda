import { createAdminClient } from "@/lib/supabase/admin";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

// Node.js runtime, pinned explicitly: token verification uses node:crypto
// (HMAC + timingSafeEqual), which is not available on the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Minimal HTML page response helper. `body` is trusted markup built here; any
// caller-supplied value inside it must be escaped first.
function page(
  title: string,
  body: string,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="font-family:system-ui,-apple-system,sans-serif;background:#fff;color:#1f2937;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
    <div style="max-width:360px;text-align:center;padding:24px">
      <h1 style="font-size:18px;font-weight:600;margin:0 0 8px">${escapeHtml(
        title
      )}</h1>
      ${body}
    </div>
  </body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function paragraph(message: string): string {
  return `<p style="font-size:14px;color:#6b7280;margin:0">${escapeHtml(
    message
  )}</p>`;
}

/**
 * The failure page for every rejected token. Deliberately the same body for
 * "invalid" and "missing" so the endpoint doesn't confirm whether a token merely
 * failed its signature or was never shaped like one.
 */
function rejected(reason: "missing" | "invalid" | "expired"): Response {
  if (reason === "expired") {
    return page(
      "Link expired",
      paragraph(
        "This unsubscribe link has expired. Use the link in a more recent email, or turn reminders off from your profile."
      ),
      410
    );
  }
  return page(
    "Invalid link",
    paragraph(
      "This unsubscribe link isn't valid. Use the link in a recent reminder email, or turn reminders off from your profile."
    ),
    400
  );
}

/**
 * Unsubscribe from reminder emails.
 *
 * The recipient is logged out, so the link carries a signed, expiring token
 * (see lib/unsubscribe-token.ts) instead of a raw user id — the id alone is not
 * a credential. The token is verified before anything is written.
 *
 * GET only *shows* a confirmation page: it never writes, so an <img> tag, a
 * link prefetch or a scanner following the URL can't change anyone's settings.
 * The write happens on POST — either from the confirm button on that page, or
 * from a mail client's own unsubscribe button via RFC 8058 one-click, which
 * POSTs to the same URL.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t");
  const result = verifyUnsubscribeToken(token);

  if (!result.ok) return rejected(result.reason);

  // Valid token: offer the confirm button. Still no write on this request.
  const safeToken = escapeHtml(token as string);
  return page(
    "Unsubscribe from reminders?",
    `${paragraph(
      "You'll stop receiving daily routine reminders. You can turn them back on anytime from your profile."
    )}
      <form method="post" action="/api/unsubscribe" style="margin:20px 0 0">
        <input type="hidden" name="t" value="${safeToken}" />
        <button type="submit"
                style="background:#534AB7;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:500;cursor:pointer">
          Unsubscribe
        </button>
      </form>`
  );
}

/** Read the token from the query string, falling back to a posted form field. */
async function tokenFromPost(request: Request): Promise<string | null> {
  const fromQuery = new URL(request.url).searchParams.get("t");
  if (fromQuery) return fromQuery;

  try {
    const form = await request.formData();
    const value = form.get("t");
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const token = await tokenFromPost(request);
  const result = verifyUnsubscribeToken(token);

  if (!result.ok) return rejected(result.reason);

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("profiles")
    .update({ email_reminders: false })
    .eq("id", result.userId);

  if (error) {
    console.error("[unsubscribe] update failed:", error.message);
    return page(
      "Something went wrong",
      paragraph("We couldn't update your preferences. Please try again later."),
      500
    );
  }

  return page(
    "You're unsubscribed",
    paragraph(
      "You won't receive daily routine reminders anymore. You can re-enable them anytime from your profile."
    )
  );
}
