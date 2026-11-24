import { expect, it } from "vitest";
import { platformTaskRunSchema, platformTaskSchema } from "@ontomato/contracts/platform-schedules";
import examples from "../../../contracts/examples/platform-schedules.json";
import { createScheduledTaskReads } from "../panel-reads";
import { scheduledTaskPanelMessages, scheduledTaskPanelTextEn } from "../panel-text";

const messages = scheduledTaskPanelMessages(scheduledTaskPanelTextEn);
const translate = (key: string, values?: Record<string, string | number>) => {
  let text = messages[key] ?? key;
  for (const [name, value] of Object.entries(values ?? {})) {
    text = text.replace(`{${name}}`, String(value));
  }
  return text;
};

it("builds task records with owner outputs, application counts, and run records", async () => {
  const task = platformTaskSchema.parse(examples.creates[0]!.response);
  const run = platformTaskRunSchema.parse(examples.runs.find(item => item.response.status === "completed")!.response);
  const reads = createScheduledTaskReads({
    async list() {
      return { tasks: [task], timeZone: task.timeZone };
    },
    async task() {
      return task;
    },
    async form() {
      throw new Error("unused");
    },
    async runs() {
      return { runs: [run], nextCursor: "older" };
    },
    async run() {
      return run;
    },
    async applications() {
      return [{ id: task.appId, name: "Ontology", description: null, available: true, unavailableReason: null, taskCount: 1 }];
    },
  }, "en", translate);

  const list = await reads.list();
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({
    primaryKey: task.id,
    label: task.title,
    fields: {
      application: task.appId,
      applicationName: "Ontology",
      stateLabel: "On",
      enabled: true,
      revision: task.revision,
    },
    tones: { stateLabel: "success" },
    outputs: {
      revision: task.revision,
      enabled: true,
      paused: false,
      pauseCode: "",
      isRunning: false,
    },
  });

  const counts = await reads.counts();
  expect(counts).toEqual([
    { key: "", label: "All", count: 1 },
    { key: task.appId, label: "Ontology", count: 1 },
  ]);

  const page = await reads.runRecords(task.id);
  expect(page.nextCursor).toBe("older");
  expect(page.rows).toHaveLength(1);
  expect(page.rows[0]).toMatchObject({
    primaryKey: run.id,
    fields: { status: "Completed" },
    tones: { status: "success" },
    outputs: {
      resultPath: run.resultLink?.path ?? "",
      isRunning: false,
    },
  });

  const focused = await reads.runRecord(task.id, run.id);
  expect(focused.primaryKey).toBe(run.id);
  expect(focused.outputs?.isRunning).toBe(false);
});
