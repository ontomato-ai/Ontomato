import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computed, effectScope, ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ApplicationEntryMenu, ProductPanel } from "@ontomato/contracts/product-panels";
import type { PanelHostMessage } from "@ontomato/contracts/panel-host";
import { ElMessageBox } from "element-plus";
import { confirmUnsavedSwitch } from "../confirm-danger";
import {
  usePanelInstance,
  type DirectPanelRun,
  type PanelHostLabels,
  type PanelHostPort,
  type PanelSdkRelease,
} from "../panel-host";

const labels: PanelHostLabels = {
  notStarted: "Not started",
  failures: { fileUnavailable: "Could not load {file}", scriptThrew: "Script failed", scriptRejected: "Script rejected" },
  content: { styleOutside: "Style outside" },
  refresh: "Refresh",
};

const samplePanel: ProductPanel = {
  id: "panel-sample",
  domainId: "domain-1",
  name: "Sample",
  description: "",
  visibility: "domain",
  content: { html: '<div id="app">sample</div>', module: "export default {};" },
  manifest: definePanel({ state: {}, members: {} }),
  revision: 1,
  template: false,
  ownerId: "u-1",
  editable: true,
  createdAt: "2026-11-25T00:00:00.000Z",
  updatedAt: "2026-11-25T00:00:00.000Z",
};

const sdk: PanelSdkRelease = {
  base: "/sdk",
  manifest: {
    version: "1.0.0",
    product: "ontomato",
    components: "components.json",
    executionContext: 1,
    hostTransport: 1,
    messageBridge: 1,
    stylesheet: "sdk.css",
    check: "check.mjs",
    packageComponents: "node/package-components.mjs",
    libraries: {},
    docs: "docs.md",
    entries: { vue: "vue.js" },
  },
};

describe("confirmUnsavedSwitch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps confirm to save, cancel button to discard, and close/Esc to cancel", async () => {
    const spy = vi.spyOn(ElMessageBox, "confirm");

    spy.mockResolvedValueOnce("confirm" as never);
    await expect(
      confirmUnsavedSwitch("Save or discard?", "Unsaved changes", {
        saveButtonText: "Save and switch",
        discardButtonText: "Discard changes",
      }),
    ).resolves.toBe("save");

    expect(spy).toHaveBeenCalledWith(
      "Save or discard?",
      "Unsaved changes",
      expect.objectContaining({
        distinguishCancelAndClose: true,
        confirmButtonText: "Save and switch",
        cancelButtonText: "Discard changes",
      }),
    );

    spy.mockRejectedValueOnce("cancel");
    await expect(
      confirmUnsavedSwitch("Save or discard?", "Unsaved changes", {
        saveButtonText: "Save and switch",
        discardButtonText: "Discard changes",
      }),
    ).resolves.toBe("discard");

    spy.mockRejectedValueOnce("close");
    await expect(
      confirmUnsavedSwitch("Save or discard?", "Unsaved changes", {
        saveButtonText: "Save and switch",
        discardButtonText: "Discard changes",
      }),
    ).resolves.toBe("cancel");
  });
});

describe("usePanelInstance currentUser propagation", () => {
  it("passes trimmed currentUser to DirectPanelRun and iframe PanelHostMessage", async () => {
    const use = {
      id: "use-sample",
      pageKey: "sample",
      panelId: samplePanel.id,
      path: "/sample",
      access: { kind: "domain-member" as const },
    };
    const useRef = { applicationId: "app-sample", useId: use.id };
    const seenRuns: DirectPanelRun[] = [];
    const directPort: PanelHostPort = {
      pageKey: "sample-direct",
      use: useRef,
      source: async () => ({ kind: "registered", applicationId: "app-sample", use, panel: samplePanel }),
      panel: async () => samplePanel,
      release: async () => sdk,
      frame: () => ({ open() {}, dispose() {} }),
      snapshot: async () => ({ panel: { id: samplePanel.id, revision: 1 }, projections: [] }),
      coded: async (_source, run) => {
        seenRuns.push(run);
        return {
          address() {},
          activate() {},
          publicState: () => ({}),
          findBlockedForms: () => [],
          checkAgentStateChange: async () => ({ ok: true as const }),
          guardStateChange: async () => true,
          projectionsChanged() {},
          refresh() {},
          invoke: async () => undefined,
          snapshotMeta: () => ({}),
          isLoading: () => false,
          dispose() {},
        };
      },
      current: async () => true,
      mode: { kind: "view" },
    };

    const scope = effectScope();
    let directReady!: Promise<void>;
    scope.run(() => {
      const view = usePanelInstance(directPort, {
        labels,
        label: () => "Sample",
        address: () => "/sample",
        initial: () => ({}),
        currentUser: () => ({ displayName: "  Alice Wang  " }),
      });
      directReady = view.ready;
    });
    await directReady;
    await flushPromises();
    expect(seenRuns).toHaveLength(1);
    expect(seenRuns[0]?.currentUser?.()).toEqual({ displayName: "  Alice Wang  " });
    scope.stop();

    const framePanel: ProductPanel = {
      ...samplePanel,
      content: { html: "<div>sample</div>" },
    };
    const iframePort: PanelHostPort = {
      pageKey: "sample-frame",
      use: useRef,
      source: async () => ({ kind: "registered", applicationId: "app-sample", use, panel: framePanel }),
      panel: async () => framePanel,
      release: async () => sdk,
      frame: () => ({ open() {}, dispose() {} }),
      snapshot: async () => ({ panel: { id: framePanel.id, revision: 1 }, projections: [] }),
      coded: async () => { throw new Error("unused"); },
      current: async () => true,
      mode: { kind: "view" },
    };

    const frameScope = effectScope();
    let frameView!: ReturnType<typeof usePanelInstance>;
    frameScope.run(() => {
      frameView = usePanelInstance(iframePort, {
        labels,
        label: () => "Sample",
        address: () => "/sample",
        initial: () => ({}),
        currentUser: () => ({ displayName: "  Alice Wang  " }),
      });
    });
    await frameView.ready;
    await flushPromises();
    expect(frameView.document.value).toContain('"currentUser":{"displayName":"Alice Wang"}');
    frameScope.stop();
  });
});

describe("builtin platform-frame showMenu rule", () => {
  it("shows left menu for multi-entry app even when restricted reader sees only 1 entry, and hides for singleEntry apps", async () => {
    const panelPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../resources/builtin-panels/platform-frame/panel.mjs",
    );
    const source = readFileSync(panelPath, "utf8");
    const entryMenu = ref<ApplicationEntryMenu | null>(null);
    const hostMenu = ref<readonly { key: string; items: readonly { id: string; label: string }[] }[] | null>(null);
    let capturedSetup: (() => { showMenu: { value: boolean } }) | null = null;

    // Evaluate the module body with stubbed imports to test the real panel.mjs setup logic.
    const body = source
      .replace(/import\s*\{[^}]*\}\s*from\s*"vue";/, "")
      .replace(/import\s*\{[^}]*\}\s*from\s*"@ontomato\/sdk\/panel";/, "");
    const runner = new Function(
      "computed",
      "mountPanel",
      "usePanelContext",
      `return (async () => { ${body} })();`,
    );
    await runner(
      computed,
      async (def: { setup: () => { showMenu: { value: boolean } } }) => {
        capturedSetup = def.setup;
      },
      () => ({ entryMenu, hostMenu }),
    );
    expect(capturedSetup).not.toBeNull();
    const { showMenu } = capturedSetup!();

    // Restricted account on a multi-entry application (singleEntry: false) with only 1 visible entry -> still shows menu.
    entryMenu.value = {
      singleEntry: false,
      groups: [],
      panelUses: [{
        id: "use-feedback",
        pageKey: "ops-feedback",
        panelId: "panel-feedback",
        path: "/ops/feedback",
        access: { kind: "domain-member" },
        names: { en: "Feedback" },
      }],
    };
    expect(showMenu.value).toBe(true);

    // Inherently single-entry application (singleEntry: true) with 1 visible entry -> hides menu.
    entryMenu.value = {
      singleEntry: true,
      groups: [],
      panelUses: [{
        id: "use-dashboards",
        pageKey: "dashboards",
        panelId: "panel-dashboards",
        path: "/dashboards",
        access: { kind: "domain-member" },
        names: { en: "Dashboards" },
      }],
    };
    expect(showMenu.value).toBe(false);

    // Multi-entry hostMenu with 1 visible item -> shows menu when singleEntry is false.
    hostMenu.value = [{ key: "ops", items: [{ id: "/ops/feedback", label: "Feedback" }] }];
    entryMenu.value = { singleEntry: false, groups: [], panelUses: [] };
    expect(showMenu.value).toBe(true);

    // Zero visible entries -> always hides menu, even when singleEntry is false.
    hostMenu.value = [];
    entryMenu.value = { singleEntry: false, groups: [], panelUses: [] };
    expect(showMenu.value).toBe(false);
  });
});
