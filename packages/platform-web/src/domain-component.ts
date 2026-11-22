import * as Vue from "vue";
import { useMember, useMemberData, useMemberOperations, useMemberParam, useMemberRead } from "@ontomato/apps-sdk/direct";
import type { DomainComponentRuntime } from "@ontomato/contracts/domain-components";
import { panelModuleSpecifiers } from "@ontomato/contracts/panel-module";
import { evaluatePanelModule, useTemplateCompiler } from "./panel-module";

const components = new Map<string, { source: DomainComponentRuntime["source"]; component: Promise<Vue.Component> }>();

async function load({ componentId, source }: DomainComponentRuntime): Promise<Vue.Component> {
  await useTemplateCompiler();
  if (source.module === undefined) return { template: source.template };
  const { default: component } = await evaluatePanelModule(source.module, {
    [panelModuleSpecifiers.vue]: Vue,
    [panelModuleSpecifiers.sdk]: { useMember, useMemberData, useMemberOperations, useMemberParam, useMemberRead },
  });
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
