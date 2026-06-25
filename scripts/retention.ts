/**
 * Throwaway dev script to measure activity and cohort retention from your own
 * Supabase data — so as testers start using Ascenda you can watch whether
 * people come back, and especially whether being in an active league predicts
 * coming back.
 *
 * It connects with the SERVICE-ROLE key (same as the leaderboard API) so it can
 * read across all users, bypassing RLS. The key lives only in .env.local and
 * this script is local-only — it is never bundled into the browser.
 *
 * It prints four sections:
 *   1. Signups          — totals and new signups per ISO week
 *   2. Activity         — weekly active users + active-in-last-7-days
 *   3. Cohort retention — retention curve per signup-week cohort
 *   4. League cut       — week-1/week-2 retention, active-league vs solo
 *
 * Run it with:
 *   npx tsx scripts/retention.ts
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local
 * automatically.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

// --- Tiny .env.local loader (KEY=value lines) so no extra flags/deps needed.
//     Same parser as scripts/test-routine.ts.
function loadEnvLocal(): void {
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // No .env.local — fall back to whatever is already in the environment.
  }
}

// ---------------------------------------------------------------------------
// Date helpers. Everything is bucketed by Monday-started weeks. We use LOCAL
// dates so week boundaries line up with completions.date (which /today and the
// leaderboard write as a local YYYY-MM-DD string).
// ---------------------------------------------------------------------------
const DAY_MS = 24 * 60 * 60 * 1000;

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Parse a "YYYY-MM-DD" string as a LOCAL midnight Date (avoids UTC drift that
// `new Date("2026-06-25")` would introduce).
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

// The Monday (local midnight) of the week containing `d`. This Monday's date
// string is our stable key for a week.
function mondayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (out.getDay() + 6) % 7; // Mon=0 .. Sun=6
  out.setDate(out.getDate() - dow);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

// ISO year-week label (e.g. "2026-W26") for a Monday, for human-readable rows.
function isoWeekLabel(monday: Date): string {
  const d = new Date(
    Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate())
  );
  // Thursday of this week decides the ISO year.
  d.setUTCDate(d.getUTCDate() + 3);
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstThuDow = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThuDow + 3);
  const week =
    1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function pct(num: number, den: number): string {
  if (den === 0) return "  n/a";
  return `${String(Math.round((num / den) * 100)).padStart(3, " ")}%`;
}

const LINE = "=".repeat(70);

// ---------------------------------------------------------------------------
// Types for the rows we read.
// ---------------------------------------------------------------------------
type ProfileRow = { id: string; created_at: string | null };
type CompletionRow = { user_id: string; date: string };
type LeagueMemberRow = { league_id: string; user_id: string };

type UserInfo = {
  id: string;
  signupMonday: Date; // Monday of the signup week
  signupWeekKey: string; // localDateStr(signupMonday)
  activeWeekKeys: Set<string>; // Monday keys for every week the user was active
};

async function main() {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local."
    );
    process.exit(1);
  }

  // Service-role client — bypasses RLS for cross-user reads, server/local only.
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const [profilesRes, completionsRes, leagueRes] = await Promise.all([
    admin.from("profiles").select("id, created_at"),
    admin.from("completions").select("user_id, date"),
    admin.from("league_members").select("league_id, user_id"),
  ]);

  for (const [label, res] of [
    ["profiles", profilesRes],
    ["completions", completionsRes],
    ["league_members", leagueRes],
  ] as const) {
    if (res.error) {
      console.error(`Failed to read ${label}: ${res.error.message}`);
      process.exit(1);
    }
  }

  const profiles = (profilesRes.data ?? []) as ProfileRow[];
  const completions = (completionsRes.data ?? []) as CompletionRow[];
  const leagueMembers = (leagueRes.data ?? []) as LeagueMemberRow[];

  const today = new Date();
  const todayMonday = mondayOf(today);

  // --- Per-user active-week sets, from completions. ------------------------
  const activeWeeksByUser = new Map<string, Set<string>>();
  for (const c of completions) {
    if (!c.date) continue;
    const wk = localDateStr(mondayOf(parseLocalDate(c.date)));
    let set = activeWeeksByUser.get(c.user_id);
    if (!set) {
      set = new Set<string>();
      activeWeeksByUser.set(c.user_id, set);
    }
    set.add(wk);
  }

  // --- Build the user table (only users with a known signup date). --------
  const users: UserInfo[] = [];
  let missingSignup = 0;
  for (const p of profiles) {
    if (!p.created_at) {
      missingSignup++;
      continue;
    }
    const signupMonday = mondayOf(new Date(p.created_at));
    users.push({
      id: p.id,
      signupMonday,
      signupWeekKey: localDateStr(signupMonday),
      activeWeekKeys: activeWeeksByUser.get(p.id) ?? new Set<string>(),
    });
  }

  // =========================================================================
  // 1) SIGNUPS
  // =========================================================================
  console.log("\n" + LINE);
  console.log("1) SIGNUPS");
  console.log(LINE);
  console.log(`Total users (profiles): ${profiles.length}`);
  if (missingSignup > 0) {
    console.log(
      `  (${missingSignup} excluded from cohort math — no created_at)`
    );
  }

  const signupsByWeek = new Map<string, number>();
  for (const u of users) {
    signupsByWeek.set(
      u.signupWeekKey,
      (signupsByWeek.get(u.signupWeekKey) ?? 0) + 1
    );
  }
  const signupWeekKeys = Array.from(signupsByWeek.keys()).sort();
  console.log("\nNew signups per ISO week:");
  if (signupWeekKeys.length === 0) {
    console.log("  (no signups yet)");
  } else {
    for (const key of signupWeekKeys) {
      const label = isoWeekLabel(parseLocalDate(key));
      const n = signupsByWeek.get(key)!;
      console.log(`  ${label}  (wk of ${key})  ${"#".repeat(n)} ${n}`);
    }
  }

  // =========================================================================
  // 2) ACTIVITY
  // =========================================================================
  console.log("\n" + LINE);
  console.log("2) ACTIVITY  (a user is 'active on a date' = >=1 completion)");
  console.log(LINE);

  // Distinct weekly active users, last 8 weeks ending this week.
  const WEEKS_SHOWN = 8;
  const weeklyActive = new Map<string, Set<string>>();
  for (const c of completions) {
    if (!c.date) continue;
    const wk = localDateStr(mondayOf(parseLocalDate(c.date)));
    let set = weeklyActive.get(wk);
    if (!set) {
      set = new Set<string>();
      weeklyActive.set(wk, set);
    }
    set.add(c.user_id);
  }

  console.log("\nWeekly active users (distinct):");
  for (let i = WEEKS_SHOWN - 1; i >= 0; i--) {
    const monday = addDays(todayMonday, -7 * i);
    const key = localDateStr(monday);
    const count = weeklyActive.get(key)?.size ?? 0;
    const tag = i === 0 ? "  <- current week (partial)" : "";
    console.log(
      `  ${isoWeekLabel(monday)}  (wk of ${key})  ${String(count).padStart(
        3,
        " "
      )}${tag}`
    );
  }

  // Active in the last 7 days (today and the 6 days before).
  const last7 = new Set<string>();
  for (let i = 0; i < 7; i++) last7.add(localDateStr(addDays(today, -i)));
  const activeLast7 = new Set<string>();
  for (const c of completions) {
    if (c.date && last7.has(c.date)) activeLast7.add(c.user_id);
  }
  console.log(
    `\nActive in the last 7 days: ${activeLast7.size} of ${profiles.length} users`
  );

  // =========================================================================
  // 3) COHORT RETENTION
  // =========================================================================
  console.log("\n" + LINE);
  console.log("3) COHORT RETENTION  (% of a signup-week cohort active N weeks later)");
  console.log(LINE);

  // Group users by signup week.
  const cohorts = new Map<string, UserInfo[]>();
  for (const u of users) {
    let arr = cohorts.get(u.signupWeekKey);
    if (!arr) {
      arr = [];
      cohorts.set(u.signupWeekKey, arr);
    }
    arr.push(u);
  }
  const cohortKeys = Array.from(cohorts.keys()).sort();

  if (cohortKeys.length === 0) {
    console.log("\n(no cohorts yet — need at least one user with a signup date)");
  } else {
    // How many week-columns to show: bounded by the oldest cohort's age.
    let maxWeeks = 0;
    for (const key of cohortKeys) {
      const elapsed = Math.round(
        (todayMonday.getTime() - parseLocalDate(key).getTime()) / (7 * DAY_MS)
      );
      if (elapsed > maxWeeks) maxWeeks = elapsed;
    }
    maxWeeks = Math.min(maxWeeks, 11); // cap at week 11 for readable width

    // Header.
    const header = ["cohort (size)".padEnd(22)];
    for (let w = 0; w <= maxWeeks; w++) header.push(`wk${w}`.padStart(5));
    console.log("\n" + header.join(""));

    for (const key of cohortKeys) {
      const cohort = cohorts.get(key)!;
      const size = cohort.length;
      const cohortMonday = parseLocalDate(key);
      const rowLabel = `${isoWeekLabel(cohortMonday)} (${size})`.padEnd(22);
      const cells: string[] = [rowLabel];
      for (let w = 0; w <= maxWeeks; w++) {
        const weekMonday = addDays(cohortMonday, 7 * w);
        // Only measurable once this week's window has begun.
        if (weekMonday.getTime() > todayMonday.getTime()) {
          cells.push("    -");
          continue;
        }
        const weekKey = localDateStr(weekMonday);
        let active = 0;
        for (const u of cohort) if (u.activeWeekKeys.has(weekKey)) active++;
        cells.push(pct(active, size).padStart(5));
      }
      console.log(cells.join(""));
    }
    console.log(
      "\n  wk0 = signup week. '-' = that week hasn't started yet for the cohort."
    );
    console.log(
      "  Watch a row left-to-right: a curve that flattens (stops dropping) = retention."
    );
  }

  // =========================================================================
  // 4) LEAGUE CUT — the magic-moment test
  // =========================================================================
  console.log("\n" + LINE);
  console.log("4) LEAGUE CUT  (active league = 2+ members) vs SOLO");
  console.log(LINE);

  // League sizes -> which leagues have 2+ DISTINCT members.
  const membersByLeague = new Map<string, Set<string>>();
  for (const m of leagueMembers) {
    let set = membersByLeague.get(m.league_id);
    if (!set) {
      set = new Set<string>();
      membersByLeague.set(m.league_id, set);
    }
    set.add(m.user_id);
  }
  const usersInActiveLeague = new Set<string>();
  for (const set of Array.from(membersByLeague.values())) {
    if (set.size >= 2) for (const uid of Array.from(set)) usersInActiveLeague.add(uid);
  }

  const leagueUsers = users.filter((u) => usersInActiveLeague.has(u.id));
  const soloUsers = users.filter((u) => !usersInActiveLeague.has(u.id));

  // Retention at week N for a set of users, counting only users old enough that
  // week N's window has begun.
  function retentionAt(group: UserInfo[], weekN: number) {
    let measurable = 0;
    let active = 0;
    for (const u of group) {
      const weekMonday = addDays(u.signupMonday, 7 * weekN);
      if (weekMonday.getTime() > todayMonday.getTime()) continue; // too new
      measurable++;
      if (u.activeWeekKeys.has(localDateStr(weekMonday))) active++;
    }
    return { measurable, active };
  }

  function printGroup(name: string, group: UserInfo[]) {
    const w1 = retentionAt(group, 1);
    const w2 = retentionAt(group, 2);
    console.log(`\n  ${name}: ${group.length} users`);
    console.log(
      `    week-1 retention: ${pct(w1.active, w1.measurable)}  ` +
        `(${w1.active}/${w1.measurable} old enough to measure)`
    );
    console.log(
      `    week-2 retention: ${pct(w2.active, w2.measurable)}  ` +
        `(${w2.active}/${w2.measurable} old enough to measure)`
    );
  }

  if (users.length === 0) {
    console.log("\n(no users yet)");
  } else {
    printGroup("In an active league (2+ members)", leagueUsers);
    printGroup("Solo (no league, or single-member league)", soloUsers);
    console.log(
      "\n  If the league row sits well above the solo row, joining an active"
    );
    console.log(
      "  league looks like a magic moment for retention. Small N = treat as a hint."
    );
  }

  console.log("\n" + LINE);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
