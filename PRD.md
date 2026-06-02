# AI Manager Platform — PRD v0.1

> 内部代号待定。本文档是给 Claude Code（或其他coding agent）的实现起点，也是创始人自己思考产品形态的工作文档。**会频繁迭代，不要把它当成最终spec。**

---

## 1. 项目背景

### 1.1 origin story

创始人在做 fanpo 手串出海项目（3-5人小团队，中美跨境DTC品牌），团队现在的协作方式是：每个人单独跟 AI（Claude/GPT）对话，然后用 AI 的产出互相聊。这种模式有两个根本问题：

1. **AI 没有共享 state** — 每个对话孤立，AI 不知道 team 当前在做什么、上周决定了什么、谁卡在哪。
2. **AI 是被动的工具** — 人类需要不断主动喂 context、提问题。AI 本可以做更多 proactive 的工作。

理想状态是反过来：**AI 主动 manage team 的状态，人类做 AI 做不了的事（去义乌调研、跟供应商喝酒、客户访谈）**。这就是 paper *Orchestrating Human-AI Teams: The Manager Agent as a Unifying Research Challenge* (DeepFlow, 2025) 描述的 "human-on-the-loop" 模式。

### 1.2 商业化方向

第一阶段是 fanpo 团队的内部工具。跑 2-3 个月之后，如果价值验证，commercialize 给类似的小团队。目标客户细分（待验证）：

- **路线 A**：DTC 出海品牌团队（3-15人）— 我们最懂的市场，护城河最深
- **路线 B**：中美/远程/异步协作的小团队 — 市场大但通用
- **路线 C**：早期 startup 创始人的 AI Chief of Staff — pain 真但市场小

当前 PRD 不绑定路线，但优先选择对路线 A 友好的设计。

---

## 2. 核心差异化

### 2.1 与现有工具的区别

| 类别 | 代表产品 | 局限 |
|------|---------|------|
| 项目管理 + AI 辅助 | Linear, Asana, Height | AI 是 feature add-on，底层模型还是 "工具+人" |
| AI workflow orchestration | Lindy, Relay, Gumloop | focus 在自动化任务，不是管理团队 |
| AI coaching | BetterUp, Cresta | 企业级、合规重、给大公司用 |
| 笔记 + AI | Notion AI, Mem | 没有 task graph 和 manager agent 概念 |

**我们的定位**：**Single state store + Manager Agent**。所有功能共享一个对 project 的完整理解。这不是任何单一 feature 的护城河，而是 architecture 层面的。

### 2.2 一句话定义

> 给 3-15 人小团队的 AI 项目经理：它看着所有人在做什么，主动提建议、推任务、做 1:1 coaching，让创始人和团队成员能专注在 AI 做不了的事情上。

---

## 3. 目标用户

### 3.1 P0 用户：fanpo 团队（dogfooding）

- 3-5 人，分布在 Bay Area 和北京
- 沟通中文为主，工具混用飞书、Notion、微信、Claude
- 在做 DTC 品牌出海，task 类型混杂：合规、供应链、Shopify、营销、财务
- 创始人是技术背景，team 成员技术程度不一

### 3.2 P1 用户：类似的中国出海小团队

- 3-15 人
- 跨境协作（中国 + 海外）
- 已经在用 AI 工具但工作流分散
- 创始人愿意为生产力工具付费 $200-500/月/team

### 3.3 非目标用户

- 50+ 人的中大型公司（合规、SSO、SAML 太重）
- 完全本地化的纯国内团队（飞书生态足够）
- 纯技术团队（用 Linear + GitHub 更好）

---

## 4. 架构概览

### 4.1 分层架构

```
┌────────────────────────────────────────────────────────┐
│  Frontend (3 surfaces)                                 │
│  - Team Operations Dashboard                           │
│  - Personal Coaching Space                             │
│  - Founder Command Center                              │
└────────────────────────────────────────────────────────┘
                          ↕
┌────────────────────────────────────────────────────────┐
│  AI Manager Agent Layer                                │
│  - Task Generator                                      │
│  - Cross-task Info Discovery                           │
│  - People Recommender                                  │
│  - Meeting Orchestrator                                │
│  - 1:1 Coach                                           │
│  - Backlog Maintainer                                  │
└────────────────────────────────────────────────────────┘
                          ↕
┌────────────────────────────────────────────────────────┐
│  Model Abstraction Layer (LiteLLM-like)                │
│  Swappable: Kimi K2, Qwen, Claude, GPT, DeepSeek       │
└────────────────────────────────────────────────────────┘
                          ↕
┌────────────────────────────────────────────────────────┐
│  Integration & Sync Layer                              │
│  Read/Write: 飞书, Slack, Notion, GitHub, Google Cal   │
└────────────────────────────────────────────────────────┘
                          ↕
┌────────────────────────────────────────────────────────┐
│  State Store (Single Source of Truth)                  │
│  Postgres + Object Storage                             │
└────────────────────────────────────────────────────────┘
```

### 4.2 设计原则

1. **State 是核心资产**。所有 AI capabilities 共享同一个 state，从第一天就要为 multi-tenant 设计。
2. **Model 可替换**。不绑定任何单一 LLM provider。早期用 Kimi/Qwen 控成本，关键路径可以升级到 Claude/GPT。
3. **集成 > 替代**。不试图取代客户的飞书/Notion，而是 sync 进来再增值。
4. **隐私边界严格**。1:1 coaching 数据和 team operations 数据物理隔离。
5. **Dogfooding first**。每个 feature 上线前在 fanpo 团队跑两周。

---

## 5. 数据模型

这是整个产品最重要、也最难撤销的设计决定。Schema 的形状决定 AI 能做什么。

### 5.1 核心 entities

```sql
-- Multi-tenant 基础
CREATE TABLE workspaces (
  id UUID PRIMARY KEY,
  name TEXT,
  created_at TIMESTAMPTZ,
  -- 加密 key, billing info 等
);

CREATE TABLE users (
  id UUID PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id),
  email TEXT UNIQUE,
  name TEXT,
  role TEXT, -- founder, member
  skills JSONB, -- ["供应链", "营销文案", "Shopify配置"]
  work_style JSONB, -- AI 学到的工作风格画像
  timezone TEXT
);

-- Project 是顶层组织单元
CREATE TABLE projects (
  id UUID PRIMARY KEY,
  workspace_id UUID,
  name TEXT,
  vision TEXT, -- 长期目标
  current_stage TEXT, -- discovery, validation, launch, scale
  preferences JSONB, -- {speed: 0.3, quality: 0.4, cost: 0.3} (paper 里的 U)
  created_at TIMESTAMPTZ
);

-- Task graph (paper 里的 G)
CREATE TABLE tasks (
  id UUID PRIMARY KEY,
  project_id UUID,
  title TEXT,
  description TEXT,
  owner_id UUID REFERENCES users(id),
  status TEXT, -- backlog, ready, in_progress, blocked, done, dropped
  priority INT,
  estimated_hours NUMERIC,
  actual_hours NUMERIC,
  created_by TEXT, -- 'human' or 'ai'
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  metadata JSONB -- 灵活字段，存 AI 的推荐理由等
);

CREATE TABLE task_dependencies (
  prereq_task_id UUID REFERENCES tasks(id),
  dependent_task_id UUID REFERENCES tasks(id),
  PRIMARY KEY (prereq_task_id, dependent_task_id)
);

-- Artifacts (paper 里的 X) — task 产出的东西
CREATE TABLE artifacts (
  id UUID PRIMARY KEY,
  task_id UUID,
  type TEXT, -- doc, link, decision, image, dataset
  title TEXT,
  content TEXT, -- 或 storage_url for large objects
  embeddings VECTOR(1536), -- for semantic search 跨 task 的信息发现
  created_at TIMESTAMPTZ
);

-- Communications (paper 里的 C) — 所有对话
CREATE TABLE messages (
  id UUID PRIMARY KEY,
  project_id UUID,
  task_id UUID NULL, -- nullable, 不一定关联 task
  sender_type TEXT, -- user, ai_manager, integration (e.g. 飞书 sync)
  sender_id TEXT,
  content TEXT,
  channel TEXT, -- in_app, feishu_sync, slack_sync, etc.
  created_at TIMESTAMPTZ
);

-- Decisions — 显式记录的决策
CREATE TABLE decisions (
  id UUID PRIMARY KEY,
  project_id UUID,
  question TEXT,
  decision TEXT,
  reasoning TEXT,
  alternatives_considered TEXT,
  decided_by UUID REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  review_at TIMESTAMPTZ -- 什么时候应该重新审视
);

-- 1:1 coaching — 严格隔离
CREATE TABLE coaching_sessions (
  id UUID PRIMARY KEY,
  user_id UUID, -- 私有，团队其他人不可见
  project_context_snapshot JSONB, -- 当时 project state 的快照
  transcript TEXT, -- 加密存储
  insights JSONB, -- AI 提炼的 insights，但不暴露给其他人
  created_at TIMESTAMPTZ
);

-- Meetings
CREATE TABLE meetings (
  id UUID PRIMARY KEY,
  project_id UUID,
  type TEXT, -- biweekly_planning, weekly_retro, daily_ops, ad_hoc
  scheduled_at TIMESTAMPTZ,
  agenda JSONB,
  attendees UUID[],
  notes TEXT,
  ai_pre_brief TEXT, -- AI 会前简报
  ai_post_summary TEXT
);

-- AI manager 的所有 action — 审计 + learning
CREATE TABLE manager_actions (
  id UUID PRIMARY KEY,
  project_id UUID,
  action_type TEXT, -- generate_tasks, recommend_owner, suggest_meeting, etc.
  input_context JSONB,
  output JSONB,
  accepted_by_human BOOLEAN,
  human_feedback TEXT,
  created_at TIMESTAMPTZ
);
```

### 5.2 关键设计决定

- **Embeddings 存在 artifacts 表上**：支持 feature 3（跨 task 发现有用信息）。每个 artifact 入库时生成 embedding。
- **manager_actions 表是 RL 信号源**：每个 AI 建议是否被接受、人类反馈是什么——这是未来 fine-tune 或者改进 prompt 的 ground truth。
- **decisions 是一等公民**：很多团队工具忽略 decision log，但这是 AI 理解"为什么这么做"的关键。
- **coaching_sessions 物理隔离**：不放在和 messages 同一张表里，schema 也不同，从架构上保证不会泄露。

---

## 6. 功能详细 Spec

按优先级排序。每个功能标注 MVP / V1 / V2。

### 6.1 [MVP] Task Generator

**输入**：
- 一段 brainstorm 文字 / PRD / 想法
- 一组支持文档（链接到 artifacts）
- 当前 project state（current_stage, 活跃 tasks, 团队成员）

**输出**：
- 5-15 个结构化 task，包含 title、description、estimated_hours、suggested_owner（可选）、dependencies
- 每个 task 标注：is_critical_path、stage_alignment（当前阶段必要 vs nice-to-have）
- 一段 reasoning：为什么这些 task，为什么这个顺序

**关键设计**：
- 不只生成 task 列表，要生成**带依赖关系的 task graph**
- 必须考虑 current_stage——validation 阶段的 task 跟 scale 阶段的 task 完全不同
- 让用户可以"refine task"——用自然语言改一个 task，AI 调整相关的 dependency

**Prompt template 思路**：
```
你是 [project.name] 项目的 AI 项目经理。
当前阶段: [project.current_stage]
团队成员: [users with skills]
活跃 tasks: [in_progress tasks]
项目偏好: [preferences U]

用户输入:
[brainstorm/PRD]

支持文档:
[artifacts]

请生成 5-15 个 task...
```

### 6.2 [MVP] Cross-task Info Discovery

**功能**：当 task A 完成时，artifacts 里可能有对 task B、C、D 有用的信息。AI 主动发现并提醒。

**触发**：
- task 状态变为 done 时
- 新 task 创建时（反向：现有 artifacts 里有没有相关信息）
- 每周定期扫一遍

**实现**：
1. task 完成后，把 artifacts 的 embeddings 跟所有 active task 的 description embeddings 做 similarity search
2. top-K 候选拿给 LLM 判断：这个产出对那个 task 真的有用吗？有用的话用一句话说明怎么用。
3. 把 finding 推给相关 task 的 owner（in-app notification + 飞书消息）

**为什么这个 feature 重要**：这是几乎所有团队工具都没做的。也是 demo 时最 wow 的功能。

### 6.3 [MVP] Backlog Optimizer (周度)

**功能**：每周一次，AI 扫所有 task 和 project state，输出：
- 重新排序后的 backlog（带 reasoning）
- 建议砍掉的 task（解释为什么）
- 建议新增的 task（基于当前 gap）
- 本周关键路径
- 还需要哪些信息才能做下一个决策

**关键设计**：
- 输出是**建议**不是**强制**。Human 决定接受哪些、改哪些、拒绝哪些。
- 所有建议进 `manager_actions` 表，用于学习。
- 一周一次，不是天天烦人。

### 6.4 [V1] People Recommender + Progress Check

**功能 A：推荐谁做哪个 task**
- 基于 user.skills, user.work_style, 当前 workload, 跟其他 task 的 dependency
- 输出 top 2 候选 + 推荐理由

**功能 B：定期 check progress**
- 每天扫一遍 in_progress task
- 识别：超时未更新、estimated vs actual 偏差过大、被 block 但没说
- 推送给 task owner（私聊）："这个 task 你估计 4 小时已经 8 小时了，要不要重新评估？"

**关键设计**：
- Progress check 必须以**关心**的语气，不是**催促**。语气校准很重要。
- 给 owner 一个简单的回应方式："还需要 X 小时" / "卡在 Y" / "其实应该砍掉"

### 6.5 [V1] 1:1 Coaching

**功能**：每个成员私密的 AI 对话空间，每两周一次（可调），AI 主动开启对话。

**对话内容**：
- 你最近完成了 X、Y、Z，最有成就感的是哪个？
- task A 你预估的时间是实际的 2.5 倍，要不要复盘下原因？
- 你已经第三周说要做 task B，是真的卡住了，还是你觉得它其实不该做？
- 你跟 [team member] 在 [decision] 上似乎有不同看法，要不要我帮你梳理下你的论点？

**关键设计**：
- **严格隐私**：这个对话内容**永远不进入** project state，**永远不告诉**其他成员或创始人。
- 但 AI 可以从 coaching 里学到这个人的 work style，更新到 `users.work_style`（脱敏的画像，比如"倾向高估自己的速度"，不是具体内容）。
- 不复制人类 coach 的对话技巧，而是做 AI 才能做的：**基于数据的反思引导**。
- 可以参考的框架但不机械套用：GROW (Goal-Reality-Options-Will)、CLEAR。

### 6.6 [V1] Meeting Orchestrator

**功能**：基于固定会议节奏 + 项目状态，flexibly 调整会议。

**默认节奏**（每个 project 可配置）：
- Daily ops update：异步，每天早上 AI 生成
- Weekly retro：每周五 30 分钟
- Biweekly planning：每两周一次，1 小时

**AI 做的事**：
1. **会前**：基于过去一周的 task 进展、decisions、blockers，自动生成 agenda
2. **flexible 调整**：如果这周项目很顺、没新 blocker，建议把 retro 缩短到 15 分钟。如果有重大 blocker，建议加一个 ad-hoc 会议。
3. **会后**：基于会议 notes（人类记的或 AI 听的），提炼 decisions 和 action items，落到 task 表。

### 6.7 [V2] Auto Backlog Maintainer

**功能**：项目长期推进过程中，AI 定期生成新 task 确保项目不停。

**触发**：
- backlog 里 ready task 少于 N 个时
- 某个 milestone 接近但还有 gap 时
- 每周一次主动 review

**关键风险**：做不好会让 team 烦死。控制方式：
- 生成的 task 默认不进 ready 队列，进 `suggested` 状态
- 一次最多生成 3 个，且必须解释"为什么现在需要这个"
- 创始人/PM 一键 approve 才进 backlog

---

## 7. MVP Scope (v0.1)

**只做这些**：
- [ ] User auth + workspace + project 基础 CRUD
- [ ] Task / artifact / decision 的数据模型和基础 UI
- [ ] **Feature 6.1 — Task Generator**（核心入口）
- [ ] **Feature 6.2 — Cross-task Info Discovery**（差异化亮点）
- [ ] **Feature 6.3 — Weekly Backlog Optimizer**（基础价值）
- [ ] 飞书集成（最低限度：把飞书群聊消息 sync 进 messages 表，把 AI 建议推到飞书）
- [ ] 简单的 Team Operations Dashboard（看 task 和 artifact）

**MVP 不做**：
- Coaching（V1）
- People recommender（V1）
- Progress check（V1）
- Meeting orchestrator（V1）
- Auto backlog maintainer（V2）
- 其他集成（Slack, Notion, GitHub）— V1 再加
- Mobile app — V2
- 多模型切换的 UI（早期写死 Kimi 就行，代码层留口）

**MVP 成功标准**：
- fanpo 团队跑 4 周
- 至少 3 个 cross-task info discovery 让某人省了时间
- weekly backlog optimizer 的建议至少 50% 被采纳
- 创始人在 4 周后愿意付 $200/月用它

---

## 8. 技术栈

### 8.1 后端

- **语言**：Python (FastAPI) — 生态对 LLM 最友好
- **数据库**：Postgres (Supabase 或 Neon hosted)
- **向量**：Postgres 的 pgvector 扩展（不另外搞 Pinecone，省事）
- **队列**：Postgres-based queue (e.g. pgmq) 或者轻量 Redis；初期不上 Celery
- **存储**：Supabase Storage 或 R2（artifacts 的大文件）

### 8.2 前端

- **框架**：Next.js (App Router) + TypeScript
- **UI**：Tailwind + shadcn/ui
- **状态**：TanStack Query + Zustand（简单够用）

### 8.3 集成

- **飞书**：飞书开放平台 API（消息、群、文档）
- **Auth**：Clerk 或 Supabase Auth（不自己写）

### 8.4 部署

- **前端**：Vercel
- **后端**：Railway 或 Fly.io
- **DB**：Supabase（auth + db + storage 一起）

### 8.5 不要做的事

- 不上 Kubernetes
- 不搞 microservices
- 不上 Kafka / event sourcing
- 不自己实现 auth
- 不在 MVP 阶段考虑 mobile
- 不为"以后可能要 X"过度抽象

---

## 9. AI Model 抽象层（重要）

### 9.1 为什么这一层关键

- 早期用 Kimi / Qwen / DeepSeek 控成本
- 关键路径（如 1:1 coaching 的对话质量）可能要 Claude
- 长 context 任务（如全 project state 综合）可能要特定 model
- Model 价格、能力每月在变，不能 hardcode

### 9.2 实现方式

用 **LiteLLM**（pip install litellm）做统一接口，所有 LLM 调用走它：

```python
from litellm import completion

response = completion(
    model="moonshot/moonshot-v1-128k",  # 或 "qwen/qwen-max", "claude-opus-4-7", etc.
    messages=[...],
    api_key=os.getenv("MOONSHOT_API_KEY"),
)
```

切换 model 只改一个字段。

### 9.3 model 路由策略（早期写死即可）

```python
MODEL_ROUTING = {
    "task_generation": "moonshot/moonshot-v1-128k",  # 长 context, 便宜
    "info_discovery": "qwen/qwen-plus",  # 中等任务
    "embeddings": "qwen/text-embedding-v2",  # 便宜
    "coaching": "claude-opus-4-7",  # 关键对话质量，贵但值
    "backlog_optimizer": "moonshot/moonshot-v1-128k",
}
```

### 9.4 Prompt caching

- Kimi 和 Qwen 都支持 prompt caching（implicit 或 explicit），重复的 system prompt 和 project state 部分可以省 70%+ token
- 实现时把 prompt 拆成：[stable_system] + [project_state_snapshot] + [user_query]，让 stable 部分 cacheable

### 9.5 成本预算

- MVP 阶段每个 active workspace 月 LLM 成本目标 < $10
- 用 Kimi/Qwen 应该能轻松做到（10000 input token + 1000 output token 大概 ¥0.05-0.2）
- 后期付费客户每 workspace 月费 $200-500，毛利 80%+

---

## 10. Roadmap

### Phase 0: Setup (Week 1)
- Repo + 基础架构
- DB schema
- Auth + workspace
- Model abstraction layer

### Phase 1: MVP (Week 2-5)
- Task / artifact / decision CRUD
- Task Generator
- Cross-task Info Discovery
- Weekly Backlog Optimizer
- 飞书消息 sync
- Team Operations Dashboard

### Phase 2: Internal Dogfooding (Week 6-9)
- fanpo 团队全员使用
- 每两周收集反馈、修 bug、调 prompt
- 写 onboarding 文档

### Phase 3: V1 Features (Week 10-16)
- 1:1 Coaching
- People Recommender + Progress Check
- Meeting Orchestrator
- 邀请 2-3 个外部 team 试用

### Phase 4: Commercialize (Week 17+)
- 定价 + 付费流
- Slack / Notion 集成
- 公开 landing page + 营销
- 看是否 product-market fit

---

## 11. Non-goals

明确不做的事，避免 scope creep：

- 不做通用的项目管理工具（Linear / Asana 替代品）
- 不做 AI 客服 / 销售 SDR
- 不做代码生成 / 代码 review
- 不做大公司级别的合规（SOC2 等）— V2 之后
- 不做实时协作编辑（Notion 那种）
- 不做语音 / 视频会议本身（只做会议 orchestration）
- 不做财务 / HR 系统集成（V2 之后）

---

## 12. 风险与未解决问题

### 12.1 产品风险

- **冷启动**：新 workspace 上来 state 是空的，AI 给不出好建议。怎么设计前两周的 onboarding 让 state 快速积累？
- **信任**：1:1 coaching 客户的法务部门会问一堆问题。GDPR、AI Act、各地劳动法。需要查清楚。
- **替代 vs 增强**：客户已经有 Linear/Notion，我们是替代还是 augment？目前设计偏 augment（sync 进来再增值），但这意味着 UX 上是 "另一个 tab"，容易被忽略。
- **AI 出错的责任边界**：AI 推荐 task 出错了、coaching 说错话了，怎么处理？需要明确的"AI 建议不是命令" disclaimer 和 audit trail。

### 12.2 技术风险

- **跨模型 prompt 一致性**：Kimi 和 Claude 对同一个 prompt 输出质量可能差很多，关键功能要 A/B 测试
- **embedding 模型选择**：用国产 embedding（便宜）vs OpenAI/Voyage（贵但好），需要在中文语料上测
- **飞书 API rate limit**：飞书的 API limit 偏严，sync 大量历史消息时要注意

### 12.3 商业风险

- **市场太窄**：DTC 出海 + AI 工具的交集可能不够大养活公司，需要早期评估
- **大公司碾压**：Linear / Notion 加上 AI 功能能很快追上，我们的护城河是不是真的够深？
- **价格敏感**：3-5 人小团队对 $300/月可能犹豫，但低于这个价覆盖不了 LLM 成本

---

## 13. 第一周的具体 todos

给 Claude Code 的起步指令：

1. **建 repo 结构**：
   ```
   /backend (FastAPI)
     /api
     /models (SQLAlchemy)
     /llm (LiteLLM wrappers)
     /integrations (feishu, etc.)
   /frontend (Next.js)
   /docs (这个 PRD + 后续设计文档)
   /scripts
   ```

2. **DB migration**：把第 5 节的 schema 用 Alembic 落地

3. **LiteLLM wrapper**：包一个 `llm/manager.py`，统一 `generate()` `embed()` 接口，环境变量配置 model

4. **第一个 endpoint**：`POST /api/projects/:id/generate_tasks` — 接收 brainstorm 文字，调 Kimi 生成 task 列表，落 DB

5. **最小 UI**：一个 project 详情页，能看 task 列表 + 一个 "Generate Tasks from Brainstorm" 按钮

6. **跑通端到端**：在自己的 dev workspace 跑通一次完整流程：登录 → 建 project → 喂一段 fanpo 的 brainstorm → 看 AI 生成的 task → 手动编辑

7. **写 README**：包括 setup 步骤、环境变量、所需的 API key（Moonshot / Qwen / Anthropic / Supabase / Feishu）

跑通这 7 步之后，再看下一周做什么。**不要一次写完所有 feature**。

---

## Appendix A: Prompt 模板示例

### A.1 Task Generator

```
你是 {{project.name}} 项目的 AI 项目经理。

## 项目背景
{{project.vision}}
当前阶段: {{project.current_stage}}

## 团队成员
{{#each users}}
- {{name}} ({{role}}): 擅长 {{skills}}, 工作风格 {{work_style}}
{{/each}}

## 活跃 tasks
{{#each active_tasks}}
- [{{status}}] {{title}} (owner: {{owner}}, est: {{estimated_hours}}h)
{{/each}}

## 最近的决策
{{#each recent_decisions}}
- {{decided_at}}: {{decision}} (why: {{reasoning}})
{{/each}}

## 用户输入
{{user_brainstorm}}

## 支持文档
{{#each artifacts}}
### {{title}}
{{content_excerpt}}
{{/each}}

## 你的任务
基于以上信息，生成 5-15 个 task。要求：

1. 每个 task 必须考虑当前项目阶段（{{project.current_stage}}）
2. 标注每个 task 是 critical_path 还是 nice_to_have
3. 识别 task 之间的依赖关系
4. 如果某个 task 可以由具体的 team member 做，标注 suggested_owner
5. 给出 reasoning：为什么是这些 task、为什么这个顺序

输出格式: JSON
{
  "tasks": [
    {
      "title": "...",
      "description": "...",
      "estimated_hours": 4,
      "is_critical_path": true,
      "stage_alignment": "necessary" | "nice_to_have",
      "suggested_owner": "...",
      "dependencies": ["task_index_1", "task_index_2"],
      "reasoning": "..."
    }
  ],
  "overall_reasoning": "..."
}
```

### A.2 Cross-task Info Discovery

```
你是 AI 项目经理。一个 task 刚刚完成，请评估它的产出对其他活跃 task 是否有用。

## 刚完成的 task
Title: {{completed_task.title}}
产出:
{{completed_task.artifacts}}

## 候选活跃 tasks (top-K by embedding similarity)
{{#each candidate_tasks}}
{{index}}. {{title}} - {{description}} (owner: {{owner}})
{{/each}}

## 你的任务
对每个候选 task，判断刚完成 task 的产出是否真的对它有用。
- 如果有用：用一句话说明怎么用、推送给谁
- 如果无用（只是 embedding 相似但实际无关）：忽略

输出 JSON:
{
  "useful_findings": [
    {
      "for_task_index": 0,
      "for_task_owner": "...",
      "how_to_use": "..."
    }
  ]
}
```

---

## Appendix B: 给 Claude Code 的指令

把这份 PRD 放在 repo 根目录，跟 Claude Code 说：

> 读 PRD.md。我们要按 Phase 0 和 Phase 1 的顺序实现。先做第 13 节的 7 步。每完成一步告诉我，我 review 后再做下一步。不要一次写完所有代码。
>
> 技术决定遵循 PRD 第 8 节。LLM 用 Kimi（moonshot-v1-128k），我已经有 API key。
>
> Schema 严格按第 5 节执行，不要自己加字段或改命名。如果觉得 schema 有问题，先告诉我再改。
>
> 每次写代码之前，先告诉我你打算怎么做，我 ok 你再写。

---

**文档维护**：这是 living doc。每周根据真实使用更新。版本历史在 git 里看。
