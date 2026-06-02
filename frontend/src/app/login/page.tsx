"use client";

import { Suspense, useState } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";

import { extractError } from "@/lib/extract-error";
import { supabaseBrowser } from "@/lib/supabase-browser";

// Next.js 14 requires hooks that read URL state to live inside a Suspense
// boundary so the outer shell can prerender.
export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Suspense fallback={<LoginCardSkeleton />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}

function LoginCardSkeleton() {
  return (
    <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
      <p className="text-sm text-neutral-500">Loading…</p>
    </div>
  );
}

type Mode = "signin" | "signup";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = supabaseBrowser();
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        // If "Confirm email" is OFF in Supabase, signUp returns an active
        // session; the router push lands us on the app. If it's ON, the
        // session is null and the user has to click the confirmation
        // email — but we've explicitly turned that off.
      }
      // `next` is a query-string parameter so it isn't statically typeable.
      router.replace(next as Route);
      router.refresh();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const otherMode = mode === "signin" ? "signup" : "signin";
  const otherLabel = mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in";

  return (
    <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">
        {mode === "signin" ? "Sign in" : "Create account"}
      </h1>
      <p className="mb-6 text-sm text-neutral-500">
        AI Manager Platform · {mode === "signin" ? "登录" : "注册"}
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-neutral-700">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-neutral-700">Password</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="≥ 8 characters"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {submitting
            ? mode === "signin"
              ? "Signing in…"
              : "Creating account…"
            : mode === "signin"
              ? "Sign in"
              : "Create account"}
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      <button
        onClick={() => {
          setMode(otherMode);
          setError(null);
        }}
        className="mt-4 w-full text-center text-xs text-neutral-500 hover:text-neutral-900"
      >
        {otherLabel}
      </button>
    </div>
  );
}
