import { expect, it, vi } from "vitest";
import { readDecision, submitDecision, validateDecision } from "../decisions";
import { assistantService } from "../service";
import { getPostgresPool } from "../../../infrastructure/postgres";
import { assistantClarificationSchema } from "@ontomato/contracts/assistant-clarification";
vi.mock("../service", () => ({ assistantService: { artifact: vi.fn(), content: vi.fn(), start: vi.fn(), retrievalClient: vi.fn(), readRun: vi.fn() } }));
vi.mock("../../../infrastructure/postgres", () => ({ getPostgresPool: vi.fn(), qualifiedTable: (name: string) => name }));
const card = assistantClarificationSchema.parse({ schema: "ontomato.clarification.v1", title: "Scope", questions: [{ id: "scope", label: "Scope", kind: "single", options: [{ value: "active", label: "Active" }] }] });
it("allows incomplete drafts but requires a known explicit choice on submission", () => {
  expect(() => validateDecision(card, { values: {}, notes: "" }, false)).not.toThrow();
  expect(() => validateDecision(card, { values: {}, notes: "" }, true)).toThrow();
  expect(() => validateDecision(card, { values: { scope: "invented" }, notes: "" }, true)).toThrow();
  expect(() => validateDecision(card, { values: { scope: ["active"] }, notes: "" }, true)).toThrow();
  expect(() => validateDecision(card, { values: { scope: "active" }, notes: "" }, true)).not.toThrow();
  const textCard = assistantClarificationSchema.parse({ ...card, questions: [{ id: "text", label: "Reason", kind: "text" }] });
  expect(() => validateDecision(textCard, { values: { text: "   " }, notes: "" }, true)).toThrow();
});

it("locks an outdated card without discarding its draft", async () => {
  const retrieval = { id: "11111111-1111-4111-8111-111111111111", runId: "22222222-2222-4222-8222-222222222222", decisionRevision: 3 };
  vi.mocked(assistantService.artifact).mockResolvedValue({ size: 50, path: "outputs/scope.clarification.json", runId: "source" } as never);
  vi.mocked(assistantService.content).mockResolvedValue(Buffer.from(JSON.stringify({ ...card, retrieval })));
  vi.mocked(getPostgresPool).mockReturnValue({ query: async () => ({ rows: [{ values: { scope: "active" }, notes: "Keep this", continuation_run_id: null, admitted: false }] }) } as never);
  vi.mocked(assistantService.retrievalClient).mockResolvedValue({
    links: async () => [{ retrievalId: retrieval.id, runId: "new-run" }],
    readSnapshot: async () => ({ decisionRevision: 4 }),
  } as never);
  const state = await readDecision("session", "artifact", { domainId: "domain", userId: "user" });
  expect(state).toMatchObject({ locked: true, continuation: "stale", values: { scope: "active" }, notes: "Keep this" });
});

it("verifies acceptance only through a linked run of the same retrieval and the next revision", async () => {
  const retrieval = { id: "11111111-1111-4111-8111-111111111111", runId: "22222222-2222-4222-8222-222222222222", decisionRevision: 3 };
  vi.mocked(assistantService.artifact).mockResolvedValue({ size: 50, path: "outputs/scope.clarification.json", runId: "source" } as never);
  vi.mocked(assistantService.content).mockResolvedValue(Buffer.from(JSON.stringify({ ...card, retrieval })));
  vi.mocked(getPostgresPool).mockReturnValue({ query: async () => ({ rows: [{ values: { scope: "active" }, notes: "", continuation_run_id: "continuation", admitted: true }] }) } as never);
  const links = vi.fn().mockResolvedValue([]);
  const readSnapshot = vi.fn().mockResolvedValue({ decisionRevision: 4 });
  vi.mocked(assistantService.retrievalClient).mockResolvedValue({ links, readSnapshot } as never);
  vi.mocked(assistantService.readRun).mockResolvedValue({ run: { status: "stopped" } } as never);
  const owner = { domainId: "domain", userId: "user" };
  expect((await readDecision("session", "artifact", owner)).continuation).toBe("needs_attention");
  links.mockResolvedValue([{ retrievalId: retrieval.id, runId: "new-run" }]);
  expect((await readDecision("session", "artifact", owner)).continuation).toBe("accepted");
  readSnapshot.mockRejectedValue(new Error("offline"));
  expect((await readDecision("session", "artifact", owner)).continuation).toBe("unavailable");
});

it("retries a lost admission using the saved run ID and never mutates an admitted decision", async () => {
  vi.mocked(assistantService.artifact).mockResolvedValue({ size: 50, path: "outputs/scope.clarification.json", runId: "source" } as never);
  vi.mocked(assistantService.content).mockResolvedValue(Buffer.from(JSON.stringify(card)));
  let row: Record<string, unknown> = { values: {}, notes: "", continuation_run_id: null, admitted: false };
  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.startsWith("SELECT")) return { rows: [row] };
    if (sql.includes('SET "values"')) row = { values: JSON.parse(String(args[1])), notes: args[2], continuation_run_id: args[3], message: args[4], admitted: false };
    if (sql.includes("SET admitted=true")) row.admitted = true;
    return { rows: [row] };
  });
  vi.mocked(getPostgresPool).mockReturnValue({ query, connect: async () => ({ query, release() {} }) } as never);
  vi.mocked(assistantService.start).mockRejectedValueOnce(new Error("Response lost")).mockResolvedValue({} as never);
  const owner = { domainId: "domain", userId: "user" }, input = { values: { scope: "active" }, notes: "My choice" };
  await expect(submitDecision("session", "artifact", owner, {}, input)).rejects.toThrow("Response lost");
  await submitDecision("session", "artifact", owner, {}, input);
  expect(vi.mocked(assistantService.start).mock.calls[0]![1]).toBe(vi.mocked(assistantService.start).mock.calls[1]![1]);
  const replay = await submitDecision("session", "artifact", owner, {}, { ...input, notes: "Changed" });
  expect(replay.notes).toBe("My choice");
  expect(replay.status).toBe("submitted");
  expect(assistantService.start).toHaveBeenCalledTimes(2);
});
