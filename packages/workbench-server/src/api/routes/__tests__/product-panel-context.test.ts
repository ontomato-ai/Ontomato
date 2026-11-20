import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { pageSkillContextSchema } from "@ontomato/contracts/page-skills";
import { protectedSkillRef } from "../../../core/skills/providers";
import { HttpError } from "../../../utils/errors";

const mocks = vi.hoisted(() => ({ panel: vi.fn(), snapshot: vi.fn(), member: vi.fn() }));
vi.mock("../../../services/product-panels/operations", () => ({ ownPanelSettings: vi.fn() }));
vi.mock("../../../services/product-panels/current", () => ({ readCurrentPanelRecord: mocks.panel }));
vi.mock("../../../services/product-panels/definition-stream", () => ({ requirePanelDefinitions: mocks.snapshot }));
vi.mock("../../../services/skills/view", () => ({ readRegisteredPanelPageSkillContext: mocks.member }));
vi.mock("../../../utils/request-identity", async original => ({
  ...await original<typeof import("../../../utils/request-identity")>(),
  requireDomainId: () => "domain",
}));

import { productPanelsRouter } from "../product-panels";

const owner = { domainId: "domain", userId: "caller" };
const panel = { id: "P1", name: "Definition from owner", revision: 7 };
const snapshot = { panel: { id: panel.id, revision: panel.revision }, projections: [] };
const source = { kind: "application-use", applicationId: "app", useId: "use-1" };
const menu = { pageKey: "ontology-agents", permissionCode: "analysis-agent" };
const domain = { pageKey: "agent-directory", access: "domain-member" };
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
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/product-panels/${panel.id}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.panel.mockResolvedValue(panel);
  mocks.snapshot.mockResolvedValue(snapshot);
});
const read = (path: string, entrance: Record<string, string>) => fetch(base + path + "?" + new URLSearchParams({
  applicationId: source.applicationId, useId: source.useId, ...entrance,
}));

it.each([
  { path: "", loaded: panel, readOwner: mocks.panel, response: { panel }, entrance: menu },
  { path: "/snapshot", loaded: snapshot.panel, readOwner: mocks.snapshot, response: snapshot, entrance: domain },
])("resolves $path from the caller and the already read owner response", async ({ path, loaded, readOwner, response, entrance }) => {
  const ref = protectedSkillRef("product-panels", owner.domainId, panel.id);
  const pageSkillContext = { mode: "member", locator: entrance, member: { source, memberPath: [], ref } };
  mocks.member.mockResolvedValue(pageSkillContext);
  const result = await read(path, entrance);
  expect(result.status).toBe(200);
  const body = await result.json();
  pageSkillContextSchema.parse(body.pageSkillContext);
  expect(body).toEqual({ ...response, pageSkillContext });
  expect(readOwner).toHaveBeenCalledTimes(1);
  expect(mocks.member).toHaveBeenCalledTimes(1);
  expect(mocks.member).toHaveBeenCalledWith({
    domainId: owner.domainId, initiatorCredentials: expect.objectContaining({ token: "caller-token" }),
  }, entrance, source, loaded, expect.objectContaining({ id: "product-panels", findByUse: expect.any(Function) }));
  expect(mocks.member.mock.calls[0]![3]).toBe(loaded);
});

it.each(["", "/snapshot"])("keeps %s unchanged without query and refuses malformed intent before reads", async path => {
  expect(await (await fetch(base + path)).json()).toEqual(path ? snapshot : { panel });
  expect(mocks.member).not.toHaveBeenCalled();
  mocks.panel.mockClear();
  mocks.snapshot.mockClear();
  expect((await fetch(base + path + "?applicationId=app")).status).toBe(400);
  expect((await read(path, { ...menu, ...domain })).status).toBe(400);
  expect(mocks.panel).not.toHaveBeenCalled();
  expect(mocks.snapshot).not.toHaveBeenCalled();
  expect(mocks.member).not.toHaveBeenCalled();
});

it("returns member null on the same snapshot revision when the helper finds a normal mismatch", async () => {
  const pageSkillContext = { mode: "member", locator: menu, member: null };
  mocks.member.mockResolvedValue(pageSkillContext);
  expect(await (await read("/snapshot", menu)).json()).toEqual({ ...snapshot, pageSkillContext });
  expect(mocks.snapshot).toHaveBeenCalledTimes(1);
  expect(mocks.panel).not.toHaveBeenCalled();
});

it("propagates owner denial and source failure through the original error boundary", async () => {
  mocks.snapshot.mockRejectedValueOnce(new HttpError(403, "Panel unavailable", "FORBIDDEN"));
  expect((await read("/snapshot", menu)).status).toBe(403);
  expect(mocks.member).not.toHaveBeenCalled();
  mocks.member.mockRejectedValueOnce(new HttpError(503, "Source unavailable", "DEPENDENCY_UNAVAILABLE"));
  const failure = await read("", menu);
  expect(failure.status).toBe(503);
  expect(await failure.json()).toMatchObject({ error: { code: "DEPENDENCY_UNAVAILABLE" } });
});
