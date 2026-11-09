import { expect, it, vi } from "vitest";
import { submitDecision, validateDecision } from "../decisions";
import { assistantService } from "../service";
import { getPostgresPool } from "../../../infrastructure/postgres";
import { assistantClarificationSchema } from "@ontomato/contracts/assistant-clarification";
vi.mock("../service", () => ({ assistantService: { artifact: vi.fn(), content: vi.fn(), start: vi.fn() } }));
vi.mock("../../../infrastructure/postgres", () => ({ getPostgresPool: vi.fn(), qualifiedTable: (name: string) => name }));
const card = assistantClarificationSchema.parse({ schema: "ontomato.clarification.v1", title: "Scope", questions: [{ id: "scope", label: "Scope", kind: "single", options: [{ value: "active", label: "Active" }] }] });
it("allows incomplete drafts but requires a known explicit choice on submission", () => {
  expect(() => validateDecision(card, { values: {}, notes: "" }, false)).not.toThrow();
  expect(() => validateDecision(card, { values: {}, notes: "" }, true)).toThrow();
  expect(() => validateDecision(card, { values: { scope: "invented" }, notes: "" }, true)).toThrow();
  expect(() => validateDecision(card, { values: { scope: ["active"] }, notes: "" }, true)).toThrow();
  expect(() => validateDecision(card, { values: { scope: "active" }, notes: "" }, true)).not.toThrow();
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
