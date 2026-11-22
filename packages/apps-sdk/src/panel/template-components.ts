import { defineAsyncComponent, type App, type Component, type ComponentOptions, type Directive } from "vue";
import loaders from "apps-sdk:element-components";

interface DirectiveRegistration {
  readonly name: string;
  readonly directive: Directive;
  readonly bindContext?: (app: App) => void;
}

const directives: Readonly<Record<string, () => Promise<DirectiveRegistration>>> = {
  "v-sdk-loading": () => import("element-plus/es/components/loading/index").then(module => ({
    name: "sdk-loading",
    directive: module.ElLoading.directive,
    bindContext: (app) => {
      // Share the panel app's context with the loading overlay without calling `app.use(ElLoading)`,
      // which would also register the legacy `v-loading` directive and `$loading` global.
      (module.ElLoading.directive as Directive & { _context?: App["_context"] })._context = app._context;
    },
  })),
  "v-sdk-infinite-scroll": () => import("element-plus/es/components/infinite-scroll/index").then(module => ({
    name: "sdk-infinite-scroll",
    directive: module.ElInfiniteScroll,
  })),
  "v-sdk-popover": () => import("element-plus/es/components/popover/index").then(module => ({
    name: "sdk-popover",
    directive: module.ElPopoverDirective,
  })),
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
 * Static tags get the actual components before rendering, including children a parent inspects in its slots: the SDK's
 * `<sdk-*>` UI primitives and base components (`own`), so a layout around the panel's projections never holds the first
 * draw back for one more fetch. A tag the template does not name loads at its first render. Only `<sdk-*>` UI
 * primitives and `v-sdk-*` directives are registered; legacy `<el-*>` tags and `v-loading` are not registered.
 */
export async function prepareTemplateComponents(template: ComponentOptions["template"], own: Readonly<Record<string, () => Promise<Component>>>) {
  const names = templateNames(template);
  const components = Object.entries({ ...loaders, ...own }).map(async ([name, load]) => {
    const tag = name.replace(/(?!^)[A-Z]/g, letter => "-" + letter).toLowerCase();
    const used = names.has(tag) || names.has(name.toLowerCase());
    // Tags resolved dynamically by Vue can still load the component at first render.
    return [name, used ? await load() : defineAsyncComponent(load)] as const;
  });
  const [resolved, resolvedDirectives] = await Promise.all([
    Promise.all(components),
    Promise.all(Object.entries(directives).filter(([name]) => names.has(name)).map(([, load]) => load())),
  ]);
  return (app: App) => {
    for (const [name, component] of resolved) app.component(name, component);
    for (const { name, directive, bindContext } of resolvedDirectives) {
      bindContext?.(app);
      app.directive(name, directive);
    }
  };
}
