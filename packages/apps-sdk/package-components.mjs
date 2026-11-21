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
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generatePackageComponents, runPackageComponents } from "./package-components-generator.mjs";

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

export async function packageComponents(options) {
  return generatePackageComponents(options, await contract());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPackageComponents(process.argv.slice(2), await contract());
}
