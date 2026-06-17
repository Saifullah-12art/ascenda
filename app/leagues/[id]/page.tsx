"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import BottomNav from "@/components/BottomNav";
import Loading from "@/components/Loading";

// The league we're viewing.
type League = {
  id: string;
  name: string;
  invite_code: string;
};

// A member of this league.
type Member = {
  user_id: string;
  member_name: string;
};

// A post row as stored in `posts` (the fields the feed renders).
type Post = {
  id: string;
  author_name: string;
  task_did: string;
  motivation: string;
  created_at: string;
};

// Up to two initials from a name, e.g. "Jane Doe" -> "JD", "madonna" -> "M".
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

// Compact relative time from an ISO timestamp: "just now", "3h ago", "2d ago".
function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

export default function LeagueDetailPage() {
  const router = useRouter();
  const params = useParams();
  const supabase = createClient();

  // The dynamic [id] segment from the route.
  const leagueId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [league, setLeague] = useState<League | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [copied, setCopied] = useState(false);

  // On mount: require a user, then load the league, its members, and the
  // member-scoped feed.
  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/");
        return;
      }

      // The league. RLS only returns it if the user is a member — if nothing
      // comes back, they don't belong here, so send them to the list.
      const { data: leagueRow } = await supabase
        .from("leagues")
        .select("id, name, invite_code")
        .eq("id", leagueId)
        .maybeSingle();

      if (!leagueRow) {
        router.replace("/leagues");
        return;
      }
      setLeague(leagueRow as League);

      // The members. We need their user_ids to scope the feed.
      const { data: memberRows } = await supabase
        .from("league_members")
        .select("user_id, member_name")
        .eq("league_id", leagueId);

      const memberList = (memberRows as Member[]) ?? [];
      setMembers(memberList);

      // The scoped feed: posts authored by this league's members only, newest
      // first. Filter posts to the member user_ids with .in().
      const memberIds = memberList.map((m) => m.user_id);
      if (memberIds.length > 0) {
        const { data: postRows } = await supabase
          .from("posts")
          .select("id, author_name, task_did, motivation, created_at")
          .in("user_id", memberIds)
          .order("created_at", { ascending: false })
          .limit(50);

        setPosts((postRows as Post[]) ?? []);
      }

      setLoading(false);
    }

    load();
    // supabase/router/leagueId are stable for this screen; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Copy the invite code to the clipboard so it can be shared.
  async function handleCopy() {
    if (!league) return;
    try {
      await navigator.clipboard.writeText(league.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — leave the code visible to copy manually.
    }
  }

  // Show a loading state while data is fetching.
  if (loading || !league) {
    return <Loading />;
  }

  return (
    <>
      <main className="flex min-h-screen justify-center bg-white px-6 pt-10 pb-28">
        <div className="w-full max-w-[400px]">
          {/* Back link */}
          <Link href="/leagues" className="text-[13px] text-[#534AB7]">
            ← Leagues
          </Link>

          {/* Header: league name + invite code */}
          <h1 className="mt-3 text-[17px] font-medium text-gray-900">
            {league.name}
          </h1>
          <div className="mt-3 flex items-center justify-between rounded-lg bg-[#EEEDFE] px-3 py-2">
            <span className="text-[11px] font-medium tracking-wide text-[#534AB7]">
              {league.invite_code}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="text-[11px] font-medium text-[#534AB7]"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          {/* Members */}
          <section className="mt-8">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">
              Members · {members.length}
            </p>
            <div className="mt-4 flex flex-col gap-3">
              {members.map((member) => (
                <div key={member.user_id} className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EEEDFE] text-[11px] font-medium text-[#534AB7]">
                    {initials(member.member_name)}
                  </span>
                  <span className="truncate text-[13px] text-gray-900">
                    {member.member_name}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* League feed: posts from this league's members only */}
          <section className="mt-10">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">
              League feed
            </p>

            {posts.length === 0 ? (
              // Empty state
              <p className="mt-6 text-center text-[13px] text-gray-500">
                No one in this league has posted yet.
              </p>
            ) : (
              // Posts, newest first, with subtle separators between them.
              <div className="mt-4 flex flex-col divide-y-[0.5px] divide-gray-200">
                {posts.map((post) => (
                  <article key={post.id} className="flex gap-3 py-5">
                    {/* Avatar with the author's initials */}
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EEEDFE] text-[11px] font-medium text-[#534AB7]">
                      {initials(post.author_name)}
                    </span>

                    <div className="min-w-0 flex-1">
                      {/* Author + relative time */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-medium text-gray-900">
                          {post.author_name}
                        </span>
                        <span className="shrink-0 text-[10px] text-gray-400">
                          {relativeTime(post.created_at)}
                        </span>
                      </div>

                      {/* The completed task, with a small green check */}
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#1D9E75"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span className="text-[13px] text-gray-800">
                          {post.task_did}
                        </span>
                      </div>

                      {/* Motivation */}
                      <p className="mt-1.5 text-[12px] leading-relaxed text-gray-500">
                        {post.motivation}
                      </p>
                    </div>
                  </article>
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
