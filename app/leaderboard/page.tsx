"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BottomNav from "@/components/BottomNav";
import Loading from "@/components/Loading";

// One ranked row as returned by /api/leaderboard. No user id — the API doesn't
// send one, and `isMe` already marks the caller's own row.
type LeaderboardRow = {
  rank: number;
  name: string;
  initials: string;
  weeklyAvg: number;
  streak: number;
  isMe: boolean;
};

// Rank badge: medals for the top three, a plain number for everyone else.
const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export default function LeaderboardPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);

  // On mount: require a user, then fetch the computed leaderboard.
  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/");
        return;
      }

      const res = await fetch("/api/leaderboard");
      if (res.ok) {
        const { leaderboard } = await res.json();
        setRows(leaderboard as LeaderboardRow[]);
      }
      setLoading(false);
    }

    load();
    // supabase/router are stable; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show a loading state while data is fetching.
  if (loading) {
    return <Loading />;
  }

  return (
    <>
    <main className="flex min-h-screen justify-center bg-page px-6 pt-10 pb-28">
      <div className="w-full max-w-[400px]">
        {/* Header */}
        <h1 className="text-[18px] font-medium text-ink">Leaderboard</h1>
        <p className="mt-0.5 text-[11px] text-ink-muted">this week</p>

        {/* Empty state */}
        {rows.length === 0 ? (
          <p className="mt-16 text-center text-[13px] text-ink-2">
            No one on the board yet
          </p>
        ) : (
          <div className="mt-7 flex flex-col gap-2">
            {rows.map((row) => {
              const medal = MEDALS[row.rank];
              return (
                <div
                  key={row.rank}
                  className={`flex items-center gap-3 rounded-2xl border-[1.5px] px-3 py-3 ${
                    row.isMe
                      ? "border-line-purple bg-soft-purple"
                      : "border-line bg-card"
                  }`}
                >
                  {/* Rank — medal for the top three, number otherwise. */}
                  <span className="flex w-6 shrink-0 justify-center">
                    {medal ? (
                      <span className="text-[18px] leading-none" aria-hidden="true">
                        {medal}
                      </span>
                    ) : (
                      <span className="text-[13px] font-medium text-ink-muted">
                        {row.rank}
                      </span>
                    )}
                  </span>

                  {/* First-initial avatar — matches the profile avatar tile. */}
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tint-purple text-[13px] font-medium text-purple-soft">
                    {row.initials.charAt(0)}
                  </span>

                  {/* Name + weekly average */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {row.name}
                    </p>
                    <p className="text-[10px] text-ink-muted">
                      {row.weeklyAvg}% this week
                    </p>
                  </div>

                  {/* Streak chip — 🔥 kept in its own span (no text-color class)
                      so the green count color can't recolor the emoji. */}
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-tint-success px-2.5 py-1 text-[12px] font-medium text-success">
                    <span className="text-[12px] leading-none" aria-hidden="true">
                      🔥
                    </span>
                    {row.streak}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer note */}
        <div className="mt-8 rounded-2xl border border-line bg-card px-4 py-3">
          <p className="text-[11px] text-ink-2">
            Your streak keeps your rank. Don&apos;t break it.
          </p>
        </div>
      </div>
    </main>
    <BottomNav />
    </>
  );
}
