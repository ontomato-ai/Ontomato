import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { appsSdkBuildSchema, type AppsSdkCurrent } from "@ontomato/contracts/apps-sdk";
import { workspacePathSchema } from "@ontomato/contracts/workspaces";
import { installedAppsSdkDir, runtimeRoot } from "../../content/layout";
import { environment } from "../../config/environment";

const catalogueLocationSchema = z.object({ components: workspacePathSchema });

export async function appSdkBuild() {
  return appsSdkBuildSchema.parse(JSON.parse(await readFile(path.join(runtimeRoot(), "dist/apps-sdk/current.json"), "utf8")));
}
async function installedCurrentAppSdk() {
  const build = await appSdkBuild();
  const directory = path.join(installedAppsSdkDir(), build.version);
  const manifest = JSON.parse(await readFile(path.join(directory, "sdk.json"), "utf8"));
  const { components } = catalogueLocationSchema.parse(manifest);
  return { build, directory, components };
}

/** Reads the catalogue served by the currently installed SDK. Its consumer owns the catalogue schema. */
export async function readCurrentAppSdkComponents() {
  const { build, directory, components } = await installedCurrentAppSdk();
  const catalogue: unknown = JSON.parse(await readFile(path.join(directory, components), "utf8"));
  return { ...build, catalogue };
}

export async function currentAppSdk(): Promise<AppsSdkCurrent> {
  const { build, components } = await installedCurrentAppSdk();
  const publicBasePath = environment.publicBasePath();
  const sdkBasePath = `${publicBasePath}/apps-sdk/${build.version}`;
  return {
    ...build,
    publicBasePath,
    sdkBasePath,
    manifestPath: `${sdkBasePath}/sdk.json`,
    componentsPath: `${sdkBasePath}/${components}`,
    docsPath: `${sdkBasePath}/docs/index.md`,
    referencePath: `${sdkBasePath}/docs/reference.md`,
  };
}
