import { init, parse } from "es-module-lexer";

/** The module namespaces supplied by the direct panel host. */
export const panelModuleSpecifiers = {
  vue: "vue",
  sdk: "@ontomato/sdk/panel",
} as const;

export type PanelModuleSpecifier = typeof panelModuleSpecifiers[keyof typeof panelModuleSpecifiers];

function isPanelModuleSpecifier(specifier: string | undefined): specifier is PanelModuleSpecifier {
  return Object.values(panelModuleSpecifiers).some(allowed => allowed === specifier);
}

/** Validate the imports and return the exact spans the direct host can replace with its module URLs. */
export async function panelModuleImports(source: string) {
  await init;
  return parse(source)[0].flatMap(({ specifier, type, start, end }) => {
    if (specifier === null) return [];
    if (!isPanelModuleSpecifier(specifier)) {
      throw new Error(`A panel's module imports ${specifier ?? "a computed module"}, which the platform does not give it`);
    }
    return [{ specifier, start, end, dynamic: type === "dynamic" }];
  });
}
