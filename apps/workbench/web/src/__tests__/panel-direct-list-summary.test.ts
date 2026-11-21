import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { createDirectPanelInstance } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";
import type { PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";

/*
 * Direct-rendered ObjectList and ObjectSummary (design 4.2): the instance reads each member's named datum (`rows`,
 * `record`) through the host's read port, with no SDK resource adapter registered. Both components draw every datum
 * state through DataState, register owner labels for pageContext, and keep selection, refresh and stale-response
 * protection intact.
 */

const task = (primaryKey: string) => ({ className: SCHEDULED_TASK, primaryKey });
const meta = {
  domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "",
  editable: false, visibility: "domain" as const, description: "",
};

const baseProjections: Record<string, DirectProjection> = {
  "schedules-tasks": {
    ...meta, id: "schedules-tasks", name: "Scheduled tasks", componentId: "@ontomato/sdk:ObjectList",
    inputs: {}, outputs: { selected: { kind: "object", objectType: SCHEDULED_TASK } }, config: {},
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} } },
  },
  "schedules-summary": {
    ...meta, id: "schedules-summary", name: "Task summary", componentId: "@ontomato/sdk:ObjectSummary",
    inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } }, outputs: {},
    config: { fields: ["application", "settings", "state", "nextRun"] },
    data: { record: { source: { object: { input: "task" } }, read: "record", params: {} } },
  },
};

const baseManifest: DirectPanelManifest = {
  state: {
    selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: true, external: true },
  },
  members: {
    tasks: { target: { projectionId: "schedules-tasks" }, outputs: { selected: { state: "selectedTask" } } },
    summary: { target: { projectionId: "schedules-summary" }, inputs: { task: { state: "selectedTask" } } },
  },
  commands: {},
};

type Read = PanelMemberReadRequest;

const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

const taskRows = [
  {
    primaryKey: "t-1",
    label: "Nightly audit",
    fields: { application: "ops", settings: "daily 02:00", state: "on", nextRun: "2026-11-21T02:00:00Z", lastRun: "ok" },
  },
  {
    primaryKey: "t-2",
    label: "Weekly backup",
    fields: { application: "ops", settings: "sun 03:00", state: "off", nextRun: "", lastRun: "ok" },
  },
];

let cleanup: (() => void) | null = null;

function mountDirect(
  answer: (request: Read) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>,
  options: {
    manifest?: DirectPanelManifest;
    projections?: Record<string, DirectProjection>;
    initial?: Record<string, unknown>;
    messages?: Record<string, Record<string, string>>;
    members?: readonly string[];
  } = {},
) {
  const manifest = options.manifest ?? baseManifest;
  const projections = options.projections ?? baseProjections;
  const memberKeys = options.members ?? Object.keys(manifest.members);
  const reads: Read[] = [];
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "schedules-direct",
    url: () => "/schedules",
    label: () => "Schedules",
    initial: options.initial as never,
    recordDraftCreated: async () => {},
    text: createPanelText(options.messages ?? {}, ref("en"), "en"),
    ...noOperations,
    readProjection: async (id) => projections[id]!,
    read: async (request) => {
      reads.push(request);
      return answer(request);
    },
  });
  const element = document.createElement("div");
  document.body.appendChild(element);
  const app = createApp({
    setup: () => () => h("div", memberKeys.map((member) => h(PanelMember, { instance, member, key: member }))),
  }).use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus);
  app.mount(element);
  cleanup = () => {
    app.unmount();
    element.remove();
  };
  return { instance, element, reads };
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
});

it("lists tasks from the host read port without adapters, awaits selection in summary, and shows summary on click", async () => {
  const { instance, element, reads } = mountDirect((request) => {
    if (request.dataName === "rows") return ready(taskRows);
    const selected = request.inputs.task as { primaryKey: string };
    return ready(taskRows.find((row) => row.primaryKey === selected.primaryKey)!);
  });

  // List renders from `rows`; summary awaits selection without making any read.
  await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-list [role='option']")).toHaveLength(2));
  expect(reads).toEqual([{ memberPath: [{ member: "tasks" }], dataName: "rows", inputs: {} }]);
  expect(element.querySelector(".sdk-object-summary [data-state='awaiting']")?.textContent).toContain("Select an item first");
  expect(element.querySelector(".sdk-object-summary")?.textContent).not.toContain("Nothing to show");

  // Click the first task: state updates, pageContext gets owner label, and summary reads configured fields only.
  element.querySelectorAll<HTMLButtonElement>(".sdk-object-list [role='option']")[0]!.click();
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-summary-title")?.textContent).toBe("Nightly audit"));
  expect(instance.state.values.value.selectedTask).toEqual(task("t-1"));
  expect(instance.pageContext.value.selection[0]?.label).toContain("Nightly audit");
  expect([...element.querySelectorAll(".sdk-object-summary dt")].map((dt) => dt.textContent)).toEqual([
    "application", "settings", "state", "nextRun",
  ]);
  expect(element.querySelector(".sdk-object-summary")?.textContent).not.toContain("lastRun");

  // Re-clicking the selected task keeps it selected by default (toggleable defaults to false).
  const recordReadsBefore = reads.filter((r) => r.dataName === "record").length;
  element.querySelectorAll<HTMLButtonElement>(".sdk-object-list [role='option']")[0]!.click();
  await nextTick();
  expect(instance.state.values.value.selectedTask).toEqual(task("t-1"));
  expect(reads.filter((r) => r.dataName === "record").length).toBe(recordReadsBefore);

  // Clicking the second task switches selection and updates summary.
  element.querySelectorAll<HTMLButtonElement>(".sdk-object-list [role='option']")[1]!.click();
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-summary-title")?.textContent).toBe("Weekly backup"));
  expect(instance.state.values.value.selectedTask).toEqual(task("t-2"));
});

it("draws loading, empty, forbidden and error states through DataState for both ObjectList and ObjectSummary", async () => {
  let resolveRows!: (response: ProductPanelReadResponse) => void;
  let resolveRecord!: (response: ProductPanelReadResponse) => void;
  const { element } = mountDirect(
    (request) => new Promise((resolve) => {
      if (request.dataName === "rows") resolveRows = resolve;
      else resolveRecord = resolve;
    }),
    { initial: { selectedTask: task("t-1") } },
  );

  // Loading state while pending
  await vi.waitFor(() => {
    expect(element.querySelector(".sdk-object-list [aria-busy='true']")).not.toBeNull();
    expect(element.querySelector(".sdk-object-summary [aria-busy='true']")).not.toBeNull();
  });

  // Forbidden on list, error on summary
  resolveRows({ status: "forbidden" });
  resolveRecord({ status: "error", message: "Schedule backend timed out" });
  await vi.waitFor(() => {
    expect(element.querySelector(".sdk-object-list [data-state='forbidden']")?.textContent).toContain("You do not have access to this");
    expect(element.querySelector(".sdk-object-summary [role='alert']")?.textContent).toBe("Schedule backend timed out");
  });
});

it("shows DataState empty when list returns empty status or an empty array, respecting custom emptyText", async () => {
  const customProjections: Record<string, DirectProjection> = {
    ...baseProjections,
    "schedules-tasks": {
      ...baseProjections["schedules-tasks"]!,
      config: { emptyText: "tasks.none" },
    },
  };
  const { element } = mountDirect(
    (request) => (request.dataName === "rows" ? ready([]) : { status: "empty" }),
    {
      projections: customProjections,
      initial: { selectedTask: task("t-1") },
      messages: { en: { "tasks.none": "No scheduled tasks yet" } },
    },
  );

  await vi.waitFor(() => {
    expect(element.querySelector(".sdk-object-list [data-state='empty']")?.textContent).toBe("No scheduled tasks yet");
    expect(element.querySelector(".sdk-object-summary [data-state='empty']")?.textContent).toContain("Nothing to show");
  });
});

it("drops a late answer for an earlier selection in ObjectSummary and re-reads both on refresh", async () => {
  const pending = new Map<string, (response: ProductPanelReadResponse) => void>();
  let version = 1;
  const { instance, element, reads } = mountDirect(
    (request) => {
      if (request.dataName === "rows") {
        return ready([{ ...taskRows[0]!, label: `Nightly audit v${version}` }, taskRows[1]!]);
      }
      const key = (request.inputs.task as { primaryKey: string }).primaryKey;
      if (version === 1) {
        return new Promise((resolve) => pending.set(key, resolve));
      }
      return ready({ ...taskRows[0]!, label: `Nightly audit v${version}` });
    },
    { initial: { selectedTask: task("t-1") } },
  );

  await vi.waitFor(() => expect(pending.has("t-1")).toBe(true));
  instance.state.set("selectedTask", task("t-2"));
  await vi.waitFor(() => expect(pending.has("t-2")).toBe(true));

  // New selection arrives first, then stale t-1 arrives late and must be ignored.
  pending.get("t-2")!(ready(taskRows[1]!));
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-summary-title")?.textContent).toBe("Weekly backup"));
  pending.get("t-1")!(ready(taskRows[0]!));
  await nextTick();
  await nextTick();
  expect(element.querySelector(".sdk-object-summary-title")?.textContent).toBe("Weekly backup");

  // Switch back to t-1 and trigger affected refresh: both list and summary re-read.
  version = 2;
  instance.state.set("selectedTask", task("t-1"));
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-summary-title")?.textContent).toBe("Nightly audit v2"));
  const readsBefore = reads.length;
  version = 3;
  instance.refresh({ objects: [{ objectType: SCHEDULED_TASK, primaryKey: "t-1" }], objectTypes: [SCHEDULED_TASK] });
  await vi.waitFor(() => {
    expect(element.querySelector(".sdk-object-list [role='option']")?.textContent).toContain("Nightly audit v3");
    expect(element.querySelector(".sdk-object-summary-title")?.textContent).toBe("Nightly audit v3");
  });
  expect(reads.length).toBe(readsBefore + 2);
});

it("renders a direct ObjectSummary bound to a literal object source without any state input", async () => {
  const literalProjections: Record<string, DirectProjection> = {
    "literal-summary": {
      ...meta, id: "literal-summary", name: "Pinned task", componentId: "@ontomato/sdk:ObjectSummary",
      inputs: {}, outputs: {}, config: { fields: ["application", "state"] },
      data: { record: { source: { object: { literal: task("t-1") } }, read: "record", params: {} } },
    },
  };
  const literalManifest: DirectPanelManifest = {
    state: {},
    members: { pinned: { target: { projectionId: "literal-summary" } } },
    commands: {},
  };
  const { element } = mountDirect(() => ready(taskRows[0]!), {
    manifest: literalManifest,
    projections: literalProjections,
  });

  await vi.waitFor(() => expect(element.querySelector(".sdk-object-summary-title")?.textContent).toBe("Nightly audit"));
  expect([...element.querySelectorAll(".sdk-object-summary dt")].map((dt) => dt.textContent)).toEqual(["application", "state"]);
});

it("supports table columns, inferred checkboxes from outputs.checked and fallbackToFirst in direct ObjectList", async () => {
  const tableProjections: Record<string, DirectProjection> = {
    "table-tasks": {
      ...meta, id: "table-tasks", name: "Tasks table", componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {
        selected: { kind: "object", objectType: SCHEDULED_TASK },
        checked: { kind: "list", items: { kind: "object", objectType: SCHEDULED_TASK } },
      },
      config: {
        columns: [
          { key: "label", labelKey: "cols.task" },
          { key: "state", labelKey: "cols.state", kind: "tag" },
        ],
        fallbackToFirst: true,
      },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} } },
    },
  };
  const tableManifest: DirectPanelManifest = {
    state: {
      selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: true, external: false },
      checkedTasks: { type: { kind: "list", items: { kind: "object", objectType: SCHEDULED_TASK } }, personal: false, deepLink: false, external: false },
    },
    members: {
      tasks: {
        target: { projectionId: "table-tasks" },
        outputs: { selected: { state: "selectedTask" }, checked: { state: "checkedTasks" } },
      },
    },
    commands: {},
  };
  const { instance, element } = mountDirect(() => ready(taskRows), {
    manifest: tableManifest,
    projections: tableProjections,
    messages: { en: { "cols.task": "Task", "cols.state": "State" } },
  });

  await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-list tbody tr")).toHaveLength(2));
  expect(instance.state.values.value.selectedTask).toEqual(task("t-1"));

  // Checking the second row does not disturb single selection.
  const rowChecks = element.querySelectorAll<HTMLInputElement>(".sdk-object-list tbody input[type='checkbox']");
  rowChecks[1]!.checked = true;
  rowChecks[1]!.dispatchEvent(new Event("change"));
  await nextTick();
  expect(instance.state.values.value.selectedTask).toEqual(task("t-1"));
  expect(instance.state.values.value.checkedTasks).toEqual([task("t-2")]);
  expect(element.querySelector(".sdk-object-list-selected-count")?.textContent).toContain("1");
});

it("shows the configured compact summary and only clamps it when asked", async () => {
  const row = (primaryKey: string, description: string) =>
    ({ primaryKey, label: `Task ${primaryKey}`, subtitle: "owner line", fields: { description } });
  const configured: Record<string, DirectProjection> = {
    ...baseProjections,
    "schedules-tasks": { ...baseProjections["schedules-tasks"]!, config: { subtitleField: "description", subtitleLines: 2 } },
  };
  const { element } = mountDirect(
    (request) => (request.dataName === "rows" ? ready([row("t-1", "Runs every night")]) : { status: "empty" }),
    { projections: configured },
  );
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-list-item-sub")?.textContent?.trim()).toBe("Runs every night"));
  expect(element.querySelector(".sdk-object-list-item-sub")?.classList.contains("sdk-object-list-item-sub-clamped")).toBe(true);
  document.body.innerHTML = "";

  const plain = mountDirect((request) => (request.dataName === "rows" ? ready([row("t-1", "Runs every night")]) : { status: "empty" }), {});
  await vi.waitFor(() => expect(plain.element.querySelector(".sdk-object-list-item-sub")?.textContent?.trim()).toBe("owner line"));
  expect(plain.element.querySelector(".sdk-object-list-item-sub")?.classList.contains("sdk-object-list-item-sub-clamped")).toBe(false);
});
