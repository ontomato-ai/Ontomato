import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ACTION, DELETE_ACTION, SET_ACTION_STATUS } from "@ontomato/contracts/panel-client-requests";
import { panelOwnerOperationDescriptorSchema, type PanelOperationDeclaration } from "@ontomato/contracts/panel-operations";
import {
  panelFormDescriptionSchema, type PanelFormDescription, type PanelFormValues, type PanelRecord,
} from "@ontomato/contracts/panel-projection";
import { config } from "../../config/application";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { ownerEnvelopeSchema } from "../product-panels/data-query-operations";
import type { ProductOwner } from "../product-governance/grants";
import { objectActionDeclaration, readRefusal, storedObjectActionSchema } from "./object-actions";
import { m6ServerOperations } from "./panel-operations";

/*
 * The action catalog's named reads for a direct panel, read as the viewer: the list and one action as records, the
 * owner's definition form for one action, and the descriptions of the status change and the delete the panel offers.
 * For an author's type table it also declares the published Actions that run on one customer object type.
 * The data engine answers the records' display names and the form in the reader's language; the column names are
 * this owner's text.
 */

const actionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullish(),
  statusLabel: z.string().nullish(),
  originLabel: z.string().nullish(),
  createdByName: z.string().nullish(),
  reviewedByName: z.string().nullish(),
  function: z.object({ name: z.string().nullish() }).passthrough().nullish(),
}).passthrough();
type ActionAsset = z.infer<typeof actionSchema>;

/** One object Action for an author's type table: the object type it runs on and its static declaration. */
export interface ObjectActionEntry {
  className: string;
  declaration: PanelOperationDeclaration;
}

interface ActionFormParams {
  values?: PanelFormValues;
  changedField?: string | null;
}

function actionRecord(action: ActionAsset, fieldLabels: Record<string, string>): PanelRecord {
  return {
    primaryKey: action.id,
    label: action.name,
    ...(action.description ? { subtitle: action.description } : {}),
    fieldLabels,
    fields: {
      status: action.statusLabel ?? "",
      origin: action.originLabel ?? "",
      createdBy: action.createdByName ?? "",
      reviewedBy: action.reviewedByName ?? "",
      function: action.function?.name ?? "",
    },
  };
}

type CatalogAction = Extract<(typeof m6ServerOperations)[number], { kind: "action" }>;

/** The description of one of the catalog's write operations, from the operation the coordinator dispatches. */
function operationDescription(handlerRef: string, label: string) {
  const operation = m6ServerOperations.find((item): item is CatalogAction =>
    item.kind === "action" && item.handlerRef === handlerRef)!;
  return panelOwnerOperationDescriptorSchema.parse({
    handlerRef, label, effect: operation.effect, batch: operation.batch,
    target: { source: "input", input: operation.targetInput },
    inputSchema: zodToJsonSchema(operation.inputSchema, { effectStrategy: "input" }),
    resultSchema: zodToJsonSchema(operation.resultSchema, { effectStrategy: "input" }),
    ...(operation.inspectImpact && { inspectImpact: { handlerRef: operation.inspectImpact.handlerRef } }),
  });
}

export function createActionReadAdapter(_owner: ProductOwner, viewer: AssistantCredentials, _callerUserName?: string) {
  const options = { headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers) };
  const base = config.dataQuery.baseUrl.replace(/\/$/, "");
  const translate = (key: string) => tForLocale(viewer.locale, key);
  const fieldLabels = () => Object.fromEntries(
    ["status", "origin", "createdBy", "reviewedBy", "function"].map(name => [name, translate(`panels.action.fields.${name}`)]),
  );
  async function owner<T>(name: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const envelope = ownerEnvelopeSchema.parse(JSON.parse((await backendPost(name, base + path, body, options)).text));
    if (!envelope.success) throw readRefusal(envelope, "ACTION_READ_FAILED", "The owner could not read the actions");
    return schema.parse(envelope.data);
  }
  return {
    async list(): Promise<PanelRecord[]> {
      const labels = fieldLabels();
      return (await owner("action-list", "/action/queryList", {}, z.array(actionSchema))).map(action => actionRecord(action, labels));
    },
    async record(primaryKey: string): Promise<PanelRecord> {
      return actionRecord(await owner("action-record", "/action/queryById", { id: primaryKey }, actionSchema), fieldLabels());
    },
    async form(primaryKey: string, { values, changedField }: ActionFormParams): Promise<PanelFormDescription> {
      return owner("action-form", "/action/definitionForm", {
        target: { kind: "object", objectType: ACTION, primaryKey },
        ...(values !== undefined && { values }),
        changedField: changedField ?? null,
      }, panelFormDescriptionSchema);
    },
    /**
     * The published Actions of the viewer's domain that run on an object, each with the object type its stored target
     * names, as static declarations; with an object type, only that type's. One owner read serves a whole type table.
     */
    async objectActions(objectType?: string): Promise<ObjectActionEntry[]> {
      const published = await owner(
        "action-object-catalog", "/action/queryList", { status: "PUBLISHED" }, z.array(storedObjectActionSchema),
      );
      return published.flatMap(({ target, ...action }) =>
        target !== null && (objectType === undefined || target.className === objectType)
          ? [{ className: target.className, declaration: objectActionDeclaration({ ...action, target }) }]
          : []);
    },
    [`${SET_ACTION_STATUS}.describe`]() {
      return operationDescription(SET_ACTION_STATUS, translate("panels.action.operations.setStatus"));
    },
    [`${DELETE_ACTION}.describe`]() {
      return operationDescription(DELETE_ACTION, translate("panels.action.operations.delete"));
    },
  };
}
