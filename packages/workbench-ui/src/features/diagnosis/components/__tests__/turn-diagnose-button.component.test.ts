import { beforeEach, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createRouter, createMemoryHistory } from "vue-router";
import { OPS_DIAGNOSIS_KIND } from "@ontomato/contracts/ops-diagnosis";
import TurnDiagnoseButton from "../TurnDiagnoseButton.vue";
import en from "../../../../locales/en";
import { turnDiagnosisAccessKey, type TurnDiagnosisAccess } from "../../access";

const mocks = vi.hoisted(() => ({
  listAgents: vi.fn(),
  createSession: vi.fn(),
  send: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock("../../../workbench/assistant-host", () => ({
  createAssistantClient: () => ({
    listAgents: mocks.listAgents,
    createSession: mocks.createSession,
    send: mocks.send,
  }),
}));

vi.mock("element-plus", () => ({
  ElMessage: { error: mocks.errorToast },
}));

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", component: { template: "<div />" } },
    { path: "/ops/diagnosis", component: { template: "<div />" } },
  ],
});

/** Open-source access: /observe has no permission gate, so the entry is always visible. */
const ossAccess: TurnDiagnosisAccess = { prepare: () => {}, visible: () => true };

beforeEach(async () => {
  vi.resetAllMocks();
  await router.push("/");
  mocks.listAgents.mockResolvedValue([
    { id: "ops-agent-1", name: "Operations Diagnosis", kind: OPS_DIAGNOSIS_KIND, enabled: true },
  ]);
  mocks.createSession.mockResolvedValue({ id: "diag-session-99" });
  mocks.send.mockResolvedValue({});
});

function render(access: TurnDiagnosisAccess = ossAccess) {
  return mount(TurnDiagnoseButton, {
    props: { sessionId: "session-1", runId: "run-1" },
    global: {
      plugins: [createI18n({ legacy: false, locale: "en", messages: { en } }), router],
      provide: { [turnDiagnosisAccessKey as symbol]: access },
    },
  });
}

it("creates a fresh ops-diagnosis session, sends the opening prompt, and navigates to /ops/diagnosis?frame.sessionId=<id>", async () => {
  await render().find("button").trigger("click");
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe("/ops/diagnosis"));
  expect(mocks.createSession).toHaveBeenCalledWith("ops-agent-1");
  expect(mocks.send).toHaveBeenCalledWith("diag-session-99", {
    message: expect.stringContaining("session-1"),
  });
  expect(mocks.send.mock.calls[0]![1].message).toContain("run-1");
  expect(router.currentRoute.value.query).toEqual({ "frame.sessionId": "diag-session-99" });
  expect(router.currentRoute.value.query.diagnose).toBeUndefined();
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
