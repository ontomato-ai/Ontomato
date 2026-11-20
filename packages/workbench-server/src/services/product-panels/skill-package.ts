import { createHash } from "node:crypto";
import { stringify } from "yaml";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { type RuntimeSkillRef, type StandardSkillFrontmatter } from "@ontomato/contracts/agent-runtime-skills";
import { PAGE_DRAFT_QUERY_KEYS } from "@ontomato/contracts/page-draft";
import { panelClientReads } from "@ontomato/contracts/panel-client-requests";
import type { PageSkillEntrance } from "@ontomato/contracts/page-skills";
import { directReadDeclaration, projectionBindingKeys } from "@ontomato/contracts/panel-projection";
import { productPanelInputSchema, productProjectionInputSchema, type PanelSkillSource, type ProductPanelInput, type ProductProjectionInput } from "@ontomato/contracts/product-panels";
import type { ProtectedSkillOffering } from "../../core/skills";
import { getDefaultLocale } from "../../i18n";
import { findCurrentProduct, type CurrentProductKind } from "../../infrastructure/product-current";
import { readPanelComponentCatalogue } from "./component-catalogue";
import { directProjectionWriteDescriptions } from "./direct-operations";
import { panelServerOperation, panelServerOperationSupportsBatch } from "./server-operations";

type ComponentCatalogue = Awaited<ReturnType<typeof readPanelComponentCatalogue>>["components"];
const verbs = new Intl.ListFormat("en", { type: "conjunction" });

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function panelSkillManifest(skill: RuntimeSkillRef, panel: PanelDescription, sourceFingerprint: string): StandardSkillFrontmatter {
  const actions = [
    ...(panel.reads ? ["read current data"] : []),
    "open the panel",
    ...(panel.forms.length ? ["draft changes"] : []),
    ...(panel.operations.length || Object.keys(panel.events).length ? ["review declared operations"] : []),
  ];
  const actionText = verbs.format(actions);
  return {
    name: skill.name,
    description: `${actionText[0]!.toUpperCase()}${actionText.slice(1)} for ${panel.name}.`,
    metadata: { "ontomato-panel-fingerprint": sourceFingerprint },
  };
}

async function currentDefinition(domainId: string, kind: CurrentProductKind, id: string) {
  const row = await findCurrentProduct(domainId, kind, id);
  if (!row) throw new Error(`Panel skill references a missing ${kind}: ${id}`);
  return row.definition;
}

/** The registry receives dependencies before it asks an admitted offering for package contents. */
export async function panelSkillOfferings(domainId: string, sources: readonly PanelSkillSource[]): Promise<ProtectedSkillOffering[]> {
  const panels = new Map<string, Map<string, PageSkillEntrance>>();
  for (const { panelId, entrance } of sources) {
    const entrances = panels.get(panelId) ?? new Map<string, PageSkillEntrance>();
    const key = JSON.stringify(["permissionCode" in entrance ? entrance.permissionCode : null, entrance.pageKey]);
    entrances.set(key, entrance);
    panels.set(panelId, entrances);
  }
  const projections = new Map<string, Promise<ProductProjectionInput>>();
  function projection(id: string) {
    const found = projections.get(id);
    if (found) return found;
    const read = currentDefinition(domainId, "projection", id).then(definition => productProjectionInputSchema.parse(definition));
    projections.set(id, read);
    return read;
  }
  let release: ReturnType<typeof readPanelComponentCatalogue> | undefined;
  return Promise.all([...panels].map(async ([id, entrances]): Promise<ProtectedSkillOffering> => {
    const panel = productPanelInputSchema.parse(await currentDefinition(domainId, "panel", id));
    const projectionIds = [...new Set(Object.values(panel.manifest.members)
      .flatMap(({ target }) => "projectionId" in target ? [target.projectionId] : []))];
    async function buildSnapshot() {
      const [sdk, entries] = await Promise.all([
        release ??= readPanelComponentCatalogue(),
        Promise.all(projectionIds.map(async projectionId => [projectionId, await projection(projectionId)] as const)),
      ]);
      const description = describePanel(panel, new Map(entries), sdk.components);
      return {
        description, markdown: describeSkill(description),
        fingerprint: fingerprint([id, panel, entries, sdk.version, sdk.digest]),
      };
    }
    let snapshot: ReturnType<typeof buildSnapshot> | undefined;
    const read = () => snapshot ??= buildSnapshot();
    return {
      kind: "protected",
      sourceKey: id,
      entrances: [...entrances.values()],
      resourceIds: [id, ...projectionIds],
      async readManifest(skill) {
        const { description, fingerprint } = await read();
        return panelSkillManifest(skill, description, fingerprint);
      },
      async provide(skill) {
        const { description, markdown, fingerprint } = await read();
        const manifest = panelSkillManifest(skill, description, fingerprint);
        return { skill, files: [{ path: "SKILL.md", content: `---\n${stringify(manifest)}---\n\n${markdown}\n` }] };
      },
    };
  }));
}

type PanelDescription = ReturnType<typeof describePanel>;
type OperationDescription = ReturnType<typeof directProjectionWriteDescriptions>[number];

function describePanel(
  panel: ProductPanelInput, records: ReadonlyMap<string, ProductProjectionInput>, components: ComponentCatalogue,
) {
  const { manifest } = panel;
  const projections = Object.entries(manifest.members).flatMap(([member, declaration]) => {
    if (!("projectionId" in declaration.target)) return [];
    const { projectionId } = declaration.target;
    const projection = records.get(projectionId)!;
    const component = components.get(projection.componentId);
    if (!component) throw new Error("SDK component " + projection.componentId + " is missing for projection " + projectionId);
    const data = Object.fromEntries(Object.entries(projection.data).map(([key, read]) =>
      [key, { ...read, result: directReadDeclaration(projection, read)!.result }]));
    return [{
      text: `- ${member} — ${projection.name} (${projectionId}), ${projection.componentId}. ${projection.description} ${component.meaning} Inputs: ${JSON.stringify(declaration.inputs ?? {})}. Named data: ${JSON.stringify(data)}. Configuration: ${JSON.stringify(projection.config)}.`,
      bindings: projectionBindingKeys(projection),
      operations: directProjectionWriteDescriptions(projection, member),
    }];
  });
  const operations = projections.flatMap(projection => projection.operations);
  return {
    name: panel.name,
    description: panel.description,
    state: manifest.state,
    events: manifest.events,
    content: panel.content,
    projections,
    operations,
    forms: operations.filter(operation => operation.kind === "form.save"),
    reads: describeReads(new Set(projections.flatMap(projection => projection.bindings))),
  };
}

function describeSkill({ name, description, content, state, events, projections, operations, forms, reads }: PanelDescription): string {
  const { recipes, messages } = content;
  const resolveLabel = (key: string) => messages?.[getDefaultLocale()]?.[key] ?? key;
  const declaredEvents = Object.entries(events).map(([id, event]) => {
    const label = event.labelKey ? resolveLabel(event.labelKey) : id;
    return `- ${label} (${id}): ${JSON.stringify(event.do)}`;
  });
  return [
    `## ${name}`,
    description,
    `### Projections\n${projections.map(projection => projection.text).join("\n") || "No projections."}`,
    [
      "### State and page context",
      `The instance declares ${JSON.stringify(state)}. Member inputs above identify the state field they read.`,
      "Use the message's page context to identify the page and its selected object references. Each selection carries its object type and ID. The panel address carries the instance's deep-linkable state.",
    ].join("\n"),
    reads,
    [
      "### Open the panel",
      "Use the canonical path from the current page context. To restore a selection, set the `state` query parameter to URL-encoded JSON containing only fields marked deepLink. Object references carry className and primaryKey.",
    ].join("\n"),
    describeDraft(forms),
    ...(declaredEvents.length ? [["### Panel events", ...declaredEvents].join("\n")] : []),
    [
      "### Declared operations",
      ...operations.map(describeOperation),
      ...(operations.length ? [] : ["No operations."]),
      "Call the declared operation with POST `$ONTOMATO_PANEL_OPERATIONS_URL/operate`, JSON `{intentId:<new UUID>,applicationId,useId,operationId,call:{target,input}}`. Send `X-Ontomato-Callback-Credential: $ONTOMATO_EXECUTION_CALLBACK` and `X-Ontomato-Run-Id: $ONTOMATO_RUN_ID`. Never call a write owner endpoint directly from a platform panel skill.",
      ...(operations.some(operation => panelServerOperationSupportsBatch(operation.handlerRef)) ? [
        "For an operation marked as batch-capable, use `calls:[{target,input},...]` in place of `call`. Submit all concrete targets and their inputs under one intent for one confirmation. A batch result reports the owner's outcome for each item when available.",
      ] : []),
      "Use the applicationId and useId from the current page context and the operationId declared above. If the host did not provide a current use, ask the reader to open the panel before attempting a panel operation.",
      "Default form.save returns an unsaved page-draft envelope: write it to the draft artifact and link the reader to review/save. Session automatic mode allows the same declared save to execute directly. Only the authenticated session owner changes that setting.",
      "An action can return confirmation-required with intentId. End this tool call immediately; do not wait or poll. Continue independent work or finish the round. A genuine user agent-answer is delivered back to this conversation and can wake a later run. Then POST `{}` to `$ONTOMATO_PANEL_OPERATIONS_URL/intents/<intentId>/dispatch` using THAT RUN's callback and run ID. Node verifies the real selected option and the current executor. Free text, defaults, parent answers, questionId or a different toolCallId never authorize execution. Changed parameters/target/executor require a new intent and confirmation.",
      "A dispatched result is final for that intent, including failure/unknown; never retry the owner call under another toolCallId. Read the intent at `/api/panel-operation-intents/<intentId>` through ONTOMATO_WORKBENCH_URL when needed; this read does not execute it.",
    ].join("\n"),
    ...(recipes === undefined ? [] : [`### Recipes\n\n${recipes}`]),
  ].filter(Boolean).join("\n\n");
}

function describeOperation(operation: OperationDescription): string {
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

function describeDraft(forms: readonly OperationDescription[]): string {
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
    JSON.stringify({ pageKey: "<current page context pageKey>", operation: owners[0]!.update, target: { id: "<object id>" }, form: {} }, null, 2),
    "```",
    ...owners.map(owner => `- ${owner.id} uses \`${owner.update}\` for an existing object.${owner.create ? ` Use \`${owner.create}\` with an empty target for creation.` : ""}`),
    "Put the selected object's ID in `target.id` when editing an existing object.",
    "Use the owner-described values in `form`. An owner's revision, when required, is part of the operation input.",
    `Link to the canonical path from the current page context with ${PAGE_DRAFT_QUERY_KEYS.map(key => `\`${key}\``).join(", ")} set to the current session ID, run ID, and encoded draft path. The panel fills the form and the reader reviews and saves it.`,
  ].join("\n");
}
