"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Bi } from "@/components/almanac/Bi";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Preferences = { speed?: number; quality?: number; cost?: number };
type Stage = "discovery" | "validation" | "launch" | "scale";

const STAGES: { value: Stage; cn: string; en: string }[] = [
  { value: "discovery", cn: "探索", en: "Discovery" },
  { value: "validation", cn: "验证", en: "Validation" },
  { value: "launch", cn: "上线", en: "Launch" },
  { value: "scale", cn: "扩张", en: "Scale" },
];

type StyleKey = "balanced" | "move_fast" | "be_careful" | "stay_lean";

const STYLES: {
  key: StyleKey;
  cn: string;
  en: string;
  weights: Required<Preferences>;
}[] = [
  { key: "balanced",   cn: "均衡",    en: "Balanced",   weights: { speed: 0.33, quality: 0.34, cost: 0.33 } },
  { key: "move_fast",  cn: "快速推进", en: "Move fast",  weights: { speed: 0.60, quality: 0.20, cost: 0.20 } },
  { key: "be_careful", cn: "稳妥优先", en: "Be careful", weights: { speed: 0.20, quality: 0.60, cost: 0.20 } },
  { key: "stay_lean",  cn: "控成本",   en: "Stay lean",  weights: { speed: 0.20, quality: 0.20, cost: 0.60 } },
];

// Snap an arbitrary (legacy slider) weight triple onto the closest preset.
// "Balanced" wins when no single axis dominates by ≥ 0.10.
function detectStyle(p: Preferences): StyleKey {
  const s = p.speed ?? 0.33;
  const q = p.quality ?? 0.34;
  const c = p.cost ?? 0.33;
  const max = Math.max(s, q, c);
  const min = Math.min(s, q, c);
  if (max - min < 0.1) return "balanced";
  if (s === max) return "move_fast";
  if (q === max) return "be_careful";
  return "stay_lean";
}

export function PreferencesEditor({
  projectId,
  initialStage,
  initialPreferences,
}: {
  projectId: string;
  initialStage: string;
  initialPreferences: Preferences;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>(initialStage as Stage);
  const [styleKey, setStyleKey] = useState<StyleKey>(detectStyle(initialPreferences));
  const [saving, setSaving] = useState(false);

  // Supabase v2.50 generics reject `Record<string, unknown>` (unknown → never).
  // Narrow to the actual columns we mutate from this editor.
  type ProjectPatch = {
    current_stage?: string;
    preferences?: Preferences;
  };

  async function persist(patch: ProjectPatch) {
    setSaving(true);
    const supabase = supabaseBrowser();
    await supabase.from("projects").update(patch).eq("id", projectId);
    router.refresh();
    setSaving(false);
  }

  function onPickStyle(s: StyleKey) {
    if (s === styleKey || saving) return;
    setStyleKey(s);
    const next = STYLES.find((x) => x.key === s)!.weights;
    void persist({ preferences: next });
  }

  return (
    <div className="border border-rule bg-paper p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-3">
            <Bi cn="阶段" en="Stage" glossSize={0.78} />:
          </span>
          <select
            value={stage}
            onChange={(e) => {
              const next = e.target.value as Stage;
              setStage(next);
              void persist({ current_stage: next });
            }}
            disabled={saving}
            className="border border-rule bg-paper px-2 py-1 text-sm text-ink outline-none transition focus:border-ink"
          >
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.cn} / {s.en}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-3">
            <Bi cn="风格" en="Style" glossSize={0.78} />:
          </span>
          <div className="inline-flex flex-wrap border border-rule bg-paper p-0.5">
            {STYLES.map((s) => {
              const active = s.key === styleKey;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => onPickStyle(s.key)}
                  disabled={saving}
                  title={`speed ${pct(s.weights.speed)} · quality ${pct(
                    s.weights.quality,
                  )} · cost ${pct(s.weights.cost)}`}
                  className={`px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed ${
                    active
                      ? "bg-ink text-paper"
                      : "text-ink-2 hover:bg-paper-3 disabled:opacity-50"
                  }`}
                >
                  <Bi cn={s.cn} en={s.en} glossSize={0.74} />
                </button>
              );
            })}
          </div>
          {saving && <span className="text-xs text-ink-4">Saving…</span>}
        </div>
      </div>
    </div>
  );
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
