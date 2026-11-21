import AdmZip from "adm-zip";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { z } from "zod";
import { runtimeRelativePathSchema } from "@ontomato/contracts/agent-runtime-values";
import {
  componentPackageComponentsSchema, componentPackageManifestSchema, componentPackageResponseSchema,
  type ComponentPackageInstallRequest, type ComponentPackageResponse,
} from "@ontomato/contracts/component-packages";
import { readModuleFacts } from "@ontomato/contracts/panel-module";
import { environment } from "../../config/environment";
import { HttpError } from "../../utils/errors";
import { readCurrentAppSdkRelease } from "../app-builder/sdk";

export const componentPackageAssetsPath = "/apps-sdk/component-packages";
const moduleFile = /\.(?:m?js)$/iu;
const absoluteAsset = /^(?:[a-z][a-z0-9+.-]*:|\/|#)/iu;
type ModuleFacts = Awaited<ReturnType<typeof readModuleFacts>>;
type Files = Map<string, Uint8Array>;

function invalid(message: string): never {
  throw new HttpError(400, message, "COMPONENT_PACKAGE_INVALID");
}

function parse<S extends z.ZodTypeAny>(schema: S, value: unknown, source: string): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0]!;
  invalid(`${source}${issue.path.length ? "." + issue.path.join(".") : ""}: ${issue.message}`);
}

function unzip(bytes: Uint8Array) {
  try {
    return new AdmZip(Buffer.from(bytes)).getEntries().flatMap(entry => {
      const name = entry.entryName;
      if (!runtimeRelativePathSchema.safeParse(name.replace(/\/$/u, "")).success ||
          ((entry.attr >>> 16) & 0o170000) === 0o120000)
        invalid(`Invalid ZIP entry '${name}'`);
      return entry.isDirectory ? [] : [{ path: name, bytes: entry.getData() }];
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    invalid(`Cannot read component package ZIP: ${String(error)}`);
  }
}

function releaseFiles(request: ComponentPackageInstallRequest): Files {
  const files = new Map<string, Uint8Array>();
  for (const { path, bytes } of "archive" in request ? unzip(request.archive) : request.files) {
    if (files.has(path)) invalid(`Duplicate release file '${path}'`);
    files.set(path, bytes);
  }
  for (const file of files.keys()) {
    let parent = posix.dirname(file);
    while (parent !== ".") {
      if (files.has(parent)) invalid(`Release path '${parent}' is both a file and a directory`);
      parent = posix.dirname(parent);
    }
  }
  return files;
}

function requireFile(files: Files, path: string, from: string): Uint8Array {
  const bytes = files.get(path);
  if (!bytes) invalid(`${from}: release file '${path}' is missing`);
  return bytes;
}

function jsonFile(files: Files, path: string) {
  const text = Buffer.from(requireFile(files, path, path)).toString("utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    invalid(`${path}: ${String(error)}`);
  }
}

function relativeFile(files: Files, ref: string, from: string) {
  let decoded: string;
  try { decoded = decodeURIComponent(ref.split(/[?#]/u, 1)[0]!); }
  catch { invalid(`${from}: invalid relative file reference '${ref}'`); }
  const localPath = posix.normalize(posix.join(posix.dirname(from), decoded));
  if (posix.isAbsolute(decoded) || !runtimeRelativePathSchema.safeParse(localPath).success)
    invalid(`${from}: relative reference '${ref}' is outside the release`);
  requireFile(files, localPath, from);
  return localPath;
}

function stylesheetReferences(source: string) {
  const declarations = source.replace(/\/\*[\s\S]*?\*\//gu, "");
  const references = /(?:\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))|@import\s+(?:"([^"]*)"|'([^']*)'))/giu;
  return Array.from(declarations.matchAll(references), match =>
    match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? "").filter(ref => ref && !absoluteAsset.test(ref));
}

async function validateFiles(files: Files, release: ComponentPackageResponse) {
  const sdk = await readCurrentAppSdkRelease();
  const official = sdk.manifest.entries;
  if (Object.keys(official).some(specifier => specifier === release.name || specifier.startsWith(release.name + "/")))
    invalid(`Package '${release.name}' conflicts with the official SDK`);

  function resolve(specifier: string, from: string) {
    if (specifier.startsWith("./") || specifier.startsWith("../")) return relativeFile(files, specifier, from);
    if (Object.hasOwn(release.entries, specifier)) return release.entries[specifier]!;
    if (Object.hasOwn(official, specifier)) return undefined;
    invalid(`${from}: module '${specifier}' is outside the release and official SDK entries`);
  }

  const parsedModules = new Map<string, ModuleFacts>();
  async function visit(module: string) {
    if (parsedModules.has(module)) return;
    const source = Buffer.from(requireFile(files, module, "Module")).toString("utf8");
    let facts: ModuleFacts;
    try { facts = await readModuleFacts(source, module); }
    catch (error) { invalid(`${module}: invalid JavaScript module: ${String(error)}`); }
    parsedModules.set(module, facts);
    for (const { specifier, start, end } of facts.imports) {
      if (specifier === null) {
        // Bundlers use this form for emitted assets. The lexer identifies the real import.meta token.
        if (/^\s*\.url\s*\)/u.test(source.slice(end))) {
          const match = /\bnew\s+URL\s*\(\s*(?:"([^"\\]*)"|'([^'\\]*)')\s*,\s*$/u.exec(source.slice(0, start));
          const ref = match?.[1] ?? match?.[2];
          if (ref && !absoluteAsset.test(ref)) relativeFile(files, ref, module);
        }
        continue;
      }
      if (specifier === undefined) invalid(`${module}: cannot verify a computed import`);
      const dependency = resolve(specifier, module);
      if (dependency && moduleFile.test(dependency)) await visit(dependency);
    }
  }
  for (const [specifier, entry] of Object.entries(release.entries)) {
    if (!moduleFile.test(entry)) invalid(`Entry '${specifier}' must name a JavaScript module`);
    await visit(entry);
  }

  function exportsName(module: string, name: string, visited = new Set<string>()): boolean {
    if (visited.has(module)) return false;
    const path = new Set(visited).add(module);
    for (const fact of parsedModules.get(module)?.exports ?? []) {
      if (fact.typeOnly) continue;
      if (fact.type === "reexport-all") {
        if (name === "default") continue;
        const dependency = resolve(fact.from, module);
        if (dependency && exportsName(dependency, name, path)) return true;
        continue;
      }
      if (fact.name !== name) continue;
      if (fact.type === "direct" || fact.importName === null) return true;
      const dependency = resolve(fact.from, module);
      if (dependency === undefined || exportsName(dependency, fact.importName, path)) return true;
    }
    return false;
  }
  for (const component of release.components) {
    if (!exportsName(release.entries[component.module]!, component.exportName))
      invalid(`Component '${component.componentId}': export '${component.exportName}' is missing from '${component.module}'`);
  }

  for (const path of release.styles ?? []) requireFile(files, path, "Stylesheet");
  for (const [path, bytes] of files) {
    if (!path.toLowerCase().endsWith(".css")) continue;
    for (const ref of stylesheetReferences(Buffer.from(bytes).toString("utf8"))) relativeFile(files, ref, path);
  }
}

export async function inspectComponentPackage(request: ComponentPackageInstallRequest) {
  const files = releaseFiles(request);
  const { name, version, author, ontomato } = parse(componentPackageManifestSchema, jsonFile(files, "package.json"), "package.json");
  const { components: componentFile, entries, styles } = ontomato;
  const components = parse(componentPackageComponentsSchema, jsonFile(files, componentFile), componentFile);
  const manifest = [...files.keys()].sort().map(path => [path, createHash("sha256").update(files.get(path)!).digest("hex")]);
  const digest = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  const artifactRoot = `${environment.publicBasePath()}${componentPackageAssetsPath}/${encodeURIComponent(name)}/${digest}/`;
  const release = parse(componentPackageResponseSchema, { name, version, author, digest, artifactRoot, components, entries, styles }, name);
  await validateFiles(files, release);
  return { release, files };
}
