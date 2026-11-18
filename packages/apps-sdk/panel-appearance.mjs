import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const appearanceId = "apps-sdk:panel-appearance";

/** Generate each panel locale from the same edition that supplies the hosted-app SDK. */
export async function panelAppearance(editionSource) {
  const result = await build({
    configFile: false,
    root: here,
    define: { "window.__APP_CONFIG__": "undefined", localStorage: "undefined" },
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      lib: { entry: editionSource, formats: ["es"] },
    },
  });
  const { default: { brand, language, managerMessages } } = await import(
    "data:text/javascript;base64," + Buffer.from(result[0].output[0].code).toString("base64"),
  );
  const loaders = Object.fromEntries(language.supported.map(locale => [locale, `${appearanceId}/${locale}`]));
  const modules = new Map(language.supported.map(locale => [loaders[locale], {
    messages: { ...language.messages[locale], ontology: managerMessages[locale].ontology },
    elementLocale: language.elementLocale(locale),
  }]));
  return {
    name: "apps-sdk-panel-appearance",
    resolveId(id) {
      if (id === appearanceId || modules.has(id)) return "\0" + id;
    },
    load(id) {
      if (id === "\0" + appearanceId) {
        return [
          `export const brand = ${JSON.stringify(brand)};`,
          `export const defaultLocale = ${JSON.stringify(language.defaultLocale)};`,
          `export const locales = {${Object.entries(loaders).map(([locale, module]) =>
            `${JSON.stringify(locale)}: () => import(${JSON.stringify(module)}).then(module => module.default)`).join(",")}};`,
        ].join("\n");
      }
      const locale = modules.get(id.slice(1));
      if (locale) return `export default ${JSON.stringify(locale)};`;
    },
  };
}
