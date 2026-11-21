import { expect, it, vi } from "vitest";
import { effectScope, nextTick, type ComputedRef } from "vue";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { createDirectPanelInstance, type MemberDataState } from "../../../../../packages/apps-sdk/src/panel/direct";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";
import type { PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";

/*
 * Each named datum of a member is read again only when an input it reads changes. The pilot's task list takes the
 * selected task as an input (to show which row is selected, as an address restores it) without reading its rows from
 * it, and the summary reads its record from the selected task.
 *
 * The mistake this catches: every selection reading the list's rows again and flashing it, which the first gate's
 * "changing the selection" measurement would count.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const projections: Record<string, DirectProjection> = {
  "task-list": {
    ...record, id: "task-list", name: "Tasks", componentId: "@ontomato/sdk:ObjectList",
    inputs: { value: { kind: "object", objectType: SCHEDULED_TASK } }, outputs: { selected: { kind: "object", objectType: SCHEDULED_TASK } }, config: {},
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} } },
  },
  "task-summary": {
    ...record, id: "task-summary", name: "Task", componentId: "@ontomato/sdk:ObjectSummary",
    inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } }, outputs: {}, config: {},
    data: { record: { source: { object: { input: "task" } }, read: "record", params: {} } },
  },
};
const manifest: DirectPanelManifest = {
  state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: true, external: false } },
  members: {
    tasks: { target: { projectionId: "task-list" }, inputs: { value: { state: "selectedTask" } }, outputs: { selected: { state: "selectedTask" } } },
    summary: { target: { projectionId: "task-summary" }, inputs: { task: { state: "selectedTask" } } },
  },
  commands: {},
};
const row = (primaryKey: string) => ({ primaryKey, label: primaryKey, fields: {} });

it("reads a list's rows once while the selection changes, and the selected record again for each selection", async () => {
  const reads: PanelMemberReadRequest[] = [];
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: {},
    text: createPanelText({}, { value: "en" } as never, "en"), ...noOperations, recordDraftCreated: async () => {},
    readProjection: async (id) => projections[id]!,
    read: async (request) => {
      reads.push(request);
      return { status: "ready", value: (request.dataName === "rows" ? [row("t-1"), row("t-2")] : row(String((request.inputs.task as { primaryKey: string }).primaryKey))) as never };
    },
  });
  const inputsOf = (member: string) => () => {
    const selected = instance.state.values.value.selectedTask as { className: string; primaryKey: string } | null;
    return { [member === "tasks" ? "value" : "task"]: selected ?? null };
  };
  const scope = effectScope();
  scope.run(() => {
    instance.memberData("tasks", projections["task-list"]!, inputsOf("tasks")).use("rows");
    instance.memberData("summary", projections["task-summary"]!, inputsOf("summary")).use("record");
  });
  await nextTick();
  const count = (name: string) => reads.filter((read) => read.dataName === name).length;
  expect(count("rows")).toBe(1);
  expect(count("record")).toBe(0);

  instance.state.set("selectedTask", { className: SCHEDULED_TASK, primaryKey: "t-1" });
  await nextTick();
  instance.state.set("selectedTask", { className: SCHEDULED_TASK, primaryKey: "t-2" });
  await nextTick();
  expect(count("rows")).toBe(1);
  expect(count("record")).toBe(2);
  scope.stop();
});

it("keeps a shown datum on screen while it is read again, and shows its new answer once it arrives", async () => {
  // The second read of the summary is held, as a slow owner holds it; the first answer stays until it comes.
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let reads = 0;
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: { selectedTask: { className: SCHEDULED_TASK, primaryKey: "t-1" } },
    text: createPanelText({}, { value: "en" } as never, "en"), ...noOperations, recordDraftCreated: async () => {},
    readProjection: async (id) => projections[id]!,
    read: async (request) => {
      if (++reads === 2) await held;
      return { status: "ready", value: row(String((request.inputs.task as { primaryKey: string }).primaryKey)) as never };
    },
  });
  const inputs = () => ({ task: instance.state.values.value.selectedTask ?? null }) as never;
  const scope = effectScope();
  let summary!: ComputedRef<MemberDataState>;
  scope.run(() => { summary = instance.memberData("summary", projections["task-summary"]!, inputs).use("record"); });
  await vi.waitFor(() => expect(summary.value).toMatchObject({ status: "ready", value: { primaryKey: "t-1" } }));

  instance.state.set("selectedTask", { className: SCHEDULED_TASK, primaryKey: "t-2" });
  await nextTick();
  expect(summary.value).toMatchObject({ status: "ready", value: { primaryKey: "t-1" } });
  release();
  await vi.waitFor(() => expect(summary.value).toMatchObject({ status: "ready", value: { primaryKey: "t-2" } }));
  scope.stop();
});
