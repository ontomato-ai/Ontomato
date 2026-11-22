/* eslint-disable vue/one-component-per-file -- test doubles define inline member components */
import { afterEach, expect, it, vi } from "vitest";
import { computed, createApp, defineComponent, h, onMounted, provide, ref, type Component } from "vue";
import { createI18n } from "vue-i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DomainComponentRuntime } from "@ontomato/contracts/domain-components";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { OBJECT_TYPE, PRODUCT_PROJECTION } from "@ontomato/contracts/platform-object-types";
import { panelModuleFor, type DirectPanelMount } from "../../../../../packages/apps-sdk/src/direct";
import type { PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import { createPanelInstance } from "../../../../../packages/apps-sdk/src/panel/instance";
import { panelContextKey, type PanelContext } from "../../../../../packages/apps-sdk/src/panel/context";
import Projection from "../../../../../packages/apps-sdk/src/panel/Projection.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { directRun, noOperations } from "./panel-frame";

/*
 * Two failure-isolation boundaries for panel members:
 * 1. An ObjectForm placed without a bound state input (such as a projection catalogue preview slot) waits quietly in
 *    DataState's `awaiting` state instead of throwing `slotState` and crashing in `onMounted`; when its edit input is
 *    supplied as a literal, it reads that object instead.
 * 2. A member component that throws in `setup` or `onMounted` stays contained inside its own PanelMember / Projection
 *    error boundary rather than escaping to `app.config.errorHandler` and taking down the whole panel.
 */

const base = {
  domainId: "d", ownerId: "o", createdAt: "", updatedAt: "", editable: false,
  visibility: "domain" as const, description: "", revision: 1,
};
const classFormProjection: DirectProjection = {
  ...base, id: "class-form", name: "Class form", componentId: "@ontomato/sdk:ObjectForm",
  inputs: { cls: { kind: "object", objectType: OBJECT_TYPE }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
  outputs: {}, config: {},
  data: { form: { source: { object: { input: "cls" } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
  operations: { save: { operation: { kind: "PlatformOperation", id: `${OBJECT_TYPE}.save` }, target: { input: "cls" } } },
};
const saveDescriptor = {
  kind: "form.save", handlerRef: `${OBJECT_TYPE}.save`, label: "Save", effect: "write",
  target: { source: "input", input: "cls" }, inputSchema: {}, resultSchema: {}, batch: false,
};
const okProjection: DirectProjection = {
  ...base, id: "ok-member", name: "OK", componentId: "domain-component:ok-widget",
  inputs: {}, outputs: {}, config: {}, data: {},
};
const brokenSetupProjection: DirectProjection = {
  ...base, id: "broken-setup", name: "Broken setup", componentId: "domain-component:broken-setup",
  inputs: {}, outputs: {}, config: {}, data: {},
};
const brokenMountProjection: DirectProjection = {
  ...base, id: "broken-mount", name: "Broken mount", componentId: "domain-component:broken-mount",
  inputs: {}, outputs: {}, config: {}, data: {},
};

const domainRuntimes: Record<string, DomainComponentRuntime> = {
  "ok-member": { domainId: "d", componentId: "domain-component:ok-widget", revision: 1, source: { template: "<p>ok</p>" } },
  "broken-setup": { domainId: "d", componentId: "domain-component:broken-setup", revision: 1, source: { template: "<p>broken</p>" } },
  "broken-mount": { domainId: "d", componentId: "domain-component:broken-mount", revision: 1, source: { template: "<p>broken</p>" } },
};

const domainComponents: Record<string, Component> = {
  "domain-component:ok-widget": defineComponent({
    name: "OkWidget",
    setup: () => () => h("p", { class: "ok-widget" }, "Sibling intact"),
  }),
  "domain-component:broken-setup": defineComponent({
    name: "BrokenSetupWidget",
    setup() {
      throw new Error("Setup exploded");
    },
  }),
  "domain-component:broken-mount": defineComponent({
    name: "BrokenMountWidget",
    setup() {
      onMounted(() => {
        throw new Error("Mount exploded");
      });
      return () => h("p", { class: "mounted-before-crash" }, "Before crash");
    },
  }),
};

const projectionsById: Record<string, DirectProjection> = {
  "class-form": classFormProjection,
  "ok-member": okProjection,
  "broken-setup": brokenSetupProjection,
  "broken-mount": brokenMountProjection,
};

function mountCodedPanel(
  manifest: DirectPanelManifest,
  template: string,
  initial: Record<string, unknown> = {},
  answer?: (request: PanelMemberReadRequest) => ProductPanelReadResponse,
) {
  const reads: PanelMemberReadRequest[] = [];
  const failed = vi.fn();
  const element = document.createElement("div");
  document.body.append(element);
  let mounted!: (mount: DirectPanelMount) => void;
  const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
  const module = panelModuleFor({
    mounted,
    element,
    template,
    install: (app) => {
      app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } }));
    },
    manifest,
    run: directRun({
      pageKey: "projections", url: () => "/ontology/projections", label: () => "Projections",
      initial: initial as never, failed,
    }),
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: {
      request: async (path) => {
        const id = /^\/product-projections\/(.+)$/.exec(path)?.[1];
        const projection = id ? projectionsById[id] : undefined;
        if (!projection) throw new Error(`Nothing at ${path}`);
        const domainComponent = domainRuntimes[id!];
        return Response.json(domainComponent ? { projection, domainComponent } : { projection });
      },
    },
    loadDomainComponent: async (runtime) => {
      const component = domainComponents[runtime.componentId];
      if (!component) throw new Error(`No component for ${runtime.componentId}`);
      return component;
    },
    use: { applicationId: "app-ontology", useId: "projections" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> => {
      reads.push(request);
      if (answer) return answer(request);
      if (request.operations) return { status: "ready", value: { save: saveDescriptor } as never };
      return { status: "ready", value: {} as never };
    },
  });
  return { module, mount, element, reads, failed };
}

afterEach(() => {
  document.body.innerHTML = "";
});

it("renders awaiting without throwing when ObjectForm has no bound input state", async () => {
  const manifest: DirectPanelManifest = {
    state: {
      selected: { type: { kind: "object", objectType: PRODUCT_PROJECTION }, personal: false, deepLink: true, external: false },
    },
    members: {
      ok: { target: { projectionId: "ok-member" } },
      preview: { target: { fromState: "selected", candidates: { rule: "usable" } } },
    },
    commands: {},
  };
  const { module, mount, element, reads, failed } = mountCodedPanel(
    manifest,
    `<section class="host-shell"><Projection slot="ok"/><Projection slot="preview"/></section>`,
    { selected: { className: PRODUCT_PROJECTION, primaryKey: "class-form" } },
  );
  await module.mountPanel({});

  await vi.waitFor(() => {
    expect(element.querySelector('[data-member="preview"] .sdk-owner-form [data-state="awaiting"]')).not.toBeNull();
  });
  expect(element.querySelector('[data-member="ok"] .ok-widget')?.textContent).toBe("Sibling intact");
  expect(reads.filter((read) => read.dataName === "form")).toEqual([]);
  expect(failed).not.toHaveBeenCalled();
  (await mount).dispose();
});

it("reads the object from slot.inputs when ObjectForm binds a literal input instead of panel state", async () => {
  const manifest: DirectPanelManifest = {
    state: {},
    members: {
      preview: {
        target: { projectionId: "class-form" },
        inputs: { cls: { literal: { className: OBJECT_TYPE, primaryKey: "person" } } },
      },
    },
    commands: {},
  };
  const { module, mount, element, failed } = mountCodedPanel(
    manifest,
    `<Projection slot="preview"/>`,
    {},
    (request) => {
      if (request.operations) return { status: "ready", value: { save: saveDescriptor } as never };
      const cls = request.inputs.cls as { primaryKey: string };
      return {
        status: "ready",
        value: {
          fields: [{ path: "/name", label: "Name", control: { kind: "text" }, valueSchema: {}, required: false, readOnly: false }],
          values: { name: cls.primaryKey },
          errors: [],
          revision: 1,
          save: { method: "PUT", path: "/classes/:id", bodySchema: {}, draftOperation: `${OBJECT_TYPE}.save` },
        } as never,
      };
    },
  );
  await module.mountPanel({});

  await vi.waitFor(() => {
    expect(element.querySelector<HTMLInputElement>('[data-member="preview"] [data-field="/name"] input')?.value).toBe("person");
  });
  expect(failed).not.toHaveBeenCalled();
  (await mount).dispose();
});

it("contains a member component error thrown in setup inside PanelMember without failing the host panel", async () => {
  const manifest: DirectPanelManifest = {
    state: {},
    members: {
      ok: { target: { projectionId: "ok-member" } },
      broken: { target: { projectionId: "broken-setup" } },
    },
    commands: {},
  };
  const { module, mount, element, failed } = mountCodedPanel(
    manifest,
    `<section class="host-shell"><Projection slot="ok"/><Projection slot="broken"/></section>`,
  );
  await module.mountPanel({});

  await vi.waitFor(() => {
    expect(element.querySelector('[data-member="broken"] .fui-data-state-error [role="alert"]')?.textContent?.trim()).toBe("Setup exploded");
  });
  expect(element.querySelector('[data-member="ok"] .ok-widget')?.textContent).toBe("Sibling intact");
  expect(failed).not.toHaveBeenCalled();
  (await mount).dispose();
});

it("contains a member component error thrown in onMounted inside PanelMember without failing the host panel", async () => {
  const manifest: DirectPanelManifest = {
    state: {},
    members: {
      ok: { target: { projectionId: "ok-member" } },
      broken: { target: { projectionId: "broken-mount" } },
    },
    commands: {},
  };
  const { module, mount, element, failed } = mountCodedPanel(
    manifest,
    `<section class="host-shell"><Projection slot="ok"/><Projection slot="broken"/></section>`,
  );
  await module.mountPanel({});

  await vi.waitFor(() => {
    expect(element.querySelector('[data-member="broken"] .fui-data-state-error [role="alert"]')?.textContent?.trim()).toBe("Mount exploded");
  });
  expect(element.querySelector('[data-member="ok"] .ok-widget')?.textContent).toBe("Sibling intact");
  expect(failed).not.toHaveBeenCalled();
  (await mount).dispose();
});

it("contains a projection component error inside Projection without bubbling to the host error handler", async () => {
  // An ObjectForm projection with no operations fails synchronously in useProjectionForm during setup.
  const brokenForm: DirectProjection = {
    ...classFormProjection,
    id: "broken-form",
    operations: {},
  };
  const manifest: DirectPanelManifest = {
    state: {},
    members: { broken: { target: { projectionId: brokenForm.id } } },
    commands: {},
  };
  const text = createPanelText({}, ref("en"), "en");
  const instance = createPanelInstance(manifest, {
    pageKey: "frame-test", url: () => "/frame-test", label: () => "Frame", initial: {},
    text,
    readProjection: async () => brokenForm,
    ...noOperations,
    recordDraftCreated: async () => {},
  });
  const context: PanelContext = {
    get panel(): never { throw new Error("unused"); },
    manifest,
    instance,
    currentEntry: computed(() => null),
    entryMenu: computed(() => null),
    projection: async () => brokenForm,
    invoke: async () => null,
    projectionsChanged: () => () => {},
    draft: instance.draft,
    holdUnsaved: () => () => {},
    t: text,
    resources: async () => {},
    expandPageComposer: async () => {},
    navigate: async () => {},
    notify: () => {},
    readPanelData: async () => ({ status: "ready", value: {} as never }),
  };
  const appError = vi.fn();
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({
    setup() {
      provide(panelContextKey, context);
      return () => h("div", { class: "frame-host" }, [h("p", { class: "host-title" }, "Frame intact"), h(Projection, { slot: "broken" })]);
    },
  });
  app.config.errorHandler = appError;
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).mount(element);

  await vi.waitFor(() => {
    expect(element.querySelector('[role="alert"]')?.textContent).toContain("names no operation");
  });
  expect(element.querySelector(".host-title")?.textContent).toBe("Frame intact");
  expect(appError).not.toHaveBeenCalled();
  app.unmount();
});
