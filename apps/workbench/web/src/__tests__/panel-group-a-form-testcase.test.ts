import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, createApp, defineComponent, h, nextTick, provide, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import {
  panelFormSaveInputSchema,
  type PanelFormDescription,
  type PanelFormSaveInput,
  type PanelFormValues,
} from "@ontomato/contracts/panel-projection";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import { createPanelInstance } from "../../../../../packages/apps-sdk/src/panel/instance";
import { panelContextKey, projectionKey, type ProjectionSlot } from "../../../../../packages/apps-sdk/src/panel/context";
import {
  computeDraftBaselineHash,
  localDraftStoreKey,
  objectDraftKey,
  objectDraftPrefix,
  type PanelLocalDraftRecord,
  type PanelLocalDraftStore,
} from "../../../../../packages/apps-sdk/src/panel/local-drafts";
import { portsOf } from "../../../../../packages/apps-sdk/src/panel/ports-of";
import { panelMemberKey, type PanelMemberContext } from "../../../../../packages/apps-sdk/src/panel/member";
import { PlatformObjectRefusal } from "../../../../../packages/apps-sdk/src/panel/platform-objects";
import ObjectForm from "../../../../../packages/apps-sdk/src/base/ObjectForm.vue";
import TestcaseWorkbench from "../../../../../packages/apps-sdk/src/base/TestcaseWorkbench.vue";
import type { ObjectFormUnsavedSwitchMode } from "../../../../../packages/apps-sdk/src/base/object-form-types";
import { noOperations } from "./panel-frame";

const platformShellMocks = vi.hoisted(() => ({
  confirmDanger: vi.fn<unknown[], Promise<boolean>>(),
  confirmUnsavedSwitch: vi.fn<unknown[], Promise<"save" | "discard" | "cancel">>(),
}));

vi.mock("@ontomato/platform-shell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ontomato/platform-shell")>();
  return {
    ...actual,
    confirmDanger: platformShellMocks.confirmDanger,
    confirmUnsavedSwitch: platformShellMocks.confirmUnsavedSwitch,
  };
});

const SECRET_OBJECT = "platform:Connector";
const CASE_SET_OBJECT = "platform:AutotestCaseSet";

function createMemoryDraftStore(): PanelLocalDraftStore & { readonly map: Map<string, PanelLocalDraftRecord> } {
  const map = new Map<string, PanelLocalDraftRecord>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    map,
    read(key: string) {
      return map.get(key) ?? null;
    },
    write(key: string, record: PanelLocalDraftRecord) {
      map.set(key, record);
      notify();
    },
    remove(key: string) {
      if (map.delete(key)) notify();
    },
    has(key: string) {
      return map.has(key);
    },
    hasObject(objectType: string, primaryKey: string) {
      const prefix = objectDraftPrefix(objectType, primaryKey);
      for (const key of map.keys()) {
        if (key.startsWith(prefix)) return true;
      }
      return false;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

async function flush() {
  for (let i = 0; i < 16; i += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

function makeFormProjection(id: string, objectType: string, inputName: string): ProductProjection {
  return {
    id,
    name: id,
    description: null,
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: {
      [inputName]: { kind: "object", objectType },
      values: { kind: "json" },
      changedField: { kind: "scalar", type: "string" },
    },
    outputs: {},
    config: {},
    data: {
      form: {
        source: { object: { input: inputName } },
        read: "form",
        params: { values: { input: "values" }, changedField: { input: "changedField" } },
      },
    },
    operations: {
      save: {
        operation: { kind: "PlatformOperation", id: `${objectType}.save` },
        target: { input: inputName },
      },
    },
  } as unknown as ProductProjection;
}

function connectorFormDescription(values: PanelFormValues, revision = 1): PanelFormDescription {
  return {
    fields: [
      {
        path: "/displayName",
        label: "Display name",
        required: true,
        readOnly: false,
        valueSchema: {},
        control: { kind: "text" },
      },
      {
        path: "/endpoint",
        label: "Endpoint",
        required: false,
        readOnly: false,
        valueSchema: {},
        control: { kind: "text" },
      },
      {
        path: "/apiKey",
        label: "API key",
        required: false,
        readOnly: false,
        valueSchema: {},
        control: { kind: "text", secret: true },
      },
    ],
    values,
    revision,
    errors: [],
    save: { method: "PUT", path: "/platform/connectors/:id", bodySchema: {} },
  };
}

function caseSetFormDescription(
  name: string,
  cases: Array<{
    caseId: string;
    question: string;
    expectedAnswer?: string;
    expectedLogic?: string;
    judgment?: string;
  }>,
  revision = 3,
): PanelFormDescription {
  return {
    fields: [
      {
        path: "/name",
        label: "Case set name",
        required: true,
        readOnly: false,
        valueSchema: {},
        control: { kind: "text" },
      },
      {
        path: "/cases",
        label: "Test cases",
        required: false,
        readOnly: false,
        valueSchema: {},
        control: {
          kind: "object-array",
          itemKeyPath: "/caseId",
          defaultItem: {
            caseId: "",
            question: "",
            expectedAnswer: "",
            expectedLogic: "",
            judgment: "Default judgment",
          },
          itemFields: [
            { path: "/caseId", label: "Case ID", required: true, readOnly: false, valueSchema: {}, control: { kind: "text", placeholder: "case-001" } },
            { path: "/question", label: "Question", required: true, readOnly: false, valueSchema: {}, control: { kind: "text", multiline: true } },
            { path: "/expectedAnswer", label: "Expected answer", required: false, readOnly: false, valueSchema: {}, control: { kind: "text", multiline: true } },
            { path: "/judgment", label: "Judgment", required: false, readOnly: false, valueSchema: {}, control: { kind: "text", multiline: true, placeholder: "Default judgment" } },
            { path: "/expectedLogic", label: "Expected logic", required: false, readOnly: false, valueSchema: {}, control: { kind: "text", multiline: true } },
          ],
        },
      },
    ],
    values: { name, cases },
    revision,
    errors: [],
    save: { method: "PUT", path: "/api/observe/autotest/case-sets/:id", bodySchema: {} },
  };
}

interface MountObjectFormOptions {
  projectionId?: string;
  initialKey?: string;
  records: Record<string, { values: PanelFormValues; revision?: number }>;
  draftStore: PanelLocalDraftStore;
  persistDraft?: boolean;
  unsavedSwitchMode?: ObjectFormUnsavedSwitchMode;
  config?: { persistDraft?: boolean; unsavedSwitchMode?: ObjectFormUnsavedSwitchMode };
  onSave?: (primaryKey: string, input: PanelFormSaveInput) => Promise<PanelOperationOutcome | void>;
}

function mountObjectForm(options: MountObjectFormOptions) {
  const projectionId = options.projectionId ?? "projection-connector-general";
  const initialKey = options.initialKey ?? "conn-1";
  const projection = makeFormProjection(projectionId, SECRET_OBJECT, "connector");
  const panel = definePanel({
    state: { selected: { type: { kind: "object", objectType: SECRET_OBJECT }, deepLink: true } },
    members: { form: { target: { projectionId }, inputs: { connector: { state: "selected" } } } },
  });

  let pendingInput: PanelFormSaveInput | null = null;
  let pendingTargetKey = initialKey;
  const savedCalls: Array<{ primaryKey: string; input: PanelFormSaveInput }> = [];

  const overlayRoot = document.createElement("section");
  document.body.append(overlayRoot);
  const instance = createPanelInstance(panel, {
    text: (key) => key,
    overlayRoot,
    operations: {
      ...noOperations.operations,
      async prepare(operationId, invocation) {
        if (!("call" in invocation)) throw new Error("Expected a single call");
        pendingInput = panelFormSaveInputSchema.parse(invocation.call.input);
        const callTarget = invocation.call.target;
        pendingTargetKey = callTarget !== null && callTarget.kind === "object" ? callTarget.primaryKey : "";
        return {
          intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d05",
          operationId,
          label: "Save",
          confirmation: { kind: "none" },
        };
      },
    },
    async confirmOperation({ intentId }) {
      const captured = pendingInput!;
      savedCalls.push({ primaryKey: pendingTargetKey, input: captured });
      const outcome = await options.onSave?.(pendingTargetKey, captured) ?? { kind: "success" as const, data: {} };
      return { decision: "confirm", response: { kind: "dispatched", intentId, outcome } };
    },
    pageKey: "test-object-form",
    url: () => "/applications/test/connectors",
    label: () => "Connectors",
    initial: { selected: { className: SECRET_OBJECT, primaryKey: initialKey } },
    readProjection: async () => projection,
  });

  const operations = computed(() => ({
    status: "ready" as const,
    value: {
      save: {
        kind: "form.save" as const,
        handlerRef: `${SECRET_OBJECT}.save`,
        label: "Save",
        effect: "write" as const,
        target: { source: "input" as const, input: "connector" },
        inputSchema: {},
        resultSchema: {},
        batch: false,
      },
    },
  }));

  const unregister = instance.register({
    slot: "form",
    projectionId: projection.id,
    ports: portsOf(projection),
    operations: operations.value.value,
  });

  const inputs = computed(() => ({ connector: instance.state.values.value.selected }));
  const slot: ProjectionSlot = { slot: "form", projection, inputs: inputs.value };
  const member: PanelMemberContext = {
    key: "form",
    projection,
    inputs,
    operations,
    data: {
      use() {
        throw new Error("Form reads on demand");
      },
      async read(_name, _params, readInputs = {}) {
        const primaryKey = (readInputs.connector as { primaryKey: string }).primaryKey;
        const record = options.records[primaryKey];
        if (!record) throw new Error(`Missing record ${primaryKey}`);
        return {
          status: "ready",
          value: connectorFormDescription(record.values, record.revision ?? 1),
        };
      },
    },
  };

  const element = document.createElement("div");
  document.body.appendChild(element);

  const app = createApp(
    defineComponent({
      setup() {
        provide(localDraftStoreKey, options.draftStore);
        provide(panelContextKey, {
          panel: { content: { html: "", module: "" }, manifest: panel },
          manifest: panel,
          instance,
          overlayRoot,
          projection: (id: string) => instance.projection(id),
          invoke: (handlerRef: string, call) => instance.runHandler(handlerRef, call),
          projectionsChanged: () => () => {},
          holdUnsaved: () => () => {},
          t: (key: string) => key,
          resources: async () => {},
          expandPageComposer: async () => {},
          notify: () => {},
          readPanelData: async () => { throw new Error("unused"); },
          navigate: async () => {},
          navigateBack: async () => {},
          currentEntry: computed(() => null),
          entryMenu: computed(() => null),
          currentUser: computed(() => null),
          hasLocalDraft: (ref) => options.draftStore.hasObject(ref.className, ref.primaryKey),
        });
        provide(projectionKey, slot);
        provide(panelMemberKey, () => member);
        return () => h(ObjectForm, {
          ...(options.config ?? {}),
          ...(options.persistDraft !== undefined ? { persistDraft: options.persistDraft } : {}),
          ...(options.unsavedSwitchMode !== undefined ? { unsavedSwitchMode: options.unsavedSwitchMode } : {}),
        });
      },
    }),
  );

  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus);
  app.mount(element);

  const cleanup = () => {
    app.unmount();
    unregister();
    element.remove();
    overlayRoot.remove();
  };

  return { app, element, instance, savedCalls, cleanup, overlayRoot };
}

interface MountTestcaseWorkbenchOptions {
  projectionId?: string;
  initialKey?: string;
  records: Record<string, {
    name: string;
    cases: Array<{
      caseId: string;
      question: string;
      expectedAnswer?: string;
      expectedLogic?: string;
      judgment?: string;
    }>;
    revision?: number;
  }>;
  draftStore: PanelLocalDraftStore;
  persistDraft?: boolean;
  unsavedSwitchMode?: ObjectFormUnsavedSwitchMode;
  showFooterBar?: boolean;
  config?: { persistDraft?: boolean; unsavedSwitchMode?: ObjectFormUnsavedSwitchMode; showFooterBar?: boolean; emptyText?: string };
  onSave?: (primaryKey: string, input: PanelFormSaveInput) => Promise<PanelOperationOutcome | void>;
}

function mountTestcaseWorkbench(options: MountTestcaseWorkbenchOptions) {
  const projectionId = options.projectionId ?? "projection-case-set-workbench";
  const initialKey = options.initialKey ?? "set-1";
  const projection = makeFormProjection(projectionId, CASE_SET_OBJECT, "caseSet");
  const panel = definePanel({
    state: { selectedCaseSet: { type: { kind: "object", objectType: CASE_SET_OBJECT }, deepLink: true } },
    members: { workbench: { target: { projectionId }, inputs: { caseSet: { state: "selectedCaseSet" } } } },
  });

  let pendingInput: PanelFormSaveInput | null = null;
  let pendingTargetKey = initialKey;
  const savedCalls: Array<{ primaryKey: string; input: PanelFormSaveInput }> = [];
  const emittedSaved = ref<Array<{ className: string; primaryKey: string | null }>>([]);

  const instance = createPanelInstance(panel, {
    text: (key) => key,
    operations: {
      ...noOperations.operations,
      async prepare(operationId, invocation) {
        if (!("call" in invocation)) throw new Error("Expected a single call");
        pendingInput = panelFormSaveInputSchema.parse(invocation.call.input);
        const callTarget = invocation.call.target;
        pendingTargetKey = callTarget !== null && callTarget.kind === "object" ? callTarget.primaryKey : "";
        return {
          intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d05",
          operationId,
          label: "Save",
          confirmation: { kind: "none" },
        };
      },
    },
    async confirmOperation({ intentId }) {
      const captured = pendingInput!;
      savedCalls.push({ primaryKey: pendingTargetKey, input: captured });
      const outcome = await options.onSave?.(pendingTargetKey, captured) ?? { kind: "success" as const, data: {} };
      return { decision: "confirm", response: { kind: "dispatched", intentId, outcome } };
    },
    pageKey: "test-testcase-workbench",
    url: () => "/applications/ops/testcases",
    label: () => "Test cases",
    initial: { selectedCaseSet: { className: CASE_SET_OBJECT, primaryKey: initialKey } },
    readProjection: async () => projection,
  });

  const operations = computed(() => ({
    status: "ready" as const,
    value: {
      save: {
        kind: "form.save" as const,
        handlerRef: `${CASE_SET_OBJECT}.save`,
        label: "Save",
        effect: "write" as const,
        target: { source: "input" as const, input: "caseSet" },
        inputSchema: {},
        resultSchema: {},
        batch: false,
      },
    },
  }));

  const unregister = instance.register({
    slot: "workbench",
    projectionId: projection.id,
    ports: portsOf(projection),
    operations: operations.value.value,
  });

  const inputs = computed(() => ({ caseSet: instance.state.values.value.selectedCaseSet }));
  const slot: ProjectionSlot = { slot: "workbench", projection, inputs: inputs.value };
  const member: PanelMemberContext = {
    key: "workbench",
    projection,
    inputs,
    operations,
    data: {
      use() {
        throw new Error("Workbench reads form on demand");
      },
      async read(_name, _params, readInputs = {}) {
        const primaryKey = (readInputs.caseSet as { primaryKey: string }).primaryKey;
        const record = options.records[primaryKey];
        if (!record) throw new Error(`Missing case set ${primaryKey}`);
        return {
          status: "ready",
          value: caseSetFormDescription(record.name, record.cases, record.revision ?? 3),
        };
      },
    },
  };

  const element = document.createElement("div");
  document.body.appendChild(element);

  const app = createApp(
    defineComponent({
      setup() {
        provide(localDraftStoreKey, options.draftStore);
        provide(panelContextKey, {
          panel: { content: { html: "", module: "" }, manifest: panel },
          manifest: panel,
          instance,
          projection: (id: string) => instance.projection(id),
          invoke: (handlerRef: string, call) => instance.runHandler(handlerRef, call),
          projectionsChanged: () => () => {},
          holdUnsaved: () => () => {},
          t: (key: string) => key,
          resources: async () => {},
          expandPageComposer: async () => {},
          notify: () => {},
          readPanelData: async () => { throw new Error("unused"); },
          navigate: async () => {},
          navigateBack: async () => {},
          currentEntry: computed(() => null),
          entryMenu: computed(() => null),
          currentUser: computed(() => null),
          hasLocalDraft: (ref) => options.draftStore.hasObject(ref.className, ref.primaryKey),
        });
        provide(projectionKey, slot);
        provide(panelMemberKey, () => member);
        return () => h(TestcaseWorkbench, {
          ...(options.config ?? {}),
          ...(options.persistDraft !== undefined ? { persistDraft: options.persistDraft } : {}),
          ...(options.unsavedSwitchMode !== undefined ? { unsavedSwitchMode: options.unsavedSwitchMode } : {}),
          ...(options.showFooterBar !== undefined ? { showFooterBar: options.showFooterBar } : {}),
          onSaved: (payload: { className: string; primaryKey: string | null }) => {
            emittedSaved.value.push(payload);
          },
        });
      },
    }),
  );

  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus);
  app.mount(element);

  const cleanup = () => {
    app.unmount();
    unregister();
    element.remove();
  };

  return { app, element, instance, savedCalls, emittedSaved, cleanup };
}

function findFieldInput(root: HTMLElement, selector: string): HTMLInputElement | HTMLTextAreaElement {
  const direct = root.querySelector(selector);
  if (direct instanceof HTMLInputElement || direct instanceof HTMLTextAreaElement) return direct;
  const nested = direct?.querySelector("textarea, input");
  if (nested instanceof HTMLInputElement || nested instanceof HTMLTextAreaElement) return nested;
  throw new Error(`Could not locate input/textarea for selector: ${selector}`);
}

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function readObjectFormInput(root: HTMLElement, fieldPath: string): HTMLInputElement | HTMLTextAreaElement {
  return findFieldInput(root, `[data-field='${fieldPath}']`);
}

function readTestcaseField(root: HTMLElement, field: string): HTMLInputElement | HTMLTextAreaElement {
  return findFieldInput(root, `[data-testcase-field='${field}']`);
}

describe("ObjectForm persistDraft & unsavedSwitchMode", () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    platformShellMocks.confirmDanger.mockReset();
    platformShellMocks.confirmUnsavedSwitch.mockReset();
  });

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()!();
    }
  });

  it("isolates drafts per formId on the same object and never persists secret fields", async () => {
    const draftStore = createMemoryDraftStore();
    const records = {
      "conn-1": { values: { displayName: "Primary DB", endpoint: "https://a.example", apiKey: "" } },
    };

    const formA = mountObjectForm({
      projectionId: "projection-connector-general",
      records,
      draftStore,
      persistDraft: true,
    });
    cleanups.push(formA.cleanup);
    await flush();

    // Edit a non-secret field and a secret field in Form A via real DOM inputs.
    setInputValue(readObjectFormInput(formA.element, "/displayName"), "Primary DB (edited)");
    setInputValue(readObjectFormInput(formA.element, "/apiKey"), "sk-super-secret-token");
    await flush();

    const keyA = objectDraftKey(SECRET_OBJECT, "conn-1", "projection-connector-general");
    const keyB = objectDraftKey(SECRET_OBJECT, "conn-1", "projection-connector-advanced");
    const storedA = draftStore.read(keyA);
    expect(storedA).not.toBeNull();
    expect(storedA!.values.displayName).toBe("Primary DB (edited)");
    expect("apiKey" in storedA!.values).toBe(false);
    expect(JSON.stringify(storedA)).not.toContain("sk-super-secret-token");
    expect(draftStore.read(keyB)).toBeNull();

    // Mount a second distinct form (different projectionId) for the same object: it must NOT load Form A's draft.
    const formB = mountObjectForm({
      projectionId: "projection-connector-advanced",
      records,
      draftStore,
      config: { persistDraft: true },
    });
    cleanups.push(formB.cleanup);
    await flush();

    expect(readObjectFormInput(formB.element, "/displayName").value).toBe("Primary DB");
    expect(formB.instance.forms.handle("form")!.dirty.value).toBe(false);
    expect(formB.element.querySelector("[data-draft-banner]")).toBeNull();

    // Edit Form B independently and verify both drafts coexist under separate formId keys.
    setInputValue(readObjectFormInput(formB.element, "/endpoint"), "https://b.example");
    await flush();
    expect(draftStore.read(keyA)!.values.displayName).toBe("Primary DB (edited)");
    expect(draftStore.read(keyB)!.values.endpoint).toBe("https://b.example");

    // Reverting Form B back to the owner baseline automatically removes its local draft.
    setInputValue(readObjectFormInput(formB.element, "/endpoint"), "https://a.example");
    await flush();
    expect(draftStore.has(keyB)).toBe(false);

    // Editing ONLY a secret field never writes a vacuous draft to localDraftStore.
    setInputValue(readObjectFormInput(formB.element, "/apiKey"), "sk-only-secret");
    await flush();
    expect(draftStore.has(keyB)).toBe(false);
  });

  it("restores draft with visible banner (matching vs stale baseline), supports one-click discard, and clears on save", async () => {
    const draftStore = createMemoryDraftStore();
    const initialBaseline = { displayName: "Alpha", endpoint: "https://alpha.example", apiKey: "" };
    const records: Record<string, { values: PanelFormValues; revision?: number }> = {
      "conn-1": { values: { ...initialBaseline }, revision: 1 },
    };

    const first = mountObjectForm({
      projectionId: "projection-connector-general",
      records,
      draftStore,
      persistDraft: true,
    });
    cleanups.push(first.cleanup);
    await flush();

    setInputValue(readObjectFormInput(first.element, "/displayName"), "Alpha Draft");
    await flush();
    const key = objectDraftKey(SECRET_OBJECT, "conn-1", "projection-connector-general");
    expect(draftStore.has(key)).toBe(true);
    expect(draftStore.read(key)!.baselineHash).toBe(computeDraftBaselineHash(initialBaseline));

    // Unmount (simulate reload) and remount against the same owner baseline -> normal restored banner.
    first.cleanup();
    cleanups.pop();

    const restoredSame = mountObjectForm({
      projectionId: "projection-connector-general",
      records,
      draftStore,
      persistDraft: true,
    });
    cleanups.push(restoredSame.cleanup);
    await flush();

    const sameBanner = restoredSame.element.querySelector<HTMLElement>("[data-draft-banner]");
    expect(sameBanner?.dataset.draftBanner).toBe("restored");
    expect(readObjectFormInput(restoredSame.element, "/displayName").value).toBe("Alpha Draft");
    expect(restoredSame.instance.forms.handle("form")!.dirty.value).toBe(true);

    // Save succeeds -> clears local draft and hides banner.
    await restoredSame.instance.forms.submit("form");
    await flush();
    expect(draftStore.has(key)).toBe(false);
    expect(restoredSame.element.querySelector("[data-draft-banner]")).toBeNull();
    expect(restoredSame.savedCalls).toHaveLength(1);

    // Create a new draft, then simulate someone else updating the owner baseline -> stale warning banner.
    setInputValue(readObjectFormInput(restoredSame.element, "/displayName"), "My Stale Edit");
    await flush();
    expect(draftStore.has(key)).toBe(true);
    restoredSame.cleanup();
    cleanups.pop();

    records["conn-1"] = {
      values: { displayName: "Updated By Teammate", endpoint: "https://alpha.example", apiKey: "" },
      revision: 2,
    };

    const restoredStale = mountObjectForm({
      projectionId: "projection-connector-general",
      records,
      draftStore,
      persistDraft: true,
    });
    cleanups.push(restoredStale.cleanup);
    await flush();

    const staleBanner = restoredStale.element.querySelector<HTMLElement>("[data-draft-banner]");
    expect(staleBanner?.dataset.draftBanner).toBe("stale");
    expect(readObjectFormInput(restoredStale.element, "/displayName").value).toBe("My Stale Edit");

    // One-click Discard draft restores owner baseline without confirmation, removes stored draft, hides banner.
    const discardButton = restoredStale.element.querySelector<HTMLButtonElement>("[data-draft-discard]");
    expect(discardButton).not.toBeNull();
    discardButton!.click();
    await flush();

    expect(platformShellMocks.confirmDanger).not.toHaveBeenCalled();
    expect(draftStore.has(key)).toBe(false);
    expect(restoredStale.element.querySelector("[data-draft-banner]")).toBeNull();
    expect(readObjectFormInput(restoredStale.element, "/displayName").value).toBe("Updated By Teammate");
    expect(restoredStale.instance.forms.handle("form")!.dirty.value).toBe(false);
  });

  it("handles three-state unsavedSwitchMode='save-discard-cancel' (save success, save refusal, discard, cancel)", async () => {
    const draftStore = createMemoryDraftStore();
    const records: Record<string, { values: PanelFormValues; revision?: number }> = {
      "conn-1": { values: { displayName: "One", endpoint: "https://one.example", apiKey: "" } },
      "conn-2": { values: { displayName: "Two", endpoint: "https://two.example", apiKey: "" } },
    };
    let shouldFailSave = false;

    const mounted = mountObjectForm({
      records,
      draftStore,
      config: { persistDraft: true, unsavedSwitchMode: "save-discard-cancel" },
      async onSave(primaryKey, input) {
        if (shouldFailSave) {
          throw new PlatformObjectRefusal("Validation failed", { "/displayName": "Duplicate name" }, {});
        }
        records[primaryKey] = { values: { ...records[primaryKey]!.values, ...input.values } };
        return { kind: "success", data: {} };
      },
    });
    cleanups.push(mounted.cleanup);
    await flush();

    // 1) Cancel -> stays on conn-1 with unsaved edit preserved.
    setInputValue(readObjectFormInput(mounted.element, "/displayName"), "One Edited");
    await flush();
    platformShellMocks.confirmUnsavedSwitch.mockResolvedValueOnce("cancel");
    mounted.instance.state.set("selected", { className: SECRET_OBJECT, primaryKey: "conn-2" });
    await flush();
    expect(platformShellMocks.confirmUnsavedSwitch).toHaveBeenCalledTimes(1);
    expect(platformShellMocks.confirmUnsavedSwitch.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ appendTo: mounted.overlayRoot }));
    expect((mounted.instance.state.values.value.selected as { primaryKey: string }).primaryKey).toBe("conn-1");
    expect(readObjectFormInput(mounted.element, "/displayName").value).toBe("One Edited");

    // 2) Save fails -> stays on conn-1 with edits preserved.
    shouldFailSave = true;
    platformShellMocks.confirmUnsavedSwitch.mockResolvedValueOnce("save");
    mounted.instance.state.set("selected", { className: SECRET_OBJECT, primaryKey: "conn-2" });
    await flush();
    expect((mounted.instance.state.values.value.selected as { primaryKey: string }).primaryKey).toBe("conn-1");
    expect(readObjectFormInput(mounted.element, "/displayName").value).toBe("One Edited");

    // 3) Save succeeds -> saves conn-1, clears draft, and switches to conn-2.
    shouldFailSave = false;
    platformShellMocks.confirmUnsavedSwitch.mockResolvedValueOnce("save");
    mounted.instance.state.set("selected", { className: SECRET_OBJECT, primaryKey: "conn-2" });
    await flush();
    expect(mounted.savedCalls.at(-1)?.primaryKey).toBe("conn-1");
    expect((mounted.instance.state.values.value.selected as { primaryKey: string }).primaryKey).toBe("conn-2");
    expect(readObjectFormInput(mounted.element, "/displayName").value).toBe("Two");
    expect(draftStore.hasObject(SECRET_OBJECT, "conn-1")).toBe(false);

    // 4) Discard -> clears conn-2 local draft and switches back to conn-1.
    setInputValue(readObjectFormInput(mounted.element, "/displayName"), "Two Temp");
    await flush();
    expect(draftStore.hasObject(SECRET_OBJECT, "conn-2")).toBe(true);
    platformShellMocks.confirmUnsavedSwitch.mockResolvedValueOnce("discard");
    mounted.instance.state.set("selected", { className: SECRET_OBJECT, primaryKey: "conn-1" });
    await flush();
    expect(draftStore.hasObject(SECRET_OBJECT, "conn-2")).toBe(false);
    expect((mounted.instance.state.values.value.selected as { primaryKey: string }).primaryKey).toBe("conn-1");
    expect(readObjectFormInput(mounted.element, "/displayName").value).toBe("One Edited");
  });
});

describe("TestcaseWorkbench three-pane editor, JSON sync, persistDraft & unsavedSwitchMode", () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    platformShellMocks.confirmDanger.mockReset();
    platformShellMocks.confirmUnsavedSwitch.mockReset();
  });

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()!();
    }
  });

  it("renders three panes, adds/deletes cases, syncs form<->JSON bidirectionally, handles invalid JSON & collapse, and saves", async () => {
    const draftStore = createMemoryDraftStore();
    const records = {
      "set-1": {
        name: "Core Regression",
        cases: [
          {
            caseId: "case-001",
            question: "What is total revenue in Q1?",
            expectedAnswer: "120M",
            expectedLogic: "SUM(revenue) WHERE quarter = 'Q1'",
            judgment: "Numeric match within 1%",
          },
        ],
      },
    };

    const mounted = mountTestcaseWorkbench({
      records,
      draftStore,
      persistDraft: true,
    });
    cleanups.push(mounted.cleanup);
    await flush();

    // Three-pane layout + footer rendered.
    expect(mounted.element.querySelector("[data-testcase-list-pane]")).not.toBeNull();
    expect(mounted.element.querySelector("[data-testcase-editor-pane]")).not.toBeNull();
    expect(mounted.element.querySelector("[data-testcase-json-pane]")).not.toBeNull();
    expect(mounted.element.querySelector("[data-testcase-footer]")).not.toBeNull();
    expect(mounted.element.querySelectorAll("[data-testcase-item]")).toHaveLength(1);

    // Add a new case -> auto-generates case-002 and syncs JSON.
    const addButton = mounted.element.querySelector<HTMLButtonElement>("[data-testcase-add]")!;
    addButton.click();
    await flush();

    expect(mounted.element.querySelectorAll("[data-testcase-item]")).toHaveLength(2);
    const jsonTextarea = mounted.element.querySelector<HTMLTextAreaElement>("[data-testcase-json-input]")!;
    expect(jsonTextarea.value).toContain("case-002");

    // Edit question in the structured center form -> updates JSON pane live.
    const questionInput = readTestcaseField(mounted.element, "question");
    setInputValue(questionInput, "List top 5 regions by ARR");
    await flush();

    const parsedAfterForm = JSON.parse(jsonTextarea.value) as Array<{ caseId: string; question: string }>;
    expect(parsedAfterForm[1]?.question).toBe("List top 5 regions by ARR");

    // Edit JSON directly with valid JSON -> updates left list & center form live.
    setInputValue(
      jsonTextarea,
      JSON.stringify([
        { caseId: "case-001", question: "Updated from JSON", expectedAnswer: "42" },
        { caseId: "case-002", question: "Second from JSON" },
      ], null, 2),
    );
    await flush();

    expect(mounted.element.querySelector("[data-json-invalid-badge]")).toBeNull();
    expect(questionInput.value).toBe("Second from JSON");

    // Type invalid JSON -> keeps raw text, shows red invalid badge + error alert, disables Save button.
    const brokenJson = "[{ \"caseId\": \"case-001\", ";
    setInputValue(jsonTextarea, brokenJson);
    await flush();

    expect(jsonTextarea.value).toBe(brokenJson);
    expect(mounted.element.querySelector("[data-json-invalid-badge]")).not.toBeNull();
    expect(mounted.element.querySelector("[data-json-error]")).not.toBeNull();
    const saveButton = mounted.element.querySelector<HTMLButtonElement>("[data-testcase-save]")!;
    expect(saveButton.disabled).toBe(true);

    // Fix JSON with wrapper object `{ cases: [...] }` -> clears error and re-enables Save.
    setInputValue(
      jsonTextarea,
      JSON.stringify({
        cases: [
          { caseId: "case-001", question: "Recovered Q1", expectedAnswer: "120M" },
          { caseId: "case-002", question: "Recovered Q2", expectedAnswer: "130M" },
        ],
      }, null, 2),
    );
    await flush();

    expect(mounted.element.querySelector("[data-json-invalid-badge]")).toBeNull();
    expect(saveButton.disabled).toBe(false);

    // Delete second case -> leaves 1 case.
    const deleteButtons = mounted.element.querySelectorAll<HTMLButtonElement>("[data-testcase-delete]");
    deleteButtons[1]!.click();
    await flush();
    expect(mounted.element.querySelectorAll("[data-testcase-item]")).toHaveLength(1);

    // Collapse & expand right JSON pane.
    mounted.element.querySelector<HTMLButtonElement>("[data-json-collapse]")!.click();
    await flush();
    expect(mounted.element.querySelector("[data-testcase-json-pane]")).toBeNull();
    expect(mounted.element.querySelector("[data-json-expand]")).not.toBeNull();

    mounted.element.querySelector<HTMLButtonElement>("[data-json-expand]")!.click();
    await flush();
    expect(mounted.element.querySelector("[data-testcase-json-pane]")).not.toBeNull();

    // Save invokes operations.save with canonical `{ name, cases }` and clears dirty + local draft.
    saveButton.click();
    await flush();

    expect(mounted.savedCalls).toHaveLength(1);
    expect(mounted.savedCalls[0]!.primaryKey).toBe("set-1");
    expect(mounted.savedCalls[0]!.input.values.name).toBe("Core Regression");
    expect(mounted.savedCalls[0]!.input.values.cases).toEqual([
      expect.objectContaining({ caseId: "case-001", question: "Recovered Q1", expectedAnswer: "120M" }),
    ]);
    expect(mounted.emittedSaved.value).toEqual([{ className: CASE_SET_OBJECT, primaryKey: "set-1" }]);
    expect(draftStore.hasObject(CASE_SET_OBJECT, "set-1")).toBe(false);
  });

  it("restores persisted draft with visible banner and guards switching via three-state unsavedSwitchMode", async () => {
    const draftStore = createMemoryDraftStore();
    const records: MountTestcaseWorkbenchOptions["records"] = {
      "set-1": {
        name: "Set One",
        cases: [{ caseId: "case-001", question: "Original Q1" }],
      },
      "set-2": {
        name: "Set Two",
        cases: [{ caseId: "case-010", question: "Original Q2" }],
      },
    };
    let shouldFailSave = false;

    const first = mountTestcaseWorkbench({
      records,
      draftStore,
      config: { persistDraft: true, unsavedSwitchMode: "save-discard-cancel" },
    });
    cleanups.push(first.cleanup);
    await flush();

    // Modify question -> persisted to localDraftStore and visible via hasObject (for list draft indicator).
    const questionInput = readTestcaseField(first.element, "question");
    setInputValue(questionInput, "Unsaved Q1 Draft");
    await flush();
    expect(draftStore.hasObject(CASE_SET_OBJECT, "set-1")).toBe(true);

    // Reload -> restored with visible banner; one-click discard restores baseline.
    first.cleanup();
    cleanups.pop();

    const reloaded = mountTestcaseWorkbench({
      records,
      draftStore,
      config: { persistDraft: true, unsavedSwitchMode: "save-discard-cancel" },
      async onSave(primaryKey, input) {
        if (shouldFailSave) {
          throw new PlatformObjectRefusal("Save refused", {}, {});
        }
        records[primaryKey] = {
          name: String(input.values.name),
          cases: input.values.cases as MountTestcaseWorkbenchOptions["records"][string]["cases"],
        };
        return { kind: "success", data: {} };
      },
    });
    cleanups.push(reloaded.cleanup);
    await flush();

    expect(reloaded.element.querySelector<HTMLElement>("[data-draft-banner]")?.dataset.draftBanner).toBe("restored");
    const reloadedQuestion = readTestcaseField(reloaded.element, "question");
    expect(reloadedQuestion.value).toBe("Unsaved Q1 Draft");

    // 1) Switch with "cancel" -> stays on set-1.
    platformShellMocks.confirmUnsavedSwitch.mockResolvedValueOnce("cancel");
    reloaded.instance.state.set("selectedCaseSet", { className: CASE_SET_OBJECT, primaryKey: "set-2" });
    await flush();
    expect((reloaded.instance.state.values.value.selectedCaseSet as { primaryKey: string }).primaryKey).toBe("set-1");

    // 2) Switch with "save" when save fails -> stays on set-1.
    shouldFailSave = true;
    platformShellMocks.confirmUnsavedSwitch.mockResolvedValueOnce("save");
    reloaded.instance.state.set("selectedCaseSet", { className: CASE_SET_OBJECT, primaryKey: "set-2" });
    await flush();
    expect((reloaded.instance.state.values.value.selectedCaseSet as { primaryKey: string }).primaryKey).toBe("set-1");
    expect(reloaded.element.querySelector("[data-testcase-refusal]")).not.toBeNull();

    // 3) Switch with "save" when save succeeds -> saves set-1, clears draft, switches to set-2.
    shouldFailSave = false;
    platformShellMocks.confirmUnsavedSwitch.mockResolvedValueOnce("save");
    reloaded.instance.state.set("selectedCaseSet", { className: CASE_SET_OBJECT, primaryKey: "set-2" });
    await flush();
    expect(reloaded.savedCalls.at(-1)?.primaryKey).toBe("set-1");
    expect((reloaded.instance.state.values.value.selectedCaseSet as { primaryKey: string }).primaryKey).toBe("set-2");
    expect(draftStore.hasObject(CASE_SET_OBJECT, "set-1")).toBe(false);

    // 4) Edit set-2 and switch with "discard" -> clears set-2 draft and switches back to set-1.
    const set2Question = readTestcaseField(reloaded.element, "question");
    setInputValue(set2Question, "Temporary Q2 Edit");
    await flush();
    expect(draftStore.hasObject(CASE_SET_OBJECT, "set-2")).toBe(true);

    platformShellMocks.confirmUnsavedSwitch.mockResolvedValueOnce("discard");
    reloaded.instance.state.set("selectedCaseSet", { className: CASE_SET_OBJECT, primaryKey: "set-1" });
    await flush();
    expect(draftStore.hasObject(CASE_SET_OBJECT, "set-2")).toBe(false);
    expect((reloaded.instance.state.values.value.selectedCaseSet as { primaryKey: string }).primaryKey).toBe("set-1");

    // 5) Stale draft warning + one-click discard on TestcaseWorkbench.
    setInputValue(readTestcaseField(reloaded.element, "question"), "Local Stale Q1");
    await flush();
    expect(draftStore.hasObject(CASE_SET_OBJECT, "set-1")).toBe(true);
    reloaded.cleanup();
    cleanups.pop();

    records["set-1"] = {
      name: "Set One",
      cases: [{ caseId: "case-001", question: "Server Updated Q1" }],
      revision: 4,
    };

    const staleWb = mountTestcaseWorkbench({
      records,
      draftStore,
      persistDraft: true,
    });
    cleanups.push(staleWb.cleanup);
    await flush();

    expect(staleWb.element.querySelector<HTMLElement>("[data-draft-banner]")?.dataset.draftBanner).toBe("stale");
    expect(readTestcaseField(staleWb.element, "question").value).toBe("Local Stale Q1");

    staleWb.element.querySelector<HTMLButtonElement>("[data-draft-discard]")!.click();
    await flush();
    expect(staleWb.element.querySelector("[data-draft-banner]")).toBeNull();
    expect(draftStore.hasObject(CASE_SET_OBJECT, "set-1")).toBe(false);
    expect(readTestcaseField(staleWb.element, "question").value).toBe("Server Updated Q1");
  });
});
