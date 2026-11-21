#!/usr/bin/env node
// Writes a component package's components.json from its sources (product-layer standard, component packages): each
// component's meaning, data and configuration from its `defineComponentMeta` declaration, its props, events and slots
// read from its Vue source by the same extractor the SDK's own catalogue is built with — so a package's catalogue and
// the official one describe components alike. Nothing here runs the package's code.
//
//   node package-components.mjs <package root> --catalogue <file> --tsconfig <file> --source <specifier>=<source entry>…
//
// `--catalogue` is a TypeScript file exporting `components = [defineComponentMeta({...})]` (componentId without the
// package name; it is added); each `--source` names one of the package's `ontomato.entries` and the source file whose
// exports that entry builds. The file written is the one the package's `ontomato.components` names.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { checkCatalogue, componentMetadata, componentPorts } from "./reference.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The package contract's schemas, read from the contract's own sources as the SDK build reads them. */
async function contract() {
  const contractsRequire = createRequire(join(HERE, "../contracts/package.json"));
  const { register } = await import(pathToFileURL(contractsRequire.resolve("tsx/esm/api")).href);
  const unregister = register();
  try {
    return await import("../contracts/src/component-packages.ts");
  } finally {
    unregister();
  }
}

export async function packageComponents({ root, catalogue, tsconfig, sources }) {
  const { componentPackageComponentsSchema, componentPackageManifestSchema } = await contract();
  const manifest = componentPackageManifestSchema.parse(JSON.parse(readFileSync(join(root, "package.json"), "utf8")));
  for (const specifier of Object.keys(sources))
    if (!Object.hasOwn(manifest.ontomato.entries, specifier))
      throw new Error(`--source ${specifier}: the package's ontomato.entries declare ${Object.keys(manifest.ontomato.entries).join(", ")}`);
  const entries = Object.entries(sources).map(([specifier, source]) => ({ specifier, source }));
  const declared = componentMetadata({ tsconfig, source: resolve(root, catalogue) });
  checkCatalogue(entries, declared, root, tsconfig);
  const ports = componentPorts({ root, tsconfig, entries });
  const components = componentPackageComponentsSchema.parse(declared.map(({ metadata, line }) => {
    if (metadata.componentId.includes(":"))
      throw new Error(`${catalogue}:${line}: write the component's own name; the package name '${manifest.name}' is added`);
    const found = ports.get(`${metadata.module}#${metadata.exportName}`);
    if (!found) throw new Error(`${catalogue}:${line}: no --source exports ${metadata.exportName} as module ${metadata.module}`);
    return {
      ...metadata, componentId: `${manifest.name}:${metadata.componentId}`,
      ...(found.props.length ? { config: found.props } : {}), ports: found,
    };
  }));
  const out = join(root, manifest.ontomato.components);
  writeFileSync(out, `${JSON.stringify(components, null, 2)}\n`);
  return { out, components };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { catalogue: { type: "string" }, tsconfig: { type: "string" }, source: { type: "string", multiple: true } },
  });
  const [root] = positionals;
  if (!root || !values.catalogue || !values.tsconfig || !values.source?.length)
    throw new Error("Usage: package-components.mjs <package root> --catalogue <file> --tsconfig <file> --source <specifier>=<source entry>…");
  const sources = Object.fromEntries(values.source.map((pair) => {
    const at = pair.indexOf("=");
    if (at < 1) throw new Error(`--source ${pair}: write <specifier>=<source entry>`);
    return [pair.slice(0, at), pair.slice(at + 1)];
  }));
  const { out, components } = await packageComponents({ root: resolve(root), catalogue: values.catalogue, tsconfig: resolve(root, values.tsconfig), sources });
  console.log(`${out}: ${components.length} components`);
}
