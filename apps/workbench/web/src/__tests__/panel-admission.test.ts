import { afterEach, describe, expect, it, vi } from "vitest";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { contextTransport } from "../../../../../packages/apps-sdk/src/context";
import { mountPanel } from "../../../../../packages/apps-sdk/src/panel/mount";
import { ignoreChanges,
  READER,
  SCHEDULED_TASK,
  inside,
  installPlatform,
  leaveFrame,
  manifestP,
  nothingAt,
  panelFrame,
  panelOf,
  panelRecord,
  panelUse,
  projections,
  run,
  task,
  taskForm,
  writePanelDocument,
  registered,
  type Sent,
} from "./panel-frame";

/*
 * What a panel's frame may ask the platform for (overall design 5.1, 7): exactly what its declaration covers — the
 * projections it names, the requests of the SDK clients their bindings reach, and the drafts written for its page — and
 * nothing else, whatever the reader's own permissions would allow. Both ends are real: the platform's app host and
 * bridge, the frame registered by the platform's panel host with the trial's panel P, and the SDK's `mountPanel`.
 *
 * The mistakes this rules out: a panel that cannot do what it is for (list, read, open the form, save, run now, read its
 * draft) because the narrowing missed one of its requests; and a panel that can do more — write product definitions,
 * talk to the assistant, run another MetricView, delete a task, read a projection or a draft that is not its own —
 * because the reader's credential would have been accepted.
 */

const panelP = panelRecord("panel-schedules-trial", "Scheduled tasks (trial)", manifestP);
const useOfP = panelUse("use-trial-a-tasks", "panels-trial-a-tasks", panelP.id, "/applications/app-panels-trial-a/tasks");
const tasks = "/api/data-query/platform/scheduled-tasks";
const draftOf = (pageKey: string) => ({
  pageKey,
  operation: "platform:ScheduledTask.save",
  target: { id: task.id },
  form: { ...task.content, caseSetId: "set-regression" },
});

function answer(request: Sent) {
  const projection = /^\/api\/product-projections\/(.+)$/.exec(request.path);
  if (projection && projections[projection[1]!]) return Response.json({ projection: projections[projection[1]!] });
  if (request.path === tasks && request.method === "GET") return Response.json({ tasks: [task], timeZone: task.timeZone });
  if (request.path === `${tasks}/${task.id}` && request.method === "GET") return Response.json(task);
  if (request.path === `${tasks}/applications/${task.appId}/form`) return Response.json(taskForm);
  if (request.path === `${tasks}/${task.id}` && request.method === "PUT") return Response.json({ ...task, revision: task.revision + 1 });
  if (request.path === `${tasks}/${task.id}/runs` && request.method === "POST") return Response.json(run);
  if (request.path === "/api/assistant/sessions/session-1/runs/run-1/page-draft") return Response.json(draftOf(useOfP.pageKey));
  if (request.path === "/api/assistant/sessions/session-1/runs/run-2/page-draft") return Response.json(draftOf("dashboard"));
  if (request.path === "/api/assistant/sessions/session-1/runs/run-3/page-draft")
    return Response.json({ ...draftOf(useOfP.pageKey), target: {} });
  if (request.path === "/api/assistant/sessions/session-1/runs/run-3/page-draft/created") return new Response(null, { status: 204 });
  return nothingAt(request);
}

afterEach(leaveFrame);

describe("what a panel's frame may ask the platform for", () => {
  it("everything panel P needs, and nothing its declaration does not cover", { timeout: 20000 }, async () => {
    const sent = installPlatform(answer);
    const frame = panelFrame();
    // A's page shows P: A's panel host registers the frame with P's current record.
    platformPanelHost("app-panels-trial-a", useOfP, ignoreChanges).frame(frame, registered("app-panels-trial-a", useOfP, panelP), true);
    writePanelDocument(registered("app-panels-trial-a", useOfP, panelP), "/applications/app-panels-trial-a/tasks", {
      selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id },
    });
    inside(frame);
    const { context, appContext } = await mountPanel(panelOf("tasks", "summary", "form", "run"));

    // P draws: the reader's tasks, the selected one summed up, and its application's form.
    await vi.waitFor(
      () => {
        expect(document.querySelector(".sdk-object-list [role=option]")?.textContent?.trim()).toBe(task.title);
        expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title);
        expect(document.querySelector('[data-field="/caseSetId"]')).not.toBeNull();
      },
      { timeout: 5000 },
    );
    // The reader saves the form and runs the task now: the operations the header offers, run in the frame.
    const operations = context.instance.operations.value;
    await context.instance.invoke(operations.find((operation) => operation.kind === "form.save")!.id);
    await expect(
      context.instance.invoke(operations.find((operation) => operation.handlerRef === "schedules.runNow")!.id),
    ).resolves.toMatchObject({ runId: run.id });
    // The initial form, save validation and the two post-operation refreshes must all use the same allowed path.
    await vi.waitFor(() => {
      expect(sent.filter(request => request.path === `${tasks}/applications/${task.appId}/form`)).toHaveLength(4);
      expect(document.querySelector('[data-field="/caseSetId"]')).not.toBeNull();
    });
    // A draft an agent wrote for this page is read the way the SDK reads one.
    const transport = contextTransport(appContext);
    const draft = await transport.request("/assistant/sessions/session-1/runs/run-1/page-draft?path=drafts%2Ftask.json", {}, "");
    expect(await draft.json()).toEqual(draftOf(useOfP.pageKey));

    const allowed = sent.map(({ method, path }) => `${method} ${path}`);
    expect(new Set(allowed)).toEqual(
      new Set([
        ...Object.keys(projections).map((id) => `GET /api/product-projections/${id}`),
        `GET ${tasks}`,
        `GET ${tasks}/${task.id}`,
        `POST ${tasks}/applications/${task.appId}/form`,
        `PUT ${tasks}/${task.id}`,
        `POST ${tasks}/${task.id}/runs`,
        "GET /api/assistant/sessions/session-1/runs/run-1/page-draft",
      ]),
    );
    expect(sent.every((request) => request.credential === READER)).toBe(true);

    // What the reader's credential would also be accepted for, but P does not declare: refused, and never sent.
    const outside: [string, { method?: string; body?: string }, string][] = [
      ["/product-assets/definitions/customers", { method: "PUT", body: "{}" }, ""],
      ["/product-assets/subscriptions", { method: "POST", body: "{}" }, ""],
      ["/assistant/agents", {}, ""],
      ["/assistant/sessions", { method: "POST", body: "{}" }, ""],
      ["/assistant/sessions/session-1/runs/run-1/page-draft/created", { method: "POST", body: "{}" }, ""],
      ["/metricView/execute", { method: "POST", body: JSON.stringify({ id: "revenue" }) }, "/data-query"],
      ["/action/execute", { method: "POST", body: JSON.stringify({ id: "delete-customer" }) }, "/data-query"],
      [`/platform/scheduled-tasks/${task.id}`, { method: "DELETE" }, "/data-query"],
      [`/platform/scheduled-tasks/${task.id}/enabled`, { method: "PUT", body: "{}" }, "/data-query"],
      ["/platform/scheduled-tasks/applications", {}, "/data-query"],
      ["/product-projections/projection-of-another-panel", {}, ""],
      [`/product-panels/${panelP.id}`, {}, ""],
    ];
    for (const [path, init, service] of outside)
      await expect(transport.request(path, init, service), `${init.method ?? "GET"} ${service}${path}`).rejects.toThrow(
        "Outside what this panel's projections declare",
      );
    // A draft is the page's only when it was written for this page: another page's is read, and not handed over.
    await expect(
      transport.request("/assistant/sessions/session-1/runs/run-2/page-draft?path=drafts%2Fboard.json", {}, ""),
    ).rejects.toThrow("written for another page");
    expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual([
      ...allowed,
      "GET /api/assistant/sessions/session-1/runs/run-2/page-draft",
    ]);
  });

  it("records the object a create draft of its own page created, and no other draft's", { timeout: 20000 }, async () => {
    const sent = installPlatform(answer);
    const frame = panelFrame();
    platformPanelHost("app-panels-trial-a", useOfP, ignoreChanges).frame(frame, registered("app-panels-trial-a", useOfP, panelP), true);
    writePanelDocument(registered("app-panels-trial-a", useOfP, panelP), "/applications/app-panels-trial-a/tasks", {});
    inside(frame);
    const { appContext } = await mountPanel(panelOf());
    const transport = contextTransport(appContext);
    const created = (run: string, path: string) =>
      transport.request(`/assistant/sessions/session-1/runs/${run}/page-draft/created`, { method: "POST", body: JSON.stringify({ path, id: task.id }) }, "");

    // Before the frame has read the draft, and for a draft it read that changes an existing task, nothing is recorded.
    await expect(created("run-3", "outputs/drafts/task.page-draft.json")).rejects.toThrow("Outside what this panel's projections declare");
    await transport.request("/assistant/sessions/session-1/runs/run-1/page-draft?path=outputs%2Fdrafts%2Ftask.page-draft.json", {}, "");
    await expect(created("run-1", "outputs/drafts/task.page-draft.json")).rejects.toThrow("Outside what this panel's projections declare");
    // The create draft written for this page, once read: its first save records what it created, at that draft alone.
    await transport.request("/assistant/sessions/session-1/runs/run-3/page-draft?path=outputs%2Fdrafts%2Ftask.page-draft.json", {}, "");
    expect((await created("run-3", "outputs/drafts/task.page-draft.json")).status).toBe(204);
    await expect(created("run-3", "outputs/drafts/other.page-draft.json")).rejects.toThrow("Outside what this panel's projections declare");
    expect(sent.filter(request => request.path.endsWith("/created")).map(request => request.body))
      .toEqual([{ path: "outputs/drafts/task.page-draft.json", id: task.id }]);
  });
});
