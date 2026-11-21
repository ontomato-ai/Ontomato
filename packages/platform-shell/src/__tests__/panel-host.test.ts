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
  type DirectPanelRun,
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
    content: { styleOutside: "Style outside" },
    refresh: "Refresh",
};

/** Panel P: a task list, the task's form and a button that runs it. Its list and summary are the shared projection X. */
const panelP = definePanel({
  state: {
    selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true },
    search: { type: { kind: "scalar", type: "string" } },
  },
  members: {
    tasks: { target: { projectionId: "projection-x" } },
    taskForm: { target: { projectionId: "projection-task-form" }, inputs: { task: { state: "selectedTask" } } },
  },
  commands: {},
});

/** Panel Q: the same projection X and nothing of P. */
const panelQ = definePanel({
  state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true } },
  members: { summary: { target: { projectionId: "projection-x" }, inputs: { task: { state: "selectedTask" } } } },
  commands: {},
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
    content: { html: `<div id="app"></div>`, module: `import {mountPanel} from "@ontomato/sdk/panel";` },
    manifest,
  };
}

/** The renderable definition a record's frame receives. */
const definition = ({ content, manifest }: ProductPanel) => ({ content, manifest });

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
  /** Each started instance of a panel with a module, by use: what the host gave it, and what it was told since. */
  const coded = new Map<string, {
    run: DirectPanelRun; projectionsChanged: { id: string; revision: number }[][]; addresses: string[]; invoked: string[];
  }>();
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
        release: () => stand.release(),
        frame: stand.frame,
        // The panel runs in the platform's document, started here.
        coded: async (_source, run) => {
          if (stand.codedFailure) throw stand.codedFailure;
          const started = { run, projectionsChanged: [] as { id: string; revision: number }[][], addresses: [] as string[], invoked: [] as string[] };
          coded.set(use.id, started);
          // The instance runs: it reports its state at the address it was given.
          run.state(run.initial, run.url());
          return {
            refresh() {}, activate() {}, dispose() {},
            address: url => { started.addresses.push(url); },
            invoke: id => { started.invoked.push(id); return Promise.resolve(`answer of ${id}`); },
            projectionsChanged: projections => { started.projectionsChanged.push([...projections]); },
          };
        },
        snapshot: stand.snapshot,
        mode: stand.mode,
      };
    },
    panel: async (panelId: string) => input.panels.get(panelId)!,
    release: async () => release,
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
    /** What the host gave the instance it started for a use, and what it told it since. */
    started: (useId: string) => coded.get(useId)!,
    /** Why the next panel with a module fails to start, when it should. */
    codedFailure: undefined as Error | undefined,
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

/** The deployment's current SDK release, as Node and its manifest name it. */
const release = {
  base: "/apps-sdk/current",
  manifest: {
    version: "1.1.0", product: "workbench", executionContext: 1, hostTransport: 1, messageBridge: 2,
    entries: { vue: "vue.js", "@ontomato/sdk/panel": "panel.js" }, stylesheet: "styles/sdk.css", components: "components.json",
    check: "node/panel-check.mjs",
    packageComponents: "node/package-components.mjs", libraries: { vue: "3.5.0" }, docs: "docs/index.md",
  },
};

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
      ["panel-r", record("panel-r", "Application only", definePanel({ state: {}, members: { form: { target: { projectionId: "projection-other" } } }, commands: {} }))],
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
    // X changes: both uses of P and Q are told, each its own instance; the panel that does not use X is not.
    port.changed({ kind: "projection", id: "projection-x", revision: 2 });
    for (const useId of ["use-a", "use-b", "use-q"])
      await vi.waitFor(() => expect(port.started(useId).projectionsChanged).toContainEqual([{ id: "projection-x", revision: 2 }]));
    expect(port.started("use-r").projectionsChanged).toEqual([]);
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
    // The reader is editing: the instance says so, and the record that arrives meanwhile waits.
    port.started("use-a").run.dirty(true);
    const shown = a.direct.value;
    panels.set("panel-p", { ...record("panel-p", "Scheduled tasks, rearranged", panelP), revision: 2 });
    port.changed({ kind: "panel", id: "panel-p", revision: 2 });
    // The form on screen is not replaced while it has unsaved changes: neither the record it draws nor its instance.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(a.source.value?.kind === "registered" && a.source.value.panel.name).toBe("Scheduled tasks");
    expect(a.direct.value).toBe(shown);

    // The reader saves: now the changed panel is shown.
    port.started("use-a").run.dirty(false);
    await vi.waitFor(() => expect(a.source.value?.kind === "registered" && a.source.value.panel.name).toBe("Scheduled tasks, rearranged"));
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

  it("applies external state and accepts reader selections without echoing them to the instance", async () => {
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
    const instance = port.started("use-a");
    const bootAddress = a.address.value;
    expect(a.state.value).toEqual(initial.value);

    // The reader chooses another task: the address follows, and the instance is not told what it said itself.
    instance.run.state(selected("task-2"), bootAddress);
    initial.value = selected("task-2");
    await nextTick();
    expect(panelAddressState(a.address.value)).toEqual(initial.value);
    expect(instance.addresses).toEqual([]);

    // The address changes outside it: the instance is told, and a late report for the old address changes nothing.
    initial.value = selected("task-0");
    await nextTick();
    const requested = panelAddress("/applications/app-a/a/schedules", initial.value);
    expect(instance.addresses).toEqual([requested]);
    instance.run.state(selected("task-2"), bootAddress);
    expect(a.address.value).toBe(requested);
    instance.run.state(initial.value, requested);
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
    // The page's label is built from the record's own name — never the page key, which is only the panel's key.
    expect(port.started("use-a").run.label()).toBe("Trial A · Scheduled tasks");
    scope.stop();
  });

  it("says what it could not start, instead of showing an empty page", async () => {
    const panels = new Map([["panel-p", record("panel-p", "Scheduled tasks", panelP)]]);
    const port = platform({ panels, uses: [useRelation("use-a", "schedules", "panel-p", "/a/schedules")] });
    // The panel's module is refused what it asked for as it started.
    port.codedFailure = new Error("GET /api/product-projections/projection-x failed: 403 Product use Grant required");
    const scope = effectScope();
    const a = scope.run(() =>
      usePanelInstance(port.port("use-a"), { labels, label: (source) => source.kind === "registered" ? source.panel.name : "", address: () => "/applications/app-a/a/schedules", initial: () => ({}) }),
    )!;
    await a.ready;
    // The failure is the page's word: nothing is drawn, and the reason is there to read.
    expect(a.direct.value).toBeNull();
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
    // The example written with code as it is registered: its texts, and the record is what carries the manifest. P has no
    // code; the platform draws it and writes no document for it.
    const trial = join(HERE, "..", "..", "..", "apps-sdk", "examples", "panels", "schedules-trial");
    for (const directory of ["q"]) {
      const html = readFileSync(join(trial, directory, "panel.html"), "utf8");
      const module = readFileSync(join(trial, directory, "panel.mjs"), "utf8");
      const document = panelFrameDocument(
        { ...record(`panel-${directory}`, `Trial ${directory}`, panelP), content: { html, module } },
        release,
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
    const document = panelFrameDocument(panel, release, {
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

  it("runs the panel's own text with the modules and stylesheet the current release names", () => {
    const panel = record("panel-p", "Scheduled tasks", panelP);
    const document = panelFrameDocument(panel, release, {
      kind: "panel-host-message",
      panel: definition(panel),
      pageKey: "schedules",
      use: null,
      url: "/a/schedules",
      label: "Scheduled tasks",
      state: {},
    }, labels.failures);
    // Exactly the release's own modules, under its base: no table of modules or version path of the host's own.
    expect(JSON.parse(/<script type="importmap">\n(.*)\n<\/script>/.exec(document)![1]!)).toEqual({
      imports: { vue: "/apps-sdk/current/vue.js", "@ontomato/sdk/panel": "/apps-sdk/current/panel.js" },
    });
    expect(document).toContain('<link rel="stylesheet" href="/apps-sdk/current/styles/sdk.css">');
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
    const instance = port.started("use-a");
    const opened = a.address.value;

    // A late word about the draft opened before this one leaves the address alone.
    instance.run.draftSettled(link(runs[0]!));
    expect(a.address.value).toBe(opened);
    expect(instance.addresses).toEqual([]);

    // The draft the address links: its three parameters go, the page's own and its state stay, and the instance hears it.
    instance.run.draftSettled(link(runs[1]!));
    const settled = panelAddress("/applications/app-a/a/schedules?tab=runs", selected);
    expect(a.address.value).toBe(settled);
    expect(instance.addresses).toEqual([settled]);
    instance.run.state(selected, settled);
    expect(a.address.value).toBe(settled);
    scope.stop();
  });

  it("hands an operation's call to its instance, and each call its own answer", async () => {
    const panels = new Map([["panel-p", record("panel-p", "Scheduled tasks", panelP)]]);
    const port = platform({ panels, uses: [useRelation("use-a", "schedules", "panel-p", "/a/schedules")] });
    const scope = effectScope();
    const a = scope.run(() => usePanelInstance(port.port("use-a"), { labels, label: (source) => source.kind === "registered" ? source.panel.name : "", address: () => "/applications/app-a/a/schedules", initial: () => ({}) }))!;
    await a.ready;
    const [first, second] = [a.invoke("runTask.runNow"), a.invoke("task.clear")];
    await expect(first).resolves.toBe("answer of runTask.runNow");
    await expect(second).resolves.toBe("answer of task.clear");
    expect(port.started("use-a").invoked).toEqual(["runTask.runNow", "task.clear"]);
    scope.stop();
  });
});
