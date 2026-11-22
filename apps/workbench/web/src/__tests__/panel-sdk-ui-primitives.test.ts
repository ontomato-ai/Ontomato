import { afterEach, expect, it } from "vitest";
import { createApp, h } from "vue";
import { ElButton, ElDialog } from "element-plus";
import { prepareTemplateComponents } from "../../../../../packages/apps-sdk/src/panel/template-components";

const EmptyRoot = { render: () => h("div") };

afterEach(() => {
  document.body.innerHTML = "";
});

it("registers <sdk-*> primitives and v-sdk-* directives directly without registering legacy <el-*> or v-loading", async () => {
  const template = `<div v-sdk-loading="false"><sdk-button type="primary">Save</sdk-button><sdk-dialog :model-value="false"></sdk-dialog></div>`;
  const install = await prepareTemplateComponents(template, {});
  const app = createApp(EmptyRoot);
  install(app);

  // SDK names point to the untouched underlying primitive objects.
  expect(app.component("SdkButton")).toBe(ElButton);
  expect((app.component("SdkButton") as { name?: string })?.name).toBe("ElButton");
  expect(app.component("SdkDialog")).toBe(ElDialog);
  expect((app.component("SdkDialog") as { name?: string })?.name).toBe("ElDialog");

  // Legacy Element Plus component names are not registered.
  expect(app.component("ElButton")).toBeUndefined();
  expect(app.component("ElDialog")).toBeUndefined();

  // Only v-sdk-loading is registered; v-loading and $loading are absent.
  expect(app.directive("sdk-loading")).toBeTruthy();
  expect(app.directive("loading")).toBeUndefined();
  expect(app.config.globalProperties.$loading).toBeUndefined();
});

it("does not register legacy v-loading when a panel template writes v-loading instead of v-sdk-loading", async () => {
  const template = `<div v-loading="true"><el-button>Legacy</el-button></div>`;
  const install = await prepareTemplateComponents(template, {});
  const app = createApp(EmptyRoot);
  install(app);

  expect(app.directive("loading")).toBeUndefined();
  expect(app.directive("sdk-loading")).toBeUndefined();
  expect(app.component("ElButton")).toBeUndefined();
});
