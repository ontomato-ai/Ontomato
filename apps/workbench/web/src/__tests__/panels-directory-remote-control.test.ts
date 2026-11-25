import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type { PresentationFrame } from "@ontomato/contracts/agent-presentation";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel, type PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import {
  APPLICATION,
  PRODUCT_PANEL,
  PRODUCT_PROJECTION,
  USER,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { useConversationDisplay } from "../../../../../packages/agent-shell-ui/src/conversation-display";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import catalogSource from "../../../../../packages/ontology-manager/resources/builtin-panels/panels/panel.json";
import catalogHtml from "../../../../../packages/ontology-manager/resources/builtin-panels/panels/panel.html?raw";
import catalogModule from "../../../../../packages/ontology-manager/resources/builtin-panels/panels/panel.mjs?raw";
import detailSource from "../../../../../packages/ontology-manager/resources/builtin-panels/panel-detail/panel.json";
import detailHtml from "../../../../../packages/ontology-manager/resources/builtin-panels/panel-detail/panel.html?raw";
import detailModule from "../../../../../packages/ontology-manager/resources/builtin-panels/panel-detail/panel.mjs?raw";
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

const SESSION = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const APP_ID = "ontology";
const CATALOG_PATH = "/ontology/panels";
const DETAIL_PATH = "/ontology/panels/detail";
const OPEN_EDIT_KEY_PREFIX = "ontomato:open-edit:builtin-product-ontology-panel-detail:";

const catalogUse = panelUse(
  "use-ontology-panels",
  "ontology-panels",
  "builtin-product-ontology-panels",
  CATALOG_PATH,
);

const detailUse = panelUse(
  "use-ontology-panel-detail",
  "ontology-panel-detail",
  "builtin-product-ontology-panel-detail",
  DETAIL_PATH,
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

const catalogue = components.map((component) =>
  appsSdkComponentCatalogEntrySchema.parse({
    ...component,
    ...(component.componentId === "FileUploadControl" || component.componentId === "OperationButton"
      ? { config: [{ name: "operation", type: "string", required: true, description: "Operation local name" }] }
      : {}),
    ports: { props: [], events: [], slots: [] },
  }),
);

function buildPanelFixture(
  id: string,
  name: string,
  source: { manifest: unknown; content: { messages: Record<string, Record<string, string>> } },
  html: string,
  module: string,
) {
  const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(source.manifest);
  const projections = new Map<string, ProductProjection>();
  const members = Object.fromEntries(
    Object.entries(authoring).map(([memberName, definition]) => {
      if (!("component" in definition)) {
        return [memberName, definition];
      }
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
        createdAt: "2026-11-23T00:00:00Z",
        updatedAt: "2026-11-23T00:00:00Z",
      });
      return [memberName, { ...placement, target: { projectionId: definition.id! } }];
    }),
  );

  const panel = {
    ...panelRecord(id, name, definePanel({ ...manifest, members })),
    visibility: "platform" as const,
    domainId: null,
    ownerId: null,
    editable: false as const,
    content: { html, module, messages: source.content.messages },
  };
  return { panel, projections };
}

const catalogFixture = buildPanelFixture(
  catalogUse.panelId,
  "Panels",
  catalogSource,
  catalogHtml,
  catalogModule,
);

const detailFixture = buildPanelFixture(
  detailUse.panelId,
  "Panel detail",
  detailSource,
  detailHtml,
  detailModule,
);

const allProjections = new Map<string, ProductProjection>([
  ...catalogFixture.projections,
  ...detailFixture.projections,
]);

const panelRef = (primaryKey: string) => ({ className: PRODUCT_PANEL, primaryKey });

function presentFrame(state: Record<string, unknown>, address = DETAIL_PATH): PresentationFrame {
  return {
    type: "presentation",
    sessionId: SESSION,
    runId: RUN,
    toolCallId: `call-${Math.random()}`,
    target: {
      kind: "page",
      address,
      state: state as PresentationFrame["target"] extends { state?: infer S } ? S : never,
    },
  };
}

type DataReadRequest = Extract<ProductPanelReadRequest, { dataName: string }>;

function readTargetKey(req: DataReadRequest): string {
  for (const value of Object.values(req.inputs ?? {})) {
    if (value && typeof value === "object" && "primaryKey" in value && typeof value.primaryKey === "string") {
      return value.primaryKey;
    }
  }
  return "";
}

function formDescription(mode: "create" | "edit", key: string, includeMembersField = false) {
  return {
    fields: [
      {
        path: "/id",
        label: "ID",
        required: true,
        readOnly: mode === "edit",
        control: { kind: "text" },
        valueSchema: { type: "string" },
      },
      {
        path: "/name",
        label: "Name",
        required: true,
        readOnly: false,
        control: { kind: "text" },
        valueSchema: { type: "string" },
      },
      {
        path: "/description",
        label: "Description",
        required: false,
        readOnly: false,
        control: { kind: "text" },
        valueSchema: { type: "string" },
      },
      {
        path: "/visibility",
        label: "Visibility",
        required: true,
        readOnly: mode === "edit",
        control: {
          kind: "select",
          options: [
            { value: "private", label: "Private", description: null, disabled: false, disabledReason: null },
            { value: "domain", label: "Domain", description: null, disabled: false, disabledReason: null },
          ],
        },
        valueSchema: { type: "string" },
      },
      {
        path: "/template",
        label: "Template",
        required: false,
        readOnly: false,
        control: { kind: "switch" },
        valueSchema: { type: "boolean" },
      },
      {
        path: "/content/html",
        label: "HTML",
        required: true,
        readOnly: false,
        control: { kind: "code", language: "html" },
        valueSchema: { type: "string" },
      },
      {
        path: "/content/module",
        label: "Module",
        required: true,
        readOnly: false,
        control: { kind: "code", language: "javascript" },
        valueSchema: { type: "string" },
      },
      ...(includeMembersField
        ? [
            {
              path: "/manifest/members",
              label: "Members",
              required: true,
              readOnly: false,
              control: { kind: "code", language: "json" },
              valueSchema: { type: "object" },
            },
          ]
        : []),
    ],
    values: {
      id: mode === "create" ? "draft-panel" : key,
      name: mode === "create" ? "" : `Panel ${key}`,
      description: "",
      visibility: "private",
      template: false,
      content: {
        html: '<div id="app"><section></section></div>',
        module: 'import { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({});',
      },
      ...(includeMembersField
        ? {
            manifest: {
              members: {
                existing: { target: { projectionId: "proj-0" } },
              },
            },
          }
        : {}),
    },
    errors: [],
    save: {
      method: mode === "create" ? "POST" : "PUT",
      path: `/api/product-panels/${key || "new"}`,
      bodySchema: {},
    },
  };
}

async function waitFor(check: () => boolean, label: string | (() => string)): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  const desc = typeof label === "function" ? label() : label;
  throw new Error(`Timed out waiting for: ${desc}`);
}

async function clickMessageBoxButton(labelText: string): Promise<HTMLElement> {
  let box: HTMLElement | undefined;
  await waitFor(() => {
    const open = [...document.querySelectorAll<HTMLElement>(".el-message-box")].filter(
      (item) => item.closest<HTMLElement>(".el-overlay")?.style.display !== "none",
    );
    box = open.at(-1);
    return Boolean(box);
  }, `message box containing "${labelText}"`);

  const btn = [...box!.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === labelText,
  );
  if (!btn) {
    throw new Error(
      `Message box button "${labelText}" not found. Buttons: ${[...box!.querySelectorAll("button")].map((b) => b.textContent?.trim()).join(", ")}`,
    );
  }
  btn.click();
  await waitFor(
    () => box!.closest<HTMLElement>(".el-overlay")?.style.display === "none" || !document.body.contains(box!),
    `message box close after "${labelText}"`,
  );
  return box!;
}

interface HarnessOptions {
  initialAddress?: string;
  unavailableRows?: () => Record<string, unknown>[];
  recordFor?: (key: string) => Record<string, unknown>;
  includeMembersField?: boolean;
  memberRowsFor?: (key: string) => Record<string, unknown>[];
  usedByRowsFor?: (key: string) => Record<string, unknown>[];
  sourceFilesFor?: (key: string) => Record<string, unknown>[];
  sourceFileFor?: (key: string, filePath: string) => Record<string, unknown>;
  grantRowsFor?: (key: string) => Record<string, unknown>[];
  projectionRecordFor?: (key: string) => Record<string, unknown>;
  operationsFor?: (member: string, inputs: Record<string, unknown>) => Record<string, unknown>;
  prepareIntent?: (body: { operationId: string; call: PanelOperationCall }) => Record<string, unknown>;
  dispatchIntent?: (operationId: string, call: PanelOperationCall) => Record<string, unknown>;
  nestedPanel?: (panelId: string, request: Sent) => Response | undefined;
}

async function mountPanelsApp(options: HarnessOptions = {}) {
  const initialAddress = options.initialAddress ?? CATALOG_PATH;
  const reads: DataReadRequest[] = [];
  const navigated: string[] = [];
  const dispatched: { operationId: string; call: PanelOperationCall }[] = [];
  const preparedIntents = new Map<
    string,
    { preparation: Record<string, unknown>; operationId: string; call: PanelOperationCall }
  >();
  let intentCounter = 0;

  installPlatform((request: Sent) => {
    const { path } = request;
    if (path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
      return Response.json({
        data: {
          applicationId: APP_ID,
          entry: { path: "/ontology", renderer: "panels" },
          panelUses: [catalogUse, detailUse],
        },
      });
    }
    if (path === `/api/product-panels/${catalogFixture.panel.id}`) {
      return panelAnswer(catalogFixture.panel, request);
    }
    if (path === `/api/product-panels/${catalogFixture.panel.id}/snapshot`) {
      return panelSnapshot(catalogFixture.panel, Object.fromEntries(catalogFixture.projections), request);
    }
    if (path === `/api/product-panels/${detailFixture.panel.id}`) {
      return panelAnswer(detailFixture.panel, request);
    }
    if (path === `/api/product-panels/${detailFixture.panel.id}/snapshot`) {
      return panelSnapshot(detailFixture.panel, Object.fromEntries(detailFixture.projections), request);
    }
    const nestedMatch = /^\/api\/product-panels\/([^/]+)(\/snapshot)?$/.exec(path);
    if (
      request.method === "GET"
      && nestedMatch
      && nestedMatch[1] !== catalogFixture.panel.id
      && nestedMatch[1] !== detailFixture.panel.id
      && options.nestedPanel
    ) {
      const answered = options.nestedPanel(nestedMatch[1]!, request);
      if (answered) return answered;
    }
    if (path.startsWith("/api/product-projections/")) {
      return Response.json({ projection: allProjections.get(path.split("/").at(-1)!) });
    }
    if (path === "/api/panel-operations/intents" && request.method === "POST") {
      const body = request.body as { operationId: string; call: PanelOperationCall };
      const intentId = `00000000-0000-4000-8000-${String(++intentCounter).padStart(12, "0")}`;
      const preparation = options.prepareIntent
        ? { intentId, ...options.prepareIntent(body) }
        : { intentId, operationId: body.operationId, label: body.operationId, confirmation: { kind: "none" as const } };
      preparedIntents.set(intentId, { preparation, operationId: body.operationId, call: body.call });
      return Response.json(preparation);
    }
    const intentRead = /^\/api\/panel-operation-intents\/([^/?]+)$/.exec(path);
    if (intentRead && request.method === "GET") {
      return Response.json(preparedIntents.get(intentRead[1]!)?.preparation ?? {});
    }
    const intentDispatch = /^\/api\/panel-operations\/intents\/([^/]+)\/dispatch$/.exec(path);
    if (intentDispatch && request.method === "POST") {
      const entry = preparedIntents.get(intentDispatch[1]!)!;
      dispatched.push({ operationId: entry.operationId, call: entry.call });
      const outcome = options.dispatchIntent
        ? options.dispatchIntent(entry.operationId, entry.call)
        : { kind: "success", data: {} };
      return Response.json({ kind: "dispatched", intentId: intentDispatch[1], outcome });
    }
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      if ("operations" in body) {
        const member = body.memberPath.at(-1)?.member ?? "";
        const inputs = (body.inputs ?? {}) as Record<string, unknown>;
        const custom = options.operationsFor ? options.operationsFor(member, inputs) : undefined;
        if (custom && Object.keys(custom).length > 0) {
          return Response.json({ status: "ready", value: custom });
        }
        if (member === "form" || member === "createForm") {
          return Response.json({
            status: "ready",
            value: {
              save: {
                kind: "form.save",
                handlerRef: "platform:ProductPanel.save",
                label: "Save",
                effect: "write",
                batch: false,
                target: { source: "draft", slot: member },
                inputSchema: {},
                resultSchema: {},
              },
            },
          });
        }
        return Response.json({ status: "ready", value: {} });
      }
      reads.push(body);
      const member = body.memberPath[0]?.member;
      if (member === "catalogue") {
        return Response.json({
          status: "ready",
          value: {
            rows: [
              {
                primaryKey: "panel-a",
                className: PRODUCT_PANEL,
                label: "Panel A",
                subtitle: "panel-a",
                fields: { owner: "Alice", visibility: "Private", template: "No", updatedAt: "2026-11-23T00:00:00Z" },
              },
              {
                primaryKey: "panel-b",
                className: PRODUCT_PANEL,
                label: "Panel B",
                subtitle: "panel-b",
                fields: { owner: "Alice", visibility: "Private", template: "No", updatedAt: "2026-11-23T00:00:00Z" },
              },
            ],
            total: 2,
          },
        });
      }
      if (member === "unavailableList") {
        return Response.json({
          status: "ready",
          value: options.unavailableRows ? options.unavailableRows() : [],
        });
      }
      if (member === "memberProjectionPicker") {
        return Response.json({
          status: "ready",
          value: {
            rows: [
              {
                primaryKey: "proj-1",
                className: PRODUCT_PROJECTION,
                label: "Summary Projection",
                subtitle: "Displays order summary",
                fields: { id: "proj-1", component: "ObjectSummary" },
              },
            ],
            total: 1,
          },
        });
      }
      if (member === "memberPanelPicker") {
        return Response.json({
          status: "ready",
          value: {
            rows: [
              {
                primaryKey: "panel-b",
                className: PRODUCT_PANEL,
                label: "Panel B",
                subtitle: "panel-b",
                fields: { id: "panel-b" },
              },
            ],
            total: 1,
          },
        });
      }
      if (member === "userPicker") {
        return Response.json({
          status: "ready",
          value: [
            { value: "user-bob", label: "Bob", object: { className: USER, primaryKey: "user-bob" } },
          ],
        });
      }
      if (member === "headerTitle" || member === "overviewSummary" || member === "unavailableSummary" || member === "shareStatusDesc") {
        const key = readTargetKey(body);
        if (!key) return Response.json({ status: "empty" });
        if (options.recordFor) {
          return Response.json({ status: "ready", value: options.recordFor(key) });
        }
        return Response.json({
          status: "ready",
          value: {
            primaryKey: key,
            className: PRODUCT_PANEL,
            label: key === "panel-b" ? "Panel B" : key === "panel-a" ? "Panel A" : `Panel ${key}`,
            subtitle: key,
            fields: {
              id: key,
              name: key === "panel-b" ? "Panel B" : key === "panel-a" ? "Panel A" : `Panel ${key}`,
              domainShared: false,
              objectType: PRODUCT_PANEL,
            },
            fieldLabels: { id: "ID", name: "Name", objectType: "Object type" },
            outputs: {
              canEdit: true,
              canGrant: false,
              canDelete: true,
              isBuiltin: false,
              isTemplate: false,
              domainShared: false,
              revision: 1,
              hiddenUsedByCount: 0,
              unavailable: false,
              unavailableReason: "",
            },
          },
        });
      }
      if (member === "membersList") {
        const key = readTargetKey(body);
        return Response.json({
          status: "ready",
          value: options.memberRowsFor ? options.memberRowsFor(key) : [],
        });
      }
      if (member === "usedByList") {
        const key = readTargetKey(body);
        return Response.json({
          status: "ready",
          value: options.usedByRowsFor ? options.usedByRowsFor(key) : [],
        });
      }
      if (member === "grantsList") {
        const key = readTargetKey(body);
        return Response.json({
          status: "ready",
          value: options.grantRowsFor ? options.grantRowsFor(key) : [],
        });
      }
      if (member === "sourceTree") {
        const key = readTargetKey(body);
        return Response.json({
          status: "ready",
          value: options.sourceFilesFor ? options.sourceFilesFor(key) : [],
        });
      }
      if (member === "sourceViewer") {
        const key = readTargetKey(body);
        const filePath = typeof body.inputs?.path === "string" ? body.inputs.path : "";
        if (options.sourceFileFor && filePath) {
          return Response.json({ status: "ready", value: options.sourceFileFor(key, filePath) });
        }
        return Response.json({ status: "empty" });
      }
      if (member === "memberProjectionHeader" || member === "memberProjectionSummary") {
        const key = readTargetKey(body);
        if (!key) return Response.json({ status: "empty" });
        return Response.json({
          status: "ready",
          value: options.projectionRecordFor
            ? options.projectionRecordFor(key)
            : {
                primaryKey: key,
                className: PRODUCT_PROJECTION,
                label: "Summary Projection",
                subtitle: "Displays order summary",
                fields: {
                  id: key,
                  component: "ObjectSummary",
                  owner: "Alice",
                  projectionKind: "Standard",
                  scope: "Private",
                  access: "Editable",
                  revision: 2,
                  updatedAt: "2026-11-23T00:00:00Z",
                },
                fieldLabels: {
                  id: "ID",
                  component: "Component",
                  owner: "Owner",
                  projectionKind: "Kind",
                  scope: "Scope",
                  access: "Access",
                  revision: "Revision",
                  updatedAt: "Updated",
                },
              },
        });
      }
      if (member === "createForm") {
        return Response.json({ status: "ready", value: formDescription("create", "", options.includeMembersField) });
      }
      if (member === "form") {
        const key = readTargetKey(body);
        return Response.json({
          status: "ready",
          value: formDescription("edit", key, options.includeMembersField),
        });
      }
      return Response.json({ status: "ready", value: { rows: [], total: 0 } });
    }
    return nothingAt(request);
  });

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
      panelUses: [catalogUse, detailUse],
    },
  ];

  type ObservedContext = {
    state?: Record<string, unknown> & {
      selected?: { primaryKey?: string } | null;
      previewTarget?: { primaryKey?: string } | null;
      detailMode?: string;
      creating?: boolean | null;
    };
    forms?: readonly { member: string; dirty: boolean; values: Record<string, unknown> }[];
  } | null;
  const observed = { context: null as ObservedContext };
  const display = useConversationDisplay({
    features: () => [
      { id: "panel", label: "Panels", icon: "pages", availability: "page", withConversation: true },
      { id: "panel-detail", label: "Panel detail", icon: "pages", availability: "page", withConversation: true },
    ],
    resolve: (address) => {
      const path = address.split("?")[0]!;
      if (path === CATALOG_PATH) return { featureId: "panel", address, instance: path };
      if (path === DETAIL_PATH) return { featureId: "panel-detail", address, instance: path };
      return null;
    },
    serialize: async () => true,
    context: (page, reported) => ({
      url: page.address,
      label: reported?.label || "Panels",
      selection: reported?.selection ?? [],
      ...(reported?.state ? { state: reported.state } : {}),
    }),
    leave: { leaves: () => false, confirm: async () => true },
  });
  display.placed(() => "side");

  await display.present({
    type: "presentation",
    sessionId: SESSION,
    runId: RUN,
    toolCallId: "open-initial",
    target: { kind: "page", address: initialAddress },
  });

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/chat", component: { template: "<div />" } },
      { path: CATALOG_PATH, name: "panels", component: { template: "<div />" } },
      { path: DETAIL_PATH, name: "panel-detail", component: { template: "<div />" } },
      { path: "/ontology/projections", name: "projections", component: { template: "<div />" } },
      { path: "/ontology/projections/detail", name: "projection-detail", component: { template: "<div />" } },
      { path: "/ontology/applications", name: "applications", component: { template: "<div />" } },
      { path: "/ontology/applications/detail", name: "application-detail", component: { template: "<div />" } },
    ],
  });
  await router.push("/chat");

  const Host = defineComponent({
    setup() {
      return () =>
        display.page.value
          ? h(PanelApplicationRoute, {
              applicationId: APP_ID,
              address: display.page.value.address,
              navigate: (address: string) => {
                navigated.push(address);
                void display.navigate(address, { view: "side", history: "push" });
              },
              liveState: display.liveState.value,
              registerPageController: (controller: unknown) =>
                display.registerPageController(display.page.value!.instance, controller as never),
              onDisplayAddress: display.address,
              onDisplayLoaded: display.loaded,
              onContext: (reported: ObservedContext) => {
                observed.context = reported;
                display.context(reported as never);
              },
            })
          : null;
    },
  });

  const mounted = mountPlatformPage(() => h(Host), router);
  if (initialAddress.startsWith(DETAIL_PATH)) {
    await waitFor(() => Boolean(mounted.element.querySelector(".pd-detail-page")), "initial detail page");
  } else {
    await waitFor(
      () => mounted.element.textContent?.includes("Panel A") === true && mounted.element.textContent?.includes("Panel B") === true,
      "initial panel list",
    );
  }

  return { mounted, display, observed, reads, navigated, dispatched };
}

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  sessionStorage.clear();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("panels two-entry architecture (catalog + detail)", () => {
  it("enforces zero usePanelData, zero third-party tokens, 8-locale coverage, and non-deepLink create/edit states", () => {
    for (const src of [catalogHtml, catalogModule, detailHtml, detailModule]) {
      expect(src).not.toContain("usePanelData");
      expect(src).not.toContain("/api/");
      expect(src).not.toMatch(/\bel-[a-z]/);
      expect(src).not.toContain("--el-");
    }
    expect(catalogSource.manifest.members.catalogue.config.showChevron).toBe(true);
    expect(catalogSource.manifest.members.catalogue.config.fallbackToFirst).toBe(false);
    expect(catalogSource.manifest.members.catalogue.config.pageSizes).toContain(100);
    expect(catalogSource.manifest.state.creating).not.toHaveProperty("deepLink", true);
    expect(detailSource.manifest.state.detailMode.deepLink).toBe(false);
    expect(Object.keys(catalogSource.content.messages).sort()).toEqual(["ar", "de", "en", "fr", "it", "ja", "zh-CN", "zh-TW"]);
    expect(Object.keys(detailSource.content.messages).sort()).toEqual(["ar", "de", "en", "fr", "it", "ja", "zh-CN", "zh-TW"]);
  });

  it("renders full-width catalog, navigates to detail on row/unavailable click, and guards create dialog before jumping into detail edit mode", async () => {
    const { mounted, display, observed, navigated, dispatched } = await mountPanelsApp({
      unavailableRows: () => [
        {
          primaryKey: "broken-panel",
          className: PRODUCT_PANEL,
          label: "broken-panel",
          subtitle: "manifest.members.bad: Invalid reference",
          fields: { id: "broken-panel", reason: "manifest.members.bad: Invalid reference", revision: 3, canDelete: true },
          fieldLabels: { id: "ID", reason: "Reason", revision: "Revision", canDelete: "Can delete" },
          tones: { reason: "danger" },
        },
      ],
      dispatchIntent: (operationId) => {
        if (operationId === "createForm.save") {
          return {
            kind: "success",
            created: { objectType: PRODUCT_PANEL, primaryKey: "new-panel-1" },
            data: { id: "new-panel-1" },
          };
        }
        return { kind: "success", data: {} };
      },
    });

    try {
      // Page sizes include 20, 50, and 100.
      const pageSizeTrigger = mounted.element.querySelector<HTMLElement>(".sdk-object-list-page-size .el-select__wrapper");
      expect(pageSizeTrigger).toBeTruthy();
      pageSizeTrigger!.click();
      await waitFor(
        () => document.querySelectorAll(".sdk-object-list-page-size-popper .el-select-dropdown__item").length === 3,
        "page size dropdown options rendered",
      );
      const pageSizeOptions = [...document.querySelectorAll<HTMLElement>(".sdk-object-list-page-size-popper .el-select-dropdown__item")].map((o) =>
        Number(o.textContent?.match(/\d+/)?.[0]),
      );
      expect(pageSizeOptions).toEqual([20, 50, 100]);
      pageSizeTrigger!.click();

      // Unavailable panels section is visible and clickable.
      const unavailableSection = mounted.element.querySelector<HTMLElement>(".pd-unavailable-section");
      await waitFor(
        () => unavailableSection?.style.display !== "none" && unavailableSection?.textContent?.includes("broken-panel") === true,
        "unavailable panel list visible",
      );

      // 1. Open centered create dialog from header primary button.
      const createBtn = mounted.element.querySelector<HTMLButtonElement>(".sdk-page-header-actions .el-button--primary");
      expect(createBtn).toBeTruthy();
      createBtn!.click();

      await waitFor(() => Boolean(document.querySelector(".el-dialog .pd-create-body input")), "create dialog rendered");
      expect(display.page.value?.address).not.toContain("creating");

      // Only the 5 basic fields are shown — HTML / Module code editors stay in detail edit mode.
      const dialogText = document.querySelector(".el-dialog .pd-create-body")?.textContent ?? "";
      expect(dialogText).toContain("Name");
      expect(dialogText).toContain("ID");
      expect(dialogText).toContain("Description");
      expect(dialogText).not.toContain("HTML");
      expect(dialogText).not.toContain("Module");

      // 2. Edit a field to make the dialog dirty, then click X -> unsaved guard asks before closing.
      const nameInput = [...document.querySelectorAll<HTMLInputElement>(".el-dialog .pd-create-body input")].find(
        (input) => input.value === "",
      );
      expect(nameInput).toBeTruthy();
      nameInput!.value = "Unsaved Panel";
      nameInput!.dispatchEvent(new Event("input", { bubbles: true }));
      await waitFor(() => observed.context?.forms?.some((f) => f.member === "createForm" && f.dirty) === true, "createForm dirty");

      const closeBtn = document.querySelector<HTMLButtonElement>(".el-dialog__headerbtn");
      expect(closeBtn).toBeTruthy();
      closeBtn!.click();
      await clickMessageBoxButton("Cancel");
      expect(document.querySelector(".el-dialog .pd-create-body")).not.toBeNull();
      expect(nameInput!.value).toBe("Unsaved Panel");

      // Click X again and discard -> closes dialog cleanly.
      closeBtn!.click();
      await clickMessageBoxButton("OK");
      await waitFor(() => !document.querySelector(".el-dialog .pd-create-body"), "create dialog closed after discard");

      // 3. Re-open create dialog, enter name, submit -> writes one-time sessionStorage key and navigates into detail edit mode.
      createBtn!.click();
      await waitFor(() => Boolean(document.querySelector(".el-dialog .pd-create-body input")), "create dialog reopened");
      const freshNameInput = [...document.querySelectorAll<HTMLInputElement>(".el-dialog .pd-create-body input")].find(
        (input) => input.value === "",
      );
      freshNameInput!.value = "Brand New Panel";
      freshNameInput!.dispatchEvent(new Event("input", { bubbles: true }));

      const submitBtn = document.querySelector<HTMLButtonElement>(".el-dialog .pd-create-body .el-button--primary");
      expect(submitBtn).toBeTruthy();
      await waitFor(() => !submitBtn!.disabled, "create submit button enabled");
      submitBtn!.click();

      await waitFor(() => dispatched.some((d) => d.operationId === "createForm.save"), "createForm saved");
      await waitFor(
        () => navigated.includes(`${DETAIL_PATH}?selected=new-panel-1`),
        "navigated to new panel detail",
      );

      // Detail entry consumes one-time sessionStorage key and enters edit mode without leaking detailMode to URL.
      await waitFor(
        () =>
          Boolean(mounted.element.querySelector(".pd-edit-mode"))
          && observed.context?.state?.detailMode === "edit"
          && observed.context?.state?.selected?.primaryKey === "new-panel-1",
        "newly created panel opened directly in full-width edit mode",
      );
      expect(sessionStorage.getItem(`${OPEN_EDIT_KEY_PREFIX}new-panel-1`)).toBeNull();
      expect(display.page.value?.address).toBe(`${DETAIL_PATH}?selected=new-panel-1`);
      expect(display.page.value?.address).not.toContain("detailMode");

      // Clicking Back to panels returns to catalog.
      const backBtn = mounted.element.querySelector<HTMLButtonElement>(".sdk-page-header-back");
      expect(backBtn).toBeTruthy();
      backBtn!.click();
      await waitFor(
        () => navigated.includes(CATALOG_PATH) && Boolean(mounted.element.querySelector(".pd-catalog")),
        "returned to catalog",
      );

      // Clicking a normal catalog row opens detail in default view mode (since no sessionStorage key exists).
      const panelARow = [...mounted.element.querySelectorAll("tr")].find((row) => row.textContent?.includes("Panel A"));
      expect(panelARow).toBeTruthy();
      panelARow!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await waitFor(
        () =>
          display.page.value?.address === `${DETAIL_PATH}?selected=panel-a`
          && mounted.element.querySelector<HTMLElement>(".pd-view-mode")?.style.display !== "none"
          && mounted.element.querySelectorAll(".pd-tab-panel").length > 0
          && observed.context?.state?.detailMode === "view",
        "panel-a opened in default view mode",
      );

      // Return to catalog and click the unavailable panel -> navigates to /ontology/panels/detail?selected=broken-panel.
      const backBtn2 = mounted.element.querySelector<HTMLButtonElement>(".sdk-page-header-back");
      backBtn2!.click();
      await waitFor(() => Boolean(mounted.element.querySelector(".pd-unavailable-section .sdk-object-list-item-btn")), "unavailable row clickable");
      mounted.element.querySelector<HTMLButtonElement>(".pd-unavailable-section .sdk-object-list-item-btn")!.click();
      await waitFor(
        () => navigated.includes(`${DETAIL_PATH}?selected=broken-panel`),
        "unavailable panel click navigated to detail",
      );
    } finally {
      mounted.app.unmount();
    }
  });

  it("opens detail in view mode, switches to full-width edit mode via Edit button, supports member picker, Cancel guard, and Save", async () => {
    const { mounted, observed, dispatched } = await mountPanelsApp({
      initialAddress: `${DETAIL_PATH}?selected=panel-b`,
      includeMembersField: true,
    });

    try {
      await waitFor(() => Boolean(mounted.element.querySelector(".pd-tabs")), "default view mode rendered");
      expect(observed.context?.state?.detailMode).toBe("view");

      // Click primary Edit button in header -> full-width edit mode with header Cancel + Save draft bar.
      const editBtn = mounted.element.querySelector<HTMLButtonElement>(".sdk-page-header-actions .el-button--primary");
      expect(editBtn?.textContent?.trim()).toBe("Edit");
      editBtn!.click();

      await waitFor(() => Boolean(mounted.element.querySelector(".pd-edit-mode")), "entered full-width edit mode");
      await waitFor(
        () => Boolean(mounted.element.querySelector(".pd-member-picker")),
        "candidate member picker rendered when /manifest/members is editable",
      );

      // Add an existing projection into /manifest/members via the candidate picker.
      await waitFor(
        () => mounted.element.querySelector(".pd-member-picker")?.textContent?.includes("Summary Projection") === true,
        "candidate projection loaded",
      );
      mounted.element.querySelector<HTMLButtonElement>(".pd-member-picker .sdk-object-list-item-btn")!.click();

      const slotInput = mounted.element.querySelector<HTMLInputElement>(".pd-member-picker-inputs input")!;
      slotInput.value = "orderSummary";
      slotInput.dispatchEvent(new Event("input", { bubbles: true }));
      const addMemberBtn = mounted.element.querySelector<HTMLButtonElement>(".pd-member-picker-inputs .el-button--primary")!;
      await waitFor(() => !addMemberBtn.disabled, "add member enabled");
      addMemberBtn.click();

      await waitFor(() => {
        const form = observed.context?.forms?.find((f) => f.member === "form");
        const members = (form?.values as { manifest?: { members?: Record<string, unknown> } } | undefined)?.manifest?.members;
        return Boolean(form?.dirty && members && "orderSummary" in members);
      }, "added projection into /manifest/members");

      // Header Save button is enabled while dirty.
      const headerSaveBtn = mounted.element.querySelector<HTMLButtonElement>(".sdk-page-header-action.primary");
      expect(headerSaveBtn).toBeTruthy();
      expect(headerSaveBtn!.disabled).toBe(false);

      // Click header Cancel while dirty -> triggers unsaved confirmation.
      const cancelBtn = [...mounted.element.querySelectorAll<HTMLButtonElement>(".sdk-page-header-actions button")].find(
        (b) => b.textContent?.trim() === "Cancel",
      );
      expect(cancelBtn).toBeTruthy();
      cancelBtn!.click();

      await clickMessageBoxButton("Cancel");
      expect(mounted.element.querySelector(".pd-edit-mode")).not.toBeNull();

      // Confirming Cancel discards unsaved edits and returns to view mode.
      cancelBtn!.click();
      await clickMessageBoxButton("OK");
      await waitFor(
        () => observed.context?.state?.detailMode === "view" && !mounted.element.querySelector(".pd-edit-mode"),
        "exited edit mode after confirming cancel",
      );

      // Re-enter edit mode, modify a field, and click Save in header -> dispatches form.save and returns to view mode.
      const editBtnAgain = mounted.element.querySelector<HTMLButtonElement>(".sdk-page-header-actions .el-button--primary");
      editBtnAgain!.click();
      await waitFor(() => Boolean(mounted.element.querySelector(".pd-edit-mode input")), "re-entered edit mode");
      const nameField = [...mounted.element.querySelectorAll<HTMLInputElement>(".pd-edit-mode .pd-form-wrap input")].find(
        (input) => input.value === "Panel panel-b",
      );
      expect(nameField).toBeTruthy();
      nameField!.value = "Panel B Updated";
      nameField!.dispatchEvent(new Event("input", { bubbles: true }));
      const saveBtnAgain = mounted.element.querySelector<HTMLButtonElement>(".sdk-page-header-action.primary");
      await waitFor(() => Boolean(saveBtnAgain && !saveBtnAgain.disabled), "header save enabled after edit");
      saveBtnAgain!.click();
      await waitFor(() => dispatched.some((d) => d.operationId === "form.save"), "form.save dispatched");
      await waitFor(
        () => observed.context?.state?.detailMode === "view" && mounted.element.querySelector<HTMLElement>(".pd-view-mode")?.style.display !== "none",
        "returned to view mode after save",
      );
    } finally {
      mounted.app.unmount();
    }
  });

  it("displays unavailable panel diagnostics on detail, confirms deletion via inspectImpact, and navigates back to catalog", async () => {
    let brokenPresent = true;
    const { mounted, navigated, dispatched } = await mountPanelsApp({
      initialAddress: `${DETAIL_PATH}?selected=broken-panel`,
      unavailableRows: () => (brokenPresent ? [{ primaryKey: "broken-panel", className: PRODUCT_PANEL, label: "broken-panel", fields: {} }] : []),
      recordFor: (key) => {
        if (key === "broken-panel") {
          return {
            primaryKey: "broken-panel",
            className: PRODUCT_PANEL,
            label: "broken-panel",
            subtitle: "manifest.members.bad: Invalid reference",
            fields: {
              id: "broken-panel",
              unavailableReason: "manifest.members.bad: Invalid reference",
              revision: 3,
              objectType: PRODUCT_PANEL,
            },
            fieldLabels: {
              id: "ID",
              unavailableReason: "Unavailable reason",
              revision: "Revision",
              objectType: "Object type",
            },
            tones: { unavailableReason: "danger" },
            outputs: {
              unavailable: true,
              unavailableReason: "manifest.members.bad: Invalid reference",
              revision: 3,
              canEdit: false,
              canGrant: false,
              canDelete: true,
              isBuiltin: false,
              isTemplate: false,
              domainShared: false,
              hiddenUsedByCount: 0,
            },
          };
        }
        return {
          primaryKey: key,
          className: PRODUCT_PANEL,
          label: `Panel ${key}`,
          fields: { id: key, name: `Panel ${key}` },
          outputs: {
            canEdit: true,
            canGrant: false,
            canDelete: true,
            isBuiltin: false,
            isTemplate: false,
            domainShared: false,
            revision: 1,
            hiddenUsedByCount: 0,
            unavailable: false,
            unavailableReason: "",
          },
        };
      },
      operationsFor: (member, inputs) => {
        if (member === "deletePanel" && inputs.target) {
          return {
            delete: {
              kind: "action",
              handlerRef: "productPanels.delete",
              label: "Delete",
              effect: "write",
              batch: false,
              inspectImpact: { handlerRef: "productPanels.delete" },
              target: { source: "input", input: "target" },
              inputSchema: { type: "object", properties: { revision: { type: "number" } } },
              resultSchema: {},
            },
          };
        }
        return {};
      },
      prepareIntent: ({ operationId, call }) => {
        const key = (call.target as { primaryKey: string }).primaryKey;
        return {
          operationId,
          label: "Delete panel",
          confirmation: {
            kind: "impact" as const,
            impact: {
              summary: `Delete ${key}? Unused projections will also be removed.`,
              total: 1,
              objects: [{ target: { objectType: PRODUCT_PANEL, primaryKey: key }, label: key }],
            },
          },
        };
      },
      dispatchIntent: () => {
        brokenPresent = false;
        return { kind: "success", data: { deletedProjectionIds: [], retainedProjectionIdsWithoutEdit: [] } };
      },
    });

    try {
      await waitFor(
        () =>
          mounted.element.querySelector(".pd-unavailable-detail")?.textContent?.includes("manifest.members.bad: Invalid reference") === true,
        "unavailable diagnostic detail rendered",
      );
      expect(mounted.element.querySelector<HTMLElement>(".pd-view-mode")?.style.display).toBe("none");
      expect(mounted.element.querySelectorAll(".pd-tab-panel")).toHaveLength(0);

      await waitFor(
        () => Boolean(mounted.element.querySelector<HTMLButtonElement>(".sdk-page-header-actions .el-button--danger")),
        "danger delete button visible in header for unavailable panel",
      );
      const deleteBtn = mounted.element.querySelector<HTMLButtonElement>(".sdk-page-header-actions .el-button--danger")!;

      // Cancel confirmation does not dispatch.
      deleteBtn.click();
      const cancelBox = await clickMessageBoxButton("Cancel");
      expect(cancelBox.textContent).toContain("Delete broken-panel?");
      expect(dispatched).toHaveLength(0);

      // Confirm deletion dispatches with revision: 3 and navigates back to /ontology/panels.
      deleteBtn.click();
      await clickMessageBoxButton("Delete panel");

      await waitFor(() => dispatched.length === 1, "delete dispatched after confirmation");
      expect(dispatched[0]?.call.input).toEqual({ revision: 3 });
      await waitFor(() => navigated.includes(CATALOG_PATH), "navigated back to catalog after delete");
    } finally {
      mounted.app.unmount();
    }
  });

  it("preserves all view-mode tabs (overview, source, members, usage, grants, on-demand preview) and navigation links", async () => {
    const nestedPreviewPanel = {
      ...panelRecord("panel-b", "Panel B", definePanel({ state: {}, members: {} })),
      visibility: "domain" as const,
      domainId: "domain-1",
      ownerId: "user-1",
      editable: true as const,
      content: {
        html: '<div id="app"><section class="nested-preview-marker">Live preview content</section></div>',
        module: 'import { mountPanel } from "@ontomato/sdk/panel"; await mountPanel({});',
        messages: {},
      },
    };
    const nestedRequests: string[] = [];

    const { mounted, display, observed, navigated, dispatched } = await mountPanelsApp({
      initialAddress: `${DETAIL_PATH}?selected=panel-b`,
      recordFor: (key) => ({
        primaryKey: key,
        className: PRODUCT_PANEL,
        label: `Panel ${key}`,
        fields: { id: key, name: `Panel ${key}`, domainShared: false, objectType: PRODUCT_PANEL },
        outputs: {
          canEdit: true,
          canGrant: true,
          canDelete: true,
          isBuiltin: false,
          isTemplate: false,
          domainShared: false,
          revision: 2,
          hiddenUsedByCount: 2,
          unavailable: false,
          unavailableReason: "",
        },
      }),
      sourceFilesFor: () => [
        { primaryKey: "panel.html", className: PRODUCT_PANEL, label: "panel.html", fields: { path: "panel.html" } },
        { primaryKey: "panel.mjs", className: PRODUCT_PANEL, label: "panel.mjs", fields: { path: "panel.mjs" } },
      ],
      sourceFileFor: (_key, filePath) => ({
        primaryKey: filePath,
        className: PRODUCT_PANEL,
        label: filePath,
        fields: { content: `// source for ${filePath}` },
      }),
      memberRowsFor: () => [
        {
          primaryKey: "proj-1",
          className: PRODUCT_PROJECTION,
          label: "Summary Projection",
          subtitle: "proj-1",
          fields: {
            slot: "summary",
            kindLabel: "Projection",
            target: { kind: "reference", className: PRODUCT_PROJECTION, primaryKey: "proj-1", label: "Summary Projection" },
            componentId: "ObjectSummary",
            inputs: "—",
            outputs: "—",
          },
        },
        {
          primaryKey: "panel-nested",
          className: PRODUCT_PANEL,
          label: "Nested Child Panel",
          subtitle: "panel-nested",
          fields: {
            slot: "child",
            kindLabel: "Panel",
            target: { kind: "reference", className: PRODUCT_PANEL, primaryKey: "panel-nested", label: "Nested Child Panel" },
            componentId: "—",
            inputs: "—",
            outputs: "—",
          },
        },
      ],
      usedByRowsFor: () => [
        {
          primaryKey: "/applications/app-demo/home",
          className: APPLICATION,
          label: "Demo App",
          subtitle: "/applications/app-demo/home",
          fields: {
            kindLabel: "Application entry",
            target: { kind: "reference", className: APPLICATION, primaryKey: "app-demo", label: "Demo App" },
            path: "/applications/app-demo/home",
            canOpenPath: true,
          },
        },
      ],
      operationsFor: (member) => {
        if (member === "shareEnable") {
          return {
            share: {
              kind: "action",
              handlerRef: "productPanels.share",
              label: "Share with domain",
              effect: "write",
              batch: false,
              target: { source: "input", input: "target" },
              inputSchema: { type: "object", properties: { shared: { type: "boolean" } } },
              resultSchema: {},
            },
          };
        }
        return {};
      },
      nestedPanel: (panelId, request) => {
        nestedRequests.push(`${panelId}:${request.path}`);
        if (request.path.endsWith("/snapshot")) return panelSnapshot(nestedPreviewPanel, {}, request);
        return panelAnswer(nestedPreviewPanel, request);
      },
    });

    try {
      // Only the active Overview tab mounts initially; hidden tabs (source, members, usage, grants, preview) stay unmounted until selected.
      await waitFor(() => mounted.element.querySelectorAll(".pd-tab-panel").length === 1, "only active overview tab mounted");
      expect(mounted.element.querySelector('[data-tab="overview"]')).not.toBeNull();
      expect(mounted.element.querySelector('[data-tab="source"]')).toBeNull();
      expect(mounted.element.querySelector('[data-tab="members"]')).toBeNull();
      expect(mounted.element.querySelector('[data-tab="usage"]')).toBeNull();
      expect(mounted.element.querySelector('[data-tab="grants"]')).toBeNull();
      expect(mounted.element.querySelector('[data-tab="preview"]')).toBeNull();
      expect(nestedRequests).toHaveLength(0);

      // Semantic tab bar activates the clicked tab immediately on first click without deferred active-bar measurement.
      const memberTabBtn = [...mounted.element.querySelectorAll<HTMLButtonElement>('.pd-tabs button[role="tab"]')].find((btn) =>
        btn.textContent?.includes("Members"),
      );
      expect(memberTabBtn).toBeTruthy();
      memberTabBtn!.click();
      await waitFor(
        () => memberTabBtn!.classList.contains("active") && memberTabBtn!.getAttribute("aria-selected") === "true",
        "Members tab became active immediately on first click",
      );

      // Source tab: displays source files and source viewer content.
      await display.present(presentFrame({ tab: "source", sourceFile: "panel.html" }, display.page.value!.address));
      await waitFor(
        () => mounted.element.querySelector('[data-tab="source"]')?.textContent?.includes("// source for panel.html") === true,
        "source viewer loaded panel.html",
      );

      // Members tab: clicking projection row populates inline summary, "Open in Projections" navigates to /ontology/projections/detail.
      await display.present(presentFrame({ tab: "members" }, display.page.value!.address));
      await waitFor(
        () => mounted.element.querySelector('[data-tab="members"]')?.textContent?.includes("Summary Projection") === true,
        "members table loaded",
      );
      const projRow = [...mounted.element.querySelectorAll('[data-tab="members"] tr')].find((row) =>
        row.textContent?.includes("Summary Projection"),
      );
      projRow!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await waitFor(
        () => mounted.element.querySelector(".pd-member-card")?.textContent?.includes("Open in Projections") === true,
        "inline projection summary card populated",
      );
      const openProjBtn = [...mounted.element.querySelectorAll<HTMLButtonElement>(".pd-member-card button")].find((b) =>
        b.textContent?.includes("Open in Projections"),
      );
      openProjBtn!.click();
      await waitFor(() => navigated.includes("/ontology/projections/detail?selected=proj-1"), "navigated to projection detail");

      // Usage tab: hidden users banner & page skills section rendered; row action opens entry path.
      await display.present(presentFrame({ tab: "usage" }, display.page.value!.address));
      await waitFor(() => {
        const text = mounted.element.querySelector('[data-tab="usage"]')?.textContent ?? "";
        return text.includes("2 more users you may not read") && text.includes("Page skills") && text.includes("Demo App");
      }, "usage tab rendered");

      // Grants tab: domain sharing toggle dispatches productPanels.share.
      await display.present(presentFrame({ tab: "grants" }, display.page.value!.address));
      await waitFor(
        () => Boolean(mounted.element.querySelector<HTMLButtonElement>('[data-tab="grants"] .pd-share-actions .sdk-operation-button button')),
        "domain share button rendered",
      );
      mounted.element.querySelector<HTMLButtonElement>('[data-tab="grants"] .pd-share-actions .sdk-operation-button button')!.click();
      await waitFor(() => dispatched.some((d) => d.operationId === "shareEnable.share"), "share dispatched");

      // Preview tab: mounts live preview on demand, and unmounts when switching away.
      await display.present(presentFrame({ tab: "preview" }, display.page.value!.address));
      await waitFor(
        () =>
          Boolean(mounted.element.querySelector(".pd-preview-box"))
          && observed.context?.state?.previewTarget?.primaryKey === "panel-b",
        "inline preview mounted on demand",
      );
      await display.present(presentFrame({ tab: "overview" }, display.page.value!.address));
      await waitFor(
        () => !mounted.element.querySelector(".pd-preview-box") && (observed.context?.state?.previewTarget ?? null) === null,
        "inline preview unmounted on tab switch",
      );
    } finally {
      mounted.app.unmount();
    }
  });

  it("aligns copy, template, grant, and editMode guards with permissions and handles agent remote control", async () => {
    let copyReceiptData: Record<string, unknown> = { id: "server-assigned-copy" };
    const { mounted, display, observed, navigated, dispatched } = await mountPanelsApp({
      initialAddress: `${DETAIL_PATH}?selected=panel-a`,
      recordFor: (key) => {
        const isEditable = key === "panel-b";
        const isTemplate = key === "panel-tpl";
        return {
          primaryKey: key,
          className: PRODUCT_PANEL,
          label: isEditable ? "Panel B" : isTemplate ? "Template Panel" : "Panel A",
          fields: { id: key, name: key, domainShared: false, objectType: PRODUCT_PANEL },
          outputs: {
            canEdit: isEditable,
            canGrant: isEditable,
            canDelete: isEditable,
            isBuiltin: false,
            isTemplate,
            domainShared: false,
            revision: 1,
            hiddenUsedByCount: 0,
            unavailable: false,
            unavailableReason: "",
          },
        };
      },
      operationsFor: (member) => {
        if (member === "copySubmit") {
          return {
            copy: {
              kind: "action",
              handlerRef: "productPanels.copy",
              label: "Copy",
              effect: "write",
              batch: false,
              target: { source: "input", input: "target" },
              inputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
              resultSchema: {},
            },
          };
        }
        return {};
      },
      dispatchIntent: (operationId) => {
        if (operationId === "copySubmit.copy") {
          return { kind: "success", data: copyReceiptData };
        }
        return { kind: "success", data: {} };
      },
    });

    try {
      // 1. Read-only Panel A auto-closes unauthorized copyDialog, grantDialog, and resets detailMode to view.
      await display.present(
        presentFrame(
          {
            selected: panelRef("panel-a"),
            detailMode: "edit",
            copyDialog: true,
            copyId: "forced-id",
            copyName: "Forced Name",
            grantDialog: true,
          },
          display.page.value!.address,
        ),
      );
      await waitFor(
        () =>
          observed.context?.state?.selected?.primaryKey === "panel-a"
          && observed.context?.state?.detailMode === "view"
          && (observed.context?.state?.copyDialog ?? null) === null
          && (observed.context?.state?.grantDialog ?? null) === null,
        "unauthorized editMode and dialogs auto-closed for read-only panel",
      );

      // 2. Single present call selects editable Panel B and enters edit mode without leaking detailMode to URL.
      const editReceipt = await display.present(
        presentFrame({ selected: panelRef("panel-b"), detailMode: "edit" }, display.page.value!.address),
      );
      expect(editReceipt).toMatchObject({ status: "opened" });
      await waitFor(
        () => observed.context?.state?.selected?.primaryKey === "panel-b" && observed.context?.state?.detailMode === "edit",
        "panel-b entered edit mode via single present call",
      );
      expect(display.page.value?.address).not.toContain("detailMode");

      // Selected-only switch back to Panel A resets detailMode to view.
      await display.present(presentFrame({ selected: panelRef("panel-a") }, display.page.value!.address));
      await waitFor(
        () => observed.context?.state?.selected?.primaryKey === "panel-a" && observed.context?.state?.detailMode === "view",
        "selected-only update returned to view mode",
      );

      // 3. Copy on Panel B navigates to /ontology/panels/detail?selected=<owner data.id>, never falling back to draftId.
      await display.present(
        presentFrame(
          { selected: panelRef("panel-b"), copyDialog: true, copyMode: "copy", copyId: "draft-id", copyName: "Copy B" },
          display.page.value!.address,
        ),
      );
      await waitFor(() => Boolean(document.querySelector(".el-dialog .el-button--primary")), "copy submit button mounted");
      document.querySelector<HTMLButtonElement>(".el-dialog .el-button--primary")!.click();

      await waitFor(
        () => dispatched.length === 1 && navigated.includes(`${DETAIL_PATH}?selected=server-assigned-copy`),
        "copy navigated to server-assigned panel detail",
      );

      // When owner receipt omits data.id, panel closes dialog without navigating to draftId.
      copyReceiptData = {};
      await display.present(
        presentFrame(
          { selected: panelRef("panel-b"), copyDialog: true, copyMode: "copy", copyId: "never-select-draft", copyName: "Copy B2" },
          display.page.value!.address,
        ),
      );
      await waitFor(() => Boolean(document.querySelector(".el-dialog .el-button--primary")), "copy submit button mounted again");
      document.querySelector<HTMLButtonElement>(".el-dialog .el-button--primary")!.click();

      await waitFor(() => dispatched.length === 2, "second copy dispatched");
      await waitFor(() => (observed.context?.state?.copyDialog ?? null) === null, "copy dialog closed");
      expect(navigated.some((addr) => addr.includes("never-select-draft"))).toBe(false);

      // 4. Read-only template panel allows fromTemplate copy mode.
      copyReceiptData = { id: "derived-from-tpl" };
      await display.present(
        presentFrame(
          {
            selected: panelRef("panel-tpl"),
            copyDialog: true,
            copyMode: "fromTemplate",
            copyId: "derived-draft",
            copyName: "Derived Panel",
            copyTemplate: false,
          },
          display.page.value!.address,
        ),
      );
      await waitFor(() => Boolean(document.querySelector(".el-dialog .el-button--primary")), "fromTemplate submit button mounted");
      document.querySelector<HTMLButtonElement>(".el-dialog .el-button--primary")!.click();
      await waitFor(
        () => dispatched.length === 3 && navigated.includes(`${DETAIL_PATH}?selected=derived-from-tpl`),
        "fromTemplate navigated to derived panel detail",
      );
    } finally {
      mounted.app.unmount();
    }
  });
});
