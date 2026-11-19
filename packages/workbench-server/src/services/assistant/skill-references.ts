import type { AnalysisAgentSkillReference } from "@ontomato/contracts/skills";
import type { AssistantAgentInput } from "@ontomato/contracts/assistant-chat";
import { runtimeSkillRefSchema, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { HttpError } from "../../utils/errors";
import { isAppBuilderKind } from "../app-builder/definition";
import {
  getPostgresPool,
  qualifiedTable as t,
} from "../../infrastructure/postgres";
export function resolveAssistantSkillReferences(
  skills: AssistantAgentInput["skills"],
  domainId: string,
) {
  return skills.map((skill) => {
    if (
      skill.namespace.kind === "domain" &&
      skill.namespace.domainId !== undefined &&
      skill.namespace.domainId !== domainId
    )
      throw new HttpError(400, "Skill is not in this domain's catalogue", "SKILL_NOT_FOUND");
    return runtimeSkillRefSchema.parse({
      ...skill,
      namespace:
        skill.namespace.kind === "domain"
          ? { kind: "domain", domainId }
          : skill.namespace,
    });
  });
}
export async function listAnalysisAgentSkillReferences(
  domainId: string,
  skills: readonly RuntimeSkillRef[],
) {
  const { rows } = await getPostgresPool().query<{ id: string; name: string; kind: string }>(
    `SELECT id,name,kind FROM ${t("assistant_agents")}
     WHERE domain_id=$1 AND EXISTS (
       SELECT 1 FROM jsonb_array_elements($2::jsonb) selected(ref)
       WHERE skills @> jsonb_build_array(selected.ref)
     )`,
    [domainId, JSON.stringify(skills)],
  );
  const reference = ({ id, name }: (typeof rows)[number]): AnalysisAgentSkillReference =>
    ({ id, name, usesAnalysis: true, usesVisualization: false });
  return {
    all: rows.map(reference),
    readable: rows.filter(row => !isAppBuilderKind(row.kind)).map(reference),
  };
}
export async function removeAnalysisAgentSkillReferences(
  domainId: string,
  skillId: string,
) {
  const r = await getPostgresPool().query(
    `UPDATE ${t("assistant_agents")} SET skills=(SELECT COALESCE(jsonb_agg(s),'[]') FROM jsonb_array_elements(skills) s WHERE NOT (s->>'name'=$2 AND s->'namespace'->>'kind'='domain')) WHERE domain_id=$1 AND skills @> $3::jsonb`,
    [
      domainId,
      skillId,
      JSON.stringify([
        { namespace: { kind: "domain", domainId }, name: skillId },
      ]),
    ],
  );
  return r.rowCount ?? 0;
}
export async function restoreAnalysisAgentSkillReferences(
  domainId: string,
  skillId: string,
  refs: AnalysisAgentSkillReference[],
) {
  for (const r of refs)
    await getPostgresPool().query(
      `UPDATE ${t("assistant_agents")} SET skills=skills || $3::jsonb WHERE domain_id=$1 AND id=$2 AND NOT skills @> $3::jsonb`,
      [
        domainId,
        r.id,
        JSON.stringify([
          { namespace: { kind: "domain", domainId }, name: skillId },
        ]),
      ],
    );
}
