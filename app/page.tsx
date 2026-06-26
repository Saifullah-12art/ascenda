"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getPostAuthRoute } from "@/lib/auth";

// Alternating feature sections, each paired with an app screenshot.
const FEATURES = [
  {
    heading: "A routine built for you, in seconds",
    description:
      "Answer a few questions and an AI builds a realistic daily routine — grounded, and yours to edit.",
    image: "/landing/today.png",
    alt: "Ascenda's Today screen showing a daily routine",
  },
  {
    heading: "Post what's real, not what's polished",
    description:
      "You can only post a real thing you did from your routine — genuine progress, no vanity.",
    image: "/landing/feed.png",
    alt: "Ascenda's feed of real things friends actually did",
  },
  {
    heading: "Rise together in leagues",
    description:
      "Make a private league with friends; everyone runs their routine and posts for each other.",
    image: "/landing/league.png",
    alt: "An Ascenda league of friends staying accountable",
  },
] as const;

/**
 * A screenshot inside a clean phone frame. If the image file is missing it
 * falls back to a branded light-purple placeholder so the page never shows a
 * broken-image icon.
 */
function PhoneFrame({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="mx-auto w-full max-w-[260px]">
      <div className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white">
        <div className="aspect-[9/19]">
          {failed ? (
            <div className="flex h-full w-full items-center justify-center bg-[#EEEDFE]">
              <span className="text-[13px] font-medium text-[#534AB7]">
                Ascenda
              </span>
            </div>
          ) : (
            // Plain <img> so a missing file degrades gracefully via onError.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={alt}
              className="h-full w-full object-cover"
              onError={() => setFailed(true)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One feature row: heading + one-line description on one side, a phone-framed
 * screenshot on the other. `reverse` flips the screenshot to the left on
 * desktop; on mobile it's always text-then-screenshot.
 */
function FeatureSection({
  heading,
  description,
  image,
  alt,
  reverse,
  tinted,
}: {
  heading: string;
  description: string;
  image: string;
  alt: string;
  reverse: boolean;
  tinted: boolean;
}) {
  return (
    <section className={tinted ? "bg-[#FAFAFE]" : "bg-white"}>
      <div className="mx-auto grid max-w-5xl items-center gap-10 px-6 py-20 lg:grid-cols-2 lg:gap-16 lg:py-28">
        <div className={reverse ? "lg:order-2" : "lg:order-1"}>
          <h2 className="text-[28px] font-semibold leading-tight text-gray-900 sm:text-[32px]">
            {heading}
          </h2>
          <p className="mt-4 max-w-md text-[16px] leading-relaxed text-gray-500">
            {description}
          </p>
        </div>
        <div className={reverse ? "lg:order-1" : "lg:order-2"}>
          <PhoneFrame src={image} alt={alt} />
        </div>
      </div>
    </section>
  );
}

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
    <main className="min-h-screen bg-white">
      {/* Nav */}
      <header className="sticky top-0 z-10 border-b border-gray-100 bg-white/90 backdrop-blur">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-[18px] font-semibold text-[#534AB7]">
            Ascenda
          </span>
          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-[14px] font-medium text-gray-600 transition hover:text-gray-900"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-md bg-[#534AB7] px-4 py-2 text-[14px] font-medium text-white transition hover:opacity-90 active:scale-[0.98]"
            >
              Get started
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="bg-white">
        <div className="mx-auto grid max-w-5xl items-center gap-10 px-6 py-20 lg:grid-cols-2 lg:gap-16 lg:py-28">
          <div>
            <h1 className="text-[40px] font-semibold leading-[1.1] tracking-tight text-gray-900 sm:text-[52px]">
              The feed that gets you off the feed.
            </h1>
            <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-gray-500">
              An AI-built daily routine, and a feed where you and your friends
              post the real things you actually did — so it pushes you to act
              instead of draining you like Instagram.
            </p>
            <div className="mt-8 flex items-center gap-5">
              <Link
                href="/signup"
                className="rounded-md bg-[#534AB7] px-6 py-3 text-[15px] font-medium text-white transition hover:opacity-90 active:scale-[0.98]"
              >
                Get started
              </Link>
              <Link
                href="/login"
                className="text-[15px] font-medium text-[#534AB7] transition hover:opacity-80"
              >
                Sign in
              </Link>
            </div>
          </div>
          <div>
            <PhoneFrame
              src="/landing/today.png"
              alt="Ascenda app showing today's routine"
            />
          </div>
        </div>
      </section>

      {/* Alternating feature sections */}
      {FEATURES.map((feature, i) => (
        <FeatureSection
          key={feature.heading}
          heading={feature.heading}
          description={feature.description}
          image={feature.image}
          alt={feature.alt}
          reverse={i % 2 === 1}
          tinted={i % 2 === 0}
        />
      ))}

      {/* Closing CTA */}
      <section className="bg-[#534AB7]">
        <div className="mx-auto max-w-5xl px-6 py-24 text-center">
          <h2 className="text-[32px] font-semibold leading-tight text-white sm:text-[40px]">
            Start rising today
          </h2>
          <p className="mx-auto mt-4 max-w-md text-[16px] leading-relaxed text-white/80">
            Build your routine, post what's real, and rise with your friends.
          </p>
          <Link
            href="/signup"
            className="mt-8 inline-block rounded-md bg-white px-7 py-3 text-[15px] font-medium text-[#534AB7] transition hover:opacity-90 active:scale-[0.98]"
          >
            Get started
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-8">
          <span className="text-[15px] font-semibold text-[#534AB7]">
            Ascenda
          </span>
          <span className="text-[13px] text-gray-400">Rise every day.</span>
        </div>
      </footer>
    </main>
  );
}
