import { describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";
import type { ApplicationPanelUse, ProductPanel } from "@ontomato/contracts/product-panels";
import { panelAddress, panelAddressState, PANEL_HOST_CHANNEL } from "@ontomato/contracts/panel-host";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { panelFrameDocument, usePanelInstance, type DefinitionChanged, type DefinitionTarget, type PanelHostPort } from "../panel-host";

/*
 * The host loads one panel per application use, keeps each instance's state to itself, and hands a changed definition to
 * the instances that use it: a changed projection reaches every instance whose panel names it, a changed panel reaches
 * its own instances and nothing else, and never over a form the reader has unsaved. The mistakes these catch are what
 * the trial exists to rule out: two uses of one panel sharing a selection, a change to X reaching some but not all of
 * the panels that use it, and a reader's unsaved form replaced by a definition change.
 */

const SCHEDULED_TASK = "platform:ScheduledTask";

/** Panel P: a task list, the task's form and a button that runs it. Its list and summary are the shared projection X. */
const panelP = definePanel({
  state: {
    selectedTask: { kind: "object", objectType: SCHEDULED_TASK, deepLink: true },
    search: { kind: "scalar", type: "string", deepLink: false },
  },
  slots: {
    tasks: { projectionId: "projection-x", inputs: {} },
    taskForm: { projectionId: "projection-task-form", inputs: { task: { state: "selectedTask" } } },
  },
  operations: [],
});

/** Panel Q: the same projection X and nothing of P. */
const panelQ = definePanel({
  state: { selectedTask: { kind: "object", objectType: SCHEDULED_TASK, deepLink: true } },
  slots: { summary: { projectionId: "projection-x", inputs: { task: { state: "selectedTask" } } } },
  operations: [],
});

function record(id: string, name: string, manifest: ProductPanel["manifest"]): ProductPanel {
  return {
    id,
    domainId: "domain-1",
    ownerId: "owner-1",
    revision: 1,
    createdAt: "2026-11-18T00:00:00.000Z",
    updatedAt: "2026-11-18T00:00:00.000Z",
    editable: true,
    name,
    description: "",
    visibility: "domain",
    content: { html: `<div id="panel"></div>`, module: `import {mountPanel} from "@ontomato/sdk/panel";` },
    manifest,
  };
}

function useRelation(id: string, pageKey: string, panelId: string, path: string): ApplicationPanelUse {
  return {
    id,
    pageKey,
    panelId,
    path,
    access: { kind: "domain-member" },
    skill: { namespace: { kind: "provider", provider: "workbench" }, name: "scheduled-tasks" },
  };
}

/**
 * A platform serving the records it holds, with the two reads a host makes and the notices it hears. Frames are the
 * windows a host registers, kept so a test can read what the host posted into them.
 */
function platform(input: { applicationId?: string; panels: Map<string, ProductPanel>; uses: ApplicationPanelUse[] }) {
  const listeners = new Set<(event: DefinitionChanged) => void>();
  const watched: DefinitionTarget[] = [];
  const frames = new Map<Window, unknown[]>();
  const sent = new WeakMap<Window, unknown[]>();
  return {
    applicationId: () => input.applicationId ?? "app-a",
    uses: async () => input.uses,
    panel: async (panelId: string) => input.panels.get(panelId)!,
    sdkBase: async () => "/apps-sdk/1.1.0",
    frame: (frame: Window) => {
      frames.set(frame, []);
      const post = frame.postMessage.bind(frame);
      const posted = sent.get(frame) ?? [];
      sent.set(frame, posted);
      frame.postMessage = ((message: unknown, ...rest: unknown[]) => {
        posted.push(message);
        return post(message as never, ...(rest as [never]));
      }) as Window["postMessage"];
      return () => frames.delete(frame);
    },
    subscribe: (targets: readonly DefinitionTarget[], listener: (event: DefinitionChanged) => void) => {
      watched.push(...targets);
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    watched,
    changed: (event: DefinitionChanged) => listeners.forEach((listener) => listener(event)),
    posted: (frame: Window) => sent.get(frame) ?? [],
  };
}

/**
 * A frame: an iframe's own window, as a shell sees it. What the host posts into it and what the frame posts back go
 * through that window, so a test reads the one and dispatches the other.
 */
function frameWindow(): Window {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  return frame.contentWindow!;
}

/** What the host posted into a frame. */
function postedTo(port: { posted(frame: Window): unknown[] }, frame: Window): unknown[] {
  return port.posted(frame);
}

/** What a frame tells its host. */
function fromFrame(frame: Window, message: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent("message", { source: frame, data: { channel: PANEL_HOST_CHANNEL, ...message } }));
}

describe("the panel host", () => {
  it("opens one instance per application use, each from its own relation and record", async () => {
    const panels = new Map([
      ["panel-p", record("panel-p", "Scheduled tasks", panelP)],
      ["panel-q", record("panel-q", "Task summary", panelQ)],
    ]);
    const port = platform({
      panels,
      uses: [
        useRelation("use-a", "schedules", "panel-p", "/a/schedules"),
        useRelation("use-b", "schedules", "panel-p", "/b/schedules"),
        useRelation("use-q", "task-summary", "panel-q", "/summary"),
      ],
    });
    const scope = effectScope();
    const open = (useId: string) =>
      scope.run(() => usePanelInstance(port, { useId: () => useId, label: (panel) => panel.name, address: () => `/applications/app-a/${useId}`, initial: () => ({}) }))!;
    const a = open("use-a");
    const b = open("use-b");
    const q = open("use-q");
    await Promise.all([a.ready, b.ready, q.ready]);

    // Three instances, each from its own use relation: two of panel P and one of Q.
    expect(a.use.value?.panelId).toBe("panel-p");
    expect(b.use.value?.panelId).toBe("panel-p");
    expect(q.use.value?.panelId).toBe("panel-q");
    // Each has its own address — the page's, kept as it is — and each draws its own panel's document.
    expect(a.address.value).toBe("/applications/app-a/use-a");
    expect(b.address.value).toBe("/applications/app-a/use-b");
    expect(q.address.value).toBe("/applications/app-a/use-q");
    expect(a.state.value).toEqual({});
    expect(b.state.value).toEqual({});
    scope.stop();
  });

  it("hands a changed projection to every instance whose panel names it, and only to those", async () => {
    const panels = new Map([
      ["panel-p", record("panel-p", "Scheduled tasks", panelP)],
      ["panel-q", record("panel-q", "Task summary", panelQ)],
      ["panel-r", record("panel-r", "Application only", definePanel({ state: {}, slots: { form: { projectionId: "projection-other", inputs: {} } }, operations: [] }))],
    ]);
    const port = platform({
      panels,
      uses: [
        useRelation("use-a", "schedules", "panel-p", "/a/schedules"),
        useRelation("use-b", "schedules", "panel-p", "/b/schedules"),
        useRelation("use-q", "task-summary", "panel-q", "/summary"),
        useRelation("use-r", "application", "panel-r", "/r"),
      ],
    });
    const scope = effectScope();
    const open = (useId: string) =>
      scope.run(() => usePanelInstance(port, { useId: () => useId, label: (panel) => panel.name, address: () => `/applications/app-a/${useId}`, initial: () => ({}) }))!;
    const a = open("use-a");
    const b = open("use-b");
    const q = open("use-q");
    const r = open("use-r");
    await Promise.all([a.ready, b.ready, q.ready, r.ready]);
    const frames = [frameWindow(), frameWindow(), frameWindow(), frameWindow()];
    [a, b, q, r].forEach((view, index) => view.frame(frames[index]!));

    // X changes: both uses of P and Q are told, each in its own frame; the panel that does not use X is not.
    port.changed({ kind: "definition-changed", domainId: "domain-1", target: { kind: "projection", id: "projection-x" } });
    for (const frame of frames.slice(0, 3))
      expect(postedTo(port, frame)).toContainEqual({ channel: PANEL_HOST_CHANNEL, kind: "projection-changed", projectionId: "projection-x" });
    expect(postedTo(port, frames[3]!)).toEqual([]);
    scope.stop();
  });

  it("re-reads a changed panel by its ID, and never over a form the reader has unsaved", async () => {
    const panels = new Map([
      ["panel-p", record("panel-p", "Scheduled tasks", panelP)],
      ["panel-q", record("panel-q", "Task summary", panelQ)],
    ]);
    const port = platform({
      panels,
      uses: [
        useRelation("use-a", "schedules", "panel-p", "/a/schedules"),
        useRelation("use-q", "task-summary", "panel-q", "/summary"),
      ],
    });
    const scope = effectScope();
    const a = scope.run(() => usePanelInstance(port, { useId: () => "use-a", label: (panel) => panel.name, address: () => "/applications/app-a/a/schedules", initial: () => ({}) }))!;
    const q = scope.run(() => usePanelInstance(port, { useId: () => "use-q", label: (panel) => panel.name, address: () => "/applications/app-a/summary", initial: () => ({}) }))!;
    await Promise.all([a.ready, q.ready]);
    const frameA = frameWindow();
    a.frame(frameA);

    // The reader is editing: the frame says so, and the record that arrives meanwhile waits.
    fromFrame(frameA, { kind: "dirty", dirty: true });
    const beforeA = a.document.value;
    panels.set("panel-p", record("panel-p", "Scheduled tasks, rearranged", panelP));
    port.changed({ kind: "definition-changed", domainId: "domain-1", target: { kind: "panel", id: "panel-p" } });
    // The form on screen is not replaced while it has unsaved changes: neither the record it draws nor its document.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(a.panel.value?.name).toBe("Scheduled tasks");
    expect(a.document.value).toBe(beforeA);

    // The reader saves: now the changed panel is shown.
    fromFrame(frameA, { kind: "dirty", dirty: false });
    await vi.waitFor(() => expect(a.document.value).not.toBe(beforeA));
    expect(q.panel.value?.name).toBe("Task summary");
    scope.stop();
  });

  it("keeps a page's other parameters, and replaces only its own state", () => {
    expect(panelAddress("/a/schedules?tab=runs&state=%7B%7D", { selectedTask: null })).toBe(
      `/a/schedules?tab=runs&state=${encodeURIComponent(JSON.stringify({ selectedTask: null }))}`,
    );
    // No state is no parameter: an address is the same page whether or not the reader has selected something in it.
    expect(panelAddress("/a/schedules?tab=runs&state=%7B%7D", {})).toBe("/a/schedules?tab=runs");
    expect(panelAddress("/a/schedules", {})).toBe("/a/schedules");
  });

  it("starts from the state the address named, and follows its own reports from then on", async () => {
    let initial = { selectedTask: { className: SCHEDULED_TASK, primaryKey: "task-1" } };
    const panels = new Map([["panel-p", record("panel-p", "Scheduled tasks", panelP)]]);
    const port = platform({ panels, uses: [useRelation("use-a", "schedules", "panel-p", "/a/schedules")] });
    const scope = effectScope();
    const a = scope.run(() =>
      usePanelInstance(port, {
        useId: () => "use-a",
        label: (panel) => panel.name,
        address: () => "/applications/app-a/a/schedules",
        initial: () => initial,
      }),
    )!;
    await a.ready;
    const frame = frameWindow();
    a.frame(frame);
    // The page opened at the address's state, and the address says so.
    expect(a.state.value).toEqual(initial);
    expect(panelAddressState(a.address.value)).toEqual(initial);

    // The reader selects something: the instance reports it, the address follows it, and the opening state is not read
    // again — which would overwrite the selection with what the address said before.
    initial = { selectedTask: { className: SCHEDULED_TASK, primaryKey: "task-0" } };
    fromFrame(frame, { kind: "state", state: { selectedTask: { className: SCHEDULED_TASK, primaryKey: "task-2" } } });
    expect(panelAddressState(a.address.value)).toEqual({ selectedTask: { className: SCHEDULED_TASK, primaryKey: "task-2" } });
    expect(a.state.value).toEqual({ selectedTask: { className: SCHEDULED_TASK, primaryKey: "task-2" } });
    scope.stop();
  });

  it("names the page in a message by the panel's own name", async () => {
    const panel = record("panel-p", "Scheduled tasks", panelP);
    const panels = new Map([["panel-p", panel]]);
    const port = platform({ panels, uses: [useRelation("use-a", "schedules", "panel-p", "/a/schedules")] });
    const scope = effectScope();
    const a = scope.run(() =>
      usePanelInstance(port, {
        useId: () => "use-a",
        label: (shown) => `Trial A · ${shown.name}`,
        address: () => "/applications/app-a/a/schedules",
        initial: () => ({}),
      }),
    )!;
    await a.ready;
    const frame = frameWindow();
    a.frame(frame);
    // The page's label is built from the record's own name — never the page key, which is only the panel's key.
    expect(a.document.value).toContain('"label":"Trial A · Scheduled tasks"');
    scope.stop();
  });

  it("says what it could not read, instead of showing an empty page", async () => {
    const panels = new Map([["panel-p", record("panel-p", "Scheduled tasks", panelP)]]);
    const port = { ...platform({ panels, uses: [useRelation("use-a", "schedules", "panel-p", "/a/schedules")] }) };
    // The SDK's current version is refused — the request the platform's own host once sent to the wrong address.
    port.sdkBase = async () => {
      throw new Error("GET /api/data-query/app-builder/apps-sdk/current failed: 403 Product use Grant required");
    };
    const scope = effectScope();
    const a = scope.run(() =>
      usePanelInstance(port, { useId: () => "use-a", label: (panel) => panel.name, address: () => "/applications/app-a/a/schedules", initial: () => ({}) }),
    )!;
    await a.ready;
    // The failure is the page's word: no frame is drawn, and the reason is there to read.
    expect(a.document.value).toBe("");
    expect(a.error.value).toContain("403");
    scope.stop();
  });

  it("says what it could not read when the use relation is refused", async () => {
    const scope = effectScope();
    const port = platform({ panels: new Map(), uses: [] });
    port.uses = async () => {
      throw new Error("GET /api/data-query/platform/applications/app-a/panel-uses failed: 403");
    };
    const a = scope.run(() =>
      usePanelInstance(port, { useId: () => "use-a", label: (panel) => panel.name, address: () => "/applications/app-a/a/schedules", initial: () => ({}) }),
    )!;
    await a.ready;
    expect(a.error.value).toContain("panel-uses failed: 403");
    scope.stop();
  });

  it("shows the state its address names", () => {
    const state = { selectedTask: { className: SCHEDULED_TASK, primaryKey: "task-1" }, search: "overdue" };
    const restored = panelAddressState(panelAddress("/a/schedules", state));
    expect(restored).toEqual(state);
    expect(panelAddressState(panelAddress("/a/schedules", { selectedTask: null }))).toEqual({ selectedTask: null });
  });

  it("runs the panel's own text with this SDK version's modules", () => {
    const panel = record("panel-p", "Scheduled tasks", panelP);
    const document = panelFrameDocument(panel, "/apps-sdk/1.1.0", {
      kind: "panel-host-message",
      panel,
      pageKey: "schedules",
      url: "/a/schedules",
      label: "Scheduled tasks",
      state: {},
    });
    expect(document).toContain('"@ontomato/sdk/panel":"/apps-sdk/1.1.0/panel.js"');
    expect(document).toContain("/apps-sdk/1.1.0/styles/sdk.css");
    expect(document).toContain("data-panel-host-message");
    // The panel's module is content, never a template of the host's own document.
    expect(document).toContain('import {mountPanel} from "@ontomato/sdk/panel";');
  });

  it("pairs an operation's answer with the call that asked for it", async () => {
    const panels = new Map([["panel-p", record("panel-p", "Scheduled tasks", panelP)]]);
    const port = platform({ panels, uses: [useRelation("use-a", "schedules", "panel-p", "/a/schedules")] });
    const scope = effectScope();
    const a = scope.run(() => usePanelInstance(port, { useId: () => "use-a", label: (panel) => panel.name, address: () => "/applications/app-a/a/schedules", initial: () => ({}) }))!;
    await a.ready;
    const frameA = frameWindow();
    a.frame(frameA);

    const first = a.invoke("runTask.runNow");
    const second = a.invoke("task.clear");
    // Two calls are two requests, each answered by its own request ID, in whatever order the frame answers them.
    const invoked = postedTo(port, frameA).filter((message) => (message as { kind: string }).kind === "invoke") as { requestId: string }[];
    expect(invoked).toHaveLength(2);
    expect(invoked[0]!.requestId).not.toBe(invoked[1]!.requestId);
    fromFrame(frameA, { kind: "invoked", requestId: invoked[1]!.requestId, result: "second" });
    fromFrame(frameA, { kind: "invoked", requestId: invoked[0]!.requestId, result: "first" });
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    scope.stop();
  });
});
