import { createHash } from "node:crypto";

/**
 * Opaque, stable per-user identifiers for client payloads.
 *
 * PR #7 ("Stop leaking user UUIDs") removed `userId` from /api/leaderboard,
 * because that endpoint handed every authenticated caller the raw auth UUID of
 * every other ranked user — including strangers the caller shares nothing with.
 * That was the right fix, but it also removed the only way a client could tell
 * *which* ranked row belongs to a user it is legitimately allowed to know
 * about, which silently broke three features in the mobile app (per-author
 * streaks in the feed, and the league roster and its "You" marker).
 *
 * `opaqueUid` restores correlation without restoring the leak: it is a
 * one-way SHA-256 of the UUID under a fixed domain-separation constant.
 * Same user, same id, every request; no way back to the UUID.
 *
 * ## What the salt is and is not
 *
 * UID_SALT is NOT a secret, and nothing here depends on it staying private —
 * the mobile app ships the same constant in its bundle, because it has to
 * derive the same value locally. Both sides of every join live on the client:
 * league members and post authors come straight from Supabase as raw UUIDs
 * (RLS lets the caller read exactly those rows), while the ranked board comes
 * from this API. The client can only match the two if it can compute this
 * function, so a server-held secret would make the features impossible rather
 * than safer.
 *
 * The security property comes from the input space, not from the salt: auth
 * UUIDs are 122 random bits, so a hash cannot be inverted or enumerated even
 * with the salt in hand. The salt's job is domain separation — these digests
 * are meaningless in any other system, and cannot be replayed against one.
 *
 * What a caller can therefore do: take a UUID it already legitimately holds
 * and find that user's row. What it still cannot do: learn the UUID behind any
 * other row on the board. That is exactly the boundary PR #7 drew.
 *
 * Changing UID_SALT rotates every identifier at once and breaks correlation
 * until clients ship the new value — treat it as a versioned constant, and
 * bump the `v1` suffix deliberately if it ever needs to change.
 *
 * MUST stay byte-identical to `src/lib/opaqueUid.ts` in the ascenda-mobile
 * repo, input format included.
 */
export const UID_SALT = "ascenda:uid:v1";

/** Opaque, stable id for a raw auth UUID. 64 lowercase hex characters. */
export function opaqueUid(userId: string): string {
  return createHash("sha256").update(`${UID_SALT}:${userId}`).digest("hex");
}
