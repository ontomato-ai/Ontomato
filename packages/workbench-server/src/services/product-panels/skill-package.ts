import { readFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { z } from "zod";
import { type RuntimeSkillRef, type StandardSkillFrontmatter } from "@ontomato/contracts/agent-runtime-skills";
import { PAGE_DRAFT_QUERY_KEYS } from "@ontomato/contracts/page-draft";
import { panelClientReads } from "@ontomato/contracts/panel-client-requests";
import { panelAddress, panelUsePath } from "@ontomato/contracts/panel-host";
import type { PanelOperation } from "@ontomato/contracts/panel-manifest";
import { componentOperationSchema, panelStateOperation, projectionOperations, projectionPorts } from "@ontomato/contracts/panel-projection";
import { productPanelContentSchema, productPanelInputSchema, productProjectionInputSchema, type PanelSkillSource, type ProductProjectionInput } from "@ontomato/contracts/product-panels";
import { runtimeRoot } from "../../content/layout";
import type { SkillOffering } from "../../core/skills";
import { findCurrentProduct, type CurrentProductKind } from "../../infrastructure/product-current";
import { appSdkBuild } from "../app-builder/sdk";

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
    ...(panels.some(panel => panel.operations.length) ? ["review declared operations"] : []),
  ];
  const actionText = verbs.format(actions);
  const names = [...panels.map(panel => panel.name).join(", ")];
  const titleText = names.length > 440 ? `${names.slice(0, 439).join("")}…` : names.join("");
  return { name: skill.name, description: `${actionText[0]!.toUpperCase()}${actionText.slice(1)} for ${titleText}.` };
}

async function readComponentCatalogue() {
  const { version } = await appSdkBuild();
  const file = path.join(runtimeRoot(), "dist/apps-sdk", version, "components.json");
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
  const [components, projections] = await Promise.all([
    readComponentCatalogue(),
    Promise.all([...projectionIds].map(async id =>
      [id, productProjectionInputSchema.parse(await currentDefinition(domainId, "projection", id))] as const)),
  ]);
  const projectionRecords = new Map(projections);
  const descriptions = new Map([...panels].map(([id, panel]) =>
    [id, describePanel(panel, projectionRecords, components)]));

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
    return {
      text: `- ${slot} — ${projection.name} (${declaration.projectionId}), ${projection.componentId}, binding ${ports.binding}. ${projection.description} ${component.meaning} Inputs from state: ${JSON.stringify(declaration.inputs)}. Display: ${JSON.stringify(projection.display)}.`,
      binding: ports.binding,
      operations: projectionOperations(manifest, { slot, ports }),
    };
  });
  const operations = [...projections.flatMap(projection => projection.operations), ...manifest.operations.map(panelStateOperation)];
  return {
    ...panel,
    projections,
    operations,
    forms: operations.filter(operation => operation.kind === "form.save"),
    reads: describeReads(new Set(projections.map(projection => projection.binding))),
  };
}

function describeUse(use: Use, { name, description, content, manifest, projections, operations, forms, reads }: PanelDescription): string {
  const address = panelUsePath(use.applicationId, use.path);
  const { recipes } = productPanelContentSchema.parse(content);
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
      ...operations.map(operation => `- ${operation.label} (${operation.id}), kind ${operation.kind}, handlerRef ${operation.handlerRef}, input ${operation.kind === "form.save" ? "from the owner's dynamic form" : JSON.stringify(operation.inputSchema)}, target ${JSON.stringify(operation.target ?? null)}.`),
      ...(operations.length ? [] : ["No operations."]),
      "The platform operation coordinator will provide execution when P3 is connected.",
    ].join("\n"),
    ...(recipes === undefined ? [] : [`### Recipes\n\n${recipes}`]),
  ].filter(Boolean).join("\n\n");
}

function describeReads(bindings: ReadonlySet<string>): string {
  const endpoints = [...bindings].flatMap(binding => {
    const reads = panelClientReads(binding);
    return reads.length ? [
      `Use these endpoints for \`${binding}\`. The binding's owner decides access and returns current data.`,
      ...reads.map(({ method, template, instructions }) =>
        `- \`${method} ${template}\`${instructions ? ` ${instructions}` : ""}`),
    ] : [];
  });
  if (!endpoints.length) return "";
  return [
    "### Read current data",
    ...endpoints,
    "Append the path to `ONTOMATO_ONTOLOGY_URL`. For a run callback, send `X-Ontomato-Callback-Credential: $ONTOMATO_EXECUTION_CALLBACK` and `X-Ontomato-Run-Id: $ONTOMATO_RUN_ID`. The host forwards these reads with the run's executor credential. When the runtime directly provides a user credential, use that credential with `tk` or `X-API-Key`.",
  ].join("\n");
}

function describeDraft(use: Use, address: string, forms: readonly PanelOperation[]): string {
  if (!forms.length) return "";
  return [
    "### Draft a change",
    "Use the owner's current dynamic form to determine valid fields and values. Write `outputs/drafts/<name>.page-draft.json` with this page-draft envelope:",
    "```json",
    JSON.stringify({ pageKey: use.pageKey, operation: forms[0]!.handlerRef, target: { id: "<object id>" }, form: {} }, null, 2),
    "```",
    `Choose the matching form's handlerRef for operation: ${forms.map(form => form.handlerRef).join(", ")}. Put the values to fill in form and the selected object's ID in target.id when editing an existing object.`,
    `Link to \`${address}\` with ${PAGE_DRAFT_QUERY_KEYS.map(key => `\`${key}\``).join(", ")} set to the current session ID, run ID, and encoded draft path. The panel fills the form and the reader reviews and saves it.`,
  ].join("\n");
}
