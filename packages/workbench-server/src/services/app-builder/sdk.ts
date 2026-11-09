import { readFile } from "node:fs/promises";
import path from "node:path";
import { appsSdkBuildSchema, type AppsSdkCurrent } from "@ontomato/contracts/apps-sdk";
import { runtimeRoot } from "../../content/layout";
import { environment } from "../../config/environment";

export async function appSdkBuild() {
  return appsSdkBuildSchema.parse(JSON.parse(await readFile(path.join(runtimeRoot(), "dist/apps-sdk/current.json"), "utf8")));
}
export async function currentAppSdk(): Promise<AppsSdkCurrent> {
  const { version } = await appSdkBuild();
  const publicBasePath = environment.publicBasePath();
  const sdkBasePath = `${publicBasePath}/apps-sdk/${version}`;
  return { version, publicBasePath, sdkBasePath, manifestPath: `${sdkBasePath}/sdk.json`,
    docsPath: `${sdkBasePath}/docs/index.md`, referencePath: `${sdkBasePath}/docs/reference.md` };
}
