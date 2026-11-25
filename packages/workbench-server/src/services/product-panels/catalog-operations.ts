import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  applicationCatalogueCreateSchema, applicationEntriesUpdateSchema, applicationIdentityUpdateSchema,
} from "@ontomato/contracts/application-catalogue";
import { localizedApplicationText } from "@ontomato/contracts/application-metadata";
import { runtimeJsonObjectSchema, type RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { panelFormTargetSchema, panelObjectIdentitySchema } from "@ontomato/contracts/panel-manifest";
import {
  panelFormObjectAllFields, panelFormSaveInputSchema,
  type PanelFormDescription, type PanelFormField,
} from "@ontomato/contracts/panel-projection";
import {
  changeProductDomainGrantRequestSchema, changeProductGrantRequestSchema,
  changeProductPanelDomainGrantResponseSchema, productGrantChangeResponseSchema,
} from "@ontomato/contracts/product-governance";
import {
  METRIC_CHART_COMPONENT, applicationPanelUseSchema, copyProductCurrentRequestSchema, deleteProductCurrentQuerySchema, deleteProductCurrentResponseSchema,
  deleteProductPanelQuerySchema, deleteProductPanelResponseSchema, productCurrentIdParamsSchema,
  registerProductPanelRequestSchema, registerProductProjectionRequestSchema,
} from "@ontomato/contracts/product-panels";
import { APPLICATION, APPLICATION_PANEL_USE, OBJECT_TYPE, PRODUCT_PANEL, PRODUCT_PROJECTION, RESET_HOME_PANEL, SET_HOME_PANEL } from "@ontomato/contracts/platform-object-types";
import { saveHomePanel } from "../platform-home/service";
import { HttpError } from "../../utils/errors";
import { BackendResponseError } from "../../utils/backend-client";
import { createLogger } from "../../logging/logger";
import { tForLocale } from "../../i18n";
import { changeProductDomainGrant, changeProductGrant } from "../product-governance/grants";
import { defaultAgentSchema } from "@ontomato/contracts/default-agent";
import { applicationCatalogueClient, applicationDraftIdSchema } from "./application-catalogue";
import {
  changeCurrentProductDomainGrant, changeCurrentProductGrant, copyCurrentProduct, currentProductUsedBy, deleteCurrentProduct, readCataloguePanel,
} from "./catalog";
import { readCurrentPanel, readCurrentPanelLabel, readCurrentProjection, requireCurrentProduct, saveCurrentPanel, saveCurrentProjection } from "./current";
import { applySubmittedFields } from "./submitted-form-values";
import { createProductPanelReadAdapter, createProductProjectionReadAdapter } from "./catalog-reads";
import { ownerEnvelopeSchema, ownerWriteFailure } from "./data-query-operations";
import type { PanelImpactInspector, PanelOperationHost, PanelRecordTarget, PanelWriteServerOperation, SinglePanelOperationOutcome } from "./server-operations";

const savedId = productCurrentIdParamsSchema;
const noData = z.object({}).strict();
const grantInput = changeProductGrantRequestSchema.omit({ remove: true });
const chartMetadata = registerProductProjectionRequestSchema.options[1].omit({ revision: true }).strip();
type OutcomeData = Record<string, RuntimeJsonValue>;

/** The fields of the form the values came from, as its owner declares them. */
type FormFields = () => Promise<PanelFormDescription["fields"]>;

/** Values a caller sent that do not fit; `write` answers in the reader's language and logs the issues. */
class InputRefusal extends Error {
  constructor(readonly issues: z.ZodIssue[], readonly fields?: FormFields) { super("The input does not fit"); }
}

/** The operation's own request: a misfit is the caller's mistake, said generally. */
function writeInput<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new InputRefusal(result.error.issues);
  return result.data;
}

/** Form values: a misfit is named at the form field holding it, so the form shows it there and opens its section. */
function formValues<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown, fields: FormFields): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new InputRefusal(result.error.issues, fields);
  return result.data;
}

const pointer = (path: readonly (string | number)[]) =>
  path.map(part => "/" + String(part).replaceAll("~", "~0").replaceAll("/", "~1")).join("");
const segments = (path: string) => path.split("/").slice(1).map(part => part.replaceAll("~1", "/").replaceAll("~0", "~"));

/** Each declared field's path as segments; an array row is "*". Includes every variant branch of object controls. */
export function fieldPatterns(fields: readonly PanelFormField[], prefix: string[] = []): string[][] {
  return fields.flatMap(field => {
    const path = [...prefix, ...segments(field.path)];
    const { control } = field;
    if (control.kind === "object") return [path, ...fieldPatterns(panelFormObjectAllFields(control), path)];
    if (control.kind === "object-array") return [path, ...fieldPatterns(control.itemFields, [...path, "*"])];
    return [path];
  });
}

/** The deepest declared field that holds the value at `path`. */
function holdingField(patterns: readonly string[][], path: readonly (string | number)[]) {
  const parts = path.map(String);
  const holds = (pattern: readonly string[]) => pattern.length <= parts.length
    && pattern.every((part, index) => part === "*" ? /^\d+$/.test(parts[index]!) : part === parts[index]);
  const deepest = patterns.filter(holds).sort((left, right) => right.length - left.length)[0];
  return deepest && pointer(parts.slice(0, deepest.length));
}

async function inputRefusal({ issues, fields }: InputRefusal, locale?: string): Promise<Extract<SinglePanelOperationOutcome, { kind: "refusal" }>> {
  logger.warn("A product catalog write was refused for values that do not fit", { issues: JSON.stringify(issues).slice(0, 4096) });
  const refused = { kind: "refusal" as const, code: "INVALID_REQUEST", message: tForLocale(locale, "panels.productCatalog.inputInvalid") };
  if (!fields) return refused;
  const patterns = fieldPatterns(await fields().catch(() => []));
  const named = new Map<string, z.ZodIssue>();
  for (const issue of issues) {
    const field = holdingField(patterns, issue.path);
    if (field && !named.has(field)) named.set(field, issue);
  }
  const errors = [...named].map(([field, issue]) => {
    const missing = issue.code === z.ZodIssueCode.invalid_type && issue.received === "undefined" && pointer(issue.path) === field;
    return { field, code: missing ? "required" as const : "invalid_format" as const,
      message: tForLocale(locale, missing ? "panels.productCatalog.fieldRequired" : "panels.productCatalog.fieldInvalid") };
  });
  return errors.length ? { ...refused, message: errors[0]!.message, errors } : refused;
}

const logger = createLogger("product-catalog-operations");

/**
 * A Java owner's refusal keeps the fields it names, at the panel form's own paths. A refusal body that cannot be read as
 * the owner's refusal is reported as such, with the raw body logged, rather than passing for an ordinary refusal.
 */
function ownerRefusal(error: BackendResponseError, locale?: string): Extract<SinglePanelOperationOutcome, { kind: "refusal" }> {
  const plain = { kind: "refusal" as const, code: error.code ?? "PRODUCT_WRITE_REFUSED", message: error.message };
  let body: unknown;
  try { body = JSON.parse(error.detail); } catch { return unreadable(error, locale); }
  if (typeof body !== "object" || body === null) return unreadable(error, locale);
  if (!("errors" in body)) return plain;
  const envelope = ownerEnvelopeSchema.safeParse({ ...body, success: false });
  if (!envelope.success) return unreadable(error, locale);
  try {
    const outcome = ownerWriteFailure(envelope.data, "PRODUCT_WRITE_REFUSED", error.message);
    if (outcome.kind !== "refusal") return unreadable(error, locale);
    if (!outcome.errors) return outcome;
    // The owner names a field under its form values (/values/...); the panel form addresses the field itself.
    const errors = outcome.errors.map(item => ({ ...item, field: item.field.replace(/^\/values(?=\/)/, "") }));
    return { ...outcome, errors };
  } catch {
    return unreadable(error, locale);
  }
}

function unreadable(error: BackendResponseError, locale?: string): Extract<SinglePanelOperationOutcome, { kind: "refusal" }> {
  logger.warn("An application owner refused a write with a body that is not its refusal", {
    status: error.status, code: error.code, message: error.message, body: error.detail.slice(0, 4096),
  });
  // The reader is told in their language; what the owner sent stays in the log.
  return { kind: "refusal", code: "OWNER_REFUSAL_UNREADABLE", message: tForLocale(locale, "panels.productCatalog.ownerRefusalUnreadable") };
}

/** A refusal decided before the owner is called, already naming its fields. */
class FieldRefusal extends Error {
  constructor(readonly outcome: Extract<SinglePanelOperationOutcome, { kind: "refusal" }>) { super(outcome.message); }
}

/**
 * An entry's default agent is checked here only for its shape, on the values as sent, so a wrong one is named at its
 * field rather than as a bad request. Whether it exists, is enabled and serves the entry's panel is the owners' check
 * on save (Java asks the agent owner's preflight), which answers at the same row; leaving it out keeps the general
 * assistant.
 */
function checkDefaultAgentShapes(values: Record<string, unknown>) {
  const uses = Array.isArray(values.panelUses) ? values.panelUses : [];
  const errors = uses.flatMap((use, index) => {
    const value = use !== null && typeof use === "object" ? (use as Record<string, unknown>).defaultAgent : undefined;
    if (value === undefined || defaultAgentSchema.safeParse(value).success) return [];
    const field = `/panelUses/${index}/defaultAgent`;
    return [{ field, code: "invalid_object" as const, message: `Field '${field}' expects a default agent, received ${JSON.stringify(value)}` }];
  });
  if (errors.length) throw new FieldRefusal({ kind: "refusal", code: "APPLICATION_ENTRY_INVALID", message: errors[0]!.message, errors });
}

async function write(
  type: string, run: () => Promise<{ primaryKey: string; data: OutcomeData; created?: boolean }>, locale?: string,
): Promise<SinglePanelOperationOutcome> {
  try {
    const { primaryKey, data, created } = await run();
    const identity = { objectType: type, primaryKey };
    return {
      kind: "success", data,
      ...(created && { created: identity }),
      affected: { objects: [identity], objectTypes: [type] },
    };
  } catch (error) {
    if (error instanceof FieldRefusal) return error.outcome;
    if (error instanceof InputRefusal) return await inputRefusal(error, locale);
    if (error instanceof BackendResponseError && error.status >= 400 && error.status < 500) return ownerRefusal(error, locale);
    if (error instanceof HttpError && error.status >= 400 && error.status < 500)
      return { kind: "refusal", code: error.code ?? "PRODUCT_WRITE_REFUSED", message: error.message };
    throw error;
  }
}

function deleteProductImpact(kind: "panel" | "projection", collection: string): PanelImpactInspector {
  return {
    handlerRef: `${collection}.delete.inspect-impact`,
    async inspect({ locale, initiator: { owner, credentials } }, calls) {
      const { objectType, primaryKey } = calls[0]!.target as PanelRecordTarget;
      const label = kind === "panel"
        ? await readCurrentPanelLabel(owner, credentials, primaryKey)
        : (await readCurrentProjection(owner, credentials, primaryKey)).name;
      const usage = await currentProductUsedBy(owner, credentials, kind, primaryKey);
      const objects = usage.panels.map(({ id, name }) => ({ target: { objectType: PRODUCT_PANEL, primaryKey: id }, label: name }));
      if ("applicationEntries" in usage) {
        for (const entry of usage.applicationEntries) {
          objects.push({
            target: { objectType: APPLICATION_PANEL_USE, primaryKey: entry.entryId },
            label: `${entry.applicationName} (${entry.path})`,
          });
        }
        for (const className of usage.classNames) {
          objects.push({ target: { objectType: OBJECT_TYPE, primaryKey: className }, label: className });
        }
      }
      const word = (key: string, params: Record<string, string | number>) =>
        tForLocale(locale ?? credentials.locale, `panels.productCatalog.${key}`, params);
      const total = objects.length + usage.hiddenCount;
      if (!total) {
        return {
          objects: [{ target: { objectType, primaryKey }, label }],
          total: 1,
          summary: word(`${kind}.deleteImpact`, { name: label }),
        };
      }
      const summary = word(`${kind}.deleteInUse`, { name: label });
      return {
        objects,
        total,
        summary: usage.hiddenCount ? `${summary} ${word("deleteHiddenReferences", { count: usage.hiddenCount })}` : summary,
      };
    },
  };
}

function productOperations(kind: "panel" | "projection", type: string, collection: string): PanelWriteServerOperation[] {
  const objectTarget = panelObjectIdentitySchema.extend({ kind: z.literal("object"), objectType: z.literal(type) });
  const { revision: updateRevision } = deleteProductCurrentQuerySchema.shape;
  const save: PanelWriteServerOperation = {
    handlerRef: `${type}.save`,
    binding: { kind: "PlatformObjectType", id: type },
    labelKey: "panels.productCatalog.save",
    kind: "form.save",
    effect: "write",
    batch: false,
    targetType: type,
    targetSchema: z.discriminatedUnion("kind", [objectTarget, panelFormTargetSchema.options[1]]),
    inputSchema: panelFormSaveInputSchema,
    resultSchema: savedId,
    draftInput: input => panelFormSaveInputSchema.parse(input).values,

    create: true,
    async execute({ locale, executor: { owner, credentials } }, target, input) {
      return write(type, async () => {
        const { values: { id, ...submitted }, revision, submittedFields } = writeInput(panelFormSaveInputSchema, input);
        const primaryKey = target.kind === "object" ? target.primaryKey : writeInput(savedId.shape.id, target.id ?? id ?? randomUUID());
        const expectedRevision = target.kind === "draft" ? 0 : writeInput(updateRevision, revision);
        let values = submitted;
        if (target.kind === "object" && submittedFields !== undefined) {
          const { definition } = await requireCurrentProduct(owner, credentials, kind, primaryKey, "edit");
          if (!submittedFields.length) return { primaryKey, data: { id: primaryKey } };
          const current = kind === "projection" && definition.componentId === METRIC_CHART_COMPONENT
            ? chartMetadata.parse(definition) : runtimeJsonObjectSchema.parse(definition);
          values = applySubmittedFields(current, submitted, submittedFields);
        }

        const reads = kind === "projection"
          ? createProductProjectionReadAdapter(owner, credentials) : createProductPanelReadAdapter(owner, credentials);
        const fields = async () => (await (target.kind === "object" ? reads.form(primaryKey, {}) : reads.createForm({}))).fields;
        if (kind === "projection") {
          await saveCurrentProjection(owner, credentials, primaryKey,
            formValues(registerProductProjectionRequestSchema, { ...values, revision: expectedRevision }, fields));
        } else {
          const { revision: parsedRevision, ...definition } = formValues(registerProductPanelRequestSchema, {
            ...values, revision: expectedRevision,
          }, fields);
          await saveCurrentPanel(owner, credentials, primaryKey, definition, parsedRevision);
        }
        return { primaryKey, data: { id: primaryKey }, created: target.kind === "draft" };
      }, locale ?? credentials.locale);
    },
  };

  function action<Input extends Record<string, unknown>>(
    name: "copy" | "delete" | "grant" | "revoke" | "share",
    inputSchema: z.ZodType<Input, z.ZodTypeDef, unknown>,
    resultSchema: z.ZodTypeAny,
    run: (actor: PanelOperationHost["executor"], primaryKey: string, input: Input) => Promise<{ primaryKey: string; data: OutcomeData }>,
    extra?: Pick<PanelWriteServerOperation, "unavailable" | "inspectImpact">,
  ): PanelWriteServerOperation {
    const handlerRef = `${collection}.${name}`;
    return {
      handlerRef,
      binding: { kind: "PlatformOperation", id: handlerRef },
      labelKey: `panels.productCatalog.${name}`,
      effect: "write",
      kind: "action",
      batch: false,
      targetType: type,
      targetInput: kind,
      targetSchema: objectTarget,
      inputSchema: inputSchema as z.ZodType<Input>,
      resultSchema,
      ...extra,
      async targetLabel({ initiator: { owner, credentials } }, target) {
        if (kind === "panel" && name === "delete") return readCurrentPanelLabel(owner, credentials, target.primaryKey);
        const read = kind === "panel" ? readCurrentPanel : readCurrentProjection;
        return (await read(owner, credentials, target.primaryKey)).name;
      },
      async execute({ locale, executor }, target, input) {
        return write(type, () => run(executor, writeInput(objectTarget, target).primaryKey, writeInput(inputSchema, input)),
          locale ?? executor.credentials.locale);
      },
    };
  }

  const panelCopyInputSchema = copyProductCurrentRequestSchema.extend({ template: z.boolean().optional() }).strict();
  const panelDeleteUnavailable: PanelWriteServerOperation["unavailable"] | undefined = kind === "panel"
    ? async (host, { primaryKey }: PanelRecordTarget) => {
        const locale = host.locale ?? host.initiator.credentials.locale;
        try {
          const { panel, unavailable } = await readCataloguePanel(host.initiator.owner, host.initiator.credentials, primaryKey);
          if (unavailable ? unavailable.revision !== undefined : panel.editable) return undefined;
          return { reason: tForLocale(locale, "panels.productCatalog.application.readOnly") };
        } catch (error) {
          if (!(error instanceof HttpError && (error.status === 403 || error.status === 404))) throw error;
          return { reason: tForLocale(locale, "panels.productCatalog.application.availabilityUnavailable") };
        }
      }
    : undefined;

  return [
    save,
    action("copy", kind === "panel" ? panelCopyInputSchema : copyProductCurrentRequestSchema, savedId,
      async ({ owner, credentials }, sourceId, input) => {
        const copied = await copyCurrentProduct(owner, credentials, kind, sourceId, input);
        return { primaryKey: copied.id, data: { id: copied.id } };
      }),
    action("delete", kind === "panel" ? deleteProductPanelQuerySchema : deleteProductCurrentQuerySchema,
      kind === "panel" ? deleteProductPanelResponseSchema : deleteProductCurrentResponseSchema,
      async ({ owner, credentials }, primaryKey, { revision }) => {
        const result = await deleteCurrentProduct(owner, credentials, kind, primaryKey, revision);
        return { primaryKey, data: runtimeJsonObjectSchema.parse(result) };
      },
      { unavailable: panelDeleteUnavailable, inspectImpact: deleteProductImpact(kind, collection) }),
    ...(["grant", "revoke"] as const).map(name => action(name, grantInput, noData,
      async ({ owner, credentials }, primaryKey, input) => {
        await changeCurrentProductGrant(owner, credentials, kind, primaryKey, { ...input, remove: name === "revoke" });
        return { primaryKey, data: {} };
      })),
    action("share", changeProductDomainGrantRequestSchema,
      kind === "panel" ? changeProductPanelDomainGrantResponseSchema : productGrantChangeResponseSchema,
      async ({ owner, credentials }, primaryKey, { shared }) => {
        const result = await changeCurrentProductDomainGrant(owner, credentials, kind, primaryKey, shared);
        return { primaryKey, data: runtimeJsonObjectSchema.parse(result) };
      }),
  ];
}

const applicationTarget = panelObjectIdentitySchema.extend({ kind: z.literal("object"), objectType: z.literal(APPLICATION) });
const applicationDraftPath = z.string().regex(/^\/applications\/app-[a-z0-9-]+$/);
const applicationSave: PanelWriteServerOperation = {
  handlerRef: `${APPLICATION}.save`,
  binding: { kind: "PlatformObjectType", id: APPLICATION },
  labelKey: "panels.productCatalog.save",
  kind: "form.save",
  effect: "write",
  batch: false,
  targetType: APPLICATION,
  targetSchema: z.discriminatedUnion("kind", [applicationTarget, panelFormTargetSchema.options[1]]),
  inputSchema: panelFormSaveInputSchema,
  resultSchema: savedId,
  draftInput: input => panelFormSaveInputSchema.parse(input).values,

  create: true,
  async execute({ locale, executor: { credentials } }, target, input) {
    return write(APPLICATION, async () => {
      const { values, submittedFields } = writeInput(panelFormSaveInputSchema, input);
      const java = applicationCatalogueClient(credentials);
      if (target.kind === "draft") {
        const { id: formId, ...createValues } = values;
        checkDefaultAgentShapes(createValues);
        const body = formValues(applicationCatalogueCreateSchema, createValues,
          async () => (await java.form({ section: "create", target: { kind: "draft", id: target.id }, changedField: null })).fields);
        const id = writeInput(applicationDraftIdSchema,
          target.id ?? formId ?? writeInput(applicationDraftPath, body.entry.path).slice("/applications/".length));
        await java.create(id, body);
        return { primaryKey: id, data: { id }, created: true };
      }

      const id = target.primaryKey;
      if (submittedFields?.length === 0) return { primaryKey: id, data: { id } };
      const singleEntryKeys = new Set(["id", "pageKey", "panelId", "path", "access", "groupKey", "inputs", "defaultAgent"]);
      const isSingleEntry = !("panelUses" in values) && (
        ("pageKey" in values && "panelId" in values)
        || (submittedFields !== undefined && submittedFields.some(pointer => singleEntryKeys.has(pointer.split("/", 2)[1] ?? "")))
      );
      if (isSingleEntry) {
        const currentEntryId = typeof values.id === "string" && values.id.length > 0 ? values.id : "__new__";
        const currentEntriesForm = await java.form({ section: "entries", target, changedField: null });
        const entriesValues = applicationEntriesUpdateSchema.parse(currentEntriesForm.values);
        const existingIndex = entriesValues.panelUses.findIndex(item => item.id === currentEntryId);
        const existingEntry = existingIndex >= 0 ? entriesValues.panelUses[existingIndex] : undefined;
        const baseEntry = (existingEntry
          ?? { id: "", pageKey: "", panelId: "", path: `/applications/${id}/`, access: { kind: "domain-member" } }) as Parameters<typeof applySubmittedFields>[0];
        const body = submittedFields === undefined
          ? (existingEntry?.icon !== undefined && !("icon" in values) ? { ...values, icon: existingEntry.icon } : values)
          : applySubmittedFields(baseEntry, values, submittedFields);
        const parsedEntry = formValues(applicationPanelUseSchema, body, async () =>
          (await java.form({ section: "entry", entryId: existingIndex >= 0 ? currentEntryId : "__new__", target, changedField: null })).fields);
        if (existingIndex >= 0) entriesValues.panelUses[existingIndex] = parsedEntry;
        else entriesValues.panelUses.push(parsedEntry);
        await java.saveEntries(id, entriesValues);
        return { primaryKey: id, data: { id } };
      }
      const entries = submittedFields === undefined ? "panelUses" in values
        : submittedFields.some(pointer => Object.hasOwn(applicationEntriesUpdateSchema.shape, pointer.split("/", 2)[1]));
      const section = entries ? "entries" : "identity";
      const sectionFields = (form: "entries" | "identity") => async () => (await java.form({ section: form, target, changedField: null })).fields;
      const currentValues = submittedFields === undefined
        ? undefined
        : (await java.form({ section, target, changedField: null })).values;
      const body = submittedFields === undefined ? values : applySubmittedFields(currentValues!, values, submittedFields);
      if (entries) {
        const existingIcons = new Map<string, string>();
        if (Array.isArray(currentValues?.panelUses)) {
          for (const item of currentValues.panelUses) {
            if (item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string"
              && typeof (item as Record<string, unknown>).icon === "string") {
              existingIcons.set((item as Record<string, unknown>).id as string, (item as Record<string, unknown>).icon as string);
            }
          }
        }
        const preservedBody = Array.isArray(body.panelUses) && existingIcons.size > 0
          ? {
              ...body,
              panelUses: body.panelUses.map((item) => {
                if (!item || typeof item !== "object" || "icon" in item) return item;
                const entryId = (item as Record<string, unknown>).id;
                const savedIcon = typeof entryId === "string" ? existingIcons.get(entryId) : undefined;
                return savedIcon ? { ...(item as Record<string, unknown>), icon: savedIcon } : item;
              }),
            }
          : body;
        checkDefaultAgentShapes(preservedBody);
        await java.saveEntries(id, formValues(applicationEntriesUpdateSchema, preservedBody, sectionFields("entries")));
      } else await java.saveIdentity(id, formValues(applicationIdentityUpdateSchema, body, sectionFields("identity")));
      return { primaryKey: id, data: { id } };
    }, locale ?? credentials.locale);
  },
};

function applicationAction<Input extends Record<string, unknown>>(
  name: "delete" | "grant" | "share" | "addEntry" | "updateEntry" | "deleteEntry",
  inputSchema: z.ZodType<Input>,
  run: (actor: PanelOperationHost["executor"], id: string, input: Input) => Promise<void>,
  extra?: Pick<PanelWriteServerOperation, "unavailable" | "inspectImpact">,
): PanelWriteServerOperation {
  const handlerRef = `applications.${name}`;
  return {
    handlerRef,
    binding: { kind: "PlatformOperation", id: handlerRef },
    labelKey: `panels.productCatalog.${name}`,
    kind: "action",
    effect: "write",
    batch: false,
    targetType: APPLICATION,
    targetInput: "application",
    targetSchema: applicationTarget,
    inputSchema,
    resultSchema: noData,
    ...extra,
    async targetLabel(host, { primaryKey }, input) {
      const locale = host.locale ?? "en";
      const record = await applicationCatalogueClient(host.initiator.credentials).record(primaryKey);
      const appLabel = localizedApplicationText(record.names, locale) ?? record.id;
      if (name === "deleteEntry" || name === "updateEntry") {
        const entryId = typeof input?.entryId === "string" ? input.entryId : undefined;
        const entry = entryId ? record.panelUses.find(item => item.id === entryId) : undefined;
        const entryLabel = (entry?.names && localizedApplicationText(entry.names, locale)) ?? entry?.path ?? entryId;
        if (entryLabel) return `${appLabel} / ${entryLabel}`;
      } else if (name === "addEntry") {
        const entry = input?.entry as z.infer<typeof applicationPanelUseSchema> | undefined;
        const entryLabel = (entry?.names && localizedApplicationText(entry.names, locale)) ?? entry?.path ?? entry?.id;
        if (entryLabel) return `${appLabel} / ${entryLabel}`;
      }
      return appLabel;
    },
    async execute({ locale, executor }, target, input) {
      return write(APPLICATION, async () => {
        const { primaryKey } = writeInput(applicationTarget, target);
        await run(executor, primaryKey, writeInput(inputSchema, input));
        return { primaryKey, data: {} };
      }, locale ?? executor.credentials.locale);
    },
  };
}

const entryInput = z.object({ entryId: applicationPanelUseSchema.shape.id }).strict();
type ApplicationEntries = z.infer<typeof applicationEntriesUpdateSchema>["panelUses"];
function entryIndex(entries: ApplicationEntries, entryId: string) {
  const index = entries.findIndex(entry => entry.id === entryId);
  if (index < 0) throw new HttpError(404, "Application entry is unavailable", "APPLICATION_ENTRY_UNAVAILABLE");
  return index;
}

async function editEntries(
  credentials: PanelOperationHost["executor"]["credentials"], id: string, edit: (entries: ApplicationEntries) => void,
) {
  const java = applicationCatalogueClient(credentials);
  const form = await java.form({ section: "entries", target: { kind: "object", objectType: APPLICATION, primaryKey: id }, changedField: null });
  const values = applicationEntriesUpdateSchema.parse(form.values);
  edit(values.panelUses);
  await java.saveEntries(id, values);
}

const panelHomeTarget = z.object({
  kind: z.literal("object"),
  objectType: z.literal(PRODUCT_PANEL),
  primaryKey: z.string().min(1),
}).strict();

const panelHomeOperations: readonly PanelWriteServerOperation[] = [
  {
    handlerRef: SET_HOME_PANEL,
    binding: { kind: "PlatformOperation", id: SET_HOME_PANEL },
    labelKey: "panels.productCatalog.panel.setAsHome",
    kind: "action",
    effect: "write",
    batch: false,
    targetType: PRODUCT_PANEL,
    targetInput: "panel",
    targetSchema: panelHomeTarget,
    inputSchema: noData,
    resultSchema: z.object({ homePanelId: z.string().min(1) }).strict(),
    async targetLabel(host, { primaryKey }) {
      try {
        const panel = await readCurrentPanel(host.initiator.owner, host.initiator.credentials, primaryKey);
        return panel.name || panel.id;
      } catch {
        return primaryKey;
      }
    },
    done(host, name) {
      return tForLocale(host.locale, "panels.productCatalog.panel.setAsHomeDone", { name });
    },
    async execute({ locale, executor }, target) {
      return write(PRODUCT_PANEL, async () => {
        const { primaryKey } = writeInput(panelHomeTarget, target);
        await saveHomePanel(executor.owner, executor.credentials, primaryKey);
        return { primaryKey, data: { homePanelId: primaryKey } };
      }, locale ?? executor.credentials.locale);
    },
  },
  {
    handlerRef: RESET_HOME_PANEL,
    binding: { kind: "PlatformOperation", id: RESET_HOME_PANEL },
    labelKey: "panels.productCatalog.panel.resetHome",
    kind: "action",
    effect: "write",
    batch: false,
    targetType: PRODUCT_PANEL,
    targetSchema: z.null(),
    inputSchema: noData,
    resultSchema: z.object({ homePanelId: z.null() }).strict(),
    async execute(host: PanelOperationHost) {
      const { locale, executor } = host;
      return write(PRODUCT_PANEL, async () => {
        await saveHomePanel(executor.owner, executor.credentials, null);
        return { primaryKey: "default", data: { homePanelId: null } };
      }, locale ?? executor.credentials.locale);
    },
  },
];

const applicationOperations: readonly PanelWriteServerOperation[] = [
  applicationSave,
  applicationAction(
    "delete",
    noData,
    async ({ owner, credentials }, id) => {
      const { assertPublishedBuilderWorkspaceIdle, cleanupApplicationBuilderArtifacts } = await import("../app-builder/project-service");
      await assertPublishedBuilderWorkspaceIdle(owner, credentials, id);
      await applicationCatalogueClient(credentials).remove(id);
      await cleanupApplicationBuilderArtifacts(owner, credentials, id);
    },
    {
      inspectImpact: {
        handlerRef: "applications.delete.inspect-impact",
        async inspect({ initiator, locale }, [call]) {
          const { primaryKey } = applicationTarget.parse(call.target);
          const detail = await applicationCatalogueClient(initiator.credentials).record(primaryKey);
          if (!detail.canMaintain) throw new HttpError(403, "Application edit permission required", "PRODUCT_FORBIDDEN");
          const { appBuilderProjectStore } = await import("../app-builder/project-store");
          const project = await appBuilderProjectStore.findByAppId(initiator.owner.domainId, primaryKey);
          const language = locale ?? initiator.credentials.locale;
          const label = localizedApplicationText(detail.names, language) ?? primaryKey;
          return {
            summary: tForLocale(language, project ? "panels.appBuilder.deletePublishedWithSource" : "panels.appBuilder.deletePublished", { name: label }),
            total: 1,
            objects: [{ target: { objectType: APPLICATION, primaryKey }, label }],
          };
        },
      },
      async unavailable(host, { primaryKey }: PanelRecordTarget) {
        const locale = host.locale ?? host.initiator.credentials.locale;
        try {
          const detail = await applicationCatalogueClient(host.initiator.credentials).record(primaryKey);
          if (!detail.canMaintain) {
            return { reason: tForLocale(locale, "panels.productCatalog.application.readOnly") };
          }
          return undefined;
        } catch {
          // Fail closed: an unreadable record must never report delete as available,
          // while isolating sibling operations on the same projection from this failure.
          return { reason: tForLocale(locale, "panels.productCatalog.application.availabilityUnavailable") };
        }
      },
    },
  ),
  applicationAction("grant", changeProductGrantRequestSchema, async ({ credentials }, id, input) => changeProductGrant(id, input, credentials)),
  applicationAction("share", changeProductDomainGrantRequestSchema, async ({ credentials }, id, { shared }) => {
    await changeProductDomainGrant(id, shared, credentials);
  }),
  applicationAction("addEntry", z.object({ entry: applicationPanelUseSchema }).strict(),
    async ({ credentials }, id, { entry }) => editEntries(credentials, id, entries => { entries.push(entry); })),
  applicationAction("updateEntry", entryInput.extend({ entry: applicationPanelUseSchema }),
    async ({ credentials }, id, { entryId, entry }) => editEntries(credentials, id, entries => { entries[entryIndex(entries, entryId)] = entry; })),
  applicationAction("deleteEntry", entryInput,
    async ({ credentials }, id, { entryId }) => editEntries(credentials, id, entries => { entries.splice(entryIndex(entries, entryId), 1); })),
];

export const productCatalogServerOperations: readonly PanelWriteServerOperation[] = [
  ...productOperations("projection", PRODUCT_PROJECTION, "productProjections"),
  ...productOperations("panel", PRODUCT_PANEL, "productPanels"),
  ...panelHomeOperations,
  ...applicationOperations,
];
