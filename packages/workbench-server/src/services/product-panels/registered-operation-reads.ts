import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import {
  ACTION, AGENT_DEFINITION, APPLICATION, APPLICATION_PUBLISH_BUILDER_SOURCE, APPLICATION_RESTART_BUILD_TEST,
  APPLICATION_RESTORE_SOURCE_COMMIT, APPLICATION_ROLLBACK_BUILDER_RELEASE, APPLICATION_SYNC_BUILDER_SOURCE,
  APPROVE_KNOWLEDGE, ATTRIBUTE, BUSINESS_KNOWLEDGE, CLEAR_OBJECT_DETAIL_PANEL, DELETE_ACTION, DELETE_AGENT, DELETE_ATTRIBUTE,
  DELETE_FUNCTION, DELETE_METRIC_VIEW, DELETE_ORG_UNIT, DELETE_PERMISSION_POLICY, DELETE_SKILL, FUNCTION, GENERATE_USER_API_KEY,
  ISSUE_USER_API_KEY_BATCH, METRIC_VIEW, OBJECT_TYPE, REGENERATE_USER_API_KEY,
  RELATIONSHIP, REMOVE_USER, REVOKE_USER_API_KEY, SET_ACTION_STATUS, SET_PRIMARY_KEY, USER, WORKFLOW,
} from "@ontomato/contracts/platform-object-types";
import { z } from "zod";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { describeObjectAction, objectActionDeclaration, storedObjectActionSchema } from "../action/object-actions";
import { actionStatusFieldSchema, renderActionStatusInputSchema } from "../action/panel-operations";
import {
  builderPublishBlock, canRestartBuilderTest, prepareBuilderProjectFacts, readBuilderProjectDetail, readBuilderProjectStatus,
} from "../app-builder/project-service";
import { approveUnavailableReason } from "../business-knowledge/panel-operations";
import { attributeOperationRefusal, attributeReferenceRefusal } from "../ontology-model/model-operations";
import { parseAttributePrimaryKey } from "../ontology-model/model-views";
import { prepareOpsEvidenceAvailability } from "../ops-diagnosis/panel-operations";
import { prepareSkillDeleteRefusal, skillDeleteAccessCall } from "../skills/registered-library-reads";
import { workflowText } from "../workflow/definition";
import { workflowLifecycleAction, workflowLifecycleStateSchema, workflowLifecycleUnavailable } from "../workflow/panel-operations";
import { agentDeletionRefusal, prepareAgentDeletionTarget } from "./agent-definition-operations";
import { readCataloguePanelInRanges } from "./catalog";
import { applicationDeleteRefusal, panelDeleteRefusal } from "./catalog-operations";
import { deleteRefusalPayloadSchema } from "./data-query-operations";
import { prepareOperationDescriptions } from "./direct-operations";
import type { JavaPanelRead, JavaPanelReadResult, JavaPanelViewer, PanelReadVisibility } from "./java-panel-reads";
import { clearObjectDetailRefusal } from "./object-detail-operations";
import { attributeListPayloadSchema, readAttributeRelationshipUses } from "./registered-attribute-reads";
import { describeServerOperation } from "./server-operations";

const memberInspections = new Set<string>([REMOVE_USER, GENERATE_USER_API_KEY, REGENERATE_USER_API_KEY, REVOKE_USER_API_KEY, ISSUE_USER_API_KEY_BATCH]);
const deleteOwners = new Map<string, string>([[DELETE_ACTION, ACTION], [DELETE_FUNCTION, FUNCTION], [DELETE_METRIC_VIEW, METRIC_VIEW]]);
const refusalsSchema = z.record(z.array(z.string().min(1).nullable()).nonempty());
const approvalStatusesSchema = z.array(z.number().int().nullable());
const applicationDeleteAvailabilitySchema = z.object({ canMaintain: z.boolean() });
const skippedActionRefusals = new Set([
  "ACTION_NOT_FOUND", "ACTION_NOT_EXECUTABLE", "ACTION_NOT_OBJECT_ACTION", "ACTION_TARGET_REQUIRED",
  "ACTION_TARGET_MISMATCH", "ACTION_NOT_GRANTED", "ACTION_TARGET_OUT_OF_SCOPE", "ACTION_PRECONDITION_FAILED",
]);

function skipsActionDescription(call: JavaPanelRead["call"], result: JavaPanelReadResult) {
  if (call?.type !== ACTION || call.name !== "executionDefinition" || result.status === "ready") return false;
  if (result.status === "empty") return true;
  // Placement denials have their own codes and must refuse the panel read. A code-less denial here
  // comes from the owner's form data-scope check.
  return result.code ? skippedActionRefusals.has(result.code) : result.status === "forbidden";
}

function invalidPayload(message: string): ProductPanelReadResponse {
  return { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID", message };
}

function attributeTarget(primaryKey: string) {
  try {
    return parseAttributePrimaryKey(primaryKey);
  } catch (error) {
    if (error instanceof SyntaxError) throw new HttpError(400, error.message, "PANEL_READ_INPUT_INVALID");
    throw error;
  }
}

function defersModelRefusal(call: JavaPanelRead["call"], result: JavaPanelReadResult) {
  if (call?.name !== "list" || (call.type !== ATTRIBUTE && call.type !== RELATIONSHIP)) return false;
  // Only the model owner's read refusal can be interpreted as unavailable facts. Placement refusals carry a code.
  return result.status === "empty" || (result.status === "forbidden" && !result.code);
}

type OperationDescription = ReturnType<typeof prepareOperationDescriptions>[number];
const builderOperations = new Set<string>([
  APPLICATION_SYNC_BUILDER_SOURCE, APPLICATION_RESTART_BUILD_TEST, APPLICATION_PUBLISH_BUILDER_SOURCE,
]);

function builderTarget(description: OperationDescription) {
  if (description.kind !== "platform" || !builderOperations.has(description.handler.handlerRef)
      || description.availability?.kind !== "single") return;
  return description.availability.target?.primaryKey;
}
type AttributeFacts = {
  operation: typeof DELETE_ATTRIBUTE | typeof SET_PRIMARY_KEY;
  className: string;
  name: string;
  attributes: number;
  relationships?: number;
};
type PlannedDescription =
  | (Extract<OperationDescription, { kind: "action" }> & { definition: number })
  | (Extract<OperationDescription, { kind: "platform" }> & {
    statusForm?: number;
    memberInspection?: true;
    deletions?: number[];
    skillDeletion?: string;
    agentDeletion?: { read: number; primaryKey: string } | { reason: string };
    panelDeletions?: string[];
    applicationDeletions?: number[];
    clearObjectDetails?: { read: number; classes: string[] };
    knowledgeApproval?: { read: number; size: number };
    opsEvidence?: { read: number; availability: NonNullable<ReturnType<typeof prepareOpsEvidenceAvailability>> };
    attributeFacts?: AttributeFacts;
    workflowFacts?: { action: NonNullable<ReturnType<typeof workflowLifecycleAction>>; reads: number[] };
    builderProject?: string;
  });

export async function prepareRegisteredOperationRead(
  placement: Parameters<typeof prepareOperationDescriptions>[0], inputs: Record<string, unknown>, viewer: JavaPanelViewer, credentials: AssistantCredentials,
) {
  const { domainId } = viewer;
  const { locale } = credentials;
  const calls: NonNullable<JavaPanelRead["call"]>[] = [];
  const addCall = (call: NonNullable<JavaPanelRead["call"]>) => calls.push(call) - 1;
  const modelList = (type: typeof ATTRIBUTE | typeof RELATIONSHIP, className: string) => {
    const index = calls.findIndex(call => call.type === type && call.name === "list" && call.parameters.className === className);
    return index === -1 ? addCall({ type, name: "list", parameters: { className } }) : index;
  };
  const workflowState = (primaryKey: string) => {
    const index = calls.findIndex(call =>
      call.type === WORKFLOW && call.name === "lifecycleState" && call.parameters.primaryKey === primaryKey);
    return index === -1 ? addCall({ type: WORKFLOW, name: "lifecycleState", parameters: { primaryKey } }) : index;
  };
  const inspections: { name: string; operation: string; ids: string[] | null }[] = [];
  let statusForm: number | undefined;
  let skillDeleteRead: number | undefined;
  let detailPanelAccess: number | undefined;
  const operationDescriptions = prepareOperationDescriptions(placement, inputs, locale);
  const builderOptions = new Map<string, { live: boolean; status: boolean }>();
  for (const description of operationDescriptions) {
    const id = builderTarget(description);
    if (id === undefined || description.kind !== "platform") continue;
    const opts = builderOptions.get(id) ?? { live: false, status: false };
    const operation = description.handler.handlerRef;
    opts.live ||= operation === APPLICATION_PUBLISH_BUILDER_SOURCE;
    opts.status ||= operation === APPLICATION_RESTART_BUILD_TEST || operation === APPLICATION_PUBLISH_BUILDER_SOURCE;
    builderOptions.set(id, opts);
  }
  const builderProjects = new Map((await Promise.all([...builderOptions].map(async ([id, options]) =>
    [id, { options, project: await prepareBuilderProjectFacts(viewer, id, options) }] as const
  ))).map(([id, plan]) => [id, { ...plan, indexes: plan.project.facts.map(({ call }) => addCall(call)) }]));
  const planDescription = async (description: OperationDescription): Promise<PlannedDescription> => {
    if (description.kind === "action") {
      const { actionId, object } = description.action;
      const definition = addCall({ type: ACTION, name: "executionDefinition", parameters: {
        primaryKey: actionId,
        ...(object && { object: { className: object.objectType, primaryKey: object.primaryKey } }),
      } });
      return { ...description, definition };
    }
    const { name, handler, availability } = description;
    if (handler.handlerRef === SET_ACTION_STATUS) {
      statusForm ??= addCall({ type: ACTION, name: "createForm", parameters: {} });
      return { ...description, statusForm };
    }
    if (handler.describeInputSchema)
      throw new HttpError(422, `Operation '${handler.handlerRef}' needs owner input-schema facts`, "PANEL_OPERATION_READ_UNAVAILABLE");
    if (!availability) return description;
    const operation = handler.handlerRef;
    if ((operation === APPLICATION_RESTORE_SOURCE_COMMIT || operation === APPLICATION_ROLLBACK_BUILDER_RELEASE)
      && Object.values(placement.projection.operations?.[name]?.params ?? {}).some(param => "rowField" in param))
      return description;
    if (builderOperations.has(operation))
      return { ...description, builderProject: builderTarget(description) };
    if ((operation === DELETE_ATTRIBUTE || operation === SET_PRIMARY_KEY) && availability.kind === "single" && availability.target) {
      const key = attributeTarget(availability.target.primaryKey);
      return { ...description, attributeFacts: {
        operation, ...key,
        attributes: modelList(ATTRIBUTE, key.className),
        ...(operation === DELETE_ATTRIBUTE && { relationships: modelList(RELATIONSHIP, key.className) }),
      } };
    }
    if (availability.kind === "single" && availability.target) {
      if (operation === DELETE_SKILL) {
        skillDeleteRead ??= addCall(skillDeleteAccessCall);
        return { ...description, skillDeletion: availability.target.primaryKey };
      }
      if (operation === DELETE_AGENT) {
        const definition = await prepareAgentDeletionTarget({ initiator: { owner: viewer, credentials }, locale }, availability.target);
        if ("restriction" in definition) return { ...description, agentDeletion: definition.restriction };
        const { id: primaryKey, owner_id: ownerId } = definition.agent;
        const read = addCall({ type: AGENT_DEFINITION, name: "deleteAvailability", parameters: { primaryKey, ownerId } });
        return { ...description, agentDeletion: { read, primaryKey } };
      }
      if (operation === DELETE_PERMISSION_POLICY || operation === DELETE_ORG_UNIT) {
        const { objectType: type, primaryKey } = availability.target;
        return { ...description, deletions: [addCall({ type, name: "deleteRefusal", parameters: { primaryKey } })] };
      }
    }
    if (availability.kind !== "input") {
      const ids = availability.kind === "batch" ? availability.targets.map(({ target }) => target.primaryKey)
        : availability.target === null ? null : [availability.target.primaryKey];
      if (operation === CLEAR_OBJECT_DETAIL_PANEL && ids) {
        detailPanelAccess ??= addCall({ type: OBJECT_TYPE, name: "detailPanel", parameters: {} });
        return { ...description, clearObjectDetails: { read: detailPanelAccess, classes: ids } };
      }
      if (operation === "applications.delete" && ids) return { ...description, applicationDeletions: ids.map(primaryKey =>
        addCall({ type: APPLICATION, name: "deleteAvailability", parameters: { primaryKey } })) };
      if (operation === "productPanels.delete" && ids) return { ...description, panelDeletions: ids };
      const opsEvidence = ids && prepareOpsEvidenceAvailability(operation, domainId, ids, locale);
      if (opsEvidence) {
        // Java owns the management gate; the domain and evidence state belong to the local owner.
        const gate = calls.findIndex(call => call.type === opsEvidence.type && call.name === "record");
        const read = gate === -1 ? addCall({ type: opsEvidence.type, name: "record", parameters: {} }) : gate;
        return { ...description, opsEvidence: { read, availability: opsEvidence } };
      }
      if (operation === APPROVE_KNOWLEDGE && ids) {
        const read = addCall({ type: BUSINESS_KNOWLEDGE, name: "approvalStatuses", parameters: { ids } });
        return { ...description, knowledgeApproval: { read, size: ids.length } };
      }
      const workflowAction = workflowLifecycleAction(operation);
      if (workflowAction && ids)
        return { ...description, workflowFacts: { action: workflowAction, reads: ids.map(workflowState) } };
      if (memberInspections.has(handler.handlerRef)) {
        inspections.push({ name, operation: handler.handlerRef, ids });
        return { ...description, memberInspection: true as const };
      }
      const type = deleteOwners.get(handler.handlerRef);
      if (type && ids) return { ...description, deletions: ids.map(primaryKey =>
        addCall({ type, name: "deleteRefusal", parameters: { primaryKey } })) };
    }
    throw new HttpError(422, `Operation '${handler.handlerRef}' needs owner availability facts`, "PANEL_OPERATION_READ_UNAVAILABLE");
  };
  const descriptions: PlannedDescription[] = [];
  for (const description of operationDescriptions) descriptions.push(await planDescription(description));
  const memberRead = inspections.length
    ? addCall({ type: USER, name: "operationRefusals", parameters: { inspections } })
    : undefined;

  const visibilityRead = descriptions.some(item => item.kind === "platform" && item.panelDeletions)
    ? [{ kind: "PANEL", verbs: ["USE", "EDIT"] }] satisfies PanelReadVisibility[] : undefined;
  return {
    calls,
    visibilityRead,
    async present(results: readonly JavaPanelReadResult[]): Promise<ProductPanelReadResponse> {
      const workflows = new Map<number, z.infer<typeof workflowLifecycleStateSchema> | null>();
      for (const [index, result] of results.entries()) {
        const call = calls[index];
        if (call?.type === WORKFLOW && call.name === "lifecycleState") {
          if (result.status === "ready") {
            const parsed = workflowLifecycleStateSchema.safeParse(result.payload);
            if (!parsed.success) return invalidPayload(parsed.error.message);
            if (parsed.data.id !== call.parameters.primaryKey)
              return invalidPayload("The workflow state does not match the admitted target");
            workflows.set(index, parsed.data);
          } else if (result.status === "error" && result.code === "WORKFLOW_NOT_FOUND") {
            workflows.set(index, null);
            continue;
          }
        }
        if (call?.type === APPLICATION && call.name === "deleteAvailability"
            && result.status === "error" && result.code === "APPLICATION_NOT_FOUND") continue;
        if (call?.type === APPLICATION && call.name === "builderTestStatus" && result.status === "empty") continue;
        if (result.status === "ready" || skipsActionDescription(call, result) || defersModelRefusal(call, result)) continue;
        if (result.status === "empty") return { status: "empty" };
        if (result.status === "forbidden") return { status: "forbidden", reason: result.error };
        return { status: "error", message: result.error, ...(result.code && { code: result.code }) };
      }
      const builderReasons = new Map<string, { sync?: string; restart?: string; publish?: string }>();
      try {
        for (const [id, { options, project, indexes }] of builderProjects) {
          const facts = indexes.map(read => results[read]);
          const ctx = await project.context(facts);
          const test = project.test(facts);
          const detail = options.live ? await readBuilderProjectDetail(domainId, ctx, locale, () => test) : undefined;
          const workspace = detail ?? await readBuilderProjectStatus(ctx, locale);
          builderReasons.set(id, {
            sync: workspace.busy ? "busy" : undefined,
            restart: canRestartBuilderTest(test) ? undefined : "restartUnavailable",
            publish: detail && builderPublishBlock(detail),
          });
        }
      } catch (error) {
        if (error instanceof z.ZodError) return invalidPayload(error.message);
        if (error instanceof HttpError) return error.status === 403
          ? { status: "forbidden", reason: error.message }
          : { status: "error", message: error.message, ...(error.code && { code: error.code }) };
        throw error;
      }
      const payloads = results.map(result => result.status === "ready" ? result.payload : undefined);
      let memberReasons: z.infer<typeof refusalsSchema> = {};
      if (memberRead !== undefined) {
        const parsed = refusalsSchema.safeParse(payloads[memberRead]);
        if (!parsed.success) return invalidPayload(parsed.error.message);
        memberReasons = parsed.data;
        if (inspections.some(({ name, ids }) => memberReasons[name]?.length !== (ids?.length ?? 1)))
          return invalidPayload("Invalid member operation refusals");
      }
      const skillDeleteRefusal = skillDeleteRead === undefined ? undefined
        : await prepareSkillDeleteRefusal(viewer, credentials, payloads[skillDeleteRead]);
      const entries = [];
      for (const description of descriptions) {
        const { name, target } = description;
        if (description.kind === "action") {
          if (results[description.definition].status !== "ready") continue;
          const parsed = storedObjectActionSchema.safeParse(payloads[description.definition]);
          if (!parsed.success) return invalidPayload(parsed.error.message);
          const action = parsed.data;
          const object = description.action.object;
          if (action.id !== description.action.actionId || (object ? action.target?.className !== object.objectType : action.target !== null))
            return invalidPayload("The execution definition does not match the admitted action and target");
          entries.push([name, { ...describeObjectAction({ name: action.name, declaration: objectActionDeclaration(action) }), target }]);
          continue;
        }
        let inputSchema;
        if (description.statusForm !== undefined) {
          const status = actionStatusFieldSchema.safeParse(payloads[description.statusForm]);
          if (!status.success) return invalidPayload(status.error.message);
          inputSchema = renderActionStatusInputSchema(status.data);
        }
        let reasons: (string | null)[] | undefined;
        if (description.memberInspection) reasons = memberReasons[name];
        if (description.knowledgeApproval) {
          const { read, size } = description.knowledgeApproval;
          const parsed = approvalStatusesSchema.safeParse(payloads[read]);
          if (!parsed.success) return invalidPayload(parsed.error.message);
          if (parsed.data.length !== size) return invalidPayload("The knowledge statuses do not match the selected entries");
          reasons = parsed.data.map(status => approveUnavailableReason({ locale }, status === null ? undefined : { status })?.reason ?? null);
        }
        if (description.opsEvidence) {
          const { read, availability } = description.opsEvidence;
          const parsed = z.literal(availability.approval).safeParse(payloads[read]);
          if (!parsed.success) return invalidPayload(parsed.error.message);
          reasons = (await availability.read()).map(unavailable => unavailable?.reason ?? null);
        }
        if (description.clearObjectDetails) {
          const { read, classes } = description.clearObjectDetails;
          const parsed = z.boolean().safeParse(payloads[read]);
          if (!parsed.success) return invalidPayload(parsed.error.message);
          reasons = await Promise.all(classes.map(async className =>
            (await clearObjectDetailRefusal(domainId, className, parsed.data, locale))?.reason ?? null));
        }
        if (description.skillDeletion !== undefined)
          reasons = [skillDeleteRefusal!(description.skillDeletion)?.reason ?? null];
        if (description.agentDeletion) {
          const deletion = description.agentDeletion;
          if ("reason" in deletion) {
            reasons = [deletion.reason];
          } else {
            const editable = z.boolean().safeParse(payloads[deletion.read]);
            if (!editable.success) return invalidPayload(editable.error.message);
            reasons = [(await agentDeletionRefusal(viewer, deletion.primaryKey, editable.data, locale))?.reason ?? null];
          }
        }
        if (description.applicationDeletions) {
          reasons = [];
          for (const index of description.applicationDeletions) {
            if (results[index].status === "error") {
              reasons.push(applicationDeleteRefusal(undefined, locale)?.reason ?? null);
              continue;
            }
            const parsed = applicationDeleteAvailabilitySchema.safeParse(payloads[index]);
            if (!parsed.success) return invalidPayload(parsed.error.message);
            reasons.push(applicationDeleteRefusal(parsed.data.canMaintain, locale)?.reason ?? null);
          }
        }
        if (description.panelDeletions) {
          const { USE, EDIT } = (results[calls.length] as Extract<JavaPanelReadResult, { status: "ready" }>).visibility!.PANEL;
          reasons = await Promise.all(description.panelDeletions.map(async id =>
            panelDeleteRefusal(await readCataloguePanelInRanges(domainId, id, { USE, EDIT }), locale)?.reason ?? null));
        }
        if (description.deletions) {
          reasons = [];
          for (const deletion of description.deletions) {
            const parsed = deleteRefusalPayloadSchema.safeParse(payloads[deletion]);
            if (!parsed.success) return invalidPayload(parsed.error.message);
            reasons.push(parsed.data.reason);
          }
        }
        const descriptor = await describeServerOperation(description.handler, locale, placement.slot, target, inputSchema);
        if (description.builderProject !== undefined) {
          const reasons = builderReasons.get(description.builderProject)!;
          const operation = description.handler.handlerRef;
          const reason = operation === APPLICATION_SYNC_BUILDER_SOURCE ? reasons.sync
            : operation === APPLICATION_RESTART_BUILD_TEST ? reasons.restart : reasons.publish;
          entries.push([name, reason
            ? { ...descriptor, unavailable: { reason: tForLocale(locale, `panels.appBuilder.${reason}`) } }
            : descriptor]);
          continue;
        }
        if (description.workflowFacts) {
          const { action, reads } = description.workflowFacts;
          const workflowReasons = reads.map(index => {
            const state = workflows.get(index);
            return state === null ? null : workflowLifecycleUnavailable(action, state!, locale);
          });
          const unavailable = workflowReasons.includes(null) ? { reason: workflowText(locale)("notFound") }
            : workflowReasons.every(reason => reason !== undefined) ? workflowReasons[0] : undefined;
          entries.push([name, unavailable ? { ...descriptor, unavailable } : descriptor]);
          continue;
        }
        if (description.attributeFacts) {
          const { operation, className, name: field, attributes, relationships } = description.attributeFacts;
          const result = results[attributes];
          let attribute;
          if (result.status === "ready") {
            const parsed = attributeListPayloadSchema.safeParse(result.payload);
            if (!parsed.success) return invalidPayload(parsed.error.message);
            attribute = parsed.data.views.find(view => view.className === className && view.name === field);
          }
          let unavailable = attributeOperationRefusal(operation, attribute, locale);
          if (!unavailable && relationships !== undefined) {
            const refs = readAttributeRelationshipUses(results[relationships]);
            if (!refs.ok) return refs.response;
            unavailable = attributeReferenceRefusal(refs.uses.get(JSON.stringify([className, field])), locale);
          }
          entries.push([name, unavailable ? { ...descriptor, unavailable } : descriptor]);
          continue;
        }
        entries.push([name, reasons?.every(reason => reason !== null)
          ? { ...descriptor, unavailable: { reason: reasons[0] } }
          : descriptor]);
      }
      return { status: "ready", value: runtimeJsonObjectSchema.parse(Object.fromEntries(entries)) };
    },
  };
}
