import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { applicationOpenResponseSchema, productPanelSchema, productProjectionSchema } from "@ontomato/contracts/product-panels";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";

const mocks = vi.hoisted(() => ({ panel: vi.fn(), projections: vi.fn(), snapshot: vi.fn(), open: vi.fn(), component: vi.fn() }));
vi.mock("../../../services/product-panels/operations", () => ({ ownPanelSettings: vi.fn() }));
vi.mock("../../../services/product-panels/current", () => ({
  readCurrentPanelRecord: mocks.panel, readCurrentProjectionRecords: mocks.projections,
}));
vi.mock("../../../services/product-panels/component-catalogue", async original => ({
  ...await original<typeof import("../../../services/product-panels/component-catalogue")>(),
  validateProjectionComponent: mocks.component,
}));
vi.mock("../../../services/product-panels/definition-stream", () => ({ requirePanelDefinitions: mocks.snapshot }));
vi.mock("../../../services/product-panels/open-entry", () => ({ openApplicationDefinitions: mocks.open }));
vi.mock("../../../utils/request-identity", async original => ({
  ...await original<typeof import("../../../utils/request-identity")>(),
  requireDomainId: () => "domain",
}));

import { productPanelOpeningRouter, productPanelsRouter } from "../product-panels";

const owner = { domainId: "domain", userId: "caller" };
const definition = {
  name: "Definition from owner", revision: 7, description: "", visibility: "domain",
  domainId: owner.domainId, ownerId: "author", editable: false,
  createdAt: "2026-11-26T00:00:00Z", updatedAt: "2026-11-26T00:00:00Z",
};
const panel = productPanelSchema.parse({
  ...definition, id: "P1", content: { html: "<div></div>" }, manifest: { state: {}, members: {} },
});
const frame = { ...panel, id: "frame" };
const projection = productProjectionSchema.parse({
  ...definition, id: "projection", componentId: "@ontomato/sdk:DataTable", inputs: {}, outputs: {}, data: {}, config: {},
});
const componentUsable = () => true;
const snapshot = { panel: { id: panel.id, revision: panel.revision }, projections: [] };
const source = { kind: "application-use", applicationId: "app", useId: "use-1" };
const locator = { applicationId: "app", entryKey: "use-1", pageKey: "ontology-agents" };
const entry = {
  applicationId: source.applicationId,
  use: { id: source.useId, pageKey: locator.pageKey, path: "/ontology/agents", panelId: panel.id },
  framePanelId: frame.id,
  menu: { singleEntry: true, groups: [], panelUses: [] },
  allowStandalone: false,
  pageSkillContext: {
    ...locator, useId: source.useId, panelId: panel.id, path: "/ontology/agents", memberPath: [],
  },
};
let base: string;
let server: Server;
beforeAll(async () => {
  configureI18n({
    defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
    packs: { en: { ...enLocaleMeta, messages: en } },
  });
  const app = express();
  app.use("/api/product-panels", productPanelOpeningRouter);
  app.use((req, _res, next) => {
    Object.assign(req, owner, { token: "caller-token", locale: "en" });
    next();
  });
  app.use("/api/product-panels", productPanelsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/product-panels`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.panel.mockResolvedValue(panel);
  mocks.snapshot.mockResolvedValue(snapshot);
  mocks.open.mockResolvedValue({
    owner, entry, componentUsable,
    frame: { panel: frame, projectionIds: ["restricted"] },
    content: { panel, projectionIds: [projection.id] },
    projections: new Map<string, unknown>([
      [projection.id, { ok: true, projection }],
      ["restricted", { ok: false, error: new HttpError(403, "No use grant", "OBJECT_FORBIDDEN") }],
    ]),
  });
});
const open = () => fetch(base + "/application-entry?path=%2Fontology%2Fagents", { headers: { tk: "original-token" } });

it("passes the original credential to opening and returns the admitted definition and skill context together", async () => {
  const result = await open();
  expect(result.status).toBe(200);
  expect(applicationOpenResponseSchema.parse(await result.json())).toEqual({
    ...entry,
    frame: { panel: frame, projections: { restricted: { status: "unavailable", httpStatus: 403, message: "No use grant" } } },
    content: { panel, projections: { [projection.id]: { status: "ready", projection } } },
  });
  expect(mocks.open).toHaveBeenCalledTimes(1);
  expect(mocks.open).toHaveBeenCalledWith({ path: "/ontology/agents" }, expect.objectContaining({ token: "original-token" }));
  expect(mocks.panel).not.toHaveBeenCalled();
  expect(mocks.snapshot).not.toHaveBeenCalled();
  expect(mocks.projections).not.toHaveBeenCalled();
  expect(mocks.component).toHaveBeenCalledWith(projection.id, projection, undefined, expect.objectContaining({ componentUsable }));
});

it.each(["", "/snapshot"])("keeps %s independent of the entrance and refuses old skill query keys", async path => {
  expect(await (await fetch(`${base}/P1${path}`)).json()).toEqual(path ? snapshot : { panel });
  expect(mocks.open).not.toHaveBeenCalled();
  mocks.panel.mockClear();
  mocks.snapshot.mockClear();
  expect((await fetch(`${base}/P1${path}?applicationId=app&useId=use-1&permissionCode=analysis-agent&pageKey=ontology-agents`)).status).toBe(400);
  expect(mocks.panel).not.toHaveBeenCalled();
  expect(mocks.snapshot).not.toHaveBeenCalled();
});

it("rejects malformed opening requests and preserves the owner's refusal", async () => {
  expect((await fetch(base + "/application-entry?applicationId=app")).status).toBe(400);
  expect(mocks.open).not.toHaveBeenCalled();
  mocks.open.mockRejectedValueOnce(new HttpError(403, "Entry unavailable", "FORBIDDEN"));
  expect((await open()).status).toBe(403);
  mocks.open.mockRejectedValueOnce(new HttpError(503, "Source unavailable", "DEPENDENCY_UNAVAILABLE"));
  const failure = await open();
  expect(failure.status).toBe(503);
  expect(await failure.json()).toMatchObject({ error: { code: "DEPENDENCY_UNAVAILABLE" } });
});
