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
  confirmDiscard,
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
    if (path === "/api/product-panels/application-entry") {
      return Response.json({
        applicationId: appId,
        use,
        allowStandalone: false,
        frame: null,
        content: null,
        menu: { singleEntry: false, groups: [], panelUses: [generalUse, auditUse] },
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
                  control: { kind: "number", min: 1, step: 1, presentation: "stepper" },
                },
                {
                  path: "/dslCookerTimeoutSeconds",
                  label: "DSL Timeout (s)",
                  help: "Maximum DSL execution time in seconds",
                  required: true,
                  readOnly: false,
                  valueSchema: { type: "integer", minimum: 1 },
                  control: { kind: "number", min: 1, step: 10, presentation: "stepper" },
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

    // GS-02: rows layout hides required '*' markers when showRequiredMark is false.
    const rowLabels = [...document.querySelectorAll<HTMLElement>(".sdk-form-row-label")];
    expect(rowLabels).toHaveLength(3);
    expect(rowLabels.every((label) => !label.classList.contains("is-required"))).toBe(true);
    expect(document.querySelectorAll(".sdk-form-row-control-item.is-required")).toHaveLength(0);

    // GS-03: numeric fields render stepper controls (.sdk-form-field-number-stepper) and lang renders select.
    const steppers = [...document.querySelectorAll<HTMLElement>(".sdk-form-field-number-stepper")];
    expect(steppers).toHaveLength(2);
    expect(document.querySelector(".sdk-form-select-choices")).not.toBeNull();

    const numberInputs = [...document.querySelectorAll<HTMLInputElement>(".sdk-form-field-number-stepper input")];
    expect(numberInputs).toHaveLength(2);
    const firstInput = numberInputs[0]!;
    const secondInput = numberInputs[1]!;
    expect(firstInput.getAttribute("aria-valuemin")).toBe("1");
    expect(secondInput.getAttribute("aria-valuemin")).toBe("1");
    // Incrementing steppers steps by 1 for knowledgeMaxResult and 10 for dslCookerTimeoutSeconds.
    const triggerStepper = (stepper: HTMLElement) => {
      const btn = stepper.querySelector<HTMLElement>(".el-input-number__increase")!;
      btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    };
    triggerStepper(steppers[0]!);
    triggerStepper(steppers[1]!);
    await vi.waitFor(() => {
      expect(firstInput.value).toBe("11");
      expect(secondInput.value).toBe("310");
    }, { timeout: 3000 });
    firstInput.value = "25";
    firstInput.dispatchEvent(new Event("input", { bubbles: true }));
    firstInput.dispatchEvent(new Event("change", { bubbles: true }));

    // GS-04: clicking header Discard asks for confirmation; cancelling keeps draft, confirming resets baseline.
    const discardBtn = await vi.waitFor(() => {
      const btn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent?.trim() === "Discard",
      );
      expect(btn).toBeDefined();
      return btn!;
    }, { timeout: 3000 });
    discardBtn.click();

    const cancelBox = await vi.waitFor(() => {
      const open = [...document.querySelectorAll<HTMLElement>(".el-message-box")].filter(
        (item) => item.closest<HTMLElement>(".el-overlay")?.style.display !== "none",
      );
      expect(open.length).toBeGreaterThan(0);
      return open.at(-1)!;
    }, { timeout: 3000 });
    const keepEditingBtn = [...cancelBox.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Keep editing",
    );
    expect(keepEditingBtn).toBeDefined();
    keepEditingBtn!.click();
    await vi.waitFor(() => {
      expect(cancelBox.closest<HTMLElement>(".el-overlay")?.style.display).toBe("none");
    }, { timeout: 3000 });
    expect(firstInput.value).toBe("25");

    discardBtn.click();
    await confirmDiscard();
    await vi.waitFor(() => {
      expect(firstInput.value).toBe("10");
    }, { timeout: 3000 });

    // Edit again and save via header draft button.
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

    let failLogList = false;
    const { readCalls } = await openBuiltPanel(auditUse, builtAudit, {
      read(request) {
        const slot = request.memberPath.at(-1)!.member;
        if ("operations" in request && request.operations) {
          return Response.json({ status: "ready", value: {} });
        }
        if (slot === "logList") {
          if (failLogList) {
            return Response.json({ message: "Audit query timed out" }, { status: 500 });
          }
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

    // AL-07: table renders vertical borders and zebra striping.
    const table = document.querySelector<HTMLTableElement>("table.sdk-object-list-table");
    expect(table).not.toBeNull();
    expect(table!.classList.contains("is-bordered")).toBe(true);
    expect(table!.classList.contains("is-striped")).toBe(true);
    expect(table!.getAttribute("data-border")).toBe("true");
    expect(table!.getAttribute("data-stripe")).toBe("true");

    // AL-06: status bar above the table shows active page & applied filter scope.
    const statusScope = document.querySelector<HTMLElement>(".al-result-scope");
    expect(statusScope).not.toBeNull();
    expect(statusScope!.textContent?.trim()).toBe("Page 1 · Business type: All · Operation: All");

    // Column headers come from explicit labelKeys.
    const headers = [...document.querySelectorAll("th")].map((th) => th.textContent?.trim());
    expect(headers).toEqual(expect.arrayContaining(["Time", "User", "Biz Type", "Operation Type", "Detail"]));

    // AL-08: focus the trigger button, click Detail to render <pre tabindex="0"> with full description (not 8-field dl),
    // and verify focus returns to the trigger button after closing.
    const detailBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Detail",
    );
    expect(detailBtn).toBeDefined();
    detailBtn!.focus();
    expect(document.activeElement).toBe(detailBtn);
    detailBtn!.click();

    const pre = await vi.waitFor(() => {
      const node = document.querySelector<HTMLPreElement>("pre.sdk-object-summary-pre");
      expect(node).not.toBeNull();
      expect(node!.textContent).toContain("Line 1: Added policy\nLine 2: Approved by Alice");
      return node!;
    }, { timeout: 3000 });
    expect(pre.getAttribute("tabindex")).toBe("0");
    expect(document.querySelector(".al-dialog-body dl")).toBeNull();
    expect(document.body.textContent).not.toContain('{"id":"k-1","title":"Refund Policy"}');

    // Confirm logDetail read was issued with the selected platform:AuditLog target.
    expect(
      readCalls.some(
        (req) =>
          req.memberPath.at(-1)?.member === "logDetail"
          && (req.inputs?.target as { className?: string; primaryKey?: string } | undefined)?.className === AUDIT_LOG
          && (req.inputs?.target as { primaryKey?: string } | undefined)?.primaryKey === "log-1",
      ),
    ).toBe(true);

    // Close the dialog via the Close button and verify selectedLog is cleared and focus returns to detailBtn.
    const closeBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Close",
    );
    expect(closeBtn).toBeDefined();
    closeBtn!.click();

    await vi.waitFor(() => {
      expect(document.querySelector("pre.sdk-object-summary-pre")).toBeNull();
    }, { timeout: 3000 });
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(detailBtn);
    }, { timeout: 3000 });

    // AL-06: reread failure preserves previous rows and displays top error alert with working Retry button.
    const beforeRefreshReads = readCalls.filter((req) => req.memberPath.at(-1)?.member === "logList").length;
    const refreshBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Refresh",
    );
    expect(refreshBtn).toBeDefined();
    failLogList = true;
    refreshBtn!.click();

    await vi.waitFor(() => {
      expect(readCalls.filter((req) => req.memberPath.at(-1)?.member === "logList").length).toBeGreaterThan(
        beforeRefreshReads,
      );
      expect(document.querySelector('[data-testid="object-list-stale-error"]')).not.toBeNull();
    }, { timeout: 3000 });
    expect(document.body.textContent).toContain("Alice");
    expect(document.querySelector(".al-result-scope")?.textContent?.trim()).toBe(
      "Page 1 · Business type: All · Operation: All",
    );

    failLogList = false;
    const retryBtn = document.querySelector<HTMLButtonElement>('[data-testid="object-list-stale-retry"]');
    expect(retryBtn).not.toBeNull();
    retryBtn!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="object-list-stale-error"]')).toBeNull();
    }, { timeout: 3000 });

    // AL-06: selecting a filter option without clicking Query does not alter the active status scope until Query is clicked.
    const filterSelect = document.querySelector<HTMLElement>(".al-filter-select");
    expect(filterSelect).not.toBeNull();
    filterSelect!.click();
    const knowledgeOption = await vi.waitFor(() => {
      const opt = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")].find(
        (el) => el.textContent?.trim() === "Knowledge Base",
      );
      expect(opt).toBeDefined();
      return opt!;
    }, { timeout: 3000 });
    knowledgeOption.click();

    await vi.waitFor(() => {
      expect(filterSelect!.textContent).toContain("Knowledge Base");
    }, { timeout: 3000 });
    expect(document.querySelector(".al-result-scope")?.textContent?.trim()).toBe(
      "Page 1 · Business type: All · Operation: All",
    );

    const queryBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Query",
    );
    expect(queryBtn).toBeDefined();
    queryBtn!.click();

    await vi.waitFor(() => {
      expect(
        readCalls.some(
          (req) => req.memberPath.at(-1)?.member === "logList" && req.inputs?.business === "BKNOWLEDGE",
        ),
      ).toBe(true);
      expect(document.querySelector(".al-result-scope")?.textContent?.trim()).toBe(
        "Page 1 · Business type: Knowledge Base · Operation: All",
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

    await vi.waitFor(() => {
      expect(document.querySelector(".al-result-scope")?.textContent?.trim()).toBe(
        "Page 1 · Business type: Knowledge Base · Operation: Add",
      );
    }, { timeout: 3000 });
  });
});
