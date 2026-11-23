/* eslint-disable vue/one-component-per-file */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type Component } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { DomainComponentRuntime } from "@ontomato/contracts/domain-components";
import {
  definePanel,
  type PanelManifest,
  type PanelMemberPath,
  type PanelOperationRowContext,
} from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelHumanOperationPreparation } from "@ontomato/contracts/panel-agent";
import {
  APPLICATION,
  ONTOLOGY_TYPE,
  PRODUCT_PANEL,
  ROLE,
  SCHEDULED_TASK,
  USER,
  WORKFLOW,
} from "@ontomato/contracts/platform-object-types";
import {
  createDirectPanelInstance,
  type DirectPanelInstance,
  type PanelMemberReadRequest,
} from "../../../../../packages/apps-sdk/src/panel/direct";
import { mountDirectPanel } from "../../../../../packages/apps-sdk/src/panel/direct-mount";
import type { ConfirmPanelOperation, PanelWriteInvocation } from "../../../../../packages/apps-sdk/src/panel/human-operations";
import { useMember } from "../../../../../packages/apps-sdk/src/panel/member";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { loadDomainComponent } from "../../../../../packages/platform-web/src/domain-component";
import { noOperations } from "./panel-frame";

const meta = {
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "2026-11-22T00:00:00.000Z",
  updatedAt: "2026-11-22T00:00:00.000Z",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

type Read = PanelMemberReadRequest;
const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

interface PreparedCall {
  operationId: string;
  invocation: PanelWriteInvocation;
  memberPath?: PanelMemberPath;
  rowContext?: PanelOperationRowContext;
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function mountDirectTest(options: {
  manifest: PanelManifest;
  projections: Record<string, DirectProjection>;
  answer: (request: Read) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>;
  members?: readonly string[];
  initial?: Record<string, unknown>;
  messages?: Record<string, Record<string, string>>;
  memberPath?: PanelMemberPath;
  frameState?: () => Readonly<Record<string, RuntimeJsonValue>> | undefined;
  loadDomainComponent?: (projection: DirectProjection) => Promise<Component>;
  prepare?: (call: PreparedCall) => Promise<PanelHumanOperationPreparation>;
  confirmOperation?: (
    preparation: PanelHumanOperationPreparation,
    instance: DirectPanelInstance,
  ) => ReturnType<ConfirmPanelOperation>;
}) {
  const reads: Read[] = [];
  const preparedCalls: PreparedCall[] = [];
  const readProjection = vi.fn(async (id: string) => {
    const found = options.projections[id];
    if (!found) throw new Error(`Unknown projection ${id}`);
    return found;
  });

  let instanceRef!: DirectPanelInstance;
  const instance = createDirectPanelInstance(options.manifest, {
    pageKey: "list-row-members-test",
    url: () => "/panels/list-row-members",
    label: () => "List row members test",
    initial: options.initial as never,
    ...(options.memberPath ? { memberPath: options.memberPath } : {}),
    ...(options.frameState ? { frameState: options.frameState } : {}),
    ...(options.loadDomainComponent ? { loadDomainComponent: options.loadDomainComponent } : {}),
    recordDraftCreated: async () => {},
    text: createPanelText(options.messages ?? {}, ref("en"), "en"),
    ...noOperations,
    operations: {
      ...noOperations.operations,
      async prepare(operationId, invocation, memberPath, rowContext) {
        const record: PreparedCall = { operationId, invocation, memberPath, rowContext };
        preparedCalls.push(record);
        if (options.prepare) return options.prepare(record);
        return {
          intentId: `intent-${preparedCalls.length}`,
          operationId,
          label: "Execute",
          confirmation: { kind: "none" },
        };
      },
    },
    confirmOperation: async (preparation) => {
      if (options.confirmOperation) return options.confirmOperation(preparation, instanceRef);
      return {
        decision: "confirm",
        response: {
          kind: "dispatched",
          intentId: preparation.intentId,
          outcome: { kind: "success", message: "Done", data: {} },
        },
      };
    },
    readProjection,
    read: async (request) => {
      reads.push(request);
      return options.answer(request);
    },
  });
  instanceRef = instance;

  const memberKeys = options.members ?? ["list"];
  const element = document.createElement("div");
  document.body.appendChild(element);
  const app = createApp({
    setup: () => () => h("div", memberKeys.map((member) => h(PanelMember, { instance, member, key: member }))),
  })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } as never }))
    .use(ElementPlus);
  app.mount(element);

  cleanup = () => {
    app.unmount();
    element.remove();
  };

  return { instance, element, reads, preparedCalls, readProjection };
}

describe("A3 listColumn, listRowDetail, row input isolation and row operations", () => {
  it("renders a domain-registered listColumn component once across rows with strict input isolation and click/Enter isolation", async () => {
    const domainComponentId = "domain-component:11111111-1111-4111-8111-111111111111";
    const receivedSnapshots: Array<{
      props: Record<string, unknown>;
      memberInputs: Record<string, unknown>;
      keys: string[];
    }> = [];
    const buttonClicks: string[] = [];

    const domainRuntime: DomainComponentRuntime = {
      domainId: "domain-1",
      componentId: domainComponentId,
      revision: 1,
      source: {
        template: `
          <div class="domain-app-cell" :data-pk="pk">
            <span class="domain-cell-passive">{{ icon }}:{{ title }}:{{ tag }}</span>
            <button type="button" class="domain-cell-action" @click="onAction">Inspect {{ pk }}</button>
          </div>
        `,
        module: `
          export default {
            props: ["icon", "title", "tag", "pk", "secretField", "row"],
            setup(props) {
              return {
                onAction() {
                  globalThis.__testDomainCellClick?.(props.pk);
                },
              };
            },
          };
        `,
      },
    };

    const inspectedComponent = defineComponent({
      props: {
        icon: { type: String, default: undefined },
        title: { type: String, default: undefined },
        tag: { type: String, default: undefined },
        pk: { type: String, default: undefined },
        secretField: { type: String, default: undefined },
        row: { type: Object, default: undefined },
        appRef: { type: Object, default: undefined },
        configBadge: { type: String, default: undefined },
      },
      setup(props) {
        const member = useMember();
        receivedSnapshots.push({
          props: { ...props },
          memberInputs: { ...member.inputs.value },
          keys: Object.keys(member.inputs.value).sort(),
        });
        return () =>
          h("div", { class: "domain-app-cell", "data-pk": props.pk }, [
            h("span", { class: "domain-cell-passive" }, `${props.icon ?? ""}:${props.title ?? ""}:${props.tag ?? ""}:${props.configBadge ?? ""}`),
            h(
              "button",
              {
                type: "button",
                class: "domain-cell-action",
                // Intentionally omit event.stopPropagation() to verify host cell-wrapper isolation.
                onClick: () => buttonClicks.push(String(props.pk)),
              },
              `Inspect ${props.pk}`,
            ),
          ]);
      },
    });

    // Also verify real loadDomainComponent works for domain-component runtime caching.
    const realLoaded1 = await loadDomainComponent(domainRuntime);
    const realLoaded2 = await loadDomainComponent(domainRuntime);
    expect(realLoaded1).toBe(realLoaded2);

    const loadDomainSpy = vi.fn(async () => inspectedComponent);

    const projections: Record<string, DirectProjection> = {
      "apps-list": {
        ...meta,
        id: "apps-list",
        name: "Applications",
        componentId: "@ontomato/sdk:ObjectList",
        inputs: {},
        outputs: { selected: { kind: "object", objectType: APPLICATION } },
        config: {
          columns: [
            { key: "name", labelKey: "col.app" },
            { key: "status", labelKey: "col.status", kind: "tag" },
          ],
        },
        data: {
          rows: { source: { type: { kind: "PlatformObjectType", id: APPLICATION } }, read: "query", params: {} },
        },
      },
      "app-name-cell": {
        ...meta,
        id: "app-name-cell",
        name: "App name cell",
        componentId: domainComponentId,
        inputs: {
          icon: { kind: "scalar", type: "string" },
          title: { kind: "scalar", type: "string" },
          tag: { kind: "scalar", type: "string" },
          pk: { kind: "scalar", type: "string" },
          appRef: { kind: "object", objectType: APPLICATION },
        },
        outputs: {},
        config: { configBadge: "v1" },
        data: {},
      },
    };

    const manifest = definePanel({
      state: {
        selected: { type: { kind: "object", objectType: APPLICATION }, deepLink: true },
        hiddenPanelSecret: { type: { kind: "scalar", type: "string" }, default: "top-secret-state" },
      },
      members: {
        apps: {
          target: { projectionId: "apps-list" },
          outputs: { selected: { state: "selected" } },
        },
        appNameCell: {
          target: { projectionId: "app-name-cell" },
          listColumn: { slot: "apps", column: "name" },
          inputs: {
            icon: { itemField: "icon" },
            title: { item: "label" },
            pk: { item: "primaryKey" },
            tag: { literal: "pinned" },
            appRef: { item: true },
          },
        },
      },
    });

    const { instance, element, reads, readProjection } = mountDirectTest({
      manifest,
      projections,
      members: ["apps"], // No <PanelMember member="appNameCell"> placed!
      initial: { selected: { className: APPLICATION, primaryKey: "app-a" } },
      messages: { en: { "col.app": "Application", "col.status": "Status" } },
      loadDomainComponent: loadDomainSpy,
      answer: (request) => {
        if (request.dataName === "rows") {
          return ready({
            rows: [
              {
                primaryKey: "app-a",
                label: "Alpha App",
                fields: { icon: "rocket", status: "active", secretField: "DO-NOT-LEAK-A" },
              },
              {
                primaryKey: "app-b",
                label: "Beta App",
                fields: { icon: "compass", status: "draft", secretField: "DO-NOT-LEAK-B" },
              },
            ],
            total: 2,
          });
        }
        throw new Error(`Unexpected read ${JSON.stringify(request)}`);
      },
    });

    await vi.waitFor(() => {
      expect(element.querySelectorAll(".domain-app-cell")).toHaveLength(2);
    });

    // Projection and domain component module loaded ONCE and reused across both rows.
    expect(readProjection.mock.calls.filter(([id]) => id === "app-name-cell")).toHaveLength(1);
    expect(loadDomainSpy).toHaveBeenCalledTimes(1);
    // listColumn with no operations issues zero extra reads (only the host list's rows read).
    expect(reads).toHaveLength(1);
    expect(reads[0]?.dataName).toBe("rows");

    // Strict input isolation: only declared inputs arrive; undeclared fields, row object and undeclared state never leak.
    expect(receivedSnapshots).toHaveLength(2);
    for (const snap of receivedSnapshots) {
      expect(snap.keys).toEqual(["appRef", "icon", "pk", "tag", "title"]);
      expect(snap.props.secretField).toBeUndefined();
      expect(snap.props.row).toBeUndefined();
      expect(snap.memberInputs).not.toHaveProperty("secretField");
      expect(snap.memberInputs).not.toHaveProperty("hiddenPanelSecret");
      expect(snap.memberInputs).not.toHaveProperty("status");
    }
    expect(receivedSnapshots[0]?.props).toMatchObject({
      icon: "rocket",
      title: "Alpha App",
      pk: "app-a",
      tag: "pinned",
      configBadge: "v1",
      appRef: { className: APPLICATION, primaryKey: "app-a" },
    });

    // Clicking button inside row B cell fires button handler WITHOUT changing selection away from app-a.
    const rowBButton = element.querySelector<HTMLButtonElement>('[data-pk="app-b"] .domain-cell-action')!;
    rowBButton.click();
    await nextTick();
    expect(buttonClicks).toEqual(["app-b"]);
    expect(instance.state.values.value.selected).toEqual({ className: APPLICATION, primaryKey: "app-a" });

    // Pressing Enter on the button inside row B cell does NOT change selection either.
    rowBButton.focus();
    rowBButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await nextTick();
    expect(instance.state.values.value.selected).toEqual({ className: APPLICATION, primaryKey: "app-a" });

    // Clicking passive text inside row B cell DOES select row B.
    const rowBPassive = element.querySelector<HTMLElement>('[data-pk="app-b"] .domain-cell-passive')!;
    rowBPassive.click();
    await nextTick();
    expect(instance.state.values.value.selected).toEqual({ className: APPLICATION, primaryKey: "app-b" });
  });

  it("forbids independent data reads on listColumn members and skips eager mounting in mountDirectPanel", async () => {
    const projections: Record<string, DirectProjection> = {
      "apps-list": {
        ...meta,
        id: "apps-list",
        name: "Applications",
        componentId: "@ontomato/sdk:ObjectList",
        inputs: {},
        outputs: {},
        config: { columns: [{ key: "name", labelKey: "col.app" }] },
        data: {
          rows: { source: { type: { kind: "PlatformObjectType", id: APPLICATION } }, read: "query", params: {} },
        },
      },
      "bad-column": {
        ...meta,
        id: "bad-column",
        name: "Bad column with data",
        componentId: "@ontomato/sdk:ObjectSummary",
        inputs: { target: { kind: "object", objectType: APPLICATION } },
        outputs: {},
        config: {},
        data: {
          record: { source: { object: { input: "target" } }, read: "record", params: {} },
        },
      },
    };
    const manifest = definePanel({
      state: {},
      members: {
        apps: { target: { projectionId: "apps-list" } },
        badCell: {
          target: { projectionId: "bad-column" },
          listColumn: { slot: "apps", column: "name" },
          inputs: { target: { item: true } },
        },
      },
    });

    // Verify mountDirectPanel does NOT eagerly place listColumn/listRowDetail members.
    const readProjectionRequests: string[] = [];
    const directMount = mountDirectPanel({
      manifest,
      run: {
        pageKey: "mount-skip-test",
        url: () => "/mount-skip",
        label: () => "Mount skip",
        initial: {},
        state: () => {},
        context: () => {},
        operations: () => {},
        dirty: () => {},
        draftSettled: () => {},
        draftRefused: () => {},
        draftOpened: () => {},
        failed: () => {},
      },
      requests: {
        request: async (path) => {
          readProjectionRequests.push(path);
          const id = path.split("/").pop()!;
          return Response.json({ projection: projections[id] });
        },
      },
      use: null,
      messages: {},
      locale: ref("en"),
      defaultLocale: "en",
      read: async () => ready({ rows: [], total: 0 }),
      confirmOperation: async () => ({ decision: "cancel" }),
      expandPageComposer: () => {},
      navigate: async () => {},
      nested: async () => {
        throw new Error("no nested");
      },
    });
    await vi.waitFor(() => {
      expect(readProjectionRequests).toContain("/product-projections/apps-list");
    });
    expect(readProjectionRequests).not.toContain("/product-projections/bad-column");
    directMount.dispose();

    // Verify rendering a listColumn with declared data shows an error and never issues its data read.
    const { element, reads } = mountDirectTest({
      manifest,
      projections,
      members: ["apps"],
      messages: { en: { "col.app": "App" } },
      answer: (request) => {
        if (request.dataName === "rows") {
          return ready({ rows: [{ primaryKey: "app-1", label: "App 1", fields: {} }], total: 1 });
        }
        throw new Error(`Forbidden independent read: ${request.dataName}`);
      },
    });

    await vi.waitFor(() => {
      expect(element.textContent).toContain("listColumn member 'badCell' cannot declare independent data reads");
    });
    expect(reads.map((r) => r.dataName)).toEqual(["rows"]);
  });

  it("mounts listRowDetail only on expand, reads row data without itemKey/rowContext, cleans up on collapse, and works in table & cards modes", async () => {
    for (const layout of ["table", "cards"] as const) {
      const projections: Record<string, DirectProjection> = {
        "apps-list": {
          ...meta,
          id: "apps-list",
          name: "Applications",
          componentId: "@ontomato/sdk:ObjectList",
          inputs: {},
          outputs: {},
          config: {
            layout,
            columns: [{ key: "status", labelKey: "col.status", kind: "tag" }],
          },
          data: {
            rows: { source: { type: { kind: "PlatformObjectType", id: APPLICATION } }, read: "query", params: {} },
          },
        },
        "app-row-detail": {
          ...meta,
          id: "app-row-detail",
          name: "App detail",
          componentId: "@ontomato/sdk:ObjectSummary",
          inputs: { target: { kind: "object", objectType: APPLICATION } },
          outputs: {},
          config: { fields: ["owner"] },
          data: {
            record: { source: { object: { input: "target" } }, read: "record", params: {} },
          },
        },
      };

      const manifest = definePanel({
        state: {},
        members: {
          apps: { target: { projectionId: "apps-list" } },
          rowDetail: {
            target: { projectionId: "app-row-detail" },
            listRowDetail: { slot: "apps" },
            inputs: { target: { item: true } },
          },
        },
      });

      const { instance, element, reads } = mountDirectTest({
        manifest,
        projections,
        members: ["apps"],
        messages: { en: { "col.status": "Status" } },
        answer: (request) => {
          if (request.dataName === "rows") {
            return ready({
              rows: [
                { primaryKey: "app-1", label: "Alpha", fields: { status: "active" } },
                { primaryKey: "app-2", label: "Beta", fields: { status: "draft" } },
              ],
              total: 2,
            });
          }
          if (request.dataName === "record") {
            const target = request.inputs.target as { primaryKey: string };
            return ready({
              primaryKey: target.primaryKey,
              label: `Detail ${target.primaryKey}`,
              fields: { owner: `Owner of ${target.primaryKey}` },
              fieldLabels: { owner: "Owner" },
            });
          }
          throw new Error(`Unexpected read ${JSON.stringify(request)}`);
        },
      });

      await vi.waitFor(() => {
        expect(element.querySelectorAll(".sdk-object-list-expand-btn")).toHaveLength(2);
      });

      // Unexpanded: zero detail mounts and zero detail reads.
      expect(element.querySelector(".sdk-object-list-detail-host")).toBeNull();
      expect(reads.filter((r) => r.dataName === "record")).toHaveLength(0);

      // Expand row 2 (Beta).
      const expandBtns = element.querySelectorAll<HTMLButtonElement>(".sdk-object-list-expand-btn");
      expect(expandBtns[1]!.getAttribute("aria-expanded")).toBe("false");
      expandBtns[1]!.click();

      await vi.waitFor(() => {
        expect(element.textContent).toContain("Owner of app-2");
      });
      expect(expandBtns[1]!.getAttribute("aria-expanded")).toBe("true");

      // Detail read must carry normal memberPath with NO itemKey and NO rowContext.
      const detailReads = reads.filter((r) => r.dataName === "record");
      expect(detailReads).toHaveLength(1);
      expect(detailReads[0]).toEqual({
        memberPath: [{ member: "rowDetail" }],
        dataName: "record",
        inputs: { target: { className: APPLICATION, primaryKey: "app-2" } },
      });
      expect(detailReads[0]!.memberPath[0]).not.toHaveProperty("itemKey");
      expect(detailReads[0]).not.toHaveProperty("rowContext");

      // Refresh for app-2 re-reads while expanded.
      instance.refresh({ objects: [{ objectType: APPLICATION, primaryKey: "app-2" }], objectTypes: [] });
      await vi.waitFor(() => {
        expect(reads.filter((r) => r.dataName === "record")).toHaveLength(2);
      });

      // Collapse row 2 -> unmounts cleanly; subsequent refresh does NOT re-read collapsed detail.
      expandBtns[1]!.click();
      await nextTick();
      expect(element.querySelector(".sdk-object-list-detail-host")).toBeNull();
      expect(expandBtns[1]!.getAttribute("aria-expanded")).toBe("false");

      instance.refresh({ objects: [{ objectType: APPLICATION, primaryKey: "app-2" }], objectTypes: [] });
      await nextTick();
      expect(reads.filter((r) => r.dataName === "record")).toHaveLength(2);

      cleanup?.();
      cleanup = null;
    }
  });

  it("executes per-row OperationButton on unselected row B while row A is selected, with outer target + rowContext + affected refresh (table & cards)", async () => {
    for (const layout of ["table", "cards"] as const) {
      let grantRows = [
        { primaryKey: "grant-a", label: "Alice", fields: { principalKind: "user", principalId: "u-a", verb: "use" } },
        { primaryKey: "grant-b", label: "Bob", fields: { principalKind: "user", principalId: "u-b", verb: "edit" } },
      ];
      const confirmedIntentIds: string[] = [];

      const projections: Record<string, DirectProjection> = {
        "grants-list": {
          ...meta,
          id: "grants-list",
          name: "Application grants",
          componentId: "@ontomato/sdk:ObjectList",
          inputs: { app: { kind: "object", objectType: APPLICATION } },
          outputs: { selected: { kind: "object", objectType: APPLICATION } },
          config: {
            layout,
            columns: [
              { key: "principalId", labelKey: "col.principal" },
              { key: "verb", labelKey: "col.verb", kind: "tag" },
              { key: "actions", labelKey: "col.actions" },
            ],
          },
          data: {
            rows: {
              source: { type: { kind: "PlatformObjectType", id: APPLICATION } },
              read: "query",
              params: {},
            },
          },
        },
        "revoke-grant": {
          ...meta,
          id: "revoke-grant",
          name: "Revoke grant",
          componentId: "@ontomato/sdk:OperationButton",
          inputs: {
            target: { kind: "object", objectType: APPLICATION },
            principalKind: { kind: "scalar", type: "string" },
            principalId: { kind: "scalar", type: "string" },
            verb: { kind: "scalar", type: "string" },
            remove: { kind: "scalar", type: "boolean" },
          },
          outputs: {},
          config: { operation: "revoke", type: "danger" },
          data: {},
          operations: {
            revoke: {
              operation: { kind: "PlatformOperation", id: `${APPLICATION}.grant` },
              target: { input: "target" },
              params: {
                principalKind: { input: "principalKind" },
                principalId: { input: "principalId" },
                verb: { input: "verb" },
                remove: { input: "remove" },
              },
            },
          },
        },
      };

      const manifest = definePanel({
        state: {
          selectedApp: { type: { kind: "object", objectType: APPLICATION }, deepLink: true },
          selectedGrant: { type: { kind: "object", objectType: APPLICATION }, deepLink: false },
        },
        members: {
          grants: {
            target: { projectionId: "grants-list" },
            inputs: { app: { state: "selectedApp" } },
            outputs: { selected: { state: "selectedGrant" } },
          },
          revokeGrant: {
            target: { projectionId: "revoke-grant" },
            listColumn: { slot: "grants", column: "actions" },
            inputs: {
              target: { state: "selectedApp" },
              principalKind: { itemField: "principalKind" },
              principalId: { itemField: "principalId" },
              verb: { itemField: "verb" },
              remove: { literal: true },
            },
          },
        },
      });

      const { instance, element, reads, preparedCalls } = mountDirectTest({
        manifest,
        projections,
        members: ["grants"],
        initial: {
          selectedApp: { className: APPLICATION, primaryKey: "app-main" },
          selectedGrant: { className: APPLICATION, primaryKey: "grant-a" },
        },
        frameState: () => ({ tenantScope: "prod" }),
        messages: { en: { "col.principal": "Principal", "col.verb": "Permission", "col.actions": "Actions" } },
        answer: (request) => {
          if (request.operations) {
            expect(request.memberPath[0]).not.toHaveProperty("itemKey");
            return ready({
              revoke: {
                kind: "action",
                effect: "write",
                label: "Revoke",
                handlerRef: `${APPLICATION}.grant`,
                inputSchema: {},
                resultSchema: {},
                target: { source: "input", input: "target" },
                batch: false,
              },
            });
          }
          if (request.dataName === "rows") {
            return ready({ rows: grantRows, total: grantRows.length });
          }
          throw new Error(`Unexpected read ${JSON.stringify(request)}`);
        },
        prepare: async ({ operationId, memberPath }) => {
          const itemKey = memberPath?.at(-1)?.itemKey;
          return {
            intentId: `intent-${String(itemKey)}`,
            operationId,
            label: "Revoke",
            confirmation: {
              kind: "impact",
              impact: {
                summary: `Revoke grant ${String(itemKey)} on app-main`,
                objects: [{ target: { objectType: APPLICATION, primaryKey: "app-main" }, label: "Main App" }],
                total: 1,
              },
            },
          };
        },
        confirmOperation: async (preparation, inst) => {
          confirmedIntentIds.push(preparation.intentId);
          // Simulate server removing grant-b and reporting affected objectType so host list refreshes.
          grantRows = grantRows.filter((row) => row.primaryKey !== "grant-b");
          const affected = {
            objects: [{ objectType: APPLICATION, primaryKey: "app-main" }],
            objectTypes: [APPLICATION],
          };
          inst.refresh(affected);
          return {
            decision: "confirm",
            response: {
              kind: "dispatched",
              intentId: preparation.intentId,
              outcome: { kind: "success", message: "Revoked", data: {}, affected },
            },
          };
        },
      });

      await vi.waitFor(() => {
        expect(element.querySelectorAll(".sdk-operation-button button")).toHaveLength(2);
      });

      // Outer-target operations:true read is shared across both rows (1 read, not 2).
      expect(reads.filter((r) => r.operations)).toHaveLength(1);

      // Type into search box so host list has active runtimeParams (`search` + `size`).
      const searchInput = element.querySelector<HTMLInputElement>(".sdk-object-list-search")!;
      searchInput.value = "bob";
      searchInput.dispatchEvent(new Event("input"));
      await nextTick();

      // Row A is selected; click Revoke on unselected Row B.
      const buttons = element.querySelectorAll<HTMLButtonElement>(".sdk-operation-button button");
      buttons[1]!.click();

      await vi.waitFor(() => {
        expect(confirmedIntentIds).toEqual(["intent-grant-b"]);
      });

      // Verify prepared single call (no calls, no client-supplied target), terminal itemKey = "grant-b", and full rowContext.
      expect(preparedCalls).toHaveLength(1);
      expect(preparedCalls[0]).toEqual({
        operationId: "revokeGrant.revoke",
        invocation: { call: { input: {} } },
        memberPath: [{ member: "revokeGrant", itemKey: "grant-b" }],
        rowContext: {
          state: {
            selectedApp: { className: APPLICATION, primaryKey: "app-main" },
            selectedGrant: { className: APPLICATION, primaryKey: "grant-a" },
          },
          frameState: { tenantScope: "prod" },
          runtimeParams: { search: "bob", size: 20 },
        },
      });

      // Selection stayed on row A (did NOT switch to row B).
      expect(instance.state.values.value.selectedGrant).toEqual({
        className: APPLICATION,
        primaryKey: "grant-a",
      });

      // Affected refresh reloaded the host list, leaving only grant-a.
      await vi.waitFor(() => {
        expect(element.querySelectorAll(".sdk-operation-button button")).toHaveLength(1);
      });

      cleanup?.();
      cleanup = null;
    }
  });

  it("constructs heterogeneous { className, primaryKey } itemKey, propagates nested ancestor memberPath, and blocks bound operation.params overrides", async () => {
    const boundOverrideErrors: string[] = [];

    const customActionCell = defineComponent({
      props: { pk: { type: String, default: undefined } },
      setup(props) {
        const member = useMember();
        return () =>
          h("div", { class: "custom-op-cell" }, [
            h(
              "button",
              {
                type: "button",
                class: "run-valid-btn",
                onClick: () => void member.rowOperation?.run("run", { note: "ok" }),
              },
              `Run ${props.pk}`,
            ),
            h(
              "button",
              {
                type: "button",
                class: "run-tampered-btn",
                onClick: () => {
                  void member.rowOperation?.run("run", { fixedFlag: false }).catch((err: unknown) => {
                    boundOverrideErrors.push(err instanceof Error ? err.message : String(err));
                  });
                },
              },
              "Tamper",
            ),
          ]);
      },
    });

    const projections: Record<string, DirectProjection> = {
      "hetero-list": {
        ...meta,
        id: "hetero-list",
        name: "Objects",
        componentId: "@ontomato/sdk:ObjectList",
        inputs: {},
        outputs: {},
        config: {
          columns: [
            { key: "label", labelKey: "col.name" },
            { key: "actions", labelKey: "col.actions" },
          ],
        },
        data: {
          objects: {
            source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } },
            read: "objects",
            params: { type: { literal: WORKFLOW } },
          },
        },
      },
      "custom-op-cell": {
        ...meta,
        id: "custom-op-cell",
        name: "Custom op cell",
        componentId: "domain-component:22222222-2222-4222-8222-222222222222",
        inputs: {
          target: { kind: "object-union", objectTypes: [WORKFLOW, ROLE, USER] },
          pk: { kind: "scalar", type: "string" },
          fixedFlag: { kind: "scalar", type: "boolean" },
        },
        outputs: {},
        config: {},
        data: {},
        operations: {
          run: {
            operation: { kind: "PlatformOperation", id: `${WORKFLOW}.run` },
            target: { input: "target" },
            params: { fixedFlag: { input: "fixedFlag" } },
          },
        },
      },
    };

    const manifest = definePanel({
      state: {
        filter: { type: { kind: "scalar", type: "string" }, default: "all" },
      },
      members: {
        catalog: { target: { projectionId: "hetero-list" } },
        rowRunner: {
          target: { projectionId: "custom-op-cell" },
          listColumn: { slot: "catalog", column: "actions" },
          inputs: {
            target: { item: true },
            pk: { item: "primaryKey" },
            fixedFlag: { literal: true },
          },
        },
      },
    });

    const ancestorPath: PanelMemberPath = [
      {
        member: "workspacePane",
        selection: {
          stateValue: { className: PRODUCT_PANEL, primaryKey: "child-panel-1" },
          target: { panelId: "child-panel-1" },
        },
      },
    ];

    const { element, preparedCalls } = mountDirectTest({
      manifest,
      projections,
      members: ["catalog"],
      memberPath: ancestorPath,
      messages: { en: { "col.name": "Name", "col.actions": "Actions" } },
      loadDomainComponent: async () => customActionCell,
      answer: (request) => {
        if (request.operations) {
          return ready({
            run: {
              kind: "action",
              effect: "write",
              label: "Run",
              handlerRef: `${WORKFLOW}.run`,
              inputSchema: {},
              resultSchema: {},
              target: { source: "input", input: "target" },
              batch: false,
            },
          });
        }
        if (request.dataName === "objects") {
          return ready({
            status: "ok",
            type: WORKFLOW,
            layer: "capability",
            page: 1,
            pageSize: 20,
            total: 2,
            items: [
              { node: { className: WORKFLOW, primaryKey: "wf-1" }, label: "Workflow 1" },
              { node: { className: ROLE, primaryKey: "role-2" }, label: "Role 2" },
            ],
          });
        }
        throw new Error(`Unexpected read ${JSON.stringify(request)}`);
      },
    });

    await vi.waitFor(() => {
      expect(element.querySelectorAll(".run-valid-btn")).toHaveLength(2);
    });

    // Click row 2 (Role 2) -> heterogeneous itemKey { className, primaryKey } + full nested ancestor memberPath.
    element.querySelectorAll<HTMLButtonElement>(".run-valid-btn")[1]!.click();
    await vi.waitFor(() => {
      expect(preparedCalls).toHaveLength(1);
    });
    expect(preparedCalls[0]).toEqual({
      operationId: "workspacePane.rowRunner.run",
      invocation: { call: { input: { note: "ok" } } },
      memberPath: [
        ancestorPath[0],
        { member: "rowRunner", itemKey: { className: ROLE, primaryKey: "role-2" } },
      ],
      rowContext: {
        state: { filter: "all" },
        runtimeParams: { page: { number: 1, size: 20 } },
      },
    });

    // Attempt to override bound `fixedFlag` parameter -> rejected client-side and never reaches prepare().
    element.querySelectorAll<HTMLButtonElement>(".run-tampered-btn")[1]!.click();
    await vi.waitFor(() => {
      expect(boundOverrideErrors).toHaveLength(1);
    });
    expect(boundOverrideErrors[0]).toContain("fixedFlag");
    expect(preparedCalls).toHaveLength(1);
  });

  it("skips expanded table detail rows during ArrowDown/ArrowUp keyboard navigation and runs row operations inside listRowDetail", async () => {
    const projections: Record<string, DirectProjection> = {
      "apps-list": {
        ...meta,
        id: "apps-list",
        name: "Applications",
        componentId: "@ontomato/sdk:ObjectList",
        inputs: {},
        outputs: { selected: { kind: "object", objectType: APPLICATION } },
        config: {
          layout: "table",
          columns: [{ key: "status", labelKey: "col.status", kind: "tag" }],
        },
        data: {
          rows: { source: { type: { kind: "PlatformObjectType", id: APPLICATION } }, read: "query", params: {} },
        },
      },
      "row-detail-op": {
        ...meta,
        id: "row-detail-op",
        name: "Row detail operation",
        componentId: "@ontomato/sdk:OperationButton",
        inputs: { target: { kind: "object", objectType: APPLICATION } },
        outputs: {},
        config: { operation: "archive" },
        data: {},
        operations: {
          archive: {
            operation: { kind: "PlatformOperation", id: `${APPLICATION}.delete` },
            target: { input: "target" },
          },
        },
      },
    };

    const manifest = definePanel({
      state: {
        selected: { type: { kind: "object", objectType: APPLICATION }, deepLink: true },
      },
      members: {
        apps: {
          target: { projectionId: "apps-list" },
          outputs: { selected: { state: "selected" } },
        },
        rowDetailAction: {
          target: { projectionId: "row-detail-op" },
          listRowDetail: { slot: "apps" },
          inputs: { target: { item: true } },
        },
      },
    });

    const { instance, element, preparedCalls } = mountDirectTest({
      manifest,
      projections,
      members: ["apps"],
      initial: { selected: { className: APPLICATION, primaryKey: "app-1" } },
      messages: { en: { "col.status": "Status" } },
      answer: (request) => {
        if (request.operations) {
          return ready({
            archive: {
              kind: "action",
              effect: "write",
              label: "Archive",
              handlerRef: `${APPLICATION}.delete`,
              inputSchema: {},
              resultSchema: {},
              target: { source: "input", input: "target" },
              batch: false,
            },
          });
        }
        if (request.dataName === "rows") {
          return ready({
            rows: [
              { primaryKey: "app-1", label: "Alpha", fields: { status: "active" } },
              { primaryKey: "app-2", label: "Beta", fields: { status: "active" } },
            ],
            total: 2,
          });
        }
        throw new Error(`Unexpected read ${JSON.stringify(request)}`);
      },
    });

    await vi.waitFor(() => {
      expect(element.querySelectorAll('tr[data-row-item="true"]')).toHaveLength(2);
    });

    // Expand row 1 so a detail <tr> sits between row 1 and row 2.
    const expandBtns = element.querySelectorAll<HTMLButtonElement>(".sdk-object-list-expand-btn");
    expandBtns[0]!.click();
    await vi.waitFor(() => {
      expect(element.querySelector(".sdk-object-list-detail-row .sdk-operation-button button")).not.toBeNull();
    });

    // ArrowDown from row 1 focuses row 2 (skipping the detail <tr>), and ArrowUp returns to row 1.
    const dataRows = element.querySelectorAll<HTMLTableRowElement>('tr[data-row-item="true"]');
    dataRows[0]!.focus();
    dataRows[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(dataRows[1]);
    dataRows[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(dataRows[0]);

    // Expand row 2 while row 1 is selected: row 1 automatically collapses (one expanded row at a time),
    // and clicking Archive inside row 2's detail targets row 2 without changing selection.
    expandBtns[1]!.click();
    await vi.waitFor(() => {
      expect(expandBtns[0]!.getAttribute("aria-expanded")).toBe("false");
      expect(expandBtns[1]!.getAttribute("aria-expanded")).toBe("true");
      expect(element.querySelectorAll(".sdk-object-list-detail-row .sdk-operation-button button")).toHaveLength(1);
    });
    element.querySelector<HTMLButtonElement>(".sdk-object-list-detail-row .sdk-operation-button button")!.click();
    await vi.waitFor(() => {
      expect(preparedCalls).toHaveLength(1);
    });
    expect(preparedCalls[0]).toEqual({
      operationId: "rowDetailAction.archive",
      invocation: { call: { input: {} } },
      memberPath: [{ member: "rowDetailAction", itemKey: "app-2" }],
      rowContext: {
        state: { selected: { className: APPLICATION, primaryKey: "app-1" } },
        runtimeParams: { size: 20 },
      },
    });
    expect(instance.state.values.value.selected).toEqual({ className: APPLICATION, primaryKey: "app-1" });
  });

  it("expands only one row detail at a time with row-specific aria-labels and scrolls expanded detail into view", async () => {
    const scrollIntoViewSpy = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoViewSpy;
    try {
      const projections: Record<string, DirectProjection> = {
        "entries-list": {
          ...meta,
          id: "entries-list",
          name: "Entries",
          componentId: "@ontomato/sdk:ObjectList",
          inputs: {},
          outputs: { selected: { kind: "object", objectType: APPLICATION } },
          config: {},
          data: { rows: { source: { type: { kind: "PlatformObjectType", id: APPLICATION } }, read: "query", params: {} } },
        },
        "row-detail": {
          ...meta,
          id: "row-detail",
          name: "Row detail",
          componentId: "@ontomato/sdk:ObjectSummary",
          inputs: { target: { kind: "object", objectType: APPLICATION } },
          outputs: {},
          config: { fields: ["owner"] },
          data: {
            record: {
              source: { object: { input: "target" } },
              read: "record",
              params: {},
            },
          },
        },
      };
      const manifest = definePanel({
        state: { selected: { type: { kind: "object", objectType: APPLICATION } } },
        members: {
          list: { target: { projectionId: "entries-list" }, outputs: { selected: { state: "selected" } } },
          detail: {
            target: { projectionId: "row-detail" },
            listRowDetail: { slot: "list" },
            inputs: { target: { item: true } },
          },
        },
      });

      const { element } = mountDirectTest({
        manifest,
        projections,
        members: ["list"],
        answer: (request) => {
          if (request.dataName === "rows") {
            return ready({
              rows: [
                { primaryKey: "app-1", label: "Alpha", fields: {} },
                { primaryKey: "app-2", label: "Beta", fields: {} },
              ],
              total: 2,
            });
          }
          const target = request.inputs.target as { primaryKey: string };
          return ready({
            primaryKey: target.primaryKey,
            label: `Detail ${target.primaryKey}`,
            fields: { owner: `Owner of ${target.primaryKey}` },
            fieldLabels: { owner: "Owner" },
          });
        },
      });

      await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-list-expand-btn")).toHaveLength(2));
      const expandBtns = element.querySelectorAll<HTMLButtonElement>(".sdk-object-list-expand-btn");
      expect(expandBtns[0]!.getAttribute("aria-label")).toBe("Expand Alpha");
      expect(expandBtns[1]!.getAttribute("aria-label")).toBe("Expand Beta");

      // Expand row 1 -> aria-label updates to Collapse Alpha and detail scrolls into view.
      expandBtns[0]!.click();
      await vi.waitFor(() => expect(element.textContent).toContain("Owner of app-1"));
      expect(expandBtns[0]!.getAttribute("aria-expanded")).toBe("true");
      expect(expandBtns[0]!.getAttribute("aria-label")).toBe("Collapse Alpha");
      expect(scrollIntoViewSpy).toHaveBeenCalledWith({ block: "nearest" });

      // Expand row 2 -> row 1 automatically collapses and row 2's detail scrolls into view.
      scrollIntoViewSpy.mockClear();
      expandBtns[1]!.click();
      await vi.waitFor(() => expect(element.textContent).toContain("Owner of app-2"));
      expect(element.querySelectorAll(".sdk-object-list-row-detail")).toHaveLength(1);
      expect(expandBtns[0]!.getAttribute("aria-expanded")).toBe("false");
      expect(expandBtns[0]!.getAttribute("aria-label")).toBe("Expand Alpha");
      expect(expandBtns[1]!.getAttribute("aria-expanded")).toBe("true");
      expect(expandBtns[1]!.getAttribute("aria-label")).toBe("Collapse Beta");
      expect(scrollIntoViewSpy).toHaveBeenCalledWith({ block: "nearest" });
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("embeds ObjectForm inside listRowDetail expansion cleanly without height collapse or double-scroll rules", async () => {
    const projections: Record<string, DirectProjection> = {
      "entries-list": {
        ...meta,
        id: "entries-list",
        name: "Entries",
        componentId: "@ontomato/sdk:ObjectList",
        inputs: {},
        outputs: { selected: { kind: "object", objectType: SCHEDULED_TASK } },
        config: {},
        data: { rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} } },
      },
      "entry-form": {
        ...meta,
        id: "entry-form",
        name: "Entry form",
        componentId: "@ontomato/sdk:ObjectForm",
        inputs: { row: { kind: "object", objectType: SCHEDULED_TASK } },
        outputs: {},
        config: {},
        data: {
          form: {
            source: { object: { input: "row" } },
            read: "form",
            params: {},
          },
        },
        operations: {
          save: {
            operation: { kind: "PlatformOperation", id: `${SCHEDULED_TASK}.save` },
            target: { input: "row" },
          },
        },
      },
    };
    const manifest = definePanel({
      state: { selected: { type: { kind: "object", objectType: SCHEDULED_TASK } } },
      members: {
        list: { target: { projectionId: "entries-list" }, outputs: { selected: { state: "selected" } } },
        rowForm: {
          target: { projectionId: "entry-form" },
          listRowDetail: { slot: "list" },
          inputs: { row: { item: true } },
        },
      },
    });

    const { element } = mountDirectTest({
      manifest,
      projections,
      members: ["list"],
      answer(request) {
        if (request.dataName === "rows") {
          return ready([{ primaryKey: "app-1", label: "Daily Sync", fields: {} }]);
        }
        return ready({
          fields: [
            {
              path: "/name",
              label: "Name",
              required: true,
              readOnly: false,
              valueSchema: { type: "string" },
              control: { kind: "text", multiline: false },
            },
          ],
          values: { name: "Daily Sync" },
          errors: [],
          revision: 1,
          save: {
            method: "PUT",
            path: "/apps/:id",
            bodySchema: {},
            draftOperation: "app.update",
          },
        });
      },
    });

    await vi.waitFor(() => expect(element.querySelector(".sdk-object-list-expand-btn")).not.toBeNull());
    element.querySelector<HTMLButtonElement>(".sdk-object-list-expand-btn")!.click();
    await vi.waitFor(() => expect(element.querySelector(".sdk-object-list-row-detail .sdk-owner-form")).not.toBeNull());
    await vi.waitFor(() => {
      expect(element.querySelector<HTMLInputElement>(".sdk-object-list-row-detail input")?.value).toBe("Daily Sync");
    });

    const repoRoot = resolve(import.meta.dirname, "../../../../..");
    const listRowMemberSource = readFileSync(
      resolve(repoRoot, "packages/apps-sdk/src/base/ListRowMember.vue"),
      "utf8",
    );
    expect(listRowMemberSource).toContain(".sdk-object-list-detail-host :deep(.sdk-owner-form-body)");
    expect(listRowMemberSource).toContain("overflow: visible;");
    expect(listRowMemberSource).toContain("position: static;");
  });
});
