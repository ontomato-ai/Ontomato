import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  applicationCatalogueCreateSchema, applicationEntriesUpdateSchema, applicationIdentityUpdateSchema,
} from "@ontomato/contracts/application-catalogue";
import { runtimeJsonObjectSchema, type RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { panelFormTargetSchema, panelObjectIdentitySchema } from "@ontomato/contracts/panel-manifest";
import { panelFormSaveInputSchema, panelFormValuesSchema } from "@ontomato/contracts/panel-projection";
import {
  changeProductDomainGrantRequestSchema, changeProductGrantRequestSchema,
  changeProductPanelDomainGrantResponseSchema, productGrantChangeResponseSchema,
} from "@ontomato/contracts/product-governance";
import {
  METRIC_CHART_COMPONENT, applicationPanelUseSchema, copyProductCurrentRequestSchema, deleteProductCurrentQuerySchema, deleteProductCurrentResponseSchema,
  deleteProductPanelResponseSchema, productCurrentIdParamsSchema,
  registerProductPanelRequestSchema, registerProductProjectionRequestSchema,
} from "@ontomato/contracts/product-panels";
import { APPLICATION, PRODUCT_PANEL, PRODUCT_PROJECTION } from "@ontomato/contracts/platform-object-types";
import { HttpError } from "../../utils/errors";
import { changeProductGrant } from "../product-governance/grants";
import { applicationCatalogueClient, applicationDraftIdSchema } from "./application-catalogue";
import {
  changeCurrentProductDomainGrant, changeCurrentProductGrant, copyCurrentProduct, deleteCurrentProduct,
} from "./catalog";
import { readCurrentPanel, readCurrentProjection, requireCurrentProduct, saveCurrentPanel, saveCurrentProjection } from "./current";
import { applySubmittedFields } from "./submitted-form-values";
import type { PanelOperationHost, PanelWriteServerOperation, SinglePanelOperationOutcome } from "./server-operations";

const savedId = productCurrentIdParamsSchema;
const noData = z.object({}).strict();
const grantInput = changeProductGrantRequestSchema.omit({ remove: true });
const chartMetadata = registerProductProjectionRequestSchema.options[1].omit({ revision: true }).strip();
type OutcomeData = Record<string, RuntimeJsonValue>;

function writeInput<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, result.error.message, "INVALID_REQUEST");
  return result.data;
}

async function write(type: string, run: () => Promise<{ primaryKey: string; data: OutcomeData }>): Promise<SinglePanelOperationOutcome> {
  try {
    const { primaryKey, data } = await run();
    return { kind: "success", data, affected: { objects: [{ objectType: type, primaryKey }], objectTypes: [type] } };
  } catch (error) {
    if (error instanceof HttpError && error.status >= 400 && error.status < 500)
      return { kind: "refusal", code: error.code ?? "PRODUCT_WRITE_REFUSED", message: error.message };
    throw error;
  }
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
    draftOperation: target => target.kind === "draft" ? `${kind}.create` : `${kind}.update`,
    draftInput: input => panelFormSaveInputSchema.parse(input).values,
    formInstructions: "Read the owner form. For edits, send the current revision and the JSON Pointers of the fields you changed.",
    create: {
      draftValues: values => panelFormValuesSchema.parse(values),
      createdObject: data => ({ objectType: type, primaryKey: savedId.parse(data).id }),
    },
    async execute({ executor: { owner, credentials } }, target, input) {
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

        if (kind === "projection") {
          await saveCurrentProjection(owner, credentials, primaryKey,
            writeInput(registerProductProjectionRequestSchema, { ...values, revision: expectedRevision }));
        } else {
          const { revision: parsedRevision, ...definition } = writeInput(registerProductPanelRequestSchema, {
            ...values, revision: expectedRevision,
          });
          await saveCurrentPanel(owner, credentials, primaryKey, definition, parsedRevision);
        }
        return { primaryKey, data: { id: primaryKey } };
      });
    },
  };

  function action<Input extends Record<string, unknown>>(
    name: "copy" | "delete" | "grant" | "revoke" | "share",
    inputSchema: z.ZodType<Input, z.ZodTypeDef, unknown>,
    resultSchema: z.ZodTypeAny,
    run: (actor: PanelOperationHost["executor"], primaryKey: string, input: Input) => Promise<{ primaryKey: string; data: OutcomeData }>,
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
      async targetLabel({ initiator: { owner, credentials } }, target) {
        const read = kind === "panel" ? readCurrentPanel : readCurrentProjection;
        return (await read(owner, credentials, target.primaryKey)).name;
      },
      async execute({ executor }, target, input) {
        return write(type, () => run(executor, writeInput(objectTarget, target).primaryKey, writeInput(inputSchema, input)));
      },
    };
  }

  return [
    save,
    action("copy", copyProductCurrentRequestSchema, savedId, async ({ owner, credentials }, sourceId, input) => {
      const copied = await copyCurrentProduct(owner, credentials, kind, sourceId, input);
      return { primaryKey: copied.id, data: { id: copied.id } };
    }),
    action("delete", deleteProductCurrentQuerySchema, kind === "panel" ? deleteProductPanelResponseSchema : deleteProductCurrentResponseSchema,
      async ({ owner, credentials }, primaryKey, { revision }) => {
        const result = await deleteCurrentProduct(owner, credentials, kind, primaryKey, revision);
        return { primaryKey, data: runtimeJsonObjectSchema.parse(result) };
      }),
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
  draftOperation: target => target.kind === "draft" ? "create" : "saveIdentity",
  draftInput: input => panelFormSaveInputSchema.parse(input).values,
  formInstructions: "Read the application owner's form for the required section and send the JSON Pointers of the fields you changed.",
  create: {
    draftValues: values => panelFormValuesSchema.parse(values),
    createdObject: data => ({ objectType: APPLICATION, primaryKey: savedId.parse(data).id }),
  },
  async execute({ executor: { credentials } }, target, input) {
    return write(APPLICATION, async () => {
      const { values, submittedFields } = writeInput(panelFormSaveInputSchema, input);
      const java = applicationCatalogueClient(credentials);
      if (target.kind === "draft") {
        const { id: formId, ...formValues } = values;
        const body = writeInput(applicationCatalogueCreateSchema, formValues);
        const id = writeInput(applicationDraftIdSchema,
          target.id ?? formId ?? writeInput(applicationDraftPath, body.entry.path).slice("/applications/".length));
        await java.create(id, body);
        return { primaryKey: id, data: { id } };
      }

      const id = target.primaryKey;
      if (submittedFields?.length === 0) return { primaryKey: id, data: { id } };
      const entries = submittedFields === undefined ? "panelUses" in values
        : submittedFields.some(pointer => Object.hasOwn(applicationEntriesUpdateSchema.shape, pointer.split("/", 2)[1]));
      const section = entries ? "entries" : "identity";
      const body = submittedFields === undefined ? values : applySubmittedFields(
        (await java.form({ section, target, changedField: null })).values, values, submittedFields,
      );
      if (entries) await java.saveEntries(id, writeInput(applicationEntriesUpdateSchema, body));
      else await java.saveIdentity(id, writeInput(applicationIdentityUpdateSchema, body));
      return { primaryKey: id, data: { id } };
    });
  },
};

function applicationAction<Input extends Record<string, unknown>>(
  name: "delete" | "grant" | "addEntry" | "updateEntry" | "deleteEntry",
  inputSchema: z.ZodType<Input>,
  run: (actor: PanelOperationHost["executor"], id: string, input: Input) => Promise<void>,
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
    async targetLabel(host, { primaryKey }) {
      const record = await applicationCatalogueClient(host.initiator.credentials).record(primaryKey);
      return record.names[host.locale ?? "en"] ?? record.names.en;
    },
    async execute({ executor }, target, input) {
      return write(APPLICATION, async () => {
        const { primaryKey } = writeInput(applicationTarget, target);
        await run(executor, primaryKey, writeInput(inputSchema, input));
        return { primaryKey, data: {} };
      });
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

const applicationOperations: readonly PanelWriteServerOperation[] = [
  applicationSave,
  applicationAction("delete", noData, async ({ credentials }, id) => applicationCatalogueClient(credentials).remove(id)),
  applicationAction("grant", changeProductGrantRequestSchema, async ({ credentials }, id, input) => changeProductGrant(id, input, credentials)),
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
  ...applicationOperations,
];
