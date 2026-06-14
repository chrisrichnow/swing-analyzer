"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";
  const urlError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    if (!supabase) {
      setError("Sign-in is unavailable right now. Please try again later.");
      setLoading(false);
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm">
      {/* Logo */}
      <div className="flex items-center gap-2.5 mb-10">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#D4A24C] to-[#A87A2E] flex items-center justify-center shadow-lg shadow-amber-900/30">
          <svg className="w-4 h-4 text-[#0A0908]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 3a1 1 0 011-1h.5a1 1 0 011 1v18a1 1 0 01-1 1H7a1 1 0 01-1-1V3z" />
            <path d="M9 4l9 2.5a.5.5 0 010 .96L9 10V4z" />
          </svg>
        </div>
        <span className="font-display text-sm font-semibold text-white/60 tracking-[0.18em] uppercase">
          Golf Swing Analyzer
        </span>
      </div>

      <h1 className="font-display text-4xl font-bold uppercase leading-tight tracking-tight mb-1">
        Sign in
      </h1>
      <p className="text-white/40 text-sm mb-8">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-[#D4A24C] hover:text-[#E8C375] transition-colors">
          Create one
        </Link>
      </p>

      {(error || urlError) && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400 mb-5">
          {error ?? "Authentication failed. Please try again."}
        </div>
      )}

      <form onSubmit={handleLogin} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-white/40 uppercase tracking-widest">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/25 focus:outline-none focus:border-[#D4A24C]/50 focus:bg-white/[0.07] transition-all"
            placeholder="you@example.com"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-white/40 uppercase tracking-widest">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/25 focus:outline-none focus:border-[#D4A24C]/50 focus:bg-white/[0.07] transition-all"
            placeholder="••••••••"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="cursor-pointer mt-2 w-full py-3.5 rounded-xl bg-gradient-to-r from-[#D4A24C] to-[#B8862F] hover:from-[#E0B05E] hover:to-[#C49237] disabled:from-white/10 disabled:to-white/10 disabled:text-white/30 text-[#0A0908] font-display font-bold uppercase tracking-widest transition-all duration-200 shadow-lg shadow-amber-900/30 disabled:shadow-none text-sm"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-5">
      <Suspense fallback={<div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-[#D4A24C] animate-spin" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
