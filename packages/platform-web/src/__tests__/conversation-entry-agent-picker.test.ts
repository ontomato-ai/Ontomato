import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { createI18n } from "vue-i18n";
import { describe, expect, it, vi } from "vitest";
import { pageCounterKey, type AgentHostAgent, type PageCounter } from "@ontomato/agent-shell-ui";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { PanelContext } from "../../../apps-sdk/src/panel/context";
import { panelContextKey, projectionKey } from "../../../apps-sdk/src/panel/context";
import ConversationEntry from "../../../apps-sdk/src/base/ConversationEntry.vue";
import en from "../../../workbench-ui/src/locales/en";

/*
 * The inline conversation entry's agent picker: the generic entry draws the standard pill picker, and a page whose own
 * composer skin differs (the platform home's) supplies its picker through the `#agent-picker` slot instead — the entry
 * keeps no variant of its own.
 *
 * What this rules out: a page having to ask the generic component for a platform-specific picker style; the supplied
 * picker not receiving the page's agents, the current agent, the label, or the way to choose another.
 */

const i18n = createI18n({ legacy: false, locale: "en", messages: { en } });
const regular: AgentHostAgent = { id: "agent-regular", name: "Regular assistant", description: "", icon: null, enabled: true };
const governor: AgentHostAgent = { id: "agent-governance", name: "Governance", description: "", icon: null, enabled: true };

const projection: ProductProjection = {
  id: "proj-composer",
  domainId: "d",
  ownerId: "o",
  name: "Quick ask",
  description: "",
  visibility: "domain",
  revision: 1,
  editable: true,
  createdAt: "",
  updatedAt: "",
  componentId: "@ontomato/sdk:ConversationEntry",
  inputs: {},
  outputs: {},
  data: {},
  config: { presentation: "inline" },
};

function counter(ask = vi.fn()): PageCounter {
  return {
    agents: async () => [regular, governor],
    pageAgents: async () => ({ agents: [regular, governor], defaultAgentId: regular.id }),
    preferredAgentId: ref(null),
    ask,
  };
}

function mountEntry(slots: Record<string, string>) {
  return mount(ConversationEntry, {
    props: { presentation: "inline" },
    slots,
    global: {
      plugins: [i18n],
      provide: {
        [panelContextKey as symbol]: { t: (key: string) => key } as unknown as PanelContext,
        [projectionKey as symbol]: { slot: "askInline", projection },
        [pageCounterKey as symbol]: counter(),
      },
    },
  });
}

describe("the inline conversation entry's agent picker", () => {
  it("draws the standard pill picker when the page supplies none", async () => {
    const wrapper = mountEntry({});
    await flushPromises();
    expect(wrapper.find(".agent-switch.pill").exists()).toBe(true);
    expect(wrapper.text()).toContain(regular.name);
    wrapper.unmount();
  });

  it("draws the page's own picker instead, with its agents, current agent, label and way to choose", async () => {
    const wrapper = mountEntry({
      "agent-picker": `<template #agent-picker="{ agents, agentId, label, select }">
        <button type="button" class="page-own-picker" @click="select(agents[1].id)">{{ label }}|{{ agentId }}|{{ agents.length }}</button>
      </template>`,
    });
    await flushPromises();
    expect(wrapper.find(".agent-switch").exists()).toBe(false);
    const own = wrapper.get("button.page-own-picker");
    expect(own.text()).toBe("Agent|agent-regular|2");
    await own.trigger("click");
    await flushPromises();
    expect(wrapper.get("button.page-own-picker").text()).toBe("Agent|agent-governance|2");
    wrapper.unmount();
  });
});
