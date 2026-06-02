"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AIText } from "@/components/almanac/AIText";
import { Bi } from "@/components/almanac/Bi";
import { Chip } from "@/components/almanac/Chip";
import { Glyph } from "@/components/almanac/Glyph";
import { Micro } from "@/components/almanac/Micro";
import { discoverFindings, respondToFinding } from "@/lib/api";
import { extractError } from "@/lib/extract-error";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Finding = {
  id: string;
  how_to_use: string;
  status: string;
  dismiss_reason: string | null;
  feedback_note: string | null;
  created_at: string;
  resolved_at: string | null;
  target_owner_id: string | null;
  source_artifact_id: string | null;
  source_task_id: string | null;
  target_task_id: string;
  target_task: { id: string; title: string } | null;
  source_artifact: { id: string; title: string } | null;
};

const DISMISS_CHIPS: { key: string; cn: string; en: string }[] = [
  { key: "not_relevant", cn: "不相关", en: "Not relevant" },
  { key: "already_knew", cn: "已经知道", en: "Already knew" },
  { key: "wrong_timing", cn: "时机不对", en: "Wrong timing" },
  { key: "wrong_granularity", cn: "颗粒度不对", en: "Wrong granularity" },
];

type Filter = "mine" | "all" | "open" | "resolved";

const FILTER_LABELS: Record<Filter, { cn: string; en: string }> = {
  open: { cn: "进行中", en: "Open" },
  mine: { cn: "我的", en: "Mine" },
  resolved: { cn: "已处理", en: "Resolved" },
  all: { cn: "全部", en: "All" },
};

const STATUS_LABELS: Record<string, { cn: string; en: string }> = {
  new: { cn: "新", en: "New" },
  acknowledged: { cn: "已确认", en: "Acknowledged" },
  linked: { cn: "已关联", en: "Linked" },
  dismissed: { cn: "已忽略", en: "Dismissed" },
};

export function FindingsPanel({
  projectId,
  currentUserId,
  initialFindings,
}: {
  projectId: string;
  currentUserId: string | null;
  initialFindings: Finding[];
}) {
  const router = useRouter();
  const [findings, setFindings] = useState<Finding[]>(initialFindings);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [openId, setOpenId] = useState<string | null>(null);

  async function onDiscover() {
    setRunning(true);
    setRunMessage(null);
    setError(null);
    try {
      const result = await discoverFindings(projectId);
      setRunMessage(
        result.written === 0
          ? `Scanned ${result.candidate_count} candidate pairs — nothing surfaced. Try again after attaching more artifacts to completed tasks.`
          : `Found ${result.written} new finding${result.written === 1 ? "" : "s"} from ${result.candidate_count} candidate pairs.`,
      );
      // Re-fetch the findings list from Supabase so the new ones show
      // without a manual refresh. router.refresh() alone doesn't help
      // because this client component's state is initialized from the
      // prop only on mount.
      const supabase = supabaseBrowser();
      const { data: refreshed } = await supabase
        .from("findings")
        .select(
          `id, how_to_use, status, dismiss_reason, feedback_note, created_at, resolved_at,
           target_owner_id, source_artifact_id, source_task_id, target_task_id,
           target_task:target_task_id (id, title),
           source_artifact:source_artifact_id (id, title)`,
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (refreshed) {
        setFindings(refreshed as unknown as Finding[]);
      }
      router.refresh();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setRunning(false);
    }
  }

  async function onRespond(
    findingId: string,
    action: "acknowledge" | "link" | "dismiss",
    reason_chip: string | null = null,
    reason_free: string | null = null,
    feedback_note: string | null = null,
  ) {
    setError(null);
    try {
      const res = await respondToFinding(findingId, {
        action,
        reason_chip,
        reason_free,
        feedback_note,
      });
      setFindings((prev) =>
        prev.map((f) =>
          f.id === findingId
            ? {
                ...f,
                status: res.status,
                dismiss_reason: reason_chip || reason_free,
                feedback_note,
                resolved_at: new Date().toISOString(),
              }
            : f,
        ),
      );
      setOpenId(null);
      router.refresh();
    } catch (err) {
      setError(extractError(err));
    }
  }

  const filtered = findings.filter((f) => {
    if (filter === "mine") return f.target_owner_id === currentUserId;
    if (filter === "open") return f.status === "new" || f.status === "acknowledged";
    if (filter === "resolved") return f.status === "linked" || f.status === "dismissed";
    return true;
  });

  return (
    <div className="almanac space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(["open", "mine", "resolved", "all"] as Filter[]).map((f) => {
            const lbl = FILTER_LABELS[f];
            return (
              <Chip
                key={f}
                cn={lbl.cn}
                en={lbl.en}
                active={filter === f}
                onClick={() => setFilter(f)}
              />
            );
          })}
        </div>
        <button
          type="button"
          onClick={onDiscover}
          disabled={running}
          className="inline-flex items-center gap-1.5 bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-clay-deep disabled:opacity-40"
        >
          <Glyph name="sparkle" size={12} />
          {running ? (
            <Bi cn="扫描中…" en="Scanning…" glossSize={0.78} />
          ) : (
            <Bi cn="发现资料" en="Run discovery" glossSize={0.78} />
          )}
        </button>
      </div>

      {runMessage && (
        <p className="border border-sage-soft bg-sage-soft/60 px-3 py-2 text-sm text-sage-ink">
          {runMessage}
        </p>
      )}
      {error && (
        <p className="border border-rust-soft bg-rust-soft/40 px-3 py-2 text-sm text-rust-ink">
          {error}
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="border border-dashed border-rule bg-paper-2/60 px-6 py-10 text-center">
          <p className="text-sm text-ink-3">
            {findings.length === 0 ? (
              <Bi
                cn="还没有发现"
                en="No findings yet"
                glossSize={0.78}
              />
            ) : (
              <Bi
                cn="当前筛选没有结果"
                en="No findings match this filter"
                glossSize={0.78}
              />
            )}
          </p>
          {findings.length === 0 && (
            <p className="mt-1 text-xs text-ink-4">
              Mark some tasks done with artifacts attached, then click Run discovery · 把资料关联到已完成任务后再扫描
            </p>
          )}
        </div>
      ) : (
        <ul className="border-t border-rule">
          {filtered.map((f) => {
            const statusLbl = STATUS_LABELS[f.status] ?? {
              cn: f.status,
              en: f.status,
            };
            const isResolved = f.status === "dismissed" || f.status === "linked";
            const rowBg =
              f.status === "dismissed"
                ? "bg-paper-2/60 opacity-70"
                : f.status === "linked"
                  ? "bg-sage-soft/40"
                  : "bg-paper";
            return (
              <li key={f.id} className={`border-b border-rule ${rowBg}`}>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Micro>
                        <span className="font-sc text-ink-2">
                          {f.source_artifact?.title ?? "(artifact)"}
                        </span>{" "}
                        <Glyph name="arrow" size={10} />{" "}
                        <span className="font-sc text-ink-2">
                          {f.target_task?.title ?? "(task)"}
                        </span>
                      </Micro>
                      <AIText as="p" className="mt-2 text-sm leading-relaxed text-ink">
                        {f.how_to_use}
                      </AIText>
                      {(f.dismiss_reason || f.feedback_note) && (
                        <p className="mt-2 text-xs text-ink-3">
                          {f.dismiss_reason && (
                            <>
                              <Bi cn="原因" en="Reason" glossSize={0.78} />:{" "}
                              {f.dismiss_reason}
                            </>
                          )}
                          {f.feedback_note && (
                            <>
                              {" · "}
                              <Bi cn="备注" en="Note" glossSize={0.78} />:{" "}
                              {f.feedback_note}
                            </>
                          )}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                      <Bi cn={statusLbl.cn} en={statusLbl.en} glossSize={0.85} />
                    </span>
                  </div>

                  {!isResolved && (
                    <div className="mt-3 border-t border-rule pt-3">
                      {openId === f.id ? (
                        <DismissForm
                          onSubmit={(chip, free) =>
                            onRespond(f.id, "dismiss", chip, free)
                          }
                          onCancel={() => setOpenId(null)}
                        />
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => onRespond(f.id, "acknowledge")}
                            className="border border-rule bg-paper px-3 py-1 text-xs text-ink-2 transition hover:border-rule-ink hover:bg-paper-3 hover:text-ink"
                          >
                            <Bi cn="确认" en="Acknowledge" glossSize={0.78} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onRespond(f.id, "link")}
                            className="border border-rule bg-paper px-3 py-1 text-xs text-ink-2 transition hover:border-rule-ink hover:bg-paper-3 hover:text-ink"
                          >
                            <Bi
                              cn="有用·关联"
                              en="Useful · Link"
                              glossSize={0.78}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => setOpenId(f.id)}
                            className="border border-rust-soft bg-paper px-3 py-1 text-xs text-rust-ink transition hover:bg-rust-soft/50"
                          >
                            <Bi
                              cn="忽略·标注原因"
                              en="Dismiss with reason"
                              glossSize={0.78}
                            />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DismissForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (chip: string | null, free: string | null) => void;
  onCancel: () => void;
}) {
  const [chip, setChip] = useState<string | null>(null);
  const [free, setFree] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {DISMISS_CHIPS.map((c) => (
          <Chip
            key={c.key}
            cn={c.cn}
            en={c.en}
            active={chip === c.key}
            onClick={() => setChip(chip === c.key ? null : c.key)}
          />
        ))}
      </div>
      <input
        type="text"
        value={free}
        onChange={(e) => setFree(e.target.value)}
        placeholder="Or type why — the AI uses this to filter future findings · 用自己的话写一句，AI 会用于过滤后续发现"
        className="w-full border border-rule bg-paper px-3 py-2 text-xs text-ink outline-none transition focus:border-ink"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="border border-rule bg-paper px-3 py-1 text-xs text-ink-2 transition hover:bg-paper-3 hover:text-ink"
        >
          <Bi cn="取消" en="Cancel" glossSize={0.78} />
        </button>
        <button
          type="button"
          onClick={() => onSubmit(chip, free.trim() || null)}
          disabled={!chip && !free.trim()}
          className="bg-rust px-3 py-1 text-xs font-medium text-paper transition hover:bg-rust-ink disabled:opacity-40"
        >
          <Bi cn="忽略" en="Dismiss" glossSize={0.78} />
        </button>
      </div>
    </div>
  );
}
