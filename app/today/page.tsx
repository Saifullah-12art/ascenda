"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// A task row as stored in the `tasks` table.
type Task = {
  id: string;
  name: string;
  time: string | null;
  section: "morning" | "afternoon" | "evening";
  sort_order: number;
};

// Sections render in this fixed order with these display labels.
const SECTIONS: { key: Task["section"]; label: string }[] = [
  { key: "morning", label: "Morning" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
];

// Local YYYY-MM-DD for "today" — computed once and reused for reads and writes
// so a completion's date always matches what we query. Using local (not UTC)
// keeps the day aligned with the user's wall clock.
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

export default function TodayPage() {
  const router = useRouter();
  const supabase = createClient();

  const [today] = useState(localToday); // stable for the lifetime of the screen
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  // Set of task ids completed today — the source of truth for done/not-done.
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // On mount: require a user, then load tasks + today's completions.
  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/");
        return;
      }

      // Tasks in display order. RLS already scopes these to the user.
      const { data: taskRows } = await supabase
        .from("tasks")
        .select("id, name, time, section, sort_order")
        .order("sort_order", { ascending: true });

      // Today's completions — we only need the task ids.
      const { data: completionRows } = await supabase
        .from("completions")
        .select("task_id")
        .eq("date", today);

      setTasks((taskRows as Task[]) ?? []);
      setDoneIds(new Set((completionRows ?? []).map((c) => c.task_id as string)));
      setLoading(false);
    }

    load();
    // supabase/router are stable; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Completion percentage: done tasks / total tasks, rounded.
  const total = tasks.length;
  const doneCount = tasks.filter((t) => doneIds.has(t.id)).length;
  const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100);

  // Toggle a task's completion for today, optimistically.
  async function toggle(taskId: string) {
    const wasDone = doneIds.has(taskId);

    // 1) Flip the UI immediately.
    setDoneIds((prev) => {
      const next = new Set(prev);
      if (wasDone) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.replace("/");
      return;
    }

    // 2) Persist the change.
    let dbError = null;
    if (wasDone) {
      // Was done → remove today's completion.
      const { error: delError } = await supabase
        .from("completions")
        .delete()
        .eq("task_id", taskId)
        .eq("date", today);
      dbError = delError;
    } else {
      // Wasn't done → add a completion for today, passing the date explicitly.
      const { error: insError } = await supabase
        .from("completions")
        .insert({ user_id: user.id, task_id: taskId, date: today });

      // The unique (task_id, date) constraint means a row may already exist
      // (e.g. double-tap or a stale view). That's the state we wanted, so
      // treat a conflict as success rather than reverting.
      if (insError && insError.code !== "23505") dbError = insError;
    }

    // 3) On real failure, revert the optimistic flip and warn.
    if (dbError) {
      setDoneIds((prev) => {
        const next = new Set(prev);
        if (wasDone) next.add(taskId);
        else next.delete(taskId);
        return next;
      });
      setError("Couldn't save that. Please try again.");
    }
  }

  // Hold the layout still while loading.
  if (loading) {
    return <main className="min-h-screen bg-white" />;
  }

  return (
    <main className="flex min-h-screen justify-center bg-white px-6 py-10">
      <div className="w-full max-w-[380px]">
        {/* Header */}
        <p className="text-[11px] text-gray-400">{formatHeaderDate()}</p>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-[17px] font-medium text-gray-900">Your routine</h1>
          <span className="rounded-full bg-[#534AB7] px-2.5 py-1 text-[11px] font-medium text-white">
            {percent}% done
          </span>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1 w-full rounded-full bg-[#EEEDFE]">
          <div
            className="h-1 rounded-full bg-[#534AB7] transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>

        {error && <p className="mt-4 text-[11px] text-red-500">{error}</p>}

        {/* Empty state */}
        {total === 0 ? (
          <p className="mt-16 text-center text-[13px] text-gray-500">
            No routine yet
          </p>
        ) : (
          // One block per section, in fixed order. Skip empty sections.
          <div className="mt-8 flex flex-col gap-7">
            {SECTIONS.map(({ key, label }) => {
              const sectionTasks = tasks.filter((t) => t.section === key);
              if (sectionTasks.length === 0) return null;

              return (
                <section key={key}>
                  <p className="mb-3 text-[11px] uppercase tracking-wide text-gray-400">
                    {label}
                  </p>
                  <div className="flex flex-col gap-1">
                    {sectionTasks.map((task) => {
                      const isDone = doneIds.has(task.id);
                      return (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => toggle(task.id)}
                          className="flex items-center gap-3 py-2 text-left"
                        >
                          {/* Circular checkbox */}
                          {isDone ? (
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1D9E75]">
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="white"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </span>
                          ) : (
                            <span className="h-5 w-5 shrink-0 rounded-full border-[1.5px] border-gray-300" />
                          )}

                          {/* Task name — struck through + muted when done */}
                          <span
                            className={`flex-1 text-[13px] ${
                              isDone
                                ? "text-gray-400 line-through"
                                : "text-gray-800"
                            }`}
                          >
                            {task.name}
                          </span>

                          {/* Time on the right */}
                          {task.time && (
                            <span className="text-[11px] text-gray-400">
                              {task.time}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
