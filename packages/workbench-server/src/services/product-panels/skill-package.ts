import { createHash } from "node:crypto";
import { stringify } from "yaml";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { type RuntimeSkillRef, type StandardSkillFrontmatter } from "@ontomato/contracts/agent-runtime-skills";
import {
  panelManifestSchema, panelOperationId, type PanelEvent, type PanelManifest, type panelEventValueSchema,
} from "@ontomato/contracts/panel-manifest";
import { PAGE_DRAFT_QUERY_KEYS } from "@ontomato/contracts/page-draft";
import type { PageSkillEntrance } from "@ontomato/contracts/page-skills";
import { directReadDeclaration } from "@ontomato/contracts/panel-projection";
import {
  builtinProductPanelInputSchema, builtinProductProjectionInputSchema, productPanelInputSchema, productProjectionInputSchema,
  type BuiltinProductPanelInput, type BuiltinProductProjectionInput, type PanelSkillSource,
  type ProductPanelInput, type ProductProjectionInput,
} from "@ontomato/contracts/product-panels";
import { isBuiltinProductId } from "@ontomato/contracts/product-record-id";
import { SkillSourceRecordError, type ProtectedSkillOffering, type SkillSourceFailure } from "../../core/skills/providers";
import { getDefaultLocale, getLocale, resolveLocale } from "../../i18n";
import { findCurrentProduct, type CurrentProductRow } from "../../infrastructure/product-current";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { readObjectActions } from "../action/panel-reads";
import { readPanelComponentCatalogue } from "./component-catalogue";
import { allowsOperationDraft, boundProjectionOperations, type BoundProjectionOperation } from "./operation-bindings";
import { panelServerOperationLabel } from "./server-operations";
import { panelSkillScope } from "./skill-identity";

type ComponentCatalogue = Awaited<ReturnType<typeof readPanelComponentCatalogue>>["components"];
type PanelDefinition = BuiltinProductPanelInput | ProductPanelInput;
type ProjectionDefinition = BuiltinProductProjectionInput | ProductProjectionInput;
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

/** Supply dependency facts before reading an admitted panel's package. */
export async function panelSkillSources(
  domainId: string, sources: readonly PanelSkillSource[], reader: AssistantCredentials,
): Promise<(ProtectedSkillOffering | SkillSourceFailure)[]> {
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
  let actionNames: Promise<ReadonlyMap<string, string>> | undefined;
  return Promise.all([...panels].map(async ([id, byEntrance]): Promise<ProtectedSkillOffering | SkillSourceFailure> => {
    const scope = panelSkillScope(id);
    const row = await findCurrentProduct(domainId, "panel", id);
    const entrances = [...byEntrance.values()];
    let dependencies: z.infer<typeof panelDependencies>;
    try {
      dependencies = parseDefinition(panelDependencies, row, id);
    } catch (error) {
      if (!(error instanceof SkillSourceRecordError)) throw error;
      const { field, reason } = error.detail;
      return { sourceKey: id, scope, entrances, knownRequiredResourceIds: [id], ...(field ? { field } : {}), reason };
    }
    const projectionIds = [...new Set(Object.values(dependencies.manifest.members)
      .flatMap(({ target }) => "projectionId" in target ? [target.projectionId] : []))];
    async function buildSnapshot() {
      const panel = parseDefinition<PanelDefinition>(scope === "platform" ? builtinProductPanelInputSchema : productPanelInputSchema, row, id);
      const [sdk, rows] = await Promise.all([
        release ??= readPanelComponentCatalogue().catch(cause => {
          throw new Error("Unable to read the current SDK component catalogue", { cause });
        }),
        Promise.all(projectionIds.map(projectionRow)),
      ]);
      const entries = projectionIds.map((projectionId, index) => {
        const schema = isBuiltinProductId(projectionId) ? builtinProductProjectionInputSchema : productProjectionInputSchema;
        return [projectionId, parseDefinition<ProjectionDefinition>(schema, rows[index], projectionId)] as const;
      });
      const locale = reader.locale ? resolveLocale(reader.locale) : getLocale();
      const hasActions = entries.some(([, projection]) =>
        Object.values(projection.operations ?? {}).some(({ operation }) => operation.kind === "Action"));
      const names = hasActions
        ? await (actionNames ??= readObjectActions(reader).then(({ actions }) =>
          new Map(actions.map(({ declaration, name }) => [declaration.id, name]))))
        : undefined;
      const description = describePanel(panel, new Map(entries), sdk.components, locale, names);
      const operationLabels = description.operations.map(({ id, label }) => [id, label]);
      return {
        description, markdown: describeSkill(description),
        fingerprint: fingerprint([id, panel, entries, sdk.version, sdk.digest, locale, operationLabels]),
      };
    }
    let snapshot: ReturnType<typeof buildSnapshot> | undefined;
    const read = () => snapshot ??= buildSnapshot();
    return {
      kind: "protected",
      sourceKey: id,
      scope,
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
}

type PanelDescription = ReturnType<typeof describePanel>;
type OperationDescription = BoundProjectionOperation & { id: string; label: string; draft: boolean };

function describePanel(
  panel: PanelDefinition, records: ReadonlyMap<string, ProjectionDefinition>, components: ComponentCatalogue,
  locale: string, actionNames: ReadonlyMap<string, string> | undefined,
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
      reads: Object.entries(data).map(([dataName, { read, result }]) => ({ member, dataName, read, result })),
      operations: boundProjectionOperations(projection).flatMap(bound => {
        if (!bound.owner && bound.binding.operation.kind === "PlatformOperation") {
          const field = safeField(["operations", bound.name]);
          throw new SkillSourceRecordError({ resourceId: projectionId, field, reason: "operation_unregistered" });
        }
        const label = bound.owner
          ? panelServerOperationLabel(bound.owner.handler, locale)
          : actionNames?.get(bound.binding.operation.id);
        if (label === undefined) return [];
        return [{
          ...bound, id: panelOperationId(member, bound.name), label,
          draft: bound.owner !== undefined && allowsOperationDraft(projection, bound.owner.handler),
        }];
      }),
    }];
  });
  const operations = projections.flatMap(projection => projection.operations);
  return {
    name: panel.name,
    description: panel.description,
    state: manifest.state,
    members: manifest.members,
    events: manifest.events,
    content: panel.content,
    projections,
    operations,
    forms: operations.filter(operation => operation.owner?.handler.kind === "form.save"),
    reads: describeReads(projections.flatMap(projection => projection.reads),
      Object.values(manifest.members).some(({ target }) => !("projectionId" in target))),
  };
}

type EventValue = z.infer<typeof panelEventValueSchema>;

function describePanelEvent(event: PanelEvent, state: PanelManifest["state"], members: PanelManifest["members"]): string {
  const { do: action, on } = event;
  const value = (source: EventValue) => {
    if ("literal" in source) return `\`${JSON.stringify(source.literal)}\``;
    if ("state" in source) return `the current value of state field \`${source.state}\``;
    if ("item" in source) return on ? "the item from the triggering member" : "the item selected in the current page context";
    return `the output value of \`${on!.member}.${on!.output}\``;
  };
  const assignments = (values: Record<string, EventValue>) =>
    Object.entries(values).map(([field, source]) => `\`${field}\` = ${value(source)}`).join(", ");

  if ("set" in action) {
    const { fields } = action.set;
    const linked = Object.fromEntries(Object.entries(fields).filter(([field]) => state[field].deepLink));
    const local = Object.keys(fields).filter(field => !state[field].deepLink);
    return [
      Object.keys(linked).length
        ? `Open the current panel's canonical address. Set ${assignments(linked)} in the URL-encoded JSON \`state\` query parameter. Keep the existing values of other deep-linkable fields and other query parameters.`
        : "",
      local.length ? `Instance-only fields ${local.map(field => `\`${field}\``).join(", ")} are changed by the panel's event on the page.` : "",
    ].filter(Boolean).join(" ");
  }
  if ("invoke" in action) {
    const { member, operation, inputs } = action.invoke;
    const input = assignments(inputs);
    return `Invoke \`${panelOperationId(member, operation)}\` as specified under Declared operations.${input ? ` Resolve these input bindings using its target and input schema. ${input}.` : ""}`;
  }

  const open = action.open;
  const input = assignments(open.inputs ?? {});
  const carryState = input ? ` For the destination's deep-linkable fields, put these values in its URL-encoded JSON \`state\` parameter. ${input}.` : "";
  if (open.mode === "entry") {
    return `Resolve the entry reference using ${value(open.entry)}. Use its \`primaryKey\` as the use ID in \`GET /api/data-query/platform/applications/resolve-entry?applicationId=<current applicationId>&useId=<entry primaryKey>\`. Open the returned \`data.use.path\`.${carryState}`;
  }
  const target = members[open.member].target;
  if ("projectionId" in target) return `Open the current panel's canonical address to reach its embedded member \`${open.member}\`.`;
  const panel = "panelId" in target ? `panel \`${target.panelId}\``
    : "fromState" in target ? `the panel selected for member \`${open.member}\` by state field \`${target.fromState}\``
      : `the panel used by member \`${open.member}\``;
  return `Find the admitted entry for ${panel} in \`GET /api/data-query/platform/applications/<current applicationId>/panel-uses\`. Open that entry's \`path\` when available. Use the current panel's canonical address for embedded content.${carryState}`;
}

function describeSkill({ name, description, content, state, members, events, projections, operations, forms, reads }: PanelDescription): string {
  const { recipes, messages } = content;
  const resolveLabel = (key: string) => messages?.[getDefaultLocale()]?.[key] ?? key;
  const declaredEvents = Object.entries(events).map(([id, event]) => {
    const label = event.labelKey ? resolveLabel(event.labelKey) : id;
    return `- ${label} (${id}). ${describePanelEvent(event, state, members)}`;
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
    ...(declaredEvents.length ? [[
      "### Panel events",
      "The names below identify panel events. The `/operate` endpoint accepts only IDs from Declared operations. Follow the address or operation given for each event.",
      ...declaredEvents,
    ].join("\n")] : []),
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
  if (!owner) return `- ${label} (${id}), Action ${binding.operation.id}, target ${target}. Read the admitted description for the actual selected object with operations:true on \`$ONTOMATO_PANEL_OPERATIONS_URL/read\` before invoking it.`;
  const { handler, declaration } = owner;
  const summary = `- ${label} (${id}), kind ${handler.kind}, handlerRef ${handler.handlerRef}, target ${target}.`;
  if (handler.kind !== "form.save") {
    return `${summary} Input ${JSON.stringify(declaration.inputSchema)}.${declaration.batch ? " Batch-capable." : ""}`;
  }
  const schema = (value: z.ZodTypeAny) => JSON.stringify(zodToJsonSchema(value, { $refStrategy: "none" }));
  const created = draft ? " For automatic save from an existing create draft, supply its artifact location as call.draft {sessionId,runId,path}." : "";
  return `${summary} Call target schema ${schema(handler.targetSchema)}. Call input schema ${schema(handler.inputSchema)}. ${handler.formInstructions}${created}`;
}

function describeReads(reads: readonly { member: string; dataName: string; read: string; result: string }[], hasPlacedMembers: boolean): string {
  if (!reads.length && !hasPlacedMembers) return "";
  return [
    "### Read current data",
    "Before answering what is on this page or what is selected, read the relevant named data below and answer from the result. Use the page context to identify the entry and selected object, then read its current data.",
    "POST to `$ONTOMATO_PANEL_OPERATIONS_URL/read` with `X-Ontomato-Callback-Credential: $ONTOMATO_EXECUTION_CALLBACK` and `X-Ontomato-Run-Id: $ONTOMATO_RUN_ID`. This calls the same named read as the panel.",
    "Send JSON `{source:{kind:\"registered\",applicationId,useId},memberPath:[{member}],dataName,inputs}`. Use the registered application and use from the page context. Supply the projection's declared inputs from that context or the requested selection. Use an empty object when no inputs are needed.",
    "A ready result carries the current owner data in `value`. Respect forbidden and error results.",
    ...(hasPlacedMembers ? [
      "A selection's `memberPath` identifies the child panel that supplied it. To inspect the mounted child's declared state and members, POST `{source,memberPath}` to `$ONTOMATO_PANEL_OPERATIONS_URL/nested` with the same callback headers.",
      "For a child member's datum, append its segment to that path for the read. Carry the actual selection on any segment that has one. For a nested operation, send its full operation ID and the same memberPath ending at its publishing projection.",
    ] : []),
    ...reads.map(({ member, dataName, read, result }) =>
      `- \`${member}.${dataName}\` — ${read} returns \`${result}\`.`),
  ].join("\n");
}

function describeDraft(forms: readonly OperationDescription[]): string {
  if (!forms.length) return "";
  const [sessionKey, runKey, pathKey] = PAGE_DRAFT_QUERY_KEYS;
  const owners = forms.map(form => {
    const owner = form.owner?.handler;
    if (owner?.kind !== "form.save") throw new Error(`Expected a form owner for ${form.id}`);
    const target = { kind: "object" as const, objectType: owner.targetType, primaryKey: "<object id>" };
    return { id: form.id, update: owner.draftOperation(target), create: form.draft && owner.draftOperation({ kind: "draft" }) };
  });
  return [
    "### Draft a change",
    "Read the owner's form for the intended target. Follow that form-save operation's drafting instructions under Declared operations to choose and validate the values in `form`. Write `outputs/drafts/<name>.page-draft.json` with this envelope.",
    "```json",
    JSON.stringify({ pageKey: "<current page context pageKey>", operation: owners[0]!.update, target: { id: "<object id>" }, form: {} }, null, 2),
    "```",
    ...owners.map(owner => `- ${owner.id} uses \`${owner.update}\` for an existing object.${owner.create ? ` Use \`${owner.create}\` with an empty target for creation.` : ""}`),
    "Put the selected object's ID in `target.id` when editing an existing object.",
    "An owner's revision, when required, is part of the operation input.",
    "Each run has its own artifact area. Use a distinct path for each draft written in the same run.",
    `Link to the canonical path from the current page context. Set \`${sessionKey}\` to the producing run's \`$ONTOMATO_SESSION_ID\`, \`${runKey}\` to that run's \`$ONTOMATO_RUN_ID\`, and \`${pathKey}\` to the encoded path of its draft file. For a draft written in a later run, build a new link using that run's ID. The panel fills the form for the reader to review and save.`,
  ].join("\n");
}
