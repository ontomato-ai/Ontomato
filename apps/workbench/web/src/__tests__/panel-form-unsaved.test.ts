import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, provide, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { FUNCTION } from "@ontomato/contracts/platform-object-types";
import { mountDirectPanel } from "../../../../../packages/apps-sdk/src/panel/direct-mount";
import { panelContextKey } from "../../../../../packages/apps-sdk/src/panel/context";
import { usePanelBack } from "../../../../../packages/apps-sdk/src/panel/back";
import { directRun, noOperations } from "./panel-frame";

/*
 * (Harness shared in shape with panel-form-advanced.) Fields an owner marks `advanced` (A's contract, 2026-11-22: an application entry's inputs): at each level — the form,
 * an object's fields, a row of a list — they are drawn after the others in one section that starts closed and that the
 * reader opens; one of them that the owner refuses opens it, so a message is never hidden.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const projection: DirectProjection = {
  ...record, id: "app-form", name: "Application", componentId: "@ontomato/sdk:ObjectForm",
  inputs: { app: { kind: "object", objectType: FUNCTION }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
  outputs: {}, config: {},
  data: { form: { source: { object: { input: "app" } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
  operations: { save: { operation: { kind: "PlatformOperation", id: `${FUNCTION}.save` }, target: { input: "app" } } },
};
const manifest: DirectPanelManifest = {
  state: { app: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: true, external: false } },
  members: { form: { target: { projectionId: projection.id }, inputs: { app: { state: "app" } } } },
};
const text = (path: string, label: string, advanced?: true) => ({
  path, label, required: false, readOnly: false, valueSchema: {}, control: { kind: "text" }, ...(advanced ? { advanced } : {}),
});
const fields = [
  text("/name", "Name"),
  text("/slug", "Slug", true),
  {
    path: "/entries", label: "Entries", required: false, readOnly: false, valueSchema: {},
    control: { kind: "object-array", itemFields: [text("/title", "Title"), text("/inputs", "Inputs", true)] },
  },
];
const save = { kind: "form.save", handlerRef: `${FUNCTION}.save`, label: "Save", effect: "write", target: { source: "input", input: "app" }, inputSchema: {}, resultSchema: {}, batch: false };

afterEach(() => {
  document.body.innerHTML = "";
});

function open(errors: { field: string; code: string; message: string }[]) {
  const mount = mountDirectPanel({
    manifest,
    run: directRun({ pageKey: "apps", url: () => "/apps", label: () => "Apps", initial: { app: { className: FUNCTION, primaryKey: "a-1" } } }),
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async () => Response.json({ projection }) },
    use: { applicationId: "app", useId: "apps" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> => request.operations
      ? { status: "ready", value: { save } as never }
      : { status: "ready", value: { fields, values: { name: "Orders", slug: "orders", entries: [{ title: "Home", inputs: "{}" }] }, errors, revision: 1,
        save: { method: "PUT", path: "/apps/:id", bodySchema: {}, draftOperation: "app.update" } } as never },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => mount.member("form") });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  return { mount, app, element };
}


// A form with changes says so beside Save and Discard, and Discard asks before it throws them away (原页面对照《智能体设置》,
// panelisation lead 2026-11-22: a reader could lose a whole stretch of editing to one click).
it("says a form has unsaved changes, and asks before discarding them", async () => {
  const { mount, app, element } = open([]);
  await vi.waitFor(() => expect(element.querySelector('[data-field="/name"] input')).not.toBeNull());
  const unsaved = () => element.querySelector(".sdk-owner-form-unsaved")?.textContent?.trim() ?? null;
  expect(unsaved()).toBeNull();
  const name = element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;
  name.value = "Orders 2";
  name.dispatchEvent(new Event("input"));
  await vi.waitFor(() => expect(unsaved()).toBe("1 change"));
  const discard = () => [...element.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")].find((button) => button.textContent?.trim() === "Discard")!.click();
  const dialog = () => document.querySelector<HTMLElement>(".el-message-box");
  // Kept: the reader goes on editing.
  discard();
  await vi.waitFor(() => expect(dialog()?.textContent).toContain("Discard the changes you have not saved?"));
  [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Keep editing")!.click();
  await vi.waitFor(() => expect(dialog()?.style.display ?? "none").toBe("none"));
  expect(name.value).toBe("Orders 2");
  expect(unsaved()).toBe("1 change");
  // Discarded: back to what the owner holds.
  discard();
  await vi.waitFor(() => expect(dialog()?.style.display).not.toBe("none"));
  [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Discard")!.click();
  await vi.waitFor(() => expect(element.querySelector<HTMLInputElement>('[data-field="/name"] input')!.value).toBe("Orders"));
  expect(unsaved()).toBeNull();
  app.unmount();
  mount.dispose();
});

// Regression for A-33: confirming leave on a dirty ObjectForm that has both `form` and `createForm` must discard and
// leave cleanly to the list without re-prompting or reverting `selected` back onto the detail record.
it("returns to list cleanly when confirming leave on a dirty form with createForm via usePanelBack", async () => {
  const dualProjection: DirectProjection = {
    ...projection,
    id: "app-dual-form",
    data: {
      form: projection.data.form,
      createForm: { source: { type: { kind: "PlatformObjectType", id: FUNCTION } }, read: "createForm", params: { values: { input: "values" }, changedField: { input: "changedField" } } },
    },
  };
  const dualManifest: DirectPanelManifest = {
    state: { app: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: true, external: false } },
    members: { form: { target: { projectionId: dualProjection.id }, inputs: { app: { state: "app" } } } },
  };
  let allowLeave = false;
  const confirmLeaveUnsaved = vi.fn(async () => allowLeave);
  const mount = mountDirectPanel({
    manifest: dualManifest,
    run: {
      ...directRun({ pageKey: "apps", url: () => "/apps", label: () => "Apps", initial: { app: { className: FUNCTION, primaryKey: "a-1" } } }),
      confirmLeaveUnsaved,
    },
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async () => Response.json({ projection: dualProjection }) },
    use: { applicationId: "app", useId: "apps" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> => request.operations
      ? { status: "ready", value: { save } as never }
      : { status: "ready", value: { fields, values: { name: "Orders", slug: "orders", entries: [] }, errors: [], revision: 1,
        save: { method: "PUT", path: "/apps/:id", bodySchema: {}, draftOperation: "app.update" } } as never },
  });
  let backHandle!: ReturnType<typeof usePanelBack>;
  const element = document.createElement("div");
  document.body.append(element);
  const Inner = {
    setup() {
      backHandle = usePanelBack(
        () => Boolean(mount.instance.state.values.value.app),
        () => mount.instance.state.set("app", null),
        { pushHistory: false },
      );
      return () => (mount.instance.state.values.value.app ? mount.member("form") : h("div", { class: "list-view" }, "list"));
    },
  };
  const app = createApp({
    setup() {
      provide(panelContextKey, {
        instance: mount.instance,
        manifest: dualManifest,
        t: (k: string) => k,
        navigate: noOperations.navigate,
        notify: () => {},
        confirmLeaveUnsaved: () => (mount.instance.dirty() ? confirmLeaveUnsaved() : Promise.resolve(true)),
      } as unknown as import("../../../../../packages/apps-sdk/src/panel/context").PanelContext);
      return () => h(Inner);
    },
  });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);

  await vi.waitFor(() => expect(element.querySelector('[data-field="/name"] input')).not.toBeNull());
  const name = element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;
  name.value = "Orders dirty";
  name.dispatchEvent(new Event("input"));
  await vi.waitFor(() => expect(mount.instance.dirty()).toBe(true));

  // Cancel leave: stays on detail and keeps edits.
  allowLeave = false;
  expect(await backHandle.back()).toBe(false);
  expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(1);
  expect(mount.instance.state.values.value.app).toEqual({ className: FUNCTION, primaryKey: "a-1" });

  // Confirm leave: discards cleanly, returns to list, does not re-prompt or revert selection.
  allowLeave = true;
  expect(await backHandle.back()).toBe(true);
  await vi.waitFor(() => expect(element.querySelector(".list-view")).not.toBeNull());
  expect(mount.instance.state.values.value.app).toBeNull();
  expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(2);
  expect(mount.instance.dirty()).toBe(false);

  app.unmount();
  mount.dispose();
});
