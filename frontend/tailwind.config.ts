import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  // B5 — dark mode is class-based: toggling `.dark` on <html> swaps the
  // Almanac CSS-variable palette (see globals.css). The colors below resolve
  // to those variables, so light mode is byte-identical to before.
  darkMode: ["class"],
  theme: {
    extend: {
      fontFamily: {
        // Existing neutral defaults — extended with Plex families so legacy callers still resolve.
        sans: [
          '"IBM Plex Sans"',
          '"IBM Plex Sans SC"',
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Noto Sans SC",
          "PingFang SC",
          "sans-serif",
        ],
        mono: [
          '"IBM Plex Mono"',
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
        // Almanac — Simplified Chinese-first stack.
        sc: [
          '"IBM Plex Sans SC"',
          '"IBM Plex Sans"',
          "system-ui",
          "sans-serif",
        ],
        // Almanac — AI voice (italic serif).
        serif: [
          '"IBM Plex Serif"',
          '"Noto Serif SC"',
          "Georgia",
          "serif",
        ],
      },
      colors: {
        // Almanac palette — resolved from CSS variables (globals.css) so the
        // `.dark` class can repaint the whole UI by overriding the variables.
        // Light-mode values are unchanged (the variables hold the same oklch).
        paper: {
          DEFAULT: "var(--paper)",
          2: "var(--paper-2)",
          3: "var(--paper-3)",
          4: "var(--paper-4)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          2: "var(--ink-2)",
          3: "var(--ink-3)",
          4: "var(--ink-4)",
        },
        rule: {
          DEFAULT: "var(--rule)",
          2: "var(--rule-2)",
          ink: "var(--rule-ink)",
        },
        clay: {
          DEFAULT: "var(--clay)",
          deep: "var(--clay-deep)",
          soft: "var(--clay-soft)",
          ink: "var(--clay-ink)",
        },
        sage: {
          DEFAULT: "var(--sage)",
          soft: "var(--sage-soft)",
          ink: "var(--sage-ink)",
        },
        ochre: {
          DEFAULT: "var(--ochre)",
          soft: "var(--ochre-soft)",
          ink: "var(--ochre-ink)",
        },
        rust: {
          DEFAULT: "var(--rust)",
          soft: "var(--rust-soft)",
          ink: "var(--rust-ink)",
        },
        ai: {
          DEFAULT: "var(--ai)",
          soft: "var(--ai-soft)",
          rule: "var(--ai-rule)",
        },
      },
      borderRadius: {
        none: "0",
        sm: "2px",
        DEFAULT: "4px",
        md: "6px",
      },
      transitionTimingFunction: {
        swift: "cubic-bezier(0.2, 0, 0, 1)",
        standard: "cubic-bezier(0.2, 0, 0, 1)",
        expressive: "cubic-bezier(0.25, 1, 0.5, 1)",
      },
      transitionDuration: {
        swift: "120ms",
        standard: "220ms",
        expressive: "320ms",
      },
    },
  },
  plugins: [],
};

export default config;
