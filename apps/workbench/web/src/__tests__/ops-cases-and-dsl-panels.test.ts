import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import type { PanelOwnerOperationDescriptor, PanelReadOperationResult } from "@ontomato/contracts/panel-operations";
import { currentPanelRecordSchema, type ProductProjection } from "@ontomato/contracts/product-panels";
import {
  AUTOTEST_CASE_SET,
  CREATE_AUTOTEST_CASE_SET,
  DELETE_AUTOTEST_CASE_SET,
  EXECUTE_DSL_QUERY,
  IMPORT_AUTOTEST_CASE_SET,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import casesSource from "../../../../../packages/platform-admin/resources/builtin-panels/ops-autotest-cases/panel.json";
import casesHtml from "../../../../../packages/platform-admin/resources/builtin-panels/ops-autotest-cases/panel.html?raw";
import casesModule from "../../../../../packages/platform-admin/resources/builtin-panels/ops-autotest-cases/panel.mjs?raw";
import dslSource from "../../../../../packages/platform-admin/resources/builtin-panels/ops-dsl-console/panel.json";
import dslHtml from "../../../../../packages/platform-admin/resources/builtin-panels/ops-dsl-console/panel.html?raw";
import dslModule from "../../../../../packages/platform-admin/resources/builtin-panels/ops-dsl-console/panel.mjs?raw";
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

const platformShellMocks = vi.hoisted(() => ({
  confirmDanger: vi.fn(async () => true),
  confirmUnsavedSwitch: vi.fn(async () => "cancel" as "save" | "discard" | "cancel"),
}));

vi.mock("@ontomato/platform-shell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ontomato/platform-shell")>();
  return {
    ...actual,
    confirmDanger: platformShellMocks.confirmDanger,
    confirmUnsavedSwitch: platformShellMocks.confirmUnsavedSwitch,
  };
});

const appId = "ops-diagnosis";
const casesUse = panelUse(
  "ops-autotest-cases",
  "ops-autotest-cases",
  "builtin-product-ops-autotest-cases",
  "/ops/cases",
);
const dslUse = panelUse(
  "ops-dsl-console",
  "ops-dsl-console",
  "builtin-product-ops-dsl-console",
  "/ops/dsl",
);

const SAVE_CASE_SET = `${AUTOTEST_CASE_SET}.save`;

const objectTypes = Object.fromEntries(
  Object.entries(platformObjectTypes).map(([type, entry]) => [
    type,
    platformTypeTableEntrySchema.parse({
      ...entry,
      operations: entry.operations?.map((id) => {
        if (id === SAVE_CASE_SET) {
          return {
            id,
            kind: "form.save",
            effect: "write",
            batch: false,
            inputSchema: {},
            target: { source: "input", input: "target" },
          };
        }
        if (id === EXECUTE_DSL_QUERY) {
          return {
            id,
            kind: "action",
            effect: "read",
            batch: false,
            inputSchema: {},
            target: { source: "draft" },
          };
        }
        if (id === CREATE_AUTOTEST_CASE_SET || id === IMPORT_AUTOTEST_CASE_SET) {
          return {
            id,
            kind: "action",
            effect: "write",
            batch: false,
            inputSchema: {},
            target: { source: "none" },
          };
        }
        return {
          id,
          kind: "action",
          effect: "write",
          batch: false,
          inputSchema: {},
          target: { source: "input", input: "target" },
        };
      }),
    }),
  ]),
);

const catalogue = components.map((component) =>
  appsSdkComponentCatalogEntrySchema.parse({
    ...component,
    ...(component.componentId === "OperationButton"
      ? { config: [{ name: "operation", type: "string", required: true, description: "Operation local name" }] }
      : {}),
    ports: { props: [], events: [], slots: [] },
  }),
);

function buildPanel(
  panelId: string,
  name: string,
  source: typeof casesSource | typeof dslSource,
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

const builtCases = buildPanel(
  casesUse.panelId,
  "Test cases",
  casesSource,
  casesHtml,
  casesModule,
);
const builtDsl = buildPanel(
  dslUse.panelId,
  "DSL execution",
  dslSource,
  dslHtml,
  dslModule,
);

let unmount: (() => void) | null = null;

beforeEach(() => {
  localStorage.clear();
  platformShellMocks.confirmDanger.mockReset().mockResolvedValue(true);
  platformShellMocks.confirmUnsavedSwitch.mockReset().mockResolvedValue("cancel");
});

afterEach(() => {
  unmount?.();
  unmount = null;
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.innerHTML = "";
});

async function openBuiltPanel(
  use: typeof casesUse | typeof dslUse,
  built: ReturnType<typeof buildPanel>,
  handlers: {
    read: (request: ProductPanelReadRequest) => Response;
    intents?: (request: Sent) => Response | undefined;
    readOp?: (request: Sent) => Response | undefined;
  },
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        component: { render: () => h(RouterView) },
        children: [
          { path: casesUse.path, component: PanelApplicationRoute, props: { applicationId: appId } },
          { path: dslUse.path, component: PanelApplicationRoute, props: { applicationId: appId } },
        ],
      },
    ],
  });

  installPlatform(async (sent: Sent) => {
    const { path } = sent;
    if (handlers.readOp) {
      const handled = handlers.readOp(sent);
      if (handled) return handled;
    }
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
          sort: 30,
          entry: { path: "/ops", renderer: "ops" },
          names: { en: "Ops diagnosis" },
          descriptions: {},
          icon: "activity",
          panelUses: [casesUse, dslUse],
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
        menu: { singleEntry: false, groups: [], panelUses: [casesUse, dslUse] },
      });
    }
    if (path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
      return Response.json({
        data: {
          applicationId: appId,
          entry: { path: "/ops", renderer: "ops" },
          panelUses: [casesUse, dslUse],
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
      return handlers.read(sent.body as ProductPanelReadRequest);
    }
    if (path === "/api/product-panels/read-batch") {
      const { reads } = sent.body as { reads: ProductPanelReadRequest[] };
      const results = await Promise.all(reads.map((req) => handlers.read(req).json()));
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
    sort: 30,
    entry: { path: "/ops", renderer: "ops" },
    scheduleAdapter: null,
    releaseId: null,
    names: { en: "Ops diagnosis" },
    descriptions: {},
    icon: "activity",
    panelUses: [casesUse, dslUse],
  }];

  await router.push(use.path);
  await router.isReady();
  const mounted = mountPlatformPage(() => h(RouterView), router);
  unmount = () => {
    mounted.app.unmount();
    mounted.element.remove();
  };
  return { element: mounted.element, router };
}

function setFieldValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ops-autotest-cases builtin panel (D5-1, D5-2, D5-6)", () => {
  it("renders TestcaseWorkbench, shows ObjectList draft dot, restores draft across reload, and guards switching with save-discard-cancel", async () => {
    const sets: Record<string, {
      id: string;
      name: string;
      cases: Array<{
        caseId: string;
        question: string;
        expectedAnswer: string;
        expectedLogic: string;
        judgment: string;
      }>;
    }> = {
      "set-1": {
        id: "set-1",
        name: "Core Suite",
        cases: [
          {
            caseId: "case-001",
            question: "What is Q1 revenue?",
            expectedAnswer: "120M",
            expectedLogic: "SUM(revenue)",
            judgment: "Numeric match",
          },
        ],
      },
      "set-2": {
        id: "set-2",
        name: "Smoke Suite",
        cases: [
          {
            caseId: "case-001",
            question: "Count active hosts?",
            expectedAnswer: "42",
            expectedLogic: "COUNT(hosts)",
            judgment: "Exact match",
          },
        ],
      },
    };

    const saveDescriptor: PanelOwnerOperationDescriptor = {
      kind: "form.save",
      handlerRef: SAVE_CASE_SET,
      label: "Save",
      effect: "write",
      target: { source: "input", input: "target" },
      inputSchema: {},
      resultSchema: {},
      batch: false,
    };
    const createDescriptor: PanelOwnerOperationDescriptor = {
      kind: "action",
      handlerRef: CREATE_AUTOTEST_CASE_SET,
      label: "New case set",
      effect: "write",
      target: { source: "none" },
      inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      resultSchema: {},
      batch: false,
    };
    const deleteDescriptor: PanelOwnerOperationDescriptor = {
      kind: "action",
      handlerRef: DELETE_AUTOTEST_CASE_SET,
      label: "Delete",
      effect: "write",
      target: { source: "input", input: "target" },
      inputSchema: {},
      resultSchema: {},
      batch: false,
    };

    const formFields = [
      { path: "/name", label: "Case set name", required: true, readOnly: false, valueSchema: { type: "string" }, control: { kind: "text" } },
      {
        path: "/cases",
        label: "Test cases",
        required: false,
        readOnly: false,
        valueSchema: { type: "array" },
        control: {
          kind: "object-array",
          itemKeyPath: "/caseId",
          defaultItem: { caseId: "", question: "", expectedAnswer: "", expectedLogic: "", judgment: "Default rule" },
          itemFields: [
            { path: "/caseId", label: "Case ID", required: true, readOnly: false, valueSchema: { type: "string" }, control: { kind: "text", placeholder: "case-1" } },
            { path: "/question", label: "Question", required: true, readOnly: false, valueSchema: { type: "string" }, control: { kind: "text", multiline: true, rows: 3 } },
            { path: "/expectedAnswer", label: "Expected answer", required: false, readOnly: false, valueSchema: { type: "string" }, control: { kind: "text", multiline: true, rows: 2 } },
            { path: "/judgment", label: "Judgment", required: false, readOnly: false, valueSchema: { type: "string" }, control: { kind: "text", multiline: true, rows: 2, placeholder: "Default rule" } },
            { path: "/expectedLogic", label: "Expected logic", required: false, readOnly: false, valueSchema: { type: "string" }, control: { kind: "text", multiline: true, rows: 4 } },
          ],
        },
      },
    ];

    const savedPayloads: Array<{ primaryKey: string; values: Record<string, unknown> }> = [];

    const readHandler = (req: ProductPanelReadRequest) => {
      const slot = req.memberPath.at(-1)!.member;
      if ("operations" in req && req.operations) {
        if (slot === "caseSetForm") return Response.json({ status: "ready", value: { save: saveDescriptor } });
        if (slot === "createCaseSet") return Response.json({ status: "ready", value: { create: createDescriptor } });
        if (slot === "deleteCaseSet") return Response.json({ status: "ready", value: { delete: deleteDescriptor } });
        return Response.json({ status: "ready", value: {} });
      }
      const dataName = "dataName" in req ? req.dataName : undefined;
      if (slot === "caseSets" && dataName === "rows") {
        return Response.json({
          status: "ready",
          value: Object.values(sets).map((s) => ({
            className: AUTOTEST_CASE_SET,
            primaryKey: s.id,
            label: s.name,
            subtitle: `${s.cases.length} cases`,
            fields: { id: s.id, name: s.name, caseCountText: `${s.cases.length} cases`, updatedAt: "2026-11-25T10:00:00Z" },
          })),
        });
      }
      if (slot === "detailHeader" && dataName === "record") {
        const key = (req.inputs?.target as { primaryKey?: string } | undefined)?.primaryKey ?? "set-1";
        const s = sets[key] ?? sets["set-1"]!;
        return Response.json({
          status: "ready",
          value: {
            className: AUTOTEST_CASE_SET,
            primaryKey: s.id,
            label: s.name,
            subtitle: `${s.cases.length} cases`,
            fields: { id: s.id, name: s.name, caseCountText: `${s.cases.length} cases` },
          },
        });
      }
      if (slot === "caseSetForm" && dataName === "form") {
        const key = (req.inputs?.target as { primaryKey?: string } | undefined)?.primaryKey ?? "set-1";
        const s = sets[key] ?? sets["set-1"]!;
        return Response.json({
          status: "ready",
          value: {
            values: { name: s.name, cases: s.cases },
            fields: formFields,
            errors: [],
            save: { method: "PUT", path: `/api/observe/autotest/case-sets/${s.id}`, bodySchema: {} },
          },
        });
      }
      return Response.json({ status: "ready", value: {} });
    };

    const intentsHandler = humanIntents(
      (_operationId, call) => {
        const target = call.target as { primaryKey: string };
        const input = call.input as { values: { name: string; cases: typeof sets["set-1"]["cases"] } };
        savedPayloads.push({ primaryKey: target.primaryKey, values: input.values });
        sets[target.primaryKey] = {
          id: target.primaryKey,
          name: input.values.name,
          cases: input.values.cases,
        };
        return {
          kind: "success",
          data: { id: target.primaryKey, name: input.values.name, caseCount: input.values.cases.length },
          affected: { objectTypes: [AUTOTEST_CASE_SET], objects: [{ objectType: AUTOTEST_CASE_SET, primaryKey: target.primaryKey }] },
        };
      },
      { source: "input", input: "target" },
      {
        admitted: (member) => {
          if (member === "caseSetForm") return { save: saveDescriptor };
          if (member === "createCaseSet") return { create: createDescriptor };
          if (member === "deleteCaseSet") return { delete: deleteDescriptor };
          return {};
        },
      },
    );

    const first = await openBuiltPanel(casesUse, builtCases, { read: readHandler, intents: intentsHandler });

    // Wait for three-pane TestcaseWorkbench + cards list to mount.
    await vi.waitFor(() => {
      expect(first.element.querySelector("[data-testcase-list-pane]")).not.toBeNull();
      expect(first.element.querySelector("[data-testcase-editor-pane]")).not.toBeNull();
      expect(first.element.querySelector("[data-testcase-json-pane]")).not.toBeNull();
      expect(first.element.querySelector("[data-testcase-footer]")).not.toBeNull();
    });
    expect(first.element.querySelector(".ops-cases-footer")).toBeNull();

    // Edit question in TestcaseWorkbench -> live JSON sync + draft dot in left ObjectList.
    const questionInput = first.element.querySelector<HTMLTextAreaElement>(
      '[data-testcase-field="question"] textarea, textarea[data-testcase-field="question"]',
    )!;
    setFieldValue(questionInput, "What is Q2 revenue?");

    await vi.waitFor(() => {
      const jsonInput = first.element.querySelector<HTMLTextAreaElement>("[data-testcase-json-input]")!;
      expect(jsonInput.value).toContain("What is Q2 revenue?");
      expect(first.element.querySelector(".sdk-object-list-draft-dot")).not.toBeNull();
    });

    // Reload panel -> draft restored with visible banner (D5-6).
    unmount?.();
    unmount = null;
    leaveFrame();

    const reloaded = await openBuiltPanel(casesUse, builtCases, { read: readHandler, intents: intentsHandler });
    await vi.waitFor(() => {
      const banner = reloaded.element.querySelector<HTMLElement>("[data-draft-banner]");
      expect(banner?.dataset.draftBanner).toBe("restored");
      const restoredQuestion = reloaded.element.querySelector<HTMLTextAreaElement>(
        '[data-testcase-field="question"] textarea, textarea[data-testcase-field="question"]',
      )!;
      expect(restoredQuestion.value).toBe("What is Q2 revenue?");
      expect(reloaded.element.querySelector(".sdk-object-list-draft-dot")).not.toBeNull();
    });

    // Click second case set -> triggers 3-state save-discard-cancel guard (D5-2).
    const cards = Array.from(reloaded.element.querySelectorAll<HTMLElement>(".sdk-object-list-card"));
    const secondCard = cards.find((card) => card.textContent?.includes("Smoke Suite"))!;
    expect(secondCard).toBeDefined();

    // Choose "save" -> saves Core Suite, clears draft dot, switches to Smoke Suite.
    platformShellMocks.confirmUnsavedSwitch.mockResolvedValueOnce("save");
    secondCard.click();

    await vi.waitFor(() => {
      expect(platformShellMocks.confirmUnsavedSwitch).toHaveBeenCalledTimes(1);
      expect(savedPayloads).toHaveLength(1);
      expect(savedPayloads[0]?.primaryKey).toBe("set-1");
      const currentQuestion = reloaded.element.querySelector<HTMLTextAreaElement>(
        '[data-testcase-field="question"] textarea, textarea[data-testcase-field="question"]',
      )!;
      expect(currentQuestion.value).toBe("Count active hosts?");
      expect(reloaded.element.querySelector(".sdk-object-list-draft-dot")).toBeNull();
    });
  });
});

describe("ops-dsl-console builtin panel (D6-4, D6-5, D6-6)", () => {
  it("renders pre-declared resultSections before execution, switches to raw tab on defaultSectionId='raw', and persists DSL draft", async () => {
    const defaultDsl = '{\n  "problem": "",\n  "answer": {\n    "steps": []\n  }\n}';
    const executeDescriptor: PanelOwnerOperationDescriptor = {
      kind: "action",
      handlerRef: EXECUTE_DSL_QUERY,
      label: "Execute DSL",
      effect: "read",
      target: { source: "draft", slot: "dslForm" },
      inputSchema: {},
      resultSchema: {},
      batch: false,
      resultSections: [
        { id: "table", label: "Data table", kind: "records", emptyText: "No data" },
        { id: "mql", label: "MQL Statement", kind: "code", language: "javascript", emptyText: "No MQL" },
        { id: "raw", label: "Raw response", kind: "json", emptyText: "No response" },
      ],
    };

    const errorResult: PanelReadOperationResult = {
      kind: "sections",
      defaultSectionId: "raw",
      sections: [
        { id: "table", label: "Data table", kind: "records", columns: [], rows: [], emptyText: "No data" },
        { id: "mql", label: "MQL Statement", kind: "code", language: "javascript", content: "", emptyText: "No MQL" },
        { id: "raw", label: "Raw response", kind: "json", value: { error: "Syntax error", dsl: { problem: "bad" } } },
      ],
    };

    const readHandler = (req: ProductPanelReadRequest) => {
      const slot = req.memberPath.at(-1)!.member;
      if ("operations" in req && req.operations) {
        if (slot === "executeDsl") {
          return Response.json({ status: "ready", value: { execute: executeDescriptor } });
        }
        return Response.json({ status: "ready", value: {} });
      }
      const dataName = "dataName" in req ? req.dataName : undefined;
      if (slot === "dslForm" && dataName === "form") {
        return Response.json({
          status: "ready",
          value: {
            values: { dsl: defaultDsl },
            fields: [
              {
                path: "/dsl",
                label: "DSL query",
                required: true,
                readOnly: false,
                valueSchema: { type: "string" },
                defaultValue: defaultDsl,
                control: { kind: "code", language: "json" },
              },
            ],
            errors: [],
            save: { method: "POST", path: "/panel-operations/read", bodySchema: {} },
          },
        });
      }
      return Response.json({ status: "ready", value: {} });
    };

    const readOpHandler = (sent: Sent) => {
      if (sent.path === "/api/panel-operations/descriptor") {
        return Response.json(executeDescriptor);
      }
      if (sent.path === "/api/panel-operations/read") {
        return Response.json(errorResult);
      }
      return undefined;
    };

    const first = await openBuiltPanel(dslUse, builtDsl, { read: readHandler, readOp: readOpHandler });

    // D6-5: Before executing, OperationResult renders all owner-declared tabs (including enterprise MQL) + empty state.
    await vi.waitFor(() => {
      const tabs = Array.from(first.element.querySelectorAll<HTMLElement>(".el-tabs__item"))
        .map((el) => el.textContent?.trim());
      expect(tabs).toEqual(["Data table", "MQL Statement", "Raw response"]);
      expect(first.element.textContent).toContain("No data");
    });

    // D6-4: Clicking Execute DSL when backend returns HTTP 2xx business error with defaultSectionId: "raw" focuses Raw response.
    const executeBtn = await vi.waitFor(() => {
      const btn = first.element.querySelector<HTMLButtonElement>(".ops-dsl-execute-slot button");
      expect(btn).not.toBeNull();
      expect(btn!.disabled).toBe(false);
      return btn!;
    });
    executeBtn.click();

    await vi.waitFor(() => {
      const activeTab = first.element.querySelector<HTMLElement>(".el-tabs__item.is-active");
      expect(activeTab?.textContent?.trim()).toBe("Raw response");
    });

    // D6-6: Clicking Clear sets /dsl to "" -> persists across reload through platform localDraftStore.
    const actionButtons = Array.from(first.element.querySelectorAll<HTMLButtonElement>(".ops-dsl-pane-actions > button"));
    const clearBtn = actionButtons[1];
    expect(clearBtn).toBeDefined();
    clearBtn!.click();

    await vi.waitFor(() => {
      expect(localStorage.length).toBeGreaterThan(0);
    });

    unmount?.();
    unmount = null;
    leaveFrame();

    const reloaded = await openBuiltPanel(dslUse, builtDsl, { read: readHandler, readOp: readOpHandler });
    await vi.waitFor(() => {
      const banner = reloaded.element.querySelector<HTMLElement>("[data-draft-banner]");
      expect(banner?.dataset.draftBanner).toBe("restored");
    });
  });
});
