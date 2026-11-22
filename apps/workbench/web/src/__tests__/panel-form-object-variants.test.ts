import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import { EditorView } from "../../../../../packages/foundation-ui/node_modules/@codemirror/view";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelFormDescription, PanelFormField, PanelFormValues } from "@ontomato/contracts/panel-projection";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import { FUNCTION } from "@ontomato/contracts/platform-object-types";
import { randomId } from "@ontomato/contracts/random-id";
import { mountDirectPanel } from "../../../../../packages/apps-sdk/src/panel/direct-mount";
import { directRun, noOperations } from "./panel-frame";

/*
 * Discriminated variants on `kind: "object"` form controls (C4):
 * - Renders common fields + active variant fields (`panelFormObjectActiveFields`), including empty variants (`none`).
 * - Preserves inactive variant values in the local draft while editing, restores them when switching back, and keeps
 *   shared relative paths intact across variants.
 * - Prunes inactive variant keys (`pruneInactivePanelFormVariants`) on save and refresh without mutating the local
 *   draft on refusal; updates clean baseline on success.
 * - Supports nested object variants and per-row object variants inside `object-array`.
 * - Computes dirty state, changed count, Reset-to-default equality, and active `invalid` blocking from pruned/active
 *   variant values; Discard restores initial baseline.
 * - Places owner field-level errors on active variant subfields (top-level and array rows) and routes inactive-variant
 *   errors to the form refusal footer.
 * - Keeps `refreshOnChange` on the discriminator or variant subfields working while preserving inactive variant edits.
 */

const record = {
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
  path: "/workflows/:id",
  bodySchema: {},
  draftOperation: "workflow.update",
};

const projection: DirectProjection = {
  ...record,
  id: "variant-form",
  name: "Workflow step",
  componentId: "@ontomato/sdk:ObjectForm",
  inputs: {
    item: { kind: "object", objectType: FUNCTION },
    values: { kind: "json" },
    changedField: { kind: "scalar", type: "string" },
  },
  outputs: {},
  config: {},
  data: {
    form: {
      source: { object: { input: "item" } },
      read: "form",
      params: { values: { input: "values" }, changedField: { input: "changedField" } },
    },
  },
  operations: {
    save: {
      operation: { kind: "PlatformOperation", id: `${FUNCTION}.save` },
      target: { input: "item" },
    },
  },
};

const manifest: DirectPanelManifest = {
  state: { item: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: true, external: false } },
  members: { form: { target: { projectionId: projection.id }, inputs: { item: { state: "item" } } } },
  commands: {},
};

const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

function textField(path: string, label: string, extra: Partial<PanelFormField> = {}): PanelFormField {
  return {
    path,
    label,
    required: false,
    readOnly: false,
    valueSchema: { type: "string" },
    control: { kind: "text", multiline: false },
    ...extra,
  };
}

function selectField(
  path: string,
  label: string,
  options: Array<{ value: string; label: string }>,
  extra: Partial<PanelFormField> = {},
): PanelFormField {
  return {
    path,
    label,
    required: true,
    readOnly: false,
    valueSchema: { type: "string" },
    control: {
      kind: "select",
      options: options.map((option) => ({
        ...option,
        description: null,
        disabled: false,
        disabledReason: null,
      })),
      multiple: false,
      allowCreate: false,
    },
    ...extra,
  };
}

function executorControl(options: {
  refreshOnKind?: boolean;
  refreshOnRuleId?: boolean;
  includeSharedNote?: boolean;
  includeJsonConfig?: boolean;
  includeNestedVariant?: boolean;
} = {}): PanelFormField["control"] {
  const ruleFields: PanelFormField[] = [
    textField("/ruleId", "Rule ID", { required: true, refreshOnChange: options.refreshOnRuleId }),
  ];
  const agentFields: PanelFormField[] = [
    textField("/agentId", "Agent ID", { required: true }),
    textField("/prompt", "Prompt"),
  ];
  if (options.includeSharedNote) {
    ruleFields.push(textField("/note", "Rule note"));
    agentFields.push(textField("/note", "Agent note"));
  }
  if (options.includeJsonConfig) {
    agentFields.push({
      path: "/config",
      label: "Config JSON",
      required: false,
      readOnly: false,
      valueSchema: { type: "object" },
      control: { kind: "code", language: "json" },
    });
  }
  if (options.includeNestedVariant) {
    agentFields.push({
      path: "/delivery",
      label: "Delivery",
      required: false,
      readOnly: false,
      valueSchema: { type: "object" },
      control: {
        kind: "object",
        defaultObject: { mode: "inline" },
        fields: [
          selectField("/mode", "Delivery mode", [
            { value: "inline", label: "Inline" },
            { value: "webhook", label: "Webhook" },
          ]),
        ],
        variantBy: "/mode",
        variants: {
          inline: [],
          webhook: [textField("/url", "Webhook URL", { required: true })],
        },
      },
    });
  }
  return {
    kind: "object",
    defaultObject: { kind: "rule", ruleId: "rule-default" },
    fields: [
      selectField(
        "/kind",
        "Executor kind",
        [
          { value: "none", label: "None" },
          { value: "rule", label: "Rule" },
          { value: "agent", label: "Agent" },
        ],
        { refreshOnChange: options.refreshOnKind },
      ),
    ],
    variantBy: "/kind",
    variants: {
      none: [],
      rule: ruleFields,
      agent: agentFields,
    },
  };
}

interface MountOptions {
  fields: PanelFormField[];
  values: PanelFormValues;
  onSave?: (input: Record<string, RuntimeJsonValue>) => Promise<PanelOperationOutcome> | PanelOperationOutcome;
  onRefresh?: (values: PanelFormValues, changedField: string) => PanelFormDescription;
}

function mountVariantForm(options: MountOptions) {
  const saves: Array<Record<string, RuntimeJsonValue>> = [];
  const refreshes: Array<{ values: PanelFormValues; changedField: string }> = [];
  const baseDescription: PanelFormDescription = {
    fields: options.fields,
    values: options.values,
    errors: [],
    revision: 1,
    save: formSaveMeta,
  };
  let lastPayload: Record<string, RuntimeJsonValue> = {};

  const mount = mountDirectPanel({
    manifest,
    run: directRun({
      pageKey: "workflows",
      url: () => "/workflows",
      label: () => "Workflows",
      initial: { item: { className: FUNCTION, primaryKey: "wf-1" } },
    }),
    messages: {},
    locale: ref("en"),
    defaultLocale: "en",
    requests: {
      request: async (path, init) => {
        if (path === "/panel-operations/intents") {
          const body = JSON.parse(String(init?.body)) as { call: { input: Record<string, RuntimeJsonValue> } };
          lastPayload = body.call.input;
          saves.push(lastPayload);
          return Response.json({
            intentId: randomId(),
            operationId: "form.save",
            label: "Save",
            confirmation: { kind: "none" },
          });
        }
        return Response.json({ projection });
      },
    },
    use: { applicationId: "app", useId: "workflows" },
    expandPageComposer: noOperations.expandPageComposer,
    navigate: noOperations.navigate,
    nested: noOperations.nested,
    confirmOperation: async (preparation) => {
      const outcome: PanelOperationOutcome = options.onSave
        ? await options.onSave(lastPayload)
        : {
            kind: "success",
            data: {},
            affected: { objects: [{ objectType: FUNCTION, primaryKey: "wf-1" }], objectTypes: [FUNCTION] },
          };
      return {
        decision: "confirm",
        response: { kind: "dispatched", intentId: preparation.intentId, outcome },
      };
    },
    read: async (request): Promise<ProductPanelReadResponse> => {
      if (request.operations) return ready({ save: saveDescriptor });
      const changedField = (request.runtimeParams?.changedField ?? request.inputs?.changedField ?? null) as string | null;
      const incomingValues = (request.runtimeParams?.values ?? request.inputs?.values) as PanelFormValues | undefined;
      if (changedField && incomingValues) {
        refreshes.push({ values: structuredClone(incomingValues), changedField });
        if (options.onRefresh) return ready(options.onRefresh(incomingValues, changedField));
        return ready({ ...baseDescription, values: incomingValues });
      }
      return ready(baseDescription);
    },
  });

  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => mount.member("form") })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } }))
    .use(ElementPlus);
  app.mount(element);

  const item = (path: string) => element.querySelector<HTMLElement>(`[data-field="${path}"]`);
  const inputOf = (path: string) => item(path)?.querySelector<HTMLInputElement>("input") ?? null;
  const errorOf = (path: string) => item(path)?.querySelector(".el-form-item__error")?.textContent?.trim() ?? null;
  const typeText = async (path: string, value: string) => {
    const input = inputOf(path);
    if (!input) throw new Error(`No input at ${path}`);
    input.value = value;
    input.dispatchEvent(new Event("input"));
    await nextTick();
  };
  const typeCode = async (path: string, text: string) => {
    const editor = await vi.waitFor(() => {
      const found = item(path)?.querySelector<HTMLElement>(".cm-editor");
      if (!found) throw new Error(`No CodeMirror editor at ${path}`);
      return found;
    }, { timeout: 5000 });
    const view = EditorView.findFromDOM(editor);
    if (!view) throw new Error(`No CodeMirror EditorView at ${path}`);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    await nextTick();
  };
  const buttonIn = (root: Element, label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label) ?? null;

  return {
    instance: mount.instance,
    element,
    saves,
    refreshes,
    item,
    inputOf,
    errorOf,
    typeText,
    typeCode,
    buttonIn,
    form: () => mount.instance.forms.handle("form")!,
    dispose: () => {
      app.unmount();
      element.remove();
    },
  };
}

async function confirmDiscardDialog() {
  const box = await vi.waitFor(() => {
    const open = [...document.querySelectorAll<HTMLElement>(".el-message-box")]
      .filter((el) => el.closest<HTMLElement>(".el-overlay")?.style.display !== "none");
    if (!open.length) throw new Error("Confirm dialog not open");
    return open.at(-1)!;
  });
  const btn = [...box.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Discard");
  if (!btn) throw new Error("Discard button not found in dialog");
  btn.click();
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ObjectForm discriminated object variants", () => {
  it("switches top-level object variants, preserves inactive values in draft, keeps shared paths, and supports Add/Remove", async () => {
    const harness = mountVariantForm({
      fields: [
        {
          path: "/executor",
          label: "Executor",
          required: false,
          readOnly: false,
          valueSchema: { type: ["object", "null"] },
          control: executorControl({ includeSharedNote: true }),
        },
      ],
      values: { executor: { kind: "none" } },
    });

    try {
      await vi.waitFor(() => expect(harness.item("/executor/kind")).not.toBeNull());
      // `none` variant renders only the common discriminator field.
      expect(harness.item("/executor/ruleId")).toBeNull();
      expect(harness.item("/executor/agentId")).toBeNull();

      // Switch to `rule`, fill ruleId and shared note.
      harness.form().set("/executor/kind", "rule");
      await nextTick();
      expect(harness.item("/executor/ruleId")).not.toBeNull();
      expect(harness.item("/executor/agentId")).toBeNull();
      await harness.typeText("/executor/ruleId", "rule-pricing");
      await harness.typeText("/executor/note", "shared-explanation");

      // Switch to `agent`: ruleId hides, agentId + prompt show, shared `/note` keeps its value without clearing.
      harness.form().set("/executor/kind", "agent");
      await nextTick();
      expect(harness.item("/executor/ruleId")).toBeNull();
      expect(harness.item("/executor/agentId")).not.toBeNull();
      expect(harness.inputOf("/executor/note")?.value).toBe("shared-explanation");
      await harness.typeText("/executor/agentId", "agent-analyst");
      await harness.typeText("/executor/prompt", "Check order");

      // Switch back to `rule`: previously typed `ruleId` is still preserved in the draft and shown immediately.
      harness.form().set("/executor/kind", "rule");
      await nextTick();
      expect(harness.inputOf("/executor/ruleId")?.value).toBe("rule-pricing");
      expect(harness.item("/executor/agentId")).toBeNull();

      // Switch back to `agent`: `agentId` and `prompt` are still preserved.
      harness.form().set("/executor/kind", "agent");
      await nextTick();
      expect(harness.inputOf("/executor/agentId")?.value).toBe("agent-analyst");
      expect(harness.inputOf("/executor/prompt")?.value).toBe("Check order");

      // Remove optional object writes null; Add initializes from defaultObject (`kind: "rule"`) and shows rule fields.
      harness.buttonIn(harness.item("/executor")!, "Remove")!.click();
      await nextTick();
      expect(harness.form().values.value.executor).toBeNull();
      expect(harness.item("/executor/kind")).toBeNull();

      harness.buttonIn(harness.item("/executor")!, "Add")!.click();
      await nextTick();
      expect(harness.item("/executor/ruleId")).not.toBeNull();
      expect(harness.inputOf("/executor/ruleId")?.value).toBe("rule-default");
    } finally {
      harness.dispose();
    }
  });

  it("prunes inactive variant keys on save, keeps local draft intact on refusal, and clears pruned baseline on success", async () => {
    let failNext = true;
    const harness = mountVariantForm({
      fields: [
        {
          path: "/executor",
          label: "Executor",
          required: true,
          readOnly: false,
          valueSchema: { type: "object" },
          control: executorControl(),
        },
      ],
      values: { executor: { kind: "rule", ruleId: "rule-1" } },
      onSave: async () => {
        if (failNext) {
          failNext = false;
          return {
            kind: "refusal",
            code: "VALIDATION_FAILED",
            message: "Agent ID is required",
            errors: [{ field: "/executor/agentId", code: "required", message: "Pick an agent" }],
          };
        }
        return {
          kind: "success",
          data: {},
          affected: { objects: [{ objectType: FUNCTION, primaryKey: "wf-1" }], objectTypes: [FUNCTION] },
        };
      },
    });

    try {
      await vi.waitFor(() => expect(harness.inputOf("/executor/ruleId")?.value).toBe("rule-1"));

      // Edit ruleId, then switch to `agent` and leave agentId empty to trigger refusal.
      await harness.typeText("/executor/ruleId", "rule-edited");
      harness.form().set("/executor/kind", "agent");
      await nextTick();
      await harness.typeText("/executor/prompt", "Summarize");

      // First save is refused: payload must have pruned `ruleId`, while local draft still retains `ruleId`.
      await expect(harness.instance.invoke("form.save")).rejects.toThrow("Agent ID is required");
      expect(harness.saves[0]?.values).toEqual({
        executor: { kind: "agent", prompt: "Summarize" },
      });
      await vi.waitFor(() => expect(harness.errorOf("/executor/agentId")).toBe("Pick an agent"));

      // Switching back to `rule` after refusal still restores the unsaved `rule-edited` draft value.
      harness.form().set("/executor/kind", "rule");
      await nextTick();
      expect(harness.inputOf("/executor/ruleId")?.value).toBe("rule-edited");

      // Switch back to `agent`, fill agentId, and save successfully: payload is pruned and form becomes clean.
      harness.form().set("/executor/kind", "agent");
      await nextTick();
      await harness.typeText("/executor/agentId", "agent-42");
      await harness.instance.invoke("form.save");
      expect(harness.saves[1]?.values).toEqual({
        executor: { kind: "agent", agentId: "agent-42", prompt: "Summarize" },
      });
      expect(harness.instance.dirty()).toBe(false);
    } finally {
      harness.dispose();
    }
  });

  it("supports independent per-row variants in object-array and nested object variants, pruning each on save", async () => {
    const harness = mountVariantForm({
      fields: [
        {
          path: "/steps",
          label: "Steps",
          required: false,
          readOnly: false,
          valueSchema: { type: "array" },
          control: {
            kind: "object-array",
            itemKeyPath: "/id",
            defaultItem: { id: "step-new", executor: { kind: "none" } },
            itemFields: [
              textField("/id", "Step ID", { required: true }),
              {
                path: "/executor",
                label: "Executor",
                required: true,
                readOnly: false,
                valueSchema: { type: "object" },
                control: executorControl({ includeNestedVariant: true }),
              },
            ],
          },
        },
      ],
      values: {
        steps: [
          { id: "s1", executor: { kind: "rule", ruleId: "r-1" } },
          { id: "s2", executor: { kind: "agent", agentId: "a-1", delivery: { mode: "inline" } } },
        ],
      },
    });

    try {
      await vi.waitFor(() => expect(harness.inputOf("/steps/0/executor/ruleId")?.value).toBe("r-1"));
      expect(harness.item("/steps/0/executor/agentId")).toBeNull();
      expect(harness.inputOf("/steps/1/executor/agentId")?.value).toBe("a-1");
      expect(harness.item("/steps/1/executor/ruleId")).toBeNull();
      expect(harness.item("/steps/1/executor/delivery/url")).toBeNull();

      // Switch row 0 from `rule` to `agent` and type agentId; row 1 stays independent and switches nested delivery to `webhook`.
      harness.form().set("/steps/0/executor/kind", "agent");
      harness.form().set("/steps/1/executor/delivery/mode", "webhook");
      await nextTick();
      expect(harness.item("/steps/0/executor/agentId")).not.toBeNull();
      expect(harness.item("/steps/1/executor/delivery/url")).not.toBeNull();
      await harness.typeText("/steps/0/executor/agentId", "a-row0");
      await harness.typeText("/steps/1/executor/delivery/url", "https://hooks.example/run");

      // Switch row 1's nested delivery back to `inline`, then switch row 0 back to `rule` to confirm preservation.
      harness.form().set("/steps/1/executor/delivery/mode", "inline");
      harness.form().set("/steps/0/executor/kind", "rule");
      await nextTick();
      expect(harness.inputOf("/steps/0/executor/ruleId")?.value).toBe("r-1");
      expect(harness.item("/steps/1/executor/delivery/url")).toBeNull();

      // Switch row 1's delivery back to `webhook` -> URL is preserved; then switch back to `inline` before saving.
      harness.form().set("/steps/1/executor/delivery/mode", "webhook");
      await nextTick();
      expect(harness.inputOf("/steps/1/executor/delivery/url")?.value).toBe("https://hooks.example/run");
      harness.form().set("/steps/1/executor/delivery/mode", "inline");
      await nextTick();

      // Switch row 0 to `agent` again (agentId preserved) and save.
      harness.form().set("/steps/0/executor/kind", "agent");
      await nextTick();
      expect(harness.inputOf("/steps/0/executor/agentId")?.value).toBe("a-row0");

      await harness.instance.invoke("form.save");
      expect(harness.saves[0]?.values).toEqual({
        steps: [
          { id: "s1", executor: { kind: "agent", agentId: "a-row0" } },
          { id: "s2", executor: { kind: "agent", agentId: "a-1", delivery: { mode: "inline" } } },
        ],
      });
    } finally {
      harness.dispose();
    }
  });

  it("computes dirty, changedCount, Reset-to-default, Discard, and invalid JSON blocking against active pruned variants", async () => {
    const harness = mountVariantForm({
      fields: [
        textField("/name", "Name"),
        {
          path: "/executor",
          label: "Executor",
          required: true,
          readOnly: false,
          defaultValue: { kind: "rule", ruleId: "rule-initial" },
          valueSchema: { type: "object" },
          control: executorControl({ includeJsonConfig: true }),
        },
      ],
      values: {
        name: "Daily check",
        executor: { kind: "rule", ruleId: "rule-initial" },
      },
    });

    try {
      await vi.waitFor(() => expect(harness.inputOf("/executor/ruleId")?.value).toBe("rule-initial"));
      expect(harness.instance.dirty()).toBe(false);
      const resetButton = () => harness.item("/executor")!.querySelector<HTMLButtonElement>("[data-field-reset]")!;
      expect(resetButton().disabled).toBe(true);

      // Switch from `rule` -> `agent`, type invalid JSON in `/executor/config` -> blocks saving while `agent` is active.
      harness.form().set("/executor/kind", "agent");
      await nextTick();
      await vi.waitFor(() => expect(harness.item("/executor/config")?.querySelector(".cm-editor")).toBeTruthy(), { timeout: 5000 });
      await harness.typeText("/executor/agentId", "agent-1");
      await harness.typeCode("/executor/config", '{"bad": ');
      await vi.waitFor(() => expect(harness.errorOf("/executor/config")).toMatch(/^Not valid JSON/));
      expect(harness.instance.dirty()).toBe(true);
      expect(resetButton().disabled).toBe(false);
      await expect(harness.instance.invoke("form.save")).rejects.toThrow("Correct the marked fields before saving");
      expect(harness.saves).toHaveLength(0);

      // Switch back to `rule` without changing `ruleId`: pruned value matches baseline and default -> NOT dirty, reset disabled.
      harness.form().set("/executor/kind", "rule");
      await nextTick();
      expect(harness.instance.dirty()).toBe(false);
      expect(resetButton().disabled).toBe(true);

      // Edit `/name` only: changedCount is 1 (only `/name`), and saving succeeds without being blocked by inactive JSON field.
      await harness.typeText("/name", "Hourly check");
      expect(harness.instance.dirty()).toBe(true);
      expect(harness.element.querySelector(".sdk-owner-form-unsaved")?.textContent?.trim()).toBe("1 change");
      await harness.instance.invoke("form.save");
      expect(harness.saves[0]?.values).toEqual({
        name: "Hourly check",
        executor: { kind: "rule", ruleId: "rule-initial" },
      });
      expect(harness.instance.dirty()).toBe(false);

      // Switch to `agent` again, edit agentId, then click Reset to default -> restores `{ kind: "rule", ruleId: "rule-initial" }`.
      harness.form().set("/executor/kind", "agent");
      await nextTick();
      await harness.typeText("/executor/agentId", "agent-2");
      expect(resetButton().disabled).toBe(false);
      resetButton().click();
      await nextTick();
      expect(harness.item("/executor/ruleId")).not.toBeNull();
      expect(harness.inputOf("/executor/ruleId")?.value).toBe("rule-initial");
      expect(resetButton().disabled).toBe(true);

      // Switch to `agent`, edit prompt, then Discard -> restores baseline cleanly.
      harness.form().set("/executor/kind", "agent");
      await nextTick();
      await harness.typeText("/executor/prompt", "Temporary");
      expect(harness.instance.dirty()).toBe(true);
      harness.buttonIn(harness.element.querySelector(".sdk-owner-form-actions")!, "Discard")!.click();
      await confirmDiscardDialog();
      await vi.waitFor(() => expect(harness.instance.dirty()).toBe(false));
      expect(harness.inputOf("/executor/ruleId")?.value).toBe("rule-initial");
      expect(harness.item("/executor/agentId")).toBeNull();
    } finally {
      harness.dispose();
    }
  });

  it("places owner field errors on active variant subfields (top-level and array row) and routes inactive errors to footer", async () => {
    const harness = mountVariantForm({
      fields: [
        {
          path: "/executor",
          label: "Executor",
          required: true,
          readOnly: false,
          valueSchema: { type: "object" },
          control: executorControl(),
        },
        {
          path: "/steps",
          label: "Steps",
          required: false,
          readOnly: false,
          valueSchema: { type: "array" },
          control: {
            kind: "object-array",
            itemFields: [
              {
                path: "/executor",
                label: "Step executor",
                required: true,
                readOnly: false,
                valueSchema: { type: "object" },
                control: executorControl(),
              },
            ],
          },
        },
      ],
      values: {
        executor: { kind: "rule", ruleId: "" },
        steps: [{ executor: { kind: "agent", agentId: "" } }],
      },
      onSave: async () => ({
        kind: "refusal",
        code: "VALIDATION_FAILED",
        message: "Fix executor settings",
        errors: [
          { field: "/executor/ruleId", code: "invalid_format", message: "Rule must exist" },
          { field: "/steps/0/executor/agentId", code: "required", message: "Step agent is required" },
          { field: "/executor/agentId", code: "invalid_format", message: "Inactive variant error falls back to footer" },
        ],
      }),
    });

    try {
      await vi.waitFor(() => expect(harness.item("/executor/ruleId")).not.toBeNull());
      await expect(harness.instance.invoke("form.save")).rejects.toThrow("Fix executor settings");
      // Active variant subfield errors appear directly on their controls.
      await vi.waitFor(() => expect(harness.errorOf("/executor/ruleId")).toBe("Rule must exist"));
      expect(harness.errorOf("/steps/0/executor/agentId")).toBe("Step agent is required");
      // Refusal footer counts the 2 active field errors and prints the 1 unplaced inactive-variant error in full.
      expect(harness.element.querySelector(".sdk-owner-form-refusal-count")?.textContent?.trim()).toContain("2");
      expect(harness.element.querySelector(".sdk-owner-form-refusal")?.textContent).toContain(
        "Inactive variant error falls back to footer",
      );
    } finally {
      harness.dispose();
    }
  });

  it("runs refreshOnChange on variantBy and variant subfields with pruned values while preserving inactive draft edits", async () => {
    const harness = mountVariantForm({
      fields: [
        {
          path: "/executor",
          label: "Executor",
          required: true,
          readOnly: false,
          valueSchema: { type: "object" },
          control: executorControl({ refreshOnKind: true, refreshOnRuleId: true }),
        },
      ],
      values: { executor: { kind: "rule", ruleId: "rule-1" } },
      onRefresh: (incomingValues, changedField) => ({
        fields: [
          {
            path: "/executor",
            label: "Executor",
            required: true,
            readOnly: false,
            valueSchema: { type: "object" },
            control: executorControl({ refreshOnKind: true, refreshOnRuleId: true }),
          },
        ],
        values: changedField === "/executor/kind" && (incomingValues.executor as PanelFormValues).kind === "agent"
          ? { executor: { kind: "agent", agentId: "", prompt: "Owner suggested prompt" } }
          : incomingValues,
        errors: [],
        revision: 1,
        save: formSaveMeta,
      }),
    });

    try {
      await vi.waitFor(() => expect(harness.inputOf("/executor/ruleId")?.value).toBe("rule-1"));

      // Edit ruleId (triggers refreshOnChange on variant subfield).
      await harness.typeText("/executor/ruleId", "rule-custom");
      await vi.waitFor(() => expect(harness.refreshes).toHaveLength(1));
      expect(harness.refreshes[0]).toEqual({
        changedField: "/executor/ruleId",
        values: { executor: { kind: "rule", ruleId: "rule-custom" } },
      });

      // Switch variantBy `/executor/kind` to `agent` (triggers refreshOnChange on discriminator).
      harness.form().set("/executor/kind", "agent");
      await vi.waitFor(() => expect(harness.refreshes).toHaveLength(2));
      expect(harness.refreshes[1]).toEqual({
        changedField: "/executor/kind",
        values: { executor: { kind: "agent" } },
      });
      await vi.waitFor(() => expect(harness.inputOf("/executor/prompt")?.value).toBe("Owner suggested prompt"));

      // Inactive `ruleId` edit was preserved across the owner refresh.
      harness.form().set("/executor/kind", "rule");
      await vi.waitFor(() => expect(harness.refreshes).toHaveLength(3));
      expect(harness.inputOf("/executor/ruleId")?.value).toBe("rule-custom");
    } finally {
      harness.dispose();
    }
  });
});
