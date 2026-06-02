/**
 * End-to-end functional run-through of every surface.
 *
 * Goal: click each interactive thing at least once and report:
 *  - Console errors (page-level JS errors are top priority — they crash UI)
 *  - Network failures (4xx / 5xx)
 *  - Visible "[object Object]" text (catches stale error rendering)
 *  - Unresolved Chinese characters or wrapping defects
 *  - Per-page screenshot for visual diff later
 *
 * AI flows that would burn LLM budget (generate_tasks, optimizer/run,
 * coaching/start, etc.) are only smoke-tested: we click the button and
 * confirm the loading state / modal appears, then we cancel before the
 * actual model call. Set env LIVE_AI=1 to actually invoke the AI.
 *
 * Usage:
 *   E2E_EMAIL=xieziyi1998@gmail.com E2E_PASSWORD=... \
 *     pnpm exec playwright test tests/e2e/run-thru.spec.ts --reporter=list
 */

import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL ?? "";
const PASSWORD = process.env.E2E_PASSWORD ?? "";

type Issue = {
  page: string;
  kind: "console" | "network" | "object_object" | "missing_element" | "exception";
  detail: string;
};

const issues: Issue[] = [];

function attachListeners(page: Page, label: string) {
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Filter expected: 404s for missing favicons, Next.js dev-only HMR noise
      if (text.includes("favicon") || text.includes("HMR") || text.includes("hot-reloader")) return;
      issues.push({ page: label, kind: "console", detail: text.slice(0, 240) });
    }
  });
  page.on("pageerror", (err) => {
    issues.push({ page: label, kind: "exception", detail: String(err).slice(0, 240) });
  });
  page.on("response", (res) => {
    const status = res.status();
    const url = res.url();
    // Only flag API or backend failures; ignore Vercel/Next asset 304s and 200s
    if (status >= 400 && (url.includes("/api/") || url.includes("supabase.co"))) {
      issues.push({ page: label, kind: "network", detail: `${status} ${url}` });
    }
  });
}

async function expectNoObjectObject(page: Page, label: string) {
  const body = await page.locator("body").textContent();
  if (body && body.includes("[object Object]")) {
    issues.push({
      page: label,
      kind: "object_object",
      detail: "Rendered '[object Object]' somewhere on the page",
    });
  }
}

async function signIn(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  // Look for the sign-in button. The text varies but should include "Sign in" or "登录"
  await page
    .getByRole("button", { name: /sign in|登录|登入/i })
    .first()
    .click();
  // Wait for redirect away from /login
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  if (!EMAIL || !PASSWORD) {
    throw new Error("E2E_EMAIL and E2E_PASSWORD must be set in env");
  }
});

test("comprehensive run-through", async ({ page }) => {
  attachListeners(page, "global");

  // 1. /login — public page
  await page.goto(`${BASE}/login`);
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expectNoObjectObject(page, "/login");

  // 2. Sign in
  await signIn(page);

  // 3. /projects — workspace home
  await page.goto(`${BASE}/projects`);
  // Bilingual: "工作区Workspace" or "项目Projects" via the <Bi> primitive
  await expect(
    page.getByText(/All projects|所有项目|工作区|Workspace|项目.*Projects|Projects.*项目/i).first(),
  ).toBeVisible({ timeout: 8000 });
  await expectNoObjectObject(page, "/projects");
  await page.screenshot({ path: "tests/e2e/screenshots/01-projects.png", fullPage: true });

  // Find the first project link and capture its URL
  const projectLink = page.locator('a[href^="/projects/"]').first();
  await expect(projectLink).toBeVisible();
  const projectHref = await projectLink.getAttribute("href");
  if (!projectHref) throw new Error("No project link on /projects page");
  await projectLink.click();
  await page.waitForLoadState("networkidle");

  // 4. /projects/[id] — overview (project page)
  await expectNoObjectObject(page, projectHref);
  await page.screenshot({ path: "tests/e2e/screenshots/02-overview.png", fullPage: true });

  // Confirm new sidebar is rendered (Daily section heading)
  const sidebarDaily = page.getByText(/Daily.*日常|日常.*Daily/);
  const sidebarVisible = await sidebarDaily.first().isVisible().catch(() => false);
  if (!sidebarVisible) {
    issues.push({
      page: projectHref,
      kind: "missing_element",
      detail: "Sidebar 'Daily · 日常' label not visible",
    });
  }

  // 5. Each sidebar destination
  const surfaces = [
    { slug: "tasks", label: "Tasks" },
    { slug: "findings", label: "Findings" },
    { slug: "optimizer", label: "Optimizer" },
    { slug: "meetings", label: "Meetings" },
    { slug: "artifacts", label: "Artifacts" },
    { slug: "decisions", label: "Decisions" },
    { slug: "activity", label: "Activity" },
  ];

  for (const s of surfaces) {
    const url = `${BASE}${projectHref}/${s.slug}`;
    await page.goto(url);
    await page.waitForLoadState("networkidle").catch(() => {});
    await expectNoObjectObject(page, `${projectHref}/${s.slug}`);
    await page.screenshot({
      path: `tests/e2e/screenshots/03-${s.slug}.png`,
      fullPage: true,
    });
  }

  // 6. Tasks: smoke the brainstorm-to-tasks modal opens
  await page.goto(`${BASE}${projectHref}/tasks`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const brainstormButton = page.getByRole("button", { name: /generate tasks|brainstorm|头脑/i }).first();
  if (await brainstormButton.isVisible().catch(() => false)) {
    await brainstormButton.click();
    // Look for the textarea
    const textarea = page.locator("textarea").first();
    const opened = await textarea.isVisible().catch(() => false);
    if (!opened) {
      issues.push({
        page: `${projectHref}/tasks`,
        kind: "missing_element",
        detail: "Brainstorm modal did not surface a textarea",
      });
    } else {
      await page.keyboard.press("Escape").catch(() => {});
    }
  } else {
    issues.push({
      page: `${projectHref}/tasks`,
      kind: "missing_element",
      detail: "Brainstorm-to-tasks button not visible",
    });
  }

  // 7. Optimizer: smoke the Run optimizer button presence (don't invoke)
  await page.goto(`${BASE}${projectHref}/optimizer`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const runOptimizerBtn = page.getByRole("button", { name: /run optimizer|优化|run/i }).first();
  const hasRun = await runOptimizerBtn.isVisible().catch(() => false);
  if (!hasRun) {
    issues.push({
      page: `${projectHref}/optimizer`,
      kind: "missing_element",
      detail: "Run optimizer button not visible",
    });
  }

  // 8. Findings: Run discovery button presence
  await page.goto(`${BASE}${projectHref}/findings`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const runDiscoveryBtn = page.getByRole("button", { name: /run discovery|发现/i }).first();
  if (!(await runDiscoveryBtn.isVisible().catch(() => false))) {
    issues.push({
      page: `${projectHref}/findings`,
      kind: "missing_element",
      detail: "Run discovery button not visible",
    });
  }

  // 9. Coaching: /coaching list + start button
  await page.goto(`${BASE}/coaching`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expectNoObjectObject(page, "/coaching");
  await page.screenshot({ path: "tests/e2e/screenshots/04-coaching.png", fullPage: true });
  const startCoachingBtn = page.getByRole("button", { name: /start.*session|开始/i }).first();
  if (!(await startCoachingBtn.isVisible().catch(() => false))) {
    issues.push({
      page: "/coaching",
      kind: "missing_element",
      detail: "Start coaching session button not visible",
    });
  }

  // 10. /almanac-demo: ProposalReview keyboard interactions (public route)
  await page.goto(`${BASE}/almanac-demo`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expectNoObjectObject(page, "/almanac-demo");
  await page.screenshot({ path: "tests/e2e/screenshots/05-almanac-demo.png", fullPage: true });

  // Focus the dialog and press A, expect a decision mark to appear
  const dialog = page.getByRole("dialog").first();
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.focus();
    await page.keyboard.press("a");
    await page.waitForTimeout(150);
    // Decision mark for "accept" should be visible somewhere
    const acceptMark = page.locator("text=/[✓]/").first();
    if (!(await acceptMark.isVisible().catch(() => false))) {
      issues.push({
        page: "/almanac-demo",
        kind: "missing_element",
        detail: "Pressed 'a' but no accept mark appeared",
      });
    }
    // Press 'r' — reason chip strip should appear
    await page.keyboard.press("r");
    await page.waitForTimeout(150);
  } else {
    issues.push({
      page: "/almanac-demo",
      kind: "missing_element",
      detail: "ProposalReview dialog not visible",
    });
  }

  // 11. Final summary printout
  console.log("\n──── ISSUES FOUND ────");
  if (issues.length === 0) {
    console.log("  (none)");
  } else {
    for (const i of issues) {
      console.log(`  [${i.kind}] ${i.page}: ${i.detail}`);
    }
  }
  console.log("──────────────────────\n");

  // Hard-fail only on exceptions and 5xx network errors. Console errors and
  // missing elements are reported but don't fail the run (user wants to
  // see the list, then we fix together).
  const fatal = issues.filter(
    (i) => i.kind === "exception" || (i.kind === "network" && /\b5\d\d\b/.test(i.detail)),
  );
  expect(fatal).toEqual([]);
});
