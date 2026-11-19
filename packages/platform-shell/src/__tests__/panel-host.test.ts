import type { ProductDefinitionRevision } from "@ontomato/contracts/product-subscriptions";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { effectScope, nextTick, shallowRef } from "vue";
import type { ApplicationPanelUse, ProductPanel } from "@ontomato/contracts/product-panels";
import { panelAddress, panelAddressState, PANEL_HOST_CHANNEL } from "@ontomato/contracts/panel-host";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import {
  panelFrameDocument,
  usePanelInstance,
  type PanelHostLabels,
  type PanelHostPort,
} from "../panel-host";

/*
 * The host loads one panel per application use, keeps each instance's state to itself, and hands a changed definition to
 * the instances that use it: a changed projection reaches every instance whose panel names it, a changed panel reaches
 * its own instances and nothing else, and never over a form the reader has unsaved. The mistakes these catch are what
 * the trial exists to rule out: two uses of one panel sharing a selection, a change to X reaching some but not all of
 * the panels that use it, and a reader's unsaved form replaced by a definition change.
 */

const SCHEDULED_TASK = "platform:ScheduledTask";

/** The host's words, as the platform supplies them in the reader's language. */
const labels: PanelHostLabels = {
  notStarted: "Not started",
  failures: { fileUnavailable: "Could not load {file}", scriptThrew: "Script failed", scriptRejected: "Script rejected" },
};

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
    sdkVersion: "1.1.0",
  };
}

/** The renderable definition a record's frame receives. */
const definition = ({ content, manifest, sdkVersion }: ProductPanel) => ({ content, manifest, sdkVersion });

function useRelation(id: string, pageKey: string, panelId: string, path: string): ApplicationPanelUse {
  return {
    id,
    pageKey,
    panelId,
    path,
    access: { kind: "domain-member" },
  };
}

/**
 * A platform serving the records it holds, with the reads a host makes and the notices it hears. `port(useId)` is the
 * host for one use relation of the application. Frames are the windows a host registers, kept so a test can read what
 * the host posted into them.
 */
function platform(input: { applicationId?: string; panels: Map<string, ProductPanel>; uses: ApplicationPanelUse[] }) {
  const listeners = new Set<(revisions: readonly ProductDefinitionRevision[]) => void>();
  const frames = new Map<Window, unknown[]>();
  const sent = new WeakMap<Window, unknown[]>();
  const stand = {
    port(useId: string): PanelHostPort {
      const use = input.uses.find(candidate => candidate.id === useId)!;
      return {
        source: async () => ({ kind: "registered", applicationId: input.applicationId ?? "app-a", use, panel: await stand.panel(use.panelId) }),
        pageKey: use.pageKey,
        use: { applicationId: input.applicationId ?? "app-a", useId: use.id },
        panel: stand.panel,
        sdkRoot: () => stand.sdkRoot(),
        frame: stand.frame,
        snapshot: stand.snapshot,
        mode: stand.mode,
      };
    },
    panel: async (panelId: string) => input.panels.get(panelId)!,
    sdkRoot: async () => "/apps-sdk",
    frame: (frame: Window) => {
      frames.set(frame, []);
      const post = frame.postMessage.bind(frame);
      const posted = sent.get(frame) ?? [];
      sent.set(frame, posted);
      frame.postMessage = ((message: unknown, ...rest: unknown[]) => {
        posted.push(message);
        return post(message as never, ...(rest as [never]));
      }) as Window["postMessage"];
      return { dispose: () => frames.delete(frame), open: () => {} };
    },
    snapshot: async (id: string) => ({ panel: { id, revision: input.panels.get(id)!.revision }, projections: [] }),
    mode: {
      kind: "author" as const,
      definitions: {
        observe(_targets, listener) {
          listeners.add(listener);
          return { replace() {}, close: () => listeners.delete(listener) };
        },
      },
    } satisfies PanelHostPort["mode"],
    changed: (revision: ProductDefinitionRevision) => listeners.forEach(listener => listener([revision])),
    posted: (frame: Window) => sent.get(frame) ?? [],
  };
  return stand;
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

const HERE = dirname(fileURLToPath(import.meta.url));

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
      scope.run(() => usePanelInstance(port.port(useId), { labels, label: (source) => source.kind === "registered" ? source.panel.name : "", address: () => `/applications/app-a/${useId}`, initial: () => ({}) }))!;
    const a = open("use-a");
    const b = open("use-b");
    const q = open("use-q");
    await Promise.all([a.ready, b.ready, q.ready]);

    // Three instances, each from its own use relation: two of panel P and one of Q.
    const panelOf = (view: typeof a) => view.source.value?.kind === "registered" ? view.source.value.use.panelId : null;
    expect(panelOf(a)).toBe("panel-p");
    expect(panelOf(b)).toBe("panel-p");
    expect(panelOf(q)).toBe("panel-q");
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
      scope.run(() => usePanelInstance(port.port(useId), { labels, label: (source) => source.kind === "registered" ? source.panel.name : "", address: () => `/applications/app-a/${useId}`, initial: () => ({}) }))!;
    const a = open("use-a");
    const b = open("use-b");
    const q = open("use-q");
    const r = open("use-r");
    await Promise.all([a.ready, b.ready, q.ready, r.ready]);
    const frames = [frameWindow(), frameWindow(), frameWindow(), frameWindow()];
    [a, b, q, r].forEach((view, index) => {
      const frame = frames[index]!;
      view.frame(frame);
      fromFrame(frame, { kind: "state", fromAddress: view.address.value, state: {} });
    });

    // X changes: both uses of P and Q are told, each in its own frame; the panel that does not use X is not.
    port.changed({ kind: "projection", id: "projection-x", revision: 2 });
    for (const frame of frames.slice(0, 3))
      await vi.waitFor(() => expect(postedTo(port, frame)).toContainEqual({ channel: PANEL_HOST_CHANNEL, kind: "projections-changed", projections: [{ id: "projection-x", revision: 2 }] }));
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
    const a = scope.run(() => usePanelInstance(port.port("use-a"), { labels, label: (source) => source.kind === "registered" ? source.panel.name : "", address: () => "/applications/app-a/a/schedules", initial: () => ({}) }))!;
    const q = scope.run(() => usePanelInstance(port.port("use-q"), { labels, label: (source) => source.kind === "registered" ? source.panel.name : "", address: () => "/applications/app-a/summary", initial: () => ({}) }))!;
    await Promise.all([a.ready, q.ready]);
    const frameA = frameWindow();
    a.frame(frameA);
    fromFrame(frameA, { kind: "state", fromAddress: a.address.value, state: {} });

    // The reader is editing: the frame says so, and the record that arrives meanwhile waits.
    fromFrame(frameA, { kind: "dirty", dirty: true });
    const beforeA = a.document.value;
    panels.set("panel-p", { ...record("panel-p", "Scheduled tasks, rearranged", panelP), revision: 2 });
    port.changed({ kind: "panel", id: "panel-p", revision: 2 });
    // The form on screen is not replaced while it has unsaved changes: neither the record it draws nor its document.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(a.source.value?.kind === "registered" && a.source.value.panel.name).toBe("Scheduled tasks");
    expect(a.document.value).toBe(beforeA);

    // The reader saves: now the changed panel is shown.
    fromFrame(frameA, { kind: "dirty", dirty: false });
    await vi.waitFor(() => expect(a.document.value).not.toBe(beforeA));
    expect(q.source.value?.kind === "registered" && q.source.value.panel.name).toBe("Task summary");
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

  it("applies external state and accepts reader selections without echoing them to the frame", async () => {
    const selected = (primaryKey: string) => ({ selectedTask: { className: SCHEDULED_TASK, primaryKey } });
    const initial = shallowRef(selected("task-1"));
    const panels = new Map([["panel-p", record("panel-p", "Scheduled tasks", panelP)]]);
    const port = platform({ panels, uses: [useRelation("use-a", "schedules", "panel-p", "/a/schedules")] });
    const scope = effectScope();
    const a = scope.run(() =>
      usePanelInstance(port.port("use-a"), { labels,
        label: (source) => source.kind === "registered" ? source.panel.name : "",
        address: () => "/applications/app-a/a/schedules",
        initial: () => initial.value,
      }),
    )!;
    await a.ready;
    const frame = frameWindow();
    a.frame(frame);
    const bootAddress = a.address.value;
    fromFrame(frame, { kind: "state", fromAddress: bootAddress, state: selected("task-1") });
    expect(a.state.value).toEqual(initial.value);

    fromFrame(frame, { kind: "state", fromAddress: bootAddress, state: selected("task-2") });
    initial.value = selected("task-2");
    await nextTick();
    expect(panelAddressState(a.address.value)).toEqual(initial.value);
    expect(postedTo(port, frame)).toEqual([]);

    initial.value = selected("task-0");
    await nextTick();
    const requested = panelAddress("/applications/app-a/a/schedules", initial.value);
    expect(postedTo(port, frame)).toEqual([{ channel: PANEL_HOST_CHANNEL, kind: "address", address: requested }]);
    fromFrame(frame, { kind: "state", fromAddress: bootAddress, state: selected("task-2") });
    expect(a.address.value).toBe(requested);
    fromFrame(frame, { kind: "state", fromAddress: requested, state: initial.value });
    expect(a.state.value).toEqual(initial.value);
    scope.stop();
  });

  it("names the page in a message by the panel's own name", async () => {
    const panel = record("panel-p", "Scheduled tasks", panelP);
    const panels = new Map([["panel-p", panel]]);
    const port = platform({ panels, uses: [useRelation("use-a", "schedules", "panel-p", "/a/schedules")] });
    const scope = effectScope();
    const a = scope.run(() =>
      usePanelInstance(port.port("use-a"), { labels,
        label: (shown) => shown.kind === "registered" ? `Trial A · ${shown.panel.name}` : "",
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
    const port = platform({ panels, uses: [useRelation("use-a", "schedules", "panel-p", "/a/schedules")] });
    // The SDK's current version is refused — the request the platform's own host once sent to the wrong address.
    port.sdkRoot = async () => {
      throw new Error("GET /api/data-query/app-builder/apps-sdk/current failed: 403 Product use Grant required");
    };
    const scope = effectScope();
    const a = scope.run(() =>
      usePanelInstance(port.port("use-a"), { labels, label: (source) => source.kind === "registered" ? source.panel.name : "", address: () => "/applications/app-a/a/schedules", initial: () => ({}) }),
    )!;
    await a.ready;
    // The failure is the page's word: no frame is drawn, and the reason is there to read.
    expect(a.document.value).toBe("");
    expect(a.error.value).toContain("403");
    scope.stop();
  });

  it("says what it could not read when the panel's record is refused", async () => {
    const scope = effectScope();
    const port = platform({ panels: new Map(), uses: [useRelation("use-a", "schedules", "panel-p", "/a/schedules")] });
    port.panel = async () => {
      throw new Error("GET /api/product-panels/panel-p failed: 403");
    };
    const a = scope.run(() =>
      usePanelInstance(port.port("use-a"), { labels, label: (source) => source.kind === "registered" ? source.panel.name : "", address: () => "/applications/app-a/a/schedules", initial: () => ({}) }),
    )!;
    await a.ready;
    expect(a.error.value).toContain("panel-p failed: 403");
    scope.stop();
  });

  it("shows the state its address names", () => {
    const state = { selectedTask: { className: SCHEDULED_TASK, primaryKey: "task-1" }, search: "overdue" };
    const restored = panelAddressState(panelAddress("/a/schedules", state));
    expect(restored).toEqual(state);
    expect(panelAddressState(panelAddress("/a/schedules", { selectedTask: null }))).toEqual({ selectedTask: null });
  });

  it("runs the trial's own panel content in a document of its own making", () => {
    // The examples as they are registered: three texts, and the record is what carries the manifest.
    const trial = join(HERE, "..", "..", "..", "apps-sdk", "examples", "panels", "schedules-trial");
    for (const directory of ["p", "q"]) {
      const html = readFileSync(join(trial, directory, "panel.html"), "utf8");
      const module = readFileSync(join(trial, directory, "panel.mjs"), "utf8");
      const document = panelFrameDocument(
        { ...record(`panel-${directory}`, `Trial ${directory}`, panelP), content: { html, module } },
        "/apps-sdk/1.1.0",
        { kind: "panel-host-message", panel: definition(record(`panel-${directory}`, `Trial ${directory}`, panelP)), pageKey: `trial-${directory}`, use: null, url: "/applications/app-panels-trial-a/tasks", label: "Scheduled tasks", state: {} },
        labels.failures,
      );
      // The panel's HTML is a fragment the host's document holds: no document of its own, and nothing left for the host
      // to substitute — a `{{head}}` would be drawn literally, since the host inserts this as content.
      expect(document).not.toContain("{{");
      expect(html).not.toMatch(/<!doctype|<html|<head|<body/i);
      expect(html).toContain("<style>");
      // The module imports only names the frame's import map serves: a relative path would resolve against the platform's
      // own document, not beside a file, because the panel's module is text inside this document.
      const imported = [...module.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)].map((found) => found[1]!);
      expect(imported.length).toBeGreaterThan(0);
      for (const specifier of imported) expect(specifier.startsWith("@ontomato/sdk") || ["vue", "element-plus"].includes(specifier)).toBe(true);
      // And the module is in the document, escaped: it is content, not a template of the host's.
      expect(document).toContain("mountPanel");
    }
  });

  it("reports what the frame could not load or run, instead of drawing nothing", () => {
    const panel = record("panel-p", "Scheduled tasks", panelP);
    const document = panelFrameDocument(panel, "/apps-sdk/1.1.0", {
      kind: "panel-host-message",
      panel: definition(panel),
      pageKey: "schedules",
      use: null,
      url: "/a/schedules",
      label: "Scheduled tasks",
      state: {},
    }, labels.failures);
    // A listener runs before the module, and it reports a module that cannot be fetched and a rejection nothing handled.
    expect(document.indexOf("unhandledrejection")).toBeGreaterThan(-1);
    expect(document.indexOf("unhandledrejection")).toBeLessThan(document.indexOf("mountPanel"));
    expect(document).toContain("panel_file_unavailable");
    expect(document).toContain("panel_script_threw");
    expect(document).toContain("panel_script_rejected");
    // In the reader's language: the words are the platform's, and the frame puts the file it could not load in its place.
    expect(document).toContain(JSON.stringify(labels.failures));
    expect(document).toContain('words.fileUnavailable.replace("{file}"');
  });

  it("runs the panel's own text with this SDK version's modules", () => {
    const panel = record("panel-p", "Scheduled tasks", panelP);
    const document = panelFrameDocument(panel, "/apps-sdk/1.1.0", {
      kind: "panel-host-message",
      panel: definition(panel),
      pageKey: "schedules",
      use: null,
      url: "/a/schedules",
      label: "Scheduled tasks",
      state: {},
    }, labels.failures);
    expect(document).toContain('"@ontomato/sdk/panel":"/apps-sdk/1.1.0/panel.js"');
    expect(document).toContain("/apps-sdk/1.1.0/styles/sdk.css");
    expect(document).toContain("data-panel-host-message");
    // The panel's module is content, never a template of the host's own document.
    expect(document).toContain('import {mountPanel} from "@ontomato/sdk/panel";');
  });

  it("drops a settled draft's link from the address, and only the link the address still names", async () => {
    const panels = new Map([["panel-p", record("panel-p", "Scheduled tasks", panelP)]]);
    const port = platform({ panels, uses: [useRelation("use-a", "schedules", "panel-p", "/a/schedules")] });
    const session = "6f1c2d3e-4b5a-4c6d-8e7f-a0b1c2d3e4f5";
    const runs = ["0a1b2c3d-4e5f-4a6b-8c7d-e8f9a0b1c2d3", "1b2c3d4e-5f6a-4b7c-9d8e-f9a0b1c2d3e4"];
    const link = (runId: string) => ({ sessionId: session, runId, path: "outputs/drafts/task.page-draft.json" });
    const query = (runId: string) => new URLSearchParams({ tab: "runs", draftSessionId: session, draftRunId: runId, draftPath: link(runId).path });
    const page = shallowRef(`/applications/app-a/a/schedules?${query(runs[1]!)}`);
    const selected = { selectedTask: { className: SCHEDULED_TASK, primaryKey: "task-1" } };
    const scope = effectScope();
    const a = scope.run(() => usePanelInstance(port.port("use-a"), { labels,
      label: (source) => source.kind === "registered" ? source.panel.name : "",
      address: () => page.value,
      initial: () => selected,
    }))!;
    await a.ready;
    const frame = frameWindow();
    a.frame(frame);
    const opened = a.address.value;
    fromFrame(frame, { kind: "state", fromAddress: opened, state: selected });

    // A late word about the draft opened before this one leaves the address alone.
    fromFrame(frame, { kind: "draft-settled", draft: link(runs[0]!) });
    expect(a.address.value).toBe(opened);
    expect(postedTo(port, frame)).toEqual([]);

    // The draft the address links: its three parameters go, the page's own and its state stay, and the frame hears it.
    fromFrame(frame, { kind: "draft-settled", draft: link(runs[1]!) });
    const settled = panelAddress("/applications/app-a/a/schedules?tab=runs", selected);
    expect(a.address.value).toBe(settled);
    expect(postedTo(port, frame)).toEqual([{ channel: PANEL_HOST_CHANNEL, kind: "address", address: settled }]);
    fromFrame(frame, { kind: "state", fromAddress: settled, state: selected });
    expect(a.address.value).toBe(settled);
    scope.stop();
  });

  it("pairs an operation's answer with the call that asked for it", async () => {
    const panels = new Map([["panel-p", record("panel-p", "Scheduled tasks", panelP)]]);
    const port = platform({ panels, uses: [useRelation("use-a", "schedules", "panel-p", "/a/schedules")] });
    const scope = effectScope();
    const a = scope.run(() => usePanelInstance(port.port("use-a"), { labels, label: (source) => source.kind === "registered" ? source.panel.name : "", address: () => "/applications/app-a/a/schedules", initial: () => ({}) }))!;
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
