import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type {
  FormFillOutcome,
  FormFillRequestInput,
  PageActionOutcome,
  PageActionRequestInput,
} from "@ontomato/contracts/agent-presentation";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import type { PageContext } from "@ontomato/contracts/page-context";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { panelAddress, type ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { APPLICATION, ROLE, USER, platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import source from "../../../../../packages/ontology-manager/resources/builtin-panels/application-detail/panel.json";
import html from "../../../../../packages/ontology-manager/resources/builtin-panels/application-detail/panel.html?raw";
import module from "../../../../../packages/ontology-manager/resources/builtin-panels/application-detail/panel.mjs?raw";
import {
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

const APP_ID = "ontology";
const ENTRY_PATH = "/ontology/applications/detail";
const AGENT_RUN = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  toolCallId: "tool-call-1",
};

const use = panelUse(
  "use-ontology-application-detail",
  "ontology-application-detail",
  "builtin-product-ontology-application-detail",
  ENTRY_PATH,
);

const objectTypes = Object.fromEntries(
  Object.entries(platformObjectTypes).map(([type, entry]) => [
    type,
    platformTypeTableEntrySchema.parse({
      ...entry,
      operations: entry.operations?.map((id) => {
        const form = id.endsWith(".save") || id.endsWith(".create");
        return {
          id,
          kind: form ? "form.save" : "action",
          effect: "write",
          batch: false,
          inputSchema: {},
          target: form ? { source: "draft" } : { source: "input", input: "target" },
        };
      }),
    }),
  ]),
);

const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(source.manifest);
const catalogue = components.map((component) =>
  appsSdkComponentCatalogEntrySchema.parse({
    ...component,
    ...(component.componentId === "OperationButton"
      ? { config: [{ name: "operation", type: "string", required: true, description: "Operation local name" }] }
      : {}),
    ports: { props: [], events: [], slots: [] },
  }),
);
const projections = new Map<string, ProductProjection>();
const members = Object.fromEntries(
  Object.entries(authoring).map(([name, definition]) => {
    if (!("component" in definition)) throw new Error(`Expected an authored projection for ${name}`);
    const { projection, placement } = expandPanelAuthoringMember(name, definition, {
      state: manifest.state,
      typeTable: { objectTypes },
      components: catalogue,
    });
    projections.set(definition.id!, {
      ...projection,
      id: definition.id!,
      name,
      description: name,
      visibility: "platform",
      domainId: null,
      ownerId: null,
      editable: false,
      revision: 1,
      createdAt: "2026-11-24T00:00:00Z",
      updatedAt: "2026-11-24T00:00:00Z",
    });
    return [name, { ...placement, target: { projectionId: definition.id! } }];
  }),
);

const detailPanel = {
  ...panelRecord(use.panelId, "Application detail", definePanel({ ...manifest, members })),
  visibility: "platform" as const,
  domainId: null,
  ownerId: null,
  editable: false as const,
  content: { html, module, messages: source.content.messages },
};

const appRef = (primaryKey: string) => ({ className: APPLICATION, primaryKey });

type DataReadRequest = Extract<ProductPanelReadRequest, { dataName: string }>;
type OpsReadRequest = Extract<ProductPanelReadRequest, { operations: true }>;

type PageControllerHandle = {
  applyState(patch: Readonly<Record<string, RuntimeJsonValue>>): void;
  fillForm?(request: FormFillRequestInput): Promise<FormFillOutcome>;
  executeAction?(request: PageActionRequestInput): Promise<PageActionOutcome>;
};

async function waitFor(check: () => boolean, label: string | (() => string)): Promise<void> {
  for (let i = 0; i < 120; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  const desc = typeof label === "function" ? label() : label;
  throw new Error(`Timed out waiting for: ${desc}`);
}

function entryFormDescription(entryId: string) {
  return {
    fields: [
      {
        path: "/label",
        label: "Menu label",
        required: true,
        readOnly: false,
        control: { kind: "text" },
        valueSchema: { type: "string" },
      },
    ],
    values: {
      label: entryId === "__new__" ? "" : `Entry ${entryId}`,
    },
    errors: [],
    revision: 1,
    save: {
      method: "PUT",
      path: "/applications/app-1",
      bodySchema: {},
    },
  };
}

function mountApplicationDetail(options: {
  initialState?: Record<string, unknown>;
  canMaintain?: boolean;
  canEditEntries?: boolean;
  canGrant?: boolean;
} = {}) {
  const reads: DataReadRequest[] = [];
  const opsReads: OpsReadRequest[] = [];
  const dispatchedIntents: string[] = [];
  const preparedIntents = new Map<string, Record<string, unknown>>();
  let intentSeq = 0;
  let controller: PageControllerHandle | null = null;
  let latestContext: PageContext | null = null;

  const canMaintain = options.canMaintain ?? true;
  const canEditEntries = options.canEditEntries ?? true;
  const canGrant = options.canGrant ?? true;

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: use.path, component: { template: "<div />" } }],
  });

  installPlatform((request: Sent) => {
    const { path } = request;
    if (path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
      return Response.json({
        data: { applicationId: APP_ID, entry: { path: "/ontology", renderer: "panels" }, panelUses: [use] },
      });
    }
    if (path === `/api/product-panels/${detailPanel.id}`) return panelAnswer(detailPanel, request);
    if (path === `/api/product-panels/${detailPanel.id}/snapshot`) {
      return panelSnapshot(detailPanel, Object.fromEntries(projections), request);
    }
    if (path.startsWith("/api/product-projections/")) {
      return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
    }
    if (path === "/api/panel-operations/intents") {
      intentSeq += 1;
      const body = request.body as { operationId?: string };
      const intentId = `7f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d0${intentSeq}`;
      const questionId = `9f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d0${intentSeq}`;
      const prepared = {
        intentId,
        questionId,
        autoMode: false,
        operationId: body.operationId ?? "applications.deleteEntry",
        label: "Delete entry",
        confirmation: {
          kind: "impact",
          impact: { summary: "Confirm deleting entry", total: 1, objects: [] },
        },
      };
      preparedIntents.set(intentId, prepared);
      return Response.json(prepared);
    }
    const readIntentMatch = /^\/api\/panel-operation-intents\/([^/]+)$/.exec(path);
    if (readIntentMatch) {
      const stored = preparedIntents.get(readIntentMatch[1]!);
      if (stored) return Response.json(stored);
    }
    const dispatchMatch = /^\/api\/panel-operations\/intents\/([^/]+)\/dispatch$/.exec(path);
    if (dispatchMatch) {
      const intentId = dispatchMatch[1]!;
      dispatchedIntents.push(intentId);
      return Response.json({
        kind: "dispatched",
        intentId,
        outcome: {
          kind: "success",
          message: "Deleted entry",
          data: {},
          affected: { objects: [{ objectType: APPLICATION, primaryKey: "app-1" }], objectTypes: [APPLICATION] },
        },
      });
    }
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      const member = body.memberPath[0]?.member;
      if ("operations" in body) {
        opsReads.push(body);
        if (member === "entriesList") {
          return Response.json({
            status: "ready",
            value: {
              deleteEntry: {
                kind: "action",
                handlerRef: "applications.deleteEntry",
                label: "Delete",
                effect: "write",
                target: { source: "input", input: "target" },
                inputSchema: {},
                resultSchema: {},
                batch: false,
              },
            },
          });
        }
        if (member === "entryForm" || member === "save") {
          return Response.json({
            status: "ready",
            value: {
              save: {
                kind: "form.save",
                handlerRef: `${APPLICATION}.save`,
                label: "Save",
                effect: "write",
                target: { source: "draft", slot: member },
                inputSchema: {},
                resultSchema: {},
                batch: false,
              },
            },
          });
        }
        if (member === "grantSubmit") {
          return Response.json({
            status: "ready",
            value: {
              grant: {
                kind: "action",
                handlerRef: "applications.grant",
                label: "Grant",
                effect: "write",
                target: { source: "input", input: "target" },
                inputSchema: {},
                resultSchema: {},
                batch: false,
              },
            },
          });
        }
        if (member === "grantsList") {
          return Response.json({
            status: "ready",
            value: {
              revoke: {
                kind: "action",
                handlerRef: "applications.grant",
                label: "Revoke",
                effect: "write",
                target: { source: "input", input: "target" },
                inputSchema: {},
                resultSchema: {},
                batch: false,
              },
            },
          });
        }
        return Response.json({ status: "ready", value: {} });
      }

      reads.push(body);
      if (body.dataName === "record") {
        return Response.json({
          status: "ready",
          value: {
            primaryKey: "app-1",
            className: APPLICATION,
            label: "Sample App",
            fields: { id: "app-1", domainShared: false },
            outputs: {
              canMaintain,
              canEditEntries,
              canGrant,
              domainShared: false,
              openPath: "/applications/app-1",
            },
          },
        });
      }
      if (member === "entriesList" && body.dataName === "rows") {
        return Response.json({
          status: "ready",
          value: [
            { primaryKey: "e-1", label: "Home", fields: { path: "/home", canEdit: canEditEntries } },
            { primaryKey: "e-2", label: "Settings", fields: { path: "/settings", canEdit: canEditEntries } },
          ],
          rowOperations: {
            "e-1": { deleteEntry: { available: canEditEntries } },
            "e-2": { deleteEntry: { available: canEditEntries } },
          },
        });
      }
      if (member === "entryForm" && body.dataName === "form") {
        const entryId = String(body.inputs.entryId ?? "");
        return Response.json({ status: "ready", value: entryFormDescription(entryId) });
      }
      if (member === "save" && body.dataName === "form") {
        return Response.json({ status: "ready", value: entryFormDescription("identity") });
      }
      if (member === "userPicker" && body.dataName === "options") {
        return Response.json({
          status: "ready",
          value: {
            options: [{ primaryKey: "user-1", value: { className: USER, primaryKey: "user-1" }, label: "Alice" }],
          },
        });
      }
      if (member === "rolePicker" && body.dataName === "options") {
        return Response.json({
          status: "ready",
          value: {
            options: [{ primaryKey: "role-1", value: { className: ROLE, primaryKey: "role-1" }, label: "Editor" }],
          },
        });
      }
      if (member === "grantsList" && body.dataName === "rows") {
        return Response.json({
          status: "ready",
          value: [
            {
              primaryKey: "grant-1",
              label: "Alice",
              fields: { principalKind: "principal", principalId: "user-1", verb: "use", revocable: true },
            },
          ],
        });
      }
      return Response.json({ status: "empty" });
    }
    return nothingAt(request);
  }, router);

  return {
    reads,
    opsReads,
    dispatchedIntents,
    controller: () => controller,
    context: () => latestContext,
    async open() {
      useApplicationCatalog().applications.value = [
        {
          id: APP_ID,
          kind: "product",
          names: { en: "Ontology" },
          descriptions: {},
          icon: "ontology",
          rail: "apps",
          category: "build",
          sort: 0,
          entry: { path: "/ontology", renderer: "panels" },
          entryAccess: ["domain-member"],
          scheduleAdapter: null,
          releaseId: null,
          panelUses: [use],
        },
      ];
      await router.push(
        panelAddress(
          use.path,
          options.initialState ?? { selected: appRef("app-1"), tab: "entries" },
          detailPanel.manifest,
        ),
      );
      const Host = defineComponent({
        setup() {
          return () =>
            h(PanelApplicationRoute, {
              applicationId: APP_ID,
              registerPageController(next: PageControllerHandle) {
                controller = next;
                return () => {
                  if (controller === next) controller = null;
                };
              },
              onContext(reported: PageContext) {
                latestContext = reported;
              },
            });
        },
      });
      return mountPlatformPage(() => h(Host), router);
    },
  };
}

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("application-detail tab mount retention and dialog/permission unmounting", () => {
  it("mounts tabs lazily on first visit, then keeps entriesList mounted across entries -> identity -> entries switches via v-show and preserves pending delete confirmation", async () => {
    const harness = mountApplicationDetail({
      initialState: { selected: appRef("app-1"), tab: "entries" },
      canMaintain: true,
      canEditEntries: true,
      canGrant: true,
    });
    const mounted = await harness.open();
    try {
      await waitFor(
        () =>
          mounted.element.querySelector('[data-tab="entries"]')?.textContent?.includes("Home") === true
          && mounted.element.querySelector('[data-tab="entries"]')?.textContent?.includes("Settings") === true
          && harness.controller() !== null,
        "entries tab ready",
      );

      // Initially only the active entries tab is mounted; unvisited tabs do not mount or fire reads eagerly.
      const entriesPanel = mounted.element.querySelector('[data-tab="entries"]') as HTMLElement | null;
      expect(entriesPanel).not.toBeNull();
      expect(entriesPanel!.style.display).not.toBe("none");
      expect(mounted.element.querySelector('[data-tab="identity"]')).toBeNull();
      expect(mounted.element.querySelector('[data-tab="assets"]')).toBeNull();
      expect(mounted.element.querySelector('[data-tab="grants"]')).toBeNull();
      expect(harness.reads.some((r) => r.memberPath[0]?.member === "save")).toBe(false);
      expect(harness.reads.some((r) => r.memberPath[0]?.member === "usedPanelsList")).toBe(false);
      expect(harness.reads.some((r) => r.memberPath[0]?.member === "grantsList")).toBe(false);

      const entriesListEl = entriesPanel!.querySelector(".sdk-object-list") as HTMLElement | null;
      expect(entriesListEl).not.toBeNull();

      // Request deleting an entry from the agent, yielding a pending confirmation.
      const pendingDelete = await harness.controller()!.executeAction!({
        operation: "entriesList.deleteEntry",
        rowKey: "e-1",
        agentRun: AGENT_RUN,
      });
      if (!pendingDelete.ok || pendingDelete.kind !== "awaiting_confirmation") {
        throw new Error(`Expected entriesList.deleteEntry to await confirmation, got: ${JSON.stringify(pendingDelete)}`);
      }

      // Switch tab: entries -> identity. identity mounts on demand while entriesList remains mounted as the exact same DOM node with display: none.
      harness.controller()!.applyState({ tab: "identity" });
      await waitFor(
        () => {
          const idPanel = mounted.element.querySelector('[data-tab="identity"]') as HTMLElement | null;
          return idPanel !== null && idPanel.style.display !== "none" && entriesPanel!.style.display === "none";
        },
        "switched to identity tab",
      );
      const identityPanel = mounted.element.querySelector('[data-tab="identity"]') as HTMLElement;
      expect(mounted.element.contains(entriesListEl!)).toBe(true);
      expect(entriesPanel!.querySelector(".sdk-object-list")).toBe(entriesListEl);

      // Switch tab back: identity -> entries. Same DOM node becomes visible again and pending confirmation dispatches cleanly.
      harness.controller()!.applyState({ tab: "entries" });
      await waitFor(
        () => entriesPanel!.style.display !== "none" && identityPanel.style.display === "none",
        "switched back to entries tab",
      );
      expect(entriesPanel!.querySelector(".sdk-object-list")).toBe(entriesListEl);

      const confirmed = await pendingDelete.confirmation.dispatch();
      expect(confirmed).toMatchObject({
        ok: true,
        intentId: pendingDelete.intentId,
      });
      expect(harness.dispatchedIntents).toEqual([pendingDelete.intentId]);
    } finally {
      mounted.app.unmount();
    }
  });

  it("unmounts entryForm via v-if when entry dialog is closed, mounts on open, and unmounts again on close", async () => {
    const harness = mountApplicationDetail({
      initialState: { selected: appRef("app-1"), tab: "entries" },
      canMaintain: true,
      canEditEntries: true,
      canGrant: true,
    });
    const mounted = await harness.open();
    try {
      await waitFor(
        () =>
          mounted.element.querySelector('[data-tab="entries"]')?.textContent?.includes("Home") === true
          && harness.controller() !== null,
        "entries tab ready",
      );

      // 1. Dialog closed initially: entryForm is completely unmounted and unreachable.
      expect(harness.reads.some((r) => r.memberPath[0]?.member === "entryForm")).toBe(false);
      expect(harness.context()?.forms?.some((f) => f.member === "entryForm") ?? false).toBe(false);
      expect(await harness.controller()!.fillForm!({ member: "entryForm", values: { "/label": "Blocked" } })).toMatchObject({
        ok: false,
        reason: "form_not_found",
      });
      expect(await harness.controller()!.executeAction!({ operation: "entryForm.save", agentRun: AGENT_RUN })).toMatchObject({
        ok: false,
        reason: "action_not_found",
      });

      // 2. Open entry dialog (edit existing entry): entryForm mounts and registers.
      harness.controller()!.applyState({ editingEntryId: "e-1" });
      await waitFor(
        () =>
          harness.reads.some((r) => r.memberPath[0]?.member === "entryForm")
          && (harness.context()?.forms?.some((f) => f.member === "entryForm") ?? false),
        "entryForm mounted on dialog open",
      );

      const filled = await harness.controller()!.fillForm!({
        member: "entryForm",
        values: { "/label": "Updated Home" },
      });
      expect(filled).toMatchObject({ ok: true, filledFields: ["/label"] });

      // 3. Close entry dialog: entryForm unmounts completely again.
      harness.controller()!.applyState({ editingEntryId: null });
      await waitFor(
        () => !(harness.context()?.forms?.some((f) => f.member === "entryForm") ?? false),
        "entryForm unmounted on dialog close",
      );
      expect(await harness.controller()!.fillForm!({ member: "entryForm", values: { "/label": "Stale" } })).toMatchObject({
        ok: false,
        reason: "form_not_found",
      });
      expect(await harness.controller()!.executeAction!({ operation: "entryForm.save", agentRun: AGENT_RUN })).toMatchObject({
        ok: false,
        reason: "action_not_found",
      });
    } finally {
      mounted.app.unmount();
    }
  });

  it("unmounts grantSubmit, userPicker, and rolePicker when grant dialog is closed and unmounts grants tab & dialog without canGrant", async () => {
    // Part A: with canGrant = true, grants tab is mounted, but grant dialog projections stay unmounted until opened.
    const allowedHarness = mountApplicationDetail({
      initialState: { selected: appRef("app-1"), tab: "grants" },
      canMaintain: true,
      canEditEntries: true,
      canGrant: true,
    });
    const allowedMounted = await allowedHarness.open();
    try {
      await waitFor(
        () =>
          allowedMounted.element.querySelector('[data-tab="grants"]')?.textContent?.includes("Alice") === true
          && allowedHarness.controller() !== null,
        "grants tab ready when canGrant is true",
      );

      const grantsPanel = allowedMounted.element.querySelector('[data-tab="grants"]') as HTMLElement | null;
      expect(grantsPanel).not.toBeNull();
      expect(grantsPanel!.style.display).not.toBe("none");

      // Dialog closed: grantSubmit, userPicker, and rolePicker are not mounted or exposed.
      expect(allowedHarness.reads.some((r) => r.memberPath[0]?.member === "userPicker")).toBe(false);
      expect(allowedHarness.reads.some((r) => r.memberPath[0]?.member === "rolePicker")).toBe(false);
      expect(document.body.querySelector(".apps-dialog-footer")).toBeNull();
      expect(
        await allowedHarness.controller()!.executeAction!({ operation: "grantSubmit.grant", agentRun: AGENT_RUN }),
      ).toMatchObject({
        ok: false,
        reason: "action_not_found",
      });

      // Open grant dialog: userPicker and grantSubmit mount; switching to role mounts rolePicker.
      const addGrantBtn = Array.from(grantsPanel!.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
        b.textContent?.includes("Add grant"),
      );
      expect(addGrantBtn).toBeTruthy();
      addGrantBtn!.click();

      await waitFor(
        () =>
          allowedHarness.reads.some((r) => r.memberPath[0]?.member === "userPicker")
          && document.body.querySelector(".apps-dialog-footer") !== null,
        "grant dialog mounted userPicker and grantSubmit on open",
      );
      expect(allowedHarness.reads.some((r) => r.memberPath[0]?.member === "rolePicker")).toBe(false);

      // While open with a selected principal, grantSubmit is mounted and live (awaiting confirmation, NOT action_not_found).
      allowedHarness.controller()!.applyState({
        grantUser: { className: USER, primaryKey: "user-1" },
      });
      await waitFor(() => {
        const buttons = Array.from(document.body.querySelectorAll<HTMLButtonElement>(".apps-dialog-footer button"));
        const submitBtn = buttons.find((b) => b.textContent?.includes("Grant"));
        return Boolean(submitBtn && !submitBtn.disabled);
      }, "grantSubmit button enabled once grantPrincipalId syncs");
      const openGrant = await allowedHarness.controller()!.executeAction!({
        operation: "grantSubmit.grant",
        agentRun: AGENT_RUN,
      });
      expect(openGrant).toMatchObject({
        ok: true,
        kind: "awaiting_confirmation",
        operation: "grantSubmit.grant",
      });

      allowedHarness.controller()!.applyState({ grantPrincipalKind: "role" });
      await waitFor(
        () => allowedHarness.reads.some((r) => r.memberPath[0]?.member === "rolePicker"),
        "rolePicker mounted when grantPrincipalKind switches to role",
      );

      // Close grant dialog: footer & projections unmount immediately and grantSubmit is no longer exposed.
      allowedHarness.controller()!.applyState({ grantDialog: null });
      await waitFor(
        () => document.body.querySelector(".apps-dialog-footer") === null,
        "grant dialog footer unmounted on close",
      );
      expect(
        await allowedHarness.controller()!.executeAction!({ operation: "grantSubmit.grant", agentRun: AGENT_RUN }),
      ).toMatchObject({
        ok: false,
        reason: "action_not_found",
      });
    } finally {
      allowedMounted.app.unmount();
    }

    leaveFrame();
    useApplicationCatalog().applications.value = [];
    document.body.innerHTML = "";

    // Part B: with canGrant = false, grants tab and grant dialog are never mounted even if state asks for them.
    const deniedHarness = mountApplicationDetail({
      initialState: { selected: appRef("app-1"), tab: "grants", grantDialog: true },
      canMaintain: true,
      canEditEntries: true,
      canGrant: false,
    });
    const deniedMounted = await deniedHarness.open();
    try {
      await waitFor(
        () =>
          deniedMounted.element.querySelector('[data-tab="identity"]') !== null
          && deniedHarness.controller() !== null,
        "panel ready when canGrant is false",
      );

      const identityPanel = deniedMounted.element.querySelector('[data-tab="identity"]') as HTMLElement;
      await waitFor(
        () => identityPanel.style.display !== "none",
        "falls back to identity tab when canGrant is false",
      );

      expect(deniedMounted.element.querySelector('[data-tab="grants"]')).toBeNull();
      expect(document.body.querySelector(".apps-dialog-footer")).toBeNull();
      expect(deniedHarness.reads.some((r) => r.memberPath[0]?.member === "grantsList")).toBe(false);
      expect(deniedHarness.reads.some((r) => r.memberPath[0]?.member === "shareStatusDesc")).toBe(false);
      expect(deniedHarness.reads.some((r) => r.memberPath[0]?.member === "userPicker")).toBe(false);
      expect(deniedHarness.reads.some((r) => r.memberPath[0]?.member === "rolePicker")).toBe(false);
      expect(
        await deniedHarness.controller()!.executeAction!({ operation: "grantSubmit.grant", agentRun: AGENT_RUN }),
      ).toMatchObject({
        ok: false,
        reason: "action_not_found",
      });
      expect(
        await deniedHarness.controller()!.executeAction!({ operation: "shareEnable.share", agentRun: AGENT_RUN }),
      ).toMatchObject({
        ok: false,
        reason: "action_not_found",
      });
      expect(
        await deniedHarness.controller()!.executeAction!({ operation: "shareDisable.share", agentRun: AGENT_RUN }),
      ).toMatchObject({
        ok: false,
        reason: "action_not_found",
      });
      expect(
        await deniedHarness.controller()!.executeAction!({
          operation: "grantsList.revoke",
          rowKey: "grant-1",
          agentRun: AGENT_RUN,
        }),
      ).toMatchObject({
        ok: false,
        reason: "action_not_found",
      });
    } finally {
      deniedMounted.app.unmount();
    }
  });
});
