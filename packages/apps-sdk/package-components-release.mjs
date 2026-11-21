import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));

/** Preserve the installed compiler packages and their declaration files, without pnpm links to the builder. */
export function installedPackageClosure(names) {
  const packages = new Map();
  function collect(name, importer) {
    const require = createRequire(importer);
    const manifest = require.resolve.paths(name).map(root => join(root, name, "package.json")).find(existsSync);
    if (!manifest) throw new Error(`Cannot resolve component compiler dependency '${name}'`);
    const source = realpathSync(manifest);
    const previous = packages.get(name);
    if (previous) {
      if (source !== previous) throw new Error(`Component compiler resolves two copies of '${name}'`);
      return;
    }
    packages.set(name, source);
    const { dependencies = {} } = JSON.parse(readFileSync(source, "utf8"));
    for (const dependency of Object.keys(dependencies)) collect(dependency, source);
  }
  for (const name of names) collect(name, import.meta.url);
  return packages;
}

export function writePackageComponentsRelease(root, entry, checker) {
  const files = [];
  const add = (name, path) => files.push([name, readFileSync(path).toString("base64")]);
  function addDirectory(from, to) {
    for (const child of readdirSync(from, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      if (child.isDirectory()) addDirectory(join(from, child.name), to + "/" + child.name);
      else add(to + "/" + child.name, join(from, child.name));
    }
  }
  for (const [name, path] of installedPackageClosure(["typescript", "vue-component-meta", "vue"]))
    addDirectory(dirname(path), "node_modules/" + name);
  add("panel-check.mjs", join(root, checker));
  add("reference.mjs", join(here, "reference.mjs"));
  add("package-components-generator.mjs", join(here, "package-components-generator.mjs"));
  const payload = gzipSync(JSON.stringify(files), { level: 9 }).toString("base64");

  writeFileSync(join(root, entry), `#!/usr/bin/env node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const directory = await mkdtemp(join(tmpdir(), "ontomato-package-components-"));
try {
  const files = JSON.parse(gunzipSync(Buffer.from(${JSON.stringify(payload)}, "base64")));
  for (const [name, bytes] of files) {
    const file = join(directory, name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(bytes, "base64"));
  }
  const schemas = await import(pathToFileURL(join(directory, "panel-check.mjs")).href);
  const { runPackageComponents } = await import(pathToFileURL(join(directory, "package-components-generator.mjs")).href);
  runPackageComponents(process.argv.slice(2), schemas);
} finally {
  await rm(directory, { recursive: true, force: true });
}
`);
}
