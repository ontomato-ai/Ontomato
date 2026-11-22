import { afterEach, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import examples from "../../../../../packages/contracts/examples/platform-schedules.json";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import { DETAIL_SELECTIONS, detailSelectionGuard } from "../../../../../packages/platform-web/src/detail-selection";
import { panelEntryGuard, unknownAddressRoute } from "../../../../../packages/platform-web/src/panel-entries";
import { catalogFixture } from "../../../../../packages/platform-web/src/__tests__/fixtures";
import source from "../../../../../packages/platform-schedules/resources/builtin-panels/schedules/panel.json";
import html from "../../../../../packages/platform-schedules/resources/builtin-panels/schedules/panel.html?raw";
import module from "../../../../../packages/platform-schedules/resources/builtin-panels/schedules/panel.mjs?raw";
import { installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelAnswer, panelRecord, panelSnapshot } from "./panel-frame";

const application = catalogFixture().find(app => app.id === "schedules")!;
const use = application.panelUses![0]!;
const id = "00000000-0000-4000-8000-000000000001";
const operationId = "renew.renewCredential";
const taskId = "10000000-0000-4000-8000-000000000001";
const runId = "20000000-0000-4000-8000-000000000001";
const run = { ...examples.runs.find(item => item.response.status === "completed")!.response, id: runId, taskId };
const olderRun = {
  ...run, id: "20000000-0000-4000-8000-000000000002", result: "Earlier run result",
  executionDetails: { source: "owner snapshot" },
};
const row = {
  primaryKey: taskId, label: "Nightly test", fields: {
    application: "agents", frequency: "Every Monday", state: "off", nextRun: "", timeZone: "UTC",
    lastRun: "completed", lastRunAt: "2026-11-21T00:00:00Z", lastRunSummary: "**Finished**",
  },
};
const operationsRow = {
  ...row, primaryKey: "10000000-0000-4000-8000-000000000002", label: "Operations test",
  fields: { ...row.fields, application: "operations", lastRunSummary: "" },
};
const pausedRow = {
  ...operationsRow,
  fields: { ...operationsRow.fields, state: "paused: The application form changed.", pauseCode: "definition_changed" },
};
const otherApplications = Array.from({ length: 4 }, (_, index) => ({
  ...row, primaryKey: `10000000-0000-4000-8000-00000000000${index + 3}`, label: `Application ${index + 1} task`,
  fields: { ...row.fields, application: `app-schedule-fixture-${index + 1}`, lastRunSummary: "" },
}));
const target = { kind: "object", objectType: "platform:Application", primaryKey: "schedules" };
const objectTypes = Object.fromEntries(Object.entries(platformObjectTypes).map(([type, entry]) => [
  type,
  platformTypeTableEntrySchema.parse({ ...entry, operations: entry.operations?.map(id => {
    const form = id === "platform:ScheduledTask.save" || id === "platform:ScheduledTask.create";
    return {
      id, kind: form ? "form.save" : "action", effect: "write", batch: false, inputSchema: {},
      target: form ? { source: "draft" } : { source: "input", input: type === "platform:Application" ? "application" : "task" },
    };
  }) }),
]));
const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(source.manifest);
const catalogue = components.map(component => appsSdkComponentCatalogEntrySchema.parse({
  ...component, ports: { props: [], events: [], slots: [] },
}));
const projections = new Map<string, ProductProjection>();
const members = Object.fromEntries(Object.entries(authoring).map(([name, definition]) => {
  if (!("component" in definition)) throw new Error(`Expected an authored projection for ${name}`);
  const { projection, placement } = expandPanelAuthoringMember(name, definition, { state: manifest.state, typeTable: { objectTypes }, components: catalogue });
  projections.set(definition.id!, {
    ...projection, id: definition.id!, name, description: name, visibility: "platform",
    domainId: null, ownerId: null, editable: false, revision: 1,
    createdAt: "2026-11-21T00:00:00Z", updatedAt: "2026-11-21T00:00:00Z",
  });
  return [name, { ...placement, target: { projectionId: definition.id! } }];
}));
const panel = {
  ...panelRecord(use.panelId, "Scheduled tasks", definePanel({ ...manifest, members })),
  visibility: "platform" as const, domainId: null, ownerId: null, editable: false as const,
  content: { html, module, messages: source.content.messages },
};

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
});

it.each([["normalizes a legacy address and renews", false], ["keeps the schedule panel open when renewal is refused", true]])("%s", async (_scenario, refused) => {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { ...platformRoutes.layout, component: RouterView, children: [] }, unknownAddressRoute,
  ] });
  router.beforeEach(detailSelectionGuard(DETAIL_SELECTIONS));
  router.beforeEach(panelEntryGuard(router));
  const historyReads: Array<string | null> = [];
  let checkHistory = false;
  const sent = installPlatform(request => {
    const { path } = request;
    if (path === "/api/data-query/platform/applications/schedules/panel-uses")
      return Response.json({ data: { applicationId: application.id, entry: application.entry, panelUses: [use] } });
    if (path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
    if (path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, Object.fromEntries(projections), request);
    if (path.startsWith("/api/product-projections/")) return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      if ("operations" in body) return Response.json({ status: "ready", value: body.memberPath[0].member === "renew" ? {
        renewCredential: {
          kind: "action", label: "Renew background credential", handlerRef: "schedules.renewCredential",
          effect: "write", batch: false, target: { source: "input", input: "application" }, inputSchema: {}, resultSchema: {},
        },
      } : {} });
      switch (body.dataName) {
        case "rows": return Response.json({ status: "ready", value: [row, pausedRow, ...otherApplications] });
        case "record": return Response.json({ status: "ready", value: row });
        case "runs": {
          if (!checkHistory) return Response.json({ status: "ready", value: { runs: [run], nextCursor: null } });
          const cursor = body.runtimeParams?.cursor === "older" ? "older" : null;
          const firstAttempt = !historyReads.includes(cursor);
          historyReads.push(cursor);
          if (firstAttempt) return Response.json({ status: "error", message: "Run records unavailable" });
          return Response.json({
            status: "ready", value: { runs: cursor ? [olderRun] : [run], nextCursor: cursor ? null : "older" },
          });
        }
        case "run": return Response.json({ status: "ready", value: body.inputs.runId === olderRun.id ? olderRun : run });
        default: return Response.json({ status: "empty" });
      }
    }
    if (path === "/api/panel-operations/intents") {
      if (refused) return Response.json({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "Credential service unavailable" } }, { status: 503 });
      return Response.json({ intentId: id, operationId, label: "Renew background credential", confirmation: { kind: "none" } });
    }
    if (path === `/api/panel-operation-intents/${id}`)
      return Response.json({ intentId: id, operationId, label: "Renew background credential", confirmation: { kind: "none" } });
    if (path === `/api/panel-operations/intents/${id}/dispatch`)
      return Response.json({ kind: "dispatched", intentId: id, outcome: { kind: "success", data: {} } });
    return nothingAt(request);
  }, router);
  useApplicationCatalog().applications.value = catalogFixture();
  await router.push(refused ? "/schedules" : `/schedules?app=agents&taskId=${taskId}&runId=${runId}`);
  const { app, element } = mountPlatformPage(() => h(RouterView), router);
  try {
    await vi.waitFor(() => expect(sent).toContainEqual(expect.objectContaining({
      path: "/api/panel-operations/intents",
      body: { applicationId: "schedules", useId: use.id, operationId, call: { target, input: {} } },
    })), { timeout: 5000 });
    if (refused)
      await vi.waitFor(() => expect(element.querySelector(".schedules [role=alert]")?.textContent).toContain("Credential service unavailable"));
    else {
      await vi.waitFor(() => expect(sent).toContainEqual(expect.objectContaining({ path: `/api/panel-operations/intents/${id}/dispatch` })));
      await vi.waitFor(() => expect(sent).toContainEqual(expect.objectContaining({
        path: "/api/product-panels/read",
        body: expect.objectContaining({
          memberPath: [{ member: "focus" }], dataName: "run",
          inputs: { target: { className: "platform:ScheduledTask", primaryKey: taskId }, runId },
        }),
      })));
      await vi.waitFor(() => expect(router.currentRoute.value.query.taskId).toBeUndefined());
      expect(JSON.parse(String(router.currentRoute.value.query.state))).toEqual({
        app: "agents", selectedTask: { className: "platform:ScheduledTask", primaryKey: taskId }, runId,
      });
      await vi.waitFor(() => expect(element.querySelector(".schedules [data-run].focused")).not.toBeNull());
    }
    await vi.waitFor(() => expect(element.querySelector('.schedules [data-task] [title="Finished"]')?.textContent).toBe("Finished"));
    if (!refused) {
      const list = element.querySelector(".schedules");
      await router.push("/schedules?app=operations");
      expect(router.currentRoute.value.query.app).toBeUndefined();
      expect(JSON.parse(String(router.currentRoute.value.query.state))).toEqual({ app: "operations" });
      await vi.waitFor(() => expect(element.querySelector('.schedules [data-app="operations"]')?.getAttribute("aria-pressed")).toBe("true"));
      expect(Array.from(element.querySelectorAll(".schedules [data-task]"), item => item.getAttribute("data-task"))).toEqual([operationsRow.primaryKey]);
      expect(element.querySelector(".schedules")).toBe(list);
      const pause = element.querySelector<HTMLDetailsElement>(".schedules [data-task] details");
      expect(pause?.open).toBe(false);
      expect(pause?.querySelector("p")?.textContent).toBe("The application form changed.");
      const focus = HTMLElement.prototype.focus;
      const browserFocus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options) {
        if (this.getAttribute("data-form") === "edit" && this.style.display === "none") return;
        focus.call(this, options);
      });
      try {
        element.querySelector<HTMLButtonElement>(".schedules [data-task] .pause-review")!.click();
        await vi.waitFor(() => expect(document.activeElement).toBe(element.querySelector('[data-form="edit"]')));
      } finally {
        browserFocus.mockRestore();
      }
      await vi.waitFor(() => expect(element.querySelector<HTMLElement>('[data-form="edit"]')?.style.display).toBe(""));
      await vi.waitFor(() => expect(JSON.parse(String(router.currentRoute.value.query.state))).toMatchObject({
        selectedTask: { className: "platform:ScheduledTask", primaryKey: operationsRow.primaryKey },
        compose: "edit",
      }));
      const editor = element.querySelector<HTMLElement>('[data-form="edit"]')!;
      expect(document.activeElement).toBe(editor);
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await vi.waitFor(() => expect(editor.style.display).toBe("none"));
      expect(document.activeElement).toBe(element.querySelector(".card.is-selected button.card-select"));
      const other = otherApplications.at(-1)!;
      await router.push(`/schedules?app=${other.fields.application}`);
      await vi.waitFor(() => expect(element.querySelector(".filter-more")?.textContent).toContain(other.fields.application));
      expect(element.querySelectorAll(".schedules .chips > button")).toHaveLength(6);
      expect(element.querySelector(".filter-more [aria-pressed]")?.getAttribute("aria-pressed")).toBe("true");
      expect(element.querySelector(".schedules [data-task]")?.getAttribute("data-task")).toBe(other.primaryKey);

      checkHistory = true;
      await router.push(`/schedules?taskId=${taskId}&runId=${olderRun.id}`);
      const linked = `[data-run="${olderRun.id}"]`;
      await vi.waitFor(() => expect(element.querySelector(`${linked} .details`)?.textContent ?? "").toContain("Earlier run result"));
      expect(element.querySelector(`${linked} .details`)?.textContent).toContain("owner snapshot");
      expect(element.querySelector(`${linked} .result-link`)).not.toBeNull();
      const retryHistory = async () => {
        const retry = await vi.waitFor(() => {
          const button = element.querySelector<HTMLButtonElement>('[data-action="retry-history"]');
          expect(button).not.toBeNull();
          return button!;
        });
        retry.click();
      };
      await retryHistory();
      const more = await vi.waitFor(() => {
        const button = element.querySelector<HTMLButtonElement>('[data-action="more-history"]');
        expect(button).not.toBeNull();
        return button!;
      });
      more.click();
      await retryHistory();
      await vi.waitFor(() => expect(historyReads).toEqual([null, null, "older", "older"]));
      await vi.waitFor(() => expect(element.querySelectorAll(`.runs ${linked}`)).toHaveLength(1));
      expect(element.querySelectorAll(".runs [data-run]")).toHaveLength(2);
      expect(element.querySelector(`${linked} .details`)?.textContent).toContain("Earlier run result");
    }
  } finally {
    app.unmount();
  }
}, 10_000);

it("opens the edit form from a draft link even when the owner refuses the draft", async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { ...platformRoutes.layout, component: RouterView, children: [] }, unknownAddressRoute,
  ] });
  router.beforeEach(panelEntryGuard(router));
  const titleField = {
    path: "/task/title", label: "Title", control: { kind: "text" }, valueSchema: { type: "string" },
    required: true, readOnly: false,
  };
  const operation = "platform:ScheduledTask.save";
  const draft = { pageKey: use.pageKey, operation, target: { objectType: "platform:ScheduledTask", id: taskId }, form: { content: { title: "Invalid" } } };
  const message = "The draft field /content must be text. Fill in each application field separately.";
  installPlatform(request => {
    const { path } = request;
    if (path === "/api/data-query/platform/applications/schedules/panel-uses")
      return Response.json({ data: { applicationId: application.id, entry: application.entry, panelUses: [use] } });
    if (path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
    if (path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, Object.fromEntries(projections), request);
    if (path.startsWith("/api/product-projections/")) return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
    if (path === "/api/assistant/sessions/session-1/runs/run-1/page-draft") return Response.json(draft);
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      const member = body.memberPath[0].member;
      if ("operations" in body) return Response.json({ status: "ready", value: member === "editForm" ? {
        save: {
          kind: "form.save", label: "Save task", handlerRef: operation, effect: "write", batch: false,
          target: { source: "input", input: "target" }, inputSchema: {}, resultSchema: {},
        },
      } : {} });
      if (body.dataName === "rows") return Response.json({ status: "ready", value: [row] });
      if (body.dataName === "form" && (member === "detail" || member === "editForm")) return Response.json({
        status: "ready", value: {
          fields: [titleField], values: { task: { title: row.label } }, revision: 1,
          errors: body.runtimeParams?.values ? [{ field: "/content", code: "invalid_format", message }] : [],
          save: { method: "PUT", path: `/scheduled-tasks/${taskId}`, bodySchema: {}, draftOperation: operation },
        },
      });
      return Response.json({ status: "empty" });
    }
    return nothingAt(request);
  }, router);
  useApplicationCatalog().applications.value = catalogFixture();
  const state = { selectedTask: { className: "platform:ScheduledTask", primaryKey: taskId }, compose: "edit" };
  await router.push({ path: "/schedules", query: {
    state: JSON.stringify(state), draftSessionId: "session-1", draftRunId: "run-1", draftPath: "outputs/drafts/task.page-draft.json",
  } });
  const { app, element } = mountPlatformPage(() => h(RouterView), router);
  try {
    const editForm = await vi.waitFor(() => {
      const form = element.querySelector<HTMLElement>('[data-form="edit"]');
      expect(form?.querySelector(".sdk-owner-form-refusal")?.textContent).toBe(message);
      return form!;
    });
    expect(editForm.style.display).not.toBe("none");
    expect(editForm.querySelector<HTMLInputElement>('[data-field="/task/title"] input')?.value).toBe(row.label);
    expect(element.querySelector("[data-task]")?.textContent).toContain(row.label);
  } finally {
    app.unmount();
  }
}, 10_000);
