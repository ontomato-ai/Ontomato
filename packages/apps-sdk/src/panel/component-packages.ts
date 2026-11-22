import type { Component } from "vue";
import type { ComponentPackageResponse } from "@ontomato/contracts/component-packages";
import { readModuleFacts } from "@ontomato/contracts/panel-module";

/*
 * A component a deployment installed from a third party's package (product-layer standard, component packages), drawn
 * like an official one: the package's current release names it (`<package>:<component>`), its declaration names the
 * module and export that draw it, and its styles are the release's own. There is no approval: the deployment installed
 * it, and this run loads it directly.
 *
 * The release's modules run against the platform's own running Vue and SDK — one instance of each, so the member context
 * a component reads is the one the panel gives it. Its files are read from the release and rewritten as the platform
 * runs a panel's module: an official entry it imports (`vue`, `@ontomato/sdk/panel`, …) names the live module; its own
 * relative files and its own entries are read and rewritten the same way; `import.meta` is the file's address in the
 * release, so what it fetches relative to itself is the release's. Anything else it imports is refused by name.
 */

/** Reads a package's current release and declarations, as the reader, from the platform. */
export type ComponentPackageReader = (name: string) => Promise<ComponentPackageResponse>;

/** The official entries a package's modules may import, by specifier, as the live modules this run has. */
const officialEntries: Readonly<Record<string, () => Promise<Readonly<Record<string, unknown>>>>> = {
  "vue": () => import("../entries/vue"),
  // The SDK's echarts entry re-exports the package as it is; its namespace is the package's own.
  "echarts": () => import("echarts") as Promise<Readonly<Record<string, unknown>>>,
  "@ontomato/sdk": () => import("../entries/sdk"),
  "@ontomato/sdk/ui": () => import("../entries/ui"),
  "@ontomato/sdk/panel": () => import("../entries/panel"),
  "@ontomato/sdk/base": () => import("../entries/base"),
  "@ontomato/sdk/graph": () => import("../entries/graph"),
  "@ontomato/sdk/chart": () => import("../entries/chart"),
  "@ontomato/sdk/markdown": () => import("../entries/markdown"),
  "@ontomato/sdk/form": () => import("../entries/form"),
  "@ontomato/sdk/code": () => import("../entries/code"),
  "@ontomato/sdk/preview": () => import("../entries/preview"),
  "@ontomato/sdk/chat": () => import("../entries/chat"),
};

type LiveModules = Map<string, Readonly<Record<string, unknown>>>;
const live = ((globalThis as { __ontomatoPackageModules?: LiveModules }).__ontomatoPackageModules ??= new Map());
const officialAddresses = new Map<string, Promise<string>>();

/** A module that re-exports one live official entry, by the names it has. */
function officialAddress(specifier: string): Promise<string> {
  let address = officialAddresses.get(specifier);
  if (!address) {
    address = officialEntries[specifier]!().then((namespace) => {
      live.set(specifier, namespace);
      const names = Object.keys(namespace).filter((name) => name !== "default" && /^[A-Za-z_$][\w$]*$/u.test(name));
      const source = `const m = globalThis.__ontomatoPackageModules.get(${JSON.stringify(specifier)});\n`
        + (names.length ? `export const { ${names.join(", ")} } = m;\n` : "")
        + ("default" in namespace ? "export default m.default;\n" : "");
      return `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
    });
    officialAddresses.set(specifier, address);
  }
  return address;
}

/** Each release's rewritten modules, by their address in the release: one rewrite per file however often imported. */
const rewritten = new Map<string, Promise<string>>();

/** One of the release's files, read and rewritten, as an address the browser imports; `through` is the chain that led here. */
function moduleAddress(release: ComponentPackageResponse, url: string, through: readonly string[]): Promise<string> {
  if (through.includes(url)) throw new Error(`Package '${release.name}' imports its own modules in a cycle: ${[...through, url].join(" → ")}`);
  let address = rewritten.get(url);
  if (!address) {
    address = rewrite(release, url, [...through, url]);
    rewritten.set(url, address);
  }
  return address;
}

async function rewrite(release: ComponentPackageResponse, url: string, through: readonly string[]): Promise<string> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Package '${release.name}' file ${url} could not be read (${response.status})`);
  const source = await response.text();
  const { imports } = await readModuleFacts(source, url);
  const root = new URL(release.artifactRoot, location.origin);
  const replacements = await Promise.all(imports.map(async (entry) => {
    if (entry.type === "import-meta") return { ...entry, text: `({ url: ${JSON.stringify(url)} })` };
    const specifier = entry.specifier;
    if (specifier === undefined || specifier === null)
      throw new Error(`Package '${release.name}' file ${url} imports a module it computes, which the platform cannot read ahead`);
    const address = Object.hasOwn(officialEntries, specifier) ? await officialAddress(specifier)
      : Object.hasOwn(release.entries, specifier) ? await moduleAddress(release, new URL(release.entries[specifier]!, root).href, through)
        : specifier.startsWith("./") || specifier.startsWith("../") ? await moduleAddress(release, new URL(specifier, url).href, through)
          : null;
    if (address === null) throw new Error(`Package '${release.name}' file ${url} imports '${specifier}', which is neither its own nor an official entry`);
    return { ...entry, text: entry.type === "dynamic" ? JSON.stringify(address) : address };
  }));
  let text = "", last = 0;
  for (const { start, end, text: replacement } of replacements.sort((a, b) => a.start - b.start)) {
    text += source.slice(last, start) + replacement;
    last = end;
  }
  text += source.slice(last);
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(text)}`;
}

/** Each release's styles, once: by digest, so a newer release's are added and its components drawn with them. */
const styled = new Set<string>();
function addStyles(release: ComponentPackageResponse) {
  if (styled.has(release.digest)) return;
  styled.add(release.digest);
  const root = new URL(release.artifactRoot, location.origin);
  for (const style of release.styles ?? []) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL(style, root).href;
    link.dataset.componentPackage = release.name;
    document.head.append(link);
  }
}

/** The package a component ID names: everything before its last `:`. */
export const packageOf = (componentId: string) => componentId.slice(0, componentId.lastIndexOf(":"));

/** The component an installed package's current release declares under `componentId`, loaded with its styles. */
export async function packageComponent(componentId: string, read: ComponentPackageReader): Promise<Component> {
  const release = await read(packageOf(componentId));
  const declaration = release.components.find((component) => component.componentId === componentId);
  if (!declaration)
    throw new Error(`Package '${release.name}' ${release.version} declares no component '${componentId}'; it declares ${release.components.map(({ componentId: id }) => id).join(", ")}`);
  addStyles(release);
  const root = new URL(release.artifactRoot, location.origin);
  const module = await import(/* @vite-ignore */ await moduleAddress(release, new URL(release.entries[declaration.module]!, root).href, [])) as Record<string, unknown>;
  const component = module[declaration.exportName];
  if (!component) throw new Error(`Package '${release.name}' module '${declaration.module}' has no export '${declaration.exportName}'`);
  return component as Component;
}
