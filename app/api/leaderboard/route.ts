import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/supabase/request-auth";

// A single ranked leaderboard entry returned to the client.
type LeaderboardRow = {
  rank: number;
  userId: string;
  name: string;
  initials: string;
  weeklyAvg: number;
  streak: number;
  isMe: boolean;
};

// Local YYYY-MM-DD for a given Date — same convention /today and /profile use,
// so day boundaries line up with each user's completion rows.
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// The last 7 local date strings, oldest first, ending today.
function lastSevenDayStrs(): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    days.push(localDateStr(d));
  }
  return days;
}

// Initials from a full name, e.g. "Ada Lovelace" → "AL". Falls back to "?".
function initialsOf(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

export async function GET(request: Request) {
  // 1) Authenticate via session cookies (web) or an Authorization: Bearer
  // header (mobile). This only confirms *who* is asking and gives us their id;
  // the data reads below go through the service-role client either way.
  const { user } = await getRequestUser(request);

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const myId = user.id;

  // 2) Service-role client — bypasses RLS to read cross-user aggregates. The key
  // is server-only (never NEXT_PUBLIC) and is read only inside this handler.
  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // 3) Pull the raw data: names, task ownership, and every completion's day.
  const [{ data: profiles }, { data: tasks }, { data: completions }] =
    await Promise.all([
      admin.from("profiles").select("id, full_name"),
      admin.from("tasks").select("user_id"),
      admin.from("completions").select("user_id, date"),
    ]);

  // Total tasks per user — the per-day denominator, and our inclusion filter.
  const taskCount: Record<string, number> = {};
  for (const t of tasks ?? []) {
    const uid = t.user_id as string;
    taskCount[uid] = (taskCount[uid] ?? 0) + 1;
  }

  // Completions tallied per user per local day: countByUserDate[uid][date].
  const countByUserDate: Record<string, Record<string, number>> = {};
  for (const c of completions ?? []) {
    const uid = c.user_id as string;
    const date = c.date as string;
    (countByUserDate[uid] ??= {})[date] =
      (countByUserDate[uid]?.[date] ?? 0) + 1;
  }

  // Name lookup by user id.
  const nameById: Record<string, string | null> = {};
  for (const p of profiles ?? []) {
    nameById[p.id as string] = (p.full_name as string | null) ?? null;
  }

  const week = lastSevenDayStrs();

  // That day's % for a user = completions ÷ their total tasks, capped at 100.
  function percentFor(uid: string, dateStr: string): number {
    const total = taskCount[uid] ?? 0;
    if (total === 0) return 0;
    const done = countByUserDate[uid]?.[dateStr] ?? 0;
    return Math.min(100, Math.round((done / total) * 100));
  }

  // A day qualifies toward the streak at ≥50%.
  function qualifies(uid: string, dateStr: string): boolean {
    return percentFor(uid, dateStr) >= 50;
  }

  // Streak: consecutive qualifying days counting back from today. If today
  // isn't ≥50% yet, start from yesterday (same today-grace rule as /profile).
  function streakFor(uid: string): number {
    const cursor = new Date();
    if (!qualifies(uid, localDateStr(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
    }
    let streak = 0;
    while (qualifies(uid, localDateStr(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  // 4) Build one row per user who has at least one task.
  const rows = Object.keys(taskCount)
    .filter((uid) => taskCount[uid] > 0)
    .map((uid) => {
      const dailyPercents = week.map((d) => percentFor(uid, d));
      const weeklyAvg = Math.round(
        dailyPercents.reduce((a, b) => a + b, 0) / week.length
      );
      const name = nameById[uid] ?? "Anonymous";
      return {
        userId: uid,
        name,
        initials: initialsOf(name),
        weeklyAvg,
        streak: streakFor(uid),
        isMe: uid === myId,
      };
    });

  // 5) Rank by streak desc, then weekly average desc; attach 1-based rank.
  rows.sort((a, b) => b.streak - a.streak || b.weeklyAvg - a.weeklyAvg);
  const ranked: LeaderboardRow[] = rows.map((r, i) => ({ rank: i + 1, ...r }));

  return NextResponse.json({ leaderboard: ranked });
}
