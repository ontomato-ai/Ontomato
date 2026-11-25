import { expect, it, vi } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createRouter, createMemoryHistory } from "vue-router";
import { OPS_DIAGNOSIS_KIND } from "@ontomato/contracts/ops-diagnosis";
import TurnDiagnoseButton from "../TurnDiagnoseButton.vue";
import en from "../../../../locales/en";
import { turnDiagnosisAccessKey, type TurnDiagnosisAccess } from "../../access";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", component: { template: "<div />" } },
    { path: "/agents/chat", component: { template: "<div />" } },
  ],
});

/** Open-source access: /observe has no permission gate, so the entry is always visible. */
const ossAccess: TurnDiagnosisAccess = { prepare: () => {}, visible: () => true };

function render(access: TurnDiagnosisAccess = ossAccess) {
  return mount(TurnDiagnoseButton, {
    props: { sessionId: "session-1", runId: "run-1" },
    global: {
      plugins: [createI18n({ legacy: false, locale: "en", messages: { en } }), router],
      provide: { [turnDiagnosisAccessKey as symbol]: access },
    },
  });
}

it("opens the agent platform pre-selected on ops-diagnosis with a prefilled prompt containing the turn IDs", async () => {
  await render().find("button").trigger("click");
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe("/agents/chat"));
  expect(router.currentRoute.value.query.agentKind).toBe(OPS_DIAGNOSIS_KIND);
  expect(router.currentRoute.value.query.prompt).toBeUndefined();
  expect(String(router.currentRoute.value.query.prefill)).toContain("session-1");
  expect(String(router.currentRoute.value.query.prefill)).toContain("run-1");
});

it("calls prepare once on mount and follows the assembled visibility reactively", async () => {
  // Permission-gated access: permissions load on mount and the button appears once they arrive (reactivity comes from the app's permission state).
  const allowed = ref(false);
  const prepare = vi.fn();
  const wrapper = render({ prepare, visible: () => allowed.value });
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(wrapper.find("button").exists()).toBe(false);

  allowed.value = true;
  await wrapper.vm.$nextTick();
  expect(wrapper.find("button").exists()).toBe(true);
});

it("refuses to render without an assembled access instead of defaulting either way", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(() =>
    mount(TurnDiagnoseButton, {
      props: { sessionId: "session-1", runId: "run-1" },
      global: { plugins: [createI18n({ legacy: false, locale: "en", messages: { en } }), router] },
    })
  ).toThrow("Turn diagnosis access is not provided");
});
