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
    const open = (useId: string) => scope.run(() => usePanelInstance(port, { useId: () => useId, label: () => useId }))!;
    const a = open("use-a");
    const b = open("use-b");
    const q = open("use-q");
    await Promise.all([a.ready, b.ready, q.ready]);

    // Three instances, each from its own use relation: two of panel P and one of Q.
    expect(a.use.value?.panelId).toBe("panel-p");
    expect(b.use.value?.panelId).toBe("panel-p");
    expect(q.use.value?.panelId).toBe("panel-q");
    // Each has its own address, and each draws its own panel's document.
    expect(a.address.value).toBe("/a/schedules");
    expect(b.address.value).toBe("/b/schedules");
    expect(q.address.value).toBe("/summary");
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
    const open = (useId: string) => scope.run(() => usePanelInstance(port, { useId: () => useId, label: () => useId }))!;
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
    const a = scope.run(() => usePanelInstance(port, { useId: () => "use-a", label: () => "Scheduled tasks" }))!;
    const q = scope.run(() => usePanelInstance(port, { useId: () => "use-q", label: () => "Task summary" }))!;
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
    const a = scope.run(() => usePanelInstance(port, { useId: () => "use-a", label: () => "Scheduled tasks" }))!;
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
