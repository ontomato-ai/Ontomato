import { beforeAll, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref, shallowRef } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { panelAddressState } from "@ontomato/contracts/panel-host";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { definePanel, type PanelDeepLinkStateValue } from "@ontomato/contracts/panel-manifest";
import type { ApplicationPanelUse, ProductPanel } from "@ontomato/contracts/product-panels";
import type { CodedPanelTarget, DirectPanelRun, PanelHostPort, PanelSdkRelease } from "@ontomato/platform-shell";
import { installWorkbenchI18n, workbenchI18n } from "@ontomato/workbench-ui/i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import elementEn from "element-plus/es/locale/lang/en";

/*
 * Regression for clicking a row in a single-panel ObjectList when the page is open beside a conversation at its bare
 * address (`#/agents/chat?page=/applications/app-a/objects`, with no `?` query string).
 *
 * Uses the real `PanelApplicationRoute` and real `PanelHost` (no host mock): clicking a row updates panel state so
 * `PanelHost` emits `context` before `display-address`; the parent's reactive re-render re-evaluates `stateOf(page)`
 * into a fresh `{}` object before `@display-address` propagates, and the host must not treat that fresh equal object
 * as an external navigation back to the bare address and wipe out the selection.
 */

const OBJECT_TYPE = "platform:ObjectType";
const manifest = definePanel({
  state: {
    selected: { type: { kind: "object", objectType: OBJECT_TYPE }, deepLink: true },
  },
  members: {
    list: { target: { projectionId: "projection-list" } },
    detail: { target: { projectionId: "projection-detail" }, inputs: { target: { state: "selected" } } },
  },
});

const panelRecord: ProductPanel = {
  id: "panel-objects",
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "2026-11-24T00:00:00.000Z",
  updatedAt: "2026-11-24T00:00:00.000Z",
  editable: true,
  name: "Object types",
  description: "",
  visibility: "domain",
  content: { html: `<div id="app"></div>`, module: `import { mountPanel } from "@ontomato/sdk/panel";` },
  manifest,
};

const use: ApplicationPanelUse = {
  id: "use-objects",
  panelId: panelRecord.id,
  path: "/applications/app-a/objects",
  pageKey: "objects",
  access: { kind: "domain-member" },
};

const pushedAddresses: string[] = [];

const release: PanelSdkRelease = {
  base: "/apps-sdk/current",
  manifest: {
    version: "1.1.0",
    product: "workbench",
    executionContext: 1,
    hostTransport: 1,
    messageBridge: 2,
    entries: { vue: "vue.js", "@ontomato/sdk/panel": "panel.js" },
    stylesheet: "styles/sdk.css",
    components: "components.json",
    check: "node/panel-check.mjs",
    packageComponents: "node/package-components.mjs",
    libraries: { vue: "3.5.0" },
    docs: "docs/index.md",
  },
};

function createPort(): PanelHostPort {
  return {
    source: async () => ({ kind: "registered", applicationId: "app-a", use, panel: panelRecord }),
    pageKey: use.pageKey,
    use: { applicationId: "app-a", useId: use.id },
    panel: async () => panelRecord,
    release: async () => release,
    frame: () => ({ dispose() {}, open() {} }),
    snapshot: async (id: string) => ({ panel: { id, revision: panelRecord.revision }, projections: [] }),
    mode: { kind: "view" },
    coded: async (_source, run: DirectPanelRun, target: CodedPanelTarget) => {
      const selected = shallowRef<PanelDeepLinkStateValue | null>(
        (run.initial.selected as PanelDeepLinkStateValue | undefined) ?? null,
      );

      const render = () => {
        target.element.innerHTML = "";
        const row = document.createElement("button");
        row.className = "row-character";
        row.textContent = "character";
        row.addEventListener("click", () => {
          const next = { className: OBJECT_TYPE, primaryKey: "character" };
          selected.value = next;
          // Mirror `@ontomato/sdk/panel` (`lifecycle.ts`): both context and state are reported on selection change.
          run.context({
            url: `${run.url()}?selected=character`,
            label: "Object types",
            selection: [{ kind: OBJECT_TYPE, id: "character", label: "character" }],
          });
          run.state({ selected: next }, run.url());
          render();
        });
        target.element.appendChild(row);

        const detail = document.createElement("div");
        detail.className = "detail-view";
        const current = selected.value;
        detail.textContent = current && typeof current === "object" && "primaryKey" in current
          ? String(current.primaryKey)
          : "none";
        target.element.appendChild(detail);
      };

      run.state(run.initial, run.url());
      render();

      return {
        refresh() {},
        activate() {},
        dispose() { target.element.innerHTML = ""; },
        address(nextUrl: string) {
          pushedAddresses.push(nextUrl);
          const parsed = panelAddressState(nextUrl, manifest);
          selected.value = parsed.selected ?? null;
          render();
        },
        publicState: (): Readonly<Record<string, RuntimeJsonValue>> =>
          selected.value ? { selected: selected.value as unknown as RuntimeJsonValue } : {},
        blocksFormInputChange: () => false,
        applyStatePreservingDrafts: async () => true,
        setState() {},
        projectionsChanged() {},
        invoke: async () => {},
      };
    },
  };
}

vi.mock("../panel-host", () => ({
  resolveApplicationEntry: async () => ({
    applicationId: "app-a",
    use,
    menu: { singleEntry: true, groups: [], panelUses: [use] },
  }),
  readApplicationFrameManifest: vi.fn(),
  platformPanelHost: () => createPort(),
  onPanelReadDenied: () => () => {},
}));

const PanelApplicationRoute = (await import("../pages/PanelApplicationRoute.vue")).default;

beforeAll(() => {
  installWorkbenchI18n({
    supported: ["en"], defaultLocale: "en", initialLocale: "en", switchEnabled: false, save: null,
    messages: { en: publicEn }, elementLocale: () => elementEn,
  });
});

describe("single-panel row selection beside a conversation", () => {
  it("keeps the selected detail and reports the updated address when opened at a bare page address", async () => {
    pushedAddresses.length = 0;
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/agents/chat", component: { template: "<div />" } }],
    });
    await router.push("/agents/chat?page=/applications/app-a/objects");
    await router.isReady();

    const displayedAddress = ref("/applications/app-a/objects");
    const reportedAddresses: string[] = [];
    const latestContext = ref<unknown>(null);

    const HostShell = defineComponent({
      setup() {
        return () => h("div", { "data-has-context": String(Boolean(latestContext.value)) }, [
          h(PanelApplicationRoute, {
            applicationId: "app-a",
            address: displayedAddress.value,
            navigate: () => Promise.resolve(true),
            onContext: (ctx: unknown) => {
              // Mirrors BusinessWorkbench storing reactive pageContext, which schedules a parent re-render
              // before `PanelHost` finishes emitting `display-address`.
              latestContext.value = ctx;
            },
            "onDisplay-address": (input: { kind: string; address: string }) => {
              reportedAddresses.push(input.address);
              displayedAddress.value = input.address;
            },
          }),
        ]);
      },
    });

    const wrapper = mount(HostShell, {
      global: { plugins: [workbenchI18n(), router] },
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.find(".detail-view").text()).toBe("none");
    pushedAddresses.length = 0;

    await wrapper.find(".row-character").trigger("click");
    await flushPromises();
    await nextTick();

    expect(wrapper.find(".detail-view").text()).toBe("character");
    expect(pushedAddresses).toEqual([]);
    expect(reportedAddresses.some((addr) => addr.includes("selected=character"))).toBe(true);
    expect(displayedAddress.value).toBe("/applications/app-a/objects?selected=character");

    wrapper.unmount();
  });
});
