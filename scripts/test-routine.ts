/**
 * Throwaway dev script to eyeball routine-generation behavior without making
 * accounts or going through onboarding.
 *
 * It reuses the REAL generation logic from the route's shared core module —
 * the same system prompt, the same parser, and the same safety filter — so
 * what you see here reflects production behavior. It generates a routine 3
 * times for each of three sample profiles and prints, per run, the task count
 * and the task names. Use it to sanity-check that the count stays at 5-7 and
 * that the routine scales lighter/heavier with the profile.
 *
 * Run it with:
 *   npx tsx scripts/test-routine.ts
 *
 * Reads ANTHROPIC_API_KEY from .env.local automatically.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import {
  SYSTEM_PROMPT,
  buildUserMessage,
  parseTasksFromText,
  filterSafeTasks,
} from "../app/api/generate-routine/core";

// --- Tiny .env.local loader (KEY=value lines) so no extra flags/deps needed.
function loadEnvLocal(): void {
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      // Strip surrounding quotes if present.
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // No .env.local — fall back to whatever is already in the environment.
  }
}

// --- Three sample onboarding profiles spanning the capacity spectrum.
const PROFILES: { label: string; answers: Record<string, string> }[] = [
  {
    label: "Busy beginner (little time)",
    answers: {
      main_goal: "Feel a bit healthier and less stressed",
      peak_time: "Early morning",
      free_time: "Less than 30 minutes",
      activity_level: "Sedentary — barely any exercise right now",
      obstacle: "No time and very low energy after work",
    },
  },
  {
    label: "Average person",
    answers: {
      main_goal: "Build steadier habits and more energy",
      peak_time: "Mid-morning",
      free_time: "About 1 hour",
      activity_level: "Lightly active — a walk or two a week",
      obstacle: "Inconsistent — I start strong then drop off",
    },
  },
  {
    label: "Experienced, high-capacity",
    answers: {
      main_goal: "Optimize fitness, focus, and recovery",
      peak_time: "Morning and early evening",
      free_time: "2-3 hours",
      activity_level: "Very active — train 5-6 days a week",
      obstacle: "Want better structure to get more from my day",
    },
  },
];

const RUNS_PER_PROFILE = 3;

async function generateOnce(
  anthropic: Anthropic,
  answers: Record<string, string>
) {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(answers) }],
  });

  const rawText = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  // Same parse + same safety filter the route applies before saving.
  const parsed = parseTasksFromText(rawText);
  const safe = filterSafeTasks(parsed);
  return { parsedCount: parsed.length, tasks: safe };
}

async function main() {
  loadEnvLocal();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      "ANTHROPIC_API_KEY not found. Set it in .env.local at the project root."
    );
    process.exit(1);
  }

  const anthropic = new Anthropic({ apiKey });

  for (const profile of PROFILES) {
    console.log("\n" + "=".repeat(70));
    console.log(`PROFILE: ${profile.label}`);
    console.log("=".repeat(70));

    for (let run = 1; run <= RUNS_PER_PROFILE; run++) {
      try {
        const { parsedCount, tasks } = await generateOnce(
          anthropic,
          profile.answers
        );
        const dropped = parsedCount - tasks.length;
        const countNote = dropped > 0 ? ` (model returned ${parsedCount}, ${dropped} filtered)` : "";
        console.log(`\n  Run ${run}  —  ${tasks.length} tasks${countNote}`);
        tasks.forEach((t, i) => {
          console.log(`    ${i + 1}. ${t.time}  [${t.section}]  ${t.name}`);
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.log(`\n  Run ${run}  —  ERROR: ${detail}`);
      }
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
