import { flushPromises, mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import ReportActions from "../components/ReportActions.vue";

const localize = (key: string) => key;
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: localize, locale: { value: "zh-CN" } }) }));
vi.mock("../../../utils/api", () => ({ ApiRequestError: class extends Error {}, nodeApiFetch: vi.fn(), nodeApiPost: vi.fn() }));
vi.mock("element-plus", async importOriginal => {
  const original = await importOriginal<typeof import("element-plus")>();
  return { ...original, ElMessage: { error: vi.fn(), warning: vi.fn() } };
});
vi.mock("lucide-vue-next", () => {
  const icon = { template: "<i />" };
  return { ChevronDown: icon, Download: icon, ImagePlus: icon, LayoutDashboard: icon, Loader2: icon, Presentation: icon };
});

it("keeps the draft available after the host refuses the PPT request", async () => {
  const requestPpt = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(undefined);
  const wrapper = mount(ReportActions, {
    props: {
      artifact: { id: "artifact", path: "outputs/report.md", runId: "run", sessionId: "session", mediaType: "text/markdown", size: 12, sha256: "a".repeat(64), createdAt: "2026-01-01T00:00:00Z", toolCallId: null, seq: 1 },
      title: "Report", canGeneratePpt: true, requestPpt,
    },
    global: { stubs: {
      ElDialog: { template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>', props: ["modelValue"] },
      ElForm: { template: "<form><slot /></form>" },
      ElFormItem: { template: '<div><slot name="label" /><slot /></div>' },
      ElCheckbox: { template: '<button type="button" @click="$emit(\'update:modelValue\', !$attrs.modelValue)"><slot /></button>' },
      ElInput: { template: '<textarea :aria-label="$attrs[\'aria-label\']" :value="modelValue" />', props: ["modelValue"] },
      ElButton: { template: '<button type="button" @click="$attrs.onClick?.()"><slot /></button>' },
      ElSelect: { template: "<select><slot /></select>" }, ElOption: { template: "<option><slot /></option>" },
    } },
  });
  await wrapper.get('button[aria-label="生成 PPT"]').trigger("click");
  const more = wrapper.get("button[aria-expanded]");
  expect(more.attributes("aria-expanded")).toBe("false");
  await more.trigger("click");
  expect(more.attributes("aria-expanded")).toBe("true");
  const submit = () => wrapper.findAll("button").at(-1)!.trigger("click");
  await submit();
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  expect(more.attributes("aria-expanded")).toBe("true");
  await submit();
  await flushPromises();
  expect(requestPpt.mock.calls[1]).toEqual(requestPpt.mock.calls[0]);
  expect(wrapper.find("button[aria-expanded]").exists()).toBe(false);
});
