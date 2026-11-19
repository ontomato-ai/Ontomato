import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { h, nextTick, ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { PANEL_LOAD_ERROR_CODES, type PresentationFrame } from "@ontomato/contracts/agent-presentation";
import type { PanelObjectIdentity } from "@ontomato/contracts/panel-manifest";
import type { ProductDefinitionStreamFrame, ProductDefinitionTarget } from "@ontomato/contracts/product-subscriptions";
import { PanelHost } from "@ontomato/platform-shell";
import { panelAuthorDefinitions, platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import type { PanelFrameMessage } from "@ontomato/contracts/panel-host";
import { PANEL_HOST_CHANNEL, panelAddress } from "@ontomato/contracts/panel-host";
import { useConversationDisplay } from "../../../../../packages/agent-shell-ui/src/conversation-display";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { platformLayoutRoute } from "../../../../../packages/platform-web/src/layout-route";
import {
  hostMessageOf, inspectionTaskForm, inside, installPlatform, leaveFrame, manifestP, manifestQ, mountPlatformPage, nothingAt,
  currentSdk, humanIntents, panelHostFrame, panelRecord, panelSnapshot, panelUse, projections, READER, run, SCHEDULED_TASK, SDK_VERSION, task, taskForm,
  writeFrameDocument,
  type Sent,
  caseSetLabel,
} from "./panel-frame";

const appA = "app-panels-trial-a";
const appB = "app-panels-trial-b";
const panelPath = join(dirname(fileURLToPath(import.meta.url)), "../../../../../packages/apps-sdk/examples/panels/schedules-trial");
const p = panelRecord("panel-schedules-trial", "Trial panel P", manifestP);
const q = panelRecord("panel-schedules-summary", "Trial panel Q", manifestQ);
p.content.html = readFileSync(join(panelPath, "p/panel.html"), "utf8");
q.content.html = readFileSync(join(panelPath, "q/panel.html"), "utf8");
const useP = panelUse("use-trial-a-tasks", "panels-trial-a-tasks", p.id, `/applications/${appA}/tasks`);
const useQ = panelUse("use-trial-b-summary", "panels-trial-b-summary", q.id, `/applications/${appB}/summary`);
const taskPath = "/api/data-query/platform/scheduled-tasks";
const deepState = { selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id } };
const secondTask = { ...task, id: "ac186b00-a3dd-46d2-b404-72065d877a34", title: "Second scheduled task" };

function answer(request: Sent) {
  if (request.path === "/api/data-query/platform/applications") return Response.json({ success: true, data: [appA, appB].map(id => ({
    id, kind: "product", names: { en: id }, descriptions: {}, icon: "schedules",
    rail: "apps", category: "business", sort: 0, entry: { path: `/${id.slice(4)}`, renderer: "panels" },
    entryAccess: ["domain-member"], scheduleAdapter: null, releaseId: null,
  })) });
  const applicationId = [appA, appB].find(id => request.path === `/api/data-query/platform/applications/${id}/panel-uses`);
  if (applicationId) return Response.json({ data: {
    applicationId, entry: { path: "/", renderer: "panels" }, panelUses: [applicationId === appA ? useP : useQ],
  } });
  const panel = [p, q].find(panel => request.path === `/api/product-panels/${panel.id}`);
  if (panel) return Response.json({ panel });
  const snapshot = [p, q].find(panel => request.path === `/api/product-panels/${panel.id}/snapshot`);
  if (snapshot) return panelSnapshot(snapshot);
  const projection = Object.values(projections).find(projection => request.path === `/api/product-projections/${projection.id}`);
  if (projection) return Response.json({ projection });
  if (request.path === "/api/apps-sdk/current") return currentSdk();
  if (request.path === taskPath) return Response.json({ tasks: [task], timeZone: task.timeZone });
  if (request.path === `${taskPath}/${task.id}`) return Response.json(task);
  if (request.path === `${taskPath}/${secondTask.id}`) return Response.json(secondTask);
  if (request.path === "/api/assistant/sessions/session-1/runs/run-1/page-draft") return Response.json({
    pageKey: useP.pageKey, operation: `${SCHEDULED_TASK}.save`, target: { id: task.id },
    form: { ...task.content, caseSetId: "set-smoke" },
  });
  if (request.path === `${taskPath}/applications/${task.appId}/form`) return taskFormFor((request.body as { values: typeof taskForm.values }).values);
  return nothingAt(request);
}

async function mountPage(address: string, usePlatformRoutes: boolean, reply: typeof answer, listeners: object) {
  const sent = installPlatform(reply);
  if (usePlatformRoutes) await useApplicationCatalog().refresh();
  const router = createRouter({ history: createMemoryHistory(), routes: usePlatformRoutes ? [platformLayoutRoute([])] : [{
    path: "/applications/:applicationId/:panelPath",
    component: PanelApplicationRoute,
    props: route => ({ applicationId: route.params.applicationId, ...listeners }),
  }] });
  await router.push(address);
  const { app, element } = mountPlatformPage(() => h(RouterView), router);
  return { app, element, router, sent };
}

async function open(address: string, usePlatformRoutes = false, reply = answer, listeners = {}) {
  const page = await mountPage(address, usePlatformRoutes, reply, listeners);
  return { ...page, frame: await panelHostFrame() };
}

async function startFrame(frame: HTMLIFrameElement, setup: () => object = () => ({})) {
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  writeFrameDocument(hostMessageOf(frame.srcdoc));
  inside(frame.contentWindow!);
  return mountPanel({ setup });
}

afterEach(() => {
  leaveFrame();
  // Each real frame starts with its own SDK modules and registries.
  vi.resetModules();
});

it("opens the first visible use at its own URL when entering a panel application", async () => {
  const { app, frame, router, sent } = await open(`/applications/${appB}`, true);
  try {
    expect(hostMessageOf(frame.srcdoc).pageKey).toBe(useQ.pageKey);
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(`/applications/${appB}/summary`));
    expect(sent.some(request => request.path.endsWith("/policy"))).toBe(false);
  } finally {
    app.unmount();
  }
});

it("opens a viewing panel with a short snapshot and no definition stream", async () => {
  const { app, sent } = await open(`/applications/${appB}/summary`);
  try {
    expect(sent.some(request => request.method === "GET" && request.path === `/api/product-panels/${q.id}/snapshot`)).toBe(true);
    expect(sent.filter(request => request.path.startsWith("/api/product-assets/"))).toEqual([]);
  } finally {
    app.unmount();
  }
});

it("updates shared summary X from P's selection and opens the next application's panel in the same route", async () => {
  const { app, element, frame, router, sent } = await open(`/applications/${appA}/tasks`);
  try {
    const operations: PanelFrameMessage[] = [];
    const listener = (event: MessageEvent) => {
      if (event.data?.channel === PANEL_HOST_CHANNEL && event.data.kind === "operations") operations.push(event.data);
    };
    window.addEventListener("message", listener);
    try {
      const { context } = await startFrame(frame);
      const option = await vi.waitFor(() => {
        const button = document.querySelector<HTMLButtonElement>('#app [role="option"]');
        expect(button?.textContent).toContain(task.title);
        return button!;
      });
      option.click();
      await vi.waitFor(() => {
        expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title);
        expect(document.querySelector(".sdk-owner-form form [data-field]")).not.toBeNull();
        expect(document.querySelector(".sdk-operation-button button")).not.toBeNull();
      });
      // The header slot is drawn by ElCard, not by an unresolved custom tag.
      expect(document.querySelector("#app aside")?.textContent).toContain("Scheduled tasks");
      expect(sent.filter(request => request.path === `${taskPath}/${task.id}`)).toHaveLength(2);
      expect(operations.some(message => message.kind === "operations" && message.operations.some(operation => operation.kind === "form.save"))).toBe(true);
      expect(router.currentRoute.value.query.state).toBe(JSON.stringify(deepState));

      const samePage = `/applications/${appA}/tasks`;
      await router.push(panelAddress(samePage, { selectedTask: { className: SCHEDULED_TASK, primaryKey: secondTask.id } }));
      await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(secondTask.title));
      expect(element.querySelector("iframe.panel-host-frame")).toBe(frame);
      expect(router.currentRoute.value.query.state).toContain(secondTask.id);

      const draftQuery = new URLSearchParams({ draftSessionId: "session-1", draftRunId: "run-1", draftPath: "outputs/drafts/task.page-draft.json" });
      await router.push(panelAddress(`${samePage}?${draftQuery}`, context.instance.deepLink()));
      await vi.waitFor(() => expect(context.draft.value?.form.caseSetId).toBe("set-smoke"));
      expect(element.querySelector("iframe.panel-host-frame")).toBe(frame);
      expect(sent.some(request => request.method === "PUT")).toBe(false);

      await router.push(`/applications/${appB}/summary`);
      await vi.waitFor(() => {
        const next = element.querySelector<HTMLIFrameElement>("iframe.panel-host-frame");
        expect(next?.srcdoc).toContain(useQ.pageKey);
      });
      expect(element.querySelector('[role="alert"]')).toBeNull();
    } finally {
      window.removeEventListener("message", listener);
    }
  } finally {
    app.unmount();
  }
});

it("mounts Q at its deep-linked task and reads X over the real bridge", async () => {
  const { app, element, frame, sent } = await open(panelAddress(`/applications/${appB}/summary`, deepState));
  try {
    const { context } = await startFrame(frame);
    await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title));
    expect(sent.filter(request => request.path === `${taskPath}/${task.id}`)).toMatchObject([{ method: "GET", credential: READER }]);
    expect(context.instance.deepLink()).toEqual(deepState);
    expect(document.querySelector("#app")?.textContent).toContain("Task");
    expect(element.querySelector('[role="alert"]')).toBeNull();
  } finally {
    app.unmount();
  }
});

it("renders and handles a new Element Plus menu in the author's card slot", async () => {
  const panel = {
    ...q,
    content: {
      ...q.content,
      html: q.content.html.replace("</el-card>", `
        <template #footer>
          <el-menu v-on:select="selected = $event">
            <el-menu-item index="details">Details</el-menu-item>
          </el-menu>
          <output>{{ selected }}</output>
        </template>
        </el-card>`),
    },
  };
  const { app, frame } = await open(panelAddress(`/applications/${appB}/summary`, deepState), false, request =>
    request.path === `/api/product-panels/${q.id}` ? Response.json({ panel }) : answer(request));
  try {
    await startFrame(frame, () => ({ selected: ref("") }));
    const item = document.querySelector<HTMLElement>('#app [role="menuitem"]');
    expect(item).not.toBeNull();
    item!.click();
    await vi.waitFor(() => expect(document.querySelector("#app output")?.textContent).toBe("details"));
  } finally {
    app.unmount();
  }
});

it("reports loading until the connected frame reports, then echoes a selection without navigating", async () => {
  const onDisplayLoaded = vi.fn();
  const onDisplayAddress = vi.fn();
  const navigate = vi.fn();
  const address = `/applications/${appB}/summary`;
  const { app, frame, router } = await open(address, false, answer, {
    address, navigate, onDisplayLoaded, onDisplayAddress,
  });
  try {
    expect(onDisplayLoaded.mock.calls).toEqual([[{ status: "loading" }]]);
    const { context } = await startFrame(frame);
    await vi.waitFor(() => expect(onDisplayLoaded.mock.calls).toEqual([
      [{ status: "loading" }], [{ status: "ready" }],
    ]));
    context.instance.state.set("selectedTask", deepState.selectedTask);
    await vi.waitFor(() => expect(onDisplayAddress).toHaveBeenLastCalledWith({
      kind: "state", address: panelAddress(address, deepState),
    }));
    expect(navigate).not.toHaveBeenCalled();
    expect(router.currentRoute.value.fullPath).toBe(address);
  } finally {
    app.unmount();
  }
});

it.each([
  {
    code: PANEL_LOAD_ERROR_CODES.fileUnavailable,
    message: "The panel could not load /apps-sdk/1.1.1/panel.js",
    trigger: (frameEvents: EventTarget) => {
      const event = new Event("error");
      Object.defineProperty(event, "target", { value: { tagName: "SCRIPT", src: "/apps-sdk/1.1.1/panel.js" } });
      frameEvents.dispatchEvent(event);
    },
  },
  {
    code: PANEL_LOAD_ERROR_CODES.scriptThrew,
    message: "The panel's script failed during setup",
    trigger: (frameEvents: EventTarget) => {
      frameEvents.dispatchEvent(new ErrorEvent("error", {
        message: "Uncaught",
        error: new Error("The panel's script failed during setup"),
      }));
    },
  },
  {
    code: PANEL_LOAD_ERROR_CODES.scriptRejected,
    message: "The panel's initialization was rejected",
    trigger: (frameEvents: EventTarget) => {
      frameEvents.dispatchEvent(Object.assign(new Event("unhandledrejection"), {
        reason: new Error("The panel's initialization was rejected"),
      }));
    },
  },
])("reports $code with its original message", async ({ code, message, trigger }) => {
  const onDisplayLoaded = vi.fn();
  const { app, element, frame } = await open(`/applications/${appB}/summary`, false, answer, { onDisplayLoaded });
  try {
    const bootstrap = frame.srcdoc.match(/<script>\n([\s\S]*?)<\/script>/)![1]!;
    inside(frame.contentWindow!);
    const frameEvents = new EventTarget();
    Object.assign(frameEvents, { parent: window.parent });
    new Function("window", bootstrap)(frameEvents);
    trigger(frameEvents);
    await vi.waitFor(() => {
      expect(element.querySelector('[role="alert"]')?.textContent).toBe(message);
      expect(onDisplayLoaded.mock.calls).toEqual([
        [{ status: "loading" }],
        [{ status: "error", error: { code, message } }],
      ]);
    });
  } finally {
    app.unmount();
  }
});

it.each([
  {
    case: "the application declares no use at this address",
    response: () => Response.json({ data: {
      applicationId: appB, entry: { path: "/", renderer: "panels" }, panelUses: [],
    } }),
    message: `${useQ.path} is not a panel of this application`,
    status: "",
  },
  {
    case: "reading uses fails",
    response: () => Response.json({ error: { message: "Application catalog failed" } }, { status: 500 }),
    message: "Application catalog failed",
    status: "HTTP 500: ",
  },
])("reports a load error when $case", async ({ response, message, status }) => {
  const onDisplayLoaded = vi.fn();
  const { app, element, sent } = await mountPage(useQ.path, false, request => {
    if (request.path === `/api/data-query/platform/applications/${appB}/panel-uses`) return response();
    return answer(request);
  }, { onDisplayLoaded });
  try {
    await vi.waitFor(() => {
      expect(element.querySelector('[role="alert"]')?.textContent).toBe(message);
      expect(onDisplayLoaded.mock.calls).toEqual([
        [{ status: "loading" }],
        [{ status: "error", error: { code: PANEL_LOAD_ERROR_CODES.panelUnavailable, message: status + message } }],
      ]);
    });
    // The route reads the application's uses once; no panel is read for an address that names none.
    expect(sent.filter(request => request.path.endsWith("/panel-uses"))).toHaveLength(1);
    expect(sent.some(request => request.path.startsWith("/api/product-panels/"))).toBe(false);
  } finally {
    app.unmount();
  }
});

function visibility() {
  const current = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  function set(value: "visible" | "hidden") {
    current.mockReturnValue(value);
    document.dispatchEvent(new Event("visibilitychange"));
  }
  set("visible");
  return { set, reset: () => { set("visible"); current.mockRestore(); } };
}

it.each([403, 404, 500])("reports HTTP %i when the foreground snapshot is unavailable", async status => {
  const foreground = visibility();
  const onDisplayLoaded = vi.fn();
  let refused = false;
  const message = "The panel's owner refused this read";
  const { app, frame } = await open(`/applications/${appB}/summary`, false, request => {
    if (refused && request.path === `/api/product-panels/${q.id}/snapshot`) return Response.json({ error: { message } }, { status });
    return answer(request);
  }, { onDisplayLoaded });
  try {
    await startFrame(frame);
    await vi.waitFor(() => expect(onDisplayLoaded).toHaveBeenLastCalledWith({ status: "ready" }));
    foreground.set("hidden");
    refused = true;
    foreground.set("visible");
    await vi.waitFor(() => expect(onDisplayLoaded).toHaveBeenLastCalledWith({
      status: "error", error: { code: PANEL_LOAD_ERROR_CODES.panelUnavailable, message: `HTTP ${status}: ${message}` },
    }));
  } finally {
    app.unmount();
    foreground.reset();
  }
});

it("sends an initial clean report from the frame", async () => {
  const { app, frame } = await open(`/applications/${appB}/summary`);
  const wireDirty = vi.fn();
  const listener = (event: MessageEvent) => {
    if (event.source === frame.contentWindow && event.data?.channel === PANEL_HOST_CHANNEL && event.data.kind === "dirty") {
      wireDirty(event.data.dirty);
    }
  };
  window.addEventListener("message", listener);
  try {
    await startFrame(frame);
    await vi.waitFor(() => expect(wireDirty).toHaveBeenCalledWith(false));
  } finally {
    window.removeEventListener("message", listener);
    app.unmount();
  }
});

it("names the selected object by the label its owner gave it, and keeps the name out of the address", async () => {
  const address = panelAddress(`/applications/${appA}/tasks`, deepState);
  const { app, frame, router } = await open(address);
  const selections: unknown[] = [];
  const listener = (event: MessageEvent) => {
    if (event.source === frame.contentWindow && event.data?.channel === PANEL_HOST_CHANNEL && event.data.kind === "context")
      selections.push(event.data.context.selection);
  };
  window.addEventListener("message", listener);
  try {
    await startFrame(frame);
    // The selection arrives from the address as a key alone; the name follows once a projection has read the object.
    await vi.waitFor(() => expect(selections.at(-1)).toEqual([
      { kind: SCHEDULED_TASK, id: task.id, label: `${task.title} (${SCHEDULED_TASK} ${task.id})` },
    ]));
    // An object the list never held is named by the summary's own read of it.
    await router.push(panelAddress(`/applications/${appA}/tasks`, { selectedTask: { className: SCHEDULED_TASK, primaryKey: secondTask.id } }));
    await vi.waitFor(() => expect(selections.at(-1)).toEqual([
      { kind: SCHEDULED_TASK, id: secondTask.id, label: `${secondTask.title} (${SCHEDULED_TASK} ${secondTask.id})` },
    ]));
    expect(router.currentRoute.value.fullPath).not.toContain(encodeURIComponent(secondTask.title).slice(0, 12));
    expect(JSON.parse(String(router.currentRoute.value.query.state))).toEqual({
      selectedTask: { className: SCHEDULED_TASK, primaryKey: secondTask.id },
    });
  } finally {
    window.removeEventListener("message", listener);
    app.unmount();
  }
});

it("blocks a presentation while a reader's form edit is unsaved, then clears dirty on discard and save", async () => {
  const path = `/applications/${appA}/tasks`;
  const address = panelAddress(path, deepState);
  const dashboard = "/dashboards";
  const serialize = vi.fn(async () => true);
  const display = useConversationDisplay({
    features: () => [
      { id: "panel", label: "Tasks", icon: "schedules", availability: "page", withConversation: true },
      { id: "dashboards", label: "Dashboards", icon: "dashboard", availability: "page", withConversation: true },
    ],
    resolve: url => url === dashboard
      ? { featureId: "dashboards", address: url, instance: dashboard }
      : { featureId: "panel", address: url, instance: path },
    serialize,
    context: (page, reported) => reported ?? { url: page.address, label: "", selection: [] },
    leave: { leaves: () => false, confirm: async () => true },
  });
  display.follow(address, "side");
  display.placed(() => "side");
  const presentation: PresentationFrame = {
    type: "presentation",
    sessionId: "11111111-1111-4111-8111-111111111111",
    runId: "22222222-2222-4222-8222-222222222222",
    toolCallId: "show-dashboards",
    target: { kind: "page", address: dashboard },
  };
  const baseline = { operation: "inspection", instruction: "Inspect the latest failures" };
  const saved = { ...baseline, instruction: "Inspect the monthly failures" };
  let current = { ...task, content: baseline, formRevision: inspectionTaskForm.formRevision };
  const onDisplayDirty = vi.fn(display.dirty);
  const { app, element, frame, router, sent } = await open(address, false, request => {
    if (request.path === `${taskPath}/applications/${task.appId}/form`) {
      return Response.json({ ...inspectionTaskForm, values: current.content, submittable: true });
    }
    if (request.path === `${taskPath}/${task.id}`) {
      if (request.method === "PUT") current = { ...current, revision: current.revision + 1, content: saved };
      return Response.json(current);
    }
    return answer(request);
  }, {
    address,
    navigate: vi.fn(),
    onContext: display.context,
    onDisplayAddress: display.address,
    onDisplayLoaded: display.loaded,
    onDisplayDirty,
  });
  const editInstruction = (value: string) => {
    const input = document.querySelector<HTMLTextAreaElement>('[data-field="/instruction"] textarea')!;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const clickFormButton = (label: string) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")]
      .find(button => button.textContent?.trim() === label)!;
    expect(button.disabled).toBe(false);
    button.click();
  };
  try {
    await startFrame(frame);
    await vi.waitFor(() => expect(document.querySelector<HTMLTextAreaElement>('[data-field="/instruction"] textarea')?.value)
      .toBe(baseline.instruction));
    editInstruction("Inspect the weekly failures");
    await vi.waitFor(() => expect(onDisplayDirty).toHaveBeenLastCalledWith(true));

    expect(await display.present(presentation)).toMatchObject({
      status: "not_opened", reason: "blocked_unsaved", current: { target: { url: address } },
    });
    expect(serialize).not.toHaveBeenCalled();
    expect(router.currentRoute.value.fullPath).toBe(address);
    expect(element.querySelector("iframe.panel-host-frame")).toBe(frame);

    clickFormButton("Discard");
    await vi.waitFor(() => expect(onDisplayDirty).toHaveBeenLastCalledWith(false));
    expect(sent.filter(request => request.method === "PUT")).toHaveLength(0);

    editInstruction(saved.instruction);
    await vi.waitFor(() => expect(onDisplayDirty).toHaveBeenLastCalledWith(true));
    clickFormButton("Save");
    await vi.waitFor(() => expect(onDisplayDirty).toHaveBeenLastCalledWith(false));
    expect(sent.find(request => request.method === "PUT")?.body).toMatchObject({ content: saved });
    expect(await display.present(presentation)).toMatchObject({
      status: "opened", reason: "target_selected", current: { target: { url: dashboard } },
    });
  } finally {
    app.unmount();
  }
});

it("refreshes X from the owner after the panel's form saves", async () => {
  let current = task;
  const before = panelAddress(`/applications/${appA}/tasks`, deepState);
  // The run, as the task service's registered operation does it when the platform's coordinator dispatches it.
  const intents = humanIntents(() => {
    current = { ...current, summary: [{ key: "run", label: "Run", value: "Run started" }] };
    return {
      kind: "success", data: { runId: run.id },
      affected: { objects: [{ objectType: SCHEDULED_TASK, primaryKey: task.id }], objectTypes: [SCHEDULED_TASK] },
    };
  });
  const { app, frame, sent } = await open(before, false, request => {
    const prepared = intents(request);
    if (prepared) return prepared;
    if (request.path === `${taskPath}/${task.id}`) {
      if (request.method === "PUT") {
        current = { ...current, revision: current.revision + 1,
          summary: [{ key: "instruction", label: "Instruction", value: "Saved instruction" }] };
      }
      return Response.json(current);
    }
    return answer(request);
  });
  try {
    const { context } = await startFrame(frame);
    await vi.waitFor(() => {
      expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title);
      expect(document.querySelector(".sdk-owner-form [data-field]")).not.toBeNull();
    });
    const definitions = sent.filter(request => request.path.startsWith("/api/product-projections/")).length;
    await context.instance.invoke("form.save");
    await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary")?.textContent).toContain("Saved instruction"));
    document.querySelector<HTMLButtonElement>(".sdk-operation-button button")!.click();
    await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary")?.textContent).toContain("Run started"));
    expect(sent.filter(request => request.path.startsWith("/api/product-projections/"))).toHaveLength(definitions);
  } finally {
    app.unmount();
  }
});

function taskFormFor(values: typeof taskForm.values) {
  const fields = taskForm.fields.map(field => field.type === "select" && field.key === "caseSetId"
    ? { ...field, options: [...field.options, ...["set-smoke", "agent-cases", "agent-later"].map(value => ({
      value, label: value, description: null, disabled: false, disabledReason: null,
    }))] }
    : field);
  return Response.json({ ...taskForm, fields, values });
}

it("opens the saved draft's old link as an ordinary panel", async () => {
  let current = task;
  const path = `/applications/${appA}/tasks`;
  // A run's draft link names its session and run by their UUIDs; the settled draft is reported by them.
  const session = "5b0f8a52-3d2e-4c1a-9a7e-1f2b3c4d5e01";
  const runId = "5b0f8a52-3d2e-4c1a-9a7e-1f2b3c4d5e02";
  const draftQuery = new URLSearchParams({ draftSessionId: session, draftRunId: runId, draftPath: "outputs/drafts/task.page-draft.json" });
  const draftAddress = panelAddress(`${path}?${draftQuery}`, deepState);
  const { app, element, frame, router, sent } = await open(draftAddress, false, request => {
    if (request.path === `/api/assistant/sessions/${session}/runs/${runId}/page-draft`) return Response.json({
      pageKey: useP.pageKey, operation: `${SCHEDULED_TASK}.save`, target: { id: task.id },
      form: { ...task.content, caseSetId: "set-smoke" },
    });
    if (request.path === `${taskPath}/${task.id}`) {
      if (request.method === "PUT") {
        current = { ...current, revision: current.revision + 1, content: (request.body as { content: typeof task.content }).content };
      }
      return Response.json(current);
    }
    if (request.path === `${taskPath}/applications/${task.appId}/form`) {
      const body = request.body as { values: typeof taskForm.values };
      return taskFormFor(body.values);
    }
    return answer(request);
  });
  try {
    const { context } = await startFrame(frame);
    await vi.waitFor(() => expect(document.querySelector(".sdk-owner-form-changed")?.textContent ?? "").toContain(caseSetLabel));
    await context.instance.invoke("form.save");
    expect(current.content.caseSetId).toBe("set-smoke");
    await vi.waitFor(() => expect(context.draft.value).toBeNull());

    await router.push(panelAddress(path, deepState));
    await vi.waitFor(() => expect(context.instance.pageContext.value.url).not.toContain("draftSessionId"));
    await router.push(draftAddress);
    await vi.waitFor(() => {
      expect(sent.filter(request => request.path.endsWith("/page-draft"))).toHaveLength(2);
      expect(sent.filter(request => request.path.endsWith("/form")).at(-1)?.body).toMatchObject({ values: current.content });
    });
    // Let the adapter consume the reread owner's form before checking that the draft stayed empty.
    await vi.waitFor(() => {
      expect(context.draft.value).toBeNull();
      expect(context.instance.dirty()).toBe(false);
      expect(document.querySelector(".sdk-owner-form-changed")).toBeNull();
      expect([...document.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")].map(button => button.disabled))
        .toEqual([true, true]);
    });
    expect(element.querySelector(".panel-host-error")?.textContent).toBeUndefined();
    expect(element.querySelector("iframe.panel-host-frame")).toBe(frame);
    expect(sent.filter(request => request.method === "PUT")).toHaveLength(1);
  } finally {
    app.unmount();
  }
});

it("uses the conversation object signal to refresh only matching objects and preserves a dirty form until discard", async () => {
  let current = task;
  const refresh = ref<{ seq: number; target: PanelObjectIdentity | null } | null>(null);
  const address = `/applications/${appA}/tasks`;
  const onDisplayDirty = vi.fn();
  const { app, element, frame, router, sent } = await open(panelAddress(address, deepState), false, request => {
    if (request.path === `${taskPath}/${task.id}`) return Response.json(current);
    if (request.path === `${taskPath}/applications/${task.appId}/form`) {
      return taskFormFor((request.body as { values: typeof taskForm.values }).values);
    }
    return answer(request);
  }, { onDisplayDirty, get objectRefresh() { return refresh.value; } });
  const formReads = () => sent.filter(request => request.path.endsWith("/form"));
  const dataReads = () => sent.filter(request => request.path === `${taskPath}/${task.id}`);
  const notify = (target: PanelObjectIdentity | null) => {
    refresh.value = { seq: (refresh.value?.seq ?? 0) + 1, target };
  };
  try {
    const { context } = await startFrame(frame);
    await vi.waitFor(() => {
      expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title);
      expect(document.querySelector(".sdk-owner-form [data-field]")).not.toBeNull();
    });
    const definitions = sent.filter(request => request.path.startsWith("/api/product-projections/")).length;
    const before = dataReads().length;
    current = { ...current, revision: current.revision + 1, content: { ...current.content, caseSetId: "agent-cases" },
      summary: [{ key: "instruction", label: "Instruction", value: "Agent changed saved data" }] };
    notify({ objectType: "platform:Other", primaryKey: task.id });
    await nextTick();
    notify({ objectType: SCHEDULED_TASK, primaryKey: secondTask.id });
    await nextTick();
    notify({ objectType: SCHEDULED_TASK, primaryKey: task.id });
    await vi.waitFor(() => {
      expect(document.querySelector(".sdk-object-summary")?.textContent).toContain("Agent changed saved data");
      expect(formReads().at(-1)?.body).toMatchObject({ values: current.content });
    });
    expect(dataReads()).toHaveLength(before + 2);

    const query = new URLSearchParams({ draftSessionId: "session-1", draftRunId: "run-1", draftPath: "outputs/drafts/task.page-draft.json" });
    await router.push(panelAddress(`${address}?${query}`, deepState));
    await vi.waitFor(() => expect(document.querySelector(".sdk-owner-form-changed")?.textContent).toContain(caseSetLabel));
    const editing = formReads().length;
    current = { ...current, revision: current.revision + 1, content: { ...current.content, caseSetId: "agent-later" },
      summary: [{ key: "instruction", label: "Instruction", value: "Agent changed it again" }] };
    notify(null);
    await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary")?.textContent).toContain("Agent changed it again"));
    expect(formReads()).toHaveLength(editing);
    expect(context.instance.dirty()).toBe(true);
    await vi.waitFor(() => expect(onDisplayDirty).toHaveBeenLastCalledWith(true));
    expect(context.draft.value?.form.caseSetId).toBe("set-smoke");

    const discard = [...document.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")]
      .find(button => button.textContent?.trim() === "Discard")!;
    discard.click();
    await vi.waitFor(() => expect(formReads().at(-1)?.body).toMatchObject({ values: current.content }));
    expect(context.instance.dirty()).toBe(false);
    await vi.waitFor(() => expect(onDisplayDirty).toHaveBeenLastCalledWith(false));
    expect(sent.filter(request => request.path.startsWith("/api/product-projections/"))).toHaveLength(definitions);
    expect(sent.filter(request => request.path.startsWith("/api/product-assets/"))).toEqual([]);
    expect(element.querySelector("iframe.panel-host-frame")).toBe(frame);
  } finally {
    app.unmount();
  }
});

it("reconciles definitions and objects on foreground without replacing an unchanged panel", async () => {
  const foreground = visibility();
  let current = task;
  let panel = p;
  let summary = projections["projection-schedules-summary"]!;
  const { app, element, frame, sent } = await open(panelAddress(`/applications/${appA}/tasks`, deepState), false, request => {
    if (request.path === `/api/product-panels/${panel.id}`) return Response.json({ panel });
    if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, { ...projections, [summary.id]: summary });
    if (request.path === `/api/product-projections/${summary.id}`) return Response.json({ projection: summary });
    if (request.path === `${taskPath}/${task.id}`) return Response.json(current);
    if (request.path === `${taskPath}/applications/${task.appId}/form`)
      return taskFormFor((request.body as { values: typeof taskForm.values }).values);
    return answer(request);
  });
  const definitionReads = () => sent.filter(request => /\/api\/product-(panels|projections)\//.test(request.path) && !request.path.endsWith("/snapshot"));
  const formReads = () => sent.filter(request => request.path.endsWith("/form"));
  try {
    await startFrame(frame);
    await vi.waitFor(() => {
      expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title);
      expect(document.querySelector(".sdk-owner-form [data-field]")).not.toBeNull();
    });
    const initialDefinitions = definitionReads().length;
    const initialForms = formReads().length;
    const srcdoc = frame.srcdoc;
    foreground.set("hidden");
    current = { ...current, revision: current.revision + 1, content: { ...current.content, caseSetId: "agent-cases" },
      summary: [{ key: "instruction", label: "Instruction", value: "Changed while hidden" }] };
    foreground.set("visible");
    await vi.waitFor(() => {
      expect(document.querySelector(".sdk-object-summary")?.textContent).toContain("Changed while hidden");
      expect(formReads().at(-1)?.body).toMatchObject({ values: current.content });
    });
    expect(formReads()).toHaveLength(initialForms + 1);
    expect(definitionReads().slice(initialDefinitions)).toEqual([]);
    expect(frame.srcdoc).toBe(srcdoc);

    foreground.set("hidden");
    summary = { ...summary, revision: summary.revision + 1, display: { fields: ["settings"] } };
    foreground.set("visible");
    await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary dt")?.textContent).toBe("settings"));
    expect(definitionReads().slice(initialDefinitions).map(request => request.path)).toEqual([
      `/api/product-projections/${summary.id}`,
    ]);
    expect(element.querySelector("iframe.panel-host-frame")).toBe(frame);

    // A new revision of the same definition is read by the host, and the frame keeps running the document it has.
    foreground.set("hidden");
    panel = { ...p, revision: p.revision + 1 };
    foreground.set("visible");
    await vi.waitFor(() => expect(definitionReads().at(-1)?.path).toBe(`/api/product-panels/${p.id}`));
    await nextTick();
    expect(frame.srcdoc).toBe(srcdoc);

    // A revision that changes the definition reaches the frame: only the renderable definition crosses into it.
    foreground.set("hidden");
    panel = { ...p, revision: p.revision + 2, content: { ...p.content, html: `${p.content.html}<p id="rearranged"></p>` } };
    foreground.set("visible");
    await vi.waitFor(() => expect(hostMessageOf(frame.srcdoc).panel.content.html).toContain('id="rearranged"'));
    expect(hostMessageOf(frame.srcdoc).panel).toEqual({ content: panel.content, manifest: panel.manifest, sdkVersion: SDK_VERSION });
    expect(sent.filter(request => request.path.startsWith("/api/product-assets/"))).toEqual([]);
  } finally {
    app.unmount();
    foreground.reset();
  }
});

it("shares one definition stream across author panels, restores a changed collection, and observes a projection-only candidate", async () => {
  const foreground = visibility();
  const author = panelAuthorDefinitions();
  const mode = { kind: "author", definitions: author } as const;
  const showP = ref(true);
  let summary = projections["projection-schedules-summary"]!;
  const streams: { targets: ProductDefinitionTarget[]; body: ReadableStreamDefaultController<Uint8Array> }[] = [];
  const openBodies = new Set<ReadableStreamDefaultController<Uint8Array>>();
  installPlatform(request => {
    if (request.path === "/api/product-panels/definition-stream") {
      let body!: ReadableStreamDefaultController<Uint8Array>;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          body = controller;
          openBodies.add(body);
          streams.push({ targets: (request.body as { targets: ProductDefinitionTarget[] }).targets, body });
        },
        cancel() { openBodies.delete(body); },
      }), { headers: { "content-type": "text/event-stream" } });
    }
    if (request.path === `/api/product-projections/${summary.id}`) return Response.json({ projection: summary });
    return answer(request);
  });
  function send(stream: number, payload: ProductDefinitionStreamFrame) {
    streams[stream]!.body.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
  }
  const signals = () => vi.mocked(fetch).mock.calls
    .filter(([url]) => String(url).endsWith("/definition-stream")).map(([, init]) => init!.signal!);
  const labels = {
    notStarted: "Panel has not started",
    failures: { fileUnavailable: "File unavailable", scriptThrew: "Script threw", scriptRejected: "Script rejected" },
  };
  const portA = platformPanelHost(appA, useP, mode);
  const portB = platformPanelHost(appB, useQ, mode);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { render: () => null } }] });
  await router.push("/");
  const page = mountPlatformPage(() => h("main", [
    showP.value ? h(PanelHost, { key: "p", port: portA, address: useP.path, labels }) : null,
    h(PanelHost, { key: "q", port: portB, address: useQ.path, labels, initial: deepState }),
  ]), router);
  try {
    await vi.waitFor(() => expect(streams.at(-1)?.targets).toEqual(expect.arrayContaining([
      { kind: "panel", id: p.id }, { kind: "panel", id: q.id }, { kind: "projection", id: summary.id },
    ])));
    expect(signals().filter(signal => !signal.aborted)).toHaveLength(1);
    const fullCollection = streams.length - 1;
    expect(streams[fullCollection]!.targets.filter(({ id }) => id === summary.id)).toHaveLength(1);
    const frameQ = await vi.waitFor(() => {
      const frames = page.element.querySelectorAll<HTMLIFrameElement>("iframe");
      expect(frames).toHaveLength(2);
      return frames[1]!;
    });
    await startFrame(frameQ);
    await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title));

    showP.value = false;
    await vi.waitFor(() => expect(streams.at(-1)?.targets).toEqual([
      { kind: "panel", id: q.id }, { kind: "projection", id: summary.id },
    ]));
    const reduced = streams.length - 1;
    expect(signals()[fullCollection]!.aborted).toBe(true);
    expect(signals().filter(signal => !signal.aborted)).toHaveLength(1);

    // The shared projection changed while the old request closed and the reduced collection opened.
    const previous = summary;
    summary = { ...summary, revision: summary.revision + 1, display: { fields: ["settings"] } };
    send(reduced, { kind: "snapshot", definitions: [{ kind: "projection", id: summary.id, revision: summary.revision }] });
    await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary dt")?.textContent).toBe("settings"));
    send(reduced, { kind: "definition-changed", definition: { kind: "projection", id: summary.id, revision: previous.revision } });

    foreground.set("hidden");
    expect(signals().filter(signal => !signal.aborted)).toHaveLength(0);
    foreground.set("visible");
    expect(signals().filter(signal => !signal.aborted)).toHaveLength(1);
  } finally {
    page.app.unmount();
  }

  const revisions = vi.fn();
  const candidate = author.observe([{ kind: "projection", id: summary.id }], revisions, error => { throw error; });
  try {
    expect(streams.at(-1)?.targets).toEqual([{ kind: "projection", id: summary.id }]);
    expect(signals().filter(signal => !signal.aborted)).toHaveLength(1);
    const revision = { kind: "projection", id: summary.id, revision: summary.revision + 1 } as const;
    send(streams.length - 1, { kind: "definition-changed", definition: revision });
    send(streams.length - 1, {
      kind: "snapshot", definitions: [{ ...revision, revision: summary.revision }],
    });
    await vi.waitFor(() => expect(revisions.mock.calls).toEqual([[[revision]]]));
  } finally {
    candidate.close();
    foreground.reset();
    for (const body of openBodies) body.close();
  }
  expect(signals().filter(signal => !signal.aborted)).toHaveLength(0);
});

it.each([true, false])("resolves a panel draft through the bridge with created=%s", async created => {
  const path = `/applications/${appA}/tasks`;
  const selected = { selectedTask: { className: SCHEDULED_TASK, primaryKey: secondTask.id } };
  const query = new URLSearchParams({ draftSessionId: "session-1", draftRunId: "run-1", draftPath: "outputs/drafts/task.page-draft.json" });
  const { app, element, frame, router, sent } = await open(panelAddress(path, selected), false, request => {
    if (request.path.endsWith("/page-draft")) return Response.json({
      pageKey: useP.pageKey, operation: `${SCHEDULED_TASK}.save`, target: {},
      form: { ...task.content, caseSetId: "set-smoke" },
      ...(created ? { created: { id: task.id } } : {}),
    });
    return answer(request);
  });
  try {
    const { context } = await startFrame(frame);
    await vi.waitFor(() => expect(document.querySelector(".sdk-owner-form [data-field]")).not.toBeNull());
    const taskReads = () => sent.filter(request => request.method === "GET" && request.path.startsWith(`${taskPath}/`));
    const initialReads = taskReads().length;
    await router.push(panelAddress(`${path}?${query}`, selected));
    if (created) {
      await vi.waitFor(() => {
        expect(context.draft.value?.target.id).toBe(task.id);
        expect(context.instance.deepLink()).toEqual(deepState);
        expect(document.querySelector(".sdk-owner-form-changed")?.textContent ?? "").toContain(caseSetLabel);
      });
      const addressedReads = taskReads().slice(initialReads);
      expect(addressedReads).not.toHaveLength(0);
      expect(addressedReads.every(request => request.path === `${taskPath}/${task.id}`)).toBe(true);
    } else {
      await vi.waitFor(() => expect(element.querySelector(".panel-host-error")?.textContent)
        .toBe("This panel's form does not create objects"));
      expect(context.draft.value).toBeNull();
      expect(context.instance.dirty()).toBe(false);
      expect(context.instance.deepLink()).toEqual(selected);
      expect(taskReads()).toHaveLength(initialReads);
    }
    expect(sent.filter(request => request.method === "PUT")).toEqual([]);
  } finally {
    app.unmount();
  }
});

it.each([
  { name: "revision outside the form", extra: { revision: 7 }, invalid: "revision" },
  { name: "a removed field", extra: { caseSetId: task.content.caseSetId }, invalid: "caseSetId" },
  { name: "fields of the refreshed form", extra: {}, invalid: null },
])("validates draft $name after asking the owner for the dependent form", async ({ extra, invalid }) => {
  const path = `/applications/${appA}/tasks`;
  const query = new URLSearchParams({ draftSessionId: "session-1", draftRunId: "run-1", draftPath: "outputs/drafts/inspection.page-draft.json" });
  const drafted = { operation: "inspection", instruction: "Inspect the latest failures", ...extra };
  const formPath = `${taskPath}/applications/${task.appId}/form`;
  const { app, element, frame, router, sent } = await open(panelAddress(path, deepState), false, request => {
    if (request.path.endsWith("/page-draft")) return Response.json({
      pageKey: useP.pageKey, operation: `${SCHEDULED_TASK}.save`, target: { id: task.id }, form: drafted,
    });
    if (request.path === formPath) {
      const { values, changedField } = request.body as {
        values: { operation: string; instruction?: string }; changedField: string | null;
      };
      if (changedField === "operation")
        return Response.json({ ...inspectionTaskForm, values: { operation: values.operation, instruction: values.instruction }, submittable: true });
    }
    return answer(request);
  });
  try {
    const { context } = await startFrame(frame);
    await vi.waitFor(() => expect(document.querySelector('.sdk-owner-form [data-field="/caseSetId"]')).not.toBeNull());
    await router.push(panelAddress(`${path}?${query}`, deepState));
    await vi.waitFor(() => expect(sent.filter(request => request.path === formPath)
      .some(request => (request.body as { changedField?: string }).changedField === "operation")).toBe(true));
    if (invalid) {
      await vi.waitFor(() => expect(element.querySelector(".panel-host-error")?.textContent ?? "")
        .toContain(`Draft fields not in the current form: ${invalid}`));
      expect(context.draft.value).toBeNull();
      expect(context.instance.dirty()).toBe(false);
      expect(document.querySelector(".sdk-owner-form-changed")).toBeNull();
      expect([...document.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")].every(button => button.disabled)).toBe(true);
    } else {
      await vi.waitFor(() => {
        // The changed fields, named by the application's own labels.
        expect(document.querySelector(".sdk-owner-form-changed")?.textContent ?? "").toContain(
          inspectionTaskForm.fields.map(field => field.label).join(", "));
        expect(document.querySelector<HTMLTextAreaElement>('[data-field="/instruction"] textarea')?.value).toBe(drafted.instruction);
        expect(document.querySelector('.sdk-owner-form [data-field="/caseSetId"]')).toBeNull();
      });
      const save = [...document.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")]
        .find(button => button.textContent?.trim() === "Save");
      expect(save?.disabled).toBe(false);
    }
    expect(sent.filter(request => request.method === "PUT")).toEqual([]);
  } finally {
    app.unmount();
  }
});
