import { afterEach, describe, expect, it, vi } from "vitest";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { mountPanel } from "../../../../../packages/apps-sdk/src/panel/mount";
import { confirmDiscard, formSaveCalls, humanIntents, ignoreChanges,
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
  registered,
  type Sent,
} from "./panel-frame";

/*
 * The scheduled tasks service refusing a save, all the way to the panel: the coordinator's outcome reaches the
 * form through the platform app host and the message bridge.
 * The mistake this rules out is the one the real path made: a refusal arriving without its status and body, so the
 * reader was told "no answer" instead of why the service refused, and saw no field marked.
 */

const formProjection = projections["projection-schedules-form"]!;
const panel = panelRecord(
  "panel-schedules-form",
  "Task form",
  definePanel({
    state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true } },
    members: { form: { target: { projectionId: formProjection.id }, inputs: { task: { state: "selectedTask" } } } },
  }),
);
const use = panelUse("use-trial-a-tasks", "panels-trial-a-tasks", panel.id, "/applications/app-panels-trial-a/tasks");
const taskPath = `/api/data-query/platform/scheduled-tasks/${task.id}`;

const conflict = {
  kind: "refusal", code: "REVISION_CONFLICT", message: "This task was changed by someone else; reopen it to see their change.",
} satisfies PanelOperationOutcome;
const invalid = {
  kind: "refusal", code: "FIELD_VALIDATION_FAILED", message: "Check the marked fields",
  errors: [{ field: "/caseSetId", code: "invalid_option", message: "This case set no longer exists" }],
} satisfies PanelOperationOutcome;
/** A refusal naming a field and saying something no field holds: the field's part is counted, the rest said. */
const mixed = {
  kind: "refusal", code: "FIELD_VALIDATION_FAILED", message: "Check the marked fields",
  errors: [
    { field: "/caseSetId", code: "invalid_option", message: "This case set no longer exists" },
    { field: "/schedule", code: "invalid_format", message: "Another task already runs at this time" },
  ],
} satisfies PanelOperationOutcome;
const twoFields = {
  kind: "refusal", code: "FIELD_VALIDATION_FAILED", message: "Check the marked fields",
  errors: [
    { field: "/operation", code: "invalid_option", message: "This operation is no longer offered" },
    { field: "/caseSetId", code: "invalid_option", message: "This case set no longer exists" },
  ],
} satisfies PanelOperationOutcome;

afterEach(leaveFrame);

describe("a panel's form when the owner refuses a save", () => {
  it("shows the owner's reason, marks the field it names, and keeps the reader's form", { timeout: 15000 }, async () => {
    const refusals = [conflict, invalid, mixed, twoFields];
    const intents = humanIntents(() => refusals.shift()!);
    const sent = installPlatform((request: Sent) => {
      if (request.path === `/api/product-projections/${formProjection.id}`) return Response.json({ projection: formProjection });
      if (request.path === taskPath && request.method === "GET") return Response.json(task);
      if (request.path === `/api/data-query/platform/scheduled-tasks/applications/${task.appId}/form`) return Response.json(taskForm);
      return intents(request) ?? nothingAt(request);
    });
    const frame = panelFrame();
    platformPanelHost("app-panels-trial-a", use, ignoreChanges).frame(frame, registered("app-panels-trial-a", use, panel), true);
    writePanelDocument(registered("app-panels-trial-a", use, panel), "/applications/app-panels-trial-a/tasks", {
      selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id },
    });
    inside(frame);
    const { context } = await mountPanel(panelOf("form"));
    await vi.waitFor(() => expect(document.querySelector('[data-field="/caseSetId"]')).not.toBeNull(), { timeout: 5000 });

    // The save the header offers: the form's own, at the revision the form was read at.
    const save = context.instance.operations.value.find((operation) => operation.kind === "form.save")!;
    const writes = () => formSaveCalls(sent);

    // Somebody else changed the task first: the service's reason, beside the reader's form, and nothing read again.
    await expect(context.instance.invoke(save.id)).rejects.toThrow(conflict.message);
    await vi.waitFor(() => expect(document.querySelector(".sdk-owner-form-refusal")?.textContent).toBe(conflict.message));
    expect(document.querySelector('[data-field="/caseSetId"]')).not.toBeNull();
    expect(writes()).toHaveLength(1);
    expect(writes()[0]!.input).toEqual({ revision: task.revision, values: task.content, submittedFields: [] });
    const afterConflict = sent.length;

    // A value the service finds invalid: its reason, and its message on the field it names.
    await expect(context.instance.invoke(save.id)).rejects.toThrow(invalid.message);
    await vi.waitFor(() =>
      expect(document.querySelector('[data-field="/caseSetId"] .el-form-item__error')?.textContent?.trim()).toBe(
        invalid.errors[0]!.message,
      ),
    );
    // Said on its field, the message is not said again below the form: there the reader is told how many fields to
    // change, and taken to the first (panelisation lead, 2026-11-22).
    const foot = () => [...document.querySelectorAll<HTMLElement>(".sdk-owner-form-refusal > *")].map((line) => line.textContent?.trim());
    expect(foot()).toEqual(["1 field needs changing"]);
    const scrolled: string[] = [];
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) { scrolled.push(this.dataset.field ?? ""); };
    document.querySelector<HTMLButtonElement>(".sdk-owner-form-refusal button")!.click();
    expect(scrolled).toEqual(["/caseSetId"]);
    // One prepare, one reread of the frozen intent and one dispatch. The form is left exactly as it was.
    expect(writes()).toHaveLength(2);
    expect(sent.slice(afterConflict).map(({ method, path }) => [method, path])).toEqual([
      ["POST", "/api/panel-operations/intents"],
      ["GET", expect.stringMatching(/^\/api\/panel-operation-intents\/[^/]+$/)],
      ["POST", expect.stringMatching(/^\/api\/panel-operations\/intents\/[^/]+\/dispatch$/)],
    ]);

    // What no field holds is said below the form, after the count of the fields that hold the rest.
    await expect(context.instance.invoke(save.id)).rejects.toThrow(mixed.message);
    await vi.waitFor(() => expect(foot()).toEqual(["1 field needs changing", "Another task already runs at this time"]));
    // Counted by the fields the reader changes.
    await expect(context.instance.invoke(save.id)).rejects.toThrow(twoFields.message);
    await vi.waitFor(() => expect(foot()).toEqual(["2 fields need changing"]));

    context.instance.forms.handle("form")!.set("/caseSetId", "set-retired");
    refusals.push(conflict);
    await expect(context.instance.invoke(save.id)).rejects.toThrow(conflict.message);
    const beforeDiscard = sent.length;
    const discard = [...document.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")]
      .find(button => button.textContent?.trim() === "Discard")!;
    await vi.waitFor(() => expect(discard.disabled).toBe(false));
    discard.click();
    await confirmDiscard();
    await vi.waitFor(() => expect(sent.slice(beforeDiscard)).toContainEqual(expect.objectContaining({ path: taskPath, method: "GET" })));
  });
});
