import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { appsSdkComponentCatalogSchema, appsSdkReleaseManifestSchema } from "@ontomato/contracts/apps-sdk";
import { components } from "../../../../apps-sdk/src/catalogue";

/** Writes the current SDK files needed by Workbench integration tests, using the real component declarations. */
export async function writeBundledAppSdkFixture(runtimeRoot: string): Promise<string> {
  const version = "sdk-test-release";
  const sdkRoot = path.join(runtimeRoot, "dist/apps-sdk");
  const directory = path.join(sdkRoot, version);
  const manifest = appsSdkReleaseManifestSchema.parse({
    version,
    product: "ontomato",
    executionContext: 1,
    hostTransport: 1,
    messageBridge: 2,
    entries: { "@ontomato/sdk/panel": "panel.js" },
    stylesheet: "styles/sdk.css",
    components: "components.json",
    check: "node/panel-check.mjs",
    libraries: {},
    docs: "docs/index.md",
  });
  const catalogue = appsSdkComponentCatalogSchema.parse({
    version,
    components: components.map(component => ({ ...component, ports: { props: [], events: [], slots: [] } })),
  });
  const cataloguePath = path.join(directory, manifest.components);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(path.join(sdkRoot, "current.json"), JSON.stringify({ version, digest: "a".repeat(64) })),
    writeFile(path.join(directory, "sdk.json"), JSON.stringify(manifest)),
    writeFile(cataloguePath, JSON.stringify(catalogue)),
  ]);
  return cataloguePath;
}
