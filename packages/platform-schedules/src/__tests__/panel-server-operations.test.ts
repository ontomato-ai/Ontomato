import { expect, it } from "vitest";
import { CREATE_SCHEDULED_TASK, SCHEDULED_TASK } from "@ontomato/contracts/platform-object-types";
import { platformTaskSchema } from "@ontomato/contracts/platform-schedules";
import examples from "../../../contracts/examples/platform-schedules.json";
import { createScheduledTaskServerOperations } from "../panel-server-operations";

it("reports the scheduled task identity returned by the owner after creating it", async () => {
  const create = createScheduledTaskServerOperations((_, key) => key)
    .find(operation => operation.handlerRef === CREATE_SCHEDULED_TASK)!;
  const example = examples.creates.find(entry => entry.name === "agents-instruction")!;
  const task = platformTaskSchema.parse(example.response);
  const form = examples.forms.find(entry => entry.name === "agents-empty")!;
  const host = {
    async request(path: string) {
      if (path.endsWith("/form")) return Response.json(form.response);
      if (path === example.path) return Response.json(task);
      throw new Error(`Unexpected request to ${path}`);
    },
  };
  const { formRevision: _formRevision, content, ...settings } = example.request;

  const outcome = await create.execute(host, { kind: "draft" }, { values: { ...content, task: settings } }, example.headers["Idempotency-Key"]);
  expect(outcome).toMatchObject({ kind: "success", created: { objectType: SCHEDULED_TASK, primaryKey: task.id } });
});
