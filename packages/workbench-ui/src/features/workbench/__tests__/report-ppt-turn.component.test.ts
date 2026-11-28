import { flushPromises, mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import ReportPptTurn from "../components/ReportPptTurn.vue";
import { reportPptMessage } from "../report-ppt";

vi.mock("@ontomato/agent-shell-ui/ppt-artifact-card", () => ({
  default: { props: ["artifact"], template: '<span :data-artifact="artifact.id" />' },
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ locale: { value: "zh-CN" } }) }));

it("ignores an earlier PPT with the same path and retries with the original settings", async () => {
  const source: RuntimeArtifact = {
    id: "report", path: "outputs/report.md", runId: "source", sessionId: "session", mediaType: "text/markdown",
    size: 12, sha256: "a".repeat(64), createdAt: "2026-01-01T00:00:00Z", toolCallId: null, seq: 1,
  };
  const previous = { ...source, id: "old-file", runId: "first-generation", path: "outputs/report.pptx" };
  const fresh = { ...previous, id: "new-file", runId: "second-generation" };
  const message = reportPptMessage(source, "Quarterly results", { cover: false, instructions: "Use the summary" }, "en");
  const request = vi.fn().mockResolvedValue(undefined);
  const resolve = vi.fn().mockResolvedValue(previous);
  const run = { id: fresh.runId, status: "stopped", stopReason: "stop", errorMessage: null, artifacts: [] } as const;
  const wrapper = mount(ReportPptTurn, {
    props: { message, request, resolve, run, pending: false, queued: false, preparationFailed: false, canRetry: true },
  });
  await flushPromises();
  expect(wrapper.find("[data-artifact]").exists()).toBe(false);
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(request).toHaveBeenCalledWith(message);
  await wrapper.setProps({ run: { ...run, artifacts: [fresh] } });
  await flushPromises();
  expect(wrapper.get("[data-artifact]").attributes("data-artifact")).toBe(fresh.id);
});
