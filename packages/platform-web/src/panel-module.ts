import * as Vue from "vue";
import { init, parse } from "es-module-lexer";
import type { CompilerOptions } from "@vue/compiler-dom";

/*
 * A panel written with code, run in the platform's own document (big main's ruling, 2026-11-20). Its author writes what
 * a framed panel's author writes — a Vue template in `panel.html`, with one `<style>` block, and a `panel.mjs` that calls
 * `mountPanel(component)` — and the platform runs it on its own Vue and its own SDK: the template is compiled on demand,
 * and the module's bare imports name the platform's modules. Each instance runs its module once, at an address of its
 * own, with an SDK of its own whose `mountPanel` is bound to that instance's host port; nothing is shared through a
 * global that two instances could race for.
 */

/** The platform's Vue compiles a template the way Vue's full build does, once the first panel with one runs. */
let compiler: Promise<void> | undefined;
export function useTemplateCompiler(): Promise<void> {
  return compiler ??= import("@vue/compiler-dom").then(({ compile }) => {
    Vue.registerRuntimeCompiler((template: string | object, options?: CompilerOptions) => {
      const { code } = compile(template as string, { hoistStatic: true, ...options });
      return new Function("Vue", code)(Vue);
    });
  });
}

/** The modules an instance's module may import by name, each one's namespace by its specifier. */
export type PanelModules = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

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
 * Runs a panel's module once, with its bare imports naming `modules`. It resolves when the module has run — a panel's
 * module awaits its `mountPanel` — and refuses one that imports anything the platform does not give it.
 */
export async function runPanelModule(source: string, modules: PanelModules): Promise<void> {
  await init;
  const run = `panel-${++instances}`;
  const addresses = new Map<string, string>();
  for (const [specifier, namespace] of Object.entries(modules)) {
    const key = `${run}:${specifier}`;
    evaluating.set(key, namespace);
    addresses.set(specifier, namespaceModule(key, namespace));
  }
  try {
    const [imports] = parse(source);
    let rewritten = "", last = 0;
    for (const entry of imports) {
      // `import.meta` names no module.
      if (entry.specifier === null) continue;
      const address = entry.specifier === undefined ? undefined : addresses.get(entry.specifier);
      if (!address) throw new Error(`A panel's module imports ${entry.specifier ?? "a computed module"}, which the platform does not give it`);
      rewritten += source.slice(last, entry.start) + address;
      last = entry.end;
    }
    rewritten += source.slice(last);
    await import(/* @vite-ignore */ `data:text/javascript;charset=utf-8,${encodeURIComponent(rewritten)}`);
  } finally {
    for (const specifier of Object.keys(modules)) evaluating.delete(`${run}:${specifier}`);
  }
}
