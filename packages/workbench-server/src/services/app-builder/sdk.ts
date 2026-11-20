import { readFile } from "node:fs/promises";
import path from "node:path";
import { appsSdkBuildSchema, appsSdkReleaseManifestSchema, type AppsSdkCurrent } from "@ontomato/contracts/apps-sdk";
import { bundledAppsSdkDir } from "../../content/layout";
import { environment } from "../../config/environment";

export const APPS_SDK_CURRENT_PATH = "/apps-sdk/current";

export async function appSdkBuild() {
  return appsSdkBuildSchema.parse(JSON.parse(await readFile(bundledAppsSdkDir("current.json"), "utf8")));
}

export async function readCurrentAppSdkRelease() {
  const build = await appSdkBuild();
  const directory = bundledAppsSdkDir(build.version);
  const manifest = appsSdkReleaseManifestSchema.parse(JSON.parse(await readFile(path.join(directory, "sdk.json"), "utf8")));
  const publicBasePath = environment.publicBasePath();
  return { build, directory, manifest, publicBasePath, sdkBasePath: `${publicBasePath}${APPS_SDK_CURRENT_PATH}` };
}

/** Reads the catalogue and identity of the same shipped release. Its consumer owns the catalogue schema. */
export async function readCurrentAppSdkComponents() {
  const { build, directory, manifest } = await readCurrentAppSdkRelease();
  const catalogue: unknown = JSON.parse(await readFile(path.join(directory, manifest.components), "utf8"));
  return { ...build, catalogue };
}

export async function currentAppSdk(): Promise<AppsSdkCurrent> {
  const { build, manifest, publicBasePath, sdkBasePath } = await readCurrentAppSdkRelease();
  return {
    ...build,
    publicBasePath,
    sdkBasePath,
    manifestPath: `${sdkBasePath}/sdk.json`,
    componentsPath: `${sdkBasePath}/${manifest.components}`,
    checkPath: `${sdkBasePath}/${manifest.check}`,
    docsPath: `${sdkBasePath}/${manifest.docs}`,
    referencePath: `${sdkBasePath}/docs/reference.md`,
  };
}
