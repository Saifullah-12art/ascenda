"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignInPage() {
  const router = useRouter();
  // Reuse the shared browser client (cookie-based session, managed by middleware).
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Authenticate against Supabase Auth with email + password.
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    // Surface auth errors (e.g. "Invalid login credentials") to the user.
    if (error) {
      setError(error.message);
      return;
    }

    // Signed in — send them to their daily routine.
    router.push("/today");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#EEEDFE] px-6">
      <div className="w-full max-w-xs">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-[20px] font-medium text-[#534AB7]">Ascenda</h1>
          <p className="mt-1 text-[11px] text-gray-400">Rise every day.</p>
        </div>

        <form onSubmit={handleSignIn} className="flex flex-col gap-3">
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
            className="mt-1 rounded-md bg-[#534AB7] px-3 py-2 text-[13px] font-medium text-white disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>

          {/* Secondary action */}
          <Link
            href="/"
            className="rounded-md border border-[#534AB7] px-3 py-2 text-center text-[13px] font-medium text-[#534AB7]"
          >
            Create account instead
          </Link>
        </form>
      </div>
    </main>
  );
}
