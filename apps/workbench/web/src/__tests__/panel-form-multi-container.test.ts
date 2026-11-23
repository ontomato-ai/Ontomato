import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, provide, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import { FUNCTION } from "@ontomato/contracts/platform-object-types";
import { randomId } from "@ontomato/contracts/random-id";
import { createPanelBackController } from "@ontomato/platform-shell";
import { mountDirectPanel } from "../../../../../packages/apps-sdk/src/panel/direct-mount";
import { panelContextKey } from "../../../../../packages/apps-sdk/src/panel/context";
import { directPanelContext } from "../../../../../packages/apps-sdk/src/panel/direct";
import { usePanelFormDraft } from "../../../../../packages/apps-sdk/src/panel/form-draft";
import { usePanelBack } from "../../../../../packages/apps-sdk/src/panel/back";
import PageHeader from "../../../../../packages/apps-sdk/src/base/PageHeader.vue";
import ObjectFormFields from "../../../../../packages/apps-sdk/src/base/ObjectFormFields.vue";
import InfoBanner from "../../../../../packages/apps-sdk/src/base/InfoBanner.vue";
import { directRun, noOperations } from "./panel-frame";

/*
 * Multi-card, multi-tab, multi-step, and custom-slot ObjectForm sharing one form state, validation, dirty tracking,
 * `usePanelFormDraft`, `usePanelBack`, and agent draft lifecycle (material-58204417 item 8).
 */

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

const saveDescriptor = {
  kind: "form.save",
  handlerRef: `${FUNCTION}.save`,
  label: "Save",
  effect: "write",
  target: { source: "input", input: "item" },
  inputSchema: {},
  resultSchema: {},
  batch: false,
};

const formSaveMeta = {
  method: "PUT" as const,
  path: "/functions/:id",
  bodySchema: {},
  draftOperation: "function.update",
};

const sampleFields: PanelFormField[] = [
  { path: "/name", label: "Name", control: { kind: "text" }, valueSchema: {}, required: true, readOnly: false },
  { path: "/displayName", label: "Display name", control: { kind: "text" }, valueSchema: {}, required: false, readOnly: false },
  { path: "/description", label: "Description", control: { kind: "text" }, valueSchema: {}, required: false, readOnly: false },
  { path: "/code", label: "Code", control: { kind: "text" }, valueSchema: {}, required: false, readOnly: false },
  { path: "/notes", label: "Notes", control: { kind: "text" }, valueSchema: {}, required: false, readOnly: false },
];

const initialValues = {
  name: "calc_margin",
  displayName: "Margin",
  description: "Gross margin",
  code: "return a - b;",
  notes: "Internal",
};

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.innerHTML = "";
});

async function clickDialogButton(text: string) {
  await vi.waitFor(() => {
    const boxes = [...document.querySelectorAll<HTMLElement>(".el-message-box")];
    const open = boxes.find((box) => box.closest<HTMLElement>(".el-overlay")?.style.display !== "none");
    expect(open).toBeDefined();
    const button = [...open!.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === text);
    expect(button).toBeDefined();
    button!.click();
  });
}

function setFieldValue(root: HTMLElement, path: string, value: string) {
  const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${path}"] input, [data-field="${path}"] textarea`);
  expect(input, `expected input for field ${path}`).not.toBeNull();
  input!.value = value;
  input!.dispatchEvent(new Event("input"));
}

function mountFormScenario(options: {
  config: DirectProjection["config"];
  fields?: PanelFormField[];
  values?: Record<string, unknown>;
  onSave?: (input: Record<string, unknown>) => { ok: true } | { refuse: { message: string; fields: Record<string, string> } };
  customSlot?: boolean;
  withHeaderAndBack?: boolean;
  initialUrl?: string;
  draftArtifact?: Record<string, unknown>;
}) {
  const projection: DirectProjection = {
    ...baseRecord,
    id: "fn-form",
    name: "Function form",
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: { item: { kind: "object", objectType: FUNCTION }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
    outputs: {},
    config: options.config,
    data: {
      form: {
        source: { object: { input: "item" } },
        read: "form",
        params: { values: { input: "values" }, changedField: { input: "changedField" } },
      },
    },
    operations: {
      save: { operation: { kind: "PlatformOperation", id: `${FUNCTION}.save` }, target: { input: "item" } },
    },
  };
  const manifest: DirectPanelManifest = {
    state: {
      item: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: true, external: false },
    },
    members: {
      form: { target: { projectionId: projection.id }, inputs: { item: { state: "item" } } },
    },
  };
  const savedPayloads: Record<string, unknown>[] = [];
  const backCalls = vi.fn();
  const confirmLeaveUnsaved = vi.fn(async () => true);
  const backController = createPanelBackController({
    active: () => true,
    allowHistory: () => false,
    isDirty: () => false,
    confirmLeaveUnsaved,
  });
  let lastIntentInput: Record<string, unknown> = {};

  const requests = {
    request: async (path: string, init?: { body?: unknown }) => {
      if (path === "/panel-operations/intents") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { call?: { input?: Record<string, unknown> } };
        lastIntentInput = body.call?.input ?? {};
        savedPayloads.push(lastIntentInput);
        return Response.json({
          intentId: randomId(),
          operationId: "form.save",
          label: "Save",
          confirmation: { kind: "none" },
        });
      }
      if (path.includes("/page-draft") && options.draftArtifact) {
        return Response.json(options.draftArtifact);
      }
      return Response.json({ projection });
    },
  };

  const formFields = options.fields ?? sampleFields;
  const baseValues = options.values ?? initialValues;

  const mount = mountDirectPanel({
    manifest,
    run: directRun({
      pageKey: "fn-editor",
      url: () => options.initialUrl ?? "/functions",
      label: () => "Function editor",
      initial: { item: { className: FUNCTION, primaryKey: "fn-1" } },
      registerBackHandler: backController.register,
      confirmLeaveUnsaved,
    }),
    messages: {
      en: {
        "card.identity": "Identity",
        "card.implementation": "Implementation",
        "tab.general": "General",
        "tab.script": "Script",
        "step.basics": "Basics",
        "step.code": "Code & Notes",
      },
    },
    locale: ref("en"),
    defaultLocale: "en",
    requests,
    use: { applicationId: "app", useId: "fn-editor" },
    expandPageComposer: noOperations.expandPageComposer,
    navigate: noOperations.navigate,
    nested: noOperations.nested,
    confirmOperation: async (preparation) => {
      const decision = options.onSave?.(lastIntentInput) ?? { ok: true as const };
      if ("refuse" in decision) {
        return {
          decision: "confirm",
          response: {
            kind: "dispatched",
            intentId: preparation.intentId,
            outcome: {
              kind: "refusal",
              code: "FIELD_VALIDATION_FAILED",
              message: decision.refuse.message,
              errors: Object.entries(decision.refuse.fields).map(([field, message]) => ({
                field,
                code: "invalid_format" as const,
                message,
              })),
            },
          },
        };
      }
      return {
        decision: "confirm",
        response: {
          kind: "dispatched",
          intentId: preparation.intentId,
          outcome: { kind: "success", data: { primaryKey: "fn-1" }, affected: { objects: [], objectTypes: [] } },
        },
      };
    },
    read: async (request): Promise<ProductPanelReadResponse> => {
      if (request.operations) return { status: "ready", value: { save: saveDescriptor } as never };
      const proposed = (request.inputs?.values as Record<string, unknown> | undefined) ?? undefined;
      return {
        status: "ready",
        value: {
          fields: formFields,
          values: proposed ? { ...baseValues, ...proposed } : baseValues,
          errors: [],
          revision: 1,
          save: formSaveMeta,
        } as never,
      };
    },
  });

  const element = document.createElement("div");
  document.body.append(element);

  const backHandleRef = { current: null as ReturnType<typeof usePanelBack> | null };
  const panelContext = directPanelContext(mount.instance);

  const InnerHost = defineComponent({
    setup() {
      const draft = options.withHeaderAndBack ? usePanelFormDraft("form") : null;
      if (options.withHeaderAndBack) {
        backHandleRef.current = usePanelBack(true, backCalls, { forms: "form" });
      }
      return () => {
        const children = [];
        if (options.withHeaderAndBack && draft) {
          children.push(
            h(PageHeader, {
              title: "Edit Function",
              backLabel: "Back",
              draft: draft.value,
              onBack: () => void backHandleRef.current?.back(),
            }),
          );
        }
        if (options.customSlot) {
          children.push(
            mount.member("form", {
              default: (scope: { dirty: boolean; changedCount: number }) => [
                h("div", { class: "custom-two-cards", "data-custom-dirty": String(scope.dirty), "data-custom-count": String(scope.changedCount) }, [
                  h("section", { class: "custom-card-left" }, [
                    h(InfoBanner, { tone: "info", text: "Identity details" }),
                    h(ObjectFormFields, { fields: ["/name", "/displayName"] }),
                  ]),
                  h("section", { class: "custom-card-right" }, [
                    h(ObjectFormFields, { rest: true }),
                  ]),
                ]),
              ],
            }),
          );
        } else {
          children.push(mount.member("form"));
        }
        return h("div", { class: "test-host" }, children);
      };
    },
  });

  const Host = defineComponent({
    setup() {
      provide(panelContextKey, panelContext);
      return () => h(InnerHost);
    },
  });

  const app = createApp(Host);
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  cleanups.push(() => {
    app.unmount();
    mount.dispose();
    element.remove();
  });

  return { mount, element, savedPayloads, backCalls, confirmLeaveUnsaved, backHandleRef };
}

describe("ObjectForm multi-card, multi-tab, multi-step, and custom-slot forms sharing one draft", () => {
  it("splits fields across two-column white cards with unassigned fallback and saves all edits as one draft", async () => {
    const { element, savedPayloads, mount } = mountFormScenario({
      config: {
        presentation: "cards",
        groups: [
          { key: "identity", titleKey: "card.identity", fields: ["/name", "/displayName"], column: "main" },
          { key: "impl", titleKey: "card.implementation", fields: ["/code"], column: "side" },
        ],
      },
    });

    await vi.waitFor(() => {
      expect(element.querySelector('[data-form-group="identity"] [data-field="/name"]')).not.toBeNull();
    });
    expect(element.querySelector(".sdk-owner-form-cards.is-split")).not.toBeNull();
    expect(element.querySelector('[data-form-group="impl"] [data-field="/code"]')).not.toBeNull();
    // Unassigned fields (/description, /notes) are automatically preserved in the trailing Other card.
    expect(element.querySelector('[data-form-group="__other"] [data-field="/description"]')).not.toBeNull();
    expect(element.querySelector('[data-form-group="__other"] [data-field="/notes"]')).not.toBeNull();

    setFieldValue(element, "/name", "calc_net_margin");
    setFieldValue(element, "/code", "return (a - b) / a;");
    await nextTick();

    expect(mount.instance.dirty()).toBe(true);
    const handle = mount.instance.forms.handle("form")!;
    expect(handle.dirtyFields.value.has("/name")).toBe(true);
    expect(handle.dirtyFields.value.has("/code")).toBe(true);
    expect(element.querySelector(".sdk-owner-form-unsaved")?.textContent?.trim()).toBe("2 changes");

    const saveBtn = [...element.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")]
      .find((btn) => btn.textContent?.trim() === "Save")!;
    saveBtn.click();

    await vi.waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect(savedPayloads[0]).toMatchObject({
      values: { name: "calc_net_margin", code: "return (a - b) / a;" },
      submittedFields: expect.arrayContaining(["/name", "/code"]),
    });
    await vi.waitFor(() => expect(mount.instance.dirty()).toBe(false));
  });

  it("preserves edits across tabs, displays dirty/error badges, and switches to the refused tab on click", async () => {
    const { element, mount } = mountFormScenario({
      config: {
        presentation: "tabs",
        groups: [
          { key: "general", titleKey: "tab.general", fields: ["/name", "/displayName", "/description"] },
          { key: "script", titleKey: "tab.script", fields: ["/code", "/notes"] },
        ],
      },
      onSave: () => ({
        refuse: {
          message: "Code syntax error",
          fields: { "/code": "Unexpected token" },
        },
      }),
    });

    await vi.waitFor(() => {
      expect(element.querySelector('[data-form-tab="general"]')).not.toBeNull();
    });
    expect(element.querySelector('[data-field="/name"]')).not.toBeNull();
    expect(element.querySelector('[data-field="/code"]')).toBeNull();

    setFieldValue(element, "/name", "updated_fn");
    await nextTick();
    expect(element.querySelector('[data-form-tab="general"]')?.getAttribute("data-dirty")).toBe("true");

    // Switch to second tab and edit /code.
    element.querySelector<HTMLButtonElement>('[data-form-tab="script"]')!.click();
    await nextTick();
    expect(element.querySelector('[data-field="/code"]')).not.toBeNull();
    setFieldValue(element, "/code", "invalid(");
    await nextTick();
    expect(element.querySelector('[data-form-tab="script"]')?.getAttribute("data-dirty")).toBe("true");

    // Switch back to Tab 1 — edits from BOTH tabs stay in the single shared form state!
    element.querySelector<HTMLButtonElement>('[data-form-tab="general"]')!.click();
    await nextTick();
    expect(element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe("updated_fn");
    expect(mount.instance.forms.handle("form")!.dirtyFields.value.size).toBe(2);

    // Submit while on Tab 1; owner refuses /code (on Tab 2).
    const saveBtn = [...element.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")]
      .find((btn) => btn.textContent?.trim() === "Save")!;
    saveBtn.click();

    await vi.waitFor(() => {
      expect(element.querySelector('[data-form-tab="script"]')?.getAttribute("data-errors")).toBe("1");
    });

    HTMLElement.prototype.scrollIntoView = vi.fn();
    element.querySelector<HTMLButtonElement>(".sdk-owner-form-refusal-count")!.click();
    await vi.waitFor(() => {
      expect(element.querySelector('[data-form-tab="script"]')?.getAttribute("aria-selected")).toBe("true");
      expect(element.querySelector('[data-field="/code"]')).not.toBeNull();
    });
  });

  it("navigates wizard steps with Previous/Next while sharing one draft and saving all steps together", async () => {
    const { element, savedPayloads } = mountFormScenario({
      config: {
        presentation: "steps",
        groups: [
          { key: "basics", titleKey: "step.basics", fields: ["/name", "/displayName"] },
          { key: "code", titleKey: "step.code", fields: ["/description", "/code", "/notes"] },
        ],
      },
    });

    await vi.waitFor(() => {
      expect(element.querySelector('[data-form-step="basics"]')).not.toBeNull();
    });
    expect(element.querySelector<HTMLButtonElement>("[data-form-step-prev]")!.disabled).toBe(true);
    setFieldValue(element, "/displayName", "Net Margin");
    await nextTick();

    element.querySelector<HTMLButtonElement>("[data-form-step-next]")!.click();
    await nextTick();
    expect(element.querySelector('[data-form-step="code"]')?.getAttribute("aria-current")).toBe("step");
    expect(element.querySelector<HTMLButtonElement>("[data-form-step-prev]")!.disabled).toBe(false);
    expect(element.querySelector("[data-form-step-next]")).toBeNull();

    setFieldValue(element, "/notes", "Reviewed");
    await nextTick();

    const saveBtn = [...element.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")]
      .find((btn) => btn.textContent?.trim() === "Save")!;
    saveBtn.click();

    await vi.waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect(savedPayloads[0]).toMatchObject({
      values: { displayName: "Net Margin", notes: "Reviewed" },
      submittedFields: expect.arrayContaining(["/displayName", "/notes"]),
    });
  });

  it("distributes fields across custom panel cards via #default + <object-form-fields> wired to usePanelFormDraft and usePanelBack", async () => {
    const { element, savedPayloads, mount, backCalls, confirmLeaveUnsaved, backHandleRef } = mountFormScenario({
      config: { actions: "none" },
      customSlot: true,
      withHeaderAndBack: true,
    });

    await vi.waitFor(() => {
      expect(element.querySelector('.custom-card-left [data-field="/name"]')).not.toBeNull();
      expect(element.querySelector('.custom-card-right [data-field="/code"]')).not.toBeNull();
    });
    // Left card has /name and /displayName; right card (`rest`) receives /description, /code, /notes only.
    expect(element.querySelector('.custom-card-right [data-field="/name"]')).toBeNull();
    expect(element.querySelector(".custom-card-left aside.sdk-info-banner")).not.toBeNull();

    setFieldValue(element, "/name", "shared_draft_fn");
    setFieldValue(element, "/code", "return 42;");
    await nextTick();

    expect(element.querySelector(".custom-two-cards")?.getAttribute("data-custom-dirty")).toBe("true");
    expect(element.querySelector(".custom-two-cards")?.getAttribute("data-custom-count")).toBe("2");

    // PageHeader draft controls (via usePanelFormDraft) reflect the shared dirty state and discard cleanly.
    const discardBtn = [...element.querySelectorAll<HTMLButtonElement>(".sdk-page-header-draft button")]
      .find((btn) => btn.textContent?.trim() === "Discard")!;
    expect(discardBtn.disabled).toBe(false);
    discardBtn.click();
    await clickDialogButton("Discard");

    await vi.waitFor(() => expect(mount.instance.dirty()).toBe(false));
    expect(element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe("calc_margin");
    expect(element.querySelector<HTMLInputElement>('[data-field="/code"] input')?.value).toBe("return a - b;");

    // Edit again across both custom cards and save via PageHeader Save button.
    setFieldValue(element, "/displayName", "Margin V2");
    setFieldValue(element, "/notes", "Updated across cards");
    await nextTick();

    const saveHeaderBtn = [...element.querySelectorAll<HTMLButtonElement>(".sdk-page-header-draft button")]
      .find((btn) => btn.textContent?.trim() === "Save")!;
    saveHeaderBtn.click();
    await vi.waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect(savedPayloads[0]).toMatchObject({
      values: { displayName: "Margin V2", notes: "Updated across cards" },
      submittedFields: expect.arrayContaining(["/displayName", "/notes"]),
    });

    // Edit again and verify usePanelBack guards unsaved edits and discards them on confirmation.
    await vi.waitFor(() => expect(mount.instance.dirty()).toBe(false));
    setFieldValue(element, "/name", "unsaved_before_back");
    await nextTick();
    expect(mount.instance.dirty()).toBe(true);

    const wentBack = await backHandleRef.current!.back();
    expect(wentBack).toBe(true);
    expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(1);
    expect(backCalls).toHaveBeenCalledTimes(1);
    expect(mount.instance.dirty()).toBe(false);
  });

  it("receives an agent page draft spanning multiple tabs and highlights changed tabs cleanly", async () => {
    const { element, mount } = mountFormScenario({
      config: {
        presentation: "tabs",
        groups: [
          { key: "general", titleKey: "tab.general", fields: ["/name", "/displayName", "/description"] },
          { key: "script", titleKey: "tab.script", fields: ["/code", "/notes"] },
        ],
      },
      initialUrl: "/functions?draftSessionId=7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d01&draftRunId=7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d02&draftPath=outputs%2Fdrafts%2Ffn.page-draft.json",
      draftArtifact: {
        pageKey: "fn-editor",
        operation: "function.update",
        target: { objectType: FUNCTION, id: "fn-1" },
        form: { displayName: "AI Margin", code: "return (a - b) * 100;" },
      },
    });

    await vi.waitFor(() => {
      expect(mount.instance.draft.value).not.toBeNull();
      expect(element.querySelector('[data-form-tab="general"]')?.classList.contains("is-changed")).toBe(true);
      expect(element.querySelector('[data-form-tab="script"]')?.classList.contains("is-changed")).toBe(true);
    });
    expect(element.querySelector<HTMLInputElement>('[data-field="/displayName"] input')?.value).toBe("AI Margin");

    element.querySelector<HTMLButtonElement>('[data-form-tab="script"]')!.click();
    await nextTick();
    expect(element.querySelector<HTMLInputElement>('[data-field="/code"] input')?.value).toBe("return (a - b) * 100;");
  });
});
