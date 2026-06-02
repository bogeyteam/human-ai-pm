"use client";

/**
 * ThemeToggle (B5) — flips the `.dark` class on <html> and persists the
 * choice to localStorage. A no-flash init script in the root layout applies
 * the saved theme before first paint; this just lets the user switch.
 */

import { useEffect, useState } from "react";

import { Bi } from "./Bi";
import { Glyph } from "./Glyph";

export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.theme = next ? "dark" : "light";
    } catch {
      /* ignore storage errors (private mode, etc.) */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className={`flex items-center gap-2 text-[12px] text-ink-3 transition-colors hover:text-ink ${className ?? ""}`.trim()}
    >
      <Glyph name={dark ? "circle" : "half"} size={12} />
      <Bi cn={dark ? "浅色" : "深色"} en={dark ? "Light" : "Dark"} glossSize={0.78} />
    </button>
  );
}
