"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import BottomNav from "@/components/BottomNav";
import Loading from "@/components/Loading";

// A league row plus the member count we compute alongside it.
type League = {
  id: string;
  name: string;
  invite_code: string;
  memberCount: number;
};

export default function LeaguesPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [leagues, setLeagues] = useState<League[]>([]);

  // Create / join form state.
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Which league's code was just copied (for the transient "Copied" label).
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Fetch the user's leagues. RLS on `leagues` returns only the rows the
  // current user belongs to, so a plain select is already scoped to them.
  // For each league we count its members from league_members (also RLS-scoped
  // to co-members), using a head+exact count so we don't pull the rows.
  async function loadLeagues() {
    const { data: leagueRows, error } = await supabase
      .from("leagues")
      .select("id, name, invite_code");

    if (error || !leagueRows) {
      setLeagues([]);
      return;
    }

    const withCounts = await Promise.all(
      leagueRows.map(async (l) => {
        const { count } = await supabase
          .from("league_members")
          .select("user_id", { count: "exact", head: true })
          .eq("league_id", l.id);

        return {
          id: l.id as string,
          name: l.name as string,
          invite_code: l.invite_code as string,
          memberCount: count ?? 0,
        };
      })
    );

    setLeagues(withCounts);
  }

  // On mount: require a user, then load their leagues.
  useEffect(() => {
    async function init() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/");
        return;
      }

      await loadLeagues();
      setLoading(false);
    }

    init();
    // supabase/router are stable; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Create a league via the create_league RPC, then refresh the list.
  async function handleCreate() {
    const leagueName = name.trim();
    if (!leagueName || creating) return;

    setCreating(true);
    const { error } = await supabase.rpc("create_league", {
      league_name: leagueName,
    });
    setCreating(false);

    if (!error) {
      setName("");
      await loadLeagues();
    }
  }

  // Join a league via the join_league RPC, then refresh. The function raises
  // 'Invalid invite code' for a bad code — surface that as a friendly message.
  async function handleJoin() {
    const inviteCode = code.trim();
    if (!inviteCode || joining) return;

    setJoining(true);
    setJoinError(null);
    const { error } = await supabase.rpc("join_league", { code: inviteCode });
    setJoining(false);

    if (error) {
      setJoinError("That invite code didn't work. Double-check it and try again.");
      return;
    }

    setCode("");
    await loadLeagues();
  }

  // Copy an invite code to the clipboard so it can be shared.
  async function handleCopy(league: League) {
    try {
      await navigator.clipboard.writeText(league.invite_code);
      setCopiedId(league.id);
      setTimeout(() => setCopiedId((id) => (id === league.id ? null : id)), 1500);
    } catch {
      // Clipboard blocked — nothing we can do, leave the code visible to copy.
    }
  }

  // Show a loading state while data is fetching.
  if (loading) {
    return <Loading />;
  }

  return (
    <>
      <main className="flex min-h-screen justify-center bg-white px-6 pt-10 pb-28">
        <div className="w-full max-w-[400px]">
          {/* Header */}
          <h1 className="text-[17px] font-medium text-gray-900">Leagues</h1>

          {/* Create a league */}
          <section className="mt-8">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">
              Create a league
            </p>
            <div className="mt-4 flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="League name"
                className="flex-1 rounded-xl border-[0.5px] border-gray-200 bg-white px-4 py-3 text-[13px] text-gray-800 placeholder:text-gray-400 focus:border-[#534AB7] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCreate}
                disabled={!name.trim() || creating}
                className="shrink-0 rounded-xl bg-[#534AB7] px-4 py-3 text-[13px] font-medium text-white disabled:opacity-50"
              >
                {creating ? "…" : "Create"}
              </button>
            </div>
          </section>

          {/* Join a league */}
          <section className="mt-8">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">
              Join a league
            </p>
            <div className="mt-4 flex gap-2">
              <input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  if (joinError) setJoinError(null);
                }}
                placeholder="Invite code"
                className="flex-1 rounded-xl border-[0.5px] border-gray-200 bg-white px-4 py-3 text-[13px] text-gray-800 placeholder:text-gray-400 focus:border-[#534AB7] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleJoin}
                disabled={!code.trim() || joining}
                className="shrink-0 rounded-xl bg-[#534AB7] px-4 py-3 text-[13px] font-medium text-white disabled:opacity-50"
              >
                {joining ? "…" : "Join"}
              </button>
            </div>
            {joinError && (
              <p className="mt-2 text-[11px] text-red-500">{joinError}</p>
            )}
          </section>

          {/* Your leagues */}
          <section className="mt-10">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">
              Your leagues
            </p>

            {leagues.length === 0 ? (
              // Empty state
              <p className="mt-6 text-center text-[13px] text-gray-500">
                You&apos;re not in any leagues yet. Create one or join with a code.
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-3">
                {leagues.map((league) => (
                  <Link
                    key={league.id}
                    href={`/leagues/${league.id}`}
                    className="block rounded-xl border-[0.5px] border-gray-200 bg-white px-4 py-3"
                  >
                    {/* Name + member count */}
                    <p className="text-[14px] font-medium text-gray-900">
                      {league.name}
                    </p>
                    <p className="mt-0.5 text-[11px] text-gray-400">
                      {league.memberCount}{" "}
                      {league.memberCount === 1 ? "member" : "members"}
                    </p>

                    {/* Invite code + copy */}
                    <div className="mt-3 flex items-center justify-between rounded-lg bg-[#EEEDFE] px-3 py-2">
                      <span className="text-[11px] font-medium tracking-wide text-[#534AB7]">
                        {league.invite_code}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          // Don't let a copy tap navigate into the league.
                          e.preventDefault();
                          handleCopy(league);
                        }}
                        className="text-[11px] font-medium text-[#534AB7]"
                      >
                        {copiedId === league.id ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
      <BottomNav />
    </>
  );
}
