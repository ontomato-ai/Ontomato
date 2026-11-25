import { expect, it, vi } from "vitest";
import { agentChannelService } from "../channel";
import { assistantService } from "../../assistant/service";
import { assistantStore } from "../../assistant/store";
import { RuntimeClient } from "../../../infrastructure/agent-runtime/client";
import { OntologyRetrievalClient } from "../../assistant/ontology-retrieval";
import { restoreAgentCaller } from "../caller";

vi.mock("../../../core/skills/registry/manager", () => ({ skillRegistryManager: {} }));
vi.mock("../caller", () => ({ restoreAgentCaller: vi.fn() }));
vi.mock("../../assistant/service", () => ({
  assistantService: { ownRun: vi.fn(), admitAgent: vi.fn() },
}));
vi.mock("../../product-governance/grants", () => ({ requireProductGrant: vi.fn() }));
vi.mock("../../assistant/store", () => ({
  assistantStore: { turn: vi.fn(), session: vi.fn() },
}));

it("excludes queued unclaimed unattended messages when updating retrieval user quotes on steer prepare", async () => {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const runId = "22222222-2222-4222-8222-222222222222";
  const openingId = "33333333-3333-4333-8333-333333333333";
  const queuedUnattendedId = "44444444-4444-4444-8444-444444444444";
  const steerInputId = "55555555-5555-4555-8555-555555555555";
  const actorId = "66666666-6666-4666-8666-666666666666";
  const owner = { domainId: "domain-a", userId: "user-1" };

  vi.mocked(restoreAgentCaller).mockResolvedValue({
    owner,
    credentials: { token: "tok" },
    expiresAt: Date.now() + 60_000,
  });
  vi.mocked(assistantService.ownRun).mockResolvedValue(undefined as never);
  vi.mocked(assistantStore.session).mockResolvedValue({ agent_id: "analyst" } as Awaited<ReturnType<typeof assistantStore.session>>);
  vi.mocked(assistantStore.turn).mockResolvedValue({
    id: runId,
    session_id: sessionId,
    retrieval_scope_id: "77777777-7777-4777-8777-777777777777",
  } as Awaited<ReturnType<typeof assistantStore.turn>>);
  vi.spyOn(RuntimeClient.prototype, "status").mockResolvedValue({
    id: runId,
    sessionId,
    status: "running",
    stopReason: null,
    errorMessage: null,
    answerMessageId: null,
    workspaceCommit: null,
    createdAt: "2026-11-24T05:00:00.000Z",
    finishedAt: null,
    resolvedSkills: [{ skill: { namespace: { kind: "provider", provider: "ontology" }, name: "ontomato-analyst-assistant" }, digest: "d1", description: "Ontology retrieval" }],
  });
  vi.spyOn(RuntimeClient.prototype, "session").mockResolvedValue({
    session: {
      id: sessionId,
      domainId: owner.domainId,
      workspaceId: null,
      activeRunId: runId,
      latestRunId: runId,
      createdAt: "2026-11-24T05:00:00.000Z",
      updatedAt: "2026-11-24T05:00:00.000Z",
    },
    messages: [
      { id: openingId, runId, messageSeq: 1, contextSeq: 1, message: { role: "user", content: "Human opening question", timestamp: 1 } },
      { id: queuedUnattendedId, runId: null, messageSeq: 2, contextSeq: null, message: { role: "user", content: "Queued unattended MCP question", timestamp: 2 } },
      { id: steerInputId, runId: null, messageSeq: 3, contextSeq: null, message: { role: "user", content: "Human clarification", timestamp: 3 } },
    ],
    pendingQuestions: [],
    latestRun: null,
  });
  const updateUserQuotes = vi.spyOn(OntologyRetrievalClient.prototype, "updateUserQuotes").mockResolvedValue();

  await expect(
    agentChannelService.prepare(
      {
        mode: "steer",
        executionActor: null,
        language: "en",
        agent: { providerId: "workbench", agentId: "analyst" },
        sessionId,
        runId,
        actor: { id: actorId, domainId: owner.domainId },
        inputId: steerInputId,
        input: { role: "user", content: "Human clarification", timestamp: 3 },
        authority: { classNames: ["Orders"], executionKind: "live" },
        requestedBy: null,
        root: { session: { providerId: "workbench", sessionId }, runId },
        userRecipient: { session: { providerId: "workbench", sessionId }, actor: { id: actorId, domainId: owner.domainId } },
      },
      owner.domainId,
      { token: "tok" },
    ),
  ).resolves.toEqual({ accepted: true });

  expect(updateUserQuotes).toHaveBeenCalledWith(
    ["Human opening question", "Human clarification"],
    { token: "tok", locale: "en" },
  );
});
