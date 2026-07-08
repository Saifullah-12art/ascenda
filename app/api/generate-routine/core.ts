// Shared routine-generation logic used by BOTH the production API route
// (app/api/generate-routine/route.ts) and the dev test script
// (scripts/test-routine.ts). Keeping these here means the test exercises the
// exact same system prompt, parsing, and safety filter the route uses.
//
// This module is intentionally framework-free (no Next.js / Supabase imports)
// so it can run in a plain Node script as well as inside the route.

// Shape Claude must return. Kept in sync with the system prompt below.
export type GeneratedTask = {
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
export function screenTaskName(name: string): string | null {
  for (const rule of UNSAFE_RULES) {
    if (rule.pattern.test(name)) return rule.label;
  }
  return null;
}

// Drop any task whose name matches an unsafe pattern, logging each removal so
// we can see server-side if the model ever produces something it shouldn't.
export function filterSafeTasks(tasks: GeneratedTask[]): GeneratedTask[] {
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
export const DEFAULT_SAFE_TASKS: GeneratedTask[] = [
  { name: "Eat a balanced breakfast", time: "08:00", section: "morning" },
  { name: "Drink a glass of water", time: "10:00", section: "morning" },
  { name: "Take a short walk", time: "15:00", section: "afternoon" },
  { name: "Gentle wind-down before bed", time: "21:00", section: "evening" },
];

// Minimum number of safe tasks a routine must have to be considered usable.
export const MIN_SAFE_TASKS = 4;

// Hard ceiling on routine size. The system prompt says "never more than 7",
// but that was prompt-only until now — parseTasksFromText enforces it in code
// so an over-long response is rejected (and retried) instead of saved.
export const MAX_TASKS = 7;

// Human-readable labels for the five onboarding answers, used to build the
// user message. The keys match profiles.onboarding_answers.
export const ANSWER_LABELS: Record<string, string> = {
  main_goal: "Main goal",
  peak_time: "Most productive time of day",
  free_time: "Free time on a typical day",
  activity_level: "Current activity level",
  obstacle: "Biggest obstacle",
};

// --- System prompt: defines the planner's role, health/safety guardrails,
//     and the exact JSON contract. Only this text is tuned — the output
//     schema and all downstream parsing/saving are unchanged.
export const SYSTEM_PROMPT = `You are a supportive daily-routine planner for a general wellbeing app. You help everyday people build a realistic, sustainable daily rhythm. You are NOT a doctor, dietitian, therapist, or trainer.

Respond with ONLY valid JSON — no preamble, no markdown, no code fences — in exactly this shape:
{"tasks":[{"name":string,"time":"HH:MM","section":"morning"|"afternoon"|"evening"}]}

HOW TO BUILD THE ROUTINE (health-grounded and realistic):
- The routine MUST contain between 5 and 7 tasks total — and NEVER more than 7. This is a hard cap, not a suggestion: 8 or 9 tasks is not allowed under any circumstances. Default to 6 tasks for a typical or average person: 6 is the normal, expected size. Use fewer (around 5) for beginners or people short on time. Reserve 7 only for the rare profile whose answers clearly show BOTH high capacity/experience AND ample free time — if either is missing, stay at 6 or below.
- Favor a manageable, sustainable day over an idealized, overloaded one. Habit science shows tiny, consistent actions beat ambitious routines that get abandoned. Fewer, well-chosen anchors beat a full schedule — pick the highest-impact tasks rather than trying to cover every part of the day.
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
- When in doubt, choose the safer, gentler, more general option.

FINAL REMINDER: Default to 6 tasks for a typical person. Use 7 ONLY when the profile clearly shows both high capacity and ample time; otherwise 5-6. Never more than 7, and never 8 or 9. Return only the highest-impact tasks.`;

// Build the user message from a profile's onboarding answers — a readable
// summary of the five answers followed by the generation request.
export function buildUserMessage(answers: Record<string, string>): string {
  const answerSummary = Object.entries(ANSWER_LABELS)
    .map(([key, label]) => `- ${label}: ${answers[key] ?? "Not provided"}`)
    .join("\n");

  return `Here is the user's profile from onboarding:\n\n${answerSummary}\n\nGenerate their personalized daily routine as JSON. Keep it realistic, sustainable, and safe — scaled to where this person actually is right now, not an idealized version of them.`;
}

// Valid "HH:MM" 24-hour time, zero-padded — the exact format the prompt asks
// for and the format the rest of the app stores and sorts as a string.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const VALID_SECTIONS: ReadonlySet<string> = new Set([
  "morning",
  "afternoon",
  "evening",
]);

// Parse Claude's raw text response into tasks: strip any ```json fences just
// in case, then JSON.parse and validate the shape. Every check here throws on
// bad output so the caller's retry path handles it — including the MAX_TASKS
// ceiling and per-item shape, which were previously enforced only by the
// prompt.
export function parseTasksFromText(rawText: string): GeneratedTask[] {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "") // leading fence
    .replace(/\s*```$/i, "") // trailing fence
    .trim();

  const parsed = JSON.parse(cleaned) as { tasks?: GeneratedTask[] };
  if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
    throw new Error("Response JSON did not contain a 'tasks' array.");
  }
  if (parsed.tasks.length > MAX_TASKS) {
    throw new Error(
      `Response contained ${parsed.tasks.length} tasks — more than the maximum of ${MAX_TASKS}.`
    );
  }
  for (const task of parsed.tasks) {
    if (!task || typeof task !== "object") {
      throw new Error("Response contained a non-object task entry.");
    }
    if (typeof task.name !== "string" || task.name.trim().length === 0) {
      throw new Error("Response contained a task with a missing/empty name.");
    }
    if (typeof task.time !== "string" || !TIME_RE.test(task.time)) {
      throw new Error(
        `Response contained a task with an invalid time: ${JSON.stringify(task.time)}.`
      );
    }
    if (typeof task.section !== "string" || !VALID_SECTIONS.has(task.section)) {
      throw new Error(
        `Response contained a task with an invalid section: ${JSON.stringify(task.section)}.`
      );
    }
  }
  return parsed.tasks;
}
