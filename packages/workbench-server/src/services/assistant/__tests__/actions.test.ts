import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantActionOption } from "@ontomato/contracts/assistant-actions";
import { actionCatalogue, confirmAction, validateActionParameters } from "../actions";
import { assistantService } from "../service";
import { getPostgresPool } from "../../../infrastructure/postgres";

vi.mock("../../../infrastructure/postgres", () => ({ getPostgresPool: vi.fn(), qualifiedTable: (name: string) => name }));
vi.mock("../../../utils/backend-client", () => ({
  backendPost: vi.fn(async () => ({ text: JSON.stringify({ success: true, data: [{
    id: "action", name: "Update", status: "PUBLISHED", domainId: "domain", modifyTimestamp: 1,
    function: { parameters: [{ name: "value", type: "TYPE_STRING" }] },
  }] }) })),
  buildBackendHeaders: () => ({ "Content-Type": "application/json", tk: "verified" }),
  checkBackendResponse: async (response: Response) => { if (!response.ok) throw new Error("upstream failed"); },
}));
vi.mock("../../../config/data-query-api", () => ({ getApiConfig: () => ({}), buildUrl: (_config: unknown, path: string) => `http://ontology.test${path}` }));
vi.mock("../service", () => ({ assistantService: { artifact: vi.fn(), content: vi.fn(), readRun: vi.fn() } }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const owner = { domainId: "domain", userId: "user" };
const action: AssistantActionOption = { id: "a", name: "Update", description: "", version: "v", effects: [], parameters: [
  { name: "value", type: "TYPE_NUMBER", description: "", required: true },
] };

describe("confirmed business actions", () => {
  it("validates parameter types without silently converting identities or accepting extra inputs", () => {
    expect(() => validateActionParameters(action, { value: 2 })).not.toThrow();
    expect(() => validateActionParameters(action, { value: "2" })).toThrow();
    expect(() => validateActionParameters(action, { value: 2, extra: true })).toThrow();
    expect(() => validateActionParameters(action, {})).toThrow();
  });

  it("never replays an upstream write after its response was lost", async () => {
    const catalogue = await actionCatalogue(owner, {});
    vi.mocked(assistantService.artifact).mockResolvedValue({ path: "outputs/update.action.json", size: 20, runId: "run" } as never);
    vi.mocked(assistantService.content).mockResolvedValue(Buffer.from(JSON.stringify({ schema: "ontomato.action-proposal.v1", actionId: "action", version: catalogue[0]!.version, reason: "Update the record", parameters: { value: "new" } })));
    vi.mocked(assistantService.readRun).mockResolvedValue({ run: { status: "stopped" } } as never);
    let record: Record<string, unknown> | null = null;
    const query = vi.fn(async (sql: string, args: unknown[]) => {
      if (sql.startsWith("SELECT")) return { rows: record ? [record] : [] };
      if (sql.startsWith("INSERT")) { record = { status: "executing", parameters: { value: "new" }, result: null, error: null }; return { rowCount: 1 }; }
      if (sql.startsWith("UPDATE")) record = { ...record, status: args[1], error: args[3] };
      return { rows: [] };
    });
    vi.mocked(getPostgresPool).mockReturnValue({ query } as never);
    const upstream = vi.fn().mockRejectedValue(new Error("Connection lost"));
    vi.stubGlobal("fetch", upstream);
    expect((await confirmAction("session", "artifact", owner, {}, { value: "new" }))?.status).toBe("unknown");
    expect((await confirmAction("session", "artifact", owner, {}, { value: "new" }))?.status).toBe("unknown");
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("rejects changed Action versions before claiming or executing a write", async () => {
    vi.mocked(assistantService.artifact).mockResolvedValue({ path: "outputs/update.action.json", size: 20 } as never);
    vi.mocked(assistantService.content).mockResolvedValue(Buffer.from(JSON.stringify({ schema: "ontomato.action-proposal.v1", actionId: "action", version: "old", reason: "Update", parameters: { value: "new" } })));
    vi.mocked(getPostgresPool).mockReturnValue({ query: async () => ({ rows: [] }) } as never);
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    await expect(confirmAction("session", "artifact", owner, {}, { value: "new" })).rejects.toMatchObject({ code: "ACTION_CHANGED" });
    expect(upstream).not.toHaveBeenCalled();
  });
});
