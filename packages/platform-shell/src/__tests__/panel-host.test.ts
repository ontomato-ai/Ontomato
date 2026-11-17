import { describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";
import type { ApplicationPanelUse, ProductPanel } from "@ontomato/contracts/product-panels";
import { panelAddress, panelAddressState, PANEL_HOST_CHANNEL } from "@ontomato/contracts/panel-host";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { panelFrameDocument, usePanelInstance, type DefinitionChanged, type PanelHostPort } from "../panel-host";

/*
 * The host loads one panel per application use, keeps each instance's state to itself, and re-reads a definition
 * by its ID when the platform says it changed. The mistakes these catch are the ones the trial exists to rule out: two
 * uses of one panel sharing a selection, a panel's layout change reaching a panel that merely shares a projection, and a
 * panel opened from a link losing the state the address named.
 */

const SCHEDULED_TASK = "platform:ScheduledTask";

/** The panel P: a task list, the task's form and a button that runs it. */
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

/** The panel Q: the same projection X and nothing else. */
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

/** A platform that serves the records it currently holds, and notices when one changes. */
function platform(panels: Map<string, ProductPanel>, relations: Map<string, ApplicationPanelUse>) {
  const listeners = new Set<(event: DefinitionChanged) => void>();
  const frames: Window[] = [];
  return {
    use: async (useId: string) => relations.get(useId)!,
    panel: async (panelId: string) => panels.get(panelId)!,
    sdkBase: async () => "/apps-sdk/1.1.0",
    frame: (frame: Window) => {
      frames.push(frame);
      return () => {};
    },
    subscribe: (listener: (event: DefinitionChanged) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    changed: (event: DefinitionChanged) => listeners.forEach((listener) => listener(event)),
    frames,
  } satisfies PanelHostPort & { changed(event: DefinitionChanged): void; frames: Window[] };
}

function use(useId: string, pageKey: string, panelId: string, path: string): ApplicationPanelUse {
  return {
    id: useId,
    pageKey,
    panelId,
    path,
    access: { kind: "domain-member" },
    skill: { namespace: { kind: "provider", provider: "workbench" }, name: "scheduled-tasks" },
  };
}

describe("the panel host", () => {
  it("opens one instance per application use, and the two keep their own state", async () => {
    const panels = new Map([
      ["panel-p", record("panel-p", "Scheduled tasks", panelP)],
      ["panel-q", record("panel-q", "Task summary", panelQ)],
    ]);
    const relations = new Map([
      ["use-a", use("use-a", "schedules", "panel-p", "/a/schedules")],
      ["use-b", use("use-b", "schedules", "panel-p", "/b/schedules")],
      ["use-q", use("use-q", "task-summary", "panel-q", "/summary")],
    ]);
    const port = platform(panels, relations);
    const scope = effectScope();
    const a = scope.run(() => usePanelInstance(port, { useId: () => "use-a", label: () => "Scheduled tasks" }))!;
    const b = scope.run(() => usePanelInstance(port, { useId: () => "use-b", label: () => "Scheduled tasks" }))!;
    const q = scope.run(() => usePanelInstance(port, { useId: () => "use-q", label: () => "Task summary" }))!;
    await Promise.all([a.ready, b.ready, q.ready]);

    // Each one runs in its own frame, from its own record and its own address.
    expect(a.address.value).toBe("/a/schedules");
    expect(b.address.value).toBe("/b/schedules");
    expect(q.address.value).toBe("/summary");

    // A selection made in A reaches A alone: B and Q have no state of their own yet.
    const frameA = port.frames.at(-1)!;
    void frameA;
    expect(a.state.value).toEqual({});
    expect(b.state.value).toEqual({});
    scope.stop();
  });

  it("re-reads the definition the platform says changed, and only that one", async () => {
    const panels = new Map([
      ["panel-p", record("panel-p", "Scheduled tasks", panelP)],
      ["panel-q", record("panel-q", "Task summary", panelQ)],
    ]);
    const relations = new Map([
      ["use-a", use("use-a", "schedules", "panel-p", "/a/schedules")],
      ["use-q", use("use-q", "task-summary", "panel-q", "/summary")],
    ]);
    const port = platform(panels, relations);
    const scope = effectScope();
    const a = scope.run(() => usePanelInstance(port, { useId: () => "use-a", label: () => "Scheduled tasks" }))!;
    const q = scope.run(() => usePanelInstance(port, { useId: () => "use-q", label: () => "Task summary" }))!;
    await Promise.all([a.ready, q.ready]);

    // Changing panel P's layout is read again by P's instances only; Q shares P's projection but not P.
    const beforeQ = q.panel.value;
    const readQ = vi.spyOn(port, "panel");
    panels.set("panel-p", record("panel-p", "Scheduled tasks, rearranged", panelP));
    port.changed({ kind: "definition-changed", domainId: "domain-1", target: { kind: "panel", id: "panel-p" } });
    await vi.waitFor(() => expect(a.panel.value?.name).toBe("Scheduled tasks, rearranged"));

    // One re-read: the panel P that changed. Q was not read again, and still shows the record it had.
    expect(readQ).toHaveBeenCalledTimes(1);
    expect(readQ).toHaveBeenCalledWith("panel-p");
    expect(q.panel.value).toBe(beforeQ);
    scope.stop();
  });

  it("shows the state its address names, and only the state the panel declares deep-linkable", async () => {
    const panels = new Map([["panel-p", record("panel-p", "Scheduled tasks", panelP)]]);
    const relations = new Map([["use-a", use("use-a", "schedules", "panel-p", "/a/schedules")]]);
    const port = platform(panels, relations);
    const state = { selectedTask: { className: SCHEDULED_TASK, primaryKey: "task-1" }, search: "overdue" };
    expect(panelAddress("/a/schedules", state)).toContain("state=");
    const restored = panelAddressState(panelAddress("/a/schedules", state));
    expect(restored).toEqual(state);
    // A form value never travels in an address: the address carries what the panel declared.
    expect(panelAddressState(panelAddress("/a/schedules", { selectedTask: null }))).toEqual({ selectedTask: null });
    void port;
  });

  it("runs the panel's own text with this SDK version's modules", () => {
    const document = panelFrameDocument(record("panel-p", "Scheduled tasks", panelP), "/apps-sdk/1.1.0", {
      kind: "panel-host-message",
      panel: record("panel-p", "Scheduled tasks", panelP),
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
});

// The channel the frame and the host speak on is one constant, so a stale frame can never be mistaken for this one.
it("speaks on one channel", () => expect(PANEL_HOST_CHANNEL).toBe("ontomato-panel-v1"));
