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
import { productPanelInputSchema, productProjectionInputSchema, type PanelSkillSource } from "@ontomato/contracts/product-panels";
import { runtimeRoot } from "../../content/layout";
import type { SkillPackage } from "../../core/skills";
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

export function panelSkillManifest(skill: RuntimeSkillRef, uses: readonly Use[]): StandardSkillFrontmatter {
  const pages = uses.map(use => use.pageKey).join(", ");
  return { name: skill.name, description: `Read, open, and draft for panel pages ${[...pages].slice(0, 440).join("")}.` };
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

export async function providePanelSkill(domainId: string, skill: RuntimeSkillRef, manifest: StandardSkillFrontmatter,
  uses: readonly Use[]): Promise<SkillPackage> {
  const components = await readComponentCatalogue();
  const sections = await Promise.all(uses.map(use => describeUse(domainId, use, components)));
  return { skill, files: [{ path: "SKILL.md", content: `---\n${stringify(manifest)}---\n\n${sections.join("\n\n")}\n` }] };
}

async function describeUse(domainId: string, use: Use, components: ReadonlyMap<string, ComponentMetadata>): Promise<string> {
  const { name, description, content, manifest } = productPanelInputSchema.parse(await currentDefinition(domainId, "panel", use.panelId));
  const projections = await Promise.all(Object.entries(manifest.slots).map(async ([slot, declaration]) => {
    const definition = await currentDefinition(domainId, "projection", declaration.projectionId);
    const projection = productProjectionInputSchema.parse(definition);
    const component = components.get(projection.componentId);
    if (!component) throw new Error(`SDK component ${projection.componentId} is missing for projection ${declaration.projectionId}`);
    const ports = projectionPorts(projection, component);
    return {
      text: `- ${slot} — ${projection.name} (${declaration.projectionId}), ${projection.componentId}, binding ${ports.binding}. ${projection.description} ${component.meaning} Inputs from state: ${JSON.stringify(declaration.inputs)}. Display: ${JSON.stringify(projection.display)}.`,
      reads: panelClientReads(ports.binding),
      operations: projectionOperations(manifest, { slot, ports }),
    };
  }));
  const address = panelUsePath(use.applicationId, use.path);
  const operations = [...projections.flatMap(projection => projection.operations), ...manifest.operations.map(panelStateOperation)];
  const reads = new Set(projections.flatMap(projection => projection.reads.map(request => `- \`${request.method} ${request.template}\``)));
  return [
    `## ${name} — ${use.pageKey}`,
    description,
    `### Projections\n${projections.map(projection => projection.text).join("\n") || "No projections."}`,
    [
      "### State and page context",
      `The instance declares ${JSON.stringify(manifest.state)}. Slot inputs above identify the state field they read.`,
      "Use the message's page context to identify the page and its selected object references. Each selection carries its object type and ID. The panel address carries the instance's deep-linkable state.",
    ].join("\n"),
    describeReads(reads),
    [
      "### Open the panel",
      `Link to \`${panelAddress(address, {})}\` for use \`${use.useId}\`. To restore a selection, set the \`state\` query parameter to URL-encoded JSON containing only fields marked deepLink. An object reference is \`{"className":"<object type>","primaryKey":"<id>"}\`.`,
    ].join("\n"),
    describeDraft(use, address, operations),
    [
      "### Declared operations",
      ...operations.map(operation => `- ${operation.label} (${operation.id}), kind ${operation.kind}, handlerRef ${operation.handlerRef}, input ${operation.kind === "form.save" ? "from the owner's dynamic form" : JSON.stringify(operation.inputSchema)}, target ${JSON.stringify(operation.target ?? null)}.`),
      ...(operations.length ? [] : ["No operations."]),
      "The platform operation coordinator will provide execution when P3 is connected.",
    ].join("\n"),
    ...(content.recipes === undefined ? [] : [`### Recipes\n\n${content.recipes}`]),
  ].filter(Boolean).join("\n\n");
}

function describeReads(reads: ReadonlySet<string>): string {
  if (!reads.size) return "";
  return [
    "### Read current data",
    "Use the scheduled tasks owner's endpoints. The owner decides access and returns the current data and form.",
    ...reads,
    "Append the path to `ONTOMATO_ONTOLOGY_URL`. For a run callback, send `X-Ontomato-Callback-Credential: $ONTOMATO_EXECUTION_CALLBACK` and `X-Ontomato-Run-Id: $ONTOMATO_RUN_ID`. The host forwards these reads with the run's executor credential. When the runtime directly provides a user credential, use that credential with `tk` or `X-API-Key`.",
    "For the dynamic form, POST JSON with `values`, `changedField`, `taskId`, and `timeZone` from the task and current edits. Read the task first for its appId, content and timeZone. Start with the task's content as values and null as changedField, then use the returned fields and values. Request the form again when an edited field changes it.",
  ].join("\n");
}

function describeDraft(use: Use, address: string, operations: readonly PanelOperation[]): string {
  const forms = operations.filter(operation => operation.kind === "form.save");
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
