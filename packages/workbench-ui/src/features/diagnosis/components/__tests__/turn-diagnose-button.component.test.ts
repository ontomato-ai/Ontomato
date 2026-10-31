import { expect, it, vi } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createRouter, createMemoryHistory } from "vue-router";
import TurnDiagnoseButton from "../TurnDiagnoseButton.vue";
import en from "../../../../locales/en";
import { turnDiagnosisAccessKey, type TurnDiagnosisAccess } from "../../access";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", component: { template: "<div />" } },
    { path: "/observe/diagnosis", component: { template: "<div />" } },
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

it("opens that run's diagnosis page in a new tab", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  await render().find("button").trigger("click");

  const [href, target] = open.mock.calls[0];
  const url = new URL(href as string, "http://localhost");
  expect(url.pathname).toBe("/observe/diagnosis");
  expect(url.searchParams.get("sourceSessionId")).toBe("session-1");
  expect(url.searchParams.get("sourceRunId")).toBe("run-1");
  expect(url.searchParams.get("diagnose")).toBe("1");
  expect(target).toBe("_blank");
  open.mockRestore();
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
