import { readFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { type RuntimeSkillRef, type StandardSkillFrontmatter } from "@ontomato/contracts/agent-runtime-skills";
import { PAGE_DRAFT_QUERY_KEYS } from "@ontomato/contracts/page-draft";
import { panelClientReads } from "@ontomato/contracts/panel-client-requests";
import { panelAddress, panelUsePath } from "@ontomato/contracts/panel-host";
import type { PanelOperation } from "@ontomato/contracts/panel-manifest";
import { componentOperationSchema, panelStateOperation, projectionBindingKeys, projectionOperations, projectionPorts } from "@ontomato/contracts/panel-projection";
import { productPanelContentSchema, productPanelInputSchema, productProjectionInputSchema, type PanelSkillSource, type ProductProjectionInput } from "@ontomato/contracts/product-panels";
import { installedAppsSdkDir } from "../../content/layout";
import type { SkillOffering } from "../../core/skills";
import { getDefaultLocale } from "../../i18n";
import { findCurrentProduct, type CurrentProductKind } from "../../infrastructure/product-current";
import { panelServerOperation, panelServerOperationSupportsBatch } from "./server-operations";

const catalogue = z.object({
  version: z.string(),
  components: z.array(z.object({
    componentId: z.string(),
    meaning: z.string(),
    effects: z.string().optional(),
    operations: z.array(componentOperationSchema).optional(),
  })),
});
type ComponentMetadata = z.infer<typeof catalogue>["components"][number];
type Use = PanelSkillSource["uses"][number];

const panelMetadata = productPanelInputSchema.omit({ content: true });
const verbs = new Intl.ListFormat("en", { type: "conjunction" });

function panelSkillManifest(skill: RuntimeSkillRef, panels: readonly PanelDescription[]): StandardSkillFrontmatter {
  const actions = [
    ...(panels.some(panel => panel.reads) ? ["read current data"] : []),
    panels.length === 1 ? "open the panel" : "open the panels",
    ...(panels.some(panel => panel.forms.length) ? ["draft changes"] : []),
    ...(panels.some(panel => panel.operations.length || panel.manifest.operations.length) ? ["review declared operations"] : []),
  ];
  const actionText = verbs.format(actions);
  const names = [...panels.map(panel => panel.name).join(", ")];
  const titleText = names.length > 440 ? `${names.slice(0, 439).join("")}…` : names.join("");
  return { name: skill.name, description: `${actionText[0]!.toUpperCase()}${actionText.slice(1)} for ${titleText}.` };
}

export async function readComponentCatalogue(version: string) {
  const file = path.join(installedAppsSdkDir(), version, "components.json");
  const parsed = catalogue.parse(JSON.parse(await readFile(file, "utf8")));
  if (parsed.version !== version) throw new Error(`Expected SDK catalogue ${version}, found ${parsed.version}`);
  return new Map(parsed.components.map(component => [component.componentId, component]));
}

async function currentDefinition(domainId: string, kind: CurrentProductKind, id: string) {
  const row = await findCurrentProduct(domainId, kind, id);
  if (!row) throw new Error(`Panel skill references a missing ${kind}: ${id}`);
  return row.definition;
}

/** Metadata and package text share the same current definitions within one provider list. */
export async function panelSkillOfferings(domainId: string, sources: readonly PanelSkillSource[]): Promise<SkillOffering[]> {
  if (!sources.length) return [];
  const panelIds = new Set(sources.flatMap(source => source.uses.map(use => use.panelId)));
  const panels = new Map(await Promise.all([...panelIds].map(async id => {
    const { content, ...metadata } = await currentDefinition(domainId, "panel", id);
    return [id, { ...panelMetadata.parse(metadata), content }] as const;
  })));
  const projectionIds = new Set([...panels.values()].flatMap(panel =>
    Object.values(panel.manifest.slots).map(slot => slot.projectionId)));
  const versions = new Set([...panels.values()].map(panel => panel.sdkVersion));
  const [catalogues, projections] = await Promise.all([
    Promise.all([...versions].map(async version => [version, await readComponentCatalogue(version)] as const)),
    Promise.all([...projectionIds].map(async id =>
      [id, productProjectionInputSchema.parse(await currentDefinition(domainId, "projection", id))] as const)),
  ]);
  const projectionRecords = new Map(projections);
  const components = new Map(catalogues);
  const descriptions = new Map([...panels].map(([id, panel]) =>
    [id, describePanel(panel, projectionRecords, components.get(panel.sdkVersion)!)]));

  return sources.map(({ skill, uses }) => {
    const ids = new Set(uses.map(use => use.panelId));
    const manifest = panelSkillManifest(skill, [...ids].map(id => descriptions.get(id)!));
    return {
      skill,
      manifest,
      async provide() {
        const sections = uses.map(use => describeUse(use, descriptions.get(use.panelId)!));
        return { skill, files: [{ path: "SKILL.md", content: `---\n${stringify(manifest)}---\n\n${sections.join("\n\n")}\n` }] };
      },
    };
  });
}

type PanelDescription = ReturnType<typeof describePanel>;

function describePanel(panel: z.infer<typeof panelMetadata> & { content: unknown },
  records: ReadonlyMap<string, ProductProjectionInput>, components: ReadonlyMap<string, ComponentMetadata>) {
  const { manifest } = panel;
  const projections = Object.entries(manifest.slots).map(([slot, declaration]) => {
    const projection = records.get(declaration.projectionId)!;
    const component = components.get(projection.componentId);
    if (!component) throw new Error(`SDK component ${projection.componentId} is missing for projection ${declaration.projectionId}`);
    const ports = projectionPorts(projection, component);
    const bindings = projectionBindingKeys(projection);
    const graph = projection.graph
      ? ` Graph nodes use ${bindings[0]}. Edges use ${bindings[1]} with endpoint fields at ${projection.graph.edges.sourcePath} and ${projection.graph.edges.targetPath}.`
      : "";
    return {
      text: `- ${slot} — ${projection.name} (${declaration.projectionId}), ${projection.componentId}, binding ${ports.binding}. ${projection.description} ${component.meaning}${graph} Inputs from state: ${JSON.stringify(declaration.inputs)}. Display: ${JSON.stringify(projection.display)}.`,
      bindings,
      operations: projectionOperations(manifest, { slot, ports }),
    };
  });
  const operations = projections.flatMap(projection => projection.operations);
  return {
    ...panel,
    projections,
    operations,
    forms: operations.filter(operation => operation.kind === "form.save"),
    reads: describeReads(new Set(projections.flatMap(projection => projection.bindings))),
  };
}

function describeUse(use: Use, { name, description, content, manifest, projections, operations: projectionOperations, forms, reads }: PanelDescription): string {
  const address = panelUsePath(use.path);
  const { recipes, messages } = productPanelContentSchema.parse(content);
  const resolveLabel = (key: string) => messages?.[getDefaultLocale()]?.[key] ?? key;
  const operations = [...projectionOperations, ...manifest.operations.map(operation => panelStateOperation(operation, resolveLabel))];
  return [
    `## ${name} — ${use.pageKey}`,
    description,
    `### Projections\n${projections.map(projection => projection.text).join("\n") || "No projections."}`,
    [
      "### State and page context",
      `The instance declares ${JSON.stringify(manifest.state)}. Slot inputs above identify the state field they read.`,
      "Use the message's page context to identify the page and its selected object references. Each selection carries its object type and ID. The panel address carries the instance's deep-linkable state.",
    ].join("\n"),
    reads,
    [
      "### Open the panel",
      `Link to \`${panelAddress(address, {})}\` for use \`${use.useId}\`. To restore a selection, set the \`state\` query parameter to URL-encoded JSON containing only fields marked deepLink. An object reference is \`{"className":"<object type>","primaryKey":"<id>"}\`.`,
    ].join("\n"),
    describeDraft(use, address, forms),
    [
      "### Declared operations",
      ...operations.map(describeOperation),
      ...(operations.length ? [] : ["No operations."]),
      "Call the declared operation with POST `$ONTOMATO_PANEL_OPERATIONS_URL/operate`, JSON `{intentId:<new UUID>,applicationId,useId,operationId,call:{target,input}}`. Send `X-Ontomato-Callback-Credential: $ONTOMATO_EXECUTION_CALLBACK` and `X-Ontomato-Run-Id: $ONTOMATO_RUN_ID`. Never call a write owner endpoint directly from a platform panel skill.",
      ...(operations.some(operation => panelServerOperationSupportsBatch(operation.handlerRef)) ? [
        "For an operation marked as batch-capable, use `calls:[{target,input},...]` in place of `call`. Submit all concrete targets and their inputs under one intent for one confirmation. A batch result reports the owner's outcome for each item when available.",
      ] : []),
      `Use applicationId ${JSON.stringify(use.applicationId)} and useId ${JSON.stringify(use.useId)}. The operationId is the declared ID above.`,
      "Default form.save returns an unsaved page-draft envelope: write it to the draft artifact and link the reader to review/save. Session automatic mode allows the same declared save to execute directly. Only the authenticated session owner changes that setting.",
      "An action can return confirmation-required with intentId. End this tool call immediately; do not wait or poll. Continue independent work or finish the round. A genuine user agent-answer is delivered back to this conversation and can wake a later run. Then POST `{}` to `$ONTOMATO_PANEL_OPERATIONS_URL/intents/<intentId>/dispatch` using THAT RUN's callback and run ID. Node verifies the real selected option and the current executor. Free text, defaults, parent answers, questionId or a different toolCallId never authorize execution. Changed parameters/target/executor require a new intent and confirmation.",
      "A dispatched result is final for that intent, including failure/unknown; never retry the owner call under another toolCallId. Read the intent at `/api/panel-operation-intents/<intentId>` through ONTOMATO_WORKBENCH_URL when needed; this read does not execute it.",
    ].join("\n"),
    ...(recipes === undefined ? [] : [`### Recipes\n\n${recipes}`]),
  ].filter(Boolean).join("\n\n");
}

function describeOperation(operation: PanelOperation): string {
  const summary = `- ${operation.label} (${operation.id}), kind ${operation.kind}, handlerRef ${operation.handlerRef}, target ${JSON.stringify(operation.target ?? null)}.`;
  if (operation.kind !== "form.save") {
    const batch = panelServerOperationSupportsBatch(operation.handlerRef) ? " Batch-capable." : "";
    return `${summary} Input ${JSON.stringify(operation.inputSchema)}.${batch}`;
  }
  const owner = panelServerOperation(operation.handlerRef);
  if (owner.kind !== "form.save") throw new Error(`Expected a form owner for ${operation.handlerRef}`);
  const schema = (value: z.ZodTypeAny) => JSON.stringify(zodToJsonSchema(value, { $refStrategy: "none" }));
  const created = owner.create
    ? " For automatic save from an existing create draft, supply its artifact location as call.draft {sessionId,runId,path}."
    : "";
  return `${summary} Call target schema ${schema(owner.targetSchema)}. Call input schema ${schema(owner.inputSchema)}. ${owner.formInstructions}${created}`;
}

function describeReads(bindings: ReadonlySet<string>): string {
  const requests = new Map<string, { read: ReturnType<typeof panelClientReads>[number]; owners: string[] }>();
  for (const binding of bindings) {
    for (const read of panelClientReads(binding)) {
      const key = `${read.method} ${read.service} ${read.template}`;
      const registered = requests.get(key);
      if (registered) registered.owners.push(binding);
      else requests.set(key, { read, owners: [binding] });
    }
  }
  const endpoints = [...requests.values()].map(({ read: { method, service, template, instructions }, owners }) => {
    const url = service === "" ? "ONTOMATO_WORKBENCH_URL" : "ONTOMATO_ONTOLOGY_URL";
    const path = service === "" ? "/api" + template : template;
    const resources = verbs.format(owners.map(binding => `\`${binding}\``));
    return `- \`${method} ${path}\` on \`${url}\` for ${resources}.${instructions ? ` ${instructions}` : ""}`;
  });
  if (!endpoints.length) return "";
  return [
    "### Read current data",
    ...endpoints,
    "Append each endpoint path to the indicated base URL. Choose authentication in this order:",
    "- If `ONTOMATO_TK` is set, send `tk: $ONTOMATO_TK`.",
    "- Otherwise, if `ONTOMATO_API_KEY` is set, send `X-API-Key: $ONTOMATO_API_KEY`.",
    "- If neither is set and the base URL ends in `/api/assistant/executions/<runId>/ontology` or `/api/assistant/executions/<runId>/workbench`, send `X-Ontomato-Callback-Credential: $ONTOMATO_EXECUTION_CALLBACK` and `X-Ontomato-Run-Id: $ONTOMATO_RUN_ID`. The host forwards the read with this run's executor credential.",
    "- An anonymous direct Java URL needs no authentication header. Never send callback headers to a direct Java URL, even when a callback is present for panel operations.",
  ].join("\n");
}

function describeDraft(use: Use, address: string, forms: readonly PanelOperation[]): string {
  if (!forms.length) return "";
  const owners = forms.map(form => {
    const owner = panelServerOperation(form.handlerRef);
    if (owner.kind !== "form.save") throw new Error(`Expected a form owner for ${form.handlerRef}`);
    const target = { kind: "object" as const, objectType: owner.targetType, primaryKey: "<object id>" };
    return { id: form.id, update: owner.draftOperation(target), create: owner.create && owner.draftOperation({ kind: "draft" }) };
  });
  return [
    "### Draft a change",
    "Read the owner's form for the intended target and validate the complete values. Write `outputs/drafts/<name>.page-draft.json` with this page-draft envelope:",
    "```json",
    JSON.stringify({ pageKey: use.pageKey, operation: owners[0]!.update, target: { id: "<object id>" }, form: {} }, null, 2),
    "```",
    ...owners.map(owner => `- ${owner.id} uses \`${owner.update}\` for an existing object.${owner.create ? ` Use \`${owner.create}\` with an empty target for creation.` : ""}`),
    "Put the selected object's ID in `target.id` when editing an existing object.",
    "Use the owner-described values in `form`. An owner's revision, when required, is part of the operation input.",
    `Link to \`${address}\` with ${PAGE_DRAFT_QUERY_KEYS.map(key => `\`${key}\``).join(", ")} set to the current session ID, run ID, and encoded draft path. The panel fills the form and the reader reviews and saves it.`,
  ].join("\n");
}
