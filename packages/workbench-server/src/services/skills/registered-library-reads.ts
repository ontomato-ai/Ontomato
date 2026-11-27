import { panelReadParameterSchemas } from "@ontomato/contracts/panel-projection";
import { skillEditorAccessDecisionSchema, skillEditorAccessRequestSchema } from "@ontomato/contracts/skill-editor-access";
import { SKILL } from "@ontomato/contracts/platform-object-types";
import { z } from "zod";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { agentObject } from "../assistant/authorization";
import { readAgentDefinitionRow } from "../assistant/definitions";
import type { ProductOwner } from "../product-governance/service-authentication";
import type { PanelReadSelection } from "../product-panels/panel-owner-reads";
import { ownerReadRegistration, type RegisteredDataReadRegistration } from "../product-panels/registered-data-read";
import { createSkillReadAdapter, type SkillResolveRequest } from "./panel-reads";
import { readSkillView } from "./view";

const skillLibraryAccessCall = { type: SKILL, name: "count", parameters: {} };

export function prepareSkillLibraryRead(
  owner: ProductOwner, credentials: AssistantCredentials, selection: PanelReadSelection, params: Record<string, unknown>,
) {
  const { typeId, method, primaryKey } = selection;
  if (typeId !== SKILL || (method !== "count" && method !== "query" && method !== "record" && method !== "files" && method !== "file")) return;
  return {
    call: skillLibraryAccessCall,
    async present(payload: unknown) {
      z.literal(true).parse(payload);
      const reads = createSkillReadAdapter(owner, credentials, undefined, await readSkillView(owner.domainId, credentials));
      if (method === "count") return reads.count();
      if (method === "query") return reads.query(params);
      return reads[method](primaryKey!, params);
    },
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

export const skillDataReadRegistrations: RegisteredDataReadRegistration[] = [
  ...(["count", "query", "record", "files", "file"] as const).map(method =>
    ownerReadRegistration(SKILL, method, ({ owner, credentials, selection, params }) =>
      prepareSkillLibraryRead(owner, credentials, selection, params))),
  ...(["options", "resolve"] as const).map(method =>
    ownerReadRegistration(SKILL, method, ({ owner, credentials, selection, params }) =>
      prepareSkillSelectorRead(owner, credentials, selection, params))),
];
