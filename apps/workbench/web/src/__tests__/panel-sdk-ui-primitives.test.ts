import { afterEach, expect, it } from "vitest";
import { createApp, h } from "vue";
import { ElTag } from "element-plus";
import { prepareTemplateComponents } from "../../../../../packages/apps-sdk/src/panel/template-components";
import { SdkButton } from "../../../../../packages/apps-sdk/src/ui/SdkButton";
import { SdkDialog } from "../../../../../packages/apps-sdk/src/ui/SdkDialog";
import { SdkDrawer } from "../../../../../packages/apps-sdk/src/ui/SdkDrawer";

const EmptyRoot = { render: () => h("div") };

afterEach(() => {
  document.body.innerHTML = "";
});

it("registers <sdk-*> primitives and v-sdk-* directives directly without registering legacy <el-*> or v-loading", async () => {
  const template = `<div v-sdk-loading="false"><sdk-tag>Tag</sdk-tag><sdk-button type="primary">Save</sdk-button><sdk-dialog :model-value="false"></sdk-dialog><sdk-drawer :model-value="false"></sdk-drawer></div>`;
  const install = await prepareTemplateComponents(template, {});
  const app = createApp(EmptyRoot);
  install(app);

  // Pass-through SDK names point to the untouched underlying primitive objects, while SdkButton / SdkDialog / SdkDrawer
  // resolve to their official SDK wrappers (icon resolution and overlay unsaved-form guards).
  expect(app.component("SdkTag")).toBe(ElTag);
  expect((app.component("SdkTag") as { name?: string })?.name).toBe("ElTag");
  expect(app.component("SdkButton")).toBe(SdkButton);
  expect((app.component("SdkButton") as { name?: string })?.name).toBe("SdkButton");
  expect(app.component("SdkDialog")).toBe(SdkDialog);
  expect((app.component("SdkDialog") as { name?: string })?.name).toBe("SdkDialog");
  expect(app.component("SdkDrawer")).toBe(SdkDrawer);
  expect((app.component("SdkDrawer") as { name?: string })?.name).toBe("SdkDrawer");

  // Legacy Element Plus component names are not registered.
  expect(app.component("ElTag")).toBeUndefined();
  expect(app.component("ElButton")).toBeUndefined();
  expect(app.component("ElDialog")).toBeUndefined();
  expect(app.component("ElDrawer")).toBeUndefined();

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
