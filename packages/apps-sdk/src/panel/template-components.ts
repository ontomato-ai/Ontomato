import { defineAsyncComponent, type App, type Component, type ComponentOptions } from "vue";
import loaders from "apps-sdk:element-components";

const directives = {
  "v-loading": () => import("element-plus/es/components/loading/index").then(module => module.ElLoading),
  "v-infinite-scroll": () => import("element-plus/es/components/infinite-scroll/index").then(module => module.ElInfiniteScroll),
  "v-popover": () => import("element-plus/es/components/popover/index").then(module => module.ElPopoverDirective),
};

function templateNames(template: ComponentOptions["template"]) {
  const names = new Set<string>();
  const scan = (fragment: DocumentFragment) => {
    for (const element of fragment.querySelectorAll("*")) {
      names.add(element.localName);
      const is = element.getAttribute("is");
      if (is) names.add(is.toLowerCase());
      for (const attr of element.getAttributeNames()) names.add(attr.split(/[.:]/, 1)[0]!);
      if (element instanceof HTMLTemplateElement) scan(element.content);
    }
  };
  const element = document.createElement("template");
  element.innerHTML = typeof template === "string"
    ? (template.startsWith("#") ? document.querySelector(template)?.innerHTML ?? "" : template)
    : (template instanceof Element ? template.innerHTML : "");
  scan(element.content);
  return names;
}

/**
 * Static tags get the actual components before rendering, including children a parent inspects in its slots: Element
 * Plus's and the SDK's own (`own`), so a layout around the panel's projections never holds the first draw back for one
 * more fetch. A tag the template does not name loads at its first render.
 */
export async function prepareTemplateComponents(template: ComponentOptions["template"], own: Readonly<Record<string, () => Promise<Component>>>) {
  const names = templateNames(template);
  const components = Object.entries({ ...loaders, ...own }).map(async ([name, load]) => {
    const tag = name.replace(/(?!^)[A-Z]/g, letter => "-" + letter).toLowerCase();
    const used = names.has(tag) || names.has(name.toLowerCase());
    // Tags resolved dynamically by Vue can still load the component at first render.
    return [name, used ? await load() : defineAsyncComponent(load)] as const;
  });
  const [resolved, plugins] = await Promise.all([
    Promise.all(components),
    Promise.all(Object.entries(directives).filter(([name]) => names.has(name)).map(([, load]) => load())),
  ]);
  return (app: App) => {
    for (const [name, component] of resolved) app.component(name, component);
    for (const plugin of plugins) app.use(plugin);
  };
}
