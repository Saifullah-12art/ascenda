import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

// Shape Claude must return. Kept in sync with the system prompt below.
type GeneratedTask = {
  name: string;
  time: string; // "HH:MM"
  section: "morning" | "afternoon" | "evening";
};

// Human-readable labels for the five onboarding answers, used to build the
// user message. The keys match profiles.onboarding_answers.
const ANSWER_LABELS: Record<string, string> = {
  main_goal: "Main goal",
  peak_time: "Most productive time of day",
  free_time: "Free time on a typical day",
  activity_level: "Current activity level",
  obstacle: "Biggest obstacle",
};

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

  // 3. Build a readable summary of the five answers for the user message.
  const answerSummary = Object.entries(ANSWER_LABELS)
    .map(([key, label]) => `- ${label}: ${answers[key] ?? "Not provided"}`)
    .join("\n");

  // --- System prompt: defines the planner's role and the exact JSON contract.
  const systemPrompt = `You are a daily routine planner. Generate a personalized daily routine based on the user's profile.

Respond with ONLY valid JSON — no preamble, no markdown, no code fences — in exactly this shape:
{"tasks":[{"name":string,"time":"HH:MM","section":"morning"|"afternoon"|"evening"}]}

Requirements:
- Include 7 to 9 tasks covering wake-up, meals, exercise, study/work, and a wind-down/bedtime.
- Use 24-hour "HH:MM" times and order the tasks chronologically by time.
- Assign "section" based on the time of day (morning, afternoon, or evening).
- Tailor the tasks to the user's answers (their goal, peak time, free time, activity level, and obstacle).`;

  // --- User message: the readable summary of the five answers.
  const userMessage = `Here is the user's profile from onboarding:\n\n${answerSummary}\n\nGenerate their personalized daily routine as JSON.`;

  // 4. Call Claude (server-side only — key never leaves the server).
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured." },
      { status: 500 }
    );
  }

  const anthropic = new Anthropic({ apiKey });

  let rawText: string;
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    // Collect the text from the response content blocks.
    rawText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Claude API request failed: ${detail}` },
      { status: 500 }
    );
  }

  // 5. Parse the response. Strip any ```json fences just in case, then JSON.parse.
  let tasks: GeneratedTask[];
  try {
    const cleaned = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, "") // leading fence
      .replace(/\s*```$/i, "") // trailing fence
      .trim();

    const parsed = JSON.parse(cleaned) as { tasks?: GeneratedTask[] };
    if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
      throw new Error("Response JSON did not contain a 'tasks' array.");
    }
    tasks = parsed.tasks;
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to parse routine from Claude: ${detail}` },
      { status: 500 }
    );
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
