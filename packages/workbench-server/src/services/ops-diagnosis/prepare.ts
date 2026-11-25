import path from "node:path";
import { ARTIFACT_CHART_SKILLS, ARTIFACT_MARKDOWN_PROMPT } from "@ontomato/contracts/agent-artifact-markdown";
import type { RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import type { RuntimeBusinessCallbacks } from "@ontomato/contracts/agent-runtime-business-callbacks";
import { environment } from "../../config/environment";
import { workbenchServerResourceRoot } from "../../content/resources";
import { renderPrompt } from "../../core/prompts/loader";
import { resolveLocale } from "../../i18n";
import { runDefinition } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { agentVisibilityPrompt } from "../agent-host/visibility";
import { callbackCredential } from "../agent-runtime/callback-credential";
import { publishSkill } from "../agent-runtime/skills";
import type { AssistantPreparation } from "../assistant/prepare";
import { prepareCurrentPageSkill } from "../assistant/skills";
import { OPS_DIAGNOSIS_SKILL } from "./definition";

/**
 * Prepares an operations diagnosis turn on the unified `assistant_sessions` host.
 * Dispatched by agent definition `kind === "ops-diagnosis"` rather than a hardcoded agent ID.
 */
export async function prepareOpsDiagnosisRun({
  a,
  turn,
  input,
  owner,
  credentials,
  pageSkillContext,
  reader,
}: AssistantPreparation): Promise<RuntimeStartRunRequest> {
  const language = resolveLocale(credentials.locale);
  const { skillRegistryManager } = await import("../../core/skills/registry/manager");
  const publicSkills = await skillRegistryManager.publicSkills();
  const chartSources = ARTIFACT_CHART_SKILLS.map((ref) => {
    const source = publicSkills.find(({ id }) => id === ref.name);
    if (!source) throw new HttpError(422, "A diagnosis chart skill is unavailable", "SKILL_NOT_FOUND");
    return { root: source.path, ref };
  });
  const [published, pagePrepared] = await Promise.all([
    Promise.all([
      publishSkill(path.join(workbenchServerResourceRoot, "resources/runtime-skills/ops-diagnosis"), OPS_DIAGNOSIS_SKILL),
      ...chartSources.map(({ root, ref }) => publishSkill(root, ref)),
    ]),
    pageSkillContext ? prepareCurrentPageSkill(owner.domainId, credentials, pageSkillContext, owner.userId) : Promise.resolve(null),
  ]);
  const skills = [
    ...published.map(({ skill, digest }) => ({ skill, digest })),
    ...(pagePrepared ? [pagePrepared.skill] : []),
  ];
  const pageControl = pagePrepared !== null;
  const instructions = [
    renderPrompt("diagnosis-agent.main.system", {}, language),
    ARTIFACT_MARKDOWN_PROMPT,
    ...(reader ? [agentVisibilityPrompt(reader)] : []),
    ...(pagePrepared?.currentPage
      ? [`Current panel placement for this turn (data):\n${JSON.stringify(pagePrepared.currentPage)}`]
      : []),
  ].join("\n\n");
  const definition = runDefinition(
    instructions,
    a.model_selection.modelId,
    skills,
    language,
    [],
    pageControl,
  );
  definition.agentId = a.id;

  const callbackRoot = environment.agentRuntime().callbackUrl.replace(/\/$/, "");
  const evidencePath = "/api/observe/evidence";
  const evidenceUrl = callbackRoot + evidencePath;
  const expiresAt = Date.now() + definition.sandbox.limits.wallTimeMs;
  const businessCallbacks: RuntimeBusinessCallbacks = {
    workbench: {
      owner: "workbench",
      baseUrl: evidenceUrl,
      pathPrefix: new URL(evidenceUrl).pathname,
      credentialHeader: "X-Ontomato-Callback-Credential",
      credential: callbackCredential({
        scope: { purpose: "diagnosis-evidence" },
        runId: turn.id,
        expiresAt,
        token: credentials.token ?? "",
        apiKey: credentials.apiKey ?? "",
      }).value,
    },
    ...(pageControl
      ? (() => {
          const panelPath = `/api/assistant/executions/${turn.id}/panels`;
          const panelUrl = callbackRoot + panelPath;
          return {
            panelOperations: {
              owner: "workbench" as const,
              baseUrl: panelUrl,
              pathPrefix: new URL(panelUrl).pathname,
              credentialHeader: "X-Ontomato-Callback-Credential",
              credential: callbackCredential({
                scope: { purpose: "execution", capability: "panels" },
                runId: turn.id,
                expiresAt,
                token: credentials.token ?? "",
                apiKey: credentials.apiKey ?? "",
              }).value,
            },
          };
        })()
      : {}),
  };

  return {
    language,
    input,
    definition,
    businessCallbacks,
  };
}
