"use client";

/**
 * Manager learning insights (M21 / C3) — makes the feedback loop visible:
 * accept/reject rates per AI action type, weekly activity, the rejection
 * reason mix, and today's LLM spend vs the workspace cap. Read-only.
 */

import { useEffect, useState } from "react";

import { Bi, Micro } from "@/components/almanac";
import { type InsightsResponse, getProjectInsights } from "@/lib/api";
import { extractError } from "@/lib/extract-error";

export default function InsightsPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getProjectInsights(params.id)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(extractError(e)));
    return () => {
      alive = false;
    };
  }, [params.id]);

  if (error) {
    return (
      <p className="almanac text-sm text-rust-ink" role="alert">
        {error}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="almanac text-sm text-ink-3">
        <Bi cn="加载中…" en="Loading…" glossSize={0.78} />
      </p>
    );
  }

  const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);
  const spendPct =
    data.spend.budget_usd > 0 ? Math.min(100, (data.spend.today_usd / data.spend.budget_usd) * 100) : 0;
  const maxWeek = Math.max(1, ...data.weekly_activity.map((w) => w.count));

  return (
    <div className="almanac space-y-8">
      <div>
        <Micro>
          <Bi cn="经理在学习" en="Manager is learning" glossSize={0.78} />
        </Micro>
        <p className="mt-1 text-sm text-ink-2">
          <Bi
            cn="每次接受/拒绝都会反馈到下一次 AI 提案。下面是这个项目的反馈回路。"
            en="Every accept / reject feeds the next AI proposal. Here is this project's feedback loop."
            glossSize={0.78}
          />
        </p>
      </div>

      {/* Headline stats */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat labelCn="AI 操作总数" labelEn="Total AI actions" value={data.totals.total} />
        <Stat labelCn="采纳率" labelEn="Accept rate" value={pct(data.totals.accept_rate)} />
        <Stat labelCn="待审" labelEn="Pending review" value={data.totals.pending} />
        <Stat
          labelCn="今日花费"
          labelEn="Spend today"
          value={`$${data.spend.today_usd.toFixed(2)}`}
        />
      </section>

      {/* Spend gauge */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <Micro>
            <Bi cn="今日预算" en="Daily budget" glossSize={0.78} />
          </Micro>
          <span className="font-mono text-[11px] text-ink-3" data-tabular>
            ${data.spend.today_usd.toFixed(4)} / ${data.spend.budget_usd.toFixed(2)}
          </span>
        </div>
        <div className="h-2 w-full bg-paper-3">
          <div
            className="h-2"
            style={{ width: `${spendPct}%`, background: spendPct > 85 ? "var(--rust)" : "var(--clay)" }}
          />
        </div>
      </section>

      {/* Per action type */}
      <section>
        <Micro>
          <Bi cn="按操作类型" en="By action type" glossSize={0.78} />
        </Micro>
        {data.per_action_type.length > 0 ? (
          <ul className="mt-2 border-t border-rule">
            {data.per_action_type.map((s) => (
              <li key={s.action_type} className="border-b border-rule px-1 py-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-2">
                    {s.action_type}
                  </span>
                  <span className="font-mono text-[11px] text-ink-3" data-tabular>
                    {pct(s.accept_rate)} · {s.total}
                  </span>
                </div>
                <div className="mt-2 flex h-1.5 w-full overflow-hidden bg-paper-3">
                  <span style={{ width: `${share(s.accepted, s.total)}%`, background: "var(--sage)" }} />
                  <span style={{ width: `${share(s.rejected, s.total)}%`, background: "var(--rust)" }} />
                  <span style={{ width: `${share(s.pending, s.total)}%`, background: "var(--ink-4)" }} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty />
        )}
        <Legend />
      </section>

      {/* Weekly activity */}
      <section>
        <Micro>
          <Bi cn="近 8 周活动" en="Activity (last 8 weeks)" glossSize={0.78} />
        </Micro>
        {data.weekly_activity.length > 0 ? (
          <div className="mt-3 flex items-end gap-2" style={{ height: 80 }}>
            {data.weekly_activity.map((w) => (
              <div key={w.week_start} className="flex flex-1 flex-col items-center justify-end gap-1">
                <div
                  className="w-full bg-clay-soft"
                  style={{ height: `${(w.count / maxWeek) * 64}px`, minHeight: 2 }}
                  title={`${w.week_start}: ${w.count}`}
                />
                <span className="font-mono text-[9px] text-ink-4">{w.week_start.slice(5)}</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty />
        )}
      </section>

      {/* Reject reasons */}
      <section>
        <Micro>
          <Bi cn="拒绝原因分布" en="Why proposals get rejected" glossSize={0.78} />
        </Micro>
        {data.top_reject_reasons.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {data.top_reject_reasons.map((r) => (
              <li
                key={r.reason}
                className="border border-rule bg-paper-2 px-2 py-1 font-mono text-[11px] text-ink-2"
              >
                {r.reason} <span className="text-ink-4">·{r.count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-ink-3">
            <Bi cn="还没有带理由的拒绝记录。" en="No rejections with reasons yet." glossSize={0.78} />
          </p>
        )}
      </section>
    </div>
  );
}

function share(n: number, total: number): number {
  return total > 0 ? (n / total) * 100 : 0;
}

function Stat({ labelCn, labelEn, value }: { labelCn: string; labelEn: string; value: number | string }) {
  return (
    <div className="border border-rule bg-paper p-4">
      <Micro>
        <Bi cn={labelCn} en={labelEn} glossSize={0.78} />
      </Micro>
      <p className="mt-2 font-mono text-2xl text-ink" data-tabular>
        {typeof value === "number" ? value.toString().padStart(2, "0") : value}
      </p>
    </div>
  );
}

function Legend() {
  const dot = (c: string) => (
    <span className="inline-block h-2 w-2" style={{ background: c }} aria-hidden="true" />
  );
  return (
    <div className="mt-2 flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
      <span className="flex items-center gap-1">{dot("var(--sage)")} <Bi cn="采纳" en="Accepted" glossSize={0.85} /></span>
      <span className="flex items-center gap-1">{dot("var(--rust)")} <Bi cn="拒绝" en="Rejected" glossSize={0.85} /></span>
      <span className="flex items-center gap-1">{dot("var(--ink-4)")} <Bi cn="待审" en="Pending" glossSize={0.85} /></span>
    </div>
  );
}

function Empty() {
  return (
    <div className="mt-2 border border-dashed border-rule bg-paper-2/60 px-4 py-6 text-center text-xs text-ink-3">
      <Bi cn="暂无数据" en="No data yet" glossSize={0.78} />
    </div>
  );
}
