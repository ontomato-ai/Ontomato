/* eslint-disable vue/one-component-per-file, vue/multi-word-component-names */
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineComponent, h, nextTick, reactive, ref, computed } from "vue";
import * as VueNamespace from "vue";
import { describe, expect, it, vi } from "vitest";
import { appIcon } from "@ontomato/platform-shell";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { ApplicationEntryMenu, CurrentApplicationEntry } from "@ontomato/contracts/product-panels";
import { createPanelState } from "../../../apps-sdk/src/panel/state";
import { workbenchApplications } from "../../../workbench-server/src/services/applications/builtins";
import { runPanelModule, useTemplateCompiler } from "../panel-module";

const OPS_FRAME_DIR = path.resolve(
  __dirname,
  "../../../platform-admin/resources/builtin-panels/ops-frame",
);

const opsApp = workbenchApplications.find((app) => app.id === "operations")!;

function opsMenu(granted: readonly string[]): ApplicationEntryMenu {
  return {
    singleEntry: false,
    names: opsApp.declaration.names,
    groups: opsApp.declaration.groups ?? [],
    panelUses: (opsApp.declaration.panelUses ?? []).filter(
      use => granted.includes(use.id === "user-feedback" ? "user-feedback" : "observer"),
    ),
  };
}

async function mountOpsFrame(options: {
  granted?: readonly string[];
  initialEntry: CurrentApplicationEntry;
  initialState?: Readonly<Record<string, RuntimeJsonValue>>;
  locale?: string;
}) {
  await useTemplateCompiler();
  const panelJson = JSON.parse(readFileSync(path.join(OPS_FRAME_DIR, "panel.json"), "utf8"));
  const panelHtml = readFileSync(path.join(OPS_FRAME_DIR, "panel.html"), "utf8");
  const panelMjs = readFileSync(path.join(OPS_FRAME_DIR, "panel.mjs"), "utf8");

  const templateMatch = panelHtml.match(/<div id="app"[\s\S]*$/);
  const template = templateMatch ? templateMatch[0] : panelHtml;
  const locale = options.locale ?? "en";
  const messages = panelJson.content.messages[locale] ?? panelJson.content.messages.en;

  // Use the real createPanelState store so state.values is a Vue Ref and every write is schema-validated.
  const panelState = createPanelState(panelJson.manifest, options.initialState);

  const currentEntry = ref<CurrentApplicationEntry>(options.initialEntry);
  const entryMenu = ref<ApplicationEntryMenu>(opsMenu(options.granted ?? ["observer", "user-feedback"]));
  const navigate = vi.fn(async (nextPath: string) => {
    const matched = entryMenu.value.panelUses.find((use) => use.path === nextPath);
    if (matched) {
      currentEntry.value = {
        applicationId: "operations",
        useId: matched.id,
        pageKey: matched.pageKey,
        ...("panelId" in matched ? { panelId: matched.panelId, kind: "panel" } : { kind: matched.kind }),
        path: matched.path,
      };
    }
  });

  const panelOutputs = reactive<Record<string, unknown>>({
    "recentSessions:listed": [],
    "recentSessions:loadedCount": 0,
  });

  let chatMounts = 0;
  let chatProps: Record<string, unknown> = {};
  let chatListeners: {
    onExpand?: () => void;
    onEntryTriggered?: (payload: Record<string, unknown>) => void;
    "onUpdate:sessionId"?: (id: string | null) => void;
  } = {};

  const ProjectionStub = defineComponent({
    name: "Projection",
    inheritAttrs: false,
    props: { slot: { type: String, required: true } },
    setup(props, { attrs }) {
      if (props.slot === "chat") {
        chatMounts += 1;
      }
      return () => {
        if (props.slot === "chat") {
          chatProps = { ...attrs };
          chatListeners = {
            onExpand: attrs.onExpand as (() => void) | undefined,
            onEntryTriggered: attrs.onEntryTriggered as ((payload: Record<string, unknown>) => void) | undefined,
            "onUpdate:sessionId": attrs["onUpdate:sessionId"] as ((id: string | null) => void) | undefined,
          };
        }
        return h("div", {
          "data-projection": props.slot,
          "data-collapsed": props.slot === "chat" ? String(Boolean(attrs.collapsed)) : undefined,
        });
      };
    },
  });

  const CurrentEntryStub = defineComponent({
    name: "CurrentEntry",
    props: { member: { type: String, required: true } },
    setup(props) {
      return () => h("div", { class: "sdk-current-entry-slot", "data-current-entry": props.member });
    },
  });

  const context = {
    t: (key: string) => messages[key] ?? key,
    currentEntry: computed(() => currentEntry.value),
    entryMenu: computed(() => entryMenu.value),
    navigate,
    instance: {
      state: panelState,
    },
  };

  let mountedApp: ReturnType<typeof VueNamespace.createApp> | null = null;
  const host = document.createElement("div");
  document.body.appendChild(host);

  await runPanelModule(panelMjs, {
    vue: VueNamespace,
    "@ontomato/sdk/panel": {
      appIcon,
      usePanelContext: () => context,
      usePanelOutput: (member: string, name: string) => computed(() => panelOutputs[`${member}:${name}`]),
      async mountPanel(component: Record<string, unknown>) {
        mountedApp = VueNamespace.createApp({
          ...component,
          template,
        });
        mountedApp.component("Projection", ProjectionStub);
        mountedApp.component("CurrentEntry", CurrentEntryStub);
        mountedApp.mount(host);
      },
    },
  });

  return {
    host,
    panelState,
    get stateValues() { return panelState.values.value; },
    currentEntry,
    navigate,
    panelOutputs,
    get chatMounts() { return chatMounts; },
    get chatProps() { return chatProps; },
    get chatListeners() { return chatListeners; },
    unmount() {
      mountedApp?.unmount();
      host.remove();
    },
  };
}

describe("builtin-product-ops-frame", () => {
  it("drives the 6 sidebar items and 3 autotest tabs strictly from entryMenu without hardcoding", async () => {
    const mounted = await mountOpsFrame({
      initialEntry: {
        applicationId: "operations",
        useId: "ops-turn-evidence",
        pageKey: "ops-turn-evidence",
        panelId: "builtin-product-ops-turn-evidence",
        kind: "panel",
        path: "/ops/turn",
      },
    });
    try {
      const navButtons = [...mounted.host.querySelectorAll<HTMLButtonElement>("[data-ops-nav]")];
      expect(navButtons.map((btn) => btn.textContent?.trim())).toEqual([
        "Turn evidence",
        "Automatic tests",
        "Live logs",
        "DSL execution",
        "Operations knowledge",
        "User feedback",
      ]);
      expect(mounted.host.querySelector("[data-ops-group-tabs]")).toBeNull();

      // Switch to /ops/test -> renders the 3 autotest tabs in declared order.
      navButtons[1]!.click();
      await nextTick();
      const tabs = [...mounted.host.querySelectorAll<HTMLButtonElement>("[data-ops-tab]")];
      expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
        "Test Execution",
        "Test results",
        "Test cases",
      ]);
      expect(tabs[0]!.classList.contains("active")).toBe(true);

      // Navigate to hidden detail /ops/autotest/case -> keeps "Test results" tab active.
      mounted.currentEntry.value = {
        applicationId: "operations",
        useId: "ops-autotest-case-artifact",
        pageKey: "ops-autotest-case-artifact",
        panelId: "builtin-product-ops-autotest-case-artifact",
        kind: "panel",
        path: "/ops/autotest/case",
      };
      await nextTick();
      const updatedTabs = [...mounted.host.querySelectorAll<HTMLButtonElement>("[data-ops-tab]")];
      expect(updatedTabs[1]!.classList.contains("active")).toBe(true);
    } finally {
      mounted.unmount();
    }
  });

  it("keeps a single persistent AgentChat mounted across pure, full+floating, folded, and side states", async () => {
    const mounted = await mountOpsFrame({
      initialEntry: {
        applicationId: "operations",
        useId: "ops-turn-evidence",
        pageKey: "ops-turn-evidence",
        panelId: "builtin-product-ops-turn-evidence",
        kind: "panel",
        path: "/ops/turn",
      },
    });
    try {
      const workspace = mounted.host.querySelector<HTMLElement>("[data-ops-layout]")!;
      expect(workspace.dataset.opsLayout).toBe("full");
      expect(mounted.chatMounts).toBe(1);
      expect(mounted.chatProps.collapsed).toBe(true);

      // Toggle side-by-side pane via header action button (full -> side -> full).
      mounted.host.querySelector<HTMLButtonElement>("[data-ops-toggle-pane]")!.click();
      await nextTick();
      expect(workspace.dataset.opsLayout).toBe("side");
      expect(mounted.stateValues.pane).toBe("side");
      expect(mounted.chatProps.collapsed).toBe(false);
      expect(mounted.host.querySelector("[data-ops-resize-handle]")).not.toBeNull();
      expect(mounted.chatMounts).toBe(1);

      mounted.host.querySelector<HTMLButtonElement>("[data-ops-toggle-pane]")!.click();
      await nextTick();
      expect(workspace.dataset.opsLayout).toBe("full");
      expect(mounted.stateValues.pane).toBe("full");
      expect(mounted.chatProps.collapsed).toBe(true);
      expect(mounted.chatMounts).toBe(1);

      // Fold floating composer -> shows circular unfold button without unmounting AgentChat.
      mounted.host.querySelector<HTMLButtonElement>("[data-ops-fold-composer]")!.click();
      await nextTick();
      expect(mounted.host.querySelector("[data-ops-unfold-composer]")).not.toBeNull();
      expect(mounted.chatMounts).toBe(1);

      // Trigger ConversationEntry (submit + newSession) from evidence page -> unfolds, switches to side, syncs sessionId.
      mounted.chatListeners.onEntryTriggered?.({
        slot: "diagnose",
        submit: true,
        newSession: true,
        sessionId: "sess-ops-42",
      });
      await nextTick();
      expect(workspace.dataset.opsLayout).toBe("side");
      expect(mounted.stateValues.pane).toBe("side");
      expect(mounted.stateValues.sessionId).toBe("sess-ops-42");
      expect(mounted.chatProps.collapsed).toBe(false);
      expect(mounted.host.querySelector("[data-ops-resize-handle]")).not.toBeNull();
      expect(mounted.chatMounts).toBe(1);

      // Click Close page -> switches to pure conversation (/ops/diagnosis), keeping sessionId and syncing selectedSession with className.
      mounted.host.querySelector<HTMLButtonElement>("[data-ops-close-pane]")!.click();
      await nextTick();
      expect(mounted.navigate).toHaveBeenCalledWith("/ops/diagnosis");
      expect(workspace.dataset.opsLayout).toBe("pure");
      expect(mounted.stateValues.sessionId).toBe("sess-ops-42");
      expect(mounted.stateValues.selectedSession).toEqual({
        className: "platform:AgentSession",
        primaryKey: "sess-ops-42",
      });
      expect(mounted.chatMounts).toBe(1);

      // Click New chat -> resets sessionId and selectedSession to null while keeping the same AgentChat mounted.
      mounted.host.querySelector<HTMLButtonElement>("[data-ops-new-chat]")!.click();
      await nextTick();
      expect(mounted.stateValues.sessionId).toBeNull();
      expect(mounted.stateValues.selectedSession).toBeNull();
      expect(mounted.chatMounts).toBe(1);

      // Selecting a recent session from a feature page updates sessionId and navigates to pure conversation.
      mounted.host.querySelector<HTMLButtonElement>('[data-ops-nav="/ops/knowledge"]')!.click();
      await nextTick();
      expect(workspace.dataset.opsLayout).toBe("side");
      mounted.panelState.set("selectedSession", {
        className: "platform:AgentSession",
        primaryKey: "sess-ops-99",
      });
      await nextTick();
      expect(mounted.stateValues.sessionId).toBe("sess-ops-99");
      expect(workspace.dataset.opsLayout).toBe("pure");

      // Show more pagination advances sessionLimit from 20 to 40 when a full page is loaded.
      mounted.panelOutputs["recentSessions:loadedCount"] = 20;
      await nextTick();
      const moreBtn = mounted.host.querySelector<HTMLButtonElement>("[data-ops-sessions-more]");
      expect(moreBtn).not.toBeNull();
      moreBtn!.click();
      await nextTick();
      expect(mounted.stateValues.sessionLimit).toBe(40);
    } finally {
      mounted.unmount();
    }
  });

  it("hides chat, new chat, and recent sessions for a user-feedback-only reader", async () => {
    const mounted = await mountOpsFrame({
      granted: ["user-feedback"],
      initialEntry: {
        applicationId: "operations",
        useId: "user-feedback",
        pageKey: "user-feedback",
        panelId: "builtin-product-feedback",
        kind: "panel",
        path: "/ops/feedback",
      },
    });
    try {
      const workspace = mounted.host.querySelector<HTMLElement>("[data-ops-layout]")!;
      expect(workspace.dataset.opsLayout).toBe("content-only");
      expect(mounted.host.querySelector("[data-ops-new-chat]")).toBeNull();
      expect(mounted.host.querySelector("[data-ops-chat-pane]")).toBeNull();
      expect(mounted.chatMounts).toBe(0);
      const navButtons = [...mounted.host.querySelectorAll<HTMLButtonElement>("[data-ops-nav]")];
      expect(navButtons.map((btn) => btn.textContent?.trim())).toEqual(["User feedback"]);
    } finally {
      mounted.unmount();
    }
  });
});
