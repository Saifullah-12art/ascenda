"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BottomNav from "@/components/BottomNav";
import Loading from "@/components/Loading";

type Profile = {
  full_name: string | null;
  created_at: string;
};

// Local YYYY-MM-DD for a given Date — matches how /today writes completions,
// so day boundaries line up with the user's wall clock (not UTC).
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// The last 7 local dates, oldest first, ending today.
function lastSevenDays(): Date[] {
  const days: Date[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    days.push(d);
  }
  return days;
}

// Single weekday letter (S M T W T F S) for the chart labels.
function weekdayLetter(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short" }).charAt(0);
}

// Initials from a full name, e.g. "Ada Lovelace" → "AL". Falls back to "?".
function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

export default function ProfilePage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [totalTasks, setTotalTasks] = useState(0);
  // Completion counts per local date: { "2026-06-14": 3, ... }
  const [countByDate, setCountByDate] = useState<Record<string, number>>({});

  // On mount: require a user, then load profile + tasks + completions.
  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/");
        return;
      }

      // Profile (name + join date).
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("full_name, created_at")
        .eq("id", user.id)
        .single();

      // Total number of tasks — the denominator for daily percentages.
      const { count: taskCount } = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true });

      // Every completion (we only need which day each falls on).
      const { data: completionRows } = await supabase
        .from("completions")
        .select("date");

      // Tally completions per day.
      const counts: Record<string, number> = {};
      for (const row of completionRows ?? []) {
        const date = row.date as string;
        counts[date] = (counts[date] ?? 0) + 1;
      }

      setProfile((profileRow as Profile) ?? null);
      setTotalTasks(taskCount ?? 0);
      setCountByDate(counts);
      setLoading(false);
    }

    load();
    // supabase/router are stable; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // That day's completion percentage = completions ÷ total tasks, capped at 100.
  function percentForDate(dateStr: string): number {
    if (totalTasks === 0) return 0;
    const done = countByDate[dateStr] ?? 0;
    return Math.min(100, Math.round((done / totalTasks) * 100));
  }

  // A day "qualifies" toward the streak if it's at least 50% complete.
  function qualifies(dateStr: string): boolean {
    return percentForDate(dateStr) >= 50;
  }

  // Current streak: consecutive qualifying days counting backward from today.
  // An unfinished today shouldn't break the streak, so if today doesn't qualify
  // yet we start counting from yesterday instead.
  function computeStreak(): number {
    const cursor = new Date();

    // If today hasn't hit 50% yet, don't count it — step back to yesterday.
    if (!qualifies(localDateStr(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
    }

    // Walk backward while each day qualifies; stop at the first that doesn't.
    let streak = 0;
    while (qualifies(localDateStr(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  // Show a loading state while data is fetching.
  if (loading) {
    return <Loading />;
  }

  const streak = computeStreak();
  const days = lastSevenDays();
  const todayStr = localDateStr(new Date());
  const memberSince = profile
    ? new Date(profile.created_at).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      })
    : "";

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  return (
    <>
    <main className="flex min-h-screen justify-center bg-white px-6 pt-10 pb-28">
      <div className="flex w-full max-w-[380px] flex-col">
        {/* Identity */}
        <div className="flex flex-col items-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#EEEDFE] text-[20px] font-medium text-[#534AB7]">
            {initials(profile?.full_name ?? null)}
          </div>
          <h1 className="mt-3 text-[16px] font-medium text-gray-900">
            {profile?.full_name ?? "You"}
          </h1>
          {memberSince && (
            <p className="mt-0.5 text-[11px] text-gray-400">
              Member since {memberSince}
            </p>
          )}
        </div>

        {/* Streak card */}
        <div className="mt-8 flex items-center gap-3 rounded-2xl bg-[#E1F5EE] px-5 py-4">
          {/* Flame icon */}
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="#1D9E75"
            aria-hidden="true"
          >
            <path d="M12 2c0 3-4 4.5-4 8a4 4 0 0 0 1.2 2.86C8.46 12.2 8 11 8 9.5c2 1 2.5 2.5 2.5 4 0 .9-.4 1.7-.4 2.5a4 4 0 1 0 7.9-1c0-2.5-1.5-3.5-2-5.5-.4 1-1 1.5-1.8 1.8C16 8 14 6 14 4c0-.8-.7-1.4-2-2z" />
          </svg>
          <div>
            <p className="text-[24px] font-medium leading-none text-[#1D9E75]">
              {streak} {streak === 1 ? "day" : "days"}
            </p>
            <p className="mt-1 text-[11px] text-[#1D9E75]/70">current streak</p>
          </div>
        </div>

        {/* Last 7 days bar chart */}
        <div className="mt-8">
          <p className="text-[11px] uppercase tracking-wide text-gray-400">
            Last 7 days
          </p>
          <div className="mt-4 flex items-end justify-between gap-2">
            {days.map((d) => {
              const dateStr = localDateStr(d);
              const pct = percentForDate(dateStr);
              const isToday = dateStr === todayStr;
              return (
                <div key={dateStr} className="flex flex-1 flex-col items-center">
                  {/* Bar track (fixed height) with a fill scaled to the % */}
                  <div className="flex h-20 w-full items-end rounded-md bg-[#EEEDFE]">
                    <div
                      className={`w-full rounded-md ${
                        isToday ? "bg-[#9B95DC]" : "bg-[#534AB7]"
                      }`}
                      style={{ height: `${pct}%` }}
                    />
                  </div>
                  <span className="mt-2 text-[10px] text-gray-400">
                    {weekdayLetter(d)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sign out */}
        <button
          type="button"
          onClick={signOut}
          className="mt-10 rounded-xl border-[0.5px] border-gray-200 px-4 py-3 text-[13px] font-medium text-gray-700"
        >
          Sign out
        </button>
      </div>
    </main>
    <BottomNav />
    </>
  );
}
