"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import BottomNav from "@/components/BottomNav";
import Loading from "@/components/Loading";

// A post row as stored in the `posts` table (the fields the feed renders).
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

export default function FeedPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<Post[]>([]);

  // On mount: require a user, then load the newest posts.
  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/");
        return;
      }

      // RLS lets any authenticated user read all posts. Newest first, capped.
      const { data: postRows } = await supabase
        .from("posts")
        .select("id, author_name, task_did, motivation, created_at")
        .order("created_at", { ascending: false })
        .limit(50);

      setPosts((postRows as Post[]) ?? []);
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
      <main className="flex min-h-screen justify-center bg-white px-6 pt-10 pb-28">
        <div className="w-full max-w-[400px]">
          {/* Header */}
          <h1 className="text-[17px] font-medium text-gray-900">Feed</h1>

          {/* Share CTA */}
          <Link
            href="/compose"
            className="mt-4 block w-full rounded-xl bg-[#534AB7] px-4 py-3 text-center text-[13px] font-medium text-white"
          >
            Share today&apos;s win
          </Link>

          {/* Empty state */}
          {posts.length === 0 ? (
            <p className="mt-16 text-center text-[13px] text-gray-500">
              No posts yet — be the first to share.
            </p>
          ) : (
            // Posts, newest first, with subtle separators between them.
            <div className="mt-6 flex flex-col divide-y-[0.5px] divide-gray-200">
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
        </div>
      </main>
      <BottomNav />
    </>
  );
}
