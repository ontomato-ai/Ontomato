import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import {
  installPlatform,
  leaveFrame,
  mountPlatformPage,
  nothingAt,
  panelAnswer,
  panelRecord,
  panelSnapshot,
  panelUse,
  SCHEDULED_TASK,
  type Sent,
} from "./panel-frame";

/*
 * Draft links on panels whose `<projection slot="form">` is conditionally rendered behind `v-if`:
 * 1. Clicking a draft link without `?state=` while on a page where `ObjectList` (`fallbackToFirst: true`) has already
 *    selected a row must not clear deep-link selection or hang on "Opening draft...".
 * 2. Cold-opening an edit draft or a create draft on a panel without `fallbackToFirst` (or with an empty list) must
 *    still evaluate and claim the draft via the member-level receiver, drive bound state / `instance.draft` so the
 *    form mounts, and display the draft — or refuse explicitly if the template truly cannot draw the form in create
 *    mode, rather than hanging on "Opening draft...".
 */

const BASE_RECORD = {
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "2026-11-22T00:00:00.000Z",
  updatedAt: "2026-11-22T00:00:00.000Z",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

const LIST_PROJECTION_ID = "projection-unmounted-list";
const FORM_PROJECTION_ID = "projection-unmounted-form";

function listProjection(fallbackToFirst: boolean): DirectProjection {
  return {
    ...BASE_RECORD,
    id: LIST_PROJECTION_ID,
    name: "Models list",
    componentId: "@ontomato/sdk:ObjectList",
    inputs: {},
    outputs: { selected: { kind: "object", objectType: SCHEDULED_TASK } },
    config: { fallbackToFirst, columns: [{ key: "title" }] },
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} } },
    operations: {},
  };
}

function formProjection(withCreateForm: boolean): DirectProjection {
  return {
    ...BASE_RECORD,
    id: FORM_PROJECTION_ID,
    name: "Model form",
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: {
      task: { kind: "object", objectType: SCHEDULED_TASK },
      values: { kind: "json" },
      changedField: { kind: "scalar", type: "string" },
    },
    outputs: {},
    config: {},
    data: {
      form: {
        source: { object: { input: "task" } },
        read: "form",
        params: { values: { input: "values" }, changedField: { input: "changedField" } },
      },
      ...(withCreateForm
        ? {
            createForm: {
              source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } },
              read: "createForm",
              params: { values: { input: "values" }, changedField: { input: "changedField" } },
            },
          }
        : {}),
    },
    operations: {
      save: { operation: { kind: "PlatformOperation", id: `${SCHEDULED_TASK}.save` }, target: { input: "task" } },
    },
  };
}

const V_IF_SELECTED_MODULE = `import { computed } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected);
    return { selected };
  },
});
`;

const V_IF_SELECTED_OR_CREATING_MODULE = `import { computed, watch } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected);
    const creating = computed(() => instance.state.values.value.creating === true);
    watch(instance.draft, (draft) => {
      if (!draft) return;
      if (draft.target && draft.target.id) {
        instance.state.set("creating", false);
      } else {
        instance.state.setState({ creating: true, selected: null });
      }
    }, { immediate: true });
    return { selected, creating };
  },
});
`;

interface HarnessOptions {
  fallbackToFirst: boolean;
  rows: readonly { primaryKey: string; label: string; title: string }[];
  withCreateForm?: boolean;
  html: string;
  module: string;
  draft: {
    operation: string;
    target: { objectType: string; id?: string };
    form: Record<string, unknown>;
  };
  draftDelayMs?: number;
}

function createHarness(options: HarnessOptions) {
  const list = listProjection(options.fallbackToFirst);
  const form = formProjection(options.withCreateForm ?? true);
  const projectionMap: Record<string, DirectProjection> = {
    [list.id]: list,
    [form.id]: form,
  };
  const manifest = definePanel({
    state: {
      selected: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true },
      creating: { type: { kind: "scalar", type: "boolean" }, deepLink: true, default: false },
    },
    members: {
      list: { target: { projectionId: list.id }, outputs: { selected: { state: "selected" } } },
      form: { target: { projectionId: form.id }, inputs: { task: { state: "selected" } } },
    },
    commands: {},
  });
  const panel = {
    ...panelRecord("panel-conditional-form", "Conditional form", manifest),
    content: { html: options.html, module: options.module },
  };
  const use = panelUse("use-conditional-form", "conditional-form-page", panel.id, "/applications/app-ops-model/models");
  const basePath = "/applications/app-ops-model/models";
  const draftQuery = new URLSearchParams({
    draftSessionId: "session-1",
    draftRunId: "run-1",
    draftPath: "outputs/drafts/model.page-draft.json",
  });
  const draftAddress = `${basePath}?${draftQuery}`;

  const byKey = new Map(options.rows.map((row) => [row.primaryKey, row]));
  const titleField = {
    path: "/title",
    label: "Title",
    control: { kind: "text" as const },
    valueSchema: {},
    required: true,
    readOnly: false,
  };
  const saveDescriptor = (target: object) => ({
    save: {
      kind: "form.save",
      handlerRef: `${SCHEDULED_TASK}.save`,
      label: "Save",
      effect: "write",
      target,
      inputSchema: {},
      resultSchema: {},
      batch: false,
    },
  });

  const answer = (request: Sent): Response | Promise<Response> => {
    if (request.path === "/api/data-query/platform/applications/app-ops-model/panel-uses") {
      return Response.json({
        success: true,
        data: { applicationId: "app-ops-model", entry: { path: "/ops-model", renderer: "panels" }, panelUses: [use] },
      });
    }
    if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
    if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, projectionMap, request);
    if (request.path === `/api/product-projections/${list.id}`) return Response.json({ projection: list });
    if (request.path === `/api/product-projections/${form.id}`) return Response.json({ projection: form });
    if (request.path === "/api/assistant/sessions/session-1/runs/run-1/page-draft") {
      const payload = { pageKey: use.pageKey, ...options.draft };
      return options.draftDelayMs
        ? new Promise((resolve) => setTimeout(() => resolve(Response.json(payload)), options.draftDelayMs))
        : Response.json(payload);
    }
    if (request.path === "/api/product-panels/read") {
      const body = request.body as {
        memberPath: { member: string }[];
        dataName?: string;
        operations?: true;
        inputs: { task?: { primaryKey: string }; values?: Record<string, unknown> };
        runtimeParams?: { values?: Record<string, unknown> };
      };
      const member = body.memberPath.at(-1)?.member;
      if (body.operations) {
        if (member === "form") {
          return Response.json({
            status: "ready",
            value: body.inputs.task
              ? saveDescriptor({ source: "input", input: "task" })
              : options.withCreateForm !== false
                ? saveDescriptor({ source: "draft", slot: "form" })
                : {},
          });
        }
        return Response.json({ status: "ready", value: {} });
      }
      if (member === "list" && body.dataName === "rows") {
        return Response.json({
          status: "ready",
          value: options.rows.map((row) => ({
            className: SCHEDULED_TASK,
            primaryKey: row.primaryKey,
            label: row.label,
            fields: { title: row.title },
            fieldLabels: { title: "Title" },
          })),
        });
      }
      if (member === "form" && body.dataName === "form") {
        const key = body.inputs.task?.primaryKey ?? "";
        const found = byKey.get(key);
        if (!found) return Response.json({ status: "error", message: `Unknown object '${key}'` });
        const values = body.runtimeParams?.values ?? body.inputs.values ?? { title: found.title };
        return Response.json({
          status: "ready",
          value: {
            fields: [titleField],
            values,
            errors: [],
            revision: 1,
            save: { method: "PUT", path: "/models/:id", bodySchema: {}, draftOperation: `${SCHEDULED_TASK}.save` },
          },
        });
      }
      if (member === "form" && body.dataName === "createForm") {
        const values = body.runtimeParams?.values ?? body.inputs.values ?? { title: "" };
        return Response.json({
          status: "ready",
          value: {
            fields: [titleField],
            values,
            errors: [],
            revision: 1,
            save: { method: "POST", path: "/models", bodySchema: {}, draftOperation: `${SCHEDULED_TASK}.create` },
          },
        });
      }
    }
    return nothingAt(request);
  };

  installPlatform(answer);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/applications/:applicationId/:panelPath(.*)",
        component: PanelApplicationRoute,
        props: (route) => ({ applicationId: String(route.params.applicationId) }),
      },
    ],
  });
  return { basePath, draftAddress, router };
}

afterEach(leaveFrame);

describe("draft links on panels with conditionally mounted ObjectForm", () => {
  it("opens an in-page draft link without a state parameter for the already-selected row without clearing selection or hanging", { timeout: 20000 }, async () => {
    const { basePath, draftAddress, router } = createHarness({
      fallbackToFirst: true,
      rows: [
        { primaryKey: "m-1", label: "Model One", title: "Original One" },
        { primaryKey: "m-2", label: "Model Two", title: "Original Two" },
      ],
      html: '<div id="app"><projection slot="list"></projection><projection slot="form" v-if="selected"></projection></div>',
      module: V_IF_SELECTED_MODULE,
      draft: {
        operation: `${SCHEDULED_TASK}.save`,
        target: { objectType: SCHEDULED_TASK, id: "m-1" },
        form: { title: "Drafted One" },
      },
      draftDelayMs: 60,
    });
    await router.push(basePath);
    await router.isReady();
    const { app, element } = mountPlatformPage(() => h(RouterView), router);
    try {
      await vi.waitFor(
        () => expect(element.querySelector<HTMLInputElement>('[data-field="/title"] input')?.value).toBe("Original One"),
        { timeout: 8000 },
      );

      // Clicking a draft link with no `state` query parameter keeps the selected row and updates the form in place.
      await router.push(draftAddress);

      await vi.waitFor(
        () => expect(element.querySelector<HTMLInputElement>('[data-field="/title"] input')?.value).toBe("Drafted One"),
        { timeout: 8000 },
      );
      await vi.waitFor(() => expect(element.querySelector(".panel-host-draft-opening")).toBeNull(), { timeout: 5000 });
      expect(element.querySelector(".panel-host-draft")).toBeNull();
      expect(element.querySelector(".sdk-owner-form-changed")?.textContent).toContain("Title");
      expect((element.querySelector(".panel-host-direct") as HTMLElement).style.display).toBe("");
    } finally {
      app.unmount();
    }
  });

  it("opens an in-page draft link without a state parameter when a row is already selected and form is under v-if='selected'", { timeout: 20000 }, async () => {
    const { basePath, draftAddress, router } = createHarness({
      fallbackToFirst: true,
      rows: [
        { primaryKey: "m-1", label: "Model One", title: "Original One" },
        { primaryKey: "m-2", label: "Model Two", title: "Original Two" },
      ],
      html: '<div id="app"><projection slot="list"></projection><projection slot="form" v-if="selected"></projection></div>',
      module: V_IF_SELECTED_MODULE,
      draft: {
        operation: `${SCHEDULED_TASK}.save`,
        target: { objectType: SCHEDULED_TASK, id: "m-2" },
        form: { title: "Drafted Two" },
      },
      draftDelayMs: 60,
    });
    await router.push(basePath);
    await router.isReady();
    const { app, element } = mountPlatformPage(() => h(RouterView), router);
    try {
      // ObjectList (fallbackToFirst) selects the first row and mounts ObjectForm for m-1.
      await vi.waitFor(
        () => expect(element.querySelector<HTMLInputElement>('[data-field="/title"] input')?.value).toBe("Original One"),
        { timeout: 8000 },
      );

      // Clicking the agent's draft link carries only draft query parameters (no `state`).
      await router.push(draftAddress);

      await vi.waitFor(
        () => expect(element.querySelector<HTMLInputElement>('[data-field="/title"] input')?.value).toBe("Drafted Two"),
        { timeout: 8000 },
      );
      await vi.waitFor(() => expect(element.querySelector(".panel-host-draft-opening")).toBeNull(), { timeout: 5000 });
      expect(element.querySelector(".panel-host-draft")).toBeNull();
      expect(element.querySelector(".sdk-owner-form-changed")?.textContent).toContain("Title");
      expect((element.querySelector(".panel-host-direct") as HTMLElement).style.display).toBe("");
    } finally {
      app.unmount();
    }
  });

  it("cold-opens an edit draft when the list has no fallbackToFirst and ObjectForm starts unmounted behind v-if='selected'", { timeout: 20000 }, async () => {
    const { draftAddress, router } = createHarness({
      fallbackToFirst: false,
      rows: [
        { primaryKey: "m-1", label: "Model One", title: "Original One" },
        { primaryKey: "m-2", label: "Model Two", title: "Original Two" },
      ],
      html: '<div id="app"><projection slot="list"></projection><projection slot="form" v-if="selected"></projection></div>',
      module: V_IF_SELECTED_MODULE,
      draft: {
        operation: `${SCHEDULED_TASK}.save`,
        target: { objectType: SCHEDULED_TASK, id: "m-2" },
        form: { title: "Cold Edit Draft" },
      },
    });
    await router.push(draftAddress);
    await router.isReady();
    const { app, element } = mountPlatformPage(() => h(RouterView), router);
    try {
      await vi.waitFor(
        () => expect(element.querySelector<HTMLInputElement>('[data-field="/title"] input')?.value).toBe("Cold Edit Draft"),
        { timeout: 8000 },
      );
      await vi.waitFor(() => expect(element.querySelector(".panel-host-draft-opening")).toBeNull(), { timeout: 5000 });
      expect(element.querySelector(".panel-host-draft")).toBeNull();
      expect(element.querySelector(".sdk-owner-form-changed")?.textContent).toContain("Title");
    } finally {
      app.unmount();
    }
  });

  it("cold-opens a create draft when the list is empty and the panel mounts ObjectForm once instance.draft opens create mode", { timeout: 20000 }, async () => {
    const { draftAddress, router } = createHarness({
      fallbackToFirst: false,
      rows: [],
      withCreateForm: true,
      html: '<div id="app"><projection slot="list"></projection><projection slot="form" v-if="selected || creating"></projection></div>',
      module: V_IF_SELECTED_OR_CREATING_MODULE,
      draft: {
        operation: `${SCHEDULED_TASK}.create`,
        target: { objectType: SCHEDULED_TASK },
        form: { title: "Brand New Model" },
      },
    });
    await router.push(draftAddress);
    await router.isReady();
    const { app, element } = mountPlatformPage(() => h(RouterView), router);
    try {
      await vi.waitFor(
        () => expect(element.querySelector<HTMLInputElement>('[data-field="/title"] input')?.value).toBe("Brand New Model"),
        { timeout: 8000 },
      );
      await vi.waitFor(() => expect(element.querySelector(".panel-host-draft-opening")).toBeNull(), { timeout: 5000 });
      expect(element.querySelector(".panel-host-draft")).toBeNull();
      expect(element.querySelector(".sdk-owner-form-changed")?.textContent).toContain("Title");
    } finally {
      app.unmount();
    }
  });

  it("refuses a cold-opened create draft explicitly instead of hanging when the template only mounts the form under v-if='selected'", { timeout: 20000 }, async () => {
    const { draftAddress, router } = createHarness({
      fallbackToFirst: false,
      rows: [],
      withCreateForm: true,
      html: '<div id="app"><projection slot="list"></projection><projection slot="form" v-if="selected"></projection></div>',
      module: V_IF_SELECTED_MODULE,
      draft: {
        operation: `${SCHEDULED_TASK}.create`,
        target: { objectType: SCHEDULED_TASK },
        form: { title: "Unmountable Create Draft" },
      },
    });
    await router.push(draftAddress);
    await router.isReady();
    const { app, element } = mountPlatformPage(() => h(RouterView), router);
    try {
      await vi.waitFor(
        () => expect(element.querySelector(".panel-host-draft .el-alert__title")?.textContent).toBe(
          `This page has no form that takes this draft for ${SCHEDULED_TASK} (${SCHEDULED_TASK}.create)`,
        ),
        { timeout: 8000 },
      );
      expect(element.querySelector(".panel-host-draft-opening")).toBeNull();
      expect(element.querySelector(".panel-host-error")).toBeNull();
    } finally {
      app.unmount();
    }
  });

  it("refuses an unclaimed draft explicitly instead of hanging when the only form member is unmounted behind v-if='selected'", { timeout: 20000 }, async () => {
    const { draftAddress, router } = createHarness({
      fallbackToFirst: false,
      rows: [{ primaryKey: "m-1", label: "Model One", title: "Original One" }],
      withCreateForm: false,
      html: '<div id="app"><projection slot="list"></projection><projection slot="form" v-if="selected"></projection></div>',
      module: V_IF_SELECTED_MODULE,
      draft: {
        operation: "platform:Dashboard.save",
        target: { objectType: SCHEDULED_TASK, id: "m-1" },
        form: { title: "Wrong Operation" },
      },
    });
    await router.push(draftAddress);
    await router.isReady();
    const { app, element } = mountPlatformPage(() => h(RouterView), router);
    try {
      await vi.waitFor(
        () => expect(element.querySelector(".panel-host-draft .el-alert__title")?.textContent).toBe(
          `This page has no form that takes this draft for ${SCHEDULED_TASK} (platform:Dashboard.save)`,
        ),
        { timeout: 8000 },
      );
      expect(element.querySelector(".panel-host-draft-opening")).toBeNull();
      expect(element.querySelector(".panel-host-error")).toBeNull();
    } finally {
      app.unmount();
    }
  });

  it("prefers a drawn create form over an earlier-declared unmounted edit form that also declares createForm", { timeout: 20000 }, async () => {
    const editForm: DirectProjection = {
      ...formProjection(true),
      id: "projection-schedules-style-edit",
      name: "Edit form",
    };
    const newForm: DirectProjection = {
      ...formProjection(true),
      id: "projection-schedules-style-new",
      name: "New form",
    };
    const projectionMap: Record<string, DirectProjection> = {
      [editForm.id]: editForm,
      [newForm.id]: newForm,
    };
    const manifest = definePanel({
      state: {
        selected: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true },
        compose: { type: { kind: "scalar", type: "string" }, deepLink: true },
      },
      members: {
        // Declared before `newForm`, matching the schedules panel layout.
        editForm: { target: { projectionId: editForm.id }, inputs: { task: { state: "selected" } } },
        newForm: { target: { projectionId: newForm.id }, inputs: { task: { state: "selected" } } },
      },
      commands: {},
    });
    const module = `import { computed } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const compose = computed(() => instance.state.values.value.compose);
    const takenSlot = computed(() => instance.draft.value?.slot ?? "");
    return { compose, takenSlot };
  },
});
`;
    const panel = {
      ...panelRecord("panel-two-conditional-forms", "Two conditional forms", manifest),
      content: {
        html: '<div id="app"><span class="taken-slot">{{ takenSlot }}</span><projection slot="newForm" v-if="compose === \'new\'"></projection><projection slot="editForm" v-if="compose !== \'new\'"></projection></div>',
        module,
      },
    };
    const use = panelUse("use-two-conditional-forms", "two-conditional-forms-page", panel.id, "/applications/app-ops-model/two-forms");
    const titleField = {
      path: "/title", label: "Title", control: { kind: "text" as const }, valueSchema: {}, required: true, readOnly: false,
    };
    // Deliberately answer `editForm` before `newForm` so undrawn-receiver gating is exercised.
    installPlatform((request) => {
      if (request.path === "/api/data-query/platform/applications/app-ops-model/panel-uses") {
        return Response.json({
          success: true,
          data: { applicationId: "app-ops-model", entry: { path: "/ops-model", renderer: "panels" }, panelUses: [use] },
        });
      }
      if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
      if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, projectionMap, request);
      if (request.path === `/api/product-projections/${editForm.id}`) return Response.json({ projection: editForm });
      if (request.path === `/api/product-projections/${newForm.id}`) {
        return new Promise((resolve) => setTimeout(() => resolve(Response.json({ projection: newForm })), 40));
      }
      if (request.path === "/api/assistant/sessions/session-1/runs/run-1/page-draft") {
        return Response.json({
          pageKey: use.pageKey,
          operation: `${SCHEDULED_TASK}.create`,
          target: { objectType: SCHEDULED_TASK },
          form: { title: "New Scheduled Task" },
        });
      }
      if (request.path === "/api/product-panels/read") {
        const body = request.body as {
          operations?: true;
          inputs: { values?: Record<string, unknown> };
          runtimeParams?: { values?: Record<string, unknown> };
        };
        if (body.operations) return Response.json({ status: "ready", value: {} });
        const values = body.runtimeParams?.values ?? body.inputs.values ?? { title: "" };
        return Response.json({
          status: "ready",
          value: {
            fields: [titleField],
            values,
            errors: [],
            revision: 1,
            save: { method: "POST", path: "/models", bodySchema: {}, draftOperation: `${SCHEDULED_TASK}.create` },
          },
        });
      }
      return nothingAt(request);
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/applications/:applicationId/:panelPath(.*)",
          component: PanelApplicationRoute,
          props: (route) => ({ applicationId: String(route.params.applicationId) }),
        },
      ],
    });
    const query = new URLSearchParams({
      draftSessionId: "session-1",
      draftRunId: "run-1",
      draftPath: "outputs/drafts/new.page-draft.json",
      state: JSON.stringify({ compose: "new" }),
    });
    await router.push(`/applications/app-ops-model/two-forms?${query}`);
    await router.isReady();
    const { app, element } = mountPlatformPage(() => h(RouterView), router);
    try {
      await vi.waitFor(
        () => expect(element.querySelector<HTMLInputElement>('[data-field="/title"] input')?.value).toBe("New Scheduled Task"),
        { timeout: 8000 },
      );
      expect(element.querySelector(".taken-slot")?.textContent).toBe("newForm");
      await vi.waitFor(() => expect(element.querySelector(".panel-host-draft-opening")).toBeNull(), { timeout: 5000 });
    } finally {
      app.unmount();
    }
  });
});
