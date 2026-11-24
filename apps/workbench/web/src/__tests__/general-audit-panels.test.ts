import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import { currentPanelRecordSchema, type ProductProjection } from "@ontomato/contracts/product-panels";
import {
  AUDIT_LOG,
  GENERAL_SETTINGS,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import generalSource from "../../../../../packages/platform-admin/resources/builtin-panels/general-settings/panel.json";
import generalHtml from "../../../../../packages/platform-admin/resources/builtin-panels/general-settings/panel.html?raw";
import generalModule from "../../../../../packages/platform-admin/resources/builtin-panels/general-settings/panel.mjs?raw";
import auditSource from "../../../../../packages/platform-admin/resources/builtin-panels/audit-log/panel.json";
import auditHtml from "../../../../../packages/platform-admin/resources/builtin-panels/audit-log/panel.html?raw";
import auditModule from "../../../../../packages/platform-admin/resources/builtin-panels/audit-log/panel.mjs?raw";
import {
  humanIntents,
  installPlatform,
  leaveFrame,
  mountPlatformPage,
  nothingAt,
  panelAnswer,
  panelRecord,
  panelSnapshot,
  panelUse,
  type Sent,
} from "./panel-frame";

const appId = "settings";
const generalUse = {
  ...panelUse(
    "general-settings",
    "general-settings",
    "builtin-product-general-settings",
    "/settings/system-config/general",
  ),
  inputs: {
    settings: { literal: { className: GENERAL_SETTINGS, primaryKey: "general" } },
  },
};
const auditUse = panelUse(
  "audit-log",
  "audit-log",
  "builtin-product-audit-log",
  "/settings/records/audit-log",
);

const FORM_SAVE_OPS = new Set([`${GENERAL_SETTINGS}.save`]);

const objectTypes = Object.fromEntries(
  Object.entries(platformObjectTypes).map(([type, entry]) => [
    type,
    platformTypeTableEntrySchema.parse({
      ...entry,
      operations: entry.operations?.map((id) => ({
        id,
        kind: FORM_SAVE_OPS.has(id) ? "form.save" : "action",
        effect: "write",
        batch: false,
        inputSchema: {},
        target: FORM_SAVE_OPS.has(id) ? { source: "draft" } : { source: "input", input: "target" },
      })),
    }),
  ]),
);

const catalogue = components.map((component) =>
  appsSdkComponentCatalogEntrySchema.parse({
    ...component,
    ports: { props: [], events: [], slots: [] },
  }),
);

function buildPanel(
  panelId: string,
  name: string,
  source: typeof generalSource | typeof auditSource,
  html: string,
  module: string,
) {
  const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(source.manifest);
  const projections = new Map<string, ProductProjection>();
  const members = Object.fromEntries(
    Object.entries(authoring).map(([memberName, definition]) => {
      if (!("component" in definition)) throw new Error(`Expected authored projection for ${memberName}`);
      const { projection, placement } = expandPanelAuthoringMember(memberName, definition, {
        state: manifest.state,
        typeTable: { objectTypes },
        components: catalogue,
      });
      projections.set(definition.id!, {
        ...projection,
        id: definition.id!,
        name: memberName,
        description: memberName,
        visibility: "platform",
        domainId: null,
        ownerId: null,
        editable: false,
        revision: 1,
        createdAt: "2026-11-25T00:00:00Z",
        updatedAt: "2026-11-25T00:00:00Z",
      });
      return [memberName, { ...placement, target: { projectionId: definition.id! } }];
    }),
  );
  return {
    panel: currentPanelRecordSchema.parse({
      ...panelRecord(panelId, name, definePanel({ ...manifest, members })),
      visibility: "platform" as const,
      domainId: null,
      ownerId: null,
      editable: false,
      content: { ...source.content, html, module },
    }),
    projections,
  };
}

const builtGeneral = buildPanel(
  generalUse.panelId,
  "General",
  generalSource,
  generalHtml,
  generalModule,
);
const builtAudit = buildPanel(
  auditUse.panelId,
  "Audit log",
  auditSource,
  auditHtml,
  auditModule,
);

let unmount: (() => void) | null = null;

afterEach(() => {
  unmount?.();
  unmount = null;
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function openBuiltPanel(
  use: typeof generalUse | typeof auditUse,
  built: ReturnType<typeof buildPanel>,
  handlers: {
    read: (request: ProductPanelReadRequest) => Response;
    intents?: (request: Sent) => Response | undefined;
  },
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        component: { render: () => h(RouterView) },
        children: [
          { path: generalUse.path, component: PanelApplicationRoute, props: { applicationId: appId } },
          { path: auditUse.path, component: PanelApplicationRoute, props: { applicationId: appId } },
        ],
      },
    ],
  });

  const readCalls: ProductPanelReadRequest[] = [];
  installPlatform(async (sent: Sent) => {
    const { path } = sent;
    if (handlers.intents) {
      const handled = handlers.intents(sent);
      if (handled) return handled;
    }
    if (path === "/api/data-query/platform/applications") {
      return Response.json({
        data: [{
          id: appId,
          kind: "native",
          rail: "bottom",
          category: "admin",
          sort: 20,
          entry: { path: "/settings", renderer: "settings" },
          names: { en: "System settings" },
          descriptions: {},
          icon: "settings",
          panelUses: [generalUse, auditUse],
        }],
      });
    }
    if (path === "/api/data-query/platform/applications/resolve-entry") {
      return Response.json({
        data: {
          applicationId: appId,
          entry: { path: "/settings", renderer: "settings" },
          use,
          menu: { groups: [], panelUses: [generalUse, auditUse] },
        },
      });
    }
    if (path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
      return Response.json({
        data: {
          applicationId: appId,
          entry: { path: "/settings", renderer: "settings" },
          panelUses: [generalUse, auditUse],
        },
      });
    }
    if (path === `/api/product-panels/${use.panelId}`) {
      return panelAnswer(built.panel, sent);
    }
    if (path === `/api/product-panels/${use.panelId}/snapshot`) {
      return panelSnapshot(built.panel, Object.fromEntries(built.projections), sent);
    }
    if (path.startsWith("/api/product-projections/")) {
      const id = decodeURIComponent(path.slice("/api/product-projections/".length));
      const projection = built.projections.get(id);
      if (projection) return Response.json({ projection });
    }
    if (path === "/api/product-panels/read") {
      const req = sent.body as ProductPanelReadRequest;
      readCalls.push(req);
      return handlers.read(req);
    }
    if (path === "/api/product-panels/read-batch") {
      const { reads } = sent.body as { reads: ProductPanelReadRequest[] };
      const results = await Promise.all(
        reads.map(async (req) => {
          readCalls.push(req);
          return handlers.read(req).json();
        }),
      );
      return Response.json({ results });
    }
    if (path === "/api/product-panels/page-skill") {
      return Response.json({
        pageKey: use.pageKey,
        applicationId: appId,
        useId: use.id,
        panelId: use.panelId,
        skills: [],
      });
    }
    return nothingAt(sent);
  }, router);

  useApplicationCatalog().applications.value = [{
    id: appId,
    kind: "native",
    rail: "bottom",
    category: "admin",
    sort: 20,
    entry: { path: "/settings", renderer: "settings" },
    entryAccess: ["system-config", "audit-logs"],
    scheduleAdapter: null,
    releaseId: null,
    names: { en: "System settings" },
    descriptions: {},
    icon: "settings",
    panelUses: [generalUse, auditUse],
  }];

  await router.push(use.path);
  await router.isReady();
  const mounted = mountPlatformPage(() => h(RouterView), router);
  unmount = () => {
    mounted.app.unmount();
    mounted.element.remove();
  };
  return { router, readCalls };
}

describe("built-in general settings and audit log panels", () => {
  it("mounts the general settings panel, displays owner form fields, and saves changes via page-header draft", async () => {
    const savedState = {
      knowledgeMaxResult: 10,
      dslCookerTimeoutSeconds: 300,
      lang: "en",
    };
    const dispatched: Array<{ operationId: string; input: unknown }> = [];
    const intents = humanIntents(
      (operationId, call) => {
        dispatched.push({ operationId, input: call.input });
        const values = (call.input as { values?: Partial<typeof savedState> } | undefined)?.values;
        if (values?.knowledgeMaxResult !== undefined) {
          savedState.knowledgeMaxResult = values.knowledgeMaxResult;
        }
        return { kind: "success", data: { ...savedState } };
      },
      { source: "input", input: "target" },
    );

    await openBuiltPanel(generalUse, builtGeneral, {
      intents,
      read(request) {
        const slot = request.memberPath.at(-1)!.member;
        if (slot === "generalForm") {
          return Response.json({
            status: "ready",
            value: {
              values: { ...savedState },
              fields: [
                {
                  path: "/knowledgeMaxResult",
                  label: "Knowledge Max Results",
                  help: "Maximum number of knowledge entries recalled",
                  required: true,
                  readOnly: false,
                  valueSchema: { type: "integer", minimum: 1 },
                  control: { kind: "number" },
                },
                {
                  path: "/dslCookerTimeoutSeconds",
                  label: "DSL Timeout (s)",
                  help: "Maximum DSL execution time in seconds",
                  required: true,
                  readOnly: false,
                  valueSchema: { type: "integer", minimum: 1 },
                  control: { kind: "number" },
                },
                {
                  path: "/lang",
                  label: "Backend Language",
                  help: "Language used by the data engine",
                  required: true,
                  readOnly: false,
                  valueSchema: { type: "string", enum: ["en", "zh-CN"] },
                  control: {
                    kind: "select",
                    options: [
                      { value: "en", label: "English", description: null, disabled: false, disabledReason: null },
                      { value: "zh-CN", label: "简体中文", description: null, disabled: false, disabledReason: null },
                    ],
                  },
                },
              ],
              errors: [],
              save: { method: "POST", path: "/api/system-config/general", bodySchema: {} },
            },
          });
        }
        return Response.json({ status: "empty" });
      },
    });

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("General");
      expect(document.body.textContent).toContain("Knowledge Max Results");
      expect(document.body.textContent).toContain("DSL Timeout (s)");
      expect(document.body.textContent).toContain("Backend Language");
    }, { timeout: 3000 });

    const numberInputs = [...document.querySelectorAll<HTMLInputElement>("input[type='number'], .el-input-number input")];
    expect(numberInputs.length).toBeGreaterThanOrEqual(2);
    const firstInput = numberInputs[0]!;
    firstInput.value = "25";
    firstInput.dispatchEvent(new Event("input", { bubbles: true }));
    firstInput.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => {
      const saveBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => /save/i.test(button.textContent?.trim() ?? "") && !button.disabled,
      );
      expect(saveBtn).toBeDefined();
    }, { timeout: 3000 });

    const saveBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => /save/i.test(button.textContent?.trim() ?? "") && !button.disabled,
    )!;
    saveBtn.click();

    await vi.waitFor(() => {
      expect(dispatched.length).toBe(1);
    }, { timeout: 3000 });
    expect(dispatched[0]!.input).toMatchObject({
      values: expect.objectContaining({ knowledgeMaxResult: 25 }),
    });
  });

  it("mounts the audit log panel, lists paged rows with localized columns, opens read-only detail drawer and clears selectedLog on close", async () => {
    const queryRows = [
      {
        primaryKey: "log-1",
        label: "Created knowledge item",
        fields: {
          operateTime: "2026-11-25T04:00:00.000Z",
          userName: "Alice",
          userId: "u-1",
          business: "Knowledge Base",
          operation: "Add",
          byAi: "false",
          description: "Line 1: Added policy\nLine 2: Approved by Alice",
        },
        fieldLabels: {
          operateTime: "Operate Time",
          userName: "User",
          userId: "User ID",
          business: "Business",
          operation: "Operation",
          byAi: "By AI",
          description: "Description",
        },
        tones: {
          business: "default",
          operation: "info",
        },
      },
    ];

    const detailRecord = {
      ...queryRows[0],
      fields: {
        ...queryRows[0].fields,
        parameters: '{"id":"k-1","title":"Refund Policy"}',
      },
      fieldLabels: {
        ...queryRows[0].fieldLabels,
        parameters: "Parameters",
      },
    };

    const { readCalls } = await openBuiltPanel(auditUse, builtAudit, {
      read(request) {
        const slot = request.memberPath.at(-1)!.member;
        if ("operations" in request && request.operations) {
          return Response.json({ status: "ready", value: {} });
        }
        if (slot === "logList") {
          return Response.json({
            status: "ready",
            value: {
              rows: queryRows,
              total: 1,
            },
          });
        }
        if (slot === "logDetail") {
          const target = request.inputs?.target as { primaryKey?: string } | undefined;
          if (target?.primaryKey === "log-1") {
            return Response.json({ status: "ready", value: detailRecord });
          }
          return Response.json({ status: "empty" });
        }
        return Response.json({ status: "empty" });
      },
    });

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Audit log");
      expect(document.body.textContent).toContain("Alice");
      expect(document.body.textContent).toContain("Knowledge Base");
      expect(document.body.textContent).toContain("Add");
      expect(document.body.textContent).toContain("Line 1: Added policy");
    }, { timeout: 3000 });

    // Column headers come from explicit labelKeys.
    const headers = [...document.querySelectorAll("th")].map((th) => th.textContent?.trim());
    expect(headers).toEqual(expect.arrayContaining(["Time", "User", "Biz Type", "Operation Type", "Detail"]));

    // Click the local row action "Detail" button to open the read-only detail drawer.
    const detailBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Detail",
    );
    expect(detailBtn).toBeDefined();
    detailBtn!.click();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Audit log detail");
      expect(document.body.textContent).toContain('{"id":"k-1","title":"Refund Policy"}');
    }, { timeout: 3000 });

    // Confirm logDetail read was issued with the selected platform:AuditLog target.
    expect(
      readCalls.some(
        (req) =>
          req.memberPath.at(-1)?.member === "logDetail"
          && (req.inputs?.target as { className?: string; primaryKey?: string } | undefined)?.className === AUDIT_LOG
          && (req.inputs?.target as { primaryKey?: string } | undefined)?.primaryKey === "log-1",
      ),
    ).toBe(true);

    // Close the drawer via the Close button and verify selectedLog is cleared (drawer unmounts).
    const closeBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Close",
    );
    expect(closeBtn).toBeDefined();
    closeBtn!.click();

    await vi.waitFor(() => {
      expect(document.body.textContent).not.toContain('{"id":"k-1","title":"Refund Policy"}');
    }, { timeout: 3000 });

    // Selecting filters via deep-link / router query binds business & operation params to the query read.
    const beforeRefreshReads = readCalls.filter((req) => req.memberPath.at(-1)?.member === "logList").length;
    const refreshBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Refresh",
    );
    expect(refreshBtn).toBeDefined();
    refreshBtn!.click();
    await vi.waitFor(() => {
      expect(readCalls.filter((req) => req.memberPath.at(-1)?.member === "logList").length).toBeGreaterThan(
        beforeRefreshReads,
      );
    }, { timeout: 3000 });
  });

  it("restores audit log filters from URL deep links and passes them to logList read", async () => {
    const { readCalls, router } = await openBuiltPanel(auditUse, builtAudit, {
      read(request) {
        const slot = request.memberPath.at(-1)!.member;
        if ("operations" in request && request.operations) {
          return Response.json({ status: "ready", value: {} });
        }
        if (slot === "logList") {
          return Response.json({ status: "ready", value: { rows: [], total: 0 } });
        }
        return Response.json({ status: "empty" });
      },
    });

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("No audit logs match these filters");
    }, { timeout: 3000 });

    await router.push({ path: auditUse.path, query: { business: "BKNOWLEDGE", operation: "ADD" } });

    await vi.waitFor(() => {
      const filteredRead = readCalls.find(
        (req) =>
          req.memberPath.at(-1)?.member === "logList"
          && req.inputs?.business === "BKNOWLEDGE"
          && req.inputs?.operation === "ADD",
      );
      expect(filteredRead).toBeDefined();
    }, { timeout: 3000 });
  });
});
