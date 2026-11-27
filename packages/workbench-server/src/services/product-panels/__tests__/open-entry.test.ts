import { beforeEach, expect, it, vi } from "vitest";
import { PRODUCT_PROJECTION } from "@ontomato/contracts/platform-object-types";
import type { CurrentProductRow } from "../../../infrastructure/product-current";
import { openApplicationDefinitions } from "../open-entry";

const mocks = vi.hoisted(() => ({ open: vi.fn(), find: vi.fn() }));
vi.mock("../java-panel-reads", () => ({ openViaJava: mocks.open }));
vi.mock("../../../infrastructure/product-current", async original => ({
  ...await original<typeof import("../../../infrastructure/product-current")>(), findCurrentProducts: mocks.find,
}));

const owner = { domainId: "team", userId: "reader" };
const credentials = { locale: "en", token: "reader-token" };
const date = new Date("2026-11-26T00:00:00Z");
const records = { panel: new Map<string, CurrentProductRow>(), projection: new Map<string, CurrentProductRow>() };
const add = (kind: keyof typeof records, id: string, definition: Record<string, unknown>) => records[kind].set(id, {
  id, domainId: owner.domainId, ownerId: "author", definition: { name: id, description: "", visibility: "domain", ...definition },
  revision: 1, createdAt: date, updatedAt: date,
});
const panel = (targets: Record<string, string>) => ({
  content: { html: "<div></div>" },
  manifest: { state: {}, members: Object.fromEntries(Object.entries(targets).map(([name, projectionId]) => [name, { target: { projectionId } }])) },
});
const use = { id: "list", names: { en: "list" }, pageKey: "app-list", path: "/applications/app-test/list", panelId: "content" };
const other = { id: "other", names: { en: "other" }, pageKey: "app-other", path: "/applications/app-test/other", panelId: "secret-panel" };
const entry = {
  applicationId: "app-test", use, framePanelId: "frame", allowStandalone: false,
  menu: { groups: [], panelUses: [use, other], singleEntry: false },
};
const range = (objectIds: string[]) => ({ USE: { fixed: false, authorId: null, objectIds, all: false } });
const visibility = { PANEL: range(["content", "frame"]), PROJECTION: range(["shared"]), COMPONENT: range([]) };

beforeEach(() => {
  vi.resetAllMocks();
  for (const rows of Object.values(records)) rows.clear();
  mocks.open.mockResolvedValue({ viewer: owner, entry, visibility });
  mocks.find.mockImplementation(async (_domainId: string, kind: keyof typeof records, ids: string[]) =>
    new Map(ids.flatMap(id => records[kind].has(id) ? [[id, records[kind].get(id)]] : [])));
  add("panel", "frame", panel({ visible: "shared" }));
  add("panel", "content", panel({ visible: "shared", secret: "secret", removed: "missing" }));
  add("panel", "secret-panel", panel({}));
  for (const id of ["shared", "secret"]) add("projection", id, {
    componentId: "@ontomato/sdk:DataTable", data: {}, config: {}, inputs: {}, outputs: {},
  });
});

it("assembles the current definitions only inside the authoritative opening's range", async () => {
  const reply = await openApplicationDefinitions({ path: use.path }, credentials);
  expect(mocks.open).toHaveBeenCalledTimes(1);
  expect(reply.entry).toMatchObject({
    allowStandalone: false,
    menu: { panelUses: [use] }, pageSkillContext: { applicationId: entry.applicationId, useId: use.id, panelId: use.panelId, memberPath: [] },
  });
  expect(reply.frame?.panel.id).toBe("frame");
  expect(reply.content?.panel.id).toBe("content");
  expect(reply.projections.get("shared")).toMatchObject({ ok: true, projection: { id: "shared" } });
  expect(reply.projections.get("secret")).toMatchObject({ ok: false, error: { status: 403 } });
  expect(reply.projections.get("missing")).toMatchObject({ ok: false, error: { status: 404 } });
});

it("selects a registered literal for a dynamic placement and keeps the admitted page placement", async () => {
  const ref = (primaryKey: string) => ({ className: PRODUCT_PROJECTION, primaryKey });
  const dynamic = (fallback: string) => ({
    ...panel({ fixed: "shared" }),
    manifest: {
      state: { selected: { type: { kind: "object", objectType: PRODUCT_PROJECTION }, default: ref(fallback) } },
      members: {
        fixed: { target: { projectionId: "shared" } },
        preview: { target: { fromState: "selected", candidates: { projectionIds: ["frame-default", "content-default", "secret"] } } },
      },
    },
  });
  add("panel", "dynamic-frame", dynamic("frame-default"));
  add("panel", "dynamic-content", dynamic("content-default"));
  const placed = { ...use, panelId: "dynamic-content", inputs: { selected: { literal: ref("secret") } } };
  mocks.open.mockResolvedValue({
    viewer: owner, entry: { ...entry, framePanelId: "dynamic-frame", use: placed },
    visibility: { ...visibility, PANEL: range(["dynamic-frame", "dynamic-content"]) },
  });

  const result = await openApplicationDefinitions({ path: use.path }, credentials);
  expect(result.frame?.projectionIds).toEqual(["shared", "frame-default"]);
  expect(result.content?.projectionIds).toEqual(["shared", "secret"]);
  expect(result.projections.get("secret")).toMatchObject({ ok: false, error: { status: 403 } });
  expect(result.entry.pageSkillContext).toMatchObject({ applicationId: entry.applicationId, useId: use.id, panelId: placed.panelId, memberPath: [] });
});

it("does not hand out either definition when the opening root is outside the range", async () => {
  mocks.open.mockResolvedValue({ viewer: owner, entry, visibility: { ...visibility, PANEL: range(["frame"]) } });
  await expect(openApplicationDefinitions({ path: use.path }, credentials)).rejects.toMatchObject({ status: 403 });
});
