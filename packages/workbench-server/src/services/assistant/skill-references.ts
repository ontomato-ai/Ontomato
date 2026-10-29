import type { AnalysisAgentSkillReference } from "@ontomato/contracts/skills";
import type { AssistantAgentInput } from "@ontomato/contracts/assistant-chat";
import { runtimeSkillRefSchema, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { HttpError } from "../../utils/errors";
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
      throw new HttpError(403, "Skill belongs to another domain");
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
  skill: RuntimeSkillRef,
): Promise<AnalysisAgentSkillReference[]> {
  return (
    await getPostgresPool().query(
      `SELECT id,name FROM ${t("assistant_agents")} WHERE domain_id=$1 AND skills @> $2::jsonb`,
      [
        domainId,
        JSON.stringify([skill]),
      ],
    )
  ).rows.map((r) => ({ ...r, usesAnalysis: true, usesVisualization: false }));
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
