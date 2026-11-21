import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { savePanelFile } from "../../../../../packages/apps-sdk/src/panel/save-file";
import { panelHumanOperations } from "../../../../../packages/apps-sdk/src/panel/human-operations";
import { createDirectPanelInstance } from "../../../../../packages/apps-sdk/src/panel/direct";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * Files a panel hands the reader (A's download contract, 2026-11-21): a PNG the page drew, saved by the browser in the
 * platform's own page, and the file an owner's read operation sends as an attachment, saved the same way under the name
 * the owner gave it. A read operation the header or the panel's code runs is read, never frozen as a write.
 *
 * What this rules out: a file saved under a name the contract refuses (a path, a hidden file, an extension that is not
 * its type's) or of a type it does not allow; an owner's `filename*` ignored for its plain `filename`; an attachment
 * parsed as JSON; a read with no object sent with a null target; an export run as a write intent.
 */

const saved: { name: string; type: string }[] = [];
let created: Blob[] = [];

beforeEach(() => {
  saved.length = 0;
  created = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    created.push(blob);
    return `blob:file-${created.length}`;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, type: created.at(-1)!.type });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

it("saves a file the page drew under its own name, of its own type", () => {
  const receipt = savePanelFile({ bytes: new Uint8Array([137, 80, 78, 71]), mime: "image/png", suggestedName: "chart.png" });
  expect(receipt).toEqual({ kind: "file", name: "chart.png", mime: "image/png" });
  expect(saved).toEqual([{ name: "chart.png", type: "image/png" }]);
  // The link is not left in the page.
  expect(document.querySelector("a")).toBeNull();
});

it("refuses a name or a type the contract does not allow, saying why, and saves nothing", () => {
  const bytes = new Uint8Array([1]);
  expect(() => savePanelFile({ bytes, mime: "text/csv", suggestedName: "../tasks.csv" })).toThrow("single file basename");
  expect(() => savePanelFile({ bytes, mime: "text/csv", suggestedName: ".tasks.csv" })).toThrow("single file basename");
  expect(() => savePanelFile({ bytes, mime: "text/csv", suggestedName: "tasks.png" })).toThrow("extension must match");
  expect(() => savePanelFile({ bytes, mime: "text/html" as "text/csv", suggestedName: "tasks.html" })).toThrow();
  expect(saved).toEqual([]);
});

function readsThrough(answer: Response) {
  const sent: { path: string; body: unknown }[] = [];
  const operations = panelHumanOperations({ applicationId: "app-tasks", useId: "tasks" }, {
    request: async (path, init) => {
      sent.push({ path, body: JSON.parse(String(init?.body)) });
      return answer;
    },
  });
  return { operations, sent };
}

it("saves an owner's attachment once, under its filename* before its filename, and says so", async () => {
  const { operations, sent } = readsThrough(new Response(new Blob(["id,name\n"]), { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="tasks.csv"; filename*=UTF-8''%E4%BB%BB%E5%8A%A1.csv`,
  } }));
  const receipt = await operations.read("feedback.export", { target: null, input: { status: "open" } });
  expect(receipt).toEqual({ kind: "file", name: "任务.csv", mime: "text/csv" });
  expect(saved).toEqual([{ name: "任务.csv", type: "text/csv" }]);
  // Nothing chosen: the call leaves the target out.
  expect(sent).toEqual([{ path: "/panel-operations/read", body: {
    applicationId: "app-tasks", useId: "tasks", operationId: "feedback.export", call: { input: { status: "open" } },
  } }]);
});

it("refuses an attachment whose name is not a file name, and reads a JSON answer as it was", async () => {
  const unnamed = readsThrough(new Response(new Blob(["x"]), { headers: {
    "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="../skills.zip"`,
  } }));
  await expect(unnamed.operations.read("skills.export", { target: null, input: {} })).rejects.toThrow("single file basename");
  expect(saved).toEqual([]);

  const json = readsThrough(Response.json({ kind: "markdown", markdown: "# Trial" }));
  await expect(json.operations.read("metrics.trial", { target: { kind: "draft" }, input: {} })).resolves.toEqual({ kind: "markdown", markdown: "# Trial" });
  expect(json.sent[0]!.body).toMatchObject({ call: { target: { kind: "draft" }, input: {} } });
});

it("runs a read operation the panel offers as a read, never as a write intent", async () => {
  const read = vi.fn(async () => ({ kind: "file" as const, name: "tasks.csv", mime: "text/csv" as const }));
  const prepare = vi.fn();
  const manifest = definePanel({
    state: { picked: { type: { kind: "object", objectType: SCHEDULED_TASK } } },
    members: { list: { target: { projectionId: "tasks" }, inputs: { task: { state: "picked" } } } },
    commands: {},
  });
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: {},
    text: createPanelText({}, { value: "en" } as never, "en"), ...noOperations,
    operations: { ...noOperations.operations, read, prepare }, recordDraftCreated: async () => {},
    readProjection: async () => { throw new Error("No projection is read here"); },
    read: async () => { throw new Error("No datum is read here"); },
  });
  instance.register({
    slot: "list", projectionId: "tasks", ports: { binding: "", inputs: {} }, takesDrafts: false,
    operations: { export: {
      kind: "action", effect: "read", handlerRef: "tasks.export", label: "Export", batch: false,
      target: { source: "none" }, inputSchema: {}, resultSchema: {},
    } },
  });
  await nextTick();
  expect(await instance.invoke("list.export", { status: "open" })).toEqual({ kind: "file", name: "tasks.csv", mime: "text/csv" });
  expect(read).toHaveBeenCalledWith("list.export", { target: null, input: { status: "open" } }, undefined);
  expect(prepare).not.toHaveBeenCalled();
});
