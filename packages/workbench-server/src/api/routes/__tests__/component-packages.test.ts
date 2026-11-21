import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { componentPackageResponseSchema } from "@ontomato/contracts/component-packages";
import { cataloguePath, componentId, entry, name, release, startComponentPackageServer, upload } from "../../../__tests__/fixtures/component-packages";
import { HttpError } from "../../../utils/errors";

const checkUpgrade = vi.fn();
let server: Awaited<ReturnType<typeof startComponentPackageServer>>;
let base: string;

function post(body: FormData, keeper = true) {
  return server.post(body, { "x-test-maintainer": String(keeper) });
}

beforeEach(async () => {
  checkUpgrade.mockReset().mockResolvedValue([]);
  server = await startComponentPackageServer({
    authenticate: (_req, _res, next) => next(),
    requireDeploymentMaintenance: (req, _res, next) => {
      next(req.header("x-test-maintainer") === "true" ? undefined : new HttpError(403, "Deployment maintenance required", "FORBIDDEN"));
    },
  }, checkUpgrade);
  base = server.base;
});

afterEach(() => server.close());

it("inspects a directory and installs the same ZIP without evaluating the package", async () => {
  const files = release();
  const inspected = await post(upload(files, "inspect", "directory"));
  expect(inspected.status, await inspected.clone().text()).toBe(200);
  const preview = componentPackageResponseSchema.parse(await inspected.json());
  expect((await fetch(base + cataloguePath)).status).toBe(404);
  expect((await fetch(base + preview.artifactRoot + entry)).status).toBe(404);

  const installed = await post(upload(files, "install", "zip"));
  expect(installed.status, await installed.clone().text()).toBe(200);
  expect(await installed.json()).toEqual(preview);
  const catalogue = await fetch(base + cataloguePath);
  expect(catalogue.status).toBe(200);
  expect(await catalogue.json()).toEqual(preview);
  expect(preview.components.map(({ componentId }) => componentId)).toEqual([componentId]);
  const asset = await fetch(base + preview.artifactRoot + entry);
  expect(asset.status).toBe(200);
  expect(asset.headers.get("content-type")).toContain("javascript");
  expect(await asset.text()).toBe(files[entry]);
  expect(checkUpgrade).not.toHaveBeenCalled();
});

it.each(["inspect", "install"] as const)("refuses %s for a caller without deployment maintenance permission", async mode => {
  const response = await post(upload(release(), mode, "zip"), false);
  expect(response.status).toBe(403);
  expect((await fetch(base + cataloguePath)).status).toBe(404);
});

it("identifies a declared export missing from the entry without enabling the package", async () => {
  const response = await post(upload(release("1.0.0", "Missing"), "install", "zip"));
  expect(response.status).toBe(400);
  expect((await response.text())).toMatch(/@example\/testing:Example.*Missing/u);
  expect((await fetch(base + cataloguePath)).status).toBe(404);
});

it.each([
  ["dist/mark.svg", "dist/theme.css"],
  ["dist/icon.svg", "dist/chunk.mjs"],
] as const)("requires the relative resource %s referenced by %s", async (resource, file) => {
  const { [resource]: _missing, ...files } = release();
  const response = await post(upload(files, "install", "zip"));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: `${file}: release file '${resource}' is missing`,
  });
  expect((await fetch(base + cataloguePath)).status).toBe(404);
});

it("keeps the current release after a referenced upgrade conflict and serves only the enabled digest", async () => {
  const first = await post(upload(release(), "install", "zip"));
  expect(first.status).toBe(200);
  const previous = componentPackageResponseSchema.parse(await first.json());
  const changes = [{
    component: componentId, field: "inputs.value", before: { kind: "scalar", type: "string" },
    projectionIds: ["projection"], panelIds: ["panel"],
    projections: [{ id: "projection", domainId: "domain" }], panels: [{ id: "panel", domainId: "domain" }],
  }];
  checkUpgrade.mockResolvedValueOnce(changes);
  const candidate = { ...release(), "dist/mark.svg": "<svg id=\"next\"/>" };
  const refused = await post(upload(candidate, "install", "directory"));
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ code: "COMPONENT_PACKAGE_INCOMPATIBLE", details: { package: name, scope: "deployment", changes } });
  expect(await (await fetch(base + cataloguePath)).json()).toEqual(previous);

  const next = await post(upload(candidate, "install", "directory"));
  expect(next.status).toBe(200);
  const current = componentPackageResponseSchema.parse(await next.json());
  expect(current.digest).not.toBe(previous.digest);
  expect((await fetch(base + previous.artifactRoot + entry)).status).toBe(404);
  expect(await (await fetch(base + current.artifactRoot + "dist/mark.svg")).text()).toBe(candidate["dist/mark.svg"]);
});
