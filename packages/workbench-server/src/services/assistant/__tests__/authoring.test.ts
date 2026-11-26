import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { installContentLayout } from "../../../content/layout";
import { APP_BUILDER_SKILL } from "../../app-builder/definition";
installContentLayout({ runtimeRoot: fs.mkdtempSync(path.join(os.tmpdir(), "authoring-runtime-")), prompts: [], publicSkillsRoot: fs.mkdtempSync(path.join(os.tmpdir(), "authoring-public-")), runtimeResources: [] });
const { adoptAppBuilderDefinition, executeAuthoring } = await import("../authoring");

const mocks = vi.hoisted(() => ({
  ownedRun: vi.fn(),
  post: vi.fn(),
}));

vi.mock("../execution", () => ({ ownedRun: mocks.ownedRun }));
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://ontology.test" } } }));
vi.mock("../../../config/environment", () => ({ environment: { agentRuntime: () => ({ queryServiceToken: "workbench" }) } }));
vi.mock("../../../config/query-settings", () => ({ getQueryTimeoutMs: () => 900_000 }));
vi.mock("../../../utils/backend-client", () => ({ backendPost: mocks.post, buildBackendHeaders: () => ({}) }));

const owner = { domainId: "domain", userId: "initiator" };
const credentials = { token: "initiator-token" };
const runId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const input = { executionId: "33333333-3333-4333-8333-333333333333" };
const otherSkill = { namespace: { kind: "provider" as const, provider: "workbench" }, name: "assistant-report" };

function loaded(skill = APP_BUILDER_SKILL) {
  mocks.ownedRun.mockResolvedValue({
    turn: { session_id: sessionId, admitted: true, settled: false, created_at: new Date(), class_names: [] },
    run: {
      sessionId,
      status: "running",
      executionUserId: null,
      channel: { agent: { providerId: "workbench", agentId: "agent" }, authority: { executionKind: "live" } },
      resolvedSkills: [{ skill, digest: "a".repeat(64) }],
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.post.mockResolvedValue({ text: '{"result":"tested"}' });
});

it("requires the App Builder skill itself for an authoring evidence read", async () => {
  loaded(otherSkill);
  await expect(executeAuthoring(owner, credentials, runId, "action", "read-test", input))
    .rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  expect(mocks.post).not.toHaveBeenCalled();

  loaded();
  await expect(executeAuthoring(owner, credentials, runId, "action", "read-test", input)).resolves.toEqual({ result: "tested" });
  expect(mocks.post).toHaveBeenCalledOnce();
  expect(mocks.post.mock.calls[0][1]).toBe("http://ontology.test/ontology/ai/generation/platform/action/read-test");
  expect(mocks.post.mock.calls[0][2]).toMatchObject({
    run: expect.objectContaining({ hostId: "workbench", sessionId, runId, domainId: owner.domainId, ownerId: owner.userId }),
    input,
  });
});

it("keeps direct adoption tied to the App Builder skill", async () => {
  const definition = { name: "Current authored definition" };
  loaded(otherSkill);
  await expect(adoptAppBuilderDefinition(owner, credentials, runId, "action", definition))
    .rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  expect(mocks.post).not.toHaveBeenCalled();

  loaded();
  const accepted = { definition, executionId: input.executionId, digest: "b".repeat(64) };
  mocks.post.mockResolvedValue({ text: JSON.stringify(accepted) });
  await expect(adoptAppBuilderDefinition(owner, credentials, runId, "action", definition)).resolves.toEqual(accepted);
});
