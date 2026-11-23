import * as Vue from "vue";
import {
  useFormFieldSlot, useListRowSlot, useMember, useMemberData, useMemberOperations, useMemberOutput, useMemberParam,
  useMemberRead, usePanelOutput, usePanelOutputs,
} from "@ontomato/apps-sdk/direct";
import type { DomainComponentRuntime } from "@ontomato/contracts/domain-components";
import { SDK_UI_ENTRY_SPECIFIER } from "@ontomato/contracts/sdk-ui-map";
import type { ComponentOfficialSpecifier } from "@ontomato/contracts/panel-module";
import { evaluateComponentModule, useTemplateCompiler } from "./panel-module";

const components = new Map<string, { source: DomainComponentRuntime["source"]; component: Promise<Vue.Component> }>();

const officialLoaders: Readonly<Record<ComponentOfficialSpecifier, () => Promise<Readonly<Record<string, unknown>>> | Readonly<Record<string, unknown>>>> = {
  vue: () => Vue as unknown as Record<string, unknown>,
  "@ontomato/sdk": () => import("@ontomato/apps-sdk/sdk") as Promise<Record<string, unknown>>,
  [SDK_UI_ENTRY_SPECIFIER]: () => import("@ontomato/apps-sdk/ui") as Promise<Record<string, unknown>>,
  "@ontomato/sdk/panel": () => ({
    useMember, useMemberData, useMemberOperations, useMemberOutput, useMemberParam, useMemberRead,
    usePanelOutput, usePanelOutputs, useFormFieldSlot, useListRowSlot,
  }),
  "@ontomato/sdk/base": () => import("@ontomato/apps-sdk/base") as Promise<Record<string, unknown>>,
  "@ontomato/sdk/graph": () => import("@ontomato/apps-sdk/graph") as Promise<Record<string, unknown>>,
  "@ontomato/sdk/chart": () => import("@ontomato/apps-sdk/chart") as Promise<Record<string, unknown>>,
  "@ontomato/sdk/markdown": () => import("@ontomato/apps-sdk/markdown") as Promise<Record<string, unknown>>,
  "@ontomato/sdk/form": () => import("@ontomato/apps-sdk/form") as Promise<Record<string, unknown>>,
  "@ontomato/sdk/code": () => import("@ontomato/apps-sdk/code") as Promise<Record<string, unknown>>,
  "@ontomato/sdk/preview": () => import("@ontomato/apps-sdk/preview") as Promise<Record<string, unknown>>,
  "@ontomato/sdk/chat": () => import("@ontomato/apps-sdk/chat") as Promise<Record<string, unknown>>,
};

async function load({ componentId, source }: DomainComponentRuntime): Promise<Vue.Component> {
  await useTemplateCompiler();
  if (source.module === undefined) return { template: source.template };
  const { default: component } = await evaluateComponentModule(source.module, officialLoaders);
  if (!component || typeof component !== "object")
    throw new Error(`Component '${componentId}' must export Vue component options`);
  return { ...component, template: source.template };
}

export function loadDomainComponent(runtime: DomainComponentRuntime) {
  const key = JSON.stringify([runtime.domainId, runtime.componentId, runtime.revision]);
  const cached = components.get(key);
  if (cached?.source.template === runtime.source.template && cached.source.module === runtime.source.module) return cached.component;
  const component = load(runtime);
  components.set(key, { source: runtime.source, component });
  return component;
}
