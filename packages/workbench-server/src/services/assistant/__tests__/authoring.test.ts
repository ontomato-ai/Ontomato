import { beforeEach, expect, it, vi } from "vitest";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { APP_BUILDER_SKILL } from "../../app-builder/definition";
import { adoptAppBuilderDefinition, executeAuthoring } from "../authoring";

const mocks = vi.hoisted(() => ({
  ownedRun: vi.fn(),
  readView: vi.fn(),
  resolveSource: vi.fn(),
  post: vi.fn(),
}));

vi.mock("../execution", () => ({ ownedRun: mocks.ownedRun }));
vi.mock("../../../core/skills/registry/manager", () => ({ skillRegistryManager: {} }));
vi.mock("../../skills/skill-manager", () => ({ skillManager: {} }));
vi.mock("../skills", async original => ({
  ...await original<typeof import("../skills")>(),
  readAssistantSkillView: mocks.readView,
  resolvePageSkillSource: mocks.resolveSource,
}));
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://ontology.test" } } }));
vi.mock("../../../config/environment", () => ({ environment: { agentRuntime: () => ({ queryServiceToken: "workbench" }) } }));
vi.mock("../../../config/query-settings", () => ({ getQueryTimeoutMs: () => 900_000 }));
vi.mock("../../../utils/backend-client", () => ({ backendPost: mocks.post, buildBackendHeaders: () => ({}) }));

const owner = { domainId: "domain", userId: "initiator" };
const credentials = { token: "initiator-token" };
const runId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const input = { executionId: "33333333-3333-4333-8333-333333333333" };
const member: RuntimeSkillRef = { namespace: { kind: "domain", domainId: owner.domainId }, name: "author-member" };
const detailMember: RuntimeSkillRef = { ...member, name: "author-detail-member" };
const sibling: RuntimeSkillRef = { ...member, name: "sibling-member" };
const entry = (skill: RuntimeSkillRef) => ({ skill, digest: "a".repeat(64), description: skill.name });
const skillView = { pageSkills: [{ skills: [member, detailMember, sibling] }] };

function loaded(ref: RuntimeSkillRef) {
  mocks.ownedRun.mockResolvedValue({
    turn: { session_id: sessionId, admitted: true, created_at: new Date(), class_names: [] },
    run: {
      sessionId,
      status: "running",
      channel: { agent: { providerId: "workbench", agentId: "agent" }, authority: { executionKind: "live" } },
      resolvedSkills: [entry(ref)],
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readView.mockResolvedValue(skillView);
  mocks.resolveSource.mockResolvedValue(member);
  mocks.post.mockResolvedValue({ text: '{"result":"tested"}' });
});

it.each([
  [
    "action",
    { permissionCode: "action-management", pageKey: "actions" },
    "ontology-actions",
    { permissionCode: "action-management", pageKey: "action-detail" },
    "ontology-action-detail",
  ],
  [
    "metric-view",
    { permissionCode: "ontology-modeling", pageKey: "metric-views" },
    "ontology-metric-views",
    { permissionCode: "ontology-modeling", pageKey: "metric-view-detail" },
    "ontology-metric-view-detail",
  ],
] as const)("requires a registered root author member (catalog or detail) for %s even when its sibling is loaded", async (kind, catalogEntrance, catalogUseId, detailEntrance, detailUseId) => {
  mocks.resolveSource.mockImplementation(async (_view, _entrance, source) => {
    if (source.useId === catalogUseId) return member;
    if (source.useId === detailUseId) return detailMember;
    return null;
  });

  loaded(sibling);
  await expect(executeAuthoring(owner, credentials, runId, kind, "read-test", input)).rejects.toMatchObject({ status: 403 });
  expect(mocks.post).not.toHaveBeenCalled();

  loaded(member);
  await expect(executeAuthoring(owner, credentials, runId, kind, "read-test", input)).resolves.toEqual({ result: "tested" });
  expect(mocks.readView).toHaveBeenCalledWith(owner.domainId, credentials);
  expect(mocks.resolveSource).toHaveBeenLastCalledWith(skillView, catalogEntrance, {
    kind: "application-use", applicationId: "ontology", useId: catalogUseId,
  }, []);

  loaded(detailMember);
  await expect(executeAuthoring(owner, credentials, runId, kind, "read-test", input)).resolves.toEqual({ result: "tested" });
  expect(mocks.resolveSource).toHaveBeenLastCalledWith(skillView, detailEntrance, {
    kind: "application-use", applicationId: "ontology", useId: detailUseId,
  }, []);
});

it("rejects an authoring request when its trusted use is unavailable", async () => {
  loaded(member);
  mocks.resolveSource.mockResolvedValue(null);
  await expect(executeAuthoring(owner, credentials, runId, "metric-view", "read-test", input)).rejects.toMatchObject({ status: 403 });
  expect(mocks.post).not.toHaveBeenCalled();
});

it("keeps direct CLI adoption tied to the App Builder member", async () => {
  const definition = { name: "Current authored definition" };
  loaded(member);
  await expect(adoptAppBuilderDefinition(owner, credentials, runId, "action", definition)).rejects.toMatchObject({ status: 403 });
  expect(mocks.post).not.toHaveBeenCalled();

  loaded(APP_BUILDER_SKILL);
  const accepted = { definition, executionId: input.executionId, digest: "b".repeat(64) };
  mocks.post.mockResolvedValue({ text: JSON.stringify(accepted) });
  await expect(adoptAppBuilderDefinition(owner, credentials, runId, "action", definition)).resolves.toEqual(accepted);
});
