import { flushPromises, mount } from "@vue/test-utils";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { expect, it, vi } from "vitest";
import { h, ref, vShow, withDirectives } from "vue";
import { createI18n } from "vue-i18n";
import { createDirectPanelInstance } from "../../../apps-sdk/src/panel/direct";
import PanelMember from "../../../apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../apps-sdk/src/panel/text";

it("keeps the dashboard card notice and its count on the same owner read", async () => {
  const member = "favoriteDashboardCardsNotice";
  const projection: DirectProjection = {
    id: member,
    domainId: "domain",
    ownerId: "owner",
    revision: 1,
    createdAt: "",
    updatedAt: "",
    editable: false,
    visibility: "domain",
    name: "Unavailable dashboard cards",
    description: "",
    componentId: "@ontomato/sdk:InfoBanner",
    inputs: {},
    outputs: {},
    config: { templateKey: "dashboardCards.missing", hideWhenEmpty: true },
    data: {
      record: {
        source: { type: { kind: "PlatformObjectType", id: "platform:Favorite" } },
        read: "dashboardCardsStatus",
        params: {},
      },
    },
  };
  const status = (count: number): ProductPanelReadResponse => ({
    status: "ready",
    value: {
      primaryKey: "dashboardCardsStatus",
      label: "Dashboard card status",
      fields: count > 0 ? { missingCount: count } : {},
      outputs: { missingCount: count },
    },
  });
  let finishUpdatedRead!: (result: ProductPanelReadResponse) => void;
  const updatedRead = new Promise<ProductPanelReadResponse>((resolve) => { finishUpdatedRead = resolve; });
  let statusReads = 0;
  const unused = () => { throw new Error("This notice only reads its card status"); };
  const instance = createDirectPanelInstance({
    state: {},
    members: { [member]: { target: { projectionId: projection.id } } },
  }, {
    pageKey: "personal-workspace",
    url: () => "/home",
    label: () => "Personal workspace",
    text: createPanelText({ en: { "dashboardCards.missing": "Unavailable: {missingCount}" } }, ref("en"), "en"),
    readProjection: async () => projection,
    read: async (request) => {
      if (request.dataName !== "record") return { status: "ready", value: {} };
      // A second reader could receive a newer snapshot before the banner itself is refreshed.
      return ++statusReads === 2 ? updatedRead : status(0);
    },
    operations: { describe: unused, read: unused, upload: unused, prepare: unused },
    confirmOperation: unused,
    expandPageComposer: unused,
    navigate: unused,
    nested: unused,
    readComponentPackage: unused,
  });
  const wrapper = mount({
    render: () => withDirectives(h("div", [h(PanelMember, { instance, member })]), [
      [vShow, Number(instance.outputs[member]?.missingCount) > 0],
    ]),
  }, {
    attachTo: document.body,
    global: { plugins: [createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })] },
  });

  try {
    await vi.waitFor(() => expect(instance.outputs[member]?.missingCount).toBe(0));
    finishUpdatedRead(status(2));
    await flushPromises();
    expect(wrapper.isVisible(), wrapper.text()).toBe(false);

    await instance.refreshObjects();
    expect(wrapper.isVisible()).toBe(true);
    expect(wrapper.text()).toBe("Unavailable: 2");
  } finally {
    wrapper.unmount();
  }
});
