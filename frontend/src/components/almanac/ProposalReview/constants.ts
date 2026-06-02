/**
 * Default reject-reason set + seed proposals for smoke-test.
 *
 * REJECT_REASONS is exported for callers that want to extend (M6 finding
 * dismiss uses a different list focused on the discovery-pipeline signal).
 *
 * SEED_PROPOSALS mirrors the design-bundle seed exactly so /almanac-demo
 * renders the same content the design boards show.
 */

import type { Proposal, RejectReason } from "./types";

export const REJECT_REASONS: RejectReason[] = [
  { id: "wrong-scope", cn: "范围不对", en: "wrong scope" },
  { id: "duplicate", cn: "已存在", en: "duplicate" },
  { id: "wrong-owner", cn: "负责人错", en: "wrong owner" },
  { id: "not-now", cn: "时机未到", en: "not now" },
  { id: "low-confidence", cn: "证据不足", en: "low confidence" },
  { id: "off-strategy", cn: "偏离方向", en: "off-strategy" },
  { id: "human-handled", cn: "已人工处理", en: "human-handled" },
  { id: "rewrite-needed", cn: "需重写", en: "rewrite needed" },
];

export const SEED_PROPOSALS: Proposal[] = [
  {
    id: "p1",
    kind: "task-gen",
    target: { type: "task", id: "T-082", titleCn: "为产品页撰写简介", titleEn: "Write product-page intros" },
    before: null,
    after: {
      titleCn: "为产品页撰写简介",
      titleEn: "Write product-page intros",
      descCn: "围绕材质、灵感与佩戴场景，为前 6 个 SKU 各写 80–120 字介绍。",
      descEn: "Write 80–120 word intros for the first 6 SKUs covering material, inspiration, wear context.",
      meta: { owner: "—", estimate: "M", deadline: "Fri", linksTo: ["F-217"] },
    },
    rationaleAi: "Found a recurring gap in the brainstorm notes: every SKU needs first-person copy, no copywriter assigned yet.",
    rationaleAiCn: "在头脑风暴笔记中反复出现：每个 SKU 都需要第一人称口吻的文案，但还未指派撰稿人。",
    confidence: 0.82,
  },
  {
    id: "p2",
    kind: "optimizer",
    target: { type: "task", id: "T-061", titleCn: "复审打样照片", titleEn: "Review supplier samples" },
    before: { status: "Blocked", owner: "Mei", deadline: "—" },
    after: { status: "Ready", owner: "Mei", deadline: "Thu" },
    rationaleAi: "Supplier samples were uploaded as artifact A-44 on May 8 — the block reason ('awaiting photos') no longer holds.",
    rationaleAiCn: "供应商样图已于 5 月 8 日作为 A-44 上传，阻塞原因（等待样图）已不成立。",
    confidence: 0.94,
  },
  {
    id: "p3",
    kind: "finding",
    target: { type: "finding", id: "F-217", titleCn: "Notion 中 SKU 命名与数据库不一致", titleEn: "SKU naming drift between Notion and DB" },
    before: null,
    after: {
      severity: "medium",
      proposal: "Open task: align SKU slugs to {brand}-{material}-{form}-{stone} before any product-page work.",
      proposalCn: "建议立项：在任何产品页工作开始前，将 SKU slug 统一为 {brand}-{material}-{form}-{stone}。",
    },
    rationaleAi: "12 SKUs in Notion don't match the canonical naming pattern in the products table. This will cascade into any URL or analytics work downstream.",
    rationaleAiCn: "Notion 中 12 个 SKU 与产品表的命名规则不一致，会下游影响所有 URL 与分析工作。",
    confidence: 0.71,
  },
  {
    id: "p4",
    kind: "meeting",
    target: { type: "meeting", id: "M-09", titleCn: "周一 Launch 同步", titleEn: "Monday launch sync" },
    before: null,
    after: {
      kind: "action-item",
      titleCn: "Mei 确认 5/20 前是否能拿到 Form 30 件首批",
      titleEn: "Mei to confirm Form 30 first batch arrives by 5/20",
      owner: "Mei",
      deadline: "Mon",
    },
    rationaleAi: "Pulled from the transcript at 24:13 — Mei agreed verbally; no owner was assigned in the notes.",
    rationaleAiCn: "来自录音 24:13 — Mei 在会上口头同意，但笔记中未指派负责人。",
    confidence: 0.88,
  },
  {
    id: "p5",
    kind: "task-gen",
    target: { type: "task", id: "T-083", titleCn: "为美国仓储确认 Net 30 付款条款", titleEn: "Confirm Net 30 with US warehouse" },
    before: null,
    after: {
      titleCn: "确认美国仓 Net 30 付款条款",
      titleEn: "Confirm Net 30 with US warehouse",
      descCn: "在 5/22 前与 Yara 沟通，明确入库后第一笔结款时间。",
      descEn: "Talk to Yara before 5/22 to lock the first invoice date post-receiving.",
      meta: { owner: "—", estimate: "S", deadline: "5/22", linksTo: ["D-08"] },
    },
    rationaleAi: "Decision D-08 last week assumed Net 30 but no operational follow-up was created.",
    rationaleAiCn: "上周决策 D-08 假定 Net 30，但未创建对应执行项。",
    confidence: 0.77,
  },
];

export const SOURCE_LABELS: Record<string, { cn: string; en: string }> = {
  optimizer: { cn: "本周积压回顾", en: "Weekly backlog review" },
  "task-gen": { cn: "头脑风暴 → 任务", en: "Brainstorm → tasks" },
  finding: { cn: "跨任务发现", en: "Cross-task findings" },
  meeting: { cn: "会议后行动项", en: "Post-meeting action items" },
};
