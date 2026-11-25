import { afterEach, describe, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import { currentPanelRecordSchema, type ProductProjection } from "@ontomato/contracts/product-panels";
import {
  AUTOTEST_CASE_ARTIFACT,
  AUTOTEST_RUN,
  BUILD_TURN_EVIDENCE,
  DOWNLOAD_AUTOTEST_RUN,
  DOWNLOAD_TURN_EVIDENCE,
  OPS_KNOWLEDGE,
  TURN_EVIDENCE,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import knowledgeSource from "../../../../../packages/platform-admin/resources/builtin-panels/ops-knowledge/panel.json";
import knowledgeHtml from "../../../../../packages/platform-admin/resources/builtin-panels/ops-knowledge/panel.html?raw";
import knowledgeModule from "../../../../../packages/platform-admin/resources/builtin-panels/ops-knowledge/panel.mjs?raw";
import turnSource from "../../../../../packages/platform-admin/resources/builtin-panels/ops-turn-evidence/panel.json";
import turnHtml from "../../../../../packages/platform-admin/resources/builtin-panels/ops-turn-evidence/panel.html?raw";
import turnModule from "../../../../../packages/platform-admin/resources/builtin-panels/ops-turn-evidence/panel.mjs?raw";
import resultsSource from "../../../../../packages/platform-admin/resources/builtin-panels/ops-autotest-results/panel.json";
import resultsHtml from "../../../../../packages/platform-admin/resources/builtin-panels/ops-autotest-results/panel.html?raw";
import resultsModule from "../../../../../packages/platform-admin/resources/builtin-panels/ops-autotest-results/panel.mjs?raw";
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

const appId = "operations";
const knowledgeUse = panelUse("ops-knowledge", "ops-knowledge", "builtin-product-ops-knowledge", "/ops/knowledge");
const turnUse = panelUse("ops-turn-evidence", "ops-turn-evidence", "builtin-product-ops-turn-evidence", "/ops/turn");
const resultsUse = panelUse("ops-autotest-results", "ops-autotest-results", "builtin-product-ops-autotest-results", "/ops/results");

const TARGETLESS_OPS = new Set([BUILD_TURN_EVIDENCE]);
const READ_OPS = new Set([DOWNLOAD_TURN_EVIDENCE, DOWNLOAD_AUTOTEST_RUN]);

const objectTypes = Object.fromEntries(
  Object.entries(platformObjectTypes).map(([type, entry]) => [
    type,
    platformTypeTableEntrySchema.parse({
      ...entry,
      operations: entry.operations?.map((id) => ({
        id,
        kind: "action",
        effect: READ_OPS.has(id) ? "read" : "write",
        batch: false,
        inputSchema: id === BUILD_TURN_EVIDENCE
          ? {
              type: "object",
              properties: { turnKey: { type: "string", minLength: 1 } },
              required: ["turnKey"],
              additionalProperties: false,
            }
          : {},
        target: TARGETLESS_OPS.has(id) ? { source: "none" } : { source: "input", input: "target" },
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
  source: typeof knowledgeSource | typeof turnSource | typeof resultsSource,
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

const builtKnowledge = buildPanel(knowledgeUse.panelId, "Operations knowledge", knowledgeSource, knowledgeHtml, knowledgeModule);
const builtTurn = buildPanel(turnUse.panelId, "Turn evidence", turnSource, turnHtml, turnModule);
const builtResults = buildPanel(resultsUse.panelId, "Test results", resultsSource, resultsHtml, resultsModule);

let unmount: (() => void) | null = null;

afterEach(() => {
  vi.useRealTimers();
  unmount?.();
  unmount = null;
  leaveFrame();
  window.dispatchEvent(new Event("pageshow"));
  useApplicationCatalog().applications.value = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function openBuiltPanel(
  use: typeof knowledgeUse | typeof turnUse | typeof resultsUse,
  built: ReturnType<typeof buildPanel>,
  handlers: {
    read: (request: ProductPanelReadRequest) => Response;
    intents?: (request: Sent) => Response | undefined;
    initialPath?: string;
  },
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        component: { render: () => h(RouterView) },
        children: [
          { path: knowledgeUse.path, component: PanelApplicationRoute, props: { applicationId: appId } },
          { path: turnUse.path, component: PanelApplicationRoute, props: { applicationId: appId } },
          { path: resultsUse.path, component: PanelApplicationRoute, props: { applicationId: appId } },
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
          sort: 30,
          entry: { path: "/ops/knowledge", renderer: "operations" },
          names: { en: "Operations diagnosis" },
          descriptions: {},
          icon: "activity",
          panelUses: [knowledgeUse, turnUse, resultsUse],
        }],
      });
    }
    if (path === "/api/product-panels/application-entry") {
      return Response.json({
        applicationId: appId,
        use,
        menu: { singleEntry: false, groups: [], panelUses: [knowledgeUse, turnUse, resultsUse] },
      });
    }
    if (path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
      return Response.json({
        data: {
          applicationId: appId,
          entry: { path: "/ops/knowledge", renderer: "operations" },
          panelUses: [knowledgeUse, turnUse, resultsUse],
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
    sort: 30,
    entry: { path: "/ops/knowledge", renderer: "operations" },
    scheduleAdapter: null,
    releaseId: null,
    names: { en: "Operations diagnosis" },
    descriptions: {},
    icon: "activity",
    panelUses: [knowledgeUse, turnUse, resultsUse],
  }];

  await router.push(handlers.initialPath ?? use.path);
  await router.isReady();
  const mounted = mountPlatformPage(() => h(RouterView), router);
  unmount = () => {
    mounted.app.unmount();
    mounted.element.remove();
  };
  return { root: mounted.element, router, readCalls };
}

describe("E3-A Category 2 Pack A built-in panels", () => {
  it("D1-3 (ops-knowledge): opens directory index.md on folder click and clears selection for folders without index.md", async () => {
    const docs: Record<string, { title: string; content: string }> = {
      "index.md": { title: "Knowledge Home", content: "# Knowledge Home\n\nRoot overview." },
      "guides/index.md": { title: "Guides Overview", content: "# Guides Overview\n\nDirectory index body." },
      "guides/logs.md": { title: "Logs Guide", content: "# Logs Guide\n\nInspect logs." },
      "notes/todo.md": { title: "Todo Notes", content: "# Todo Notes\n\nPending tasks." },
    };

    const { root } = await openBuiltPanel(knowledgeUse, builtKnowledge, {
      read(req) {
        if ("operations" in req) return Response.json({ status: "ready", value: {} });
        if (req.dataName === "files") {
          return Response.json({
            status: "ready",
            value: Object.keys(docs).map((filePath) => ({
              className: OPS_KNOWLEDGE,
              primaryKey: filePath,
              label: filePath.split("/").pop() ?? filePath,
              fields: { path: filePath, name: filePath.split("/").pop() ?? filePath },
            })),
          });
        }
        const requestedPath = String(req.inputs.path ?? "");
        const doc = docs[requestedPath];
        if (!doc) return Response.json({ status: "error", message: "Not found" });
        return Response.json({
          status: "ready",
          value: {
            className: OPS_KNOWLEDGE,
            primaryKey: requestedPath,
            label: doc.title,
            subtitle: requestedPath,
            fields: {
              path: requestedPath,
              title: doc.title,
              content: doc.content,
              updatedAt: "2026-11-25T10:00:00.000Z",
            },
          },
        });
      },
    });

    await vi.waitFor(() => {
      expect(root.textContent).toContain("Knowledge Home");
      expect(root.querySelector('[data-path="guides"] > button')).not.toBeNull();
    });

    // Clicking folder with direct child index.md opens guides/index.md and keeps folder expanded.
    const guidesFolder = root.querySelector<HTMLElement>('[data-path="guides"]')!;
    const guidesBtn = root.querySelector<HTMLButtonElement>('[data-path="guides"] > button')!;
    guidesBtn.click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain("Guides Overview");
      expect(root.textContent).toContain("Directory index body.");
      expect(guidesFolder.getAttribute("aria-expanded")).toBe("true");
    });

    // Clicking folder without index.md toggles it and clears the reader to empty state.
    const notesFolder = root.querySelector<HTMLElement>('[data-path="notes"]')!;
    const notesBtn = root.querySelector<HTMLButtonElement>('[data-path="notes"] > button')!;
    notesBtn.click();
    await vi.waitFor(() => {
      expect(notesFolder.getAttribute("aria-expanded")).toBe("false");
      expect(root.querySelector(".ops-knowledge-empty")).not.toBeNull();
    });
  });

  it("D2-1 (ops-turn-evidence): selects existing turn on Enter, invokes turnEvidence.build on miss, and has no temporary buildTurn toolbar", async () => {
    const turns = new Map<string, { question: string; status: string }>([
      ["turn.threadA.1", { question: "Existing turn question", status: "ready" }],
    ]);
    const builtCalls: Array<Record<string, unknown>> = [];

    const intents = humanIntents(
      (operationId, call) => {
        const input = (call.input ?? {}) as { turnKey?: string };
        builtCalls.push({ operationId, ...input });
        const turnKey = String(input.turnKey ?? "");
        turns.set(turnKey, { question: `Collected ${turnKey}`, status: "ready" });
        return {
          kind: "success",
          message: `Collected ${turnKey}`,
          data: { turnKey },
          created: { objectType: TURN_EVIDENCE, primaryKey: turnKey },
          affected: {
            objects: [{ objectType: TURN_EVIDENCE, primaryKey: turnKey }],
            objectTypes: [TURN_EVIDENCE],
          },
        };
      },
      { source: "input", input: "target" },
      {
        admitted(member) {
          if (member !== "turns") return {};
          return {
            build: {
              kind: "action",
              handlerRef: BUILD_TURN_EVIDENCE,
              label: "Collect turn evidence",
              effect: "write",
              target: { source: "none" },
              inputSchema: {
                type: "object",
                properties: { turnKey: { type: "string", minLength: 1 } },
                required: ["turnKey"],
                additionalProperties: false,
              },
              resultSchema: { type: "object" },
              batch: false,
            },
          };
        },
      },
    );

    const { root } = await openBuiltPanel(turnUse, builtTurn, {
      intents,
      read(req) {
        if ("operations" in req) {
          return Response.json({
            status: "ready",
            value: {
              build: {
                kind: "action",
                handlerRef: BUILD_TURN_EVIDENCE,
                label: "Collect turn evidence",
                effect: "write",
                target: { source: "none" },
                inputSchema: {
                  type: "object",
                  properties: { turnKey: { type: "string", minLength: 1 } },
                  required: ["turnKey"],
                  additionalProperties: false,
                },
                resultSchema: { type: "object" },
                batch: false,
              },
            },
          });
        }
        if (req.dataName === "rows") {
          const search = typeof req.inputs.search === "string" ? req.inputs.search.trim().toLowerCase() : "";
          const list = [...turns.entries()]
            .filter(([key, item]) => !search || key.toLowerCase().includes(search) || item.question.toLowerCase().includes(search))
            .map(([key, item]) => ({
              className: TURN_EVIDENCE,
              primaryKey: key,
              label: item.question,
              subtitle: key,
              fields: {
                turnKey: key,
                question: item.question,
                status: item.status,
                statusLabel: "Ready",
                kept: false,
              },
              tones: { statusLabel: "success" },
            }));
          return Response.json(list.length ? { status: "ready", value: list } : { status: "empty" });
        }
        if (req.dataName === "record") {
          const ref = req.inputs.target as { primaryKey?: string } | undefined;
          const key = ref?.primaryKey ?? "";
          const item = turns.get(key);
          if (!item) return Response.json({ status: "error", message: "Not found" });
          return Response.json({
            status: "ready",
            value: {
              className: TURN_EVIDENCE,
              primaryKey: key,
              label: item.question,
              subtitle: key,
              fields: {
                turnKey: key,
                question: item.question,
                status: item.status,
                statusLabel: "Ready",
                kept: false,
                hasEvidence: true,
                evidenceHint: "",
                evidenceJson: "{}",
              },
              outputs: { status: item.status, kept: false, hasEvidence: true },
            },
          });
        }
        return Response.json({ status: "empty" });
      },
    });

    await vi.waitFor(() => {
      expect(root.querySelector("input.sdk-object-list-search")).not.toBeNull();
      expect(root.textContent).toContain("Existing turn question");
    });

    // Temporary buildTurn toolbar has been removed.
    expect(root.querySelector(".ops-turn-toolbar")).toBeNull();

    const searchInput = root.querySelector<HTMLInputElement>("input.sdk-object-list-search")!;

    // 1. Existing Turn Key on Enter selects directly without triggering turnEvidence.build.
    searchInput.value = "turn.threadA.1";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
    searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await vi.waitFor(() => {
      expect(root.querySelector(".ops-turn-detail-stack")).not.toBeNull();
      expect(searchInput.value).toBe("");
    });
    expect(builtCalls).toHaveLength(0);

    // 2. Missing Turn Key on Enter triggers turnEvidence.build and selects the created Turn.
    searchInput.value = "turn.threadB.42";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
    searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await vi.waitFor(() => {
      expect(builtCalls).toEqual([{ operationId: "turns.build", turnKey: "turn.threadB.42" }]);
      expect(root.textContent).toContain("Collected turn.threadB.42");
      expect(searchInput.value).toBe("");
    });
  });

  it("D3-4 & D3-5 (ops-autotest-results): highlights wrong/abnormal rows by verdict code, rereads active runs every 5s, and syncs list when settled", async () => {
    expect(resultsModule).not.toMatch(/\b(setInterval|setTimeout)\b/);

    vi.useFakeTimers({ shouldAdvanceTime: true });

    let runPhase: "running" | "completed" = "running";
    let recordReads = 0;
    let resultsReads = 0;
    let listReads = 0;

    const runId = "run-live-1";

    async function flush() {
      for (let i = 0; i < 12; i += 1) {
        await Promise.resolve();
      }
      await nextTick();
    }

    const { root } = await openBuiltPanel(resultsUse, builtResults, {
      read(req) {
        if ("operations" in req) return Response.json({ status: "ready", value: {} });

        const isActive = runPhase === "running";
        const directive = isActive ? { rereadAfterMs: 5000 } : {};

        if (req.dataName === "rows" && !req.inputs.target) {
          listReads += 1;
          return Response.json({
            status: "ready",
            ...directive,
            value: [{
              className: AUTOTEST_RUN,
              primaryKey: runId,
              label: "Smoke suite",
              subtitle: runId,
              fields: {
                runId,
                caseSetName: "Smoke suite",
                status: runPhase,
                statusLabel: isActive ? "运行中" : "已完成",
                active: isActive,
                kept: false,
                summaryLine: isActive ? "1/3" : "3/3",
              },
              tones: { statusLabel: isActive ? "info" : "success" },
            }],
          });
        }

        if (req.dataName === "record") {
          recordReads += 1;
          return Response.json({
            status: "ready",
            ...directive,
            value: {
              className: AUTOTEST_RUN,
              primaryKey: runId,
              label: "Smoke suite",
              subtitle: runId,
              fields: {
                runId,
                caseSetName: "Smoke suite",
                status: runPhase,
                statusLabel: isActive ? "运行中" : "已完成",
                active: isActive,
                kept: false,
                total: 3,
                correct: 1,
                wrong: 1,
                abnormal: 1,
                accuracyRate: "50.0%",
                avgDuration: "1.2s",
              },
              tones: { statusLabel: isActive ? "info" : "success" },
              outputs: { status: runPhase, active: isActive, kept: false },
            },
          });
        }

        if (req.dataName === "rows" && req.inputs.target) {
          resultsReads += 1;
          return Response.json({
            status: "ready",
            ...directive,
            value: [
              {
                className: AUTOTEST_CASE_ARTIFACT,
                primaryKey: `${runId}::c1`,
                label: "c1",
                fields: {
                  caseId: "c1",
                  question: "Passed question",
                  status: "success",
                  statusLabel: "成功",
                  verdict: "correct",
                  verdictLabel: "正确",
                  reason: "",
                  durationText: "1.0s",
                },
                tones: { statusLabel: "success", verdictLabel: "success" },
              },
              {
                className: AUTOTEST_CASE_ARTIFACT,
                primaryKey: `${runId}::c2`,
                label: "c2",
                fields: {
                  caseId: "c2",
                  question: "Wrong question",
                  status: "success",
                  statusLabel: "成功",
                  verdict: "wrong",
                  verdictLabel: "错误",
                  reason: "Expected 10",
                  durationText: "1.2s",
                },
                tones: { statusLabel: "success", verdictLabel: "danger" },
              },
              {
                className: AUTOTEST_CASE_ARTIFACT,
                primaryKey: `${runId}::c3`,
                label: "c3",
                fields: {
                  caseId: "c3",
                  question: "Abnormal question",
                  status: "error",
                  statusLabel: "异常",
                  verdict: "abnormal",
                  verdictLabel: "异常",
                  reason: "Timeout",
                  durationText: "1.4s",
                },
                tones: { statusLabel: "danger", verdictLabel: "warning" },
              },
            ],
          });
        }

        return Response.json({ status: "empty" });
      },
    });

    await vi.waitFor(() => {
      expect(root.querySelectorAll("tr[data-row-item='true']").length).toBe(3);
      expect(root.querySelector(".ops-results-banner-wrap")).not.toBeNull();
    });

    // D3-4: verify whole-row semantic tone classes use stable verdict field ("wrong" -> danger, "abnormal" -> warning).
    const rows = Array.from(root.querySelectorAll<HTMLTableRowElement>("tr[data-row-item='true']"));
    expect(rows[0]!.classList.contains("is-tone-danger")).toBe(false);
    expect(rows[0]!.classList.contains("is-tone-warning")).toBe(false);
    expect(rows[0]!.classList.contains("is-tone-success")).toBe(false);
    expect(rows[1]!.classList.contains("is-tone-danger")).toBe(true);
    expect(rows[2]!.classList.contains("is-tone-warning")).toBe(true);

    // Active notice reflects automatic 5s refresh (not manual-only).
    expect(root.querySelector(".ops-results-banner-wrap")?.textContent).toContain("5 seconds");

    const initialRecordReads = recordReads;
    const initialResultsReads = resultsReads;
    const initialListReads = listReads;

    // D3-5: advancing 5s triggers silent platform reread while active.
    await vi.advanceTimersByTimeAsync(5100);
    await flush();
    expect(recordReads).toBeGreaterThan(initialRecordReads);
    expect(resultsReads).toBeGreaterThan(initialResultsReads);
    expect(listReads).toBeGreaterThan(initialListReads);

    // Transition run to completed: next 5s reread settles active -> false, hides banner, and syncs left list.
    runPhase = "completed";
    await vi.advanceTimersByTimeAsync(5100);
    await flush();
    expect(root.querySelector(".ops-results-banner-wrap")).toBeNull();
    expect(root.querySelector(".ops-results-aside")?.textContent).toContain("已完成");

    // Once settled, no further automatic rereads are scheduled.
    const settledRecordReads = recordReads;
    const settledResultsReads = resultsReads;
    const settledListReads = listReads;
    await vi.advanceTimersByTimeAsync(15_000);
    await flush();
    expect(recordReads).toBe(settledRecordReads);
    expect(resultsReads).toBe(settledResultsReads);
    expect(listReads).toBe(settledListReads);
  });
});
