import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import type { PanelFormField, PanelFormValues, ProjectionOperationBinding } from "@ontomato/contracts/panel-projection";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelHumanOperationPreparation } from "@ontomato/contracts/panel-agent";
import { FUNCTION } from "@ontomato/contracts/platform-object-types";
import { createDirectPanelInstance, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import { receivePanelDraft } from "../../../../../packages/apps-sdk/src/panel/draft";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { PlatformObjectRefusal } from "../../../../../packages/apps-sdk/src/panel/platform-objects";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

const baseRecord = {
  domainId: "d",
  ownerId: "o",
  revision: 1,
  createdAt: "",
  updatedAt: "",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

const CUSTOMER = "Customer";
const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

function actionDescriptor(
  label: string,
  params: Record<string, { contentMediaType?: string }>,
  target: PanelOwnerOperationDescriptor["target"] = { source: "input", input: "target" },
): PanelOwnerOperationDescriptor {
  return {
    kind: "action",
    handlerRef: "actions.execute",
    label,
    effect: "write",
    batch: false,
    target,
    inputSchema: {
      type: "object",
      properties: {
        values: {
          type: "object",
          properties: Object.fromEntries(
            Object.entries(params).map(([name, schema]) => [name, { type: "string", title: name, ...schema }]),
          ),
          additionalProperties: false,
        },
      },
      required: ["values"],
      additionalProperties: false,
    },
    resultSchema: {},
  };
}

function mountCustomerForm(options: {
  fields: PanelFormField[];
  values: PanelFormValues;
  operations: Record<string, ProjectionOperationBinding>;
  admittedOperations:
    | Record<string, PanelOwnerOperationDescriptor>
    | ((request: PanelMemberReadRequest) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>);
  extraMembers?: DirectPanelManifest["members"];
  extraProjections?: Record<string, DirectProjection>;
  objectType?: string;
  primaryKey?: string | null;
  includeCreateForm?: boolean;
  draftOperation?: string;
}) {
  const objectType = options.objectType ?? CUSTOMER;
  const primaryKey = options.primaryKey === undefined ? "cust-1" : options.primaryKey;
  const projections: Record<string, DirectProjection> = {
    "customer-form": {
      ...baseRecord,
      id: "customer-form",
      name: "Customer form",
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: {
        target: { kind: "object", objectType },
        values: { kind: "json" },
        changedField: { kind: "scalar", type: "string" },
      },
      outputs: {},
      config: {},
      data: {
        form: {
          source: { object: { input: "target" } },
          read: "form",
          params: { values: { input: "values" }, changedField: { input: "changedField" } },
        },
        ...(options.includeCreateForm
          ? {
              createForm: {
                source: { type: { kind: "ObjectType", id: objectType } },
                read: "createForm",
                params: { values: { input: "values" }, changedField: { input: "changedField" } },
              },
            }
          : {}),
      },
      operations: options.operations,
    },
    ...(options.extraProjections ?? {}),
  };

  const manifest: DirectPanelManifest = {
    state: {
      selected: { type: { kind: "object", objectType }, personal: false, deepLink: true, external: false },
    },
    members: {
      customerForm: { target: { projectionId: "customer-form" }, inputs: { target: { state: "selected" } } },
      ...(options.extraMembers ?? {}),
    },
  };

  const prepared: [string, unknown][] = [];
  const prepare = vi.fn(async (operationId: string, invocation: unknown): Promise<PanelHumanOperationPreparation> => {
    prepared.push([operationId, invocation]);
    return {
      intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d77",
      operationId,
      label: operationId,
      confirmation: { kind: "none" },
    };
  });

  const instance = createDirectPanelInstance(manifest, {
    readComponentPackage: noOperations.readComponentPackage,
    pageKey: "customer-edit",
    url: () => "/customer-edit",
    label: () => "Customer Edit",
    initial: (primaryKey === null ? { selected: null } : { selected: { className: objectType, primaryKey } }) as never,
    text: createPanelText({}, ref("en"), "en"),
    operations: { ...noOperations.operations, prepare },
    expandPageComposer: noOperations.expandPageComposer,
    navigate: noOperations.navigate,
    nested: noOperations.nested,
    confirmOperation: async ({ intentId }) => ({
      decision: "confirm" as const,
      response: {
        kind: "dispatched" as const,
        intentId,
        outcome: {
          kind: "success" as const,
          data: { result: "{}", affects: [objectType] },
          affected: {
            objects: primaryKey === null ? [] : [{ objectType, primaryKey }],
            objectTypes: [objectType],
          },
        },
      },
    }),
    recordDraftCreated: async () => {},
    reportDraftError: () => {},
    readProjection: async (id) => projections[id]!,
    read: async (request: PanelMemberReadRequest) => {
      if (request.operations) {
        if (typeof options.admittedOperations === "function") {
          return await options.admittedOperations(request);
        }
        return ready(options.admittedOperations);
      }
      const submittedValues = (request.inputs?.values as PanelFormValues | undefined) ?? undefined;
      return ready({
        fields: options.fields,
        values: submittedValues ? { ...options.values, ...submittedValues } : options.values,
        errors: [],
        revision: 1,
        save: {
          method: "PUT",
          path: `/ontology/objects/${objectType}`,
          bodySchema: {},
          draftOperation: options.draftOperation ?? `${objectType}.update`,
        },
      });
    },
  });

  const element = document.createElement("div");
  document.body.append(element);
  const memberKeys = Object.keys(manifest.members);
  const app = createApp({
    render: () => h("div", memberKeys.map((member) => h(PanelMember, { instance, member }))),
  });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);

  return {
    instance,
    element,
    prepared,
    unmount: () => app.unmount(),
  };
}

const baseFields: PanelFormField[] = [
  { path: "/id", label: "ID", valueSchema: { type: "string" }, required: true, readOnly: true, control: { kind: "text" } },
  { path: "/name", label: "Name", valueSchema: { type: "string" }, required: true, readOnly: false, control: { kind: "text" } },
  { path: "/grade", label: "Grade", valueSchema: { type: ["string", "null"] }, required: false, readOnly: false, control: { kind: "text" } },
  { path: "/phone", label: "Phone", valueSchema: { type: ["string", "null"] }, required: false, readOnly: false, control: { kind: "text" } },
];

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Customer ObjectForm editability, wiring, and submit completeness", () => {
  it("keeps all fields read-only while operations are loading, then opens only save-wired fields once admitted", async () => {
    let releaseOps!: (ops: ProductPanelReadResponse) => void;
    const opsPromise = new Promise<ProductPanelReadResponse>((resolve) => {
      releaseOps = resolve;
    });

    const { element, instance, prepared, unmount } = mountCustomerForm({
      fields: baseFields,
      values: { id: "cust-1", name: "Alice", grade: "A", phone: "13800001111" },
      operations: {
        save: { operation: { kind: "Action", id: "action-update-customer" }, target: { input: "target" } },
      },
      admittedOperations: () => opsPromise,
    });

    await vi.waitFor(() => expect(element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe("Alice"));

    // While operations are still loading, all fields must stay read-only and save cannot proceed.
    expect(element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.disabled).toBe(true);
    expect(element.querySelector<HTMLInputElement>('[data-field="/grade"] input')?.disabled).toBe(true);
    expect(element.querySelector<HTMLInputElement>('[data-field="/phone"] input')?.disabled).toBe(true);
    await expect(instance.forms.submit("customerForm")).rejects.toThrow("admits no save");
    expect(prepared).toHaveLength(0);

    // Resolve operations after the form description is already mounted.
    releaseOps(ready({
      save: actionDescriptor("Update customer", { name: {}, grade: {} }),
    }));

    await vi.waitFor(() => {
      expect(element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.disabled).toBe(false);
    });

    expect(element.querySelector<HTMLInputElement>('[data-field="/grade"] input')?.disabled).toBe(false);
    expect(element.querySelector<HTMLInputElement>('[data-field="/phone"] input')?.disabled).toBe(true);
    expect(element.querySelector('[data-field="/phone"]')?.classList.contains("is-readonly")).toBe(true);
    expect(element.querySelector('[data-field="/phone"]')?.textContent).toContain(
      publicEn.platform.formFieldNotSavedByAction,
    );
    // Owner primary-key readOnly stays intact without being overwritten by the Action reason.
    expect(element.querySelector<HTMLInputElement>('[data-field="/id"] input')?.disabled).toBe(true);
    expect(element.querySelector('[data-field="/id"]')?.textContent).not.toContain(
      publicEn.platform.formFieldNotSavedByAction,
    );

    unmount();
  });

  it("refuses submit before any write request when an unwired field is edited programmatically or by draft, keeping edits and changed state", async () => {
    const { instance, element, prepared, unmount } = mountCustomerForm({
      fields: baseFields,
      values: { id: "cust-1", name: "Alice", grade: "A", phone: "13800001111" },
      operations: {
        save: { operation: { kind: "Action", id: "action-update-customer" }, target: { input: "target" } },
      },
      admittedOperations: {
        save: actionDescriptor("Update customer", { name: {}, grade: {} }),
      },
    });

    await vi.waitFor(() => expect(element.querySelector<HTMLInputElement>('[data-field="/phone"] input')?.disabled).toBe(true));

    // 1. Programmatic edit on unwired `/phone` alongside wired `/name`.
    const form = instance.forms.handle("customerForm")!;
    form.set("/name", "Alice Lin");
    form.set("/phone", "13999990000");
    await nextTick();

    let caught: unknown;
    try {
      await instance.forms.submit("customerForm");
    } catch (reason) {
      caught = reason;
    }

    expect(caught).toBeInstanceOf(PlatformObjectRefusal);
    expect((caught as PlatformObjectRefusal).fields).toEqual({
      "/phone": publicEn.platform.formFieldNotSavedByAction,
    });
    expect(prepared).toHaveLength(0);
    // User edits and dirty state stay intact — never silently cleared.
    expect(form.values.value.name).toBe("Alice Lin");
    expect(form.values.value.phone).toBe("13999990000");
    expect(form.dirty.value).toBe(true);
    expect(form.dirtyFields.value.has("/phone")).toBe(true);
    expect(form.errors.value["/phone"]).toBe(publicEn.platform.formFieldNotSavedByAction);

    // 2. Received draft modifying unwired `/phone` also refuses before writing and keeps `changed`.
    await form.reset();
    await nextTick();
    await receivePanelDraft(
      "customer-edit",
      instance.forms,
      {
        readPageDraft: async () => ({
          pageKey: "customer-edit",
          operation: `${CUSTOMER}.update`,
          target: { objectType: CUSTOMER, id: "cust-1" },
          form: { name: "Alice Draft", phone: "13700009999" },
        }),
      },
      { sessionId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d01", runId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d02", path: "outputs/draft.json" },
      instance.receiveDraft,
    );
    await vi.waitFor(() => expect(form.changed.value.has("/phone")).toBe(true));

    let draftError: unknown;
    try {
      await instance.forms.submit("customerForm");
    } catch (reason) {
      draftError = reason;
    }

    expect(draftError).toBeInstanceOf(PlatformObjectRefusal);
    expect((draftError as PlatformObjectRefusal).fields).toEqual({
      "/phone": publicEn.platform.formFieldNotSavedByAction,
    });
    expect(prepared).toHaveLength(0);
    expect(form.changed.value.has("/phone")).toBe(true);
    expect(form.changed.value.has("/name")).toBe(true);
    expect(form.values.value.phone).toBe("13700009999");

    unmount();
  });

  it("explicitly sends cleared null and empty values for Action-accepted text and JSON parameters instead of skipping them", async () => {
    const fields: PanelFormField[] = [
      { path: "/id", label: "ID", valueSchema: { type: "string" }, required: true, readOnly: true, control: { kind: "text" } },
      { path: "/remark", label: "Remark", valueSchema: { type: ["string", "null"] }, required: false, readOnly: false, control: { kind: "text" } },
      { path: "/credits", label: "Credits", valueSchema: { type: ["integer", "null"] }, required: false, readOnly: false, control: { kind: "number" } },
      { path: "/tags", label: "Tags", valueSchema: { type: ["array", "null"], items: { type: "string" } }, required: false, readOnly: false, control: { kind: "string-array" } },
    ];

    const { instance, element, prepared, unmount } = mountCustomerForm({
      fields,
      values: { id: "cust-1", remark: "old note", credits: 5, tags: ["vip"] },
      operations: {
        save: { operation: { kind: "Action", id: "action-update-customer" }, target: { input: "target" } },
      },
      admittedOperations: {
        save: actionDescriptor("Update customer", {
          remark: {},
          credits: { contentMediaType: "application/json" },
          tags: { contentMediaType: "application/json" },
        }),
      },
    });

    await vi.waitFor(() => expect(element.querySelector<HTMLInputElement>('[data-field="/remark"] input')?.value).toBe("old note"));

    const form = instance.forms.handle("customerForm")!;
    // Clear nullable string to null, nullable number to null, and JSON array to null.
    form.set("/remark", null);
    form.set("/credits", null);
    form.set("/tags", null);
    await nextTick();

    await instance.forms.submit("customerForm");

    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toEqual([
      "customerForm.save",
      {
        call: {
          target: { kind: "object", objectType: CUSTOMER, primaryKey: "cust-1" },
          input: {
            values: {
              remark: "",
              credits: "null",
              tags: "null",
            },
          },
        },
      },
    ]);

    // Clearing string explicitly to "" is also sent verbatim.
    form.set("/remark", "restored");
    await nextTick();
    form.set("/remark", "");
    await nextTick();
    await instance.forms.submit("customerForm");

    expect(prepared).toHaveLength(2);
    expect(prepared[1]).toEqual([
      "customerForm.save",
      {
        call: {
          target: { kind: "object", objectType: CUSTOMER, primaryKey: "cust-1" },
          input: {
            values: {
              remark: "",
              credits: "null",
              tags: "null",
            },
          },
        },
      },
    ]);

    unmount();
  });

  it("supports declarative renamed formField, packed formFields object parameter, and nested field pointers", async () => {
    const fields: PanelFormField[] = [
      ...baseFields,
      { path: "/remark", label: "Remark", valueSchema: { type: ["string", "null"] }, required: false, readOnly: false, control: { kind: "text" } },
      {
        path: "/profile",
        label: "Profile",
        valueSchema: { type: "object" },
        required: false,
        readOnly: false,
        control: {
          kind: "object",
          fields: [
            { path: "/city", label: "City", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } },
            { path: "/zip", label: "Zip", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } },
          ],
        },
      },
    ];

    const { instance, element, prepared, unmount } = mountCustomerForm({
      fields,
      values: {
        id: "cust-1",
        name: "Alice",
        grade: "A",
        phone: "13800001111",
        remark: "VIP",
        profile: { city: "Shanghai", zip: "200000" },
      },
      operations: {
        save: {
          operation: { kind: "Action", id: "action-update-customer-mapped" },
          target: { input: "target" },
          params: {
            customer_name: { formField: "/name" },
            city: { formField: "/profile/city" },
            payload: { formFields: { level: "/grade", note: "/remark" } },
          },
        },
      },
      admittedOperations: {
        save: actionDescriptor("Update customer", {
          customer_name: {},
          city: {},
          payload: { contentMediaType: "application/json" },
        }),
      },
    });

    await vi.waitFor(() => expect(element.querySelector<HTMLInputElement>('[data-field="/phone"] input')?.disabled).toBe(true));

    // Wired fields (renamed, packed, nested) are editable; unwired `/phone` and `/profile/zip` are read-only.
    expect(element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.disabled).toBe(false);
    expect(element.querySelector<HTMLInputElement>('[data-field="/grade"] input')?.disabled).toBe(false);
    expect(element.querySelector<HTMLInputElement>('[data-field="/remark"] input')?.disabled).toBe(false);
    expect(element.querySelector<HTMLInputElement>('[data-field="/profile/city"] input')?.disabled).toBe(false);
    expect(element.querySelector<HTMLInputElement>('[data-field="/profile/zip"] input')?.disabled).toBe(true);

    const form = instance.forms.handle("customerForm")!;
    form.set("/name", "Alice Zhou");
    form.set("/grade", "S");
    form.set("/remark", null);
    form.set("/profile/city", "Beijing");
    await nextTick();

    await instance.forms.submit("customerForm");

    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toEqual([
      "customerForm.save",
      {
        call: {
          target: { kind: "object", objectType: CUSTOMER, primaryKey: "cust-1" },
          input: {
            values: {
              customer_name: "Alice Zhou",
              city: "Beijing",
              payload: JSON.stringify({ level: "S", note: null }),
            },
          },
        },
      },
    ]);

    // Modifying unwired nested `/profile/zip` refuses `/profile/zip` before writing.
    form.set("/profile/zip", "100000");
    await nextTick();
    await expect(instance.forms.submit("customerForm")).rejects.toMatchObject({
      fields: { "/profile/zip": publicEn.platform.formFieldNotSavedByAction },
    });
    expect(prepared).toHaveLength(1);

    unmount();
  });

  it("governs form editability solely by the named save operation (never unioning or intersecting other actions) and leaves platform form.save untouched", async () => {
    // 1. Customer form with both `save` (takes `name`, `grade`) and `submitReview` (takes `phone`, `reviewComment`).
    const fields: PanelFormField[] = [
      ...baseFields,
      { path: "/reviewComment", label: "Review Comment", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } },
    ];
    const customer = mountCustomerForm({
      fields,
      values: { id: "cust-1", name: "Alice", grade: "A", phone: "13800001111", reviewComment: "" },
      operations: {
        save: { operation: { kind: "Action", id: "action-save" }, target: { input: "target" } },
        submitReview: { operation: { kind: "Action", id: "action-review" }, target: { input: "target" } },
      },
      admittedOperations: {
        save: actionDescriptor("Save customer", { name: {}, grade: {} }),
        submitReview: actionDescriptor("Submit review", { phone: {}, reviewComment: {} }),
      },
    });

    await vi.waitFor(() => expect(customer.element.querySelector<HTMLInputElement>('[data-field="/phone"] input')?.disabled).toBe(true));

    // Only `save`'s parameters (`name`, `grade`) are editable; `submitReview`'s (`phone`, `reviewComment`) stay read-only.
    expect(customer.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.disabled).toBe(false);
    expect(customer.element.querySelector<HTMLInputElement>('[data-field="/grade"] input')?.disabled).toBe(false);
    expect(customer.element.querySelector<HTMLInputElement>('[data-field="/phone"] input')?.disabled).toBe(true);
    expect(customer.element.querySelector<HTMLInputElement>('[data-field="/reviewComment"] input')?.disabled).toBe(true);

    // Invoking `submitReview` directly uses its own input independently of `save`.
    await customer.instance.invoke("customerForm.submitReview", { values: { phone: "138", reviewComment: "Looks good" } });
    expect(customer.prepared).toHaveLength(1);
    expect(customer.prepared[0]).toEqual([
      "customerForm.submitReview",
      {
        call: {
          target: { kind: "object", objectType: CUSTOMER, primaryKey: "cust-1" },
          input: { values: { phone: "138", reviewComment: "Looks good" } },
        },
      },
    ]);
    customer.unmount();

    // 2. Platform built-in `form.save` form is completely unaffected.
    const platformSaveDescriptor: PanelOwnerOperationDescriptor = {
      kind: "form.save",
      handlerRef: `${FUNCTION}.save`,
      label: "Save",
      effect: "write",
      batch: false,
      target: { source: "input", input: "target" },
      inputSchema: {},
      resultSchema: {},
    };
    const platform = mountCustomerForm({
      objectType: FUNCTION,
      primaryKey: "fn-1",
      draftOperation: "function.save",
      fields: [
        { path: "/name", label: "Name", valueSchema: { type: "string" }, required: true, readOnly: false, control: { kind: "text" } },
        { path: "/description", label: "Description", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } },
      ],
      values: { name: "Fn", description: "Desc" },
      operations: {
        save: { operation: { kind: "PlatformOperation", id: `${FUNCTION}.save` }, target: { input: "target" } },
      },
      admittedOperations: { save: platformSaveDescriptor },
    });

    await vi.waitFor(() => expect(platform.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe("Fn"));
    expect(platform.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.disabled).toBe(false);
    expect(platform.element.querySelector<HTMLInputElement>('[data-field="/description"] input')?.disabled).toBe(false);

    platform.instance.forms.handle("customerForm")!.set("/description", "");
    await nextTick();
    await platform.instance.forms.submit("customerForm");

    expect(platform.prepared).toHaveLength(1);
    expect(platform.prepared[0]).toEqual([
      "customerForm.save",
      {
        call: {
          target: { kind: "object", objectType: FUNCTION, primaryKey: "fn-1" },
          input: { values: { name: "Fn", description: "" }, submittedFields: ["/description"], revision: 1 },
        },
      },
    ]);
    platform.unmount();
  });

  it("never falls back to submitReview when save permission is absent on a multi-action customer form", async () => {
    const fields: PanelFormField[] = [
      ...baseFields,
      { path: "/reviewComment", label: "Review Comment", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } },
    ];
    const { instance, element, prepared, unmount } = mountCustomerForm({
      fields,
      values: { id: "cust-1", name: "Alice", grade: "A", phone: "13800001111", reviewComment: "" },
      operations: {
        save: { operation: { kind: "Action", id: "action-save" }, target: { input: "target" } },
        submitReview: { operation: { kind: "Action", id: "action-review" }, target: { input: "target" } },
      },
      // Reader lacks permission for `save`; server only admits `submitReview`.
      admittedOperations: {
        submitReview: actionDescriptor("Submit review", { phone: {}, reviewComment: {} }),
      },
    });

    await vi.waitFor(() => expect(element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe("Alice"));
    await nextTick();

    // Every non-hidden field must be read-only — never opened by `submitReview`.
    expect(element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.disabled).toBe(true);
    expect(element.querySelector<HTMLInputElement>('[data-field="/grade"] input')?.disabled).toBe(true);
    expect(element.querySelector<HTMLInputElement>('[data-field="/phone"] input')?.disabled).toBe(true);
    expect(element.querySelector<HTMLInputElement>('[data-field="/reviewComment"] input')?.disabled).toBe(true);
    expect(instance.forms.handle("customerForm")!.canSubmit.value).toBe(false);

    // Submitting must refuse rather than invoking `submitReview`.
    await expect(instance.forms.submit("customerForm")).rejects.toThrow("admits no save");
    expect(prepared).toHaveLength(0);

    unmount();
  });

  it("stays all read-only in edit mode when only a targetless create Action is declared/admitted", async () => {
    const { instance, element, prepared, unmount } = mountCustomerForm({
      fields: baseFields,
      values: { id: "cust-1", name: "Alice", grade: "A", phone: "13800001111" },
      operations: {
        create: { operation: { kind: "Action", id: "action-create-customer" } },
      },
      admittedOperations: {
        create: actionDescriptor("Create customer", { name: {}, grade: {} }, { source: "none" }),
      },
    });

    await vi.waitFor(() => expect(element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe("Alice"));
    await nextTick();

    // Edit mode (`target.kind === "object"`) must never fall back to a targetless create Action.
    expect(element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.disabled).toBe(true);
    expect(element.querySelector<HTMLInputElement>('[data-field="/grade"] input')?.disabled).toBe(true);
    expect(element.querySelector<HTMLInputElement>('[data-field="/phone"] input')?.disabled).toBe(true);
    expect(instance.forms.handle("customerForm")!.canSubmit.value).toBe(false);

    await expect(instance.forms.submit("customerForm")).rejects.toThrow("admits no save");
    expect(prepared).toHaveLength(0);

    unmount();
  });

  it("stays all read-only in create mode when no targetless create Action is admitted", async () => {
    // The reader can edit an existing customer but cannot create one.
    const denied = mountCustomerForm({
      fields: [
        { path: "/name", label: "Name", valueSchema: { type: "string" }, required: true, readOnly: false, control: { kind: "text" } },
        { path: "/grade", label: "Grade", valueSchema: { type: ["string", "null"] }, required: false, readOnly: false, control: { kind: "text" } },
      ],
      values: { name: "", grade: null },
      primaryKey: null,
      includeCreateForm: true,
      operations: {
        create: { operation: { kind: "Action", id: "action-create-customer" } },
        save: { operation: { kind: "Action", id: "action-update-customer" }, target: { input: "target" } },
      },
      admittedOperations: {
        save: actionDescriptor("Save", { grade: {} }),
      },
    });

    await vi.waitFor(() => expect(denied.element.querySelector<HTMLInputElement>('[data-field="/name"] input')).not.toBeNull());
    await nextTick();

    expect(denied.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.disabled).toBe(true);
    expect(denied.element.querySelector<HTMLInputElement>('[data-field="/grade"] input')?.disabled).toBe(true);
    const createBtn = [...denied.element.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")]
      .find((button) => button.textContent?.trim() === "Create")!;
    expect(createBtn.disabled).toBe(true);
    await expect(denied.instance.forms.submit("customerForm")).rejects.toThrow("admits no save");
    expect(denied.prepared).toHaveLength(0);
    denied.unmount();

    // 2. Projection declares both targeted `save` and targetless `create`; create mode picks `create`, edit mode picks `save`.
    const dual = mountCustomerForm({
      fields: [
        { path: "/name", label: "Name", valueSchema: { type: "string" }, required: true, readOnly: false, control: { kind: "text" } },
        { path: "/grade", label: "Grade", valueSchema: { type: ["string", "null"] }, required: false, readOnly: false, control: { kind: "text" } },
        { path: "/phone", label: "Phone", valueSchema: { type: ["string", "null"] }, required: false, readOnly: false, control: { kind: "text" } },
      ],
      values: { name: "New", grade: "A", phone: "138" },
      primaryKey: null,
      includeCreateForm: true,
      operations: {
        save: { operation: { kind: "Action", id: "action-update-customer" }, target: { input: "target" } },
        create: { operation: { kind: "Action", id: "action-create-customer" } },
      },
      admittedOperations: (request) => {
        const hasTarget = request.inputs?.target != null;
        return ready({
          ...(hasTarget ? { save: actionDescriptor("Save", { grade: {} }) } : {}),
          create: actionDescriptor("Create", { name: {} }, { source: "none" }),
        });
      },
    });

    await vi.waitFor(() => expect(dual.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.disabled).toBe(false));
    expect(dual.element.querySelector<HTMLInputElement>('[data-field="/grade"] input')?.disabled).toBe(true);
    expect(dual.element.querySelector<HTMLInputElement>('[data-field="/phone"] input')?.disabled).toBe(true);

    dual.instance.forms.handle("customerForm")!.set("/name", "Created Customer");
    await nextTick();
    await dual.instance.forms.submit("customerForm");
    expect(dual.prepared).toHaveLength(1);
    expect(dual.prepared[0]).toEqual([
      "customerForm.create",
      { call: { target: null, input: { values: { name: "Created Customer" } } } },
    ]);
    dual.unmount();
  });

  it("explicitly emits null in packed formFields and single formField when a nested key is removed from its parent object", async () => {
    const fields: PanelFormField[] = [
      { path: "/id", label: "ID", valueSchema: { type: "string" }, required: true, readOnly: true, control: { kind: "text" } },
      {
        path: "/profile",
        label: "Profile",
        valueSchema: { type: "object" },
        required: false,
        readOnly: false,
        control: {
          kind: "object",
          fields: [
            { path: "/phone", label: "Phone", valueSchema: { type: ["string", "null"] }, required: false, readOnly: false, control: { kind: "text" } },
            { path: "/city", label: "City", valueSchema: { type: ["string", "null"] }, required: false, readOnly: false, control: { kind: "text" } },
            { path: "/note", label: "Note", valueSchema: { type: ["string", "null"] }, required: false, readOnly: false, control: { kind: "text" } },
            { path: "/zip", label: "Zip", valueSchema: { type: ["string", "null"] }, required: false, readOnly: false, control: { kind: "text" } },
          ],
        },
      },
    ];

    const { instance, element, prepared, unmount } = mountCustomerForm({
      fields,
      values: {
        id: "cust-1",
        profile: { phone: "13800001111", city: "Shanghai", note: "VIP", zip: "200000" },
      },
      operations: {
        save: {
          operation: { kind: "Action", id: "action-update-profile" },
          target: { input: "target" },
          params: {
            contact: { formFields: { phone: "/profile/phone", city: "/profile/city" } },
            note: { formField: "/profile/note" },
          },
        },
      },
      admittedOperations: {
        save: actionDescriptor("Update profile", {
          contact: { contentMediaType: "application/json" },
          note: {},
        }),
      },
    });

    await vi.waitFor(() => expect(element.querySelector<HTMLInputElement>('[data-field="/profile/phone"] input')?.disabled).toBe(false));
    expect(element.querySelector<HTMLInputElement>('[data-field="/profile/zip"] input')?.disabled).toBe(true);

    const form = instance.forms.handle("customerForm")!;
    // Remove `phone` and `note` keys by replacing the parent `/profile` object (only `/profile` is modified).
    form.set("/profile", { city: "Beijing", zip: "200000" });
    await nextTick();

    await instance.forms.submit("customerForm");

    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toEqual([
      "customerForm.save",
      {
        call: {
          target: { kind: "object", objectType: CUSTOMER, primaryKey: "cust-1" },
          input: {
            values: {
              contact: JSON.stringify({ phone: null, city: "Beijing" }),
              note: "",
            },
          },
        },
      },
    ]);

    // Removing an unwired nested key (`/profile/zip`) from `/profile` must be caught and refused before writing.
    form.set("/profile", { city: "Beijing" });
    await nextTick();
    await expect(instance.forms.submit("customerForm")).rejects.toMatchObject({
      fields: { "/profile/zip": publicEn.platform.formFieldNotSavedByAction },
    });
    expect(prepared).toHaveLength(1);

    // Explicitly touching an unwired nested leaf even with its current baseline value is also caught.
    await form.reset();
    await nextTick();
    form.set("/profile/zip", "200000");
    await nextTick();
    await expect(instance.forms.submit("customerForm")).rejects.toMatchObject({
      fields: { "/profile/zip": publicEn.platform.formFieldNotSavedByAction },
    });
    expect(prepared).toHaveLength(1);

    unmount();

    // Initializing a wired nested child when baseline parent object is null must succeed without false parent refusal.
    const fromNull = mountCustomerForm({
      fields,
      values: { id: "cust-2", profile: null },
      operations: {
        save: {
          operation: { kind: "Action", id: "action-update-profile" },
          target: { input: "target" },
          params: {
            contact: { formFields: { phone: "/profile/phone", city: "/profile/city" } },
          },
        },
      },
      admittedOperations: {
        save: actionDescriptor("Update profile", {
          contact: { contentMediaType: "application/json" },
        }),
      },
    });
    await vi.waitFor(() => {
      const profileField = fromNull.instance.forms.handle("customerForm")?.fields.value.find((f) => f.path === "/profile");
      expect(profileField?.control.kind).toBe("object");
      const cityField = profileField?.control.kind === "object"
        ? profileField.control.fields.find((f) => f.path === "/city")
        : undefined;
      expect(cityField?.readOnly).toBe(false);
    });
    fromNull.instance.forms.handle("customerForm")!.set("/profile/city", "Shenzhen");
    await nextTick();
    await fromNull.instance.forms.submit("customerForm");
    expect(fromNull.prepared).toHaveLength(1);
    expect(fromNull.prepared[0]).toEqual([
      "customerForm.save",
      {
        call: {
          target: { kind: "object", objectType: CUSTOMER, primaryKey: "cust-1" },
          input: {
            values: {
              contact: JSON.stringify({ city: "Shenzhen" }),
            },
          },
        },
      },
    ]);
    fromNull.unmount();
  });
});
