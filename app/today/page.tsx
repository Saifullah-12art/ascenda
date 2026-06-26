"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BottomNav from "@/components/BottomNav";
import Loading from "@/components/Loading";
import TaskEditSheet, { type TaskFormValues } from "@/components/TaskEditSheet";
import { taskIcon } from "@/lib/taskIcon";

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

// Display a stored time as "HH:MM" (the column may come back as "HH:MM:SS").
function displayTime(time: string): string {
  return time.slice(0, 5);
}

// Order tasks within a section by time. Zero-padded "HH:MM" sorts as a string;
// tasks without a time fall to the end, ties broken by their stored sort_order.
function byTime(a: Task, b: Task): number {
  const ta = a.time ?? "99:99";
  const tb = b.time ?? "99:99";
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.sort_order - b.sort_order;
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

  // Edit/add sheet state. `editingTask` is null when adding a new task.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  // Reload tasks + today's completions. Reused on mount and after every
  // add/edit/delete so the list and the completion percentage stay in sync.
  async function refresh() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.replace("/");
      return;
    }

    // RLS already scopes these to the user. We re-sort by time per section at
    // render, so the DB order here is just a stable fallback.
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
  }

  // On mount: load data, then drop the loading state.
  useEffect(() => {
    refresh().finally(() => setLoading(false));
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

  // Open the sheet to add a new task (empty form).
  function openAdd() {
    setEditingTask(null);
    setSheetOpen(true);
  }

  // Open the sheet pre-filled with an existing task.
  function openEdit(task: Task) {
    setEditingTask(task);
    setSheetOpen(true);
  }

  // Save handler for both add and edit. On edit we update the row in place; on
  // add we insert a new row owned by the user. RLS enforces ownership either way.
  async function handleSave(values: TaskFormValues) {
    setError(null);
    const time = values.time || null; // empty input → no time

    if (editingTask) {
      // Edit: update name, time, and section of the existing task.
      const { error: updError } = await supabase
        .from("tasks")
        .update({ name: values.name, time, section: values.section })
        .eq("id", editingTask.id);
      if (updError) {
        setError("Couldn't save that task. Please try again.");
        return;
      }
    } else {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/");
        return;
      }
      // Add: place it after every existing task; render then sorts it by time.
      const nextOrder =
        tasks.reduce((max, t) => Math.max(max, t.sort_order), -1) + 1;
      const { error: insError } = await supabase.from("tasks").insert({
        user_id: user.id,
        name: values.name,
        time,
        section: values.section,
        sort_order: nextOrder,
      });
      if (insError) {
        setError("Couldn't add that task. Please try again.");
        return;
      }
    }

    setSheetOpen(false);
    await refresh();
  }

  // Delete the editing task. We remove its completions first so no orphaned
  // rows are left behind to skew the streak/percentage math.
  async function handleDelete() {
    if (!editingTask) return;
    setError(null);

    const { error: compError } = await supabase
      .from("completions")
      .delete()
      .eq("task_id", editingTask.id);

    const { error: taskError } = await supabase
      .from("tasks")
      .delete()
      .eq("id", editingTask.id);

    if (compError || taskError) {
      setError("Couldn't delete that task. Please try again.");
      return;
    }

    setSheetOpen(false);
    await refresh();
  }

  // Show a loading state while data is fetching.
  if (loading) {
    return <Loading />;
  }

  return (
    <>
    <main className="flex min-h-screen justify-center bg-white px-6 pt-10 pb-28">
      <div className="w-full max-w-[380px]">
        {/* Header */}
        <p className="text-[11px] text-gray-400">{formatHeaderDate()}</p>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-[17px] font-medium text-gray-900">Your routine</h1>
          {/* `key={percent}` remounts the badge on change so it pops subtly. */}
          <span
            key={percent}
            className="animate-pop rounded-full bg-[#534AB7] px-2.5 py-1 text-[11px] font-medium text-white"
          >
            {percent}% done
          </span>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1 w-full rounded-full bg-[#EEEDFE]">
          <div
            className="h-1 rounded-full bg-[#534AB7] transition-all duration-300 ease-out"
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
              const sectionTasks = tasks
                .filter((t) => t.section === key)
                .sort(byTime);
              if (sectionTasks.length === 0) return null;

              return (
                <section key={key}>
                  <p className="mb-3 text-[11px] uppercase tracking-wide text-gray-400">
                    {label}
                  </p>
                  <div className="flex flex-col gap-1">
                    {sectionTasks.map((task) => {
                      const isDone = doneIds.has(task.id);
                      // Contextual icon derived from the name at render time —
                      // no schema/data change, works for AI and hand-added tasks.
                      const icon = taskIcon(task.name);
                      return (
                        <div key={task.id} className="flex items-center gap-1">
                          {/* Tap-to-complete area — unchanged behavior, just no
                              longer the whole row so it can't conflict with edit. */}
                          <button
                            type="button"
                            onClick={() => toggle(task.id)}
                            className="flex flex-1 items-center gap-3 py-2 text-left transition active:scale-[0.99]"
                          >
                            {/* Circular checkbox — empty ring with a green fill +
                                check that scale/fade in over the top when done. */}
                            <span className="relative h-5 w-5 shrink-0">
                              <span className="absolute inset-0 rounded-full border-[1.5px] border-gray-300" />
                              <span
                                className={`absolute inset-0 flex items-center justify-center rounded-full bg-[#1D9E75] transition-all duration-200 ease-out ${
                                  isDone ? "scale-100 opacity-100" : "scale-50 opacity-0"
                                }`}
                              >
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
                            </span>

                            {/* Contextual icon in a small soft-tinted tile —
                                sits between the check circle and the name to make
                                the row warm and scannable. Flat: rounded, no
                                shadow. Dims with the row when the task is done. */}
                            <span
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[14px] transition-opacity duration-200 ${
                                icon.tint
                              } ${isDone ? "opacity-50" : "opacity-100"}`}
                              aria-hidden="true"
                            >
                              {icon.emoji}
                            </span>

                            {/* Task name — color fades and the strikethrough line
                                draws in (scale-x) when done. */}
                            <span
                              className={`flex-1 text-[13px] transition-colors duration-200 ${
                                isDone ? "text-gray-400" : "text-gray-800"
                              }`}
                            >
                              <span className="relative inline-block">
                                {task.name}
                                <span
                                  className={`pointer-events-none absolute left-0 top-1/2 h-px w-full origin-left bg-current transition-transform duration-200 ease-out ${
                                    isDone ? "scale-x-100" : "scale-x-0"
                                  }`}
                                />
                              </span>
                            </span>

                            {/* Time on the right */}
                            {task.time && (
                              <span className="text-[11px] text-gray-400">
                                {displayTime(task.time)}
                              </span>
                            )}
                          </button>

                          {/* Subtle pencil — opens the edit sheet without
                              toggling completion. */}
                          <button
                            type="button"
                            onClick={() => openEdit(task)}
                            aria-label={`Edit ${task.name}`}
                            className="shrink-0 p-2 text-gray-300 transition active:scale-90 hover:text-gray-500"
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {/* Add task — subtle, sits below the list (and shows in the empty
            state too, so a user can build a routine by hand). */}
        <button
          type="button"
          onClick={openAdd}
          className="mt-8 w-full rounded-lg border border-dashed border-gray-200 py-3 text-[13px] font-medium text-[#534AB7] transition active:scale-[0.99]"
        >
          + Add task
        </button>
      </div>
    </main>
    <BottomNav />

    {/* Add/edit bottom sheet. `initial` pre-fills when editing; `onDelete` is
        only passed for an existing task, which is what shows the Delete action. */}
    <TaskEditSheet
      open={sheetOpen}
      initial={
        editingTask
          ? {
              name: editingTask.name,
              time: editingTask.time ? displayTime(editingTask.time) : "",
              section: editingTask.section,
            }
          : null
      }
      onClose={() => setSheetOpen(false)}
      onSave={handleSave}
      onDelete={editingTask ? handleDelete : undefined}
    />
    </>
  );
}
