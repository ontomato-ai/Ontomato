import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { APPLICATION } from "@ontomato/contracts/platform-object-types";
import { createDirectPanelInstance } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

const meta = {
  domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "",
  editable: false, visibility: "domain" as const, description: "",
};

const projections: Record<string, DirectProjection> = {
  "app-summary": {
    ...meta,
    id: "app-summary",
    name: "Application summary",
    componentId: "@ontomato/sdk:ObjectSummary",
    inputs: { app: { kind: "object", objectType: APPLICATION } },
    outputs: {},
    config: {
      showTitle: false,
      fields: ["id", "allowStandalone", "externalLink"],
      copyableFields: ["externalLink", "id"],
    },
    data: { record: { source: { object: { input: "app" } }, read: "record", params: {} } },
  },
};

const manifest: DirectPanelManifest = {
  state: {
    selected: { type: { kind: "object", objectType: APPLICATION }, personal: false, deepLink: true, external: true },
  },
  members: {
    summary: { target: { projectionId: "app-summary" }, inputs: { app: { state: "selected" } } },
  },
};

const mounted: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  mounted.splice(0).forEach(app => app.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function mountSummary(record: Record<string, unknown>) {
  const ready: ProductPanelReadResponse = { status: "ready", value: record as never };
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "applications-direct",
    url: () => "/ontology/applications",
    label: () => "Applications",
    initial: { selected: { className: APPLICATION, primaryKey: String(record.primaryKey) } } as never,
    recordDraftCreated: async () => {},
    text: createPanelText({}, ref("en"), "en"),
    ...noOperations,
    readProjection: async (id) => projections[id]!,
    read: async () => ready,
  });
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp({
    setup: () => () => h(PanelMember, { instance, member: "summary" }),
  }).use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus);
  app.mount(root);
  mounted.push(app);
  await vi.waitFor(() => expect(root.querySelector(".sdk-object-summary dl")).not.toBeNull());
  return root;
}

it("resolves hash externalLink fields to full URLs with one-click copy and omits externalLink when disabled", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  try {
    const enabledRoot = await mountSummary({
      primaryKey: "app-sales",
      className: APPLICATION,
      label: "Sales",
      fields: {
        id: "app-sales",
        allowStandalone: true,
        externalLink: "#/applications/app-sales?standalone=1",
      },
      fieldLabels: {
        id: "Application ID",
        allowStandalone: "Allow standalone open",
        externalLink: "External link",
      },
    });

    const expectedUrl = `${window.location.origin}${window.location.pathname}#/applications/app-sales?standalone=1`;
    expect(enabledRoot.textContent).toContain(expectedUrl);
    const buttons = [...enabledRoot.querySelectorAll<HTMLButtonElement>(".sdk-object-summary-copy-btn")];
    expect(buttons).toHaveLength(2);

    buttons[0]!.click();
    await nextTick();
    expect(writeText).toHaveBeenLastCalledWith("app-sales");

    buttons[1]!.click();
    await nextTick();
    expect(writeText).toHaveBeenLastCalledWith(expectedUrl);

    const disabledRoot = await mountSummary({
      primaryKey: "app-locked",
      className: APPLICATION,
      label: "Locked",
      fields: {
        id: "app-locked",
        allowStandalone: false,
      },
      fieldLabels: {
        id: "Application ID",
        allowStandalone: "Allow standalone open",
      },
    });
    expect(disabledRoot.textContent).not.toContain("standalone=1");
    expect(disabledRoot.querySelectorAll(".sdk-object-summary-copy-btn")).toHaveLength(1);
  } finally {
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else delete (navigator as { clipboard?: unknown }).clipboard;
  }
});
