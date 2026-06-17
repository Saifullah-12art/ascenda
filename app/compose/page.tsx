"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// A completed task we can share — just the name we need for the snapshot.
type CompletedTask = {
  id: string;
  name: string;
};

// Local YYYY-MM-DD for "today" — same scheme used across the app (local, not
// UTC) so the date we read/write lines up with the user's wall clock and the
// completions written by the Today screen.
function localToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// "Saturday, June 14" for the header.
function formatHeaderDate(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export default function ComposePage() {
  const router = useRouter();
  const supabase = createClient();

  const [today] = useState(localToday); // stable for the lifetime of the screen

  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState<string>(""); // author_name snapshot
  const [completedTasks, setCompletedTasks] = useState<CompletedTask[]>([]);
  const [alreadyPosted, setAlreadyPosted] = useState(false);

  // Form state.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [motivation, setMotivation] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [shared, setShared] = useState(false); // post succeeded this session
  const [error, setError] = useState<string | null>(null);

  // On mount: require a user, then load everything the screen branches on —
  // the profile name, the tasks completed today, and whether a post exists.
  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/");
        return;
      }

      // Profile (for the author_name snapshot), all tasks, today's completions,
      // and any existing post for today — fetched together.
      const [
        { data: profile },
        { data: taskRows },
        { data: completionRows },
        { data: existingPost },
      ] = await Promise.all([
        supabase.from("profiles").select("full_name").eq("id", user.id).single(),
        supabase.from("tasks").select("id, name").order("sort_order", { ascending: true }),
        supabase.from("completions").select("task_id").eq("date", today),
        supabase
          .from("posts")
          .select("id")
          .eq("user_id", user.id)
          .eq("date", today)
          .maybeSingle(),
      ]);

      setFullName(profile?.full_name ?? "");

      // Derive completed tasks: the tasks whose id appears in today's completions.
      const doneIds = new Set((completionRows ?? []).map((c) => c.task_id as string));
      const done = ((taskRows as CompletedTask[]) ?? []).filter((t) =>
        doneIds.has(t.id)
      );
      setCompletedTasks(done);

      setAlreadyPosted(Boolean(existingPost));
      setLoading(false);
    }

    load();
    // supabase/router are stable; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The Post button only enables once a task is picked and there's some text.
  const canSubmit =
    selectedTaskId !== null && motivation.trim().length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;

    const task = completedTasks.find((t) => t.id === selectedTaskId);
    if (!task) return;

    setSubmitting(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.replace("/");
      return;
    }

    // Store text snapshots of the task name and author name so the post stays
    // intact even if the task or profile changes later.
    const { error: insertError } = await supabase.from("posts").insert({
      user_id: user.id,
      author_name: fullName,
      task_did: task.name,
      motivation: motivation.trim(),
      date: today,
    });

    setSubmitting(false);

    if (insertError) {
      // Unique (user_id, date) violation → they already posted today. Flip to
      // the already-posted state rather than showing a generic error.
      if (insertError.code === "23505") {
        setAlreadyPosted(true);
        return;
      }
      setError("Couldn't share your post. Please try again.");
      return;
    }

    setShared(true);
  }

  // Hold the layout still while loading.
  if (loading) {
    return <main className="min-h-screen bg-white" />;
  }

  // Shared this session — confirmation.
  if (shared) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-white px-6">
        <p className="text-[17px] font-medium text-gray-900">Shared! ✓</p>
        <Link href="/today" className="mt-4 text-[13px] text-[#534AB7]">
          Back to today
        </Link>
      </main>
    );
  }

  // Already posted today (on load, or hit the unique conflict on submit).
  if (alreadyPosted) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-white px-6">
        <p className="text-[17px] font-medium text-gray-900">
          You&apos;ve shared today ✓
        </p>
        <Link href="/today" className="mt-4 text-[13px] text-[#534AB7]">
          Back to today
        </Link>
      </main>
    );
  }

  // Nothing completed yet — nothing to share.
  if (completedTasks.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-white px-6 text-center">
        <p className="text-[13px] text-gray-500">
          Finish a task first, then come back to share it
        </p>
        <Link href="/today" className="mt-4 text-[13px] text-[#534AB7]">
          Go to today
        </Link>
      </main>
    );
  }

  // The form.
  return (
    <main className="flex min-h-screen justify-center bg-white px-6 pt-10 pb-16">
      <div className="w-full max-w-[380px]">
        {/* Header */}
        <p className="text-[11px] text-gray-400">{formatHeaderDate()}</p>
        <h1 className="mt-1 text-[17px] font-medium text-gray-900">Today&apos;s post</h1>

        {/* Task picker — single-select cards, same style as onboarding. */}
        <p className="mt-8 text-[11px] uppercase tracking-wide text-gray-400">
          What did you do today?
        </p>
        <div className="mt-4 flex flex-col gap-3">
          {completedTasks.map((task) => {
            const isSelected = selectedTaskId === task.id;
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => setSelectedTaskId(task.id)}
                className={`flex items-center justify-between rounded-xl px-4 py-3 text-left text-[13px] transition-colors ${
                  isSelected
                    ? "border-[1.5px] border-[#534AB7] bg-[#EEEDFE] text-[#534AB7]"
                    : "border-[0.5px] border-gray-200 bg-white text-gray-800"
                }`}
              >
                <span>{task.name}</span>
                {/* Check icon only on the selected card */}
                {isSelected && (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#534AB7"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>

        {/* Motivation */}
        <p className="mt-8 text-[11px] uppercase tracking-wide text-gray-400">
          What pushed you to do it?
        </p>
        <textarea
          value={motivation}
          onChange={(e) => setMotivation(e.target.value)}
          rows={4}
          placeholder="Share what kept you going…"
          className="mt-4 w-full resize-none rounded-xl border-[0.5px] border-gray-200 bg-white px-4 py-3 text-[13px] text-gray-800 placeholder:text-gray-400 focus:border-[#534AB7] focus:outline-none"
        />

        {error && <p className="mt-4 text-[11px] text-red-500">{error}</p>}

        {/* Post */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="mt-8 w-full rounded-xl bg-[#534AB7] px-4 py-3 text-[13px] font-medium text-white disabled:opacity-50"
        >
          {submitting ? "Posting…" : "Post"}
        </button>
      </div>
    </main>
  );
}
