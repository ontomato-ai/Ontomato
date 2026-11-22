import type { ComponentDeclaration } from "@ontomato/contracts/component-declaration";
import { createHash } from "node:crypto";
import { stringify } from "yaml";
import { z } from "zod";
import { skillCatalogDiagnosticsSchema } from "@ontomato/contracts/skills";
import { type RuntimeSkillRef, type StandardSkillFrontmatter } from "@ontomato/contracts/agent-runtime-skills";
import {
  panelManifestSchema, panelOperationId, type PanelCommand, type PanelManifest, type PanelMemberInput,
} from "@ontomato/contracts/panel-manifest";
import { draftTarget, PAGE_DRAFT_QUERY_KEYS, type PageDraftObjectRef } from "@ontomato/contracts/page-draft";
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
import { cachedZodToJsonSchemaString } from "../../utils/zod-json-schema";
import { readObjectActions } from "../action/panel-reads";
import { readPanelComponentCatalogue, readProjectionComponent } from "./component-catalogue";
import { allowsOperationDraft, boundProjectionOperations, type BoundProjectionOperation } from "./operation-bindings";
import { panelServerOperationLabel } from "./server-operations";
import { panelSkillScope } from "./skill-identity";

type ComponentCatalogue = ReadonlyMap<string, ComponentDeclaration>;
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
    ...(panel.operations.length || Object.keys(panel.commands).length ? ["review declared operations"] : []),
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
  schema: z.ZodType<T, z.ZodTypeDef, unknown>, row: CurrentProductRow | undefined, resourceId: string, panelTitle?: string,
): T {
  if (!row) throw new SkillSourceRecordError({ resourceId, ...(panelTitle && { title: panelTitle }), reason: "record_missing" });
  const parsed = schema.safeParse(row.definition);
  if (parsed.success) return parsed.data;
  let issue = parsed.error.issues[0]!;
  if (issue.code === z.ZodIssueCode.invalid_union && issue.path.length === 0) {
    const choices = issue.unionErrors;
    issue = choices.reduce((best, choice) => choice.issues.length < best.issues.length ? choice : best).issues[0]!;
  }
  const field = safeField(issue.path);
  const title = skillCatalogDiagnosticsSchema.shape.items.element.shape.title.safeParse(panelTitle ?? row.definition.name);
  throw new SkillSourceRecordError({
    resourceId, ...(title.success && title.data && { title: title.data }), ...(field && { field }), reason: "invalid_definition",
  });
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
        return [projectionId, parseDefinition<ProjectionDefinition>(schema, rows[index], projectionId, panel.name)] as const;
      });
      const locale = reader.locale ? resolveLocale(reader.locale) : getLocale();
      const hasActions = entries.some(([, projection]) =>
        Object.values(projection.operations ?? {}).some(({ operation }) => operation.kind === "Action"));
      const names = hasActions
        ? await (actionNames ??= readObjectActions(reader).then(({ actions }) =>
          new Map(actions.map(({ declaration, name }) => [declaration.id, name]))))
        : undefined;
      const installedIds = [...new Set(entries.map(([, projection]) => projection.componentId))]
        .filter(componentId => !sdk.components.has(componentId));
      const installed = await Promise.all(installedIds.map(async id => [id, await readProjectionComponent(id, () => Promise.resolve(sdk), scope === "platform" ? null : domainId)] as const));
      const components = new Map<string, ComponentDeclaration>(sdk.components);
      for (const [id, component] of installed) if (component) components.set(id, component);
      const description = describePanel(panel, new Map(entries), components, locale, names);
      const operationLabels = description.operations.map(({ id, label }) => [id, label]);
      return {
        description, markdown: describeSkill(description),
        fingerprint: fingerprint([id, panel, entries, sdk.version, sdk.digest, locale, operationLabels, ...installed]),
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
      async provide(skill, context) {
        let { description, markdown, fingerprint: sourceFingerprint } = await read();
        if (context) {
          const bound = new Set(context.entryInputKeys);
          const commands = Object.entries(description.commands);
          const visible = commands.filter(([, { do: action }]) =>
            !("set" in action && Object.keys(action.set.fields).some(field => bound.has(field))));
          if (visible.length !== commands.length) {
            description = { ...description, commands: Object.fromEntries(visible) };
            markdown = describeSkill(description);
            sourceFingerprint = fingerprint([sourceFingerprint, Object.keys(description.commands)]);
          }
        }
        const manifest = panelSkillManifest(skill, description, sourceFingerprint);
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
      throw new SkillSourceRecordError({ resourceId: projectionId, title: panel.name, field: "componentId", reason: "component_missing" });
    const data = Object.fromEntries(Object.entries(projection.data).map(([key, read]) => {
      const declaration = directReadDeclaration(projection, read);
      if (!declaration) {
        const field = safeField(["data", key, "read"]);
        throw new SkillSourceRecordError({ resourceId: projectionId, title: panel.name, field, reason: "invalid_definition" });
      }
      return [key, { ...read, result: declaration.result }];
    }));
    return [{
      text: `- ${member} — ${projection.name} (${projectionId}), ${projection.componentId}. ${projection.description} ${component.meaning} Inputs: ${JSON.stringify(declaration.inputs ?? {})}. Named data: ${JSON.stringify(data)}. Configuration: ${JSON.stringify(projection.config)}.`,
      reads: Object.entries(data).map(([dataName, { read, result }]) => ({ member, dataName, read, result })),
      operations: boundProjectionOperations(projection).flatMap(bound => {
        if (!bound.owner && bound.binding.operation.kind === "PlatformOperation") {
          const field = safeField(["operations", bound.name]);
          throw new SkillSourceRecordError({ resourceId: projectionId, title: panel.name, field, reason: "operation_unregistered" });
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
  const hasPlacedMembers = Object.values(manifest.members).some(({ target }) => !("projectionId" in target));
  return {
    name: panel.name,
    description: panel.description,
    state: manifest.state,
    members: manifest.members,
    commands: manifest.commands,
    content: panel.content,
    projections,
    operations,
    forms: operations.filter(operation => operation.owner?.handler.kind === "form.save"),
    hasPlacedMembers,
    reads: describeReads(projections.flatMap(projection => projection.reads), hasPlacedMembers),
  };
}

function describePanelCommand(command: PanelCommand, members: PanelManifest["members"]): string {
  const action = command.do;
  const value = (source: PanelMemberInput) => {
    if ("literal" in source) return `\`${JSON.stringify(source.literal)}\``;
    if ("state" in source) return `the current value of state field \`${source.state}\``;
    return "the item selected in the current page context";
  };
  const assignments = (values: Record<string, PanelMemberInput>) =>
    Object.entries(values).map(([field, source]) => `\`${field}\` = ${value(source)}`).join(", ");

  if ("set" in action) {
    return `Open the current panel's canonical address. Set ${assignments(action.set.fields)} in the URL-encoded JSON \`state\` query parameter. Keep the existing values of other deep-linkable fields and other query parameters.`;
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

function describeSkill({ name, description, content, state, members, commands, projections, operations, forms, reads, hasPlacedMembers }: PanelDescription): string {
  const { recipes, messages } = content;
  const resolveLabel = (key: string) => messages?.[getDefaultLocale()]?.[key] ?? key;
  const declaredCommands = Object.entries(commands).map(([id, command]) =>
    `- ${resolveLabel(command.labelKey)} (${id}). ${describePanelCommand(command, members)}`);
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
      "Write every platform page link in your reply as a site-relative path starting with one slash. Never put a scheme, hostname, or port in a platform page link. Do not use `http://`, `https://`, `//host`, or `localhost`.",
      "Use the canonical path from the current page context. To restore a selection, set the `state` query parameter to URL-encoded JSON containing only fields marked deepLink. Object references carry className and primaryKey.",
    ].join("\n"),
    describeDraft(forms),
    ...(declaredCommands.length ? [[
      "### Panel commands",
      "Follow the address or operation given for each command. The `/operate` endpoint accepts only IDs from Declared operations.",
      ...declaredCommands,
    ].join("\n")] : []),
    [
      "### Declared operations",
      ...operations.map(describeOperation),
      ...(operations.length ? [] : [hasPlacedMembers ? "No operations directly on this panel." : "No operations."]),
      "Call the declared operation with POST `$ONTOMATO_PANEL_OPERATIONS_URL/operate`, JSON `{intentId:<new UUID>,applicationId,useId,operationId,call:{target,input}}`. Send `X-Ontomato-Callback-Credential: $ONTOMATO_EXECUTION_CALLBACK` and `X-Ontomato-Run-Id: $ONTOMATO_RUN_ID`. Never call a write owner endpoint directly from a platform panel skill.",
      ...(operations.some(operation => operation.owner?.declaration.batch) ? [
        "For an operation marked as batch-capable, use `calls:[{target,input},...]` in place of `call`. Submit all concrete targets and their inputs under one intent for one confirmation. A batch result reports the owner's outcome for each item when available.",
      ] : []),
      "Use the applicationId and useId from the current page context. For a local operation, use the operationId listed above. If the host did not provide a current use, ask the reader to open the panel before attempting a panel operation.",
      ...(hasPlacedMembers ? [
        "For an operation in a mounted child, use the root entry and the full `memberPath` ending at the projection that declares the operation. To get its local operation names and descriptions, send the corresponding `/read` request with `operations:true` in place of `dataName`.",
        "Send that `memberPath` in `/operate`. Build `operationId` by joining each segment's `member` and then the local operation name with dots. With `memberPath: [previewSegment,{member:\"approve\"}]`, where previewSegment has member preview and its actual selection, the local operation approve gives `operationId: \"preview.approve.approve\"`.",
      ] : []),
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
  if (declaration.upload) {
    return `${summary} Takes a file the reader uploads on the page (input \`${declaration.upload.input}\`). Agents cannot upload files directly yet: ask the reader to use the page's upload control.`;
  }
  if (handler.kind !== "form.save") {
    return `${summary} Input ${JSON.stringify(declaration.inputSchema)}.${declaration.batch ? " Batch-capable." : ""}`;
  }
  const schema = (value: z.ZodTypeAny) => cachedZodToJsonSchemaString(value, { $refStrategy: "none" });
  const created = draft ? " For automatic save from an existing create draft, supply its artifact location as call.draft {sessionId,runId,path}." : "";
  return `${summary} Call target schema ${schema(handler.targetSchema)}. Call input schema ${schema(handler.inputSchema)}. ${handler.formInstructions}${created}`;
}

function describeReads(reads: readonly { member: string; dataName: string; read: string; result: string }[], hasPlacedMembers: boolean): string {
  if (!reads.length && !hasPlacedMembers) return "";
  return [
    "### Read current data",
    "Before answering what is on this page or what is selected, read the relevant named data below and answer from the result. Use the page context to identify the entry and selected object, then read its current data.",
    "POST to `$ONTOMATO_PANEL_OPERATIONS_URL/read` with `X-Ontomato-Callback-Credential: $ONTOMATO_EXECUTION_CALLBACK` and `X-Ontomato-Run-Id: $ONTOMATO_RUN_ID`. This calls the same named read as the panel.",
    "Send JSON `{source:{kind:\"registered\",applicationId,useId},memberPath:[{member}],dataName,inputs}`. Use the registered application and use from the page context. Use the exact key under the projection's Named data as `dataName`, without a member prefix. Supply the projection's declared inputs from that context or the requested selection. Use an empty object when no inputs are needed.",
    "A ready result carries the current owner data in `value`. If the result is forbidden, check the current entry and member path. For an error, use its message to correct the request.",
    ...(hasPlacedMembers ? [
      "A selection's `memberPath` identifies the child panel that supplied it. To inspect the mounted child's declared state and members, POST `{source,memberPath}` to `$ONTOMATO_PANEL_OPERATIONS_URL/nested` with the same callback headers.",
      "Append the child projection's member to that path. Keep the actual selection on each segment that has one. For example, if previewSegment has member preview and its selection, read the child detail projection with `memberPath: [previewSegment,{member:\"detail\"}]` and `dataName: \"record\"`.",
    ] : []),
    ...reads.map(({ member, dataName, read, result }) =>
      `- Member \`${member}\`, dataName \`${dataName}\` — ${read} returns \`${result}\`.`),
  ].join("\n");
}

function describeDraft(forms: readonly OperationDescription[]): string {
  if (!forms.length) return "";
  const [sessionKey, runKey, pathKey] = PAGE_DRAFT_QUERY_KEYS;
  const examples = forms.map(form => {
    const owner = form.owner?.handler;
    if (owner?.kind !== "form.save") throw new Error(`Expected a form owner for ${form.id}`);
    const { targetType: objectType } = owner;
    const example = (target: PageDraftObjectRef) => {
      const effective = draftTarget({ target });
      const operation = owner.draftOperation(effective.kind === "create"
        ? { kind: "draft" }
        : { kind: "object", objectType: effective.objectType, primaryKey: effective.id });
      return { operation, target };
    };
    return {
      id: form.id,
      edit: example({ objectType, id: "<owner object id>" }),
      create: form.draft ? example({ objectType }) : undefined,
    };
  });
  return [
    "### Draft a change",
    "Read the owner's form for the intended target. Follow that form-save operation's drafting instructions under Declared operations to choose and validate the values in `form`. Write `outputs/drafts/<name>.page-draft.json` with this envelope, using the operation and target given for your form below.",
    "```json",
    JSON.stringify({ pageKey: "<current page context pageKey>", ...examples[0]!.edit, form: {} }, null, 2),
    "```",
    ...examples.map(({ id, edit, create }) =>
      `- Form \`${id}\`. For editing, use \`${JSON.stringify(edit)}\`.${create ? ` For creation, use \`${JSON.stringify(create)}\`.` : ""}`),
    "Use field names and nested JSON in `form`. Field paths such as `/className` locate values but are not keys in the draft.",
    "For an edit, copy the selected object's opaque ID from its owner into `target.id`. For creation, `target` contains only `objectType`.",
    "An owner's revision, when required, is part of the operation input.",
    "Write each draft to a fresh output path. After the write succeeds, in the same shell call run `test -s \"$ONTOMATO_OUTPUT_DIR/drafts/<name>.page-draft.json\" && printenv ONTOMATO_SESSION_ID ONTOMATO_RUN_ID`, substituting the actual filename. Before sharing the link, check that this is the file you just wrote and use the IDs printed by that call.",
    `Set \`${sessionKey}\` and \`${runKey}\` from those runtime-injected IDs. Never copy a run ID from the conversation, a previous link, or an earlier run. Use the current page context's canonical path as a site-relative address starting with a single \`/\` (for example, \`/ontology/assets/actions\`) and preserve the entry's existing query parameters. Do not prefix it with \`$ONTOMATO_BASE_URL\`, a hostname, or a URL scheme.`,
    `The raw value of \`${pathKey}\` is the draft file's path relative to the producing run's artifact area. It starts with \`outputs/drafts/\` and has no leading \`/\`. URL-encode that value exactly once when adding it to the query.`,
    `Use \`?${sessionKey}=SESSION_ID&${runKey}=RUN_ID&${pathKey}=outputs%2Fdrafts%2Fedit.page-draft.json\` for an \`edit.page-draft.json\` draft. Replace \`SESSION_ID\` and \`RUN_ID\` with the producing run's actual session and run IDs. The panel fills the form for the reader to review and save.`,
    "In your final reply, the draft link must be a Markdown link with a destination that starts with a single slash. Never put a scheme, hostname, port, or `localhost` in the draft link. Use the draft file path only inside `draftPath`. A standalone file link opens a JSON file card.",
    `Example reply: [Open the draft](/ontology/applications?${sessionKey}=SESSION_ID&${runKey}=RUN_ID&${pathKey}=outputs%2Fdrafts%2Fedit.page-draft.json). Use your current entry path and the producing run's IDs, and preserve its existing query parameters.`,
  ].join("\n");
}
