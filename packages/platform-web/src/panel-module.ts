import * as Vue from "vue";
import {
  componentModuleImports, panelModuleImports, panelModuleSpecifiers,
  type ComponentOfficialSpecifier, type PanelModuleSpecifier,
} from "@ontomato/contracts/panel-module";
import type { CompilerOptions } from "@vue/compiler-dom";

/*
 * A panel written with code, run in the platform's own document (big main's ruling, 2026-11-20). Its author writes what
 * a framed panel's author writes — a Vue template in `panel.html`, with one `<style>` block, and a `panel.mjs` that calls
 * `mountPanel(component)` — and the platform runs it on its own Vue and its own SDK: the template is compiled on demand,
 * and the module's bare imports name the platform's modules. Each instance runs its module once, at an address of its
 * own, with an SDK of its own whose `mountPanel` is bound to that instance's host port; nothing is shared through a
 * global that two instances could race for.
 */

const MAX_TEMPLATE_CACHE_ENTRIES = 128;
const MAX_IMPORT_CACHE_ENTRIES = 128;
const templateCache = new Map<string, Vue.RenderFunction>();
const panelImportCache = new Map<string, Awaited<ReturnType<typeof panelModuleImports>>>();
const componentImportCache = new Map<string, Awaited<ReturnType<typeof componentModuleImports>>>();

export function clearPanelModuleCaches(): void {
  templateCache.clear();
  panelImportCache.clear();
  componentImportCache.clear();
}

function readLru<T>(cache: Map<string, T>, key: string): T | undefined {
  const value = cache.get(key);
  if (value !== undefined) {
    cache.delete(key);
    cache.set(key, value);
  }
  return value;
}

function writeLru<T>(cache: Map<string, T>, key: string, value: T, limit: number): T {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > limit) cache.delete(cache.keys().next().value!);
  return value;
}

// Preserve undefined properties and distinguish arrays from objects when building a key.
function serializeCompilerOption(value: unknown, ancestors = new Set<object>()): string | undefined {
  if (value === null) return "null";
  switch (typeof value) {
    case "string": return JSON.stringify(value);
    case "boolean":
    case "undefined": return String(value);
    case "number": return Object.is(value, -0) ? "-0" : String(value);
    case "bigint": return `${value}n`;
    case "object": break;
    default: return undefined;
  }

  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return undefined;
  if (ancestors.has(value)) return undefined;

  const properties = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(properties);
  if (!keys.every(key => typeof key === "string")) return undefined;

  ancestors.add(value);
  const entries: string[] = [];
  for (const key of keys.sort()) {
    const property = properties[key];
    const entry = Object.hasOwn(property, "value") ? serializeCompilerOption(property.value, ancestors) : undefined;
    if (entry === undefined) {
      ancestors.delete(value);
      return undefined;
    }
    entries.push(`${JSON.stringify(key)}:${property.enumerable ? "" : "!"}${entry}`);
  }
  ancestors.delete(value);
  const body = entries.join(",");
  if (array) return `[${body}]`;
  return `${prototype === null ? "null" : ""}{${body}}`;
}

/** The platform's Vue compiles a template the way Vue's full build does, once the first panel with one runs. */
let compiler: Promise<void> | undefined;
export function useTemplateCompiler(): Promise<void> {
  return compiler ??= import("@vue/compiler-dom").then(({ compile }) => {
    Vue.registerRuntimeCompiler((template: string | object, options?: CompilerOptions) => {
      const serializedOptions = typeof template === "string" ? serializeCompilerOption(options) : undefined;
      const key = typeof template === "string" && serializedOptions !== undefined
        ? `${template.length}:${template}${serializedOptions}`
        : undefined;
      if (key !== undefined) {
        const cached = readLru(templateCache, key);
        if (cached) return cached;
      }
      const { code } = compile(template as string, { hoistStatic: true, ...options });
      const render: Vue.RenderFunction & { _rc?: boolean } = new Function("Vue", code)(Vue);
      render._rc = true;
      if (key !== undefined) writeLru(templateCache, key, render, MAX_TEMPLATE_CACHE_ENTRIES);
      return render;
    });
  });
}

/** The modules an instance's module may import by name, each one's namespace by its specifier. */
export type PanelModules = Readonly<Record<PanelModuleSpecifier, Readonly<Record<string, unknown>>>>;

/** The namespaces the modules being evaluated read, by a key only their own addresses name. */
const evaluating = new Map<string, Readonly<Record<string, unknown>>>();
(globalThis as Record<string, unknown>).__ontomatoPanelModules = evaluating;
let instances = 0;

/** A module at an address of its own that re-exports one namespace. */
function namespaceModule(key: string, namespace: Readonly<Record<string, unknown>>) {
  const names = Object.keys(namespace).filter(name => name !== "default" && /^[A-Za-z_$][\w$]*$/u.test(name));
  const source = `const m = globalThis.__ontomatoPanelModules.get(${JSON.stringify(key)});\n`
    + (names.length ? `export const { ${names.join(", ")} } = m;\n` : "")
    + ("default" in namespace ? "export default m.default;\n" : "");
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
}

/**
 * Evaluates an author's module with its bare imports naming `modules` and returns its exports.
 * The module's import address belongs to this evaluation even if it has no imports.
 */
export async function evaluatePanelModule(source: string, modules: PanelModules): Promise<Record<string, unknown>> {
  const imports = readLru(panelImportCache, source)
    ?? writeLru(panelImportCache, source, await panelModuleImports(source), MAX_IMPORT_CACHE_ENTRIES);
  const run = `panel-${++instances}`;
  const specifiers = Object.values(panelModuleSpecifiers);
  const addresses = new Map<PanelModuleSpecifier, string>();
  for (const specifier of specifiers) {
    const namespace = modules[specifier];
    const key = `${run}:${specifier}`;
    evaluating.set(key, namespace);
    addresses.set(specifier, namespaceModule(key, namespace));
  }
  try {
    let rewritten = "", last = 0;
    for (const entry of imports) {
      const address = addresses.get(entry.specifier)!;
      rewritten += source.slice(last, entry.start) + (entry.dynamic ? JSON.stringify(address) : address);
      last = entry.end;
    }
    rewritten += source.slice(last);
    return await import(/* @vite-ignore */ `data:text/javascript;charset=utf-8,${encodeURIComponent(rewritten)}#${run}`);
  } finally {
    for (const specifier of specifiers) evaluating.delete(`${run}:${specifier}`);
  }
}


/** Evaluates an author-registered component module with lazy loaders for all official SDK specifiers. */
export async function evaluateComponentModule(
  source: string,
  loaders: Readonly<Record<ComponentOfficialSpecifier, () => Promise<Readonly<Record<string, unknown>>> | Readonly<Record<string, unknown>>>>,
): Promise<Record<string, unknown>> {
  const imports = readLru(componentImportCache, source)
    ?? writeLru(componentImportCache, source, await componentModuleImports(source, { allowRelative: false }), MAX_IMPORT_CACHE_ENTRIES);
  const run = `component-${++instances}`;
  const needed = [...new Set(imports.map(entry => entry.specifier as ComponentOfficialSpecifier))];
  const addresses = new Map<string, string>();
  const keys: string[] = [];
  try {
    for (const specifier of needed) {
      const namespace = await loaders[specifier]();
      const key = `${run}:${specifier}`;
      keys.push(key);
      evaluating.set(key, namespace);
      addresses.set(specifier, namespaceModule(key, namespace));
    }
    let rewritten = "", last = 0;
    for (const entry of imports) {
      const address = addresses.get(entry.specifier)!;
      rewritten += source.slice(last, entry.start) + (entry.dynamic ? JSON.stringify(address) : address);
      last = entry.end;
    }
    rewritten += source.slice(last);
    return await import(/* @vite-ignore */ `data:text/javascript;charset=utf-8,${encodeURIComponent(rewritten)}#${run}`);
  } finally {
    for (const key of keys) evaluating.delete(key);
  }
}

/** A panel module mounts into its run and returns any exports (supporting both `mountPanel` and `export default`). */
export async function runPanelModule(source: string, modules: PanelModules): Promise<Record<string, unknown>> {
  return await evaluatePanelModule(source, modules);
}
