import { beforeEach, expect, it, vi } from "vitest";
import { assistantService } from "../service";
import { assistantStore } from "../store";
import { RuntimeClient } from "../../../infrastructure/agent-runtime/client";
import { OntologyRetrievalClient } from "../ontology-retrieval";
import { getPostgresPool } from "../../../infrastructure/postgres";
import { HttpError } from "../../../utils/errors";

vi.mock("../../../core/skills/registry/manager", () => ({ skillRegistryManager: {} }));
vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: vi.fn(),
  qualifiedTable: (name: string) => name,
}));

const sessionId = "11111111-1111-4111-8111-111111111111";
const owner = { domainId: "domain-a", userId: "user-1" };

beforeEach(() => {
  vi.restoreAllMocks();
});

it("rejects deleting a session with a preparing runtime turn before touching ontology retrieval scopes or workbench rows", async () => {
  const query = vi.fn();
  vi.mocked(getPostgresPool).mockReturnValue({ query } as unknown as ReturnType<typeof getPostgresPool>);
  vi.spyOn(assistantStore, "session").mockResolvedValue({
    id: sessionId,
    agent_id: "analyst",
    title: "Session",
    workspace_id: null,
  } as Awaited<ReturnType<typeof assistantStore.session>>);
  vi.spyOn(RuntimeClient.prototype, "session").mockResolvedValue({
    session: {
      id: sessionId,
      domainId: owner.domainId,
      workspaceId: null,
      activeRunId: null,
      latestRunId: null,
      createdAt: "2026-11-24T05:00:00.000Z",
      updatedAt: "2026-11-24T05:00:00.000Z",
    },
    messages: [],
    pendingQuestions: [],
    latestRun: null,
  });
  vi.spyOn(RuntimeClient.prototype, "deleteSession").mockRejectedValue(
    new HttpError(409, "Cancel the active run before deleting the session", "SESSION_BUSY"),
  );
  const closeScope = vi.spyOn(OntologyRetrievalClient.prototype, "closeScope").mockResolvedValue();

  await expect(assistantService.delete(sessionId, owner, {})).rejects.toMatchObject({
    status: 409,
    code: "SESSION_BUSY",
  });
  expect(closeScope).not.toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
});

it("has the runtime refuse a preview's deletion of a conversation holding a live run, before any retrieval or row is touched", async () => {
  const query = vi.fn();
  vi.mocked(getPostgresPool).mockReturnValue({ query } as unknown as ReturnType<typeof getPostgresPool>);
  vi.spyOn(assistantStore, "session").mockResolvedValue({ id: sessionId } as Awaited<ReturnType<typeof assistantStore.session>>);
  vi.spyOn(RuntimeClient.prototype, "session").mockResolvedValue({
    session: { id: sessionId, domainId: owner.domainId, workspaceId: null, activeRunId: null, latestRunId: null,
      createdAt: "2026-11-24T05:00:00.000Z", updatedAt: "2026-11-24T05:00:00.000Z" },
    messages: [], pendingQuestions: [], latestRun: null,
  });
  const remove = vi.spyOn(RuntimeClient.prototype, "deleteSession").mockRejectedValue(
    new HttpError(422, "预览里不执行写操作，动作的对错用动作试跑验", "PREVIEW_WRITE_FORBIDDEN"));
  const closeScope = vi.spyOn(OntologyRetrievalClient.prototype, "closeScope");
  await expect(assistantService.delete(sessionId, owner, { executionKind: "preview" })).rejects.toMatchObject({
    status: 422, code: "PREVIEW_WRITE_FORBIDDEN",
  });
  expect(remove).toHaveBeenCalledWith(sessionId, true);
  expect(closeScope).not.toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
  // A live owner's deletion asks the runtime for no such check.
  remove.mockResolvedValue();
  query.mockResolvedValue({ rows: [] });
  vi.spyOn(assistantStore, "session").mockResolvedValue({ id: sessionId } as Awaited<ReturnType<typeof assistantStore.session>>);
  await assistantService.delete(sessionId, owner, {}).catch(() => undefined);
  expect(remove).toHaveBeenLastCalledWith(sessionId, false);
});
