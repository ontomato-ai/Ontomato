import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export function currentSdkClient({ workbenchUrl, headers }) {
  async function get(url) {
    const response = await fetch(url, { headers, redirect: "error" });
    if (!response.ok) {
      throw new Error(`GET ${url} failed: ${response.status} ${await response.text()}`);
    }
    return response;
  }

  function read(release, relativePath) {
    const sdkPath = release.sdkBasePath.slice(release.publicBasePath.length);
    const base = new URL(workbenchUrl);
    base.pathname = `${base.pathname.replace(/\/$/u, "")}${sdkPath}/`;
    const url = new URL(relativePath, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
      throw new Error(`Path is outside the current SDK: ${relativePath}`);
    }
    return get(url);
  }

  return {
    async current() {
      return (await get(`${workbenchUrl}/api/apps-sdk/current`)).json();
    },
    read,
    async check(release) {
      const checkFile = release.checkPath.slice(release.sdkBasePath.length + 1);
      const bytes = await (await read(release, checkFile)).arrayBuffer();
      // The SDK publishes one self-contained Node module. Workspace sources are only read as text.
      return import(`data:text/javascript;base64,${Buffer.from(bytes).toString("base64")}`);
    },
    async components(release) {
      const file = release.componentsPath.slice(release.sdkBasePath.length + 1);
      return (await read(release, file)).json();
    },
  };
}

export async function installedPanelSdk(directory) {
  const root = resolve(directory);
  const prefix = root.endsWith(sep) ? root : root + sep;
  const releaseFile = file => {
    const location = resolve(root, file);
    if (!location.startsWith(prefix)) throw new Error(`Path is outside the installed SDK: ${file}`);
    return location;
  };
  const manifest = JSON.parse(await readFile(releaseFile("sdk.json"), "utf8"));
  const [checks, components] = await Promise.all([
    import(pathToFileURL(releaseFile(manifest.check)).href),
    readFile(releaseFile(manifest.components), "utf8"),
  ]);
  return { checks, catalogue: JSON.parse(components), version: manifest.version };
}
