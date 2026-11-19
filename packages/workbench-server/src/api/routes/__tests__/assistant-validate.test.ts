import express, { type NextFunction, type Request, type Response } from "express";
import { createServer, type Server } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { WorkbenchIdentity } from "../../../identity/types";
import { installWorkbenchIdentity } from "../../../identity/installed";
import { BUILD_TEST_HEADER } from "@ontomato/contracts/build-tests";
import { buildTestAccess } from "../../build-test-access";
import { errorHandler } from "../../middleware/error-handler";
import { HttpError } from "../../../utils/errors";

const mocks = vi.hoisted(() => ({ model: vi.fn(), skills: vi.fn(), references: vi.fn(),
  setting: vi.fn(), options: vi.fn(), prepare: vi.fn(), agent: vi.fn(), pool: vi.fn() }));
vi.mock("../../../platform/agent-runtime/model-selection", () => ({ validateModelSelection: mocks.model }));
vi.mock("../../../services/assistant/skills", () => ({ validateAssistantSkills: mocks.skills }));
vi.mock("../../../services/assistant/skill-references", () => ({ resolveAssistantSkillReferences: mocks.references }));
vi.mock("../../../services/assistant/execution-setting", () => ({ validateExecutionSetting: mocks.setting, prepareExecutionSetting: mocks.prepare, readExecutionOptions: mocks.options }));
vi.mock("../../../services/assistant/store", () => ({ assistantStore: { agent: mocks.agent } }));
vi.mock("../../../infrastructure/postgres", () => ({ getPostgresPool: mocks.pool }));
vi.mock("../../../services/skills/operations", () => ({ withDomainSkills: async (_domain: string, work: () => Promise<unknown>) => work() }));
import assistantRouter from "../assistant";

configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { messages: en, ...enLocaleMeta } } });
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.resetAllMocks();
});
installWorkbenchIdentity({
  requireDomainId: (identity: { domainId?: string | null }) => identity.domainId ?? "domain",
  requirePermission: () => (req: Request, res: Response, next: NextFunction) => {
    if ((req as { userId?: string }).userId !== "alice") {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Denied" } });
      return;
    }
    next();
  },
} as unknown as WorkbenchIdentity);
const form = { name: "Agent", description: "", icon: null, enabled: true, systemPrompt: "Prompt", skills: [] };
async function app() {
  const router = express();
  router.use(express.json());
  router.use((req, _res, next) => {
    Object.assign(req, { userId: req.header("x-user") ?? "alice", domainId: "domain", token: "original", apiKey: "", locale: "en" });
    next();
  });
  router.use("/api", buildTestAccess);
  router.use("/api/assistant", assistantRouter);
  router.use(errorHandler);
  const server = createServer(router);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  return (body: object, user = "alice", path = "/validate", headers = {}, method = "POST") => fetch(`http://127.0.0.1:${address.port}/api/assistant/agent-definitions${path}`, {
    method, headers: { "Content-Type": "application/json", "x-user": user, ...headers }, body: JSON.stringify(body),
  });
}
it("validates the full creation form without preparing a Key or touching storage", async () => {
  mocks.references.mockReturnValue([]);
  const request = await app();
  expect((await request({ target: {}, form })).status).toBe(204);
  expect(mocks.setting).toHaveBeenCalledWith({ domainId: "domain", userId: "alice" }, null, null,
    expect.objectContaining({ token: "original" }));
  expect(mocks.model).toHaveBeenCalledWith("domain", { modelId: null });
  expect(mocks.skills).toHaveBeenCalled();
  expect(mocks.pool).not.toHaveBeenCalled();
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it("loads the actual stored reference and preserves it when the update omits the field", async () => {
  mocks.agent.mockResolvedValue({ kind: "custom", execution_user_id: "selected", skills: [] });
  const request = await app();
  expect((await request({ target: { id: "8f5df4a4-e30b-48cb-831a-33b759144f76" }, form })).status).toBe(204);
  expect(mocks.setting).toHaveBeenCalledWith(expect.anything(), "selected", "selected", expect.anything());
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it("cannot forge the old reference or bypass a setting rejection", async () => {
  mocks.agent.mockResolvedValue({ kind: "custom", execution_user_id: "selected", skills: [] });
  mocks.setting.mockRejectedValue(new HttpError(403, "Denied", "FORBIDDEN"));
  const request = await app();
  expect((await request({ target: { id: "8f5df4a4-e30b-48cb-831a-33b759144f76" }, form: { ...form, executionUserId: "other" } })).status).toBe(403);
  expect(mocks.setting).toHaveBeenCalledWith(expect.anything(), "selected", "other", expect.anything());
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.pool).not.toHaveBeenCalled();
  expect((await request({ target: {}, form, oldExecutionUserId: "other" })).status).toBe(400);
});
it("requires the same analysis-agent permission as a save", async () => {
  const request = await app();
  expect((await request({ target: {}, form }, "bob")).status).toBe(403);
  expect(mocks.model).not.toHaveBeenCalled();
  expect(mocks.setting).not.toHaveBeenCalled();
});

const target = { kind: "draft" };
const id = "8f5df4a4-e30b-48cb-831a-33b759144f76";
it("opens a create form in build-test without validating empty values or admitting a write", async () => {
  mocks.options.mockResolvedValue({ canSetExecutionUser: false, users: [] });
  const request = await app();
  const headers = { [BUILD_TEST_HEADER]: "preview" };
  const response = await request({ target, changedField: null }, "alice", "/form", headers);
  expect(response.status).toBe(200);
  const opened = await response.json();
  expect(opened).toMatchObject({
    values: { name: "", enabled: true, modelSelection: { modelId: null }, skills: [], classNames: [], executionUserId: null },
    save: { method: "POST", path: "/assistant/agent-definitions", draftOperation: "agent.create" },
  });
  expect(opened.values).not.toHaveProperty("sortOrder");
  expect(opened.save.bodySchema.properties).not.toHaveProperty("sortOrder");
  expect(opened.fields).toContainEqual(expect.objectContaining({ path: "/executionUserId", readOnly: true }));
  expect(mocks.setting).not.toHaveBeenCalled();
  expect((await request(form, "alice", "", headers)).status).toBe(422);
  expect((await request(form, "alice", `/${id}`, headers, "PUT")).status).toBe(422);
  expect(mocks.pool).not.toHaveBeenCalled();
});
it("checks and normalizes a complete typed draft without writing", async () => {
  mocks.options.mockResolvedValue({ canSetExecutionUser: true, users: [] });
  const skills = [{ name: "report", namespace: { kind: "domain", domainId: "domain" } }];
  mocks.references.mockReturnValue(skills);
  const request = await app();
  const values = { ...form, name: "  Agent  ", icon: "legacy-icon", enabled: false, modelSelection: { modelId: "test/chat" },
    skills: [{ name: "report", namespace: { kind: "domain" } }], classNames: ["Customer"], enabledMcpServiceIds: [id] };
  const response = await request({ target, changedField: null, values }, "alice", "/form");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ values: { ...values, name: "Agent", skills } });
  expect(mocks.model).toHaveBeenCalledWith("domain", { modelId: "test/chat" });
  expect(mocks.pool).not.toHaveBeenCalled();
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it("rejects the whole unauthorized draft with the owner field and reason", async () => {
  mocks.setting.mockRejectedValue(new HttpError(403, "Domain governance administrator required", "FORBIDDEN"));
  const request = await app();
  const response = await request({ target, changedField: null, values: { ...form, enabledMcpServiceIds: [], executionUserId: "other" } }, "alice", "/form");
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    code: "FORBIDDEN", error: "Domain governance administrator required",
    details: { fields: [{ field: "/executionUserId", message: "Domain governance administrator required" }] },
  });
  expect(mocks.pool).not.toHaveBeenCalled();
  expect(mocks.prepare).not.toHaveBeenCalled();
});

it("opens a stored definition and checks execution permissions concurrently", async () => {
  let pendingReads = 0;
  let concurrentReads = 0;
  async function read<T>(result: T): Promise<T> {
    pendingReads++;
    concurrentReads = Math.max(concurrentReads, pendingReads);
    await new Promise(resolve => setTimeout(resolve, 80));
    pendingReads--;
    return result;
  }
  mocks.options.mockImplementation(() => read({ canSetExecutionUser: false, users: [] }));
  mocks.agent.mockImplementation(() => read({
    id, kind: "custom", name: "Stored assistant", description: "Stored", icon: "old icon", enabled: false,
    class_names: ["Customer"], enabled_mcp_service_ids: [id], sort_order: 13, system_prompt: "Explore",
    skills: [{ name: "report", namespace: { kind: "domain", domainId: "domain" } }],
    model_selection: { modelId: "test/chat" }, execution_user_id: "operator",
  }));
  const request = await app();
  const response = await request({ target: { kind: "object", objectType: "platform:AgentDefinition", primaryKey: id },
    changedField: null }, "alice", "/form");
  expect(response.status).toBe(200);
  const opened = await response.json();
  expect(opened).toMatchObject({
    values: { name: "Stored assistant", enabled: false, icon: "old icon", enabledMcpServiceIds: [id],
      classNames: ["Customer"], executionUserId: "operator", modelSelection: { modelId: "test/chat" },
      skills: [{ name: "report", namespace: { kind: "domain", domainId: "domain" } }] },
    save: { method: "PUT", path: `/assistant/agent-definitions/${id}`, draftOperation: "agent.update" },
  });
  expect(opened.values).not.toHaveProperty("sortOrder");
  expect(opened.fields).toContainEqual(expect.objectContaining({
    path: "/classNames", control: { kind: "reference", objectType: "platform:ObjectType", multiple: true,
      relatedObjectTypes: ["platform:Relationship"] },
  }));
  expect(concurrentReads).toBe(2);
  expect(opened.fields).toContainEqual(expect.objectContaining({
    path: "/executionUserId", readOnly: true, readOnlyReason: en["panels.agentForm.executionReadOnly"],
  }));
  expect(mocks.options).toHaveBeenCalledWith(expect.objectContaining({ token: "original" }), null);
  expect(mocks.pool).not.toHaveBeenCalled();
});

it("validates update drafts without filling in an omitted skill selection", async () => {
  const skill = { name: "stored-page-skill", namespace: { kind: "domain", domainId: "domain" } };
  mocks.agent.mockResolvedValue({
    id, kind: "custom", name: "Stored assistant", description: "", icon: null, enabled: true,
    class_names: [], enabled_mcp_service_ids: [], sort_order: 13, system_prompt: "Before",
    skills: [skill], model_selection: { modelId: null }, execution_user_id: null,
  });
  mocks.options.mockResolvedValue({ canSetExecutionUser: false, users: [] });
  const { skills: _omitted, ...update } = form;
  const request = await app();
  const values = { ...update, enabledMcpServiceIds: [] };
  const response = await request({
    target: { kind: "object", objectType: "platform:AgentDefinition", primaryKey: id }, changedField: null, values,
  }, "alice", "/form");
  expect(response.status).toBe(200);
  const described = await response.json();
  expect(described.values).not.toHaveProperty("skills");
  expect(described.save.bodySchema.required).not.toContain("skills");
  expect((await request({ target: { id }, form: update })).status).toBe(204);
  expect((await request({ target: {}, form: update })).status).toBe(400);
  expect(mocks.skills).not.toHaveBeenCalled();
});
