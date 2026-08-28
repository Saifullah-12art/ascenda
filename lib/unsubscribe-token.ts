import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed unsubscribe tokens.
 *
 * The person clicking an unsubscribe link in an email is, by definition, logged
 * out — so the link itself has to carry the proof. The old scheme passed the raw
 * `profiles.id` (`?u=<uuid>`), which made the user id the credential: anyone who
 * learned a uuid could unsubscribe that account. Here the link carries a token
 * that only this server can mint:
 *
 *     v1.<payload>.<signature>
 *
 *   payload   = base64url("<userId>:<expiryUnixSeconds>")
 *   signature = base64url(HMAC-SHA256(key, "v1.<payload>"))
 *
 * The version prefix is inside the signed input, so a future v2 can't be
 * downgraded to v1. The expiry is inside it too, so it can't be extended without
 * invalidating the signature. Tokens are stateless — nothing is stored, and a
 * token is verified by recomputing the HMAC, never by looking anything up.
 *
 * Note this is signing, not encryption: base64url is reversible, so a recipient
 * can still read their own user id out of their own token. That's fine — the id
 * was never the secret. What the token buys is that nobody can *forge* one for
 * an id they weren't sent.
 *
 * Uses node:crypto, so every route importing this must pin the Node.js runtime
 * (`export const runtime = "nodejs"`) — it cannot run on Edge.
 */

const VERSION = "v1";

// Domain-separation label. The signing key is derived from the app secret rather
// than being the secret, so a token signature can never be replayed against any
// other use of that same secret.
const PURPOSE = "ascenda:unsubscribe:v1";

/** How long an emailed unsubscribe link stays usable. */
export const UNSUBSCRIBE_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Server-only signing key. Prefers a dedicated UNSUBSCRIBE_SECRET; falls back to
 * the service-role key, which is already required by every route that would mint
 * or verify a token, so the feature can't silently break on a missing env var.
 * Either way it is run through HMAC with PURPOSE first — the raw secret never
 * signs anything directly. Rotating the underlying secret invalidates tokens in
 * emails already sent; they are capped at 30 days anyway.
 */
function signingKey(): Buffer {
  const secret =
    process.env.UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret) {
    throw new Error(
      "Missing UNSUBSCRIBE_SECRET (or SUPABASE_SERVICE_ROLE_KEY) for unsubscribe token signing."
    );
  }

  return createHmac("sha256", secret).update(PURPOSE).digest();
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey())
    .update(`${VERSION}.${payload}`)
    .digest("base64url");
}

/** Mint the token for one user's unsubscribe link. */
export function createUnsubscribeToken(
  userId: string,
  ttlSeconds: number = UNSUBSCRIBE_TOKEN_TTL_SECONDS
): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = Buffer.from(`${userId}:${expiresAt}`, "utf8").toString(
    "base64url"
  );
  return `${VERSION}.${payload}.${sign(payload)}`;
}

export type UnsubscribeTokenResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "missing" | "invalid" | "expired" };

/**
 * Verify a token and recover the user id. Returns `ok: false` for anything that
 * isn't a currently-valid signature over a well-formed payload — callers must
 * not write anything unless this returns `ok: true`.
 */
export function verifyUnsubscribeToken(
  token: string | null | undefined
): UnsubscribeTokenResult {
  if (!token) return { ok: false, reason: "missing" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "invalid" };

  const [version, payload, signature] = parts;
  if (version !== VERSION || !payload || !signature) {
    return { ok: false, reason: "invalid" };
  }

  const expected = Buffer.from(sign(payload), "utf8");
  const provided = Buffer.from(signature, "utf8");

  // timingSafeEqual THROWS on mismatched lengths rather than returning false,
  // and an uncaught throw here would surface as a 500 instead of the intended
  // "invalid link" 400. A wrong-length signature is simply wrong, and its
  // length is public (it is whatever the caller sent), so returning early
  // leaks nothing that a length check on the input would not.
  if (expected.length !== provided.length) {
    return { ok: false, reason: "invalid" };
  }

  // Equal lengths: compare in constant time so the endpoint cannot be used as
  // a signature oracle.
  if (!timingSafeEqual(expected, provided)) {
    return { ok: false, reason: "invalid" };
  }

  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  const separator = decoded.lastIndexOf(":");
  if (separator <= 0) return { ok: false, reason: "invalid" };

  const userId = decoded.slice(0, separator);
  const expiresAt = Number(decoded.slice(separator + 1));

  if (!UUID_RE.test(userId)) return { ok: false, reason: "invalid" };
  if (!Number.isSafeInteger(expiresAt)) return { ok: false, reason: "invalid" };
  if (expiresAt <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, userId };
}
