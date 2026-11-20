import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { appsSdkBuildSchema, type AppsSdkCurrent } from "@ontomato/contracts/apps-sdk";
import { workspacePathSchema } from "@ontomato/contracts/workspaces";
import { installedAppsSdkDir, runtimeRoot } from "../../content/layout";
import { environment } from "../../config/environment";

const catalogueLocationSchema = z.object({ components: workspacePathSchema });
const sdkPathsSchema = catalogueLocationSchema.extend({ check: workspacePathSchema });

export async function appSdkBuild() {
  return appsSdkBuildSchema.parse(JSON.parse(await readFile(path.join(runtimeRoot(), "dist/apps-sdk/current.json"), "utf8")));
}
async function installedCurrentAppSdk() {
  const build = await appSdkBuild();
  const directory = path.join(installedAppsSdkDir(), build.version);
  const manifest: unknown = JSON.parse(await readFile(path.join(directory, "sdk.json"), "utf8"));
  return { build, directory, manifest };
}

/** Reads the catalogue served by the currently installed SDK. Its consumer owns the catalogue schema. */
export async function readCurrentAppSdkComponents() {
  const { build, directory, manifest } = await installedCurrentAppSdk();
  const { components } = catalogueLocationSchema.parse(manifest);
  const catalogue: unknown = JSON.parse(await readFile(path.join(directory, components), "utf8"));
  return { ...build, catalogue };
}

export async function currentAppSdk(): Promise<AppsSdkCurrent> {
  const { build, manifest } = await installedCurrentAppSdk();
  const { components, check } = sdkPathsSchema.parse(manifest);
  const publicBasePath = environment.publicBasePath();
  const sdkBasePath = `${publicBasePath}/apps-sdk/${build.version}`;
  return {
    ...build,
    publicBasePath,
    sdkBasePath,
    manifestPath: `${sdkBasePath}/sdk.json`,
    componentsPath: `${sdkBasePath}/${components}`,
    checkPath: `${sdkBasePath}/${check}`,
    docsPath: `${sdkBasePath}/docs/index.md`,
    referencePath: `${sdkBasePath}/docs/reference.md`,
  };
}
