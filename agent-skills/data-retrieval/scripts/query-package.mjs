import { readFile, lstat } from "node:fs/promises";
import path from "node:path";

export function packagePath(name) {
  if (typeof name !== "string" || !name || name.startsWith("/") || /[\\:]/.test(name) ||
      name.split("/").some((part) => !part || part === "." || part === ".."))
    throw new Error("Expected a package-relative file path: " + name);
  return name;
}
async function source(root, name) {
  packagePath(name);
  let target = root;
  for (const part of name.split("/")) {
    target = path.join(target, part);
    const stat = await lstat(target).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      throw new Error(`Package file ${name} not found at ${path.join(root, name)}; paths are relative to the manifest's directory`);
    });
    if (stat.isSymbolicLink()) throw new Error("Package links are not allowed: " + name);
  }
  if (!(await lstat(target)).isFile()) throw new Error("Expected a package file: " + name);
  return { path: name, content: await readFile(target, "utf8") };
}
/** Collect only explicitly declared source files; never include exploration output. */
export async function collectPackage(filename) {
  const absolute = path.resolve(filename.replace(/^@/, ""));
  if ((await lstat(absolute)).isSymbolicLink()) throw new Error("Package links are not allowed");
  const text = await readFile(absolute, "utf8"), value = JSON.parse(text);
  if (value.schema !== "ontomato.query-package.v1") {
    if (!value.answer?.steps) throw new Error("Expected an ontology DSL or query-package manifest");
    return { manifest: {
      schema: "ontomato.query-package.v1", entry: { kind: "dsl", query: "main" },
      queries: { main: "query.json" }, modules: [], parameterDefs: [], parameterBindings: [], computation: null,
    }, files: [{ path: "query.json", content: text }] };
  }
  const manifest = value;
  const paths = [...Object.values(manifest.queries), ...manifest.modules,
    ...(manifest.entry.kind === "python" ? [manifest.entry.path] : [])];
  if (new Set(paths).size !== paths.length) throw new Error("Duplicate package paths");
  const files = await Promise.all(paths.map((name) => source(path.dirname(absolute), name)));
  return { manifest, files };
}
