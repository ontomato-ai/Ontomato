import { beforeAll, expect, it, vi } from "vitest";
import { panelRecordListSchema, panelRecordSchema } from "@ontomato/contracts/panel-projection";
import { SDK_COMPONENT } from "@ontomato/contracts/platform-object-types";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import {
  listSdkComponents,
  readSdkComponentConfigRows,
  readSdkComponentDataRows,
  readSdkComponentInputRows,
  readSdkComponentOperationRows,
  readSdkComponentOutputRows,
  readSdkComponentRecord,
} from "../component-catalogue";

vi.mock("../../app-builder/sdk", () => ({
  readCurrentAppSdkComponents: async () => ({
    version: "1.0.0",
    digest: "a".repeat(64),
    catalogue: {
      version: "1.0.0",
      components: [
        {
          componentId: "SampleList",
          module: "@ontomato/sdk/base",
          exportName: "SampleList",
          role: "control",
          group: "list",
          meaning: "Shows a list of records.",
          effects: "Reads records through the platform.",
          bindsElement: ["PlatformObjectType:*"],
          data: {
            rows: { results: ["panelRecordList", "panelRecordQuery"], required: true, runtimeParams: ["search", "page"] },
          },
          config: [
            { name: "pageSize", type: "number", required: false, default: "20", description: "Rows per page." },
            { name: "layout", type: '"table" | "list"', required: true, description: "Display style." },
          ],
          inputs: {
            selected: { kind: "object", objectType: "@binding" },
            tags: { kind: "list", items: { kind: "scalar", type: "string" } },
          },
          outputs: {
            selected: { kind: "object", objectType: "platform:Application" },
          },
          readOnlyOutputs: {
            total: { kind: "scalar", type: "number" },
          },
          ports: {
            props: [],
            slots: [{ name: "filters", type: "slot", description: "Custom filter controls." }],
            events: [{ name: "choose", type: "(ref: ObjectListRef) => void", description: "Emitted when a row is chosen." }],
          },
        },
        {
          componentId: "ObjectRelations",
          module: "@ontomato/sdk/base",
          exportName: "ObjectRelations",
          role: "control",
          group: "graph",
          meaning: "Shows an object's relations.",
          inputs: {
            selected: { kind: "object", objectType: "@any" },
            visibleRelationKinds: { kind: "list", items: { kind: "scalar", type: "string" } },
          },
          outputs: {
            start: { kind: "object", objectType: "@any" },
            visibleRelationKinds: { kind: "list", items: { kind: "scalar", type: "string" } },
          },
          ports: { props: [], slots: [], events: [] },
        },
        {
          componentId: "WildcardBox",
          module: "@ontomato/sdk/panel",
          exportName: "WildcardBox",
          role: "presentation",
          group: "layout",
          panelUsable: false,
          meaning: "Accepts any datum name.",
          data: {
            "*": { results: ["panelRecord"], required: false },
          },
          ports: { props: [], slots: [], events: [] },
        },
      ],
    },
  }),
}));

vi.mock("../../component-packages/store", () => ({
  listComponentPackages: async () => [
    {
      name: "@acme/widgets",
      components: [
        {
          componentId: "@acme/widgets:ActionCard",
          role: "control",
          meaning: "Runs a declared package operation.",
          operations: [{ name: "approve", handlerRef: "orders.approve" }],
          ports: { props: [], slots: [], events: [] },
        },
      ],
    },
  ],
  readComponentPackage: async () => undefined,
}));

vi.mock("../../domain-components/store", () => ({
  listVisibleDomainComponents: async () => [],
  domainComponentForProjection: async () => undefined,
  domainComponentRecord: vi.fn(),
}));

const owner = { domainId: "domain", userId: "reader" };

beforeAll(() => {
  configureI18n({
    defaultLocale: "en",
    appTextLocale: "en",
    languageSwitchEnabled: true,
    packs: {
      en: { messages: en, ...enLocaleMeta },
      "zh-CN": {
        messages: {
          ...en,
          "panels.sdkComponent.rolePresentation": "展示组件",
          "panels.sdkComponent.roleControl": "控件",
          "panels.sdkComponent.group": "用途分组",
          "panels.sdkComponent.group.list": "列表",
          "panels.sdkComponent.group.graph": "图谱",
          "panels.sdkComponent.group.layout": "布局",
          "panels.sdkComponent.panelUsable": "使用范围",
          "panels.sdkComponent.panelUsableYes": "面板可用",
          "panels.sdkComponent.panelUsableShellOnly": "仅平台外壳",
          "panels.sdkComponent.yes": "是",
          "panels.sdkComponent.no": "否",
          "panels.sdkComponent.wildcard": "任意名称",
          "panels.sdkComponent.kindInput": "输入",
          "panels.sdkComponent.kindSlot": "插槽",
          "panels.sdkComponent.kindOutput": "输出",
          "panels.sdkComponent.kindReadOnlyOutput": "只读输出",
          "panels.sdkComponent.kindEvent": "事件",
          "panels.sdkComponent.portBinding": "使用它的投影所绑定的对象类型",
        },
        ...enLocaleMeta,
      },
    },
  });
});

it("formats platform:SDKComponent record and all five specification tables according to locale", async () => {
  const id = "@ontomato/sdk:SampleList";
  const record = panelRecordSchema.parse(await readSdkComponentRecord(owner, id, "zh-CN"));
  expect(record).toMatchObject({
    primaryKey: id,
    className: SDK_COMPONENT,
    label: "SampleList",
    subtitle: "@ontomato/sdk",
    fields: {
      componentId: "SampleList",
      package: "@ontomato/sdk",
      module: "@ontomato/sdk/base",
      exportName: "SampleList",
      role: "控件",
      group: "列表",
      panelUsable: "面板可用",
      meaning: "Shows a list of records.",
      effects: "Reads records through the platform.",
    },
    tags: { bindsElement: ["PlatformObjectType:*"] },
    tones: { role: "info", panelUsable: "success" },
  });

  const dataRows = panelRecordListSchema.parse(await readSdkComponentDataRows(owner, id, "zh-CN"));
  expect(dataRows).toMatchObject([
    {
      primaryKey: "rows",
      label: "rows",
      fields: { required: "是" },
      tags: { results: ["panelRecordList", "panelRecordQuery"], runtimeParams: ["search", "page"] },
      tones: { required: "warning" },
    },
  ]);

  const configRows = panelRecordListSchema.parse(await readSdkComponentConfigRows(owner, id, "zh-CN"));
  expect(configRows).toMatchObject([
    { primaryKey: "pageSize", label: "pageSize", fields: { type: "number", required: "否", defaultValue: "20", description: "Rows per page." } },
    { primaryKey: "layout", label: "layout", fields: { type: '"table" | "list"', required: "是", description: "Display style." } },
  ]);
  expect(configRows[1]!.fields).not.toHaveProperty("defaultValue");

  const inputRows = panelRecordListSchema.parse(await readSdkComponentInputRows(owner, id, "zh-CN"));
  expect(inputRows).toMatchObject([
    { primaryKey: "input:selected", label: "selected", fields: { kind: "输入", type: "使用它的投影所绑定的对象类型" } },
    { primaryKey: "input:tags", label: "tags", fields: { kind: "输入", type: "a list of <a string scalar>" } },
    { primaryKey: "slot:filters", label: "#filters", fields: { kind: "插槽", type: "slot", description: "Custom filter controls." } },
  ]);

  const outputRows = panelRecordListSchema.parse(await readSdkComponentOutputRows(owner, id, "zh-CN"));
  expect(outputRows).toMatchObject([
    { primaryKey: "output:selected", label: "selected", fields: { kind: "输出", type: "an object of platform:Application" } },
    { primaryKey: "readOnlyOutput:total", label: "total", fields: { kind: "只读输出", type: "a number scalar" }, tones: { kind: "success" } },
    { primaryKey: "event:choose", label: "choose", fields: { kind: "事件", type: "(ref: ObjectListRef) => void", description: "Emitted when a row is chosen." } },
  ]);

  expect(await readSdkComponentOperationRows(owner, id, "en")).toEqual([]);
});

it("formats wildcard data entries, declared package operations, and throws 404 for unknown components", async () => {
  const wildcardRows = panelRecordListSchema.parse(await readSdkComponentDataRows(owner, "@ontomato/sdk:WildcardBox", "zh-CN"));
  expect(wildcardRows[0]).toMatchObject({
    primaryKey: "*",
    label: "任意名称 *",
    fields: { required: "否" },
    tags: { results: ["panelRecord"] },
  });

  const opRows = panelRecordListSchema.parse(await readSdkComponentOperationRows(owner, "@acme/widgets:ActionCard", "en"));
  expect(opRows).toMatchObject([
    { primaryKey: "approve", label: "approve", fields: { signature: "orders.approve" } },
  ]);

  await expect(readSdkComponentRecord(owner, "@ontomato/sdk:Missing", "en")).rejects.toThrow(
    "SDK component '@ontomato/sdk:Missing' is not in the current release.",
  );
});

it("describes the two ObjectRelations wiring choices in the reader's locale", async () => {
  const component = "@ontomato/sdk:ObjectRelations";
  const [inputs, outputs] = await Promise.all([
    readSdkComponentInputRows(owner, component, "en"),
    readSdkComponentOutputRows(owner, component, "en"),
  ]);
  expect(inputs.find(row => row.label === "selected")?.fields.type).toBe(en["panels.sdkComponent.portAnyOntologyObject"]);
  expect(outputs.find(row => row.label === "start")?.fields.type).toBe(en["panels.sdkComponent.portAnyOntologyObject"]);
  for (const rows of [inputs, outputs]) {
    expect(rows.find(row => row.label === "visibleRelationKinds")?.fields.type).toBe(en["panels.sdkComponent.portRelationKinds"]);
  }
});

it("lists components in canonical purpose group order with summary attributes and searches across full metadata", async () => {
  const all = panelRecordListSchema.parse(await listSdkComponents(owner, "zh-CN"));
  expect(all).toMatchObject([
    {
      primaryKey: "@ontomato/sdk:SampleList",
      fields: { package: "@ontomato/sdk", role: "控件", panelUsable: "面板可用", group: "列表" },
      tags: { bindsElement: ["PlatformObjectType:*"] },
      tones: { role: "info", panelUsable: "success" },
    },
    {
      primaryKey: "@ontomato/sdk:ObjectRelations",
      fields: { package: "@ontomato/sdk", role: "控件", panelUsable: "面板可用", group: "图谱" },
      tones: { role: "info", panelUsable: "success" },
    },
    {
      primaryKey: "@ontomato/sdk:WildcardBox",
      fields: { package: "@ontomato/sdk", role: "展示组件", panelUsable: "仅平台外壳", group: "布局" },
      tones: { role: "default", panelUsable: "default" },
    },
    {
      primaryKey: "@acme/widgets:ActionCard",
      fields: { package: "@acme/widgets", role: "控件", panelUsable: "面板可用" },
      tones: { role: "info", panelUsable: "success" },
    },
  ]);
  for (const row of all) {
    expect(row.fields).not.toHaveProperty("meaning");
  }

  const byGroupLabel = panelRecordListSchema.parse(await listSdkComponents(owner, "zh-CN", "图谱"));
  expect(byGroupLabel.map(row => row.primaryKey)).toEqual(["@ontomato/sdk:ObjectRelations"]);

  const byAvailability = panelRecordListSchema.parse(await listSdkComponents(owner, "zh-CN", "仅平台外壳"));
  expect(byAvailability.map(row => row.primaryKey)).toEqual(["@ontomato/sdk:WildcardBox"]);

  const byMeaning = panelRecordListSchema.parse(await listSdkComponents(owner, "zh-CN", "records"));
  expect(byMeaning.map(row => row.primaryKey)).toEqual(["@ontomato/sdk:SampleList"]);
});
