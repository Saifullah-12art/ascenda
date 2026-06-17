"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getPostAuthRoute } from "@/lib/auth";

export default function SignUpPage() {
  const router = useRouter();
  // Reuse the shared browser client (cookie-based session, managed by middleware).
  const supabase = createClient();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true); // gating the "already logged in" check

  // On mount: if already signed in, skip the form and route them onward.
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

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Create the account. The full name is stored in user metadata via
    // `options.data`, so it travels with the user record in Supabase Auth.
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });

    setLoading(false);

    // Surface auth errors (e.g. "User already registered") to the user.
    if (error) {
      setError(error.message);
      return;
    }

    // Account created — send new users through onboarding first.
    router.push("/onboarding");
  }

  // Hold the layout still while we check for an existing session.
  if (checking) {
    return <main className="min-h-screen bg-[#EEEDFE]" />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#EEEDFE] px-6">
      <div className="w-full max-w-xs">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-[20px] font-medium text-[#534AB7]">Ascenda</h1>
          <p className="mt-1 text-[11px] text-gray-400">Rise every day.</p>
        </div>

        <form onSubmit={handleSignUp} className="flex flex-col gap-3">
          {/* Full name */}
          <div className="flex flex-col gap-1">
            <label htmlFor="fullName" className="text-[11px] text-gray-500">
              Full name
            </label>
            <input
              id="fullName"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none focus:border-[#534AB7]"
            />
          </div>

          {/* Email */}
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-[11px] text-gray-500">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none focus:border-[#534AB7]"
            />
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-[11px] text-gray-500">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none focus:border-[#534AB7]"
            />
          </div>

          {/* Error message */}
          {error && <p className="text-[11px] text-red-500">{error}</p>}

          {/* Primary action */}
          <button
            type="submit"
            disabled={loading}
            className="mt-1 rounded-md bg-[#534AB7] px-3 py-2 text-[13px] font-medium text-white transition enabled:hover:opacity-90 enabled:active:scale-[0.98] disabled:opacity-60"
          >
            {loading ? "Creating account…" : "Create account"}
          </button>

          {/* Secondary action */}
          <Link
            href="/login"
            className="rounded-md border border-[#534AB7] px-3 py-2 text-center text-[13px] font-medium text-[#534AB7]"
          >
            Sign in instead
          </Link>
        </form>

        {/* Terms */}
        <p className="mt-6 text-center text-[10px] text-gray-400">
          By creating an account you agree to our Terms of Service and Privacy
          Policy.
        </p>
      </div>
    </main>
  );
}
