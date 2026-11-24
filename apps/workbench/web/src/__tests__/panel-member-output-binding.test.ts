import { afterEach, expect, it, vi } from "vitest";
import { computed, defineComponent, h, ref } from "vue";
import { createI18n } from "vue-i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { panelAddress, type ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { USER } from "@ontomato/contracts/platform-object-types";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import { panelModuleFor, useMemberData, useMemberOutput, usePanelOutput, type DirectPanelMount } from "../../../../../packages/apps-sdk/src/direct";
import { directRun, noOperations } from "./panel-frame";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
});

it("wires a member's draft to reactive props and reads without exposing it as public state", async () => {
  const draft = ref<RuntimeJsonValue>({
    function: { code: "initial" },
    "a/b": [{ "~code": "escaped" }],
  });
  const publisher = defineComponent({
    setup() {
      useMemberOutput("draft", () => draft.value);
      return () => h("div");
    },
  });
  const reader = defineComponent({
    props: ["code", "whole", "escaped", "invalidIndex"],
    setup(props) {
      useMemberData("options");
      return () => h("output", { id: "bound" }, JSON.stringify([props.code, props.whole, props.escaped, props.invalidIndex]));
    },
  });
  const base = {
    domainId: "d", ownerId: "o", createdAt: "", updatedAt: "", editable: false,
    visibility: "domain" as const, description: "", revision: 1, config: {}, outputs: {},
  };
  const form: DirectProjection = { ...base, id: "form", name: "Form", componentId: "domain-component:form", inputs: {}, data: {} };
  const consumer: DirectProjection = {
    ...base, id: "reader", name: "Reader", componentId: "domain-component:reader",
    inputs: { code: { kind: "scalar", type: "string" }, whole: { kind: "json" }, escaped: { kind: "json" }, invalidIndex: { kind: "json" } },
    data: { options: { source: { type: { kind: "PlatformObjectType", id: USER } }, read: "options", params: { keyword: { input: "code" } } } },
  };
  const output = { member: "form", name: "draft" };
  const manifest = definePanel({
    state: { selected: { type: { kind: "scalar", type: "string" }, deepLink: true } },
    members: {
      form: { target: { projectionId: form.id } },
      reader: {
        target: { projectionId: consumer.id },
        inputs: {
          code: { output: { ...output, path: "/function/code" } },
          whole: { output },
          escaped: { output: { ...output, path: "/a~1b/0/~0code" } },
          invalidIndex: { output: { ...output, path: "/a~1b/00/~0code" } },
        },
      },
    },
  });
  const seenCodes: RuntimeJsonValue[] = [];
  const addresses: string[] = [];
  const element = document.createElement("div");
  document.body.append(element);
  let mount!: DirectPanelMount;
  const projections = { form, reader: consumer };
  const { mountPanel } = panelModuleFor({
    manifest, element, template: '<Projection slot="form"/><Projection slot="reader"/><output id="published">{{ published }}</output>',
    run: directRun({
      pageKey: "bindings", url: () => "/bindings?selected=A", label: () => "Bindings", initial: { selected: "A" },
      state: (state) => { addresses.push(panelAddress("/bindings", state, manifest)); },
    }),
    mounted: (value) => { mount = value; dispose = value.dispose; },
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })); },
    messages: {}, locale: ref("en"), defaultLocale: "en", use: null,
    requests: { request: async () => { throw new Error("This test sends reads through the panel read port"); } },
    ...noOperations,
    readProjection: async (id) => {
      const projection = projections[id as keyof typeof projections];
      return {
        projection,
        domainComponent: { domainId: "d", componentId: projection.componentId, revision: 1, source: { template: "<div/>" } },
      };
    },
    loadDomainComponent: async ({ componentId }) => componentId === form.componentId ? publisher : reader,
    read: async (request): Promise<ProductPanelReadResponse> => {
      if (request.operations) return { status: "ready", value: {} };
      seenCodes.push(request.inputs.code ?? null);
      return { status: "ready", value: { options: [] } };
    },
  });
  const { context } = await mountPanel({
    setup() {
      const published = usePanelOutput("form", "draft");
      return { published: computed(() => JSON.stringify(published.value)) };
    },
  });

  await vi.waitFor(() => {
    expect(element.querySelector("#bound")?.textContent).toBe(JSON.stringify(["initial", draft.value, "escaped", null]));
    expect(seenCodes).toContain("initial");
  });
  draft.value = { function: { code: "revised" } };
  await vi.waitFor(() => {
    expect(element.querySelector("#bound")?.textContent).toBe(JSON.stringify(["revised", draft.value, null, null]));
    expect(element.querySelector("#published")?.textContent).toBe(JSON.stringify(draft.value));
    expect(seenCodes.at(-1)).toBe("revised");
  });
  draft.value = { function: null };
  await vi.waitFor(() => {
    expect(element.querySelector("#bound")?.textContent).toBe(JSON.stringify([null, draft.value, null, null]));
    expect(seenCodes.at(-1)).toBeNull();
  });
  expect(context.instance.state.values.value).toEqual({ selected: "A" });
  expect(mount.publicState()).toEqual({ selected: "A" });
  expect(addresses.at(-1)).toBe("/bindings?selected=A");
  expect(() => mount.setState!({ code: "injected" })).toThrow(/no field 'code'/u);
  expect(() => context.instance.memberParam("reader", "code").set("injected")).toThrow(/cannot be set/u);
});
