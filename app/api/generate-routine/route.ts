import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

// Shape Claude must return. Kept in sync with the system prompt below.
type GeneratedTask = {
  name: string;
  time: string; // "HH:MM"
  section: "morning" | "afternoon" | "evening";
};

// --- Safety backstop -------------------------------------------------------
// Deterministic screen applied to every generated task name before saving.
// The system prompt steers the model away from unsafe output, but this layer
// guarantees the most dangerous cases never reach a real user even if the
// model ever slips. Each rule carries a label so filtered tasks are logged
// with the reason they were dropped.
type SafetyRule = { label: string; pattern: RegExp };

const UNSAFE_RULES: SafetyRule[] = [
  // Calorie / numeric diet targets: a number sitting next to cal/calorie/kcal,
  // in either order ("500 cal", "1200 kcal", "calorie 1200", "cal: 500").
  { label: "calorie-target", pattern: /\b[\d,]+\s*(kcals?|cals?|calories?)\b/i },
  {
    label: "calorie-target",
    // Keyword first, then a number either directly ("calorie 1500") or after a
    // diet-target word ("calorie limit: 1500"). The constrained gap avoids
    // reaching across unrelated numbers ("track calories then walk 20 min").
    pattern:
      /\b(kcals?|cals?|calories?)\b[\s:]*(target|limit|goal|max(imum)?|cap|budget|count|intake|deficit|of)?[\s:]*[\d,]+/i,
  },
  // Fasting / starvation protocols. \b boundaries are deliberate so ordinary
  // words like "breakfast" (no boundary before "fast") never trigger this.
  { label: "fasting", pattern: /\bfast(ing|ed|s)?\b/i },
  { label: "starvation", pattern: /\bstarv(e|es|ed|ing|ation)\b/i },
  // Extreme / punishing exercise language.
  {
    label: "extreme-exercise",
    pattern: /\b(intense|extreme(ly)?|punishing|gruell?ing)\b/i,
  },
  { label: "extreme-exercise", pattern: /\bto (exhaustion|failure)\b/i },
  { label: "extreme-exercise", pattern: /\bno (rest|days off)\b/i },
  // Disordered-eating / purging language.
  {
    label: "disordered-eating",
    pattern:
      /\b(purg(e|es|ed|ing)|vomit(ing|ed|s)?|laxatives?|binge|anorexi\w*|bulimi\w*|thinspo\w*)\b/i,
  },
  {
    label: "disordered-eating",
    pattern: /\bskip(ping)?\s+(a\s+|your\s+|the\s+)?meals?\b/i,
  },
  // Numeric weight-loss goals: "lose 5 kg", "drop 10 lbs", "shed 8 pounds".
  {
    label: "weight-loss-target",
    pattern:
      /\b(lose|drop|shed|cut)\s+[\d,.]+\s*(kg|kgs|kilo(gram)?s?|lbs?|pounds?|%)\b/i,
  },
];

// Returns the label of the first matching unsafe rule, or null if the name
// passes every screen.
function screenTaskName(name: string): string | null {
  for (const rule of UNSAFE_RULES) {
    if (rule.pattern.test(name)) return rule.label;
  }
  return null;
}

// Drop any task whose name matches an unsafe pattern, logging each removal so
// we can see server-side if the model ever produces something it shouldn't.
function filterSafeTasks(tasks: GeneratedTask[]): GeneratedTask[] {
  const safe: GeneratedTask[] = [];
  for (const task of tasks) {
    const matched = screenTaskName(task?.name ?? "");
    if (matched) {
      console.warn(
        `[generate-routine] Filtered unsafe task (rule: ${matched}): ${JSON.stringify(
          task?.name
        )}`
      );
      continue;
    }
    safe.push(task);
  }
  return safe;
}

// If generation keeps producing unsafe/too-short output, fall back to this
// small, balanced, always-safe routine so the user is never left with nothing.
const DEFAULT_SAFE_TASKS: GeneratedTask[] = [
  { name: "Eat a balanced breakfast", time: "08:00", section: "morning" },
  { name: "Drink a glass of water", time: "10:00", section: "morning" },
  { name: "Take a short walk", time: "15:00", section: "afternoon" },
  { name: "Gentle wind-down before bed", time: "21:00", section: "evening" },
];

// Minimum number of safe tasks a routine must have to be considered usable.
const MIN_SAFE_TASKS = 4;

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

  // --- System prompt: defines the planner's role, health/safety guardrails,
  //     and the exact JSON contract. Only this text is tuned — the output
  //     schema and all downstream parsing/saving are unchanged.
  const systemPrompt = `You are a supportive daily-routine planner for a general wellbeing app. You help everyday people build a realistic, sustainable daily rhythm. You are NOT a doctor, dietitian, therapist, or trainer.

Respond with ONLY valid JSON — no preamble, no markdown, no code fences — in exactly this shape:
{"tasks":[{"name":string,"time":"HH:MM","section":"morning"|"afternoon"|"evening"}]}

HOW TO BUILD THE ROUTINE (health-grounded and realistic):
- Favor a manageable, sustainable day over an idealized, overloaded one. Habit science shows tiny, consistent actions beat ambitious routines that get abandoned. Aim for 5 to 7 tasks — use fewer (around 5) for beginners or people short on time, and more (up to 7) only when their answers clearly show capacity and experience.
- Make each task small, specific, and achievable (e.g. "10-minute walk", "Drink a glass of water", "5 minutes of stretching", "Read one page"), not vague or intense (avoid "intense workout", "study for 4 hours").
- Anchor the day with simple foundations: a consistent wake-up, regular balanced meals, some gentle movement, time for the user's main goal, and a calming wind-down before bed.
- Balance tasks sensibly across morning, afternoon, and evening rather than cramming one part of the day.
- Use 24-hour "HH:MM" times, order tasks chronologically, and set "section" to morning, afternoon, or evening to match each time.

SCALE TO THE PERSON:
- If their answers suggest they are a beginner, low on activity, short on free time, or struggling with obstacles, keep the routine lighter, gentler, and clearly buildable — something they can succeed at and grow from. Never prescribe a hardcore or demanding regimen to someone who is just starting.
- Let later progression be implied by leaving room to grow, not by packing the day.

SAFETY GUARDRAILS (must always follow):
- Never give medical advice, never diagnose, and never reference treating, curing, or managing any medical condition. The tasks are general lifestyle habits only.
- Never produce extreme or harmful routines: no excessive or punishing exercise, no extreme calorie restriction, no fasting protocols, and nothing resembling disordered eating or compulsive exercise.
- Never prescribe a specific restrictive diet, macro plan, calorie target, or numeric weight goal. Keep food tasks to balanced, normal, non-numeric guidance (e.g. "Eat a balanced breakfast", "Have a vegetable with lunch").
- If the user's goals or answers touch on a medical condition, injury, pregnancy, mental-health crisis, or any risky or clinically sensitive target, keep every task general, gentle, and safe, and avoid anything that would require medical supervision. Default to conservative, broadly healthy habits.
- When in doubt, choose the safer, gentler, more general option.`;

  // --- User message: the readable summary of the five answers.
  const userMessage = `Here is the user's profile from onboarding:\n\n${answerSummary}\n\nGenerate their personalized daily routine as JSON. Keep it realistic, sustainable, and safe — scaled to where this person actually is right now, not an idealized version of them.`;

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

    // Strip any ```json fences just in case, then JSON.parse.
    const cleaned = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, "") // leading fence
      .replace(/\s*```$/i, "") // trailing fence
      .trim();

    const parsed = JSON.parse(cleaned) as { tasks?: GeneratedTask[] };
    if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
      throw new Error("Response JSON did not contain a 'tasks' array.");
    }
    return parsed.tasks;
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
