import { createApp, h, provide, type App } from "vue";
import * as panelEntry from "../entries/panel";
import { baseComponents } from "../base-components";
import { panelContextKey } from "./context";
import { directPanelContext } from "./direct";
import { mountDirectPanel, type DirectPanelMount, type DirectPanelMountOptions } from "./direct-mount";
import DirectProjection, { directMountKey } from "./direct-projection";
import type { PanelComponent, PanelMount } from "./mount";
import { prepareTemplateComponents } from "./template-components";

/*
 * A panel written with code, run in the platform's own document (big main's ruling, 2026-11-20): reviewed code runs
 * directly, and the frame is the deployment's switch for code that is not. The author writes what a frame runs —
 * `panel.html`'s template and `panel.mjs`, which mounts its component with `mountPanel` — and the module runs here on the
 * platform's own Vue and SDK: the instance, its reads (through Node's `/read`), a person's operations, drafts and the
 * conversation entry are a directly rendered panel's, not a second copy.
 *
 * Each run is one evaluation of the panel's module, whose `@ontomato/sdk/panel` the host resolves to this run's own
 * module: the SDK's panel API, with `mountPanel` mounting into this run's element and `<Projection>` drawing this run's
 * members. Nothing of a run is global, so the same panel twice on a page, or two panels at once, keep their own state.
 */

/** What the host gives one run of a panel's module, and how it receives the run once the module mounted. */
export interface DirectPanelComponentPort extends DirectPanelMountOptions {
  /** The element in the platform's document the panel's component mounts into. */
  element: HTMLElement;
  /** The panel's HTML (the inside of its `#app`): the root template of a component that carries none. */
  template: string;
  /** The platform's own words and Element Plus's configuration, which the members' components read. */
  install(app: App): void;
  /** The run, once the module mounted: the host drives it as a directly rendered panel; disposing it unmounts. */
  mounted(mount: DirectPanelMount): void;
}

/** One run's `@ontomato/sdk/panel`: the SDK's panel API, with `mountPanel` and `<Projection>` bound to this run. */
export type DirectPanelModuleExports = Omit<typeof panelEntry, "mountPanel" | "Projection"> & {
  mountPanel(component: PanelComponent): Promise<PanelMount>;
  Projection: typeof DirectProjection;
};

export function panelModuleFor(port: DirectPanelComponentPort): DirectPanelModuleExports {
  let mounted = false;
  return {
    ...panelEntry,
    Projection: DirectProjection,
    async mountPanel(component) {
      if (mounted) throw new Error("A panel's module mounts its component once");
      mounted = true;
      return await mountDirectPanelComponent(component, port);
    },
  };
}

/** Mounts a panel's component into the host's element, as the run of a directly rendered panel. */
async function mountDirectPanelComponent(component: PanelComponent, port: DirectPanelComponentPort): Promise<PanelMount> {
  // Vue takes the panel's HTML for its root, as a frame takes its document's `#app`.
  const root = typeof component !== "function" && !component.render && !component.template
    ? { ...component, template: port.template }
    : component;
  const installTemplateComponents = await prepareTemplateComponents(typeof root === "function" ? undefined : root.template, baseComponents);
  const mount = mountDirectPanel(port);
  const context = directPanelContext(mount.instance);
  const app = createApp({
    setup: () => {
      provide(panelContextKey, context);
      provide(directMountKey, mount);
      return () => h(root);
    },
  });
  // The one global a panel's HTML and module need, as in a frame: `<Projection slot="…"/>`.
  // eslint-disable-next-line vue/multi-word-component-names
  app.component("Projection", DirectProjection);
  // The panel's own words, as its HTML reads them: `{{ t("settings.title") }}`. The platform's words stay `$t`.
  app.config.globalProperties.t = context.t;
  app.config.errorHandler = port.run.failed;
  installTemplateComponents(app);
  port.install(app);
  app.mount(port.element);
  port.mounted({
    ...mount,
    dispose() {
      app.unmount();
      mount.dispose();
    },
  });
  return {
    context,
    get appContext(): never {
      throw new Error("The platform context of a hosted application is a panel frame's; a panel run in the platform's document has none");
    },
  };
}
