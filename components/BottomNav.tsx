"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/home", label: "Play", icon: "▶" },
  { href: "/friends", label: "Friends", icon: "👥" },
  { href: "/history", label: "History", icon: "↻" },
  { href: "/stats", label: "Stats", icon: "▥" },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md border-t border-zinc-800/90 bg-[#090d12]/95 px-3 pt-2 backdrop-blur pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="grid grid-cols-4 gap-2">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-2xl px-2 py-2 text-center transition ${
                active ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40" : "text-zinc-400"
              }`}
            >
              <span className="block text-lg leading-none">{item.icon}</span>
              <span className="mt-1 block text-[11px] font-semibold uppercase tracking-[0.15em]">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
