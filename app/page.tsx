"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getPostAuthRoute } from "@/lib/auth";

// The three steps shown under "How it works".
const STEPS = [
  "Answer a few questions, get an AI-built routine.",
  "Check off your day and build your streak.",
  "Post your wins and form leagues with friends to stay accountable.",
];

export default function LandingPage() {
  const router = useRouter();
  // Reuse the shared browser client (cookie-based session, managed by middleware).
  const supabase = createClient();

  const [checking, setChecking] = useState(true); // gating the "already logged in" check

  // On mount: if already signed in, skip the landing and route them onward.
  useEffect(() => {
    async function init() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        router.replace(await getPostAuthRoute(supabase, user));
        return;
      }

      setChecking(false);
    }

    init();
    // supabase/router are stable; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hold the layout still while we check for an existing session.
  if (checking) {
    return <main className="min-h-screen bg-white" />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-12">
      <div className="w-full max-w-sm">
        {/* Hero */}
        <div className="text-center">
          <p className="text-[18px] font-semibold text-[#534AB7]">Ascenda</p>
          <p className="mt-0.5 text-[12px] text-gray-400">Rise every day.</p>
          <h1 className="mt-6 text-[28px] font-semibold leading-tight text-gray-900">
            The feed that gets you off the feed.
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-gray-500">
            Ascenda builds you a daily routine, then gives you a feed where you
            and your friends post the real things you actually did — so instead
            of draining you like Instagram, it makes you want to go do yours.
          </p>
        </div>

        {/* How it works */}
        <div className="mt-10">
          <h2 className="text-[12px] font-medium uppercase tracking-wide text-gray-400">
            How it works
          </h2>
          <ol className="mt-4 flex flex-col gap-4">
            {STEPS.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EEEDFE] text-[12px] font-medium text-[#534AB7]">
                  {i + 1}
                </span>
                <span className="text-[13px] leading-relaxed text-gray-700">
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {/* Differentiator */}
        <p className="mt-8 rounded-md bg-[#E1F5EE] px-4 py-3 text-center text-[13px] font-medium leading-relaxed text-[#1D9E75]">
          Not just a habit tracker — a place where friends keep each other
          rising.
        </p>

        {/* CTAs */}
        <div className="mt-8 flex flex-col gap-3">
          <Link
            href="/signup"
            className="rounded-md bg-[#534AB7] px-3 py-2.5 text-center text-[13px] font-medium text-white transition hover:opacity-90 active:scale-[0.98]"
          >
            Get started
          </Link>
          <Link
            href="/login"
            className="text-center text-[13px] font-medium text-[#534AB7]"
          >
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
