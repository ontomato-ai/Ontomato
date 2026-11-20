import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { panelFormTargetSchema, panelObjectIdentitySchema } from "@ontomato/contracts/panel-manifest";
import { panelFormSaveInputSchema, panelFormValuesSchema } from "@ontomato/contracts/panel-projection";
import { changeProductDomainGrantRequestSchema, changeProductGrantRequestSchema } from "@ontomato/contracts/product-governance";
import {
  copyProductCurrentRequestSchema, deleteProductCurrentQuerySchema, productCurrentIdParamsSchema,
  registerProductPanelRequestSchema, registerProductProjectionRequestSchema,
} from "@ontomato/contracts/product-panels";
import { PRODUCT_PANEL, PRODUCT_PROJECTION } from "@ontomato/contracts/platform-object-types";
import { HttpError } from "../../utils/errors";
import {
  changeCurrentProductDomainGrant, changeCurrentProductGrant, copyCurrentProduct, deleteCurrentProduct,
} from "./catalog";
import { readCurrentPanel, readCurrentProjection, saveCurrentPanel, saveCurrentProjection } from "./current";
import type { PanelOperationHost, PanelWriteServerOperation, SinglePanelOperationOutcome } from "./server-operations";

const savedId = productCurrentIdParamsSchema;
const noData = z.object({}).strict();
const grantInput = changeProductGrantRequestSchema.omit({ remove: true });
type OutcomeData = Record<string, RuntimeJsonValue>;

async function write(type: string, run: () => Promise<{ primaryKey: string; data: OutcomeData }>): Promise<SinglePanelOperationOutcome> {
  try {
    const { primaryKey, data } = await run();
    return { kind: "success", data, affected: { objects: [{ objectType: type, primaryKey }], objectTypes: [type] } };
  } catch (error) {
    if (error instanceof HttpError && error.status >= 400 && error.status < 500)
      return { kind: "refusal", code: error.code ?? "PRODUCT_WRITE_REFUSED", message: error.message };
    if (error instanceof z.ZodError)
      return { kind: "refusal", code: "INVALID_REQUEST", message: error.message };
    throw error;
  }
}

function productOperations(kind: "panel" | "projection", type: string, collection: string): PanelWriteServerOperation[] {
  const objectTarget = panelObjectIdentitySchema.extend({ kind: z.literal("object"), objectType: z.literal(type) });
  const { revision: updateRevision } = deleteProductCurrentQuerySchema.shape;
  const read = kind === "panel" ? readCurrentPanel : readCurrentProjection;
  const save: PanelWriteServerOperation = {
    handlerRef: `${type}.save`,
    binding: { kind: "PlatformObjectType", id: type },
    kind: "form.save",
    effect: "write",
    batch: false,
    targetType: type,
    targetSchema: z.discriminatedUnion("kind", [objectTarget, panelFormTargetSchema.options[1]]),
    inputSchema: panelFormSaveInputSchema,
    resultSchema: savedId,
    draftOperation: target => target.kind === "draft" ? `${kind}.create` : `${kind}.update`,
    draftInput: input => panelFormSaveInputSchema.parse(input).values,
    formInstructions: "Read the owner form. Submit its complete values and current revision when editing.",
    create: {
      draftValues: values => panelFormValuesSchema.parse(values),
      createdObject: data => ({ objectType: type, primaryKey: savedId.parse(data).id }),
    },
    async execute({ executor: { owner, credentials } }, target, input) {
      return write(type, async () => {
        const { values: { id, ...values }, revision } = panelFormSaveInputSchema.parse(input);
        const primaryKey = target.kind === "object" ? target.primaryKey : savedId.shape.id.parse(target.id ?? id ?? randomUUID());
        const expectedRevision = target.kind === "draft" ? 0 : updateRevision.parse(revision);
        if (kind === "projection") {
          await saveCurrentProjection(owner, credentials, primaryKey,
            registerProductProjectionRequestSchema.parse({ ...values, revision: expectedRevision }));
        } else {
          const { revision: parsedRevision, ...definition } = registerProductPanelRequestSchema.parse({
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
        return (await read(owner, credentials, target.primaryKey)).name;
      },
      async execute({ executor }, target, input) {
        return write(type, () => run(executor, objectTarget.parse(target).primaryKey, inputSchema.parse(input)));
      },
    };
  }

  return [
    save,
    action("copy", copyProductCurrentRequestSchema, savedId, async ({ owner, credentials }, sourceId, input) => {
      const copied = await copyCurrentProduct(owner, credentials, kind, sourceId, input);
      return { primaryKey: copied.id, data: { id: copied.id } };
    }),
    action("delete", deleteProductCurrentQuerySchema, noData, async ({ owner, credentials }, primaryKey, { revision }) => {
      await deleteCurrentProduct(owner, credentials, kind, primaryKey, revision);
      return { primaryKey, data: {} };
    }),
    ...(["grant", "revoke"] as const).map(name => action(name, grantInput, noData,
      async ({ owner, credentials }, primaryKey, input) => {
        await changeCurrentProductGrant(owner, credentials, kind, primaryKey, { ...input, remove: name === "revoke" });
        return { primaryKey, data: {} };
      })),
    action("share", changeProductDomainGrantRequestSchema, noData, async ({ owner, credentials }, primaryKey, { shared }) => {
      await changeCurrentProductDomainGrant(owner, credentials, kind, primaryKey, shared);
      return { primaryKey, data: {} };
    }),
  ];
}

export const productCatalogServerOperations: readonly PanelWriteServerOperation[] = [
  ...productOperations("projection", PRODUCT_PROJECTION, "productProjections"),
  ...productOperations("panel", PRODUCT_PANEL, "productPanels"),
];
