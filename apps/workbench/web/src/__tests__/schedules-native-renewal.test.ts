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
import { sentPanelReadItems, humanIntents, installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelAnswer, panelRecord, panelSnapshot } from "./panel-frame";

const application = catalogFixture().find(app => app.id === "schedules")!;
const use = application.panelUses![0]!;
const id = "00000000-0000-4000-8000-000000000001";
const operationId = "renew.renewCredential";
const deleteOperation = "opDelete.delete";
const deleteMessage = "Task “Nightly test” deleted";
const taskId = "10000000-0000-4000-8000-000000000001";
const runId = "20000000-0000-4000-8000-000000000001";
const run = { ...examples.runs.find(item => item.response.status === "completed")!.response, id: runId, taskId };
const olderRun = {
  ...run, id: "20000000-0000-4000-8000-000000000002", result: "Earlier run result",
  executionDetails: { source: "owner snapshot" },
};
function toRunRecord(item: {
  id: string;
  trigger: string;
  status: string;
  startedAt: string;
  resultSummary: string | null;
  result: string | null;
  executionDetails: Record<string, unknown> | null;
  resultLink: { path: string } | null;
}) {
  return {
    primaryKey: item.id,
    label: `Scheduled · ${item.status}`,
    subtitle: item.resultSummary ?? "",
    fields: {
      status: item.status,
      trigger: item.trigger,
      startedAt: item.startedAt,
      ...(item.resultSummary ? { resultSummary: item.resultSummary } : {}),
      ...(item.result !== null ? { result: item.result } : {}),
      ...(item.executionDetails !== null ? { executionDetails: { kind: "json" as const, value: item.executionDetails } } : {}),
    },
    tones: { status: "success" as const },
    outputs: {
      resultPath: item.resultLink?.path ?? "",
      isRunning: item.status === "running",
    },
  };
}
const row = {
  primaryKey: taskId,
  label: "Nightly test",
  fields: {
    application: "agents",
    applicationName: "Agents",
    settings: "Agent: Daily helper",
    frequency: "Every Monday",
    state: "off",
    stateLabel: "Switched off",
    enabled: false,
    revision: 1,
    pauseCode: "",
    nextRun: "",
    timeZone: "UTC",
    notifyEmail: "",
    lastRun: "completed",
    lastRunAt: "2026-11-21T00:00:00Z",
    lastRunSummary: "Finished",
    latestResultPath: "",
  },
  tones: { state: "info" as const, stateLabel: "info" as const, lastRun: "success" as const },
  outputs: {
    revision: 1,
    enabled: false,
    paused: false,
    pauseCode: "",
    latestResultPath: "",
    isRunning: false,
  },
};
const operationsRow = {
  ...row,
  primaryKey: "10000000-0000-4000-8000-000000000002",
  label: "Operations test",
  fields: { ...row.fields, application: "operations", applicationName: "Operations", lastRunSummary: "" },
};
const pausedRow = {
  ...operationsRow,
  fields: {
    ...operationsRow.fields,
    state: "paused: The application form changed.",
    stateLabel: "Paused",
    enabled: true,
    pauseCode: "definition_changed",
    pauseReason: "The application form changed.",
  },
  tones: { ...operationsRow.tones, state: "warning" as const, stateLabel: "warning" as const },
  outputs: {
    ...operationsRow.outputs,
    enabled: true,
    paused: true,
    pauseCode: "definition_changed",
  },
};
const otherApplications = Array.from({ length: 4 }, (_, index) => ({
  ...row,
  primaryKey: `10000000-0000-4000-8000-00000000000${index + 3}`,
  label: `Application ${index + 1} task`,
  fields: {
    ...row.fields,
    application: `app-schedule-fixture-${index + 1}`,
    applicationName: `app-schedule-fixture-${index + 1}`,
    lastRunSummary: "",
  },
}));
const allTaskRows = [row, pausedRow, ...otherApplications];
const countsFixture = [
  { key: "", label: "All", count: allTaskRows.length },
  { key: "agents", label: "Agents", count: 1 },
  { key: "operations", label: "Operations", count: 1 },
  ...otherApplications.map(item => ({ key: item.fields.application, label: item.fields.applicationName, count: 1 })),
];
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

it("removes usePanelData and business-data PanelData members from the schedules builtin panel", () => {
  expect(module).not.toContain("usePanelData");
  for (const [name, definition] of Object.entries(authoring)) {
    if ("component" in definition && definition.component === "PanelData") {
      expect(name).toBe("renew");
      expect(definition.data).toBeUndefined();
    }
  }
});

it.each([["normalizes a legacy address and renews", false], ["keeps the schedule panel open when renewal is refused", true]])("%s", async (_scenario, refused) => {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { ...platformRoutes.layout, component: RouterView, children: [] }, unknownAddressRoute,
  ] });
  router.beforeEach(detailSelectionGuard(DETAIL_SELECTIONS));
  router.beforeEach(panelEntryGuard(router));
  const historyReads: Array<string | null> = [];
  let checkHistory = false;
  const writes = humanIntents((operation) => operation === deleteOperation
    ? { kind: "success", message: deleteMessage, data: { id: taskId } }
    : { kind: "success", data: {} }, undefined, {
    admitted(member, inputs) {
      if (member === "opDelete" && inputs.task) return {
        delete: {
          kind: "action", handlerRef: "platform:ScheduledTask.delete", effect: "write", label: "Delete task", batch: false,
          target: { source: "input", input: "task" }, inputSchema: {}, resultSchema: {},
        },
      };
      return {};
    },
  });
  const sent = installPlatform(request => {
    const { path } = request;
    if (path === "/api/data-query/platform/applications/schedules/panel-uses")
      return Response.json({ data: { applicationId: application.id, entry: application.entry, panelUses: [use] } });
    if (path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
    if (path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, Object.fromEntries(projections), request);
    if (path.startsWith("/api/product-projections/")) return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      if ("operations" in body && body.memberPath[0].member === "opDelete") return writes(request)!;
      if ("operations" in body) return Response.json({ status: "ready", value: body.memberPath[0].member === "renew" ? {
        renewCredential: {
          kind: "action", label: "Renew background credential", handlerRef: "schedules.renewCredential",
          effect: "write", batch: false, target: { source: "input", input: "application" }, inputSchema: {}, resultSchema: {},
        },
      } : {} });
      const member = body.memberPath[0].member;
      if (member === "appFilter" && body.dataName === "counts") {
        return Response.json({ status: "ready", value: countsFixture });
      }
      if (member === "tasks" && body.dataName === "rows") {
        return Response.json({ status: "ready", value: allTaskRows });
      }
      if (member === "focus" && body.dataName === "record") {
        return Response.json({ status: "ready", value: toRunRecord(body.inputs.runId === olderRun.id ? olderRun : run) });
      }
      if (member === "history" && body.dataName === "rows") {
        if (!checkHistory) return Response.json({ status: "ready", value: { rows: [toRunRecord(run)] } });
        const cursor = body.runtimeParams?.cursor === "older" ? "older" : null;
        const firstAttempt = !historyReads.includes(cursor);
        historyReads.push(cursor);
        if (firstAttempt) return Response.json({ status: "error", message: "Run records unavailable" });
        return Response.json({
          status: "ready",
          value: { rows: [toRunRecord(cursor ? olderRun : run)], ...(cursor ? {} : { nextCursor: "older" }) },
        });
      }
      if (body.dataName === "record") {
        const targetId = (body.inputs.target as { primaryKey?: string } | undefined)?.primaryKey;
        const found = allTaskRows.find(item => item.primaryKey === targetId) ?? row;
        return Response.json({ status: "ready", value: found });
      }
      if (body.dataName === "form") {
        return Response.json({ status: "ready", value: {
          fields: [], values: {}, errors: [], revision: 1,
          save: { method: "PUT", path: `/scheduled-tasks/${taskId}`, bodySchema: {} },
        } });
      }
      return Response.json({ status: "empty" });
    }
    if (path === "/api/panel-operations/intents") {
      if (refused) return Response.json({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "Credential service unavailable" } }, { status: 503 });
      if ((request.body as { operationId: string }).operationId === deleteOperation) return writes(request)!;
      return Response.json({ intentId: id, operationId, label: "Renew background credential", confirmation: { kind: "none" } });
    }
    if (path === `/api/panel-operation-intents/${id}`)
      return Response.json({ intentId: id, operationId, label: "Renew background credential", confirmation: { kind: "none" } });
    if (path === `/api/panel-operations/intents/${id}/dispatch`)
      return Response.json({ kind: "dispatched", intentId: id, outcome: { kind: "success", data: {} } });
    if (path.startsWith("/api/panel-operation-intents/") || path.startsWith("/api/panel-operations/intents/")) {
      return writes(request) ?? nothingAt(request);
    }
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
    if (refused) {
      await vi.waitFor(() => expect(element.querySelector(".schedules [role=alert]")?.textContent).toContain("Credential service unavailable"));
    } else {
      await vi.waitFor(() => expect(sent).toContainEqual(expect.objectContaining({ path: `/api/panel-operations/intents/${id}/dispatch` })));
      await vi.waitFor(() => expect(sentPanelReadItems(sent)).toContainEqual(expect.objectContaining({
        body: expect.objectContaining({
          memberPath: [{ member: "focus" }], dataName: "record",
          inputs: { target: { className: "platform:ScheduledTask", primaryKey: taskId }, runId },
        }),
      })));
      await vi.waitFor(() => expect(router.currentRoute.value.query.taskId).toBeUndefined());
      expect(router.currentRoute.value.query).toEqual({
        app: "agents", selectedTask: taskId, runId,
      });
      await vi.waitFor(() => expect(element.querySelector(`.schedules-focus[data-run="${runId}"]`)).not.toBeNull());
    }
    await vi.waitFor(() => expect(element.querySelector(".schedules-list-col .sdk-object-list-card")?.textContent).toContain("Finished"));
    if (!refused) {
      const list = element.querySelector(".schedules");
      await router.push("/schedules?app=operations");
      expect(router.currentRoute.value.query).toEqual({ app: "operations" });
      await vi.waitFor(() => expect(element.querySelector('.sdk-segmented-option[data-value="operations"]')?.getAttribute("aria-checked")).toBe("true"));
      await vi.waitFor(() => {
        const cards = element.querySelectorAll(".schedules-list-col .sdk-object-list-card");
        expect(cards).toHaveLength(1);
        expect(cards[0]?.textContent).toContain("Operations test");
        expect(cards[0]?.textContent).toContain("The application form changed.");
      });
      expect(element.querySelector(".schedules")).toBe(list);

      const focus = HTMLElement.prototype.focus;
      const browserFocus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options) {
        if (this.getAttribute("data-form") === "edit" && this.style.display === "none") return;
        focus.call(this, options);
      });
      try {
        const reviewButton = await vi.waitFor(() => {
          const btn = element.querySelector<HTMLButtonElement>('.schedules-list-col [data-local-action="review"]');
          expect(btn).not.toBeNull();
          return btn!;
        });
        reviewButton.click();
        await vi.waitFor(() => expect(document.activeElement).toBe(element.querySelector('[data-form="edit"]')));
      } finally {
        browserFocus.mockRestore();
      }
      await vi.waitFor(() => expect(element.querySelector<HTMLElement>('[data-form="edit"]')?.style.display).toBe(""));
      await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({
        app: "operations",
        selectedTask: operationsRow.primaryKey,
      }));
      const editor = element.querySelector<HTMLElement>('[data-form="edit"]')!;
      expect(document.activeElement).toBe(editor);
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await vi.waitFor(() => expect(editor.style.display).toBe("none"));
      expect(document.activeElement).toBe(element.querySelector(".schedules-list-col .sdk-object-list-card.chosen"));

      const other = otherApplications.at(-1)!;
      await router.push(`/schedules?app=${other.fields.application}`);
      await vi.waitFor(() => expect(element.querySelector(`.sdk-segmented-option[data-value="${other.fields.application}"]`)?.getAttribute("aria-checked")).toBe("true"));
      await vi.waitFor(() => {
        const cards = element.querySelectorAll(".schedules-list-col .sdk-object-list-card");
        expect(cards).toHaveLength(1);
        expect(cards[0]?.textContent).toContain(other.label);
      });

      checkHistory = true;
      await router.push(`/schedules?taskId=${taskId}&runId=${olderRun.id}`);
      const linked = `.schedules-focus[data-run="${olderRun.id}"]`;
      await vi.waitFor(() => expect(element.querySelector(linked)?.textContent ?? "").toContain("Earlier run result"));
      expect(element.querySelector(linked)?.textContent).toContain("owner snapshot");
      expect(element.querySelector(`${linked} .result-link`)).not.toBeNull();

      const retryHistory = async () => {
        const retry = await vi.waitFor(() => {
          const button = [...element.querySelectorAll<HTMLButtonElement>(".schedules-runs button")]
            .find(item => item.textContent?.trim() === "Retry");
          expect(button).toBeDefined();
          return button!;
        });
        retry.click();
      };
      await retryHistory();
      const more = await vi.waitFor(() => {
        const button = element.querySelector<HTMLButtonElement>(".schedules-runs .sdk-object-list-load-more");
        expect(button).not.toBeNull();
        return button!;
      });
      more.click();
      await retryHistory();
      await vi.waitFor(() => expect(historyReads).toEqual([null, null, "older", "older"]));
      await vi.waitFor(() => expect(element.querySelectorAll(".schedules-runs .sdk-object-list-card")).toHaveLength(2));

      element.querySelector<HTMLButtonElement>('[data-action="delete"]')!.click();
      await vi.waitFor(() => expect(sent).toContainEqual(expect.objectContaining({
        path: "/api/panel-operations/intents",
        body: { applicationId: "schedules", useId: use.id, operationId: deleteOperation,
          call: { target: { kind: "object", objectType: "platform:ScheduledTask", primaryKey: taskId }, input: { revision: 1 } } },
      })));
      await vi.waitFor(() => expect([...document.querySelectorAll(".el-message__content")].map(item => item.textContent)).toContain(deleteMessage));
    }
  } finally {
    app.unmount();
  }
}, 10_000);
