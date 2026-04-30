"use client";

import { useRouter } from "next/navigation";
import { useConvexAuth } from "convex/react";
import { useEffect } from "react";

export default function RootPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();

  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) {
      router.replace("/home");
    } else {
      router.replace("/auth/sign-in");
    }
  }, [isAuthenticated, isLoading, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#06090f] text-zinc-400">
      <p className="text-sm">Loading…</p>
    </main>
  );
}
