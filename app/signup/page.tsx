"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    setError(null);

    const supabase = createClient();
    if (!supabase) {
      setError("Sign-up is unavailable right now. Please try again later.");
      setLoading(false);
      return;
    }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setConfirmed(true);
    setLoading(false);
  }

  if (confirmed) {
    return (
      <main className="min-h-screen flex items-center justify-center px-5">
        <div className="w-full max-w-sm text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center mb-6">
            <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-tight mb-2">Check your email</h1>
          <p className="text-white/50 text-sm leading-relaxed">
            We sent a confirmation link to <span className="text-white/80">{email}</span>.
            Click it to activate your account, then{" "}
            <button
              onClick={() => router.push("/login")}
              className="text-[#D4A24C] hover:text-[#E8C375] transition-colors"
            >
              sign in
            </button>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-5">
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
          Create account
        </h1>
        <p className="text-white/40 text-sm mb-8">
          Already have one?{" "}
          <Link href="/login" className="text-[#D4A24C] hover:text-[#E8C375] transition-colors">
            Sign in
          </Link>
        </p>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400 mb-5">
            {error}
          </div>
        )}

        <form onSubmit={handleSignup} className="flex flex-col gap-4">
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
              autoComplete="new-password"
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/25 focus:outline-none focus:border-[#D4A24C]/50 focus:bg-white/[0.07] transition-all"
              placeholder="At least 6 characters"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="cursor-pointer mt-2 w-full py-3.5 rounded-xl bg-gradient-to-r from-[#D4A24C] to-[#B8862F] hover:from-[#E0B05E] hover:to-[#C49237] disabled:from-white/10 disabled:to-white/10 disabled:text-white/30 text-[#0A0908] font-display font-bold uppercase tracking-widest transition-all duration-200 shadow-lg shadow-amber-900/30 disabled:shadow-none text-sm"
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>
      </div>
    </main>
  );
}
