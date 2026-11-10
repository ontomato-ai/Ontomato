import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), text: vi.fn(), skill: vi.fn(), enabled: vi.fn(), prepare: vi.fn() }));
vi.mock("../../../core/skills/registry/manager", () => ({ skillRegistryManager: { forDomain: async () => ({ getSkillById: mocks.skill, isSkillEnabled: mocks.enabled }) } }));
vi.mock("../../assistant/skills", () => ({ prepareAssistantSkills: mocks.prepare }));
vi.mock("../skill-manager", () => ({ skillReference: () => ({ name: "echarts", namespace: { kind: "provider", provider: "workbench" } }) }));
vi.mock("../../../platform/agent-runtime/runtime", () => ({ userSkillEnvironment: () => ({ values: {}, secrets: {} }) }));
vi.mock("../../../infrastructure/agent-runtime/client", () => ({ RuntimeClient: class { request = mocks.request; text = mocks.text; } }));
import { renderObjectView } from "../render-view";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.skill.mockReturnValue({ manifest: { type: "executable", category: "visualization" } });
  mocks.enabled.mockReturnValue(true);
  mocks.prepare.mockResolvedValue([{ name: "echarts", namespace: { kind: "provider", provider: "workbench" } }]);
});
it("executes the selected skill in the runtime sandbox and returns its HTML without a model run", async () => {
  mocks.request.mockResolvedValue({ id: "f7201bbb-f345-45ea-9303-6be34a1db111", status: "stopped", entry: "render.py", sourceSha256: "abc", createdAt: "2026-11-07", finishedAt: "2026-11-07", exitCode: 0, outputs: [], errorMessage: null });
  const admission = await mocks.request();
  mocks.request.mockClear();
  mocks.request.mockResolvedValue({ execution: admission, replayed: false });
  mocks.text.mockResolvedValue("<html>chart</html>");
  expect(await renderObjectView({ domainId: "d", userId: "u" }, { locale: "zh-CN" }, "echarts", { locale: "en", data: [{ value: 1 }], chartType: "bar", title: "Values" })).toEqual({ html: "<html>chart</html>" });
  expect(mocks.request.mock.calls[0][0]).toBe("/v1/code-executions");
  expect(JSON.parse(mocks.request.mock.calls[0][2].files.find((file: { path: string }) => file.path === "input.json").content).locale).toBe("zh-CN");
  expect(mocks.request.mock.calls[0][2]).toMatchObject({ language: "python", libraries: [{ path: "scripts", skill: { name: "echarts" } }], outputPaths: ["result.html"] });
});
it("rejects a disabled skill before runtime admission", async () => {
  mocks.enabled.mockReturnValue(false);
  await expect(renderObjectView({ domainId: "d", userId: "u" }, {}, "echarts", {})).rejects.toThrow("disabled");
  expect(mocks.request).not.toHaveBeenCalled();
});
