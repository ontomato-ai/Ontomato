import type { ComponentDeclaration } from "@ontomato/contracts/component-declaration";
import { z } from "zod";
import { skillCatalogDiagnosticsSchema } from "@ontomato/contracts/skills";
import { panelManifestSchema, panelOperationId } from "@ontomato/contracts/panel-manifest";
import type { PanelOperationDeclaration } from "@ontomato/contracts/panel-operations";
import { declaredCustomerFormSaveName, directReadDeclaration, projectionOperationIsRowScoped, projectionReadReference } from "@ontomato/contracts/panel-projection";
import {
  builtinProductPanelInputSchema, builtinProductProjectionInputSchema, productPanelInputSchema, productProjectionInputSchema,
  type BuiltinProductPanelInput, type BuiltinProductProjectionInput,
  type ProductPanelInput, type ProductProjectionInput,
} from "@ontomato/contracts/product-panels";
import { isBuiltinProductId } from "@ontomato/contracts/product-record-id";
import { SkillSourceRecordError } from "../../core/skills/providers";
import { getLocale, resolveLocale } from "../../i18n";
import type { CurrentProductRow } from "../../infrastructure/product-current";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { readObjectActions } from "../action/panel-reads";
import { readPanelComponentCatalogue, readProjectionComponent } from "./component-catalogue";
import { boundProjectionOperations, type BoundProjectionOperation } from "./operation-bindings";
import { panelServerOperationLabel } from "./server-operations";
import { requireCurrentProduct } from "./current";
import { inputLinkDescriptions, operationInputSuffix } from "./page-description-format";
import type { AssistantOwner } from "../assistant/store";

type ComponentCatalogue = ReadonlyMap<string, ComponentDeclaration>;
type PanelDefinition = BuiltinProductPanelInput | ProductPanelInput;
type ProjectionDefinition = BuiltinProductProjectionInput | ProductProjectionInput;

/** The admitted entrance facts repeated inside one freshly generated page description. */
export type PageDescriptionEntrance = {
  applicationId: string;
  useId: string;
  path: string;
  names: Record<string, string>;
  applicationNames?: Record<string, string>;
};

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

/**
 * Generate the description of one admitted panel entrance from the current panel, projection, component and operation
 * definitions. This is a run-time document for the agent: it is neither stored nor exposed as a skill identity.
 * The owner checks here are the ordinary panel/projection USE checks; entry admission happens before the caller gets here.
 */
export async function generatePanelPageDescription(
  owner: AssistantOwner,
  reader: AssistantCredentials,
  panelId: string,
  entrance: PageDescriptionEntrance,
  entryInputKeys: readonly string[] = [],
): Promise<string> {
  const panelRow = await requireCurrentProduct(owner, reader, "panel", panelId, "use");
  const dependencies = parseDefinition(panelDependencies, panelRow, panelId);
  const projectionIds = [...new Set(Object.values(dependencies.manifest.members)
    .flatMap(({ target }) => "projectionId" in target ? [target.projectionId] : []))];
  const projectionRows = await Promise.all(projectionIds.map(id => requireCurrentProduct(owner, reader, "projection", id, "use")));
  const panel = parseDefinition<PanelDefinition>(isBuiltinProductId(panelId) ? builtinProductPanelInputSchema : productPanelInputSchema,
    panelRow, panelId);
  const sdk = await readPanelComponentCatalogue().catch(cause => {
    throw new Error("Unable to read the current SDK component catalogue", { cause });
  });
  const entries = projectionIds.map((projectionId, index) => {
    const schema = isBuiltinProductId(projectionId) ? builtinProductProjectionInputSchema : productProjectionInputSchema;
    return [projectionId, parseDefinition<ProjectionDefinition>(schema, projectionRows[index], projectionId, panel.name)] as const;
  });
  const locale = reader.locale ? resolveLocale(reader.locale) : getLocale();
  const hasActions = entries.some(([, projection]) =>
    Object.values(projection.operations ?? {}).some(({ operation }) => operation.kind === "Action"));
  const actions = hasActions
    ? await readObjectActions(reader).then(({ actions: list }) =>
      new Map(list.map(({ declaration, name }) => [declaration.id, { name, declaration }])))
    : undefined;
  const installedIds = [...new Set(entries.map(([, projection]) => projection.componentId))]
    .filter(componentId => !sdk.components.has(componentId));
  const installed = await Promise.all(installedIds.map(async id => [
    id,
    await readProjectionComponent(id, () => Promise.resolve(sdk), {
      domainId: isBuiltinProductId(panelId) ? null : owner.domainId,
      credentials: reader,
    }),
  ] as const));
  const components = new Map<string, ComponentDeclaration>(sdk.components);
  for (const [id, component] of installed) if (component) components.set(id, component);
  const description = describePanel(panel, new Map(entries), components, locale, actions);
  const fixed = new Set(entryInputKeys.filter(key => Object.hasOwn(description.state, key)));
  const scoped = { ...description, state: Object.fromEntries(Object.entries(description.state).filter(([key]) => !fixed.has(key))) };
  return describeSkill(scoped, [entrance], locale);
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
    const customerForms = customerFormSaveModes(projection, actions);
    const detail = projection.description.trim();
    const inputLinks = inputLinkDescriptions(declaration.inputs);
    return [{
      text: `- ${member} — ${projection.name} (${projectionId}), ${projection.componentId}.${detail ? ` ${detail}` : ""}${inputLinks.length ? ` Input links: ${inputLinks.join(", ")}.` : ""}`,
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

function localizedName(names: PageDescriptionEntrance["names"], locale: string) {
  return names[locale] ?? names.en ?? Object.values(names)[0];
}

function describeEntrances(sources: readonly PageDescriptionEntrance[], locale: string): string {
  const heading = "### Available entrances";
  if (!sources.length) return `${heading}\nThe initiating user has no registered entrance for this panel.`;
  return [
    heading,
    'Even when no page is open beside the conversation, call `present({ target: "<path>" })` with a target below to open that entrance beside the conversation.',
    ...sources.map(({ names, applicationNames, path, applicationId, useId }) => {
      const name = localizedName(names, locale);
      const applicationName = applicationNames && localizedName(applicationNames, locale);
      const label = applicationName && applicationName !== name ? `${name} (${applicationName})` : name;
      const source = { kind: "registered", applicationId, useId };
      return `- ${label} · target: \`${path}\` · /read source: \`${JSON.stringify(source)}\``;
    }),
  ].join("\n");
}

function describeSkill(
  { name, description, content, state, projections, operations, forms, reads, hasPlacedMembers }: PanelDescription,
  available: readonly PageDescriptionEntrance[], locale: string,
): string {
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
    describeEntrances(available, locale),
    reads,
    ...(hasPlacedMembers ? [[
      "### Address a nested panel",
      'Use the object segments from the display snapshot to address the mounted child. A fixed child uses `{member:"preview"}` with no `selection`. For a child selected from state, use the declared object reference and resolved target, for example `{member:"preview",selection:{stateValue:{className:"platform:ProductPanel",primaryKey:"order-preview"},target:{panelId:"order-preview"}}}` when the member permits that panel.',
      'For `/nested`, send the path to the child, for example `[{member:"preview"},{member:"details"}]` for two fixed children. For `/read`, append the member for the named data projection, for example `{member:"summary"}`. A terminal `objectDetail` selection may omit `selection.target` only in `/nested`. Omit `itemKey` from every segment in both requests. The `/read` schema rejects it and `/nested` rejects it during path resolution.',
      'For `fill_form` and `page_action`, take each segment\'s `member` string in order. In the example use `fill_form({ member: "form", memberPath: ["preview", "details"], values: { "/name": "Updated name" } })`, then, if asked to save, `page_action({ operation: "form.save", memberPath: ["preview", "details"] })`. Here `form` is the local form member in the child. Omit `memberPath` for tools acting in the root panel.',
    ].join("\n")] : []),
    [
      "### Open the panel and update live state",
      "When this run has the `present` tool, call `present({ target, state })` immediately in this round to navigate to the panel or update its live state — do not merely put a link in your reply and wait for the user to click.",
      "`present` navigates to the target entry as a real navigation (written to the browser address and preserved on refresh) without changing the user's side-by-side or full-page layout (opening side-by-side if no page is open). Passing `state` updates any declared public state field above in place — including fields not marked `deepLink` (such as tabs, filters, view modes, or checked lists) — without reloading the page or triggering any business write. The `present` receipt reports the actual view, all declared public state values, and any open form contents afterwards; if the initiating user lacks access to the target entry, the page does not open and the receipt returns the refusal reason.",
      "Write every platform page link in your reply as a site-relative path starting with one slash (only as a reference for the user to return to that view later). Never put a scheme, hostname, or port in a platform page link. Do not use `http://`, `https://`, `//host`, or `localhost`.",
      "Use a canonical `target` under Available entrances, or reuse the path from the current page context when that entrance is already open. When building a reply link with deep-link state, pass each field marked `deepLink: true` as its own flat named query parameter (e.g. `?selected=my-app&tab=entries&search=foo`; omit null/default values and never serialize JSON into `?state=` or `?frame=`). Pass a single-type `object` field as its `primaryKey` directly, a multi-type `object-union` field as `className~primaryKey`, a `list` field as repeated parameters (`?tag=a&tag=b`), and application frame state as `frame.<name>=...`.",
    ].join("\n"),
    describeLiveForms(forms),
    [
      "### Declared operations and live page actions",
      ...operations.map(describeOperation),
      ...(operations.length ? [] : [hasPlacedMembers ? "No operations directly on this panel." : "No operations."]),
      "When this run has the `page_action` tool and this page is open beside the conversation, invoke declared operations directly through `page_action({ operation, memberPath?, rowKey?, input? })` so the page runs the exact same UI button/form entry a human clicks with the logged-in user's permissions. Never call a write owner endpoint directly when a declared page operation exists.",
      "Use `page_action({ operation: \"page.refresh\" })` to reload displayed data or `page_action({ operation: \"<formMember>.discard\" })` to discard unsaved edits in a mounted form.",
      ...(operations.some(operation => operation.owner?.declaration.batch) ? [
        "For a batch-capable operation on checked items, first select/check the target items through declared public state (`present({ target, state })`), then invoke the batch operation with `page_action({ operation })`.",
      ] : []),
      ...(operations.some(operation => operation.rowScoped) ? [
        "For a row-scoped operation declared on a list projection, pass the full `<className>:<primaryKey>` row key as `rowKey` (for example, `platform:ApplicationPanelUse:<id>`). Copy the full key verbatim from the corresponding row in the page snapshot. A bare primary key omits the class name. The list verifies per-row availability and bound parameters directly on that mounted row.",
      ] : []),
      ...(hasPlacedMembers ? [
        "To inspect a nested panel's declared operations, send a `/read` request with `operations: true` in place of `dataName`.",
      ] : []),
      "Form save (`form.save` or a form-saving Action) submits the live form currently displayed on the page — never pass form field values in `page_action`. Fill the form with `fill_form` first, then call `page_action({ operation: \"<formSaveOperationId>\" })`. In default confirmation mode, `page_action` prepares the intent, shows the confirmation prompt in the conversation, and returns `awaiting_confirmation` with `intentId` and `questionId` while the form stays unsaved and editable. Do not wait or poll; finish the round or continue independent work. When the user confirms in the conversation, the page verifies that the instance, target, and form contents have not changed before dispatching (any edit, manual save, navigation, or reload invalidates that confirmation). In full-auto sessions, `page_action` executes immediately and returns `executed`.",
    ].join("\n"),
    [
      "### Recover a missing operation receipt",
      "If a receipt is missing (`unknown`) and you have its `intentId`, send `GET ${ONTOMATO_WORKBENCH_URL%/}/api/panel-operation-intents/<intentId>` with no query parameters. In particular omit `applicationId` and `useId`, which select the confirmation preparation response and can return 409 after dispatch.",
      "When `ONTOMATO_WORKBENCH_URL` is the service root, send `tk: $ONTOMATO_TK` or `X-API-Key: $ONTOMATO_API_KEY`, whichever the runtime supplied. When it is the run callback base (`…/api/assistant/executions/<runId>/workbench`), send `X-Ontomato-Callback-Credential: $ONTOMATO_EXECUTION_CALLBACK` and `X-Ontomato-Run-Id: $ONTOMATO_RUN_ID`.",
      "Read `outcome.kind`: `success` carries `data` and may include `affected` objects, `refusal` or `failure` carries `code` and `message`, `unknown` has no authoritative result, and `batch` carries each target's outcome in `items`. A batch item with `kind: skipped` was unavailable and carries the owner's `reason`.",
      "With `outcome: null`, `invalidated.code` and `invalidated.message` explain cancellation or staleness. `kind: \"confirmation-expired\"` means the confirmation expired. Otherwise `dispatched: false` means the intent has yet to be dispatched (`source.questionId` identifies the conversation confirmation when present). `dispatched: true` with a null outcome means dispatch was claimed and its result is still unrecorded.",
      "This lookup is read-only. Without an `intentId`, report that you cannot look up the result by ID. Do not poll for confirmation, dispatch the intent yourself, or repeat the write to recover the receipt.",
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
    return `- ${label} (${id}), Action ${binding.operation.id}, target ${target}.${suffix} Invoke with \`page_action({ operation: "${id}"${rowScoped ? ", rowKey" : ""}, input? })\`.`;
  }
  const { handler, declaration } = owner;
  const summary = `- ${label} (${id}), kind ${handler.kind}, handlerRef ${handler.handlerRef}, target ${target}.${suffix}`;
  if (declaration.upload) {
    return `${summary} Takes a file the reader uploads on the page (input \`${declaration.upload.input}\`). Agents cannot upload files directly yet: ask the reader to use the page's upload control.`;
  }
  if (handler.kind !== "form.save") {
    return `${summary}${operationInputSuffix(declaration.inputSchema)}${declaration.batch ? " Batch-capable." : ""}`;
  }
  return `${summary} Fill the mounted form, then invoke \`page_action({ operation: "${id}" })\` to save it.`;
}

function describeReads(reads: readonly { member: string; dataName: string; read: string; result: string }[], hasPlacedMembers: boolean): string {
  if (!reads.length && !hasPlacedMembers) return "";
  return [
    "### Read current data",
    "Before answering what is on this page or what is selected, read the relevant named data below and answer from the result. Use the page context to identify the entry and selected object, then read its current data.",
    "Use `node /skills/ontomato-page-operator/client.mjs read '<json>'`. The JSON shape is `{source:{kind:\"registered\",applicationId,useId},memberPath:[{member}],dataName,inputs}`; copy the registered source, member path, exact Named data key, and declared inputs from this description or current page context.",
    "A ready result carries the current owner data in `value`. If the result is forbidden, check the current entry and member path. For an error, use its message to correct the request. If the read still fails or remains forbidden, tell the user that the page data could not be read and give the reason; never substitute data from another endpoint, prior knowledge, or a guess as the page's current data. If a data scope is configured for your agent, a successful read includes only data inside that scope; say the result is within that configured scope and do not present it as the unrestricted page total.",
    ...(hasPlacedMembers ? [
      "A selection's `memberPath` identifies the child panel that supplied it. To inspect the mounted child's declared state and members, POST `{source,memberPath}` to `$ONTOMATO_PANEL_OPERATIONS_URL/nested` with the same callback headers.",
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
