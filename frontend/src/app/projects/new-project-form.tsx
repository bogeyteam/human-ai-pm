"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Bi } from "@/components/almanac/Bi";
import { Micro } from "@/components/almanac/Micro";
import { extractError } from "@/lib/extract-error";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Stage = "discovery" | "validation" | "launch" | "scale";

const STAGES: { value: Stage; cn: string; en: string }[] = [
  { value: "discovery", cn: "探索", en: "Discovery" },
  { value: "validation", cn: "验证", en: "Validation" },
  { value: "launch", cn: "上线", en: "Launch" },
  { value: "scale", cn: "放大", en: "Scale" },
];

export function NewProjectForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [vision, setVision] = useState("");
  const [stage, setStage] = useState<Stage>("validation");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name,
          vision: vision || null,
          current_stage: stage,
        })
        .select("id")
        .single();
      if (error) throw error;
      router.push(`/projects/${data!.id}`);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 border border-rule bg-paper p-5"
    >
      <label className="block">
        <Micro style={{ marginBottom: 6 }}>
          <Bi cn="项目名" en="Name" glossSize={0.78} />
        </Micro>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. fanpo US launch · 美国上线"
          className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
        />
      </label>

      <label className="block">
        <Micro style={{ marginBottom: 6 }}>
          <Bi cn="愿景" en="Vision (optional)" glossSize={0.78} />
        </Micro>
        <textarea
          value={vision}
          onChange={(e) => setVision(e.target.value)}
          placeholder="The long-term goal that anchors task generation · 锚定 AI 任务生成的长期目标"
          rows={3}
          className="w-full border border-rule bg-paper px-3 py-2 text-sm leading-relaxed text-ink outline-none transition focus:border-ink"
        />
      </label>

      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <Micro style={{ marginBottom: 6 }}>
            <Bi cn="阶段" en="Stage" glossSize={0.78} />
          </Micro>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as Stage)}
            className="border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
          >
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.cn} / {s.en}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          disabled={submitting || !name}
          className="bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-clay-deep disabled:opacity-40"
        >
          {submitting ? (
            <Bi cn="创建中…" en="Creating…" glossSize={0.78} />
          ) : (
            <Bi cn="创建项目" en="Create" glossSize={0.78} />
          )}
        </button>
      </div>

      {error && (
        <p className="border border-rust-soft bg-rust-soft/40 px-3 py-2 text-sm text-rust-ink">
          {error}
        </p>
      )}
    </form>
  );
}
