"use client";

import { useEffect, useId, useRef, useState } from "react";

export type RosterOption = { value: string; label: string };

type Accent = "emerald" | "cyan" | "zinc";

const accentOpen: Record<Accent, string> = {
  emerald: "border-emerald-500/55 ring-1 ring-emerald-500/25",
  cyan: "border-cyan-500/50 ring-1 ring-cyan-500/20",
  zinc: "border-zinc-600 ring-1 ring-zinc-600/30",
};

const accentOptionActive: Record<Accent, string> = {
  emerald: "bg-emerald-500/15 text-emerald-100",
  cyan: "bg-cyan-500/12 text-cyan-50",
  zinc: "bg-zinc-700/50 text-white",
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Label for the “no selection” row in the menu (defaults to `placeholder`). */
  clearLabel?: string;
  options: RosterOption[];
  accent?: Accent;
  /** Tighter control for dense / one-screen layouts */
  compact?: boolean;
  "aria-label"?: string;
  disabled?: boolean;
};

export function RosterDropdown({
  value,
  onChange,
  placeholder,
  clearLabel,
  options,
  accent = "zinc",
  compact = false,
  "aria-label": ariaLabel,
  disabled = false,
}: Props) {
  const emptyRowLabel = clearLabel ?? placeholder;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selectedLabel =
    value.trim() === "" ? null : options.find((o) => o.value === value)?.label ?? value;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border bg-[#11161a] text-left outline-none transition ${
          compact ? "px-2 py-1.5 text-xs" : "px-3 py-2.5 text-sm"
        } ${disabled ? "cursor-not-allowed opacity-50" : "hover:border-zinc-600"} ${
          open ? accentOpen[accent] : "border-zinc-800"
        } ${selectedLabel ? "text-white" : "text-zinc-500"}`}
      >
        <span className="min-w-0 flex-1 truncate">{selectedLabel ?? placeholder}</span>
        <span
          className={`shrink-0 text-xs text-zinc-500 transition ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {open && !disabled ? (
        <ul
          id={listId}
          role="listbox"
          className={`absolute left-0 right-0 top-[calc(100%+4px)] z-[100] overflow-y-auto rounded-xl border border-zinc-700/90 bg-[#121820] shadow-[0_12px_40px_rgba(0,0,0,0.55)] ${
            compact
              ? "max-h-[min(9rem,32vh)] py-0.5 text-xs"
              : "max-h-[min(14rem,45vh)] py-1 text-sm"
          }`}
        >
          <li role="none">
            <button
              type="button"
              role="option"
              aria-selected={value === ""}
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className={`flex w-full text-left ${compact ? "px-2 py-1.5 text-xs" : "px-3 py-2.5 text-sm"} ${
                value === "" ? accentOptionActive[accent] : "text-zinc-500 hover:bg-zinc-800/70 hover:text-zinc-200"
              }`}
            >
              {emptyRowLabel}
            </button>
          </li>
          {options.map((opt) => {
            const selected = opt.value === value;
            return (
              <li key={opt.value} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`flex w-full text-left ${compact ? "px-2 py-1.5 text-xs" : "px-3 py-2.5 text-sm"} ${
                    selected
                      ? `${accentOptionActive[accent]} font-medium`
                      : "text-zinc-200 hover:bg-zinc-800/80"
                  }`}
                >
                  {opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
