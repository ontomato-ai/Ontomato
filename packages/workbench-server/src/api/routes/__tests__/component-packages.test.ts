import express from "express";
import AdmZip from "adm-zip";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { COMPONENT_PACKAGES_PATH, componentPackageResponseSchema } from "@ontomato/contracts/component-packages";
import { writeBundledAppSdkFixture } from "../../../__tests__/fixtures/bundled-app-sdk";
import { installContentLayout } from "../../../content/layout";
import { HttpError } from "../../../utils/errors";
import { errorHandler } from "../../middleware";
import { createComponentPackagesRouter, mountComponentPackageAssets } from "../component-packages";

const name = "@example/testing";
const namePath = encodeURIComponent(name);
const cataloguePath = COMPONENT_PACKAGES_PATH + "/" + namePath;
const entry = "dist/entry.mjs";
const componentId = name + ":Example";
const checkUpgrade = vi.fn();
let root: string;
let server: Server;
let base: string;

function release(version = "1.0.0", exportName = "Example") {
  return {
    "package.json": JSON.stringify({
      name, version, author: "Example",
      scripts: { postinstall: "This release never runs npm hooks" },
      ontomato: { entries: { [name]: entry }, components: "components.json", styles: ["dist/theme.css"] },
    }),
    "components.json": JSON.stringify([{
      componentId, module: name, exportName, role: "presentation", meaning: "Test component",
      data: {}, ports: { props: [], events: [], slots: [] },
    }]),
    [entry]: 'export { Example } from "./chunk.mjs";',
    "dist/chunk.mjs": 'export const Example = { icon: new URL("./icon.svg", import.meta.url) }; throw new Error("Installing must not evaluate modules");',
    "dist/theme.css": '.example { background-image: url("./mark.svg"); }',
    "dist/mark.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
    "dist/icon.svg": "<svg/>",
  };
}

function upload(files: Record<string, string>, mode: "inspect" | "install", format: "directory" | "zip") {
  const form = new FormData();
  form.set("mode", mode);
  if (format === "directory") {
    for (const [path, content] of Object.entries(files)) form.append("files", new Blob([content]), path);
  } else {
    const zip = new AdmZip();
    for (const [path, content] of Object.entries(files)) zip.addFile(path, Buffer.from(content));
    form.set("archive", new Blob([Uint8Array.from(zip.toBuffer())], { type: "application/zip" }), "release.zip");
  }
  return form;
}

function post(body: FormData, keeper = true) {
  return fetch(base + COMPONENT_PACKAGES_PATH + "/install", {
    method: "POST", body, headers: { "x-test-maintainer": String(keeper) },
  });
}

beforeEach(async () => {
  checkUpgrade.mockReset().mockResolvedValue([]);
  root = await mkdtemp(join(tmpdir(), "component-packages-"));
  await writeBundledAppSdkFixture(root);
  installContentLayout({ runtimeRoot: root, publicSkillsRoot: root, prompts: [], runtimeResources: [] });
  const app = express();
  mountComponentPackageAssets(app);
  app.use(COMPONENT_PACKAGES_PATH, createComponentPackagesRouter((req, _res, next) => {
    next(req.header("x-test-maintainer") === "true" ? undefined : new HttpError(403, "Deployment maintenance required", "FORBIDDEN"));
  }, checkUpgrade));
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = "http://127.0.0.1:" + (server.address() as { port: number }).port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

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
  }];
  checkUpgrade.mockResolvedValueOnce(changes);
  const candidate = { ...release(), "dist/mark.svg": "<svg id=\"next\"/>" };
  const refused = await post(upload(candidate, "install", "directory"));
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ code: "COMPONENT_PACKAGE_INCOMPATIBLE", details: { package: name, changes } });
  expect(await (await fetch(base + cataloguePath)).json()).toEqual(previous);

  const next = await post(upload(candidate, "install", "directory"));
  expect(next.status).toBe(200);
  const current = componentPackageResponseSchema.parse(await next.json());
  expect(current.digest).not.toBe(previous.digest);
  expect((await fetch(base + previous.artifactRoot + entry)).status).toBe(404);
  expect(await (await fetch(base + current.artifactRoot + "dist/mark.svg")).text()).toBe(candidate["dist/mark.svg"]);
});
