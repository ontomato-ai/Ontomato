import { componentModuleImports, componentOfficialSpecifiers, panelModuleImports } from "@ontomato/contracts/panel-module";
import { beforeEach, expect, it, vi } from "vitest";
import { createApp, type ComponentInternalInstance, type ComponentOptions, type RenderFunction } from "vue";
import { clearPanelModuleCaches, evaluateComponentModule, evaluatePanelModule, runPanelModule, useTemplateCompiler } from "../panel-module";

vi.mock("@ontomato/contracts/panel-module", async (importOriginal) => {
  const contracts = await importOriginal<typeof import("@ontomato/contracts/panel-module")>();
  return {
    ...contracts,
    panelModuleImports: vi.fn(contracts.panelModuleImports),
    componentModuleImports: vi.fn(contracts.componentModuleImports),
  };
});

beforeEach(() => {
  clearPanelModuleCaches();
  vi.mocked(panelModuleImports).mockClear();
  vi.mocked(componentModuleImports).mockClear();
});

function mountTemplate(template: string, compilerOptions?: ComponentOptions["compilerOptions"]) {
  const app = createApp({ template, compilerOptions, setup: () => ({ label: "Panel content" }) });
  const container = document.createElement("div");
  const instance = app.mount(container).$ as ComponentInternalInstance & { render: RenderFunction };
  const text = container.textContent;
  app.unmount();
  return { render: instance.render, text };
}

function componentLoaders(namespace: Record<string, unknown>) {
  const loaders = Object.fromEntries(componentOfficialSpecifiers.map(specifier => [specifier, () => namespace]));
  return loaders as Parameters<typeof evaluateComponentModule>[1];
}

it("renders a runtime template without warnings from the component proxy", async ({ onTestFinished }) => {
  const warn = vi.spyOn(console, "warn");
  onTestFinished(() => { warn.mockRestore(); });
  await useTemplateCompiler();
  const app = createApp({
    setup: () => ({ label: "Panel content" }),
    template: "<p>{{ label }}</p>",
  });
  const container = document.createElement("div");
  const instance = app.mount(container);
  onTestFinished(() => { app.unmount(); });

  expect(instance.$).toHaveProperty("render._rc", true);
  expect(container.textContent).toBe("Panel content");
  expect(warn.mock.calls.map(([message]) => message)).not.toContainEqual(
    expect.stringContaining("Property undefined was accessed during render"),
  );
});

it("runs a panel's literal dynamic import against the same namespace as its static import", async () => {
  const mountPanel = () => undefined;
  const exported = await runPanelModule(`
    import { mountPanel } from "@ontomato/sdk/panel";
    const sdk = await import("@ontomato/sdk/panel");
    if (mountPanel !== sdk.mountPanel) throw new Error("The two imports supplied different bindings");
    export default { ok: true };
  `, { vue: {}, "@ontomato/sdk/panel": { mountPanel } });
  expect(exported.default).toEqual({ ok: true });
});

it("reuses a compiled render function across mounts of the same template", async () => {
  await useTemplateCompiler();
  const first = mountTemplate("<p>{{ label }}</p>");
  expect(mountTemplate("<p>{{ label }}</p>").render).toBe(first.render);
  expect(first.render).toHaveProperty("_rc", true);
  expect(mountTemplate("<div>{{ label }}</div>").render).not.toBe(first.render);
});

it("keys compiled templates by canonical compiler options", async () => {
  await useTemplateCompiler();
  const template = "<p>[[ label ]]</p>";
  const first = mountTemplate(template, { delimiters: ["[[", "]]"], comments: true, whitespace: "preserve" });
  const reordered = mountTemplate(template, { whitespace: "preserve", comments: true, delimiters: ["[[", "]]"] });
  const other = mountTemplate(template, { delimiters: ["${", "}"], comments: true, whitespace: "preserve" });
  expect(reordered.render).toBe(first.render);
  expect(other.render).not.toBe(first.render);
  expect(first.text).toBe("Panel content");
  expect(other.text).toBe("[[ label ]]");
});

it("compiles function-valued options on every mount", async () => {
  await useTemplateCompiler();
  const options = { isCustomElement: (tag: string) => tag === "panel-label" };
  const first = mountTemplate("<panel-label>{{ label }}</panel-label>", options);
  const second = mountTemplate("<panel-label>{{ label }}</panel-label>", options);
  expect(second.render).not.toBe(first.render);
  expect(second.render).toHaveProperty("_rc", true);
  expect(second.text).toBe("Panel content");
});

it("reuses parsed imports while evaluating each panel and component with its own SDK bindings", async () => {
  const source = `
    import { mountPanel } from "@ontomato/sdk/panel";
    export const sdk = await import("@ontomato/sdk/panel");
    export default mountPanel;
  `;
  const firstMountPanel = () => "first";
  const secondMountPanel = () => "second";
  const firstSdk = { mountPanel: firstMountPanel };
  const secondSdk = { mountPanel: secondMountPanel };
  const firstPanel = await runPanelModule(source, { vue: {}, "@ontomato/sdk/panel": firstSdk });
  const secondPanel = await evaluatePanelModule(source, { vue: {}, "@ontomato/sdk/panel": secondSdk });
  const firstComponent = await evaluateComponentModule(source, componentLoaders(firstSdk));
  const secondComponent = await evaluateComponentModule(source, componentLoaders(secondSdk));

  expect(panelModuleImports).toHaveBeenCalledTimes(1);
  expect(componentModuleImports).toHaveBeenCalledTimes(1);
  for (const [first, second] of [[firstPanel, secondPanel], [firstComponent, secondComponent]]) {
    expect(first.default).toBe(firstMountPanel);
    expect(second.default).toBe(secondMountPanel);
    expect(first.sdk).not.toBe(second.sdk);
  }
});

it("does not cache rejected imports", async () => {
  const source = 'import "./relative.js";';
  const modules = { vue: {}, "@ontomato/sdk/panel": {} };
  const loaders = componentLoaders({});
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(runPanelModule(source, modules)).rejects.toThrow("./relative.js");
    await expect(evaluateComponentModule(source, loaders)).rejects.toThrow("./relative.js");
  }
  expect(panelModuleImports).toHaveBeenCalledTimes(2);
  expect(componentModuleImports).toHaveBeenCalledTimes(2);
});
