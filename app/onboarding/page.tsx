"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// The 5 onboarding questions. `key` is the jsonb key each answer is saved under.
const QUESTIONS = [
  {
    key: "main_goal",
    title: "What's your main goal right now?",
    options: [
      "Build study discipline",
      "Get physically fitter",
      "Sleep & energy",
      "Overall balance",
    ],
  },
  {
    key: "peak_time",
    title: "When are you at your best?",
    options: ["Early morning", "Late morning", "Afternoon", "Night"],
  },
  {
    key: "free_time",
    title: "How much free time do you have on a typical day?",
    options: ["Under 2 hours", "2–4 hours", "4–6 hours", "6+ hours"],
  },
  {
    key: "activity_level",
    title: "How active are you currently?",
    options: [
      "Mostly sedentary",
      "Lightly active",
      "Moderately active",
      "Very active",
    ],
  },
  {
    key: "obstacle",
    title: "What gets in your way most?",
    options: ["Procrastination", "Irregular sleep", "Low energy", "Distractions"],
  },
] as const;

const TOTAL = QUESTIONS.length;

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();

  // Which question we're on (0-indexed) and the answers picked so far.
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const [checking, setChecking] = useState(true); // gating the auth/already-onboarded check
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On mount: require a logged-in user, and skip onboarding if it's already done.
  useEffect(() => {
    async function init() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Nobody logged in → back to the start.
      if (!user) {
        router.replace("/");
        return;
      }

      // If they've already answered, don't make them redo it.
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_answers")
        .eq("id", user.id)
        .single();

      if (profile?.onboarding_answers) {
        router.replace("/today");
        return;
      }

      setChecking(false);
    }

    init();
    // supabase/router are stable; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const question = QUESTIONS[step];
  const selected = answers[question.key];
  const isLastStep = step === TOTAL - 1;
  const progress = Math.round(((step + 1) / TOTAL) * 100);

  // Record the choice for the current question (single-select).
  function select(option: string) {
    setAnswers((prev) => ({ ...prev, [question.key]: option }));
  }

  function goBack() {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  async function handleContinue() {
    if (!selected) return;

    // Not the last question yet — just advance.
    if (!isLastStep) {
      setStep((s) => s + 1);
      return;
    }

    // Final step: persist all answers to the user's profile.
    setSaving(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.replace("/");
      return;
    }

    // `answers` already holds every question's choice keyed by its jsonb key.
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ onboarding_answers: answers })
      .eq("id", user.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    router.replace("/today");
  }

  // Hold the layout still while we verify auth / onboarding status.
  if (checking) {
    return <main className="min-h-screen bg-[#FAFAFB]" />;
  }

  return (
    <main className="flex min-h-screen justify-center bg-[#FAFAFB] px-6 py-10">
      <div className="w-full max-w-[360px]">
        {/* Wordmark */}
        <h1 className="text-center text-[20px] font-medium text-[#534AB7]">
          Ascenda
        </h1>

        {/* Progress */}
        <div className="mt-8">
          <div className="mb-1.5 flex justify-between text-[11px] text-gray-400">
            <span>
              Step {step + 1} of {TOTAL}
            </span>
            <span>{progress}%</span>
          </div>
          <div className="h-1 w-full rounded-full bg-[#EEEDFE]">
            <div
              className="h-1 rounded-full bg-[#534AB7] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Question */}
        <h2 className="mt-8 text-[15px] font-medium text-gray-900">
          {question.title}
        </h2>

        {/* Options */}
        <div className="mt-4 flex flex-col gap-3">
          {question.options.map((option) => {
            const isSelected = selected === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => select(option)}
                className={`flex items-center justify-between rounded-xl px-4 py-3 text-left text-[13px] transition-colors ${
                  isSelected
                    ? "border-[1.5px] border-[#534AB7] bg-[#EEEDFE] text-[#534AB7]"
                    : "border-[0.5px] border-gray-200 bg-white text-gray-800"
                }`}
              >
                <span>{option}</span>
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

        {/* Error message */}
        {error && <p className="mt-4 text-[11px] text-red-500">{error}</p>}

        {/* Actions */}
        <div className="mt-8 flex flex-col gap-2">
          <button
            type="button"
            onClick={handleContinue}
            disabled={!selected || saving}
            className="rounded-xl bg-[#534AB7] px-4 py-3 text-[13px] font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : isLastStep ? "Finish" : "Continue"}
          </button>

          {/* Optional back navigation */}
          {step > 0 && (
            <button
              type="button"
              onClick={goBack}
              disabled={saving}
              className="text-[11px] text-gray-400 disabled:opacity-50"
            >
              Back
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
