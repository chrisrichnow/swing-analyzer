"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export default function NavBar() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;

    supabase.auth.getUser().then(({ data }) => setUser(data.user));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    if (!supabase) return;
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <nav className="flex items-center justify-end gap-4 px-5 lg:px-10 py-4 max-w-xl lg:max-w-3xl mx-auto w-full">
      {user ? (
        <div className="flex items-center gap-3">
          <Link
            href="/history"
            className="text-xs text-white/40 hover:text-white/70 transition-colors uppercase tracking-widest font-medium"
          >
            My History
          </Link>
          <span className="text-white/15">|</span>
          <span className="text-xs text-white/30 hidden sm:block">{user.email}</span>
          <button
            onClick={handleLogout}
            className="cursor-pointer text-xs text-white/40 hover:text-white/70 transition-colors uppercase tracking-widest font-medium"
          >
            Sign out
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="text-xs text-white/40 hover:text-white/70 transition-colors uppercase tracking-widest font-medium"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="text-xs text-[#D4A24C] hover:text-[#E8C375] transition-colors uppercase tracking-widest font-medium"
          >
            Create account
          </Link>
        </div>
      )}
    </nav>
  );
}
