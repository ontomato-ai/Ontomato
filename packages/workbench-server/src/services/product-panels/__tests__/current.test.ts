import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeBundledAppSdkFixture } from "../../../__tests__/fixtures/bundled-app-sdk";
import { installContentLayout } from "../../../content/layout";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { registerProductPanelRequestSchema, registerProductProjectionRequestSchema } from "@ontomato/contracts/product-panels";
import { HttpError } from "../../../utils/errors";
const mocks = vi.hoisted(() => ({ query: vi.fn(), grant: vi.fn(), grantBatch: vi.fn(), grantedIds: vi.fn(), register: vi.fn(), share: vi.fn(), notify: vi.fn(), edits: [] as string[] }));
vi.mock("../../../infrastructure/postgres", () => ({ getPostgresPool: () => ({ query: mocks.query }), qualifiedTable: (name: string) => name }));
vi.mock("../../../infrastructure/postgres-transaction", () => ({ transaction: (action: (client: { query: typeof mocks.query }) => unknown) => action({ query: mocks.query }) }));
vi.mock("../../product-governance/grants", () => ({ requireProductGrant: mocks.grant, productGrantsAllowedBatch: mocks.grantBatch, registerProductResource: mocks.register,
  shareProductResource: mocks.share, grantedProductIds: mocks.grantedIds }));
vi.mock("../../app-builder/access", () => ({ assertAppBuilderAccess: async () => undefined }));
vi.mock("../definition-stream", () => ({ notifyProductDefinitionChanged: mocks.notify }));
import { readCurrentPanel, readCurrentProjection, readCurrentProjectionRecords, saveCurrentPanel, saveCurrentProjection, validateApplicationPanelReferences } from "../current";
import type { CurrentProductRow } from "../../../infrastructure/product-current";

const owner = { domainId: "domain", userId: "author" }, credentials = { token: "caller" };
let rows: Map<string, CurrentProductRow>;
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
  mocks.grantedIds.mockImplementation(async () => mocks.edits);
  mocks.grantBatch.mockImplementation(async (ids: readonly string[]) => Object.fromEntries(ids.map(id => [id, true])));
  mocks.register.mockImplementation(async (_owner, id: string) => { mocks.edits.push(id); });
  mocks.query.mockImplementation(async (sql: string, args: unknown[] = []) => {
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
