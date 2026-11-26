import { afterEach, expect, it, vi } from "vitest";
import { computed, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { createPanelOverlayRoot } from "@ontomato/platform-shell";
import { randomId } from "@ontomato/contracts/random-id";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { panelModuleFor, type DirectPanelMount, type DirectPanelModuleExports } from "../../../../../packages/apps-sdk/src/direct";
import type { DirectPanelComponentPort } from "../../../../../packages/apps-sdk/src/panel/direct-run";
import { noOperations, directRun } from "./panel-frame";
import type { PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";

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
  inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } }, outputs: {}, config: { operation: "runNow" },
  data: {}, operations: { runNow: { operation: { kind: "PlatformOperation", id: "schedules.runNow" }, target: { input: "task" } } },
};
const describedRunNow = { kind: "action", handlerRef: "schedules.runNow", label: "Run now", effect: "write", target: { source: "input", input: "task" }, inputSchema: {}, resultSchema: {}, batch: false };
const manifest: DirectPanelManifest = {
  state: {
    mode: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: true, external: false },
    selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: true, external: false },
  },
  members: { run: { target: { projectionId: runNow.id }, inputs: { task: { state: "selectedTask" } } } },
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

function run(template: string, options: {
  overlayRoot?: HTMLElement;
  windowOverlayRoot?: HTMLElement;
  shown?: () => boolean;
  descriptor?: Record<string, unknown>;
  confirmOperation?: DirectPanelComponentPort["confirmOperation"];
} = {}) {
  const reads: PanelMemberReadRequest[] = [];
  const element = document.createElement("div");
  document.body.append(element);
  const intentId = randomId();
  const readOperationBodies: unknown[] = [];
  const requests: DirectPanelComponentPort["requests"] = {
    request: async (path, init) => {
      if (path === "/panel-operations/intents") {
        return Response.json({ intentId, operationId: "run.runNow", label: "Run now", confirmation: { kind: "none" } });
      }
      if (path === "/panel-operations/read") {
        readOperationBodies.push(JSON.parse(String(init?.body)));
        return Response.json({ kind: "json", value: { done: true } });
      }
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
    run: directRun({
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: {},
      failed: (reason) => { throw reason; },
      overlayRoot: options.overlayRoot,
      windowOverlayRoot: options.windowOverlayRoot,
      shown: options.shown,
    }),
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests, use: { applicationId: "app-tasks", useId: "tasks" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: options.confirmOperation ?? noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> => {
      reads.push(request);
      return { status: "ready", value: (request.operations ? { runNow: options.descriptor ?? describedRunNow } : null) as never };
    },
  });
  return { module, mount, element, reads, readOperationBodies };
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
  expect(first.reads).toEqual([{ memberPath: [{ member: "run" }], operations: true, inputs: { task: null } }]);
  expect(second.reads).toEqual(first.reads);

  one.context.instance.state.set("mode", "edit");
  await nextTick();
  expect(first.element.querySelector(".mode")?.textContent).toBe("edit");
  expect(second.element.querySelector(".mode")?.textContent).toBe("list");
  expect(mountTwo.instance.state.values.value.mode).toBeNull();

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
  // The settings panel draws no member: it reads no datum, though its members' operations are known from the start.
  expect(settings.reads.filter((read) => read.dataName)).toEqual([]);

  settingsMount.dispose();
  expect(settings.element.innerHTML).toBe("");
  expect(list.element.querySelector(".sdk-operation-button button")).toBeTruthy();
  listMount.dispose();
});

it("draws each member in its own container, with no input left on the component's element", async () => {
  const { module, mount, element } = run(`<Projection slot="run"/>`);
  const { context } = await evaluate(module, "");
  await drawn(element);
  // An input the component reads through its slot is not one of its props: it reaches no element as an attribute.
  context.instance.state.set("selectedTask", { className: SCHEDULED_TASK, primaryKey: "t-1" });
  await nextTick();
  const container = element.querySelector('[data-member="run"]');
  expect(container?.querySelector(".sdk-operation-button button")).toBeTruthy();
  expect(element.querySelector("[task]")).toBeNull();
  (await mount).dispose();
});

it("mounts a module's component once", async () => {
  const { module, mount } = run(`<p>{{ words }}</p>`);
  await evaluate(module, "once");
  await expect(evaluate(module, "twice")).rejects.toThrow("A panel's module mounts its component once");
  (await mount).dispose();
});


it("mounts the Element Plus popper container in the whole-window overlay root", async () => {
  const region = document.createElement("section");
  document.body.append(region);
  const overlay = createPanelOverlayRoot("popper-test", () => true, () => region);
  const { module, mount } = run("", {
    overlayRoot: overlay.element,
    windowOverlayRoot: overlay.windowElement,
  });
  await evaluate(module, "popper");
  const mounted = await mount;
  try {
    const popper = overlay.windowElement.querySelector('[id^="el-popper-container-"]');
    expect(popper).not.toBeNull();
    expect(overlay.element.querySelector('[id^="el-popper-container-"]')).toBeNull();
  } finally {
    mounted.dispose();
    overlay.dispose();
  }
});

it("scopes a custom operation's one-time delivery to the panel overlay and preserves it while hidden", async () => {
  const showing = ref(true);
  const overlay = createPanelOverlayRoot("secret-test", () => showing.value);
  const secret = {
    items: [{ label: "Temporary key", value: "one-time-fixture-key" }],
    download: { filename: "key.txt", contentType: "text/plain", content: "a2V5", encoding: "base64" as const },
  };
  const { module, mount } = run("", {
    overlayRoot: overlay.element,
    shown: () => showing.value,
    confirmOperation: async (preparation) => ({
      decision: "confirm",
      response: { kind: "dispatched", intentId: preparation.intentId, outcome: { kind: "success", data: {}, secret } },
    }),
  });
  let receipt: unknown;
  const { context } = await module.mountPanel({
    setup() {
      const operation = module.usePanelOperation("run", "runNow", { onSettled: (value) => { receipt = value; } });
      return () => h("button", { disabled: !operation.operation.value, onClick: () => operation.run() }, "Generate");
    },
  });
  const mounted = await mount;
  try {
    context.instance.state.set("selectedTask", { className: SCHEDULED_TASK, primaryKey: "t-1" });
    const button = await vi.waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>("button");
      expect(button?.disabled).toBe(false);
      return button!;
    });
    button.click();
    const dialog = await vi.waitFor(() => {
      const dialog = overlay.element.querySelector(".sdk-secret-delivery-dialog");
      expect(dialog?.querySelector<HTMLInputElement>("input[type=password]")?.value).toBe(secret.items[0]!.value);
      return dialog!;
    });
    expect(document.querySelectorAll(".sdk-secret-delivery-dialog")).toHaveLength(1);
    expect(receipt).toMatchObject({ response: { outcome: { secretGenerated: true } } });
    expect(JSON.stringify(receipt)).not.toContain(secret.items[0]!.value);
    showing.value = false;
    await nextTick();
    expect(overlay.element.hidden).toBe(true);
    expect(overlay.element.inert).toBe(true);
    showing.value = true;
    await nextTick();
    expect(overlay.element.hidden).toBe(false);
    expect(overlay.element.contains(dialog)).toBe(true);
    const downloads: string[] = [];
    const clickLink = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    try {
      expect(downloads).toEqual([]);
      [...dialog.querySelectorAll("button")].find(button => button.textContent?.includes(secret.download.filename))!.click();
      expect(downloads).toEqual([secret.download.filename]);
    } finally {
      clickLink.mockRestore();
    }
    dialog.querySelector<HTMLButtonElement>(".el-dialog__headerbtn")!.click();
    await vi.waitFor(() => expect(overlay.element.querySelector(".sdk-secret-delivery-dialog")).toBeNull());
    expect(context.instance.secretDeliveries.value).toEqual([]);
  } finally {
    mounted.dispose();
    overlay.dispose();
  }
});

it("blocks agent-supplied read secrets and forwards the run when a custom read has ordinary input", async () => {
  const { module, mount, readOperationBodies } = run("", {
    descriptor: {
      ...describedRunNow, effect: "read", target: { source: "none" },
      secretFields: ["password"],
      inputSchema: { properties: { password: { type: "string" }, token: { type: "string", format: "password" } } },
    },
  });
  const { context } = await module.mountPanel({
    setup() {
      const operation = module.usePanelOperation("run", "runNow");
      return () => h("button", { disabled: !operation.operation.value, onClick: () => operation.run({ password: "human" }) }, "Read");
    },
  });
  const mounted = await mount;
  try {
    const agentRun = { sessionId: randomId(), runId: randomId(), toolCallId: "read" };
    const button = await vi.waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>("button");
      expect(button?.disabled).toBe(false);
      return button!;
    });
    const secretInputs: readonly Record<string, string>[] = [{ password: "agent" }, { token: "agent" }];
    for (const input of secretInputs) {
      expect(await context.instance.executeAction({ operation: "run.runNow", input, agentRun })).toMatchObject({
        ok: false, code: "PANEL_SECRET_HUMAN_INPUT_REQUIRED",
      });
    }
    expect(readOperationBodies).toEqual([]);
    expect(await context.instance.executeAction({ operation: "run.runNow", agentRun })).toMatchObject({ ok: true });
    expect(readOperationBodies[0]).toMatchObject({ agentRun, call: { input: {} } });
    button.click();
    await vi.waitFor(() => expect(readOperationBodies[1]).toMatchObject({ call: { input: { password: "human" } } }));
    expect(readOperationBodies[1]).not.toHaveProperty("agentRun");
  } finally {
    mounted.dispose();
  }
});
