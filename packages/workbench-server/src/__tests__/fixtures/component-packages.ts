import AdmZip from "adm-zip";
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { COMPONENT_PACKAGES_PATH, componentPackageResponseSchema } from "@ontomato/contracts/component-packages";
import { errorHandler } from "../../api/middleware";
import { createComponentPackagesRouter, mountComponentPackageAssets } from "../../api/routes/component-packages";
import { installContentLayout } from "../../content/layout";
import type { WorkbenchIdentity } from "../../identity/types";
import { configureI18n } from "../../i18n";
import { appTextEn } from "../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import type { CheckComponentPackageUpgrade } from "../../services/component-packages/store";
import { writeBundledAppSdkFixture } from "./bundled-app-sdk";

export const name = "@example/testing";
export const cataloguePath = COMPONENT_PACKAGES_PATH + "/" + encodeURIComponent(name);
export const entry = "dist/entry.mjs";
export const componentId = name + ":Example";

export function release(version = "1.0.0", exportName = "Example") {
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

export function upload(files: Record<string, string>, mode: "inspect" | "install", format: "directory" | "zip") {
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

export async function startComponentPackageServer(
  identity: Pick<WorkbenchIdentity, "authenticate" | "requireDeploymentMaintenance">,
  checkUpgrade?: CheckComponentPackageUpgrade,
) {
  const root = await mkdtemp(join(tmpdir(), "component-packages-"));
  await writeBundledAppSdkFixture(root);
  installContentLayout({ runtimeRoot: root, publicSkillsRoot: root, prompts: [], runtimeResources: [] });
  configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
    packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } } });

  const app = express();
  mountComponentPackageAssets(app);
  app.use(COMPONENT_PACKAGES_PATH, identity.authenticate,
    createComponentPackagesRouter(identity.requireDeploymentMaintenance, checkUpgrade));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  return {
    base,
    post(body: FormData, headers: Record<string, string>) {
      return fetch(base + COMPONENT_PACKAGES_PATH + "/install", { method: "POST", body, headers });
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function expectComponentPackageMaintenance(
  identity: Pick<WorkbenchIdentity, "authenticate" | "requireDeploymentMaintenance">,
  allowed: Record<string, string>,
  denied: readonly Record<string, string>[],
) {
  const server = await startComponentPackageServer(identity);
  try {
    for (const headers of denied) {
      const response = await server.post(upload(release(), "install", "zip"), headers);
      expect(response.status, await response.text()).toBe(403);
    }
    expect((await fetch(server.base + cataloguePath, { headers: allowed })).status).toBe(404);

    const installed = await server.post(upload(release(), "install", "zip"), allowed);
    expect(installed.status, await installed.clone().text()).toBe(200);
    const installedRelease = componentPackageResponseSchema.parse(await installed.json());
    expect(installedRelease.components.map(component => component.componentId)).toEqual([componentId]);
    const current = await fetch(server.base + cataloguePath, { headers: allowed });
    expect(current.status).toBe(200);
    expect(await current.json()).toEqual(installedRelease);
  } finally {
    await server.close();
  }
}
