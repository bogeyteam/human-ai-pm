import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-browser", () => ({
  supabaseBrowser: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "test-token" } },
      }),
    },
  }),
}));

// Imported after the mock so api.ts uses the stub.
import { api, generateTasks, runOptimizer } from "@/lib/api";

type FetchInit = RequestInit | undefined;
type FetchCall = [string, FetchInit];

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("api helpers", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("generateTasks POSTs to the generate_tasks endpoint with bearer + JSON body", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        manager_action_id: "ma-1",
        proposals: [],
        overall_reasoning: null,
      }),
    );

    const res = await generateTasks("proj-123", {
      brainstorm: "ship the thing",
      artifact_ids: ["a1", "a2"],
    });

    expect(res.manager_action_id).toBe("ma-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toMatch(/\/api\/projects\/proj-123\/generate_tasks$/);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      brainstorm: "ship the thing",
      artifact_ids: ["a1", "a2"],
    });

    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-token");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("runOptimizer POSTs to the optimizer endpoint with an empty JSON body", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        manager_action_id: "ma-2",
        review: {
          risks: [],
          reorder: [],
          drops: [],
          adds: [],
          critical_path: [],
          unknowns: [],
          overall_reasoning: null,
        },
      }),
    );

    const res = await runOptimizer("proj-xyz");

    expect(res.manager_action_id).toBe("ma-2");
    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toMatch(/\/api\/projects\/proj-xyz\/optimizer\/run$/);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe("{}");
  });

  it("api() throws a status-line message when the error body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("server fell over", {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    // Raw body is logged, not surfaced to the user.
    await expect(api("/api/anything")).rejects.toThrow(
      /Internal Server Error \(500\)/,
    );
  });

  it("api() surfaces the FastAPI `detail` string instead of the raw body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Project not found." }), {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(api("/api/anything")).rejects.toThrow(/^Project not found\.$/);
  });

  it("api() joins Pydantic validation error messages", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ detail: [{ msg: "field required", loc: ["body", "brainstorm"] }] }),
        { status: 422, statusText: "Unprocessable Entity" },
      ),
    );

    await expect(api("/api/anything")).rejects.toThrow(/field required/);
  });
});
