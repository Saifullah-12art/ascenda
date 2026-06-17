"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BottomNav from "@/components/BottomNav";

// One ranked row as returned by /api/leaderboard.
type LeaderboardRow = {
  rank: number;
  userId: string;
  name: string;
  initials: string;
  weeklyAvg: number;
  streak: number;
  isMe: boolean;
};

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

  // Hold the layout still while loading.
  if (loading) {
    return <main className="min-h-screen bg-white" />;
  }

  return (
    <>
    <main className="flex min-h-screen justify-center bg-white px-6 pt-10 pb-28">
      <div className="w-full max-w-[400px]">
        {/* Header */}
        <p className="text-[11px] uppercase tracking-wide text-gray-400">
          This week
        </p>
        <h1 className="mt-1 text-[18px] font-medium text-gray-900">
          Leaderboard
        </h1>

        {/* Empty state */}
        {rows.length === 0 ? (
          <p className="mt-16 text-center text-[13px] text-gray-500">
            No one on the board yet
          </p>
        ) : (
          <div className="mt-8 flex flex-col gap-1">
            {rows.map((row) => (
              <div
                key={row.userId}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                  row.isMe ? "bg-[#EEEDFE]" : ""
                }`}
              >
                {/* Rank */}
                <span className="w-4 shrink-0 text-[13px] font-medium text-gray-400">
                  {row.rank}
                </span>

                {/* Initials avatar */}
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EEEDFE] text-[12px] font-medium text-[#534AB7]">
                  {row.initials}
                </span>

                {/* Name + weekly average */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-gray-900">
                    {row.name}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {row.weeklyAvg}% this week
                  </p>
                </div>

                {/* Streak chip */}
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#E1F5EE] px-2.5 py-1 text-[11px] font-medium text-[#1D9E75]">
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="#1D9E75"
                    aria-hidden="true"
                  >
                    <path d="M12 2c0 3-4 4.5-4 8a4 4 0 0 0 1.2 2.86C8.46 12.2 8 11 8 9.5c2 1 2.5 2.5 2.5 4 0 .9-.4 1.7-.4 2.5a4 4 0 1 0 7.9-1c0-2.5-1.5-3.5-2-5.5-.4 1-1 1.5-1.8 1.8C16 8 14 6 14 4c0-.8-.7-1.4-2-2z" />
                  </svg>
                  {row.streak}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Footer note */}
        <div className="mt-8 rounded-xl bg-gray-50 px-4 py-3">
          <p className="text-[11px] text-gray-400">
            Your streak keeps your rank. Don&apos;t break it.
          </p>
        </div>
      </div>
    </main>
    <BottomNav />
    </>
  );
}
