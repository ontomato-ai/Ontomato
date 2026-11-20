import { beforeEach, expect, it, vi } from "vitest";
import { registerProductPanelRequestSchema, registerProductProjectionRequestSchema } from "@ontomato/contracts/product-panels";
import { HttpError } from "../../../utils/errors";
const mocks = vi.hoisted(() => ({ query: vi.fn(), grant: vi.fn(), register: vi.fn(), share: vi.fn(), notify: vi.fn(), edits: [] as string[] }));
vi.mock("../../../infrastructure/postgres", () => ({ getPostgresPool: () => ({ query: mocks.query }), qualifiedTable: (name: string) => name }));
vi.mock("../../../infrastructure/postgres-transaction", () => ({ transaction: (action: (client: { query: typeof mocks.query }) => unknown) => action({ query: mocks.query }) }));
vi.mock("../../product-governance/grants", () => ({ requireProductGrant: mocks.grant, registerProductResource: mocks.register,
  shareProductResource: mocks.share, grantedProductIds: async () => mocks.edits }));
vi.mock("../definition-stream", () => ({ notifyProductDefinitionChanged: mocks.notify }));
import { readCurrentPanel, readCurrentProjection, saveCurrentPanel, saveCurrentProjection, validateApplicationPanelReferences } from "../current";
import type { CurrentProductRow } from "../../../infrastructure/product-current";

const owner = { domainId: "domain", userId: "author" }, credentials = { token: "caller" };
let rows: Map<string, CurrentProductRow>;
const projection = () => registerProductProjectionRequestSchema.parse({ name: "Task summary", description: "", visibility: "domain", revision: 0,
  componentId: "@ontomato/sdk:ObjectSummary", inputs: { task: { kind: "object", objectType: "platform:ScheduledTask" } },
  data: { record: { source: { object: { input: "task" } }, read: "record", params: {} } }, outputs: {}, config: { fields: ["name"] } });
const panel = () => registerProductPanelRequestSchema.parse({ name: "Tasks", description: "", visibility: "domain", revision: 0,
  content: { html: "<main></main>", module: "throw new Error('Node must never execute this module')", recipes: "Choose a test task." },
  manifest: { state: { selectedTask: { type: { kind: "object", objectType: "platform:ScheduledTask" } } },
    members: { summary: { target: { projectionId: "x" }, inputs: { task: { state: "selectedTask" } } } }, events: {} } });
async function seedProjection() {
  return saveCurrentProjection(owner, credentials, "x", projection());
}

beforeEach(() => {
  vi.resetAllMocks(); mocks.edits = []; rows = new Map();
  mocks.register.mockImplementation(async (_owner, id: string) => { mocks.edits.push(id); });
  mocks.query.mockImplementation(async (sql: string, args: unknown[] = []) => {
    const kind = sql.includes("product_panels") ? "panel" : "projection";
    const key = `${kind}:${args[1]}`;
    if (sql.startsWith("SELECT id,definition")) return { rows: [...rows.entries()]
      .filter(([key]) => key.startsWith("panel:"))
      .map(([, row]) => ({ id: row.id, definition: row.definition })) };
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
