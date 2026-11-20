import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { PanelFormValues } from "@ontomato/contracts/panel-projection";
import { AGENT_DEFINITION } from "@ontomato/contracts/platform-object-types";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
  humanIntents, ignoreChanges, inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelOf, panelRecord, panelUse, registered, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * A panel that creates by its own state (M7's business knowledge: `mode` set to `create`), beside a list that selects its
 * first row whenever its selection is not among its rows. Through the platform's real bridge and admission.
 *
 * The mistake this catches: the form's new object depending on an empty selection, so the list selecting its first row
 * again — on a reload, or when the panel opens at a `mode=create` address — turns the reader's new object into an edit of
 * that row and their typing is gone.
 */

const FIRST = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a01";
const SECOND = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a02";
const CREATED = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a03";
const listPath = "/api/assistant/agent-definitions";
const formPath = `${listPath}/form`;
const fields = [{ path: "/name", label: "Name", control: { kind: "text" }, valueSchema: { type: "string" }, required: true, readOnly: false }];
const agent = { kind: "object", objectType: AGENT_DEFINITION } as const;
const source = { type: { kind: "PlatformObjectType", id: AGENT_DEFINITION } } as const;
const formParams = { values: { input: "values" }, changedField: { input: "changedField" } };
const current = {
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain" as const, description: "",
};
const projections: Record<string, ProductProjection> = {
  "agent-list": {
    ...current, id: "agent-list", name: "Agents", componentId: "@ontomato/sdk:ObjectList",
    inputs: {}, outputs: { selected: agent },
    config: { selectable: true, fallbackToFirst: true },
    data: { rows: { source, read: "list", params: {} } },
  },
  "agent-form": {
    ...current, id: "agent-form", name: "Agent form", componentId: "@ontomato/sdk:ObjectForm",
    inputs: {
      agent, mode: { kind: "scalar", type: "string" },
      values: { kind: "json" }, changedField: { kind: "scalar", type: "string" },
    },
    outputs: {},
    config: { creates: true, createWhen: { input: "mode", equals: "create" } },
    data: {
      form: { source: { object: { input: "agent" } }, read: "form", params: formParams },
      createForm: { source, read: "createForm", params: formParams },
    },
  },
};
const manifest = definePanel({
  state: {
    selected: { type: agent, deepLink: true },
    mode: { type: { kind: "scalar", type: "string" }, deepLink: true },
  },
  members: {
    list: { target: { projectionId: "agent-list" }, outputs: { selected: { state: "selected" } } },
    form: { target: { projectionId: "agent-form" }, inputs: { agent: { state: "selected" }, mode: { state: "mode" } } },
  },
  events: {},
});
const panel = panelRecord("panel-create-mode", "Agents", manifest);
const use = panelUse("use-create-mode", "create-mode", panel.id, "/ontology/agents");

const definition = (id: string, name: string) => ({
  id, name, description: "", icon: null, enabled: true, executionUserId: null, modelSelection: { modelId: null },
  skills: [], classNames: [], enabledMcpServiceIds: [], systemPrompt: "", sortOrder: 0,
});

async function open(state: Record<string, unknown>) {
  const agents = [definition(FIRST, "Revenue"), definition(SECOND, "Churn")];
  let pending: PanelFormValues;
  const intents = humanIntents(() => {
    agents.push(definition(CREATED, String(pending.name)));
    return {
      kind: "success", data: {},
      affected: { objects: [{ objectType: AGENT_DEFINITION, primaryKey: CREATED }], objectTypes: [AGENT_DEFINITION] },
    };
  }, { source: "input", input: "agent" });
  const sent = installPlatform((request: Sent) => {
    const projected = /^\/api\/product-projections\/(.+)$/.exec(request.path);
    if (projected) return Response.json({ projection: projections[projected[1]!] });
    if (request.path === listPath) return Response.json({ agents });
    if (request.path === formPath) {
      const { target } = request.body as { target: { kind: string; primaryKey?: string } };
      const name = target.kind === "draft" ? "" : agents.find((agent) => agent.id === target.primaryKey)!.name;
      const save = target.kind === "draft"
        ? { method: "POST", path: "/assistant/agent-definitions", bodySchema: {}, draftOperation: "agent.create" }
        : { method: "PUT", path: "/assistant/agent-definitions/:id", bodySchema: {}, draftOperation: "agent.update" };
      return Response.json({ fields, values: { name }, errors: [], save });
    }
    if (request.path === "/api/panel-operations/intents") {
      pending = (request.body as { call: { input: { values: PanelFormValues } } }).call.input.values;
    }
    return intents(request) ?? nothingAt(request);
  });
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const frame = panelFrame();
  platformPanelHost("ontology", use, ignoreChanges).frame(frame, registered("ontology", use, panel), true);
  writePanelDocument(registered("ontology", use, panel), use.path, state as never);
  inside(frame);
  const mounted = await mountPanel(panelOf("list", "form"));
  return { ...mounted, sent };
}

const name = () => document.querySelector<HTMLInputElement>('#app [data-field="/name"] input');
const formReads = (sent: Sent[]) => sent.filter((request) => request.path === formPath)
  .map((request) => (request.body as { target: { kind: string; primaryKey?: string } }).target);

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("opened at a creating address, keeps the new object while the list selects its first row, and edits what it saved", async () => {
  const { context, sent } = await open({ mode: "create" });
  // The list selected its first row; the form is still on the new object.
  await vi.waitFor(() => {
    expect(context.instance.state.values.value.selected).toEqual({ className: AGENT_DEFINITION, primaryKey: FIRST });
    expect(name()?.value).toBe("");
  }, { timeout: 5000 });
  expect(formReads(sent)).toEqual([{ kind: "draft" }]);

  name()!.value = "Margin";
  name()!.dispatchEvent(new Event("input"));
  await nextTick();
  // The list reloads, and selects its first row again: the reader's typing stays.
  context.instance.refreshObjects();
  await vi.waitFor(() => expect(sent.filter((request) => request.path === listPath)).toHaveLength(2));
  await nextTick();
  expect(name()!.value).toBe("Margin");
  expect(formReads(sent)).toEqual([{ kind: "draft" }]);

  await context.instance.invoke("form.save");
  const saved = sent.find((request) => request.path === "/api/panel-operations/intents")!.body as {
    call: { input: { values: PanelFormValues } };
  };
  expect(saved.call.input.values).toEqual({ name: "Margin" });
  // Saved, the panel no longer creates: it selects the object the owner created and the form edits it.
  await vi.waitFor(() => expect(context.instance.state.values.value).toMatchObject({
    selected: { className: AGENT_DEFINITION, primaryKey: CREATED }, mode: null,
  }));
});

it("turns to a new object when the panel's state says it creates, whatever is selected", async () => {
  const { context, sent } = await open({});
  await vi.waitFor(() => expect(name()?.value).toBe("Revenue"), { timeout: 5000 });
  context.instance.state.set("mode", "create");
  await vi.waitFor(() => expect(name()?.value).toBe(""));
  expect(context.instance.state.values.value.selected).toEqual({ className: AGENT_DEFINITION, primaryKey: FIRST });
  expect(formReads(sent).at(-1)).toEqual({ kind: "draft" });
});
