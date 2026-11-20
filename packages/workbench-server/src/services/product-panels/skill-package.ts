import { createHash } from "node:crypto";
import { stringify } from "yaml";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { type RuntimeSkillRef, type StandardSkillFrontmatter } from "@ontomato/contracts/agent-runtime-skills";
import { panelManifestSchema, panelOperationId } from "@ontomato/contracts/panel-manifest";
import { PAGE_DRAFT_QUERY_KEYS } from "@ontomato/contracts/page-draft";
import { panelClientReads } from "@ontomato/contracts/panel-client-requests";
import type { PageSkillEntrance } from "@ontomato/contracts/page-skills";
import { directReadDeclaration, projectionBindingKeys } from "@ontomato/contracts/panel-projection";
import { productPanelInputSchema, productProjectionInputSchema, type PanelSkillSource, type ProductPanelInput, type ProductProjectionInput } from "@ontomato/contracts/product-panels";
import { SkillSourceRecordError, type ProtectedSkillOffering, type SkillSourceContext } from "../../core/skills/providers";
import { getDefaultLocale } from "../../i18n";
import { findCurrentProduct, type CurrentProductRow } from "../../infrastructure/product-current";
import { readPanelComponentCatalogue } from "./component-catalogue";
import { allowsOperationDraft, boundProjectionOperations, type BoundProjectionOperation } from "./operation-bindings";

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

function safeField(path: (string | number)[]): string | undefined {
  const parts: (string | number)[] = [];
  for (const part of path) {
    if (typeof part === "string" && !/^[A-Za-z_][A-Za-z0-9_-]{0,119}$/u.test(part)) break;
    parts.push(part);
  }
  return parts.length ? parts.join(".") : undefined;
}

function parseDefinition<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>, row: CurrentProductRow | undefined, resourceId: string,
): T {
  if (!row) throw new SkillSourceRecordError({ resourceId, reason: "record_missing" });
  const parsed = schema.safeParse(row.definition);
  if (parsed.success) return parsed.data;
  let issue = parsed.error.issues[0]!;
  if (issue.code === z.ZodIssueCode.invalid_union && issue.path.length === 0) {
    const choices = issue.unionErrors;
    issue = choices.reduce((best, choice) => choice.issues.length < best.issues.length ? choice : best).issues[0]!;
  }
  const field = safeField(issue.path);
  throw new SkillSourceRecordError({ resourceId, ...(field ? { field } : {}), reason: "invalid_definition" });
}

const declaredMembers = panelManifestSchema.innerType().shape.members;
const panelDependencies = z.object({
  manifest: z.object({
    members: z.record(declaredMembers.keySchema, declaredMembers.valueSchema.pick({ target: true }).strip()),
  }),
});

/** The registry receives dependencies before it asks an admitted offering for package contents. */
export async function panelSkillOfferings(
  domainId: string, sources: readonly PanelSkillSource[], reportSourceFailure?: SkillSourceContext["reportSourceFailure"],
): Promise<ProtectedSkillOffering[]> {
  const panels = new Map<string, Map<string, PageSkillEntrance>>();
  for (const { panelId, entrance } of sources) {
    const entrances = panels.get(panelId) ?? new Map<string, PageSkillEntrance>();
    const key = JSON.stringify(["permissionCode" in entrance ? entrance.permissionCode : null, entrance.pageKey]);
    entrances.set(key, entrance);
    panels.set(panelId, entrances);
  }
  const projections = new Map<string, ReturnType<typeof findCurrentProduct>>();
  function projectionRow(id: string) {
    const cached = projections.get(id);
    if (cached) return cached;
    const read = findCurrentProduct(domainId, "projection", id);
    projections.set(id, read);
    return read;
  }
  let release: ReturnType<typeof readPanelComponentCatalogue> | undefined;
  const offerings = await Promise.all([...panels].map(async ([id, byEntrance]): Promise<ProtectedSkillOffering | undefined> => {
    const row = await findCurrentProduct(domainId, "panel", id);
    const entrances = [...byEntrance.values()];
    let dependencies: z.infer<typeof panelDependencies>;
    try {
      dependencies = parseDefinition(panelDependencies, row, id);
    } catch (error) {
      if (!(error instanceof SkillSourceRecordError) || !reportSourceFailure) throw error;
      const { field, reason } = error.detail;
      reportSourceFailure({ sourceKey: id, entrances, knownRequiredResourceIds: [id], ...(field ? { field } : {}), reason });
      return undefined;
    }
    const projectionIds = [...new Set(Object.values(dependencies.manifest.members)
      .flatMap(({ target }) => "projectionId" in target ? [target.projectionId] : []))];
    async function buildSnapshot() {
      const panel = parseDefinition(productPanelInputSchema, row, id);
      const [sdk, rows] = await Promise.all([
        release ??= readPanelComponentCatalogue().catch(cause => {
          throw new Error("Unable to read the current SDK component catalogue", { cause });
        }),
        Promise.all(projectionIds.map(projectionRow)),
      ]);
      const entries = projectionIds.map((projectionId, index) =>
        [projectionId, parseDefinition(productProjectionInputSchema, rows[index], projectionId)] as const);
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
      entrances,
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
  return offerings.filter(offering => offering !== undefined);
}

type PanelDescription = ReturnType<typeof describePanel>;
type OperationDescription = BoundProjectionOperation & { id: string; label: string; draft: boolean };

function describePanel(
  panel: ProductPanelInput, records: ReadonlyMap<string, ProductProjectionInput>, components: ComponentCatalogue,
) {
  const { manifest } = panel;
  const projections = Object.entries(manifest.members).flatMap(([member, declaration]) => {
    if (!("projectionId" in declaration.target)) return [];
    const { projectionId } = declaration.target;
    const projection = records.get(projectionId)!;
    const component = components.get(projection.componentId);
    if (!component)
      throw new SkillSourceRecordError({ resourceId: projectionId, field: "componentId", reason: "component_missing" });
    const data = Object.fromEntries(Object.entries(projection.data).map(([key, read]) => {
      const declaration = directReadDeclaration(projection, read);
      if (!declaration) {
        const field = safeField(["data", key, "read"]);
        throw new SkillSourceRecordError({ resourceId: projectionId, field, reason: "invalid_definition" });
      }
      return [key, { ...read, result: declaration.result }];
    }));
    return [{
      text: `- ${member} — ${projection.name} (${projectionId}), ${projection.componentId}. ${projection.description} ${component.meaning} Inputs: ${JSON.stringify(declaration.inputs ?? {})}. Named data: ${JSON.stringify(data)}. Configuration: ${JSON.stringify(projection.config)}.`,
      bindings: projectionBindingKeys(projection),
      operations: boundProjectionOperations(projection).map(bound => {
        if (!bound.owner && bound.binding.operation.kind === "PlatformOperation") {
          const field = safeField(["operations", bound.name]);
          throw new SkillSourceRecordError({ resourceId: projectionId, field, reason: "operation_unregistered" });
        }
        return {
          ...bound, id: panelOperationId(member, bound.name), label: projection.name,
          draft: bound.owner !== undefined && allowsOperationDraft(projection, bound.owner.handler),
        };
      }),
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
    forms: operations.filter(operation => operation.owner?.handler.kind === "form.save"),
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
      ...(operations.some(operation => operation.owner?.declaration.batch) ? [
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

function describeOperation({ id, label, binding, owner, draft }: OperationDescription): string {
  const target = JSON.stringify(binding.target ?? null);
  if (!owner) return `- ${label} (${id}), Action ${binding.operation.id}, target ${target}. Read the admitted description for the actual selected object with operations:true on /api/product-panels/read before invoking it.`;
  const { handler, declaration } = owner;
  const summary = `- ${label} (${id}), kind ${handler.kind}, handlerRef ${handler.handlerRef}, target ${target}.`;
  if (handler.kind !== "form.save") {
    return `${summary} Input ${JSON.stringify(declaration.inputSchema)}.${declaration.batch ? " Batch-capable." : ""}`;
  }
  const schema = (value: z.ZodTypeAny) => JSON.stringify(zodToJsonSchema(value, { $refStrategy: "none" }));
  const created = draft ? " For automatic save from an existing create draft, supply its artifact location as call.draft {sessionId,runId,path}." : "";
  return `${summary} Call target schema ${schema(handler.targetSchema)}. Call input schema ${schema(handler.inputSchema)}. ${handler.formInstructions}${created}`;
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
    const owner = form.owner?.handler;
    if (owner?.kind !== "form.save") throw new Error(`Expected a form owner for ${form.id}`);
    const target = { kind: "object" as const, objectType: owner.targetType, primaryKey: "<object id>" };
    return { id: form.id, update: owner.draftOperation(target), create: form.draft && owner.draftOperation({ kind: "draft" }) };
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
