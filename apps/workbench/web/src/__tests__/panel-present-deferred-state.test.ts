import { afterEach, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type { PresentationFrame } from "@ontomato/contracts/agent-presentation";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { useConversationDisplay, type DisplayPage, type DisplayView } from "../../../../../packages/agent-shell-ui/src/conversation-display";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import {
  installPlatform,
  leaveFrame,
  mountPlatformPage,
  nothingAt,
  panelAnswer,
  panelRecord,
  panelSnapshot,
  panelUse,
  projections,
  type Sent,
} from "./panel-frame";

const SESSION = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const APP_ID = "app-deferred";
const ENTRY_PATH = `/applications/${APP_ID}/entries`;

const panel = panelRecord("panel-deferred-entries", "Entries", definePanel({
  state: {
    tab: { type: { kind: "scalar", type: "string" }, deepLink: true, default: "overview" },
    creating: { type: { kind: "scalar", type: "boolean" } },
  },
  members: {},
}));
panel.content = {
  ...panel.content,
  html: `<div id="app"><span class="tab">{{ tab }}</span><span class="creating">{{ creating ? "yes" : "no" }}</span></div>`,
  module: `import { computed } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";
await mountPanel({ setup() {
  const { instance } = usePanelContext();
  return {
    tab: computed(() => instance.state.values.value.tab ?? ""),
    creating: computed(() => instance.state.values.value.creating === true),
  };
} });
`,
};
const uses = [panelUse("use-entries", "deferred-entries", panel.id, ENTRY_PATH)];

async function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
    return Response.json({
      data: {
        applicationId: APP_ID,
        entry: { path: `/applications/${APP_ID}`, renderer: "panels" },
        panelUses: uses,
      },
    });
  }
  if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
  if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, projections, request);
  return nothingAt(request);
}

function presentFrame(address: string, state: Record<string, unknown>): PresentationFrame {
  return {
    type: "presentation",
    sessionId: SESSION,
    runId: RUN,
    toolCallId: `call-${Math.random()}`,
    target: { kind: "page", address, state: state as PresentationFrame["target"] extends { state?: infer S } ? S : never },
  };
}

afterEach(() => leaveFrame());

it("applies both deepLink and non-deepLink state once a panel mounts while keeping non-deepLink fields out of the URL", async () => {
  installPlatform(answer);
  const serialized: { page: DisplayPage | null; view: DisplayView; history: string }[] = [];
  const display = useConversationDisplay({
    features: () => [{ id: "panel", label: "Panel", icon: "pages", availability: "page", withConversation: true }],
    resolve: (address) => {
      const path = address.split("?")[0]!;
      return path === ENTRY_PATH ? { featureId: "panel", address, instance: path } : null;
    },
    serialize: async (page, view, history) => {
      serialized.push({ page, view, history });
      return true;
    },
    context: (page, reported) => ({
      url: page.address,
      label: reported?.label || "Entries",
      selection: reported?.selection ?? [],
      ...(reported?.state ? { state: reported.state } : {}),
    }),
    leave: { leaves: () => false, confirm: async () => true },
  });
  display.placed(() => "side");

  // Present same-instance state BEFORE PanelApplicationRoute has mounted and registered its controller.
  await display.present({ type: "presentation", sessionId: SESSION, runId: RUN, toolCallId: "open-1", target: { kind: "page", address: ENTRY_PATH } });
  await display.present(presentFrame(ENTRY_PATH, { tab: "entries", creating: true }));

  // URL must never contain the non-deepLink field `creating`.
  expect(display.page.value?.address).toBe(ENTRY_PATH);
  expect(serialized.every((entry) => !entry.page?.address.includes("creating"))).toBe(true);

  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/chat", component: { template: "<div />" } }] });
  await router.push("/chat");

  const Host = defineComponent({
    setup() {
      return () =>
        display.page.value
          ? h(PanelApplicationRoute, {
              applicationId: APP_ID,
              address: display.page.value.address,
              navigate: (address: string) => void display.navigate(address, { view: "side", history: "push" }),
              liveState: display.liveState.value,
              registerPageController: (controller) => display.registerPageController(display.page.value!.instance, controller),
              onDisplayAddress: display.address,
              onDisplayLoaded: display.loaded,
              onContext: display.context,
            })
          : null;
    },
  });

  const mounted = mountPlatformPage(() => h(Host), router);
  try {
    // Once mounted, both `tab: "entries"` and non-deepLink `creating: true` take effect on the live panel.
    await vi.waitFor(() => expect(mounted.element.querySelector(".tab")?.textContent).toBe("entries"));
    await vi.waitFor(() => expect(mounted.element.querySelector(".creating")?.textContent).toBe("yes"));
    // Only the deepLink field (`tab=entries`) is synced back into the address; `creating` never appears in the URL.
    await vi.waitFor(() => expect(display.page.value?.address).toBe(`${ENTRY_PATH}?tab=entries`));
    expect(serialized.every((entry) => !entry.page?.address.includes("creating"))).toBe(true);
  } finally {
    mounted.app.unmount();
  }
});

it("applies state cleanly on a fresh present() open without writing non-deepLink fields into the URL", async () => {
  installPlatform(answer);
  const serialized: { page: DisplayPage | null; view: DisplayView; history: string }[] = [];
  const display = useConversationDisplay({
    features: () => [{ id: "panel", label: "Panel", icon: "pages", availability: "page", withConversation: true }],
    resolve: (address) => {
      const path = address.split("?")[0]!;
      return path === ENTRY_PATH ? { featureId: "panel", address, instance: path } : null;
    },
    serialize: async (page, view, history) => {
      serialized.push({ page, view, history });
      return true;
    },
    context: (page, reported) => ({
      url: page.address,
      label: reported?.label || "Entries",
      selection: reported?.selection ?? [],
      ...(reported?.state ? { state: reported.state } : {}),
    }),
    leave: { leaves: () => false, confirm: async () => true },
  });
  display.placed(() => "side");

  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/chat", component: { template: "<div />" } }] });
  await router.push("/chat");

  const Host = defineComponent({
    setup() {
      return () =>
        display.page.value
          ? h(PanelApplicationRoute, {
              applicationId: APP_ID,
              address: display.page.value.address,
              navigate: (address: string) => void display.navigate(address, { view: "side", history: "push" }),
              liveState: display.liveState.value,
              registerPageController: (controller) => display.registerPageController(display.page.value!.instance, controller),
              onDisplayAddress: display.address,
              onDisplayLoaded: display.loaded,
              onContext: display.context,
            })
          : null;
    },
  });

  const mounted = mountPlatformPage(() => h(Host), router);
  try {
    const receipt = await display.present(presentFrame(ENTRY_PATH, { tab: "entries", creating: true }));
    expect(receipt).toMatchObject({ status: "opened", reason: "target_selected" });
    await vi.waitFor(() => expect(mounted.element.querySelector(".tab")?.textContent).toBe("entries"));
    await vi.waitFor(() => expect(mounted.element.querySelector(".creating")?.textContent).toBe("yes"));
    await vi.waitFor(() => expect(display.page.value?.address).toBe(`${ENTRY_PATH}?tab=entries`));
    expect(serialized.every((entry) => !entry.page?.address.includes("creating"))).toBe(true);
  } finally {
    mounted.app.unmount();
  }
});
