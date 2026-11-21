import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { checkCatalogue, componentMetadata, componentPorts } from "./reference.mjs";

export function generatePackageComponents({ root, catalogue, tsconfig, sources }, { componentPackageComponentsSchema, componentPackageManifestSchema }) {
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


export function runPackageComponents(args, schemas) {
  const { positionals, values } = parseArgs({
    args, allowPositionals: true,
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
  const { out, components } = generatePackageComponents({ root: resolve(root), catalogue: values.catalogue, tsconfig: resolve(root, values.tsconfig), sources }, schemas);
  console.log(`${out}: ${components.length} components`);
}
