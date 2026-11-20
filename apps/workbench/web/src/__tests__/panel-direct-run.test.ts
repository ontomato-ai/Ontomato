import { afterEach, expect, it, vi } from "vitest";
import { computed, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadRequest, ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { panelModuleFor, type DirectPanelMount, type DirectPanelModuleExports } from "../../../../../packages/apps-sdk/src/direct";
import { noOperations } from "./panel-frame";

/*
 * A panel written with code, run in the platform's own document (big main's ruling, 2026-11-20): its module mounts its
 * component through the run's own entry, its template draws in the host's element, `<Projection>` draws the run's member
 * with the data read through the host's one read port, and the run stays its own — the same panel twice on a page, or two
 * panels at once, keep their own state, read their own data and unmount alone.
 *
 * What this rules out: a module mounted through a frame's bridge in the platform's document; a run that writes another
 * run's state or reads for it; a run whose disposal takes another's component or reads with it; a module mounting twice.
 */

const base = { domainId: "d", ownerId: "o", createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "", revision: 1 };
const runNow: DirectProjection = {
  ...base, id: "task-run", name: "Run now", componentId: "@ontomato/sdk:OperationButton",
  inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } }, outputs: {}, config: {},
  data: { operation: { source: { operation: { kind: "PlatformOperation", id: "schedules.runNow" } }, read: "describe", params: {} } },
};
const describedRunNow = { handlerRef: "schedules.runNow", label: "Run now", effect: "write", target: { source: "input", input: "task" }, inputSchema: {}, resultSchema: {}, batch: false };
const manifest: DirectPanelManifest = {
  state: {
    mode: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: true, external: false },
    selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: true, external: false },
  },
  members: { run: { target: { projectionId: runNow.id }, inputs: { task: { state: "selectedTask" } } } },
  events: {},
};

/** A panel's module as an author writes it: its component reads the instance's state; its HTML is the template. */
async function evaluate(entry: DirectPanelModuleExports, words: string) {
  const Panel = {
    setup() {
      const { instance } = entry.usePanelContext();
      return { mode: computed(() => instance.state.values.value.mode ?? "list"), words };
    },
  };
  return await entry.mountPanel(Panel);
}

function run(template: string) {
  const reads: Omit<ProductPanelReadRequest, "source">[] = [];
  const element = document.createElement("div");
  document.body.append(element);
  const requests = {
    request: async (path: string) => {
      if (path !== `/product-projections/${runNow.id}`) throw new Error(`Nothing at ${path}`);
      return Response.json({ projection: runNow });
    },
  };
  let mounted!: (mount: DirectPanelMount) => void;
  const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
  const module = panelModuleFor({
    mounted,
    element,
    template,
    // The platform's words; Element Plus's components the run registers itself, as a frame does.
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })); },
    manifest,
    run: {
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: {},
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {},
      failed: (reason) => { throw reason; },
    },
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests, use: { applicationId: "app-tasks", useId: "tasks" },
    expandPageComposer: noOperations.expandPageComposer,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> => {
      reads.push(request);
      return { status: "ready", value: describedRunNow as never };
    },
  });
  return { module, mount, element, reads };
}

const drawn = (element: HTMLElement) => vi.waitFor(() => {
  const button = element.querySelector(".sdk-operation-button button");
  if (!button) throw new Error("The member is not drawn yet");
  return button;
});

afterEach(() => {
  document.body.innerHTML = "";
});

it("runs the same panel twice on a page, each with its own state, reads and unmounting", async () => {
  const template = `<section class="mode">{{ mode }}</section><Projection slot="run"/>`;
  const first = run(template);
  const second = run(template);
  const [one, two] = await Promise.all([evaluate(first.module, "one"), evaluate(second.module, "two")]);
  const [mountOne, mountTwo] = await Promise.all([first.mount, second.mount]);
  await Promise.all([drawn(first.element), drawn(second.element)]);
  expect(first.reads).toEqual([{ memberPath: [{ member: "run" }], dataName: "operation", inputs: { task: null } }]);
  expect(second.reads).toEqual(first.reads);

  one.context.instance.state.set("mode", "edit");
  await nextTick();
  expect(first.element.querySelector(".mode")?.textContent).toBe("edit");
  expect(second.element.querySelector(".mode")?.textContent).toBe("list");
  expect(mountTwo.values.value.mode).toBeNull();

  // The first run goes; the second keeps its component and reads on its own.
  mountOne.dispose();
  expect(first.element.innerHTML).toBe("");
  mountTwo.refresh(null);
  await vi.waitFor(() => expect(second.reads).toHaveLength(2));
  expect(first.reads).toHaveLength(1);
  expect(second.element.querySelector(".sdk-operation-button button")).toBeTruthy();
  expect(two.context.instance.state.values.value.mode).toBeNull();
});

it("runs two different panels at once, each drawn from its own template", async () => {
  const list = run(`<h2 class="title">{{ words }}</h2><Projection slot="run"/>`);
  const settings = run(`<aside class="title">{{ words }} {{ mode }}</aside>`);
  await Promise.all([evaluate(list.module, "Tasks"), evaluate(settings.module, "Settings")]);
  const [listMount, settingsMount] = await Promise.all([list.mount, settings.mount]);
  await drawn(list.element);
  expect(list.element.querySelector("h2.title")?.textContent).toBe("Tasks");
  expect(settings.element.querySelector("aside.title")?.textContent).toBe("Settings list");
  expect(settings.reads).toEqual([]);

  settingsMount.dispose();
  expect(settings.element.innerHTML).toBe("");
  expect(list.element.querySelector(".sdk-operation-button button")).toBeTruthy();
  listMount.dispose();
});

it("mounts a module's component once", async () => {
  const { module, mount } = run(`<p>{{ words }}</p>`);
  await evaluate(module, "once");
  await expect(evaluate(module, "twice")).rejects.toThrow("A panel's module mounts its component once");
  (await mount).dispose();
});
