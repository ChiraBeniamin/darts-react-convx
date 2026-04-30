"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { FormEvent, useEffect, useState } from "react";

type Flow = "signIn" | "signUp";

const inputClassName =
  "w-full rounded-xl border border-zinc-800 bg-[#11161a] px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-zinc-500 focus:border-emerald-500/70";

type Props = {
  flow: Flow;
};

export function AuthForm({ flow }: Props) {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn } = useAuthActions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/home");
    }
  }, [isAuthenticated, isLoading, router]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn("password", {
        email,
        password,
        flow,
      });
      setPassword("");
      router.replace("/home");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const isSignUp = flow === "signUp";

  if (!isLoading && isAuthenticated) {
    return (
      <p className="text-sm text-zinc-400" aria-live="polite">
        Redirecting…
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-sm rounded-3xl border border-zinc-800/90 bg-[#0d1318]/95 p-7 text-center"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-400">
        {isSignUp ? "Create account" : "Welcome back"}
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-white">
        {isSignUp ? "Join Darts Counter" : "Sign in to play"}
      </h1>
      <p className="mt-2 text-sm text-zinc-400">
        {isSignUp
          ? "Save games, friends, and match history in one place."
          : "Continue your matches, friends, and history."}
      </p>

      <div className="mt-6 space-y-3 text-left">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClassName}
          placeholder="Email"
          autoComplete="email"
          required
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClassName}
          placeholder="Password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          required
        />
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-800/60 bg-red-950/40 px-3 py-2 text-left text-xs text-red-200">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-6 w-full rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-[#06120a] transition hover:bg-emerald-400 disabled:opacity-60"
      >
        {busy ? "Working…" : isSignUp ? "Create account" : "Sign in"}
      </button>

      <p className="mt-6 text-sm text-zinc-500">
        {isSignUp ? (
          <>
            Already have an account?{" "}
            <Link href="/auth/sign-in" className="font-semibold text-emerald-400 hover:text-emerald-300">
              Sign in
            </Link>
          </>
        ) : (
          <>
            Don&apos;t have an account?{" "}
            <Link href="/auth/sign-up" className="font-semibold text-emerald-400 hover:text-emerald-300">
              Sign up
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
