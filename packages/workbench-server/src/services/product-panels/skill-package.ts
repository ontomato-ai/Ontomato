import type { ComponentDeclaration } from "@ontomato/contracts/component-declaration";
import { createHash } from "node:crypto";
import { stringify } from "yaml";
import { z } from "zod";
import { skillCatalogDiagnosticsSchema } from "@ontomato/contracts/skills";
import { type RuntimeSkillRef, type StandardSkillFrontmatter } from "@ontomato/contracts/agent-runtime-skills";
import {
  panelManifestSchema, panelOperationId,
} from "@ontomato/contracts/panel-manifest";
import type { PageSkillEntrance } from "@ontomato/contracts/page-skills";
import type { PanelOperationDeclaration } from "@ontomato/contracts/panel-operations";
import { declaredCustomerFormSaveName, directReadDeclaration, projectionOperationIsRowScoped, projectionReadReference } from "@ontomato/contracts/panel-projection";
import {
  builtinProductPanelInputSchema, builtinProductProjectionInputSchema, productPanelInputSchema, productProjectionInputSchema,
  type BuiltinProductPanelInput, type BuiltinProductProjectionInput, type PanelSkillSource,
  type ProductPanelInput, type ProductProjectionInput,
} from "@ontomato/contracts/product-panels";
import { isBuiltinProductId } from "@ontomato/contracts/product-record-id";
import { SkillSourceRecordError, type ProtectedSkillOffering, type SkillSourceFailure } from "../../core/skills/providers";
import { getLocale, resolveLocale } from "../../i18n";
import { findCurrentProduct, type CurrentProductRow } from "../../infrastructure/product-current";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { readObjectActions } from "../action/panel-reads";
import { readPanelComponentCatalogue, readProjectionComponent } from "./component-catalogue";
import { boundProjectionOperations, type BoundProjectionOperation } from "./operation-bindings";
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
    ...(panel.forms.length ? ["fill live forms"] : []),
    ...(panel.operations.length ? ["review declared operations"] : []),
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

function stripLegacyPanelCommands(definition: unknown): unknown {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return definition;
  const record = definition as Record<string, unknown>;
  const manifest = record.manifest;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || !("commands" in manifest)) return definition;
  const { commands: _removed, ...restManifest } = manifest as Record<string, unknown>;
  return { ...record, manifest: restManifest };
}

function parseDefinition<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>, row: CurrentProductRow | undefined, resourceId: string, panelTitle?: string,
): T {
  if (!row) throw new SkillSourceRecordError({ resourceId, ...(panelTitle && { title: panelTitle }), reason: "record_missing" });
  const parsed = schema.safeParse(stripLegacyPanelCommands(row.definition));
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
  let actionCatalog: Promise<ReadonlyMap<string, { name: string; declaration: PanelOperationDeclaration }>> | undefined;
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
      const actions = hasActions
        ? await (actionCatalog ??= readObjectActions(reader).then(({ actions: list }) =>
          new Map(list.map(({ declaration, name }) => [declaration.id, { name, declaration }]))))
        : undefined;
      const installedIds = [...new Set(entries.map(([, projection]) => projection.componentId))]
        .filter(componentId => !sdk.components.has(componentId));
      const installed = await Promise.all(installedIds.map(async id => [id, await readProjectionComponent(id, () => Promise.resolve(sdk), scope === "platform" ? null : domainId)] as const));
      const components = new Map<string, ComponentDeclaration>(sdk.components);
      for (const [id, component] of installed) if (component) components.set(id, component);
      const description = describePanel(panel, new Map(entries), components, locale, actions);
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
        const { description, markdown, fingerprint: sourceFingerprint } = await read();
        const fixedKeys = (context?.entryInputKeys ?? []).filter(key => Object.hasOwn(description.state, key));
        if (!fixedKeys.length) {
          const manifest = panelSkillManifest(skill, description, sourceFingerprint);
          return { skill, files: [{ path: "SKILL.md", content: `---\n${stringify(manifest)}---\n\n${markdown}\n` }] };
        }
        const fixed = new Set(fixedKeys);
        const scopedState = Object.fromEntries(Object.entries(description.state).filter(([key]) => !fixed.has(key)));
        const scoped = { ...description, state: scopedState };
        const scopedFingerprint = fingerprint([sourceFingerprint, [...fixed].sort()]);
        const manifest = panelSkillManifest(skill, scoped, scopedFingerprint);
        return { skill, files: [{ path: "SKILL.md", content: `---\n${stringify(manifest)}---\n\n${describeSkill(scoped)}\n` }] };
      },
    };
  }));
}

type ActionCatalogEntry = { name: string; declaration: PanelOperationDeclaration };
type CustomerFormBinding = { objectType: string; mode: "create" | "edit" };
type PanelDescription = ReturnType<typeof describePanel>;
type OperationDescription = BoundProjectionOperation & {
  id: string;
  label: string;
  member: string;
  rowScoped: boolean;
  customerForm?: CustomerFormBinding;
};

function customerFormSaveModes(
  projection: ProjectionDefinition,
  actions: ReadonlyMap<string, ActionCatalogEntry> | undefined,
): Map<string, CustomerFormBinding> {
  const forms = new Map<string, CustomerFormBinding>();
  if (!actions || projection.componentId !== "@ontomato/sdk:ObjectForm") return forms;
  for (const [datum, mode] of [["form", "edit"], ["createForm", "create"]] as const) {
    const read = projection.data[datum];
    if (read?.read !== datum) continue;
    const type = projectionReadReference(projection, read.source);
    if (type?.kind !== "ObjectType") continue;
    const creating = mode === "create";
    const name = declaredCustomerFormSaveName(projection.operations, creating);
    if (!name) continue;
    const action = actions.get(projection.operations![name]!.operation.id)?.declaration;
    if (action?.effect === "write" && (action.target.source === "none") === creating) {
      forms.set(name, { objectType: type.id, mode });
    }
  }
  return forms;
}

function describePanel(
  panel: PanelDefinition, records: ReadonlyMap<string, ProjectionDefinition>, components: ComponentCatalogue,
  locale: string, actions: ReadonlyMap<string, ActionCatalogEntry> | undefined,
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
      const readDeclaration = directReadDeclaration(projection, read);
      if (!readDeclaration) {
        const field = safeField(["data", key, "read"]);
        throw new SkillSourceRecordError({ resourceId: projectionId, title: panel.name, field, reason: "invalid_definition" });
      }
      return [key, { ...read, result: readDeclaration.result }];
    }));
    const boundOps = boundProjectionOperations(projection);
    const customerForms = boundOps.some(bound => bound.owner?.handler.kind === "form.save")
      ? undefined
      : customerFormSaveModes(projection, actions);
    return [{
      text: `- ${member} — ${projection.name} (${projectionId}), ${projection.componentId}. ${projection.description} ${component.meaning} Inputs: ${JSON.stringify(declaration.inputs ?? {})}. Named data: ${JSON.stringify(data)}. Configuration: ${JSON.stringify(projection.config)}.`,
      reads: Object.entries(data).map(([dataName, { read, result }]) => ({ member, dataName, read, result })),
      operations: boundOps.flatMap(bound => {
        if (!bound.owner && bound.binding.operation.kind === "PlatformOperation") {
          const field = safeField(["operations", bound.name]);
          throw new SkillSourceRecordError({ resourceId: projectionId, title: panel.name, field, reason: "operation_unregistered" });
        }
        const label = bound.owner
          ? panelServerOperationLabel(bound.owner.handler, locale)
          : actions?.get(bound.binding.operation.id)?.name;
        if (label === undefined) return [];
        const customerForm = customerForms?.get(bound.name);
        return [{
          ...bound,
          id: panelOperationId(member, bound.name),
          label,
          member,
          rowScoped: projectionOperationIsRowScoped(bound.binding),
          ...(customerForm ? { customerForm } : {}),
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
    content: panel.content,
    projections,
    operations,
    forms: operations.filter(operation => operation.owner?.handler.kind === "form.save" || operation.customerForm !== undefined),
    hasPlacedMembers,
    reads: describeReads(projections.flatMap(projection => projection.reads), hasPlacedMembers),
  };
}

function describeSkill({ name, description, content, state, projections, operations, forms, reads, hasPlacedMembers }: PanelDescription): string {
  const { recipes } = content;
  return [
    `## ${name}`,
    description,
    `### Projections\n${projections.map(projection => projection.text).join("\n") || "No projections."}`,
    [
      "### State and page context",
      `The instance declares ${JSON.stringify(state)}. Member inputs above identify the state field they read.`,
      "Declared public state covers every state field that decides which business content the user sees (tabs, filters, selections, view modes). The user message's page context line, `present` receipts, and `observe_display` receipts carry the current values of all declared public state fields, the current live contents and unsaved status of open forms (`forms`, including unsaved user edits), together with selected object references (each carrying object type and ID) and highlights. Use those values directly without asking the user to repeat which tab, filter, view mode, item, or form input is open. When `observe_display` is available, you can call it mid-round at any time to re-read the latest live page state and form contents (including edits the user made during the round).",
    ].join("\n"),
    reads,
    [
      "### Open the panel and update live state",
      "When this run has the `present` tool, call `present({ target, state })` immediately in this round to navigate to the panel or update its live state — do not merely put a link in your reply and wait for the user to click.",
      "`present` navigates to the target entry as a real navigation (written to the browser address and preserved on refresh) without changing the user's side-by-side or full-page layout (opening side-by-side if no page is open). Passing `state` updates any declared public state field above in place — including fields not marked `deepLink` (such as tabs, filters, view modes, or checked lists) — without reloading the page or triggering any business write. The `present` receipt reports the actual view, all declared public state values, and any open form contents afterwards; if the initiating user lacks access to the target entry, the page does not open and the receipt returns the refusal reason.",
      "Write every platform page link in your reply as a site-relative path starting with one slash (only as a reference for the user to return to that view later). Never put a scheme, hostname, or port in a platform page link. Do not use `http://`, `https://`, `//host`, or `localhost`.",
      "Use the canonical path from the current page context. When building a reply link with deep-link state, pass each field marked `deepLink: true` as its own flat named query parameter (e.g. `?selected=my-app&tab=entries&search=foo`; omit null/default values and never serialize JSON into `?state=` or `?frame=`). Pass a single-type `object` field as its `primaryKey` directly, a multi-type `object-union` field as `className~primaryKey`, a `list` field as repeated parameters (`?tag=a&tag=b`), and application frame state as `frame.<name>=...`.",
    ].join("\n"),
    describeLiveForms(forms),
    [
      "### Declared operations and live page actions",
      ...operations.map(describeOperation),
      ...(operations.length ? [] : [hasPlacedMembers ? "No operations directly on this panel." : "No operations."]),
      "When this run has the `page_action` tool and this page is open beside the conversation, invoke declared operations directly through `page_action({ operation, memberPath?, rowKey?, input? })` so the page runs the exact same UI button/form entry a human clicks with the logged-in user's permissions. Never call a write owner endpoint directly from a platform panel skill.",
      "Use `page_action({ operation: \"page.refresh\" })` to reload displayed data or `page_action({ operation: \"<formMember>.discard\" })` to discard unsaved edits in a mounted form.",
      ...(operations.some(operation => operation.owner?.declaration.batch) ? [
        "For a batch-capable operation on checked items, first select/check the target items through declared public state (`present({ target, state })`), then invoke the batch operation with `page_action({ operation })`.",
      ] : []),
      ...(operations.some(operation => operation.rowScoped) ? [
        "For a row-scoped operation declared on a list projection, pass `rowKey` set to the loaded row's primary key (`page_action({ operation: \"<listMember>.<opName>\", rowKey, input? })`). The list verifies per-row availability and bound parameters directly on that mounted row.",
      ] : []),
      ...(hasPlacedMembers ? [
        "For an operation in a mounted nested panel, pass its `memberPath` keys (or dot-joined `operation` ID such as `preview.approve.approve`) to `page_action`. To inspect a nested panel's declared operations, send a `/read` request with `operations: true` in place of `dataName`.",
      ] : []),
      "Form save (`form.save` or a form-saving Action) submits the live form currently displayed on the page — never pass form field values in `page_action`. Fill the form with `fill_form` first, then call `page_action({ operation: \"<formSaveOperationId>\" })`. In default confirmation mode, `page_action` prepares the intent, shows the confirmation prompt in the conversation, and returns `awaiting_confirmation` with `intentId` and `questionId` while the form stays unsaved and editable. Do not wait or poll; finish the round or continue independent work. When the user confirms in the conversation, the page verifies that the instance, target, and form contents have not changed before dispatching (any edit, manual save, navigation, or reload invalidates that confirmation). In full-auto sessions, `page_action` executes immediately and returns `executed`.",
      "A dispatched result is final for that intent, including failure/unknown; never retry a write call under a new tool call when receipt is missing (`unknown`). Read the intent at `/api/panel-operation-intents/<intentId>` through `ONTOMATO_WORKBENCH_URL` when needed; this read does not execute it.",
    ].join("\n"),
    ...(recipes === undefined ? [] : [`### Recipes\n\n${recipes}`]),
  ].filter(Boolean).join("\n\n");
}

function describeOperation({ id, label, binding, owner, rowScoped, customerForm }: OperationDescription): string {
  const target = JSON.stringify(binding.target ?? null);
  const rowScope = rowScoped ? " Row-scoped operation on list rows." : "";
  const boundParams = binding.params && Object.keys(binding.params).length > 0
    ? ` Bound params: ${JSON.stringify(binding.params)}.`
    : "";
  const suffix = `${rowScope}${boundParams}`;
  if (!owner) {
    if (customerForm) {
      const read = customerForm.mode === "create" ? "createForm" : "form";
      return `- ${label} (${id}), form save via Action ${binding.operation.id}, target ${target}. Read \`${read}\` for \`${customerForm.objectType}\`, open the live form with \`present\`, fill fields with \`fill_form\`, then invoke \`page_action({ operation: "${id}" })\`.`;
    }
    if (!binding.target) {
      return `- ${label} (${id}), Action ${binding.operation.id}, target null.${suffix} No object selection is required. Invoke with \`page_action({ operation: "${id}", input? })\`.`;
    }
    return `- ${label} (${id}), Action ${binding.operation.id}, target ${target}.${suffix} Invoke with \`page_action({ operation: "${id}"${rowScoped ? ', rowKey: "<row primaryKey>"' : ""}, input? })\`.`;
  }
  const { handler, declaration } = owner;
  const summary = `- ${label} (${id}), kind ${handler.kind}, handlerRef ${handler.handlerRef}, target ${target}.${suffix}`;
  if (declaration.upload) {
    return `${summary} Takes a file the reader uploads on the page (input \`${declaration.upload.input}\`). Agents cannot upload files directly yet: ask the reader to use the page's upload control.`;
  }
  if (handler.kind !== "form.save") {
    return `${summary} Input ${JSON.stringify(declaration.inputSchema)}.${declaration.batch ? " Batch-capable." : ""}`;
  }
  return `${summary} Fill the mounted form, then invoke \`page_action({ operation: "${id}" })\` to save it.`;
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

function describeLiveForms(forms: readonly OperationDescription[]): string {
  if (!forms.length) return "";
  return [
    "### Fill a live form",
    "When this run has `present` and `fill_form`, fill the live form directly beside the conversation.",
    "1. First make sure the target page, object, tab, or create dialog is open (`present({ target, state })`) so the form member is mounted.",
    "2. Call `fill_form({ member, memberPath?, values, overwriteUnsaved? })` with explicit field paths (e.g. `{\"/name\": \"...\", \"/description\": \"...\"}` or top-level field keys). The form uses its own editing entry, highlights every changed field, runs owner-driven dynamic updates, and stays unsaved.",
    "3. If `fill_form` returns `not_filled` with `reason: \"blocked_unsaved\"`, the form already holds unsaved edits. Never overwrite them silently: ask the user in conversation whether to keep their edits or replace them, and only call `fill_form` again with `overwriteUnsaved: true` after the user confirms.",
    "4. To save the filled form, call `page_action({ operation: \"<formSaveOperationId>\" })` (or let the user click Save directly on the page).",
    ...forms.map(({ id, member, customerForm, owner }) => {
      const objectType = customerForm?.objectType ?? (owner?.handler.kind === "form.save" ? owner.handler.targetType : "");
      return `- Form member \`${member}\` (save operation \`${id}\`${objectType ? `, type \`${objectType}\`` : ""}).`;
    }),
  ].join("\n");
}
