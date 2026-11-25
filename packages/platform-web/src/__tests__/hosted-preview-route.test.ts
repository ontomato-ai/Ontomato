import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createMemoryHistory, createRouter } from "vue-router";
import HostedPreviewRoute from "../pages/HostedPreviewRoute.vue";
import { appBuilderPages } from "../workbench-routes";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), register: vi.fn(), dispose: vi.fn() }));
vi.mock("@ontomato/workbench-ui", () => ({ apiUrl: (path: string) => `about:blank#${encodeURIComponent("/api" + path)}`, nodeApiGet: mocks.get, nodeApiPost: mocks.post }));
vi.mock("../app-host", () => ({ registerBuildPreview: mocks.register }));

const workspaceId = "11111111-1111-4111-8111-111111111111";
const url = `/workspaces/${workspaceId}`;
const route = `/app-builder/${workspaceId}/hosted-preview`;
const context = {
  contextId: "test-context", workspaceId, status: "READY", expiresAt: 1795555555555, classNames: [],
  sampleSummary: { name: "test-data/inventory.json", classes: 0, sha256: null }, resources: [],
};

let wrapper: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue(context);
  mocks.post.mockResolvedValue({ token: "first" });
  mocks.register.mockImplementation(() => {
    expect(document.querySelector("iframe")?.hasAttribute("src")).toBe(false);
    return { dispose: mocks.dispose };
  });
});
afterEach(() => wrapper?.unmount());

async function render() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/app-builder/workspace", component: { template: "<div />" } }, ...appBuilderPages()],
  });
  await router.push("/app-builder/workspace");
  const { name, params } = router.resolve(route);
  expect(name).toBe("AppBuilderHostedPreview");
  expect(params.workspaceId).toBe(workspaceId);
  const i18n = createI18n({ legacy: false, locale: "en", missingWarn: false, fallbackWarn: false });
  wrapper = mount(HostedPreviewRoute, { attachTo: document.body, props: { workspaceId }, global: { plugins: [router, i18n] } });
  await flushPromises();
  return wrapper;
}

it("binds the preview iframe to build-test data and refreshes with a new token", async () => {
  const view = await render();
  expect(mocks.get).toHaveBeenCalledWith(`${url}/build-tests`);
  expect(mocks.post).toHaveBeenCalledWith(`${url}/preview-token`, {});
  const first = view.get("iframe");
  expect(decodeURIComponent(first.attributes("src")!.split("#")[1]!)).toBe(`/api${url}/preview/first/index.html`);
  expect(mocks.register).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ kind: "build-test", workspaceId, contextId: context.contextId }));
  expect(view.get("a").attributes("href")).toBe(`/app-builder/workspace?workspace=${workspaceId}`);

  mocks.post.mockResolvedValue({ token: "next" });
  await view.get("button").trigger("click");
  await flushPromises();
  expect(mocks.dispose).toHaveBeenCalled();
  expect(decodeURIComponent(view.get("iframe").attributes("src")!.split("#")[1]!)).toBe(`/api${url}/preview/next/index.html`);
});

it("never requests a preview token or loads a frame when the build-test read is denied", async () => {
  mocks.get.mockRejectedValue(new Error("Workspace denied"));
  const view = await render();
  expect(view.find("[role=alert]").exists()).toBe(true);
  expect(view.find("iframe").exists()).toBe(false);
  expect(mocks.post).not.toHaveBeenCalled();
  expect(mocks.register).not.toHaveBeenCalled();
});
