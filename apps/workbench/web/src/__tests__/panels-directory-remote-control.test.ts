import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type { PresentationFrame } from "@ontomato/contracts/agent-presentation";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { PRODUCT_PANEL, platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { useConversationDisplay } from "../../../../../packages/agent-shell-ui/src/conversation-display";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import source from "../../../../../packages/ontology-manager/resources/builtin-panels/panels/panel.json";
import html from "../../../../../packages/ontology-manager/resources/builtin-panels/panels/panel.html?raw";
import module from "../../../../../packages/ontology-manager/resources/builtin-panels/panels/panel.mjs?raw";
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
const ENTRY_PATH = "/ontology/panels";

const use = panelUse(
  "use-ontology-panels",
  "ontology-panels",
  "builtin-product-ontology-panels",
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
    ports: { props: [], events: [], slots: [] },
  }),
);
const projections = new Map<string, ProductProjection>();
const members = Object.fromEntries(
  Object.entries(authoring).map(([name, definition]) => {
    if (!("component" in definition)) {
      return [name, definition];
    }
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
      createdAt: "2026-11-23T00:00:00Z",
      updatedAt: "2026-11-23T00:00:00Z",
    });
    return [name, { ...placement, target: { projectionId: definition.id! } }];
  }),
);

const panelsDirectoryPanel = {
  ...panelRecord(use.panelId, "Panels", definePanel({ ...manifest, members })),
  visibility: "platform" as const,
  domainId: null,
  ownerId: null,
  editable: false as const,
  content: { html, module, messages: source.content.messages },
};

const panelRef = (primaryKey: string) => ({ className: PRODUCT_PANEL, primaryKey });

function presentFrame(state: Record<string, unknown>, address = ENTRY_PATH): PresentationFrame {
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

function formDescription(mode: "create" | "edit", key: string) {
  return {
    fields: [
      {
        path: "/name",
        label: "Name",
        required: true,
        readOnly: false,
        control: { kind: "text" },
        valueSchema: { type: "string" },
      },
    ],
    values: { name: mode === "create" ? "" : `Panel ${key}` },
    errors: [],
    save: {
      method: mode === "create" ? "POST" : "PUT",
      path: `/api/product-panels/${key || "new"}`,
      bodySchema: {},
      draftOperation: mode === "create" ? "create" : "save",
    },
  };
}

async function waitFor(check: () => boolean, label: string | (() => string)): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  const desc = typeof label === "function" ? label() : label;
  throw new Error(`Timed out waiting for: ${desc}`);
}

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("panels builtin directory remote-control state transitions", () => {
  it("lands directly on panel B's edit form in one present call, resets on human list click, and creates with selected cleared", async () => {
    const reads: DataReadRequest[] = [];

    installPlatform((request: Sent) => {
      const { path } = request;
      if (path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
        return Response.json({
          data: { applicationId: APP_ID, entry: { path: "/ontology", renderer: "panels" }, panelUses: [use] },
        });
      }
      if (path === `/api/product-panels/${panelsDirectoryPanel.id}`) {
        return panelAnswer(panelsDirectoryPanel, request);
      }
      if (path === `/api/product-panels/${panelsDirectoryPanel.id}/snapshot`) {
        return panelSnapshot(panelsDirectoryPanel, Object.fromEntries(projections), request);
      }
      if (path.startsWith("/api/product-projections/")) {
        return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
      }
      if (path === "/api/product-panels/read") {
        const body = request.body as ProductPanelReadRequest;
        if ("operations" in body) {
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
                  label: "Panel A",
                  subtitle: "panel-a",
                  fields: { owner: "Alice", visibility: "Private", template: "No", updatedAt: "2026-11-23T00:00:00Z" },
                },
                {
                  primaryKey: "panel-b",
                  label: "Panel B",
                  subtitle: "panel-b",
                  fields: { owner: "Alice", visibility: "Private", template: "No", updatedAt: "2026-11-23T00:00:00Z" },
                },
              ],
              total: 2,
            },
          });
        }
        const readTargetKey = (req: DataReadRequest): string => {
          for (const value of Object.values(req.inputs ?? {})) {
            if (value && typeof value === "object" && "primaryKey" in value && typeof value.primaryKey === "string") {
              return value.primaryKey;
            }
          }
          return "";
        };
        if (member === "headerTitle" || member === "overviewSummary") {
          const key = readTargetKey(body);
          if (!key) return Response.json({ status: "empty" });
          return Response.json({
            status: "ready",
            value: {
              primaryKey: key,
              label: key === "panel-b" ? "Panel B" : "Panel A",
              subtitle: key,
              fields: { id: key, name: key === "panel-b" ? "Panel B" : "Panel A" },
              fieldLabels: { id: "ID", name: "Name" },
              outputs: {
                canEdit: true,
                canGrant: false,
                canDelete: true,
                isTemplate: false,
                domainShared: false,
                revision: 1,
                hiddenUsedByCount: 0,
              },
            },
          });
        }
        if (member === "form") {
          const key = readTargetKey(body);
          if (body.dataName === "createForm") {
            return Response.json({ status: "ready", value: formDescription("create", "") });
          }
          return Response.json({
            status: "ready",
            value: formDescription("edit", key),
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
        panelUses: [use],
      },
    ];

    const observed = { context: null as { state?: Record<string, unknown> } | null };
    const display = useConversationDisplay({
      features: () => [{ id: "panel", label: "Panels", icon: "pages", availability: "page", withConversation: true }],
      resolve: (address) => {
        const path = address.split("?")[0]!;
        return path === ENTRY_PATH ? { featureId: "panel", address, instance: path } : null;
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
      target: { kind: "page", address: ENTRY_PATH },
    });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/chat", component: { template: "<div />" } }],
    });
    await router.push("/chat");

    const Host = defineComponent({
      setup() {
        return () =>
          display.page.value
            ? h(PanelApplicationRoute, {
                applicationId: APP_ID,
                address: display.page.value.address,
                navigate: (address: string) => void display.navigate(address, { view: "side", history: "push" }),
                liveState: display.liveState.value,
                registerPageController: (controller: unknown) =>
                  display.registerPageController(display.page.value!.instance, controller as never),
                onDisplayAddress: display.address,
                onDisplayLoaded: display.loaded,
                onContext: (reported: { state?: Record<string, unknown> } | null) => {
                  observed.context = reported;
                  display.context(reported as never);
                },
              })
            : null;
      },
    });

    const mounted = mountPlatformPage(() => h(Host), router);
    try {
      // Wait for initial catalogue to settle.
      await waitFor(
        () => mounted.element.textContent?.includes("Panel A") === true && mounted.element.textContent?.includes("Panel B") === true,
        "initial panel list",
      );

      // 1. Agent asks to select Panel B and enter edit mode in a single present call.
      reads.length = 0;
      const editReceipt = await display.present(presentFrame({ selected: panelRef("panel-b"), detailMode: "edit" }));
      expect(editReceipt).toMatchObject({ status: "opened" });

      const targetKeyOf = (r: DataReadRequest) => {
        for (const value of Object.values(r.inputs ?? {})) {
          if (value && typeof value === "object" && "primaryKey" in value && typeof value.primaryKey === "string") {
            return value.primaryKey;
          }
        }
        return null;
      };

      await waitFor(
        () => reads.some((r) => r.memberPath[0]?.member === "form" && r.dataName === "form" && targetKeyOf(r) === "panel-b"),
        () => `panel-b edit form read (got: ${JSON.stringify(reads.map((r) => ({ m: r.memberPath[0]?.member, d: r.dataName, inputs: r.inputs })))}, ctx=${JSON.stringify(observed.context)}, receipt=${JSON.stringify(editReceipt)})`,
      );
      await waitFor(
        () => (mounted.element.querySelector(".pd-form-wrap input") as HTMLInputElement | null)?.value === "Panel panel-b",
        "panel-b edit form input value",
      );

      expect(observed.context?.state?.selected).toEqual(panelRef("panel-b"));
      expect(observed.context?.state?.detailMode).toBe("edit");

      // 2. Human clicks Panel A in the catalogue list -> leaves edit mode back to view mode.
      const rows = Array.from(mounted.element.querySelectorAll("tr"));
      const panelARow = rows.find((row) => row.textContent?.includes("Panel A"));
      expect(panelARow).toBeTruthy();
      panelARow!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      await waitFor(
        () => !mounted.element.querySelector(".pd-form-wrap") && observed.context?.state?.detailMode === "view",
        () => `human row click exits edit mode to view (hasForm=${Boolean(mounted.element.querySelector(".pd-form-wrap"))}, state=${JSON.stringify(observed.context?.state)})`,
      );
      expect(observed.context?.state?.selected).toEqual(panelRef("panel-a"));

      // 3. While Panel A is selected in view mode, a single present call selects Panel B and enters edit mode.
      reads.length = 0;
      const switchEditReceipt = await display.present(
        presentFrame({ selected: panelRef("panel-b"), detailMode: "edit" }, display.page.value!.address),
      );
      expect(switchEditReceipt).toMatchObject({ status: "opened" });
      await waitFor(
        () => reads.some((r) => r.memberPath[0]?.member === "form" && r.dataName === "form" && targetKeyOf(r) === "panel-b"),
        () => `panel-a -> panel-b direct edit form read (addr=${display.page.value?.address}, state=${JSON.stringify(observed.context?.state)}, reads=${JSON.stringify(reads.map((r) => [r.memberPath[0]?.member, r.dataName, r.inputs]))})`,
      );
      await waitFor(
        () => (mounted.element.querySelector(".pd-form-wrap input") as HTMLInputElement | null)?.value === "Panel panel-b",
        "panel-a -> panel-b edit form input value",
      );
      expect(observed.context?.state?.selected).toEqual(panelRef("panel-b"));
      expect(observed.context?.state?.detailMode).toBe("edit");

      // 4. Agent follows create recipe (`selected: null, creating: true`) while Panel B is selected.
      reads.length = 0;
      const createReceipt = await display.present(
        presentFrame({ selected: null, creating: true }, display.page.value!.address),
      );
      expect(createReceipt).toMatchObject({ status: "opened" });

      await waitFor(
        () => reads.some((r) => r.memberPath[0]?.member === "form" && r.dataName === "createForm" && targetKeyOf(r) === null),
        "createForm read with cleared selection",
      );
      expect(observed.context?.state?.selected ?? null).toBeNull();
      expect(observed.context?.state?.creating).toBe(true);
      expect(reads.some((r) => r.memberPath[0]?.member === "form" && r.dataName === "form")).toBe(false);
    } finally {
      mounted.app.unmount();
    }
  });
});
