import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { applicationEntryResolutionSchema } from "@ontomato/contracts/product-panels";
import { protectedSkillRef } from "../../../core/skills/providers";
import { HttpError } from "../../../utils/errors";

const mocks = vi.hoisted(() => ({ panel: vi.fn(), snapshot: vi.fn(), open: vi.fn(), personal: vi.fn(), member: vi.fn() }));
vi.mock("../../../services/product-panels/operations", () => ({ ownPanelSettings: vi.fn() }));
vi.mock("../../../services/product-panels/current", () => ({ readCurrentPanelRecord: mocks.panel }));
vi.mock("../../../services/product-panels/definition-stream", () => ({ requirePanelDefinitions: mocks.snapshot }));
vi.mock("../../../services/skills/view", () => ({ openedPanelPageSkillContext: mocks.member }));
vi.mock("../../../services/product-panels/application-use", () => ({
  requirePanelEntry: mocks.open,
  personalEntry: mocks.personal,
}));
vi.mock("../../../utils/request-identity", async original => ({
  ...await original<typeof import("../../../utils/request-identity")>(),
  requireDomainId: () => "domain",
}));

import { productPanelsRouter } from "../product-panels";

const owner = { domainId: "domain", userId: "caller" };
const panel = { id: "P1", name: "Definition from owner", revision: 7 };
const snapshot = { panel: { id: panel.id, revision: panel.revision }, projections: [] };
const source = { kind: "application-use", applicationId: "app", useId: "use-1" };
const locator = { pageKey: "ontology-agents", permissionCode: "analysis-agent" };
const entry = {
  applicationId: source.applicationId,
  use: { id: source.useId, pageKey: locator.pageKey, path: "/ontology/agents", panelId: panel.id,
    access: { permissionCode: locator.permissionCode } },
  menu: { singleEntry: true, groups: [], panelUses: [] },
};
let base: string;
let server: Server;
beforeAll(async () => {
  const app = express();
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
  mocks.open.mockResolvedValue(entry);
  mocks.personal.mockResolvedValue(entry);
});
const open = () => fetch(base + "/application-entry?path=%2Fontology%2Fagents");

it("passes the once-admitted entry to the skill resolver under the same viewer", async () => {
  const ref = protectedSkillRef("product-panels", owner.domainId, panel.id);
  const pageSkillContext = { mode: "member", locator, entry: source, member: { source, memberPath: [], ref } };
  mocks.member.mockResolvedValue(pageSkillContext);
  const result = await open();
  expect(result.status).toBe(200);
  expect(applicationEntryResolutionSchema.parse(await result.json())).toEqual({ ...entry, pageSkillContext });
  expect(mocks.open).toHaveBeenCalledTimes(1);
  expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ token: "caller-token" }), { path: "/ontology/agents" });
  expect(mocks.member).toHaveBeenCalledTimes(1);
  expect(mocks.member).toHaveBeenCalledWith({
    ...owner, initiatorCredentials: expect.objectContaining({ token: "caller-token" }),
  }, entry);
  expect(mocks.panel).not.toHaveBeenCalled();
  expect(mocks.snapshot).not.toHaveBeenCalled();
});

it.each(["", "/snapshot"])("keeps %s independent of the entrance and refuses old skill query keys", async path => {
  expect(await (await fetch(`${base}/P1${path}`)).json()).toEqual(path ? snapshot : { panel });
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.member).not.toHaveBeenCalled();
  mocks.panel.mockClear();
  mocks.snapshot.mockClear();
  expect((await fetch(`${base}/P1${path}?applicationId=app&useId=use-1&permissionCode=analysis-agent&pageKey=ontology-agents`)).status).toBe(400);
  expect(mocks.panel).not.toHaveBeenCalled();
  expect(mocks.snapshot).not.toHaveBeenCalled();
  expect(mocks.member).not.toHaveBeenCalled();
});

it("rejects an invalid opening and does not read entrance-only content after refusal", async () => {
  expect((await fetch(base + "/application-entry?applicationId=app")).status).toBe(400);
  expect(mocks.open).not.toHaveBeenCalled();
  mocks.open.mockRejectedValueOnce(new HttpError(403, "Entry unavailable", "FORBIDDEN"));
  expect((await open()).status).toBe(403);
  expect(mocks.member).not.toHaveBeenCalled();
  mocks.member.mockRejectedValueOnce(new HttpError(503, "Source unavailable", "DEPENDENCY_UNAVAILABLE"));
  const failure = await open();
  expect(failure.status).toBe(503);
  expect(await failure.json()).toMatchObject({ error: { code: "DEPENDENCY_UNAVAILABLE" } });
});
