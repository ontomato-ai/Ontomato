import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { panelAddressState } from "@ontomato/contracts/panel-host";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { FUNCTION } from "@ontomato/contracts/platform-object-types";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import { provideUnsavedChanges } from "@ontomato/platform-shell";
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
  type Sent,
} from "./panel-frame";

/*
 * Integration check for unified page paradigm host back/history & single-prompt unsaved-changes guard:
 * - A direct panel using `usePanelBack` in switch mode pushes a browser history entry when entering detail.
 * - Browser Back pops to the list address and clears selection back to null.
 * - With unsaved form edits in `ObjectForm`, triggering back (via UI button, Escape, or browser Back) prompts
 *   at most once across the host guard and `ObjectForm`'s own target watcher; Cancel keeps edits intact and Confirm
 *   discards them and returns to the list.
 * - Beside a conversation (`navigate` supplied), `PanelHost` passes `historyBack: false` so browser history is untouched.
 */

const appId = "app-back-integration";
const path = `/applications/${appId}/items`;
const itemRef = { className: FUNCTION, primaryKey: "fn-1" };

const baseMeta = {
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "2026-11-22T00:00:00.000Z",
  updatedAt: "2026-11-22T00:00:00.000Z",
  editable: true,
  visibility: "domain" as const,
  description: "",
};

const formProjection: DirectProjection = {
  ...baseMeta,
  id: "proj-back-form",
  name: "Item form",
  componentId: "@ontomato/sdk:ObjectForm",
  inputs: {
    item: { kind: "object", objectType: FUNCTION },
    values: { kind: "json" },
    changedField: { kind: "scalar", type: "string" },
  },
  outputs: {},
  config: {},
  data: {
    form: {
      source: { object: { input: "item" } },
      read: "form",
      params: { values: { input: "values" }, changedField: { input: "changedField" } },
    },
  },
  operations: {
    save: { operation: { kind: "PlatformOperation", id: `${FUNCTION}.save` }, target: { input: "item" } },
  },
};

const panel = panelRecord(
  "panel-back-switch",
  "Items",
  definePanel({
    state: {
      selected: { type: { kind: "object", objectType: FUNCTION }, deepLink: true },
    },
    members: {
      detailForm: { target: { projectionId: formProjection.id }, inputs: { item: { state: "selected" } } },
    },
    commands: {},
  }),
);
panel.content = {
  html: `
    <div id="app">
      <div v-if="!selected" class="switch-list">
        <button type="button" class="open-item" @click="openItem">Open item</button>
      </div>
      <div v-show="selected" class="switch-detail">
        <button type="button" class="back-btn" @click="goBack">Back to list</button>
        <projection slot="detailForm"></projection>
      </div>
    </div>
  `,
  module: `
    import { computed } from "vue";
    import { mountPanel, usePanelBack, usePanelContext } from "@ontomato/sdk/panel";
    await mountPanel({
      setup() {
        const { instance } = usePanelContext();
        const selected = computed(() => instance.state.values.value.selected != null);
        const clear = () => instance.state.setState({ selected: null });
        const { back } = usePanelBack(selected, clear);
        return {
          selected,
          openItem: () => instance.state.setState({ selected: ${JSON.stringify(itemRef)} }),
          goBack: () => void back(),
        };
      },
    });
  `,
};

const entryUse = { ...panelUse("use-items", "items", panel.id, path), names: { en: "Items" } };
const saveDescriptor = {
  kind: "form.save",
  handlerRef: `${FUNCTION}.save`,
  label: "Save",
  effect: "write",
  target: { source: "input", input: "item" },
  inputSchema: {},
  resultSchema: {},
  batch: false,
};
const fields = [
  { path: "/name", label: "Name", required: false, readOnly: false, valueSchema: {}, control: { kind: "text" } },
];

function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
    return Response.json({
      data: {
        applicationId: appId,
        entry: { path: `/applications/${appId}`, renderer: "panels" },
        panelUses: [entryUse],
      },
    });
  }
  if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
  if (request.path === `/api/product-panels/${panel.id}/snapshot`) {
    return panelSnapshot(panel, { [formProjection.id]: formProjection }, request);
  }
  if (request.path === `/api/product-projections/${formProjection.id}`) {
    return Response.json({ projection: formProjection });
  }
  if (request.path === "/api/product-panels/read") {
    const body = request.body as { operations?: boolean; inputs?: { item?: unknown; values?: { name?: string } } };
    if (body.operations) return Response.json({ status: "ready", value: body.inputs?.item ? { save: saveDescriptor } : {} });
    return Response.json({
      status: "ready",
      value: {
        fields,
        values: { name: body.inputs?.values?.name ?? "Original" },
        errors: [],
        revision: 1,
        save: { method: "PUT", path: "/items/:id", bodySchema: {}, draftOperation: "item.update" },
      },
    });
  }
  return nothingAt(request);
}

afterEach(() => {
  leaveFrame();
  window.history.replaceState(null, "", "/");
});

describe("PanelApplicationRoute + usePanelBack + ObjectForm integration", () => {
  it("pushes history on detail open, pops back to list cleanly, and asks only once when dirty", async () => {
    installPlatform(answer);
    window.history.replaceState({ current: path }, "", path);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/applications/:applicationId/:panelPath(.*)?",
          component: PanelApplicationRoute,
          props: (route) => ({ applicationId: String(route.params.applicationId) }),
        },
      ],
    });
    await router.push(path);
    let allowLeave = false;
    const askUnsaved = vi.fn(async () => allowLeave);
    const Shell = defineComponent({
      setup() {
        provideUnsavedChanges(askUnsaved);
        return () => h(RouterView);
      },
    });
    const { app, element } = mountPlatformPage(() => h(Shell), router);
    try {
      await vi.waitFor(() => expect(element.querySelector(".open-item")).not.toBeNull());

      // Open detail: deep-link state updates and host pushes a history marker.
      element.querySelector<HTMLButtonElement>(".open-item")!.click();
      await vi.waitFor(() => expect(element.querySelector('[data-field="/name"] input')).not.toBeNull());
      expect(panelAddressState(router.currentRoute.value.fullPath)).toEqual({ selected: itemRef });
      expect((window.history.state as Record<string, unknown>).__ontomatoPanelBack).toEqual(expect.any(String));

      // Clean browser Back returns to list and clears deep-link state.
      window.history.replaceState({ current: path }, "", path);
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
      await vi.waitFor(() => expect(element.querySelector(".open-item")).not.toBeNull());
      await vi.waitFor(() => expect(panelAddressState(router.currentRoute.value.fullPath)).toEqual({}));
      expect(askUnsaved).not.toHaveBeenCalled();

      // Re-open detail and make an unsaved edit.
      element.querySelector<HTMLButtonElement>(".open-item")!.click();
      await vi.waitFor(() => expect(element.querySelector('[data-field="/name"] input')).not.toBeNull());
      const input = element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;
      input.value = "Edited";
      input.dispatchEvent(new Event("input"));
      await vi.waitFor(() => expect(element.querySelector(".sdk-owner-form-unsaved")).not.toBeNull());

      // Clicking UI "Back to list" asks once; cancelling keeps detail and unsaved edit.
      allowLeave = false;
      element.querySelector<HTMLButtonElement>(".back-btn")!.click();
      await vi.waitFor(() => expect(askUnsaved).toHaveBeenCalledTimes(1));
      await nextTick();
      expect(element.querySelector(".open-item")).toBeNull();
      expect(element.querySelector<HTMLInputElement>('[data-field="/name"] input')!.value).toBe("Edited");

      // Confirming via Escape asks once (not twice across back guard + ObjectForm target watch) and returns to list.
      allowLeave = true;
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(element.querySelector(".open-item")).not.toBeNull());
      await vi.waitFor(() => expect(panelAddressState(router.currentRoute.value.fullPath)).toEqual({}));
      expect(askUnsaved).toHaveBeenCalledTimes(2);
    } finally {
      app.unmount();
    }
  });

  it("does not push browser history when hosted beside a conversation", async () => {
    installPlatform(answer);
    window.history.replaceState({ current: "/agents/chat" }, "", "/agents/chat");
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/agents/chat", component: { render: () => null } }],
    });
    await router.push("/agents/chat");
    const { app, element } = mountPlatformPage(
      () => h(PanelApplicationRoute, { applicationId: appId, address: path, navigate: vi.fn() }),
      router,
    );
    try {
      await vi.waitFor(() => expect(element.querySelector(".open-item")).not.toBeNull());
      element.querySelector<HTMLButtonElement>(".open-item")!.click();
      await vi.waitFor(() => expect(element.querySelector('[data-field="/name"] input')).not.toBeNull());
      expect((window.history.state as Record<string, unknown>).__ontomatoPanelBack).toBeUndefined();
    } finally {
      app.unmount();
    }
  });
});
