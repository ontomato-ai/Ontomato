import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, createApp, defineComponent, h, nextTick, provide, ref, shallowRef } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { METRIC_VIEW, TEST_METRIC_VIEW } from "@ontomato/contracts/platform-object-types";
import type { PanelReadOperationResult } from "@ontomato/contracts/panel-operations";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import OperationResult from "../../../../../packages/apps-sdk/src/base/OperationResult.vue";
import DirectProjectionComponent, { directMountKey } from "../../../../../packages/apps-sdk/src/panel/direct-projection";
import FrameProjection from "../../../../../packages/apps-sdk/src/panel/Projection.vue";
import { mountDirectPanel } from "../../../../../packages/apps-sdk/src/panel/direct-mount";
import { panelContextKey } from "../../../../../packages/apps-sdk/src/panel/context";
import { createPanelInstance } from "../../../../../packages/apps-sdk/src/panel/instance";
import { noOperations } from "./panel-frame";

const AGENT_RUN = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  toolCallId: "tool-call-1",
};

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: "en",
    messages: { en: publicEn },
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("OperationResult", () => {
  it("toggles Markdown preview/source and shows localized no-result text when empty", async () => {
    const result = shallowRef<PanelReadOperationResult>({ kind: "markdown", markdown: "# Summary\n\nValue: **99**" });
    const host = document.createElement("div");
    document.body.append(host);
    const app = createApp(defineComponent({
      setup: () => () => h(OperationResult, { result: result.value }),
    }));
    app.use(ElementPlus);
    app.use(makeI18n());
    app.mount(host);
    try {
      await vi.waitFor(() => {
        expect(host.querySelector(".sdk-operation-markdown-preview")).not.toBeNull();
        expect(host.textContent).toContain("Value:");
        expect(host.textContent).toContain("99");
      });

      const sourceRadio = Array.from(host.querySelectorAll<HTMLElement>("label")).find((el) =>
        el.textContent?.trim() === "Source",
      );
      expect(sourceRadio).toBeTruthy();
      sourceRadio!.click();
      await vi.waitFor(() => {
        expect(host.querySelector(".sdk-operation-markdown-preview")).toBeNull();
        expect(host.textContent).toContain("# Summary");
      });

      result.value = { kind: "markdown", markdown: "   " };
      await nextTick();
      expect(host.textContent).toContain(publicEn.platform.operationNoResult);
      expect(host.querySelector(".sdk-operation-markdown-toggle")).toBeNull();
    } finally {
      app.unmount();
    }
  });

  it("renders JSON value with optional truncation alert (rowLimit or dash fallback and hint)", async () => {
    const result = shallowRef<PanelReadOperationResult>({
      kind: "json",
      value: [{ count: 7 }],
      truncation: { rowLimit: 20000, hint: "Narrow date range" },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const app = createApp(defineComponent({
      setup: () => () => h(OperationResult, { result: result.value }),
    }));
    app.use(ElementPlus);
    app.use(makeI18n());
    app.mount(host);
    try {
      await vi.waitFor(() => {
        const alert = host.querySelector(".el-alert--warning");
        expect(alert).not.toBeNull();
        expect(alert!.textContent).toContain("20000");
        expect(alert!.textContent).toContain("Narrow date range");
        expect(host.textContent).toContain("\"count\": 7");
      });

      result.value = {
        kind: "json",
        value: [{ count: 8 }],
        truncation: { rowLimit: null, hint: null },
      };
      await vi.waitFor(() => {
        const alert = host.querySelector(".el-alert--warning");
        expect(alert).not.toBeNull();
        expect(alert!.textContent).toContain("—");
      });

      result.value = { kind: "json", value: { ok: true } };
      await nextTick();
      expect(host.querySelector(".el-alert--warning")).toBeNull();
    } finally {
      app.unmount();
    }
  });
});

describe("<Projection :values> and OperationButton draft read behavior", () => {
  const recordMeta = {
    domainId: "d",
    ownerId: "o",
    revision: 1,
    createdAt: "2026-11-24T00:00:00Z",
    updatedAt: "2026-11-24T00:00:00Z",
    editable: false,
    visibility: "domain" as const,
    description: "",
  };

  const trialProjection: DirectProjection = {
    ...recordMeta,
    id: "proj-trial-md",
    name: "Trial Markdown",
    componentId: "@ontomato/sdk:OperationButton",
    inputs: {},
    outputs: {},
    config: { operation: "test", type: "primary" },
    data: {},
    operations: {
      test: { operation: { kind: "PlatformOperation", id: TEST_METRIC_VIEW } },
    },
  };

  const formProjection: DirectProjection = {
    ...recordMeta,
    id: "proj-metric-form",
    name: "Metric Form",
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: { metric: { kind: "object", objectType: METRIC_VIEW } },
    outputs: {},
    config: {},
    data: {
      form: { source: { object: { input: "metric" } }, read: "form", params: {} },
    },
    operations: {
      save: { operation: { kind: "PlatformOperation", id: `${METRIC_VIEW}.save` }, target: { input: "metric" } },
    },
  };

  const manifest = definePanel({
    state: {
      selected: { type: { kind: "object", objectType: METRIC_VIEW }, deepLink: false },
      testParameters: { type: { kind: "json" }, default: {}, deepLink: false },
    },
    members: {
      definition: {
        target: { projectionId: formProjection.id },
        inputs: { metric: { state: "selected" } },
      },
      trial: {
        target: { projectionId: trialProjection.id },
        readOperationInputs: {
          test: { draft: { slot: "definition" }, parameters: { state: "testParameters" } },
        },
      },
    },
  });

  const testDescriptor = {
    kind: "action" as const,
    handlerRef: TEST_METRIC_VIEW,
    label: "Test",
    effect: "read" as const,
    target: { source: "draft" as const, slot: "definition" },
    inputSchema: {},
    resultSchema: {},
    batch: false as const,
  };

  it("passes :values through in direct mode, ignores an attribute where it is placed, blocks agent when disabled, emits @read, and resets on draft switch", async () => {
    const disabled = ref(true);
    const readEvents: PanelReadOperationResult[] = [];
    const requests = {
      request: vi.fn(async (path: string) => {
        if (path === "/panel-operations/read" || path === "/api/panel-operations/read") {
          return Response.json({ kind: "markdown", markdown: "## Draft Preview" });
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    };
    const mount = mountDirectPanel({
      manifest,
      use: { applicationId: "app-test", useId: "use-test" },
      messages: {},
      locale: ref("en"),
      defaultLocale: "en",
      requests,
      readProjection: async (id) => ({
        projection: id === trialProjection.id ? trialProjection : formProjection,
      }),
      read: async (req): Promise<ProductPanelReadResponse> => {
        const member = req.memberPath[0]?.member;
        if ("operations" in req) {
          if (member === "trial") return { status: "ready", value: { test: testDescriptor } as never };
          return { status: "ready", value: {} as never };
        }
        const key = (req.inputs.metric as { primaryKey?: string } | undefined)?.primaryKey ?? "m1";
        return {
          status: "ready",
          value: {
            fields: [{ path: "/name", label: "Name", control: { kind: "text" }, valueSchema: {}, required: false, readOnly: false }],
            values: { name: `Metric ${key}`, function: { parameters: [] } },
            errors: [],
            save: { method: "PUT", path: `/metric/${key}`, bodySchema: {} },
          } as never,
        };
      },
      confirmOperation: async () => ({ decision: "cancel" }),
      translate: (key) => key,
      navigate: async () => {},
      expandPageComposer: async () => {},
      run: {
        pageKey: "test",
        url: () => "/test",
        label: () => "Test",
        initial: { selected: { className: METRIC_VIEW, primaryKey: "m1" } },
        state: () => {},
        context: () => {},
        dirty: () => {},
        operations: () => {},
        failed: () => {},
      },
      nested: async () => {
        throw new Error("no nested");
      },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const app = createApp(defineComponent({
      setup() {
        provide(directMountKey, mount);
        return () => h("div", [
          h(DirectProjectionComponent, { slot: "definition" }),
          h(DirectProjectionComponent, {
            slot: "trial",
            values: { disabled: disabled.value },
            class: "extra-box",
            disabled: false,
            "data-undeclared": "ignored",
            onRead: (res: PanelReadOperationResult) => readEvents.push(res),
          }),
        ]);
      },
    }));
    app.use(ElementPlus);
    app.use(makeI18n());
    app.mount(host);
    try {
      // Wait for form and trial button to mount; button must be disabled while :disabled="true".
      await vi.waitFor(() => {
        const btn = host.querySelector<HTMLButtonElement>("[data-member='trial'] button");
        expect(btn).not.toBeNull();
        expect(btn!.disabled).toBe(true);
      });
      // The container takes class; an attribute written where the member is placed configures nothing.
      const trialWrapper = host.querySelector<HTMLElement>("[data-member='trial']");
      expect(trialWrapper?.classList.contains("extra-box")).toBe(true);
      expect(trialWrapper?.querySelector(".sdk-operation-button")?.getAttribute("data-undeclared")).toBeNull();

      // Agent page_action must be refused with action_unavailable while :disabled="true".
      expect(await mount.executeAction!({ operation: "trial.test", agentRun: AGENT_RUN })).toMatchObject({
        ok: false,
        reason: "action_unavailable",
      });

      // Enabling :disabled="false" enables button for human & agent and emits @read.
      disabled.value = false;
      await vi.waitFor(() => {
        const btn = host.querySelector<HTMLButtonElement>("[data-member='trial'] button");
        expect(btn?.disabled).toBe(false);
      });
      expect(await mount.executeAction!({ operation: "trial.test", agentRun: AGENT_RUN })).toMatchObject({
        ok: true,
        kind: "executed",
        operation: "trial.test",
      });
      expect(readEvents).toEqual([{ kind: "markdown", markdown: "## Draft Preview" }]);
      await vi.waitFor(() => {
        expect(trialWrapper?.textContent).toContain("Draft Preview");
      });

      // Switching draft form target rotates formInstanceId and resets the previous read result.
      mount.setState!({ selected: { className: METRIC_VIEW, primaryKey: "m2" } });
      await vi.waitFor(() => {
        expect(trialWrapper?.querySelector(".sdk-operation-result")).toBeNull();
      });
    } finally {
      app.unmount();
      mount.dispose();
    }
  });

  it("passes :values through in frame mode Projection.vue without leaking undeclared attributes", async () => {
    const disabled = ref(true);
    const frameManifest = definePanel({
      state: {},
      members: {
        trial: {
          target: { projectionId: trialProjection.id },
        },
      },
    });
    const instance = createPanelInstance(frameManifest, {
      text: (key) => key,
      pageKey: "frame-test",
      url: () => "/frame-test",
      label: () => "Frame",
      operations: {
        ...noOperations.operations,
        read: async () => ({ kind: "markdown", markdown: "Frame preview" }),
      },
      confirmOperation: async () => ({ decision: "cancel" }),
      readProjection: async () => ({
        ...trialProjection,
        operations: {
          test: { operation: { kind: "PlatformOperation", id: TEST_METRIC_VIEW } },
        },
      }) as never,
    });
    const readPanelData = vi.fn(async (): Promise<ProductPanelReadResponse> => ({
      status: "ready",
      value: {
        test: { ...testDescriptor, target: { source: "none" } },
      } as never,
    }));

    const host = document.createElement("div");
    document.body.append(host);
    const app = createApp(defineComponent({
      setup() {
        provide(panelContextKey, {
          panel: { content: { html: "", module: "" }, manifest: frameManifest },
          manifest: frameManifest,
          instance,
          projection: (id: string) => instance.projection(id),
          invoke: (handlerRef: string, call) => instance.runHandler(handlerRef, call),
          resources: async () => {},
          readPanelData,
          projectionsChanged: () => () => {},
          t: (key: string) => key,
          navigate: async () => {},
          navigateBack: async () => {},
          notify: () => {},
          holdUnsaved: () => () => {},
          expandPageComposer: async () => {},
          currentEntry: computed(() => null),
          entryMenu: computed(() => null),
          currentUser: computed(() => null),
          hasLocalDraft: () => false,
        });
        return () => h(FrameProjection, {
          slot: "trial",
          values: { disabled: disabled.value },
          class: "frame-box",
          disabled: false,
          "data-ignored": "no",
        });
      },
    }));
    app.use(ElementPlus);
    app.use(makeI18n());
    app.mount(host);
    try {
      await vi.waitFor(() => {
        const btn = host.querySelector<HTMLButtonElement>("[data-member='trial'] button");
        expect(btn).not.toBeNull();
        expect(btn!.disabled).toBe(true);
      });
      const wrapper = host.querySelector<HTMLElement>("[data-member='trial']");
      expect(wrapper?.classList.contains("frame-box")).toBe(true);
      expect(wrapper?.querySelector(".sdk-operation-button")?.getAttribute("data-ignored")).toBeNull();

      disabled.value = false;
      await vi.waitFor(() => {
        const btn = host.querySelector<HTMLButtonElement>("[data-member='trial'] button");
        expect(btn?.disabled).toBe(false);
      });
    } finally {
      app.unmount();
    }
  });
});
