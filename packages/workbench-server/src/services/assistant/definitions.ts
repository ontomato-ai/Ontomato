import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { validateModelSelection } from "../../platform/agent-runtime/model-selection";
import {
  assistantAgentDefinitionSchema,
  type AssistantAgentInput,
  type AssistantAgentUpdateInput,
  type AssistantAgentValidation,
} from "@ontomato/contracts/assistant-chat";

import {
  getPostgresPool,
  qualifiedTable as t,
} from "../../infrastructure/postgres";
import { assistantStore, type AssistantOwner, type AgentRow } from "./store";
import { HttpError } from "../../utils/errors";
import { assertPermission } from "../../identity/installed";
import { resolveAssistantSkillReferences } from "./skill-references";
import { AgentDefinitionFieldError, parseAgentDefinitionUpdateForm } from "./definition-form-schema";
import type { PanelFormValues } from "@ontomato/contracts/panel-projection";
import { applySubmittedFields } from "../product-panels/submitted-form-values";
import {
  hasHiddenAssistantSkillRefs,
  readAssistantSkillView,
  validateAssistantSkills,
  visibleAssistantSkillRefs,
  type AssistantSkillView,
} from "./skills";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { tForLocale } from "../../i18n";
import { withDomainSkills } from "../skills/operations";
import { effectiveSystemPrompt, storedSystemPrompt } from "./prompts";
import { assistantName, assistantDescription } from "./labels";
import {isAppBuilderKind} from '../app-builder/definition';
import {transaction} from '../../infrastructure/postgres-transaction';
import {lockProducts} from '../product-assets/store';
import {synchronizeNativeProfile} from '../product-assets/platform-assets';
import { validateExecutionSetting, prepareExecutionSetting } from "./execution-setting";
const view = (a: AgentRow, locale?: string) =>
  assistantAgentDefinitionSchema.parse({
    id: a.id,
    executionUserId: a.execution_user_id,
    name: assistantName(a, locale),
    description: assistantDescription(a, locale),
    icon: a.icon ?? null,
    enabled: a.enabled,
    modelSelection: a.model_selection,
    skills: a.skills,
    classNames: a.class_names,
    enabledMcpServiceIds: a.enabled_mcp_service_ids,
    sortOrder: a.sort_order,
    systemPrompt: effectiveSystemPrompt(a, locale),
  });
export const agentDefinitionPermissions = ["analysis-agent"] as const;
const isReadableDefinition = (kind: string) => !isAppBuilderKind(kind);

export async function filterReadableAgentDefinitions(
  owner: AssistantOwner, credentials: AssistantCredentials, ids: readonly string[],
): Promise<ReadonlySet<string>> {
  try {
    await assertPermission(credentials, agentDefinitionPermissions);
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) return new Set();
    throw error;
  }
  const { rows } = await getPostgresPool().query<Pick<AgentRow, "id" | "kind">>(
    `SELECT id,kind FROM ${t("assistant_agents")} WHERE domain_id=$1 AND id=ANY($2::uuid[])`,
    [owner.domainId, ids],
  );
  return new Set(rows.filter(({ kind }) => isReadableDefinition(kind)).map(({ id }) => id));
}

async function editableAgent(id: string, owner: AssistantOwner, client?: Parameters<typeof assistantStore.agent>[2]) {
  const agent = await assistantStore.agent(id, owner, client);
  if (!isReadableDefinition(agent.kind)) throw new HttpError(404, "Agent definition not found", "NOT_FOUND");
  return agent;
}
export async function readStoredAgentDefinition(id: string, owner: AssistantOwner, locale?: string) {
  return view(await editableAgent(id, owner), locale);
}

export function projectAgentDefinitionSkills(
  definition: Awaited<ReturnType<typeof readStoredAgentDefinition>>,
  skillView: AssistantSkillView,
) {
  return { ...definition, skills: visibleAssistantSkillRefs(definition.skills, skillView) };
}

export async function readAgentDefinition(id: string, owner: AssistantOwner, credentials: AssistantCredentials) {
  const definition = await readStoredAgentDefinition(id, owner, credentials.locale);
  return projectAgentDefinitionSkills(definition, await readAssistantSkillView(owner.domainId, credentials));
}
export interface AgentDefinitionSkillSelection {
  credentials: AssistantCredentials;
  view: AssistantSkillView;
}

/** The operator governs execution settings; the initiator's view governs the skill selection. */
export async function checkedDefinition(
  input: AssistantAgentUpdateInput,
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  oldExecutionUserId: string | null,
  oldSkills: readonly RuntimeSkillRef[],
  selection?: AgentDefinitionSkillSelection,
) {
  const executionUserId = input.executionUserId === undefined ? oldExecutionUserId : input.executionUserId;
  try {
    await validateExecutionSetting(owner, oldExecutionUserId, executionUserId, credentials);
  } catch (error) {
    if (error instanceof HttpError && (error.status === 400 || error.status === 403) && executionUserId !== oldExecutionUserId) {
      throw AgentDefinitionFieldError.fromOption(error, "/executionUserId", "invalid_option");
    }
    throw error;
  }
  try {
    await validateModelSelection(owner.domainId, input.modelSelection);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 400 || error.code !== "INVALID_REQUEST") throw error;
    throw AgentDefinitionFieldError.fromOption(error, "/modelSelection/modelId", "target_unavailable");
  }
  if (input.skills === undefined) return { executionUserId };
  const access = selection ?? { credentials, view: await readAssistantSkillView(owner.domainId, credentials) };
  if (hasHiddenAssistantSkillRefs(oldSkills, access.view)) {
    const message = tForLocale(access.credentials.locale, "panels.agentForm.hiddenSkillSelection");
    throw new AgentDefinitionFieldError(403, message, "SKILL_SELECTION_INCOMPLETE", [
      { field: "/skills", code: "target_unavailable", message },
    ]);
  }
  oldSkills.forEach(ref => access.view.requireCertainStoredSkill(ref));
  try {
    const skills = resolveAssistantSkillReferences(input.skills, owner.domainId);
    await validateAssistantSkills(owner.domainId, skills, access.credentials, access.view);
    return { skills, executionUserId };
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 400 || !["SKILL_NOT_FOUND", "INVALID_REQUEST"].includes(error.code ?? "")) throw error;
    throw AgentDefinitionFieldError.fromOption(error, "/skills", "invalid_option");
  }
}
export async function validateAgentDefinition(
  draft: AssistantAgentValidation,
  owner: AssistantOwner,
  credentials: AssistantCredentials,
) {
  const old = "id" in draft.target ? await editableAgent(draft.target.id, owner) : null;
  await checkedDefinition(draft.form, owner, credentials, old?.execution_user_id ?? null, old?.skills ?? []);
}
export async function saveAgentDefinition(
  id: string, input: AssistantAgentUpdateInput, owner: AssistantOwner, credentials: AssistantCredentials,
) {
  const { definition, skillView } = await saveAgentDefinitionSnapshot(id, input, owner, credentials);
  return projectAgentDefinitionSkills(definition, skillView);
}

type SubmittedAgentUpdate = { values: PanelFormValues; submittedFields: readonly string[] };

export async function saveAgentDefinitionSnapshot(
  id: string,
  update: AssistantAgentUpdateInput | SubmittedAgentUpdate,
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  selection?: AgentDefinitionSkillSelection,
) {
  const locale = credentials.locale;
  return withDomainSkills(owner.domainId, async () => {
    const access = selection ?? { credentials, view: await readAssistantSkillView(owner.domainId, credentials) };
    const definition = await transaction(async client => {
      await lockProducts(client, owner);
      const agent = await editableAgent(id, owner, client);
      const current = view(agent, locale);
      const partial = "submittedFields" in update ? update : undefined;
      if (partial?.submittedFields.length === 0) return current;
      const changed = (field: keyof AssistantAgentUpdateInput) =>
        partial === undefined || partial.submittedFields.some(path => path === `/${field}` || path.startsWith(`/${field}/`));

      let input: AssistantAgentUpdateInput;
      if ("submittedFields" in update) {
        const { id: _id, sortOrder: _sortOrder, ...stored } = current;
        const values = applySubmittedFields(stored, update.values, update.submittedFields);
        if (!changed("skills")) delete values.skills;
        input = parseAgentDefinitionUpdateForm(values);
      } else {
        input = update;
      }
      const { skills, executionUserId } = await checkedDefinition(input, owner, credentials, agent.execution_user_id, agent.skills, access);
      if (input.executionUserId != null && input.executionUserId !== agent.execution_user_id)
        await prepareExecutionSetting(owner, agent.execution_user_id, input.executionUserId, credentials);

      const assignments: string[] = [];
      const parameters: unknown[] = [id, owner.domainId];
      const set = (field: keyof AssistantAgentUpdateInput, column: string, value: unknown) => {
        if (changed(field) && value !== undefined) {
          parameters.push(value);
          assignments.push(`${column}=$${parameters.length}`);
        }
      };
      set("name", "name", input.name === assistantName(agent, locale) ? agent.name : input.name);
      set("description", "description", input.description === assistantDescription(agent, locale) ? agent.description : input.description);
      set("enabled", "enabled", input.enabled);
      set("systemPrompt", "system_prompt", storedSystemPrompt(agent.kind, input.systemPrompt, locale));
      set("modelSelection", "model_selection", JSON.stringify(input.modelSelection));
      set("modelSelection", "model_reference_migrated", true);
      set("icon", "icon", input.icon);
      set("classNames", "class_names", JSON.stringify(input.classNames));
      set("enabledMcpServiceIds", "enabled_mcp_service_ids", JSON.stringify(input.enabledMcpServiceIds));
      set("sortOrder", "sort_order", input.sortOrder);
      set("executionUserId", "execution_user_id", executionUserId);
      set("skills", "skills", skills === undefined ? undefined : JSON.stringify(skills));
      if (!assignments.length) return current;

      const { rows: [saved] } = await client.query<AgentRow>(
        `UPDATE ${t("assistant_agents")} SET ${assignments.join(",")} WHERE id=$1 AND domain_id=$2 RETURNING *`,
        parameters,
      );
      if (!saved) throw new HttpError(404, "Agent definition not found", "NOT_FOUND");
      await synchronizeNativeProfile(client, owner, saved, locale);
      return view(saved, locale);
    });
    return { definition, skillView: access.view };
  });
}
export async function createAgentDefinition(
  id: string, input: AssistantAgentInput, owner: AssistantOwner, credentials: AssistantCredentials,
) {
  const { definition, skillView } = await createAgentDefinitionSnapshot(id, input, owner, credentials);
  return projectAgentDefinitionSkills(definition, skillView);
}

export async function createAgentDefinitionSnapshot(
  id: string,
  input: AssistantAgentInput,
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  selection?: AgentDefinitionSkillSelection,
) {
  return withDomainSkills(owner.domainId, async () => {
    const access = selection ?? { credentials, view: await readAssistantSkillView(owner.domainId, credentials) };
    const { skills, executionUserId } = await checkedDefinition(input, owner, credentials, null, [], access);
    const pool = getPostgresPool();
    const existing = (
      await pool.query(
        `SELECT domain_id FROM ${t("assistant_agents")} WHERE id=$1`,
        [id],
      )
    ).rows[0];
    // An id is owned by its domain: reusing it elsewhere is a conflict, not a missing agent.
    if (existing && existing.domain_id !== owner.domainId)
      throw new HttpError(409, "Idempotency key reused", "IDEMPOTENCY_CONFLICT");
    if (input.executionUserId != null)
      await prepareExecutionSetting(owner, null, input.executionUserId, credentials);
    const inserted = await pool.query(
      `INSERT INTO ${t("assistant_agents")} (id,domain_id,kind,name,description,enabled,system_prompt,model_selection,skills,icon,class_names,enabled_mcp_service_ids,sort_order,execution_user_id) VALUES($1::uuid,$2,($1::uuid)::text,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
      [
        id,
        owner.domainId,
        input.name,
        input.description,
        input.enabled,
        input.systemPrompt,
        JSON.stringify(input.modelSelection),
        JSON.stringify(skills),
        input.icon,
        JSON.stringify(input.classNames),
        JSON.stringify(input.enabledMcpServiceIds),
        assistantAgentDefinitionSchema.shape.sortOrder.parse(input.sortOrder),
        executionUserId,
      ],
    );
    const actual = await readStoredAgentDefinition(id, owner);
    // The insert won: this call created the definition, so there is nothing to replay. A write that
    // changed nothing means the same id was replayed, which is only valid with the same definition.
    if (!inserted.rowCount) {
      const expected = assistantAgentDefinitionSchema
        .omit({ id: true })
        .parse({ ...input, executionUserId, skills, modelSelection: input.modelSelection });
      const same = (Object.keys(expected) as (keyof typeof expected)[]).every(
        (key) => JSON.stringify(actual[key]) === JSON.stringify(expected[key]),
      );
      if (!same)
        throw new HttpError(
          409,
          "Idempotency key reused",
          "IDEMPOTENCY_CONFLICT",
        );
    }
    return { definition: actual, skillView: access.view };
  });
}

export async function listAgentDefinitions(owner: AssistantOwner, credentials: AssistantCredentials) {
  const [agents, skillView] = await Promise.all([
    assistantStore.agents(owner.domainId), readAssistantSkillView(owner.domainId, credentials),
  ]);
  return { agents: agents.map(agent => projectAgentDefinitionSkills(view(agent, credentials.locale), skillView)) };
}
export async function deleteAgentDefinition(id: string, owner: AssistantOwner) {
  await editableAgent(id, owner);
  await getPostgresPool().query(
    `DELETE FROM ${t("assistant_agents")} WHERE id=$1 AND domain_id=$2`,
    [id, owner.domainId],
  );
}
