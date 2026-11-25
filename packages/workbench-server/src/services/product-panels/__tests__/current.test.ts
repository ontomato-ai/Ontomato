import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeBundledAppSdkFixture } from "../../../__tests__/fixtures/bundled-app-sdk";
import { installContentLayout } from "../../../content/layout";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { productPanelInputSchema, registerProductPanelRequestSchema, registerProductProjectionRequestSchema } from "@ontomato/contracts/product-panels";
import type { EntryDependency } from "@ontomato/contracts/entry-dependencies";
import type { PanelConversationEntry } from "@ontomato/contracts/panel-conversation-entry";
import { METRIC_VIEW, PRODUCT_PROJECTION } from "@ontomato/contracts/platform-object-types";
import { HttpError } from "../../../utils/errors";
const mocks = vi.hoisted(() => ({ query: vi.fn(), grant: vi.fn(), grantBatch: vi.fn(), grantedIds: vi.fn(), managementAccess: vi.fn(), register: vi.fn(), share: vi.fn(), notify: vi.fn(), edits: [] as string[] }));
vi.mock("../../../infrastructure/postgres", () => ({ getPostgresPool: () => ({ query: mocks.query }), qualifiedTable: (name: string) => name }));
vi.mock("../../../infrastructure/postgres-transaction", () => ({ transaction: (action: (client: { query: typeof mocks.query }) => unknown) => action({ query: mocks.query }) }));
vi.mock("../../product-governance/grants", () => ({ requireProductGrant: mocks.grant, productGrantsAllowedBatch: mocks.grantBatch, registerProductResource: mocks.register,
  shareProductResource: mocks.share, grantedProductIds: mocks.grantedIds, productManagementAccess: mocks.managementAccess }));
vi.mock("../../app-builder/access", () => ({ assertAppBuilderAccess: async () => undefined }));
vi.mock("../definition-stream", () => ({ notifyProductDefinitionChanged: mocks.notify }));
vi.mock("../entry-dependency-publication", () => ({ deliverEntryDependencyPublications: vi.fn() }));
import { readCurrentPanel, readCurrentProjection, readCurrentProjectionRecords, saveCurrentPanel, saveCurrentProjection, validateApplicationPanelReferences } from "../current";
import type { CurrentProductRow } from "../../../infrastructure/product-current";

const owner = { domainId: "domain", userId: "author" }, credentials = { token: "caller" };
let rows: Map<string, CurrentProductRow>;
let dependencies: Map<string, EntryDependency[]>;
let agentDomains: Map<string, string>;
const projection = () => registerProductProjectionRequestSchema.parse({ name: "Task summary", description: "", visibility: "domain", revision: 0,
  componentId: "@ontomato/sdk:ObjectSummary", inputs: { task: { kind: "object", objectType: "platform:ScheduledTask" } },
  data: { record: { source: { object: { input: "task" } }, read: "record", params: {} } }, outputs: {}, config: { fields: ["name"] } });
const panel = () => registerProductPanelRequestSchema.parse({ name: "Tasks", description: "", visibility: "domain", revision: 0,
  content: { html: "<main></main>", module: "throw new Error('Node must never execute this module')", recipes: "Choose a test task." },
  manifest: { state: { selectedTask: { type: { kind: "object", objectType: "platform:ScheduledTask" } } },
    members: { summary: { target: { projectionId: "x" }, inputs: { task: { state: "selectedTask" } } } } } });
async function seedProjection() {
  return saveCurrentProjection(owner, credentials, "x", projection());
}

let runtimeRoot: string;
beforeAll(async () => {
  runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "current-product-"));
  await writeBundledAppSdkFixture(runtimeRoot);
  installContentLayout({ runtimeRoot, publicSkillsRoot: runtimeRoot, prompts: [], runtimeResources: [] });
});
afterAll(() => rm(runtimeRoot, { recursive: true }));

beforeEach(() => {
  vi.resetAllMocks(); mocks.edits = []; rows = new Map();
  dependencies = new Map();
  agentDomains = new Map();
  mocks.grantedIds.mockImplementation(async () => mocks.edits);
  mocks.managementAccess.mockImplementation(async ({ id }: { id: string }, { ownerId }: { ownerId: string | null }) => ({
    allowed: true, authored: ownerId === owner.userId, editable: mocks.edits.includes(id),
  }));
  mocks.grantBatch.mockImplementation(async (ids: readonly string[]) => Object.fromEntries(ids.map(id => [id, true])));
  mocks.register.mockImplementation(async (_owner, id: string) => { mocks.edits.push(id); });
  mocks.query.mockImplementation(async (sql: string, args: unknown[] = []) => {
    if (sql.includes("FROM assistant_agents WHERE id=$1 AND domain_id=$2")) {
      const [id, domainId] = args as [string, string];
      return { rows: agentDomains.get(id) === domainId ? [{ id }] : [] };
    }
    if (sql.startsWith("SELECT panel_id,dependencies FROM product_panel_entry_dependencies")) {
      const [reference] = JSON.parse(String(args[1])) as Pick<EntryDependency, "objectType" | "objectKey">[];
      return { rows: [...dependencies].filter(([, list]) =>
        list.some(item => item.objectType === reference.objectType && item.objectKey === reference.objectKey),
      ).map(([panel_id, dependencies]) => ({ panel_id, dependencies })) };
    }
    if (sql.startsWith("INSERT INTO product_panel_entry_dependencies")) {
      dependencies.set(String(args[1]), JSON.parse(String(args[2])));
      return { rows: [] };
    }
    if (sql.startsWith("INSERT INTO product_publication_outbox")) return { rows: [] };
    const kind = sql.includes("product_panels") ? "panel" : "projection";
    const key = `${kind}:${args[1]}`;
    if (sql.startsWith("SELECT id,definition")) return { rows: [...rows.entries()]
      .filter(([key]) => key.startsWith("panel:"))
      .map(([, row]) => ({ id: row.id, definition: row.definition })) };
    if (sql.startsWith("SELECT id,domain_id") && sql.includes("ANY")) {
      return { rows: (args[1] as string[]).flatMap(id => rows.has(`${kind}:${id}`) ? [rows.get(`${kind}:${id}`)!] : []) };
    }
    if (sql.startsWith("SELECT id,domain_id")) return { rows: rows.has(key) ? [rows.get(key)] : [] };
    if (sql.startsWith("SELECT id FROM") && sql.includes("ANY")) return { rows: (args[1] as string[]).filter(id => rows.has(`panel:${id}`)).map(id => ({ id })) };
    if (sql.startsWith("SELECT id FROM")) return { rows: [] };
    if (sql.startsWith("INSERT INTO product_") && !rows.has(key)) {
      const row = { id: String(args[1]), domainId: String(args[0]), ownerId: String(args[2]), definition: JSON.parse(String(args[3])),
        revision: 1, createdAt: new Date(), updatedAt: new Date() };
      rows.set(key, row); return { rows: [row] };
    }
    if (sql.startsWith("UPDATE product_")) {
      const row = rows.get(key);
      if (!row || row.revision !== args[3]) return { rows: [] };
      const updated = { ...row, definition: JSON.parse(String(args[2])), revision: row.revision + 1, updatedAt: new Date() };
      rows.set(key, updated); return { rows: [updated] };
    }
    return { rows: [] };
  });
});

it("registers source text without executing it, uses current definitions and never writes legacy asset history", async () => {
  await seedProjection();
  const { revision, ...input } = panel();
  const saved = await saveCurrentPanel(owner, credentials, "p", input, revision);
  expect(saved.content).toEqual(input.content);
  const updated = registerProductProjectionRequestSchema.parse({ ...projection(), revision: 1, config: { fields: ["name", "status"] } });
  await saveCurrentProjection(owner, credentials, "x", updated);
  expect((await readCurrentProjection(owner, credentials, "x")).config).toEqual({ fields: ["name", "status"] });
  expect((await readCurrentPanel(owner, credentials, "p")).manifest.members.summary.target).toEqual({ projectionId: "x" });
  expect(mocks.notify).toHaveBeenCalledWith({ kind: "definition-changed", domainId: "domain", target: { kind: "projection", id: "x" } });
  expect(mocks.query.mock.calls.some(([sql]) => /(?:INSERT INTO|UPDATE) (?:product_assets|product_asset_revisions|product_releases|product_bundle_heads)/.test(sql))).toBe(false);
});

it("recompiles the upper closure without inheriting a child default through a personal state wire", async () => {
  const metric = (primaryKey: string) => ({ className: METRIC_VIEW, primaryKey });
  const type = { kind: "object", objectType: METRIC_VIEW } as const;
  const { revision, ...input } = panel();
  const metricProjection = {
    revision: 0, name: "Metric", description: "", visibility: "domain",
    componentId: "@ontomato/sdk:ObjectSummary", inputs: { metric: type }, outputs: {}, config: { fields: ["name"] },
    data: { record: { source: { object: { input: "metric" } }, read: "record", params: {} } },
  } as const;
  for (const id of ["selected-metric", "other-metric"])
    await saveCurrentProjection(owner, credentials, id, registerProductProjectionRequestSchema.parse(metricProjection));
  const child = productPanelInputSchema.parse({
    ...input,
    manifest: {
      state: {
        metric: { type, external: true, default: metric("child-default") },
        selected: { type: { kind: "object", objectType: PRODUCT_PROJECTION } },
      },
      members: {
        summary: {
          target: { fromState: "selected", candidates: { projectionIds: ["selected-metric", "other-metric"] } },
          inputs: { metric: { state: "metric" } },
        },
      },
    },
  });
  const parent = productPanelInputSchema.parse({
    ...input,
    manifest: {
      state: { metric: { type, personal: true, default: metric("personal-default") } },
      members: { child: { target: { panelId: "child" } } },
    },
  });
  const metricDependencies = (id: string) => dependencies.get(id)?.filter(item => item.objectType === "METRIC");
  await saveCurrentPanel(owner, credentials, "child", child, revision);
  await saveCurrentPanel(owner, credentials, "parent", parent, revision);
  expect(metricDependencies("parent")).toEqual([{ objectType: "METRIC", objectKey: "child-default", verb: "VIEW" }]);

  await saveCurrentPanel(owner, credentials, "parent", {
    ...parent, manifest: {
      ...parent.manifest, members: { child: { target: { panelId: "child" }, inputs: { metric: { state: "metric" } } } },
    },
  }, 1);
  expect(metricDependencies("parent")).toEqual([]);
  expect(metricDependencies("child")).toEqual([{ objectType: "METRIC", objectKey: "child-default", verb: "VIEW" }]);

  await saveCurrentProjection(owner, credentials, "other-metric", registerProductProjectionRequestSchema.parse({
    ...metricProjection, revision: 1,
    data: { record: { source: { object: { literal: metric("projection-fixed") } }, read: "record", params: {} } },
  }));
  expect(metricDependencies("parent")).toEqual([{ objectType: "METRIC", objectKey: "projection-fixed", verb: "VIEW" }]);
});

it("excludes placement targets from a nested closure while the parent controls that state field", async () => {
  await seedProjection();
  const { revision, ...input } = panel();
  const child = productPanelInputSchema.parse({
    ...input,
    manifest: {
      state: {
        placed: {
          type: { kind: "placement", candidates: { projectionIds: ["x"] } }, external: true,
          default: { id: "summary", target: { projectionId: "x" } },
        },
      },
      members: {},
    },
  });
  const parent = productPanelInputSchema.parse({
    ...input,
    manifest: {
      state: {},
      members: { child: { target: { panelId: "child" }, inputs: { placed: { literal: null } } } },
    },
  });
  await saveCurrentPanel(owner, credentials, "child", child, revision);
  await saveCurrentPanel(owner, credentials, "parent", parent, revision);
  const projectionUse = { objectType: "PROJECTION", objectKey: "x", verb: "USE" };
  expect(dependencies.get("child")).toContainEqual(projectionUse);
  expect(dependencies.get("parent")).not.toContainEqual(projectionUse);
});

it.each(["ObjectList", "GroupedGrid"])("checks and compiles the declared row conversation agents of %s", async component => {
  agentDomains.set("top-agent", owner.domainId);
  agentDomains.set("row-agent", owner.domainId);
  agentDomains.set("foreign-agent", "another-domain");
  const rowConversation = (id: string, target?: PanelConversationEntry["target"]) =>
    ({ kind: "conversation", id, ...(target && { target }) });
  const rowActions = [
    rowConversation("explicit", { kind: "id", id: "row-agent" }),
    rowConversation("preset", { kind: "preset", agentKind: "regular" }),
    rowConversation("dynamic", { kind: "page-default" }),
    rowConversation("inherited"),
  ];
  const projectionRequest = (revision: number, items = rowActions) => registerProductProjectionRequestSchema.parse({
    name: "Row conversations", description: "", visibility: "domain", revision,
    componentId: `@ontomato/sdk:${component}`, inputs: {}, outputs: {}, data: {},
    config: { rowActions: { items } },
    conversationEntry: { target: { kind: "id", id: "top-agent" } },
  });
  await saveCurrentProjection(owner, credentials, "row-conversations", projectionRequest(0));
  const { revision, ...input } = panel();
  await saveCurrentPanel(owner, credentials, "row-panel", {
    ...input, manifest: { state: {}, members: { list: { target: { projectionId: "row-conversations" } } } },
  }, revision);
  expect(new Set(dependencies.get("row-panel")?.filter(item => item.objectType === "AGENT"))).toEqual(new Set([
    { objectType: "AGENT", objectKey: "top-agent", verb: "USE" },
    { objectType: "AGENT", objectKey: "row-agent", verb: "USE" },
    { objectType: "AGENT", objectKey: "preset:regular", verb: "USE" },
  ]));

  await expect(saveCurrentProjection(owner, credentials, "row-conversations", projectionRequest(1, [
    rowConversation("foreign", { kind: "id", id: "foreign-agent" }),
  ]))).rejects.toMatchObject({ status: 400, code: "INVALID_PANEL_REFERENCE" });
  expect(rows.get("projection:row-conversations")?.revision).toBe(1);
});

it("requires current use/edit grants, preserves the owner for delegated edits and compares the current revision", async () => {
  await seedProjection();
  const { revision, ...input } = panel(); await saveCurrentPanel(owner, credentials, "p", input, revision);
  const editor = { ...owner, userId: "editor" };
  expect((await saveCurrentPanel(editor, credentials, "p", { ...input, visibility: "private", content: { html: "updated", module: "export {}" } }, 1)).ownerId).toBe("author");
  expect(mocks.share).not.toHaveBeenCalled();
  await expect(saveCurrentPanel(editor, credentials, "p", input, 1)).rejects.toMatchObject({ code: "PRODUCT_CONFLICT" });
  expect((await readCurrentPanel(editor, credentials, "p")).content.html).toBe("updated");
  mocks.grant.mockImplementation(async (_id: string, verb: string) => { if (verb === "edit") throw new HttpError(403, "Denied", "PRODUCT_FORBIDDEN"); });
  await expect(saveCurrentPanel(editor, credentials, "p", input, 2)).rejects.toMatchObject({ code: "PRODUCT_FORBIDDEN" });
  mocks.grant.mockRejectedValue(new HttpError(403, "Denied", "PRODUCT_FORBIDDEN"));
  await expect(readCurrentPanel(editor, credentials, "p")).rejects.toMatchObject({ code: "PRODUCT_FORBIDDEN" });
});

it("rejects missing projection IDs, unknown slot inputs and mismatched ontology types before creating a panel", async () => {
  await seedProjection();
  const { revision, ...input } = panel();
  for (const [members, state, code] of [
    [{ summary: { target: { projectionId: "missing" }, inputs: {} } }, input.manifest.state, "PRODUCT_UNAVAILABLE"],
    [{ summary: { target: { projectionId: "x" }, inputs: { unknown: { state: "selectedTask" } } } }, input.manifest.state, "PANEL_PORT_MISMATCH"],
    [input.manifest.members, { selectedTask: { type: { kind: "scalar", type: "string" }, deepLink: false } }, "PANEL_PORT_MISMATCH"],
  ] as const) {
    const request = registerProductPanelRequestSchema.parse({ ...input, revision, manifest: { ...input.manifest, members, state } });
    await expect(saveCurrentPanel(owner, credentials, "invalid", request, revision)).rejects.toMatchObject({ code });
    expect(rows.has("panel:invalid")).toBe(false);
  }
});

it("does not accept a legacy asset ID as a current panel reference", async () => {
  const request = (panelId: string) => ({
    domainId: owner.domainId, uses: [{ id: "use", panelId }], delivery: { panels: [], projections: [] },
  });
  await expect(validateApplicationPanelReferences(request("legacy-page"))).rejects.toMatchObject({ code: "INVALID_PANEL_REFERENCE" });
  await seedProjection(); const { revision, ...input } = panel(); await saveCurrentPanel(owner, credentials, "p", input, revision);
  await expect(validateApplicationPanelReferences(request("p"))).resolves.toBeUndefined();
});

it("requires pageComposer: 'none' on any application entry mounting an AgentChat projection (direct or nested)", async () => {
  await saveCurrentProjection(owner, credentials, "chat-proj", {
    name: "Chat", description: "", visibility: "domain",
    componentId: "@ontomato/sdk:AgentChat",
    inputs: {}, outputs: {}, data: {}, config: {},
    conversationEntry: { target: { kind: "preset", agentKind: "regular" } },
    revision: 0,
  });
  const basePanel = panel();
  const { revision, ...input } = basePanel;
  await saveCurrentPanel(owner, credentials, "chat-panel", {
    ...input,
    manifest: { state: {}, members: { chat: { target: { projectionId: "chat-proj" } } } },
  }, revision);
  await saveCurrentPanel(owner, credentials, "outer-panel", {
    ...input,
    manifest: { state: {}, members: { child: { target: { panelId: "chat-panel" } } } },
  }, revision);

  for (const panelId of ["chat-panel", "outer-panel"]) {
    await expect(validateApplicationPanelReferences({
      domainId: owner.domainId,
      uses: [{ id: "chat-use", panelId }],
      delivery: { panels: [], projections: [] },
    })).rejects.toMatchObject({ status: 400, code: "INVALID_PANEL_ENTRY_PAGE_COMPOSER" });

    await expect(validateApplicationPanelReferences({
      domainId: owner.domainId,
      uses: [{ id: "chat-use", panelId, pageComposer: "bottom" }],
      delivery: { panels: [], projections: [] },
    })).rejects.toMatchObject({ status: 400, code: "INVALID_PANEL_ENTRY_PAGE_COMPOSER" });

    await expect(validateApplicationPanelReferences({
      domainId: owner.domainId,
      uses: [{ id: "chat-use", panelId, pageComposer: "none" }],
      delivery: { panels: [], projections: [] },
    })).resolves.toBeUndefined();
  }
});

it("rejects a frame state input without a frame and preserves typed literal wiring", async () => {
  const { revision, ...input } = panel();
  const type = { kind: "scalar", type: "string" } as const;
  const field = { type, personal: false, deepLink: true, external: true };
  const definition = { ...input, manifest: { state: { term: field }, members: {} } };
  await saveCurrentPanel(owner, credentials, "content", definition, revision);
  const validates = (ref: { literal: string } | { frameState: string }, framePanelId?: string) =>
    validateApplicationPanelReferences({
      domainId: owner.domainId, framePanelId,
      uses: [{ id: "orders", panelId: "content", inputs: { term: ref } }],
      delivery: { panels: [], projections: [] },
    });

  await expect(validates({ frameState: "semester" })).rejects.toMatchObject({
    status: 400, code: "INVALID_PANEL_ENTRY_INPUT", message: expect.stringMatching(/orders.*term.*frame.*semester/),
  });
  await expect(validates({ literal: "A" })).resolves.toBeUndefined();
  await saveCurrentPanel(owner, credentials, "frame", {
    ...definition, manifest: { ...definition.manifest, state: { semester: field, privateTerm: { ...field, external: false } } },
  }, revision);
  await expect(validates({ frameState: "semester" }, "frame")).resolves.toBeUndefined();
  await expect(validates({ frameState: "privateTerm" }, "frame")).rejects.toMatchObject({ code: "INVALID_PANEL_ENTRY_INPUT" });
});

it("checks theme values in the application registration preflight with relaxed CSS value rules", async () => {
  const request = { domainId: owner.domainId, uses: [], delivery: { panels: [], projections: [] } };
  await expect(validateApplicationPanelReferences({
    ...request,
    theme: {
      light: { "--sdk-color-primary": "oklch(0.6 0.15 240)", "--radius-md": "calc(2px + 6px)", "--custom-accent": "#498" },
      dark: { "--elevation-panel": "0 8px 24px rgba(0,0,0,0.2)" },
    },
  })).resolves.toBeUndefined();
  for (const [name, value] of [
    ["not-a-var", "#fff"], ["--el-color-primary", "#498"], ["--sdk-color-primary", ""],
    ["--sdk-color-primary", "#fff; color: red"], ["--radius-md", "8px } body {"], ["--radius-md", "</style><script>"],
  ]) {
    await expect(validateApplicationPanelReferences({
      ...request, theme: { dark: { [name]: value } },
    })).rejects.toMatchObject({ status: 400, code: "INVALID_PANEL_THEME", message: expect.stringContaining(`dark.${name}`) });
  }
  expect(mocks.query).not.toHaveBeenCalled();
});

it("does not assume resource registration restores a revoked edit Grant", async () => {
  mocks.register.mockResolvedValue(undefined);
  mocks.grant.mockRejectedValue(new HttpError(403, "Edit was revoked", "PRODUCT_FORBIDDEN"));
  await expect(saveCurrentProjection(owner, credentials, "x", projection())).rejects.toMatchObject({ code: "PRODUCT_FORBIDDEN" });
  expect(rows.has("projection:x")).toBe(false);
  expect(mocks.notify).not.toHaveBeenCalled();
});

it("limits source text by UTF-8 bytes at the registration boundary", () => {
  const request = panel();
  expect(registerProductPanelRequestSchema.safeParse({ ...request, content: { ...request.content, module: "é".repeat(150_000) } }).success).toBe(false);
});

it("batches grant checks, database reads, and edit-grant checks in readCurrentProjectionRecords with per-id 403/404 isolation", async () => {
  await seedProjection();
  await saveCurrentProjection(owner, credentials, "y", projection());
  mocks.query.mockClear();
  mocks.grantBatch.mockClear();
  mocks.grantedIds.mockClear();
  mocks.grantBatch.mockResolvedValue({ x: true, y: true, denied: false, missing: true });

  const results = await readCurrentProjectionRecords(owner, credentials, ["x", "y", "x", "denied", "missing"]);
  expect(mocks.grantBatch).toHaveBeenCalledTimes(1);
  expect(mocks.grantBatch).toHaveBeenCalledWith(["x", "y", "denied", "missing"], "use", credentials);
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.grantedIds).toHaveBeenCalledTimes(1);

  expect(results.get("x")).toMatchObject({ ok: true, projection: { id: "x", editable: true } });
  expect(results.get("y")).toMatchObject({ ok: true, projection: { id: "y", editable: true } });
  expect(results.get("denied")).toMatchObject({ ok: false, error: expect.objectContaining({ status: 403 }) });
  expect(results.get("missing")).toMatchObject({ ok: false, error: expect.objectContaining({ status: 404 }) });
});


it("reuses the current panel definition while checking the caller's grants and the stored revision on each read", async () => {
  await seedProjection();
  const { revision, ...input } = panel();
  await saveCurrentPanel(owner, credentials, "p", input, revision);
  const first = await readCurrentPanel(owner, credentials, "p");
  expect(await readCurrentPanel(owner, credentials, "p")).toBe(first);

  mocks.edits = [];
  const readOnly = await readCurrentPanel(owner, credentials, "p");
  expect(readOnly).toMatchObject({ revision: 1, editable: false });
  expect(readOnly.manifest).toBe(first.manifest);

  mocks.grant.mockRejectedValueOnce(new HttpError(403, "Use was revoked", "PRODUCT_FORBIDDEN"));
  await expect(readCurrentPanel(owner, credentials, "p")).rejects.toMatchObject({ status: 403 });
  await saveCurrentPanel(owner, credentials, "p", { ...input, name: "Updated tasks" }, first.revision);
  expect(await readCurrentPanel(owner, credentials, "p")).toMatchObject({ name: "Updated tasks", revision: 2 });
});
