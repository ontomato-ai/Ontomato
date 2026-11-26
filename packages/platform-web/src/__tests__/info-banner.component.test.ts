import { mount } from "@vue/test-utils";
import { computed, nextTick, shallowRef } from "vue";
import { createI18n } from "vue-i18n";
import { expect, it } from "vitest";
import InfoBanner from "../../../apps-sdk/src/base/InfoBanner.vue";
import { panelMemberKey, type PanelMemberContext } from "../../../apps-sdk/src/panel/member";

it("shows a record-driven banner only when its field has content and still renders static banners", async () => {
  const i18n = createI18n({
    legacy: false,
    locale: "en",
    messages: { en: { noticeTitle: "Run issue" } },
  });
  const record = shallowRef({ primaryKey: "run", label: "Run", fields: { reason: "", severity: "" } });
  const datum = computed(() => ({ status: "ready" as const, value: record.value }));
  const member: PanelMemberContext = {
    key: "notice",
    projection: {
      id: "notice",
      name: "Run notice",
      description: "",
      visibility: "domain",
      domainId: "default",
      ownerId: "owner",
      editable: true,
      revision: 1,
      createdAt: "",
      updatedAt: "",
      componentId: "@ontomato/sdk:InfoBanner",
      config: {},
      inputs: {},
      outputs: {},
      data: {
        record: {
          read: "record",
          source: { object: { literal: { className: "platform:ScheduledTask", primaryKey: "task" } } },
          params: {},
        },
      },
    },
    inputs: computed(() => ({})),
    operations: computed(() => ({ status: "ready", value: {} })),
    data: { use: () => datum, read: async () => datum.value },
  };
  const global = { plugins: [i18n], provide: { [panelMemberKey as symbol]: () => member } };
  const bodyNotice = mount(InfoBanner, { props: { field: "reason", titleKey: "noticeTitle", hideWhenEmpty: true }, global });
  const toneNotice = mount(InfoBanner, { props: { toneField: "severity", title: "Severity" }, global });
  const staticNotice = mount(InfoBanner, { props: { title: "Read only", text: "Changes are disabled." }, global });

  expect(bodyNotice.find("aside").exists()).toBe(false);
  expect(toneNotice.find("aside").exists()).toBe(false);
  expect(staticNotice.get("aside").text()).toContain("Read only");
  expect(staticNotice.get("aside").text()).toContain("Changes are disabled.");

  record.value = { ...record.value, fields: { reason: "Credentials expired", severity: "danger" } };
  await nextTick();

  expect(bodyNotice.get("aside").text()).toContain("Run issue");
  expect(bodyNotice.get("aside").text()).toContain("Credentials expired");
  expect(toneNotice.get("aside").text()).toContain("Severity");
  expect(toneNotice.get("aside").attributes("data-tone")).toBe("danger");
});
