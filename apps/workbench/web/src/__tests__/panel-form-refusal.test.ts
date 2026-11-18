import { afterEach, describe, expect, it, vi } from "vitest";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { platformScheduleErrorSchema } from "@ontomato/contracts/platform-schedules";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { mountPanel } from "../../../../../packages/apps-sdk/src/panel/mount";
import {
  SCHEDULED_TASK,
  inside,
  installPlatform,
  leaveFrame,
  nothingAt,
  panelFrame,
  panelOf,
  panelRecord,
  panelUse,
  projections,
  task,
  taskForm,
  writePanelDocument,
  type Sent,
} from "./panel-frame";

/*
 * The scheduled tasks service refusing a save, all the way to the panel: the service's answer goes back through the
 * platform's app host and the message bridge, into the SDK's request layer, `createSchedulesApi` and the generic form.
 * The mistake this rules out is the one the real path made: a refusal arriving without its status and body, so the
 * reader was told "no answer" instead of why the service refused, and saw no field marked.
 */

const formProjection = projections["projection-schedules-form"]!;
const panel = panelRecord(
  "panel-schedules-form",
  "Task form",
  definePanel({
    state: { selectedTask: { kind: "object", objectType: SCHEDULED_TASK, deepLink: true } },
    slots: { form: { projectionId: formProjection.id, inputs: { task: { state: "selectedTask" } } } },
    operations: [],
  }),
);
const use = panelUse("use-trial-a-tasks", "panels-trial-a-tasks", panel.id, "/tasks");
const taskPath = `/api/data-query/platform/scheduled-tasks/${task.id}`;

/** The service's own refusal bodies, checked against its contract. */
const conflict = platformScheduleErrorSchema.parse({
  error: { code: "REVISION_CONFLICT", message: "This task was changed by someone else; reopen it to see their change." },
  correlationId: "conflict-1",
});
const invalid = platformScheduleErrorSchema.parse({
  error: {
    code: "FIELD_VALIDATION_FAILED",
    message: "Check the marked fields",
    fields: [{ field: "/content/caseSetId", code: "invalid_option", message: "This case set no longer exists" }],
  },
  correlationId: "invalid-1",
});

afterEach(leaveFrame);

describe("a panel's form when the owner refuses a save", () => {
  it("shows the owner's reason, marks the field it names, and keeps the reader's form", { timeout: 15000 }, async () => {
    // The service refuses the first save as a concurrent change (409) and the second as an invalid field (422).
    const refusals = [Response.json(conflict, { status: 409 }), Response.json(invalid, { status: 422 })];
    const sent = installPlatform((request: Sent) => {
      if (request.path === `/api/product-projections/${formProjection.id}`) return Response.json({ projection: formProjection });
      if (request.path === taskPath && request.method === "GET") return Response.json(task);
      if (request.path === `/api/data-query/platform/scheduled-tasks/applications/${task.appId}/form`) return Response.json(taskForm);
      if (request.path === taskPath && request.method === "PUT") return refusals.shift()!;
      return nothingAt(request);
    });
    const frame = panelFrame();
    platformPanelHost("app-panels-trial-a").frame(frame, use);
    writePanelDocument(panel, use, "/applications/app-panels-trial-a/tasks", {
      selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id },
    });
    inside(frame);
    const { context } = await mountPanel(panelOf("form"));
    await vi.waitFor(() => expect(document.querySelector('[data-field="caseSetId"]')).not.toBeNull(), { timeout: 5000 });

    // The save the header offers: the form's own, at the revision the form was read at.
    const save = context.instance.operations.value.find((operation) => operation.kind === "form.save")!;
    const writes = () => sent.filter((request) => request.method === "PUT");

    // Somebody else changed the task first: the service's reason, beside the reader's form, and nothing read again.
    await expect(context.instance.invoke(save.id)).rejects.toThrow(conflict.error.message);
    await vi.waitFor(() => expect(document.querySelector(".sdk-owner-form-refusal")?.textContent).toBe(conflict.error.message));
    expect(document.querySelector('[data-field="caseSetId"]')).not.toBeNull();
    expect(writes()).toHaveLength(1);
    expect(writes()[0]!.body).toMatchObject({ revision: task.revision, content: task.content });
    const afterConflict = sent.length;

    // A value the service finds invalid: its reason, and its message on the field it names.
    await expect(context.instance.invoke(save.id)).rejects.toThrow(invalid.error.message);
    await vi.waitFor(() =>
      expect(document.querySelector('[data-field="caseSetId"] .el-form-item__error')?.textContent?.trim()).toBe(
        invalid.error.fields![0]!.message,
      ),
    );
    expect(document.querySelector(".sdk-owner-form-refusal")?.textContent).toBe(invalid.error.message);
    // One write per save, and no retry or re-read after either refusal: the save reads the task and its form, then writes.
    expect(writes()).toHaveLength(2);
    expect(sent.slice(afterConflict).map((request) => request.method)).toEqual(["GET", "POST", "PUT"]);
  });
});
