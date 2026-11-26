import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { skillWriteRestriction } from "../../core/skills/types";
import { panelReadParameterSchemas, type PanelRecord } from "@ontomato/contracts/panel-projection";
import { skillEditorAccessDecisionSchema, skillEditorAccessRequestSchema } from "@ontomato/contracts/skill-editor-access";
import { DELETE_SKILL, SKILL } from "@ontomato/contracts/platform-object-types";
import { z } from "zod";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { agentObject } from "../assistant/authorization";
import { readAgentDefinitionRow } from "../assistant/definitions";
import { objectDecisionSchema } from "../product-governance/authorization";
import { presentRowOperationsForRows } from "../product-panels/direct-operations";
import type { ProductOwner } from "../product-governance/service-authentication";
import type { PanelReadSelection } from "../product-panels/panel-owner-reads";
import { createSkillReadAdapter, type SkillResolveRequest } from "./panel-reads";
import { skillDeleteRefusal } from "./panel-operations";
import { readSkillView } from "./view";

const skillLibraryAccessCall = { type: SKILL, name: "count", parameters: {} };

export function prepareSkillLibraryRead(
  owner: ProductOwner, credentials: AssistantCredentials, selection: PanelReadSelection, params: Record<string, unknown>,
  projection: ProductProjection,
) {
  const { typeId, method, primaryKey } = selection;
  if (typeId !== SKILL || (method !== "count" && method !== "query" && method !== "record" && method !== "files" && method !== "file")) return;
  const rowDeletes = method === "query" ? Object.fromEntries(Object.entries(projection.operations ?? {}).filter(([, { operation, target }]) =>
    operation.kind === "PlatformOperation" && operation.id === DELETE_SKILL && target && "row" in target)) : {};
  const describeDeletes = Object.keys(rowDeletes).length > 0;
  return {
    call: describeDeletes ? { type: SKILL, name: "queryWithDeleteAccess", parameters: {} } : skillLibraryAccessCall,
    async present(payload: unknown) {
      if (!describeDeletes) z.literal(true).parse(payload);
      const reads = createSkillReadAdapter(owner, credentials, undefined, await readSkillView(owner.domainId, credentials));
      if (method === "count") return reads.count();
      if (method === "query") return reads.query(params);
      return reads[method](primaryKey!, params);
    },
    rowOperations: describeDeletes ? (payload: unknown, inputs: Readonly<Record<string, unknown>>, rows: readonly PanelRecord[]) => {
      const decision = objectDecisionSchema.parse(payload);
      return presentRowOperationsForRows({ ...projection, operations: rowDeletes }, inputs, rows, SKILL, (_handler, _binding, targets) =>
        new Map(targets.flatMap(({ rowKey, row }) => {
          const reason = decision.allowed ? row.fields.writeRestriction as string : decision.reason;
          return reason ? [[rowKey, { reason }]] : [];
        })));
    } : undefined,
  };
}

export async function prepareSkillSelectorRead(
  owner: ProductOwner, credentials: AssistantCredentials, selection: PanelReadSelection, params: Record<string, unknown>,
) {
  const { typeId, method } = selection;
  if (typeId !== SKILL || (method !== "options" && method !== "resolve")) return;
  const agentTarget = panelReadParameterSchemas.agentSkillTarget.parse(params.agentTarget);
  const currentAgent = agentTarget === "draft" ? undefined : agentObject(await readAgentDefinitionRow(agentTarget, owner));
  const parameters = skillEditorAccessRequestSchema.parse({ agentTarget, ...currentAgent });
  return {
    call: { type: SKILL, name: "editorAccess", parameters },
    present(payload: unknown) {
      const decision = skillEditorAccessDecisionSchema.parse(payload);
      if (!decision.allowed) throw new HttpError(403, decision.reason ?? "", decision.code ?? undefined);
      const reads = createSkillReadAdapter(owner, credentials);
      return method === "options" ? reads.options() : reads.resolve({ values: params.values as SkillResolveRequest["values"] });
    },
  };
}

export const skillDeleteAccessCall = { type: SKILL, name: "deleteAccess", parameters: {} };

export async function prepareSkillDeleteRefusal(owner: ProductOwner, credentials: AssistantCredentials, payload: unknown) {
  const decision = objectDecisionSchema.parse(payload);
  if (!decision.allowed) return (_primaryKey: string) => ({ reason: decision.reason });
  const { registry } = await readSkillView(owner.domainId, credentials);
  return (primaryKey: string) => {
    const skill = registry.getSkillById(primaryKey);
    return skill ? skillDeleteRefusal(skillWriteRestriction(skill), credentials.locale) : undefined;
  };
}
