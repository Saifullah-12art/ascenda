import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getRequestUser } from "@/lib/supabase/request-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  type GeneratedTask,
  SYSTEM_PROMPT,
  buildUserMessage,
  parseTasksFromText,
  filterSafeTasks,
  DEFAULT_SAFE_TASKS,
  MIN_SAFE_TASKS,
} from "./core";

// Rate limit: at most this many generation attempts per user per rolling 24h.
// Attempts are logged before the Claude call, so failures count too — the
// limit protects API credits, not just successful generations.
const GENERATION_LIMIT = 5;
const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  // 1. Require a logged-in user — via session cookies (web) or an
  //    Authorization: Bearer header (mobile). Either way, `supabase` is an
  //    RLS-scoped client acting as that user.
  const { user, supabase } = await getRequestUser(request);

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // 2. Load the user's onboarding answers from their profile.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("onboarding_answers")
    .eq("id", user.id)
    .single();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const answers = profile?.onboarding_answers as Record<string, string> | null;
  if (!answers || Object.keys(answers).length === 0) {
    return NextResponse.json(
      { error: "No onboarding answers found. Complete onboarding first." },
      { status: 400 }
    );
  }

  // 3. Build the system prompt and user message from the shared core module
  //    (the same prompt the dev test script exercises).
  const systemPrompt = SYSTEM_PROMPT;
  const userMessage = buildUserMessage(answers);

  // 4. Call Claude (server-side only — key never leaves the server).
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured." },
      { status: 500 }
    );
  }

  // 4b. Rate limit + attempt log, insert-first so concurrent requests can't
  //     slip past a stale count: log THIS attempt, then read the user's
  //     attempts in the window (own row included) and reject only if our own
  //     row's position is past the limit. A burst of parallel requests each
  //     insert before any of them reads, so they see each other's rows and
  //     exactly the first five (by created_at, then id) proceed. Rejection
  //     deletes our own row before the 429 — attempts that never reach
  //     Claude don't burn a slot, and retry-tapping can't extend the user's
  //     own lockout. A race at the window boundary (a row aging out
  //     mid-burst) can still admit roughly one extra request; accepted at
  //     current scale. If that ever matters, the upgrade path is a Postgres
  //     function wrapping insert+read in
  //     pg_advisory_xact_lock(hashtext(user_id::text)).
  //
  //     generation_log has RLS with no client policies, so it is readable/
  //     writable only through the service-role client. Sitting after the
  //     profile checks, cheap failures (400s) never insert a row at all —
  //     every attempt logged here was about to spend API credits.
  const admin = createAdminClient();
  const windowStart = new Date(Date.now() - WINDOW_MS);

  const { data: logRow, error: logError } = await admin
    .from("generation_log")
    .insert({ user_id: user.id })
    .select("id")
    .single();

  if (logError) {
    // Admin-client errors never reach the client — log server-side only.
    console.error("[generate-routine] rate-limit log insert failed:", logError);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }

  const { data: windowAttempts, error: limitError } = await admin
    .from("generation_log")
    .select("id, created_at")
    .eq("user_id", user.id)
    .gte("created_at", windowStart.toISOString())
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (limitError) {
    // Can't tell if we're over the limit — release the slot and fail.
    await admin.from("generation_log").delete().eq("id", logRow.id);
    console.error("[generate-routine] rate-limit window read failed:", limitError);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }

  // Positional check, so a burst is fair: with the window ordered by
  // (created_at, id) — id as the deterministic tiebreak for identical
  // timestamps — the first GENERATION_LIMIT rows keep their slots and only
  // this request rejects itself if its OWN row sits past them. Later inserts
  // always order after ours (monotonic ids), so our position is stable.
  const ownPosition = (windowAttempts ?? []).findIndex(
    (row) => row.id === logRow.id
  );

  if (ownPosition >= GENERATION_LIMIT) {
    await admin.from("generation_log").delete().eq("id", logRow.id);
    // The next slot opens when the oldest remaining attempt ages out. Our own
    // just-deleted row ordered past the first five, so windowAttempts[0] is a
    // prior one.
    const oldest = new Date(windowAttempts![0].created_at as string);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest.getTime() + WINDOW_MS - Date.now()) / 1000)
    );
    return NextResponse.json(
      {
        error:
          "You've reached the routine generation limit (5 per day). Please try again later.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      }
    );
  }

  const anthropic = new Anthropic({ apiKey });

  // One full generation round-trip: call Claude, then parse the JSON. Throws
  // on API failure or unparseable output so the caller can decide whether to
  // surface the error or regenerate. Used twice (initial + one retry).
  const generateAndParse = async (): Promise<GeneratedTask[]> => {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    // Collect the text from the response content blocks.
    const rawText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    // Shared parser: strips any ```json fences, JSON.parse, validates shape.
    return parseTasksFromText(rawText);
  };

  // 4 + 5. Generate and parse the first routine. A failure here (API or
  // unparseable output) is surfaced to the client as before.
  let generated: GeneratedTask[];
  try {
    generated = await generateAndParse();
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to generate routine from Claude: ${detail}` },
      { status: 500 }
    );
  }

  // 5b. Deterministic safety backstop, applied between parsing and saving.
  //     Screen every task name and drop anything matching an unsafe pattern,
  //     even if the prompt's guardrails appeared to hold.
  let tasks = filterSafeTasks(generated);

  // If filtering left too few usable tasks, regenerate once with the same
  // prompt. If the retry still comes back too short or unsafe, fall back to a
  // small set of safe defaults so the user always gets a usable, safe routine.
  if (tasks.length < MIN_SAFE_TASKS) {
    console.warn(
      `[generate-routine] Only ${tasks.length} safe task(s) after filtering; regenerating once.`
    );
    try {
      const retried = filterSafeTasks(await generateAndParse());
      tasks = retried.length >= MIN_SAFE_TASKS ? retried : DEFAULT_SAFE_TASKS;
    } catch {
      // Retry failed outright (API or parse error) — defaults still apply.
      tasks = DEFAULT_SAFE_TASKS;
    }
    if (tasks === DEFAULT_SAFE_TASKS) {
      console.warn(
        "[generate-routine] Regeneration still unsafe/short; using safe default routine."
      );
    }
  }

  // 6. Clean regeneration: delete this user's existing tasks first.
  const { error: deleteError } = await supabase
    .from("tasks")
    .delete()
    .eq("user_id", user.id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  // 7. Insert the new tasks. sort_order = array index; user_id = current user.
  //    RLS is respected because we use the per-request server client.
  const rows = tasks.map((task, index) => ({
    user_id: user.id,
    name: task.name,
    time: task.time,
    section: task.section,
    sort_order: index,
  }));

  const { error: insertError } = await supabase.from("tasks").insert(rows);

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, count: rows.length });
}
