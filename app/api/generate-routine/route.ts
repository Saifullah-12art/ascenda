import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import {
  type GeneratedTask,
  SYSTEM_PROMPT,
  buildUserMessage,
  parseTasksFromText,
  filterSafeTasks,
  DEFAULT_SAFE_TASKS,
  MIN_SAFE_TASKS,
} from "./core";

export async function POST() {
  // 1. Require a logged-in user.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
