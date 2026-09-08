"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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

function TodayView() {
  const router = useRouter();
  const supabase = createClient();

  // Onboarding sends the user here as `/today?new=1` right after generating
  // their routine — the only time we show the intro line below the header.
  // Read once into state: the effect below strips the param from the URL, and
  // we want the line to survive that and stay up for the rest of the visit.
  const searchParams = useSearchParams();
  const [isNewRoutine] = useState(() => searchParams.get("new") === "1");

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

  // Drop `?new=1` once we've read it, so a refresh or a shared link lands on a
  // plain /today. `scroll: false` keeps the view put; `isNewRoutine` is already
  // captured in state, so the line stays visible through this replace.
  useEffect(() => {
    if (isNewRoutine) {
      router.replace("/today", { scroll: false });
    }
    // Runs once — `isNewRoutine` never changes after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Completion percentage: done tasks / total tasks, rounded.
  const total = tasks.length;
  const doneCount = tasks.filter((t) => doneIds.has(t.id)).length;
  const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100);

  // "Up next" — the first task still to do, in the order the list renders
  // (sections in fixed order, sorted by time within each). It is the one row
  // on this screen that earns the theme's purple: the current thing to do,
  // readable at a glance. Null once everything is done, so a finished day
  // marks nothing. Mirrors mobile's TaskRow `upNext` prop.
  const upNextId =
    SECTIONS.flatMap(({ key }) =>
      tasks.filter((t) => t.section === key).sort(byTime),
    ).find((t) => !doneIds.has(t.id))?.id ?? null;

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
    <main className="flex min-h-screen justify-center bg-page px-6 pt-10 pb-28">
      <div className="w-full max-w-[380px]">
        {/* Header */}
        <p className="text-[11px] text-ink-muted">{formatHeaderDate()}</p>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-[17px] font-medium text-ink">Your routine</h1>
          {/* `key={percent}` remounts the badge on change so it pops subtly. */}
          <span
            key={percent}
            className="animate-pop rounded-full bg-purple px-2.5 py-1 text-[11px] font-medium text-white"
          >
            {percent}% done
          </span>
        </div>

        {/* Progress bar */}
        {/* `tint-track` is the theme's neutral track — a solid surface color
            behind a 1px bar would read as a second, brighter line on the page. */}
        <div className="mt-3 h-1 w-full rounded-full bg-tint-track">
          <div
            className="h-1 rounded-full bg-purple transition-all duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* First look at the freshly generated routine — reassure that it's a
            starting point, not something fixed. */}
        {isNewRoutine && (
          <p className="mt-3 text-[12px] leading-relaxed text-ink-2">
            Here&apos;s your starting routine, built from your answers. Make it
            yours — edit, add, or remove anything.
          </p>
        )}

        {error && <p className="mt-4 text-[11px] text-danger">{error}</p>}

        {/* Empty state */}
        {total === 0 ? (
          <p className="mt-16 text-center text-[13px] text-ink-2">
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
                  <p className="mb-3 text-[11px] uppercase tracking-wide text-ink-muted">
                    {label}
                  </p>
                  <div className="flex flex-col gap-2">
                    {sectionTasks.map((task) => {
                      const isDone = doneIds.has(task.id);
                      const isUpNext = task.id === upNextId;
                      // Contextual icon derived from the name at render time —
                      // no schema/data change, works for AI and hand-added tasks.
                      const icon = taskIcon(task.name);
                      return (
                        // Each row is an ordinary navy card, separated from
                        // its neighbours by a `line` hairline rather than a
                        // shadow — a black shadow on a near-black page shows
                        // nothing.
                        //
                        // Three states, and only one of them is purple:
                        //  - done    same surface, success-tinted edge, so the
                        //            finished row reads from its outline and
                        //            recedes beside the live ones
                        //  - up next the marked surface — `soft-purple` with a
                        //            purple edge and the glow. Exactly one row
                        //            can be in this state, which is what keeps
                        //            purple meaning "the current task" rather
                        //            than decorating the list
                        //  - resting the ordinary navy card
                        <div
                          key={task.id}
                          className={`flex items-center gap-1 rounded-2xl border-[1.5px] pl-2 pr-1 transition-colors duration-200 ${
                            isDone
                              ? "border-tint-success bg-card"
                              : isUpNext
                                ? "border-line-purple bg-soft-purple shadow-glow"
                                : "border-line bg-card"
                          }`}
                        >
                          {/* Tap-to-complete area — unchanged behavior, just no
                              longer the whole row so it can't conflict with edit. */}
                          <button
                            type="button"
                            onClick={() => toggle(task.id)}
                            className="flex flex-1 items-center gap-3 py-2.5 text-left transition active:scale-[0.99]"
                          >
                            {/* Circular checkbox — a `raised` well ringed in
                                `line`, with a brand-purple fill + check that
                                scale/fade in over the top when done. Purple, not
                                green: on mobile the filled circle is the row's
                                one earned purple moment, and the success color is
                                spent on the card's edge instead. */}
                            <span className="relative h-5 w-5 shrink-0">
                              <span className="absolute inset-0 rounded-full border-[1.5px] border-line bg-raised" />
                              <span
                                className={`absolute inset-0 flex items-center justify-center rounded-full bg-purple transition-all duration-200 ease-out ${
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

                            {/* Contextual icon in a small round tile — sits
                                between the check circle and the name to make the
                                row warm and scannable. Dims with the row when the
                                task is done.

                                `icon.tint` is deliberately unused. taskIcon's
                                tints are Tailwind 50-weights — near-white pastels
                                drawn for a white card — and a grid of them glaring
                                off a navy row is the opposite of what they were
                                for. The emoji already says which task this is, so
                                the tile is the plain `raised` surface. Mobile
                                dropped the tint at its own render site for the
                                same reason; lib/taskIcon.ts stays untouched and
                                byte-identical to mobile's port. */}
                            <span
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-raised text-[14px] transition-opacity duration-200 ${
                                isDone ? "opacity-50" : "opacity-100"
                              }`}
                              aria-hidden="true"
                            >
                              {icon.emoji}
                            </span>

                            {/* Task name — color fades and the strikethrough line
                                draws in (scale-x) when done. */}
                            <span
                              className={`flex-1 text-[13px] transition-colors duration-200 ${
                                isDone ? "text-ink-muted" : "text-ink"
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
                              <span
                                className={`text-[11px] ${
                                  isUpNext
                                    ? "font-semibold text-purple-soft"
                                    : "text-ink-muted"
                                }`}
                              >
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
                            className="shrink-0 p-2 text-ink-muted transition active:scale-90 hover:text-ink-2"
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
          className="mt-8 w-full rounded-lg border border-dashed border-line py-3 text-[13px] font-medium text-purple-soft transition hover:border-line-purple active:scale-[0.99]"
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

// `useSearchParams` needs a Suspense boundary above it in the App Router.
export default function TodayPage() {
  return (
    <Suspense fallback={<Loading />}>
      <TodayView />
    </Suspense>
  );
}
