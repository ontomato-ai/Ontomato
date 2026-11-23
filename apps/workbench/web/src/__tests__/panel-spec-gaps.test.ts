import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelHumanOperationPreparation } from "@ontomato/contracts/panel-agent";
import { METRIC_VIEW, OBJECT_TYPE, RELATIONSHIP } from "@ontomato/contracts/platform-object-types";
import { createDirectPanelInstance, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

const baseRecord = {
  domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "",
  editable: false, visibility: "domain" as const, description: "",
};

const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

function mountDirect(
  manifest: DirectPanelManifest,
  projections: Record<string, DirectProjection>,
  answer: (request: PanelMemberReadRequest) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>,
  initial: Record<string, unknown> = {},
  memberKeys = Object.keys(manifest.members),
) {
  const reads: PanelMemberReadRequest[] = [];
  const prepared: [string, unknown][] = [];
  let outcome: unknown = { kind: "success", data: {}, affected: { objects: [], objectTypes: [] } };
  const prepare = vi.fn(async (operationId: string, invocation: unknown): Promise<PanelHumanOperationPreparation> => {
    prepared.push([operationId, invocation]);
    return { intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d99", operationId, label: operationId, confirmation: { kind: "none" } };
  });
  const instance = createDirectPanelInstance(manifest, {
    readComponentPackage: noOperations.readComponentPackage,
    pageKey: "spec-gaps",
    url: () => "/spec-gaps",
    label: () => "Spec Gaps",
    initial: initial as never,
    text: createPanelText({}, { value: "en" } as never, "en"),
    operations: { ...noOperations.operations, prepare },
    expandPageComposer: noOperations.expandPageComposer,
    navigate: noOperations.navigate,
    nested: noOperations.nested,
    confirmOperation: async ({ intentId }) => {
      const result = { decision: "confirm" as const, response: { kind: "dispatched" as const, intentId, outcome: outcome as never } };
      const maybeAffected = (outcome as { kind?: string; affected?: unknown })?.kind === "success"
        ? (outcome as { affected?: unknown }).affected
        : undefined;
      if (maybeAffected) instance.refresh(maybeAffected as never);
      return result;
    },
    readProjection: async (id) => projections[id]!,
    read: async (request) => {
      reads.push(request);
      return answer(request);
    },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({
    render: () => h("div", memberKeys.map((member) => h(PanelMember, { instance, member }))),
  });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  return {
    instance,
    element,
    reads,
    prepared,
    setOutcome: (next: unknown) => { outcome = next; },
    unmount: () => app.unmount(),
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

it("mounts ObjectForm on an ordinary customer ObjectType and saves edits through a bound customer write Action", async () => {
  const customerType = "CourseEnrollment";
  const projections: Record<string, DirectProjection> = {
    "enrollment-form": {
      ...baseRecord,
      id: "enrollment-form",
      name: "Enrollment form",
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: {
        target: { kind: "object", objectType: customerType },
      },
      outputs: {},
      config: {},
      data: {
        form: { source: { object: { input: "target" } }, read: "form", params: {} },
        createForm: { source: { type: { kind: "ObjectType", id: customerType } }, read: "createForm", params: {} },
      },
      operations: {
        save: { operation: { kind: "Action", id: "action-update-enrollment" }, target: { input: "target" } },
      },
    },
  };
  const manifest: DirectPanelManifest = {
    state: {
      selected: { type: { kind: "object", objectType: customerType }, personal: false, deepLink: true, external: false },
    },
    members: {
      enrollmentForm: { target: { projectionId: "enrollment-form" }, inputs: { target: { state: "selected" } } },
    },
  };
  const updateActionDescriptor = {
    kind: "action" as const,
    handlerRef: "actions.execute",
    label: "Update enrollment",
    effect: "write" as const,
    batch: false,
    target: { source: "input" as const, input: "target" },
    inputSchema: {
      type: "object",
      properties: {
        values: {
          type: "object",
          properties: {
            studentName: { type: "string", title: "studentName" },
            credits: { type: "string", title: "credits", contentMediaType: "application/json" },
          },
          additionalProperties: false,
        },
      },
      required: ["values"],
      additionalProperties: false,
    },
    resultSchema: {},
  };

  const { instance, element, prepared, setOutcome, unmount } = mountDirect(
    manifest,
    projections,
    (request) => {
      if (request.operations) return ready({ save: updateActionDescriptor });
      if (request.dataName === "form") {
        return ready({
          fields: [
            { path: "/id", label: "ID", valueSchema: { type: "string" }, required: true, readOnly: true, control: { kind: "text" } },
            { path: "/studentName", label: "Student Name", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } },
            { path: "/credits", label: "Credits", valueSchema: { type: ["integer", "null"] }, required: false, readOnly: false, control: { kind: "number" } },
          ],
          values: { id: "e-1", studentName: "Alice", credits: 3 },
          errors: [],
          save: { method: "PUT", path: "/ontology/objects/CourseEnrollment", bodySchema: {}, draftOperation: "CourseEnrollment.update" },
        });
      }
      return ready({
        fields: [
          { path: "/id", label: "ID", valueSchema: { type: "string" }, required: true, readOnly: false, control: { kind: "text" } },
          { path: "/studentName", label: "Student Name", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } },
        ],
        values: { id: "", studentName: "" },
        errors: [],
        save: { method: "POST", path: "/ontology/objects/CourseEnrollment", bodySchema: {}, draftOperation: "CourseEnrollment.create" },
      });
    },
    { selected: { className: customerType, primaryKey: "e-1" } },
  );

  const nameInput = () => element.querySelector<HTMLInputElement>('[data-field="/studentName"] input')!;
  await vi.waitFor(() => expect(nameInput()?.value).toBe("Alice"));

  // Edit field and submit through the bound customer write Action.
  nameInput().value = "Alice Lin";
  nameInput().dispatchEvent(new Event("input"));
  await nextTick();

  setOutcome({
    kind: "success",
    data: { result: "{}", affects: [customerType] },
    affected: { objects: [{ objectType: customerType, primaryKey: "e-1" }], objectTypes: [customerType] },
  });
  await instance.forms.submit("enrollmentForm");

  expect(prepared).toHaveLength(1);
  expect(prepared[0]).toEqual([
    "enrollmentForm.save",
    {
      call: {
        target: { kind: "object", objectType: customerType, primaryKey: "e-1" },
        input: { values: { studentName: "Alice Lin", credits: "3" } },
      },
    },
  ]);

  // Clearing selection switches seamlessly to the customer createForm; since no create Action is bound,
  // createForm fields stay read-only until an admitted create Action is declared.
  instance.state.set("selected", null);
  await vi.waitFor(() => {
    expect(element.querySelector<HTMLInputElement>('[data-field="/id"] input')?.value).toBe("");
    expect(element.querySelector('[data-field="/credits"]')).toBeNull();
  });
  expect(element.querySelector<HTMLInputElement>('[data-field="/id"] input')?.disabled).toBe(true);
  expect(element.querySelector<HTMLInputElement>('[data-field="/studentName"] input')?.disabled).toBe(true);
  unmount();
});

it("submits a form member's draft from a separate member declaring operationDrafts via both panelOperations and OperationButton", async () => {
  const projections: Record<string, DirectProjection> = {
    "rel-form": {
      ...baseRecord,
      id: "rel-form",
      name: "Relation form",
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: { target: { kind: "object", objectType: RELATIONSHIP } },
      outputs: {},
      config: { actions: "none" },
      data: {
        form: { source: { object: { input: "target" } }, read: "form", params: {} },
      },
    },
    "header-save": {
      ...baseRecord,
      id: "header-save",
      name: "Header save",
      componentId: "@ontomato/sdk:OperationButton",
      inputs: { target: { kind: "object", objectType: RELATIONSHIP } },
      outputs: {},
      config: { operation: "save" },
      data: {},
      operations: {
        save: { operation: { kind: "PlatformOperation", id: `${RELATIONSHIP}.save` }, target: { input: "target" } },
      },
    },
  };
  const manifest: DirectPanelManifest = {
    state: {
      selected: { type: { kind: "object", objectType: RELATIONSHIP }, personal: false, deepLink: true, external: false },
    },
    members: {
      relationForm: { target: { projectionId: "rel-form" }, inputs: { target: { state: "selected" } } },
      headerSave: {
        target: { projectionId: "header-save" },
        inputs: { target: { state: "selected" } },
        operationDrafts: { save: { slot: "relationForm" } },
      },
    },
  };
  const saveDescriptor = {
    kind: "form.save" as const,
    handlerRef: `${RELATIONSHIP}.save`,
    label: "Save relationship",
    effect: "write" as const,
    batch: false,
    target: { source: "draft" as const, slot: "relationForm" },
    inputSchema: {},
    resultSchema: {},
  };

  const { instance, element, prepared, setOutcome, unmount } = mountDirect(
    manifest,
    projections,
    (request) => {
      if (request.operations) {
        return ready(request.memberPath[0]!.member === "headerSave" ? { save: saveDescriptor } : {});
      }
      return ready({
        fields: [
          { path: "/desc", label: "Description", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } },
        ],
        values: { desc: "Initial" },
        errors: [],
        save: { method: "PUT", path: "/ontology/model/relationships/r1", bodySchema: {}, draftOperation: "relationship.update" },
      });
    },
    { selected: { className: RELATIONSHIP, primaryKey: "r1" } },
  );

  const descInput = () => element.querySelector<HTMLInputElement>('[data-field="/desc"] input')!;
  await vi.waitFor(() => expect(descInput()?.value).toBe("Initial"));
  await vi.waitFor(() => expect(element.querySelector(".sdk-operation-button button")?.textContent?.trim()).toBe("Save relationship"));

  // 1. Invoking the cross-member operation via panel instance submits `relationForm`'s live draft.
  descInput().value = "Updated via invoke";
  descInput().dispatchEvent(new Event("input"));
  await nextTick();
  setOutcome({
    kind: "success",
    data: {},
    affected: { objects: [{ objectType: RELATIONSHIP, primaryKey: "r1" }], objectTypes: [RELATIONSHIP] },
  });
  await instance.invoke("headerSave.save");

  expect(prepared).toHaveLength(1);
  expect(prepared[0]).toEqual([
    "headerSave.save",
    {
      call: {
        target: { kind: "object", objectType: RELATIONSHIP, primaryKey: "r1" },
        input: { values: { desc: "Updated via invoke" }, submittedFields: ["/desc"] },
      },
    },
  ]);

  // 2. Clicking the separate OperationButton submits `relationForm`'s updated draft without opening a param dialog.
  descInput().value = "Updated via button";
  descInput().dispatchEvent(new Event("input"));
  await nextTick();
  element.querySelector<HTMLButtonElement>(".sdk-operation-button button")!.click();
  await vi.waitFor(() => expect(prepared).toHaveLength(2));
  expect(prepared[1]).toEqual([
    "headerSave.save",
    {
      call: {
        target: { kind: "object", objectType: RELATIONSHIP, primaryKey: "r1" },
        input: { values: { desc: "Updated via button" }, submittedFields: ["/desc"] },
      },
    },
  ]);
  unmount();
});

it("writes ObjectRefCard's declared navigate output port to panel state on click", async () => {
  const projections: Record<string, DirectProjection> = {
    "source-card": {
      ...baseRecord,
      id: "source-card",
      name: "Source endpoint",
      componentId: "@ontomato/sdk:ObjectRefCard",
      inputs: { target: { kind: "object", objectType: RELATIONSHIP } },
      outputs: { navigate: { kind: "object", objectType: OBJECT_TYPE } },
      config: { caption: "Source", field: "fromclass", targetClassName: OBJECT_TYPE },
      data: {
        record: { source: { object: { input: "target" } }, read: "record", params: {} },
      },
    },
  };
  const manifest: DirectPanelManifest = {
    state: {
      selectedRelation: { type: { kind: "object", objectType: RELATIONSHIP }, personal: false, deepLink: false, external: false },
      chosenObjectType: { type: { kind: "object", objectType: OBJECT_TYPE }, personal: false, deepLink: false, external: false },
    },
    members: {
      sourceCard: {
        target: { projectionId: "source-card" },
        inputs: { target: { state: "selectedRelation" } },
        outputs: { navigate: { state: "chosenObjectType" } },
      },
    },
  };

  const { instance, element, unmount } = mountDirect(
    manifest,
    projections,
    (request) => {
      if (request.operations) return ready({});
      return ready({
        primaryKey: "enrolled_in",
        label: "Enrolled in",
        fields: { fromclass: "Student" },
        fieldLabels: { fromclass: "Source" },
      });
    },
    { selectedRelation: { className: RELATIONSHIP, primaryKey: "enrolled_in" } },
  );

  await vi.waitFor(() => expect(element.querySelector("button.sdk-object-ref-card")?.textContent).toContain("Student"));
  element.querySelector<HTMLButtonElement>("button.sdk-object-ref-card")!.click();
  await vi.waitFor(() => expect(instance.state.values.value.chosenObjectType).toEqual({
    className: OBJECT_TYPE,
    primaryKey: "Student",
  }));
  unmount();
});

it("refreshes metric-bound projections whose sourceObjectTypes overlap affected types without over-rereading unrelated metrics", async () => {
  const projections: Record<string, DirectProjection> = {
    "enrollment-summary": {
      ...baseRecord,
      id: "enrollment-summary",
      name: "Enrollment summary",
      componentId: "@ontomato/sdk:RecordTemplate",
      inputs: {},
      outputs: {},
      config: { template: "Total {total}, pending {pending}" },
      data: {
        result: {
          source: { object: { literal: { className: METRIC_VIEW, primaryKey: "mv-enrollment" } } },
          read: "result",
          params: {},
        },
      },
    },
    "unrelated-kpi": {
      ...baseRecord,
      id: "unrelated-kpi",
      name: "Invoice KPI",
      componentId: "@ontomato/sdk:MetricCard",
      inputs: {},
      outputs: {},
      config: { label: "Invoices", field: "count" },
      data: {
        result: {
          source: { object: { literal: { className: METRIC_VIEW, primaryKey: "mv-invoice" } } },
          read: "result",
          params: {},
        },
      },
    },
    "constant-kpi": {
      ...baseRecord,
      id: "constant-kpi",
      name: "Constant KPI",
      componentId: "@ontomato/sdk:MetricCard",
      inputs: {},
      outputs: {},
      config: { label: "Constant", field: "v" },
      data: {
        result: {
          source: { object: { literal: { className: METRIC_VIEW, primaryKey: "mv-constant" } } },
          read: "result",
          params: {},
        },
      },
    },
    "fallback-kpi": {
      ...baseRecord,
      id: "fallback-kpi",
      name: "Fallback KPI",
      componentId: "@ontomato/sdk:MetricCard",
      inputs: {},
      outputs: {},
      config: { label: "Fallback", field: "n" },
      data: {
        result: {
          source: { object: { literal: { className: METRIC_VIEW, primaryKey: "mv-fallback" } } },
          read: "result",
          params: {},
        },
      },
    },
  };
  const manifest: DirectPanelManifest = {
    state: {},
    members: {
      summary: { target: { projectionId: "enrollment-summary" } },
      invoiceKpi: { target: { projectionId: "unrelated-kpi" } },
      constantKpi: { target: { projectionId: "constant-kpi" } },
      fallbackKpi: { target: { projectionId: "fallback-kpi" } },
    },
  };

  let enrollmentReads = 0;
  let invoiceReads = 0;
  let constantReads = 0;
  let fallbackReads = 0;
  let enrollmentVersion = 1;
  const { instance, element, unmount } = mountDirect(manifest, projections, (request) => {
    if (request.operations) return ready({});
    const member = request.memberPath[0]!.member;
    if (member === "summary") {
      enrollmentReads += 1;
      return ready({
        columns: [
          { key: "total", label: "Total", type: "number" },
          { key: "pending", label: "Pending", type: "number" },
        ],
        rows: [{ total: 10 + enrollmentVersion, pending: 4 - enrollmentVersion }],
        truncation: null,
        sourceObjectTypes: ["CourseEnrollment"],
      });
    }
    if (member === "invoiceKpi") {
      invoiceReads += 1;
      return ready({
        columns: [{ key: "count", label: "Count", type: "number" }],
        rows: [{ count: 5 }],
        truncation: null,
        sourceObjectTypes: ["Invoice"],
      });
    }
    if (member === "constantKpi") {
      constantReads += 1;
      return ready({
        columns: [{ key: "v", label: "V", type: "number" }],
        rows: [{ v: 1 }],
        truncation: null,
        sourceObjectTypes: [],
      });
    }
    fallbackReads += 1;
    return ready({
      columns: [{ key: "n", label: "N", type: "number" }],
      rows: [{ n: fallbackReads }],
      truncation: null,
    });
  });

  await vi.waitFor(() => expect(element.textContent).toContain("Total 11, pending 3"));
  const beforeEnrollment = enrollmentReads;
  const beforeFallback = fallbackReads;
  const beforeInvoice = invoiceReads;
  const beforeConstant = constantReads;
  expect(beforeEnrollment).toBeGreaterThanOrEqual(1);
  expect([beforeInvoice, beforeConstant, beforeFallback]).toEqual([1, 1, 1]);

  // Write reports only the customer object and type — never naming platform:MetricView directly.
  enrollmentVersion = 2;
  instance.refresh({
    objects: [{ objectType: "CourseEnrollment", primaryKey: "e-1" }],
    objectTypes: ["CourseEnrollment"],
  });

  await vi.waitFor(() => expect(element.textContent).toContain("Total 12, pending 2"));
  // Dependent metric and fallback (unknown-dependency) metric reread; unrelated Invoice metric and empty-dep metric do not.
  expect(enrollmentReads).toBeGreaterThan(beforeEnrollment);
  expect(fallbackReads).toBe(beforeFallback + 1);
  expect(invoiceReads).toBe(beforeInvoice);
  expect(constantReads).toBe(beforeConstant);
  unmount();
});
