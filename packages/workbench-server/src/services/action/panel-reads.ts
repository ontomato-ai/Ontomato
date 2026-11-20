import { z } from "zod";
import {
  actionDefinitionSchema, actionExplanationSchema, type ActionDefinition, type ActionExplanation,
} from "@ontomato/contracts/action-panel";
import { ACTION, DELETE_ACTION, SET_ACTION_STATUS } from "@ontomato/contracts/panel-client-requests";
import type { PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import type { UnavailableObjectAction } from "@ontomato/contracts/platform-type-table";
import type { PanelOperationDeclaration } from "@ontomato/contracts/panel-operations";
import {
  panelFormDescriptionSchema, type PanelFormDescription, type PanelFormValues, type PanelRecord,
} from "@ontomato/contracts/panel-projection";
import { config } from "../../config/application";
import { createLogger } from "../../logging/logger";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { ownerEnvelopeSchema } from "../product-panels/data-query-operations";
import type { ProductOwner } from "../product-governance/grants";
import { objectActionDeclaration, readRefusal, storedObjectActionSchema } from "./object-actions";
import { describeServerOperation, panelServerOperation } from "../product-panels/server-operations";

/*
 * The action catalog's named reads for a direct panel, read as the viewer: the list and one action as records, the
 * owner's definition form for one action, the definition the owner derives from its explained code and that
 * explanation, and the descriptions of the status change and the delete the panel offers,
 * described from their registered operations as every other platform operation is.
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
  modifyTimestamp: z.number().int().nullish(),
  reviewedByName: z.string().nullish(),
  function: z.object({ name: z.string().nullish() }).passthrough().nullish(),
}).passthrough();
type ActionAsset = z.infer<typeof actionSchema>;

const logger = createLogger("action-panel-reads");
const listedActionSchema = storedObjectActionSchema.pick({ id: true }).extend({
  target: z.unknown(),
  function: z.unknown(),
});
const listedTargetSchema = storedObjectActionSchema.shape.target.unwrap().pick({ className: true });

/** One object Action for an author's type table: the object type it runs on and its static declaration. */
export interface ObjectActionEntry {
  className: string;
  declaration: PanelOperationDeclaration;
}

/** The stored fields of one action its explanation is read from; the data engine names each segment's kind. */
const explainedActionSchema = z.object({
  function: z.object({ code: z.string().nullish() }).passthrough().nullish(),
  codeHash: z.string().nullish(),
  explanationVersion: z.number().int().nullish(),
  codeSegments: z.array(z.unknown()).nullish(),
  businessMeaning: z.unknown().optional(),
}).passthrough();

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
      updatedAt: action.modifyTimestamp == null ? "" : new Date(action.modifyTimestamp).toISOString(),
    },
  };
}

export function createActionReadAdapter(_owner: ProductOwner, viewer: AssistantCredentials, _callerUserName?: string) {
  const options = { headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers) };
  const base = config.dataQuery.baseUrl.replace(/\/$/, "");
  const translate = (key: string) => tForLocale(viewer.locale, key);
  const fieldLabels = () => Object.fromEntries(
    ["status", "origin", "createdBy", "reviewedBy", "function", "updatedAt"]
      .map(name => [name, translate(`panels.action.fields.${name}`)]),
  );
  async function owner<T>(name: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const envelope = ownerEnvelopeSchema.parse(JSON.parse((await backendPost(name, base + path, body, options)).text));
    if (!envelope.success) throw readRefusal(envelope, "ACTION_READ_FAILED", "The owner could not read the actions");
    return schema.parse(envelope.data);
  }
  function definitionForm(name: string, target: PanelFormTarget, { values, changedField }: ActionFormParams) {
    return owner(name, "/action/definitionForm", {
      target, ...(values !== undefined && { values }), changedField: changedField ?? null,
    }, panelFormDescriptionSchema);
  }
  return {
    async list(): Promise<PanelRecord[]> {
      const labels = fieldLabels();
      return (await owner("action-list", "/action/queryList", {}, z.array(actionSchema))).map(action => actionRecord(action, labels));
    },
    async record(primaryKey: string): Promise<PanelRecord> {
      return actionRecord(await owner("action-record", "/action/queryById", { id: primaryKey }, actionSchema), fieldLabels());
    },
    async form(primaryKey: string, params: ActionFormParams): Promise<PanelFormDescription> {
      return definitionForm("action-form", { kind: "object", objectType: ACTION, primaryKey }, params);
    },
    /** What the data engine derives from the action's explained code: what it writes, reads, takes and checks. */
    async definition(primaryKey: string): Promise<ActionDefinition> {
      const action = await owner("action-definition", "/action/queryById", { id: primaryKey },
        z.object({ definition: actionDefinitionSchema }).passthrough());
      return action.definition;
    },
    /** The saved code and its explanation; an action saved before it was explained has no segments yet. */
    async explanation(primaryKey: string): Promise<ActionExplanation> {
      const action = await owner("action-explanation", "/action/queryById", { id: primaryKey }, explainedActionSchema);
      return actionExplanationSchema.parse({
        ...(action.function?.code != null && { code: action.function.code }),
        ...(action.codeHash != null && { codeHash: action.codeHash }),
        ...(action.explanationVersion != null && { explanationVersion: action.explanationVersion }),
        codeSegments: action.codeSegments ?? [],
        ...(action.businessMeaning != null && { businessMeaning: action.businessMeaning }),
      });
    },
    /** The owner's form for a new action, which an agent drafts into after the owner adopts its trial run. */
    async createForm(params: ActionFormParams): Promise<PanelFormDescription> {
      return definitionForm("action-create-form", { kind: "draft" }, params);
    },
    /**
     * The published Actions of the viewer's domain that run on an object, each with the object type its stored target
     * names, as static declarations; with an object type, only that type's. One owner read serves a whole type table.
     */
    async objectActions(objectType?: string): Promise<{ actions: ObjectActionEntry[]; unavailableActions: UnavailableObjectAction[] }> {
      const published = await owner("action-object-catalog", "/action/queryList", { status: "PUBLISHED" }, z.array(z.unknown()));
      const actions: ObjectActionEntry[] = [];
      const unavailableActions: UnavailableObjectAction[] = [];
      for (const raw of published) {
        const listed = listedActionSchema.safeParse(raw);
        if (!listed.success) {
          logger.warn("The action owner returned a published record without a usable ID");
          continue;
        }
        const { id, target, function: storedFunction } = listed.data;
        const classified = listedTargetSchema.safeParse(target);
        const actualType = classified.success ? classified.data.className : undefined;
        if (objectType !== undefined && objectType !== actualType) continue;
        const identity = { id, ...(actualType === undefined ? {} : { objectType: actualType }) };

        if (storedFunction == null) {
          unavailableActions.push({ ...identity, reason: "The stored function definition is missing." });
          continue;
        }
        // A healthy action with no target is outside the object-action catalogue.
        if (target === null) continue;
        const stored = storedObjectActionSchema.safeParse(raw);
        if (!stored.success) {
          const issue = stored.error.issues[0]!;
          const field = issue.path.length ? `field '${issue.path.join(".")}'` : "definition";
          unavailableActions.push({ ...identity, reason: `Invalid stored action ${field}: ${issue.message}` });
          continue;
        }
        const action = stored.data;
        if (action.target !== null)
          actions.push({ className: action.target.className, declaration: objectActionDeclaration({ ...action, target: action.target }) });
      }
      return { actions, unavailableActions };
    },
    [`${SET_ACTION_STATUS}.describe`]() {
      return describeServerOperation(panelServerOperation(SET_ACTION_STATUS), translate("panels.action.operations.setStatus"));
    },
    [`${DELETE_ACTION}.describe`]() {
      return describeServerOperation(panelServerOperation(DELETE_ACTION), translate("panels.action.operations.delete"));
    },
  };
}
