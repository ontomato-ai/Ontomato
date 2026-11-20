import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { PanelFormSaveInput } from "@ontomato/contracts/panel-projection";
import { AGENT_DEFINITION } from "@ontomato/contracts/platform-object-types";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
  formSaveCalls, humanIntents, ignoreChanges, inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelOf, panelRecord, panelUse, registered, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * A form creates exactly when the object it edits is empty and its projection declares the owner's create form (big
 * main's ruling, 2026-11-20): a header "new" is an event that empties that state, and no option on the form says so.
 * Saved, the platform puts the object the owner created into that state, so the reader goes on with the one they made.
 * Through the platform's real bridge and admission.
 *
 * The mistakes this catches: a form that needs a flag to create; a create whose object the panel does not then hold (the
 * reader left on an empty form, or on another object); an emptied selection that keeps the old object's form.
 */

const FIRST = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a01";
const SECOND = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a02";
const CREATED = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a03";
const listPath = "/api/assistant/agent-definitions";
const formPath = `${listPath}/form`;
const revision = 7;
const fields = [{ path: "/name", label: "Name", control: { kind: "text" }, valueSchema: { type: "string" }, required: true, readOnly: false }];
const agent = { kind: "object", objectType: AGENT_DEFINITION } as const;
const source = { type: { kind: "PlatformObjectType", id: AGENT_DEFINITION } } as const;
const current = {
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain" as const, description: "",
};
const projections: Record<string, ProductProjection> = {
  "agent-form": {
    ...current, id: "agent-form", name: "Agent form", componentId: "@ontomato/sdk:ObjectForm",
    inputs: { agent }, outputs: {}, config: {},
    data: {
      form: { source: { object: { input: "agent" } }, read: "form", params: {} },
      createForm: { source, read: "createForm", params: {} },
    },
  },
};
const manifest = definePanel({
  state: { selected: { type: agent, deepLink: true } },
  members: { form: { target: { projectionId: "agent-form" }, inputs: { agent: { state: "selected" } } } },
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
  const intents = humanIntents((_, { input }) => {
    agents.push(definition(CREATED, String((input as PanelFormSaveInput).values.name)));
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
      return Response.json({ fields, values: { name }, revision, errors: [], save });
    }
    return intents(request) ?? nothingAt(request);
  });
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const frame = panelFrame();
  platformPanelHost("ontology", use, ignoreChanges).frame(frame, registered("ontology", use, panel), true);
  writePanelDocument(registered("ontology", use, panel), use.path, state as never);
  inside(frame);
  const mounted = await mountPanel(panelOf("form"));
  return { ...mounted, sent };
}

const name = () => document.querySelector<HTMLInputElement>('#app [data-field="/name"] input');
const formReads = (sent: Sent[]) => sent.filter((request) => request.path === formPath)
  .map((request) => (request.body as { target: { kind: string; primaryKey?: string } }).target);

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("creates with nothing selected, and holds the object the owner created once it is saved", async () => {
  const { context, sent } = await open({});
  await vi.waitFor(() => expect(name()?.value).toBe(""), { timeout: 5000 });
  expect(formReads(sent)).toEqual([{ kind: "draft" }]);

  name()!.value = "Margin";
  name()!.dispatchEvent(new Event("input"));
  await nextTick();
  await context.instance.invoke("form.save");
  expect(formSaveCalls(sent)).toEqual([{
    target: { kind: "draft" },
    input: { values: { name: "Margin" }, revision, submittedFields: ["/name"] },
  }]);
  // The panel holds what the owner created, and the form goes on editing it.
  await vi.waitFor(() => expect(context.instance.state.values.value.selected).toEqual({ className: AGENT_DEFINITION, primaryKey: CREATED }));
  await vi.waitFor(() => expect(formReads(sent).at(-1)).toEqual({ kind: "object", objectType: AGENT_DEFINITION, primaryKey: CREATED }));
});

it("turns an edit into a new object when the panel empties the object it edits", async () => {
  const { context, sent } = await open({ selected: { className: AGENT_DEFINITION, primaryKey: FIRST } });
  await vi.waitFor(() => expect(name()?.value).toBe("Revenue"), { timeout: 5000 });
  // A header "new" is an event that empties the selection.
  context.instance.state.set("selected", null);
  await vi.waitFor(() => expect(name()?.value).toBe(""));
  expect(formReads(sent).at(-1)).toEqual({ kind: "draft" });
});
