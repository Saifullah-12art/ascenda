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
 * ## Configuration
 *
 * The constant comes from ASCENDA_UID_SALT, read on the server only — it is
 * deliberately NOT a NEXT_PUBLIC_ variable, so it never reaches this app's own
 * browser bundle, which has no use for it.
 *
 * Server-only here does NOT mean secret. The mobile app hardcodes the same
 * string and must produce the same digest, so ASCENDA_UID_SALT has to be set to
 * exactly the value in `src/lib/opaqueUid.ts` in the ascenda-mobile repo —
 * currently `ascenda:uid:v1`. Setting it to a fresh random value, the usual
 * instinct for anything called a salt, does not harden this: it silently
 * empties every client-side join (feed streaks, league roster) until a matching
 * mobile build ships. Rotating it is a coordinated release across both repos,
 * hence the `v1` suffix.
 *
 * Unset is treated as fatal rather than defaulted, because a wrong-but-present
 * value and a missing one both fail silently everywhere else.
 */
function uidSalt(): string {
  const salt = process.env.ASCENDA_UID_SALT;
  if (!salt) {
    throw new Error(
      "ASCENDA_UID_SALT is not set. /api/leaderboard cannot mint opaque user " +
        "ids without it. Set it in the Vercel project (all environments) and in " +
        ".env.local, to the same value the mobile app ships in " +
        "src/lib/opaqueUid.ts — currently `ascenda:uid:v1`. It is not a secret; " +
        "a random value will silently break the app's streak and roster joins."
    );
  }
  return salt;
}

/**
 * Opaque, stable id for a raw auth UUID. 64 lowercase hex characters.
 * Throws if ASCENDA_UID_SALT is unset — see above.
 */
export function opaqueUid(userId: string): string {
  return createHash("sha256").update(`${uidSalt()}:${userId}`).digest("hex");
}
