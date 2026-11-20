import { z } from "zod";
import { AGENT_DEFINITION, DELETE_SKILL, SKILL } from "@ontomato/contracts/panel-client-requests";
import { tForLocale } from "../../i18n";
import { assertPermission } from "../../identity/installed";
import { HttpError } from "../../utils/errors";
import type {
  PanelImpactInspector,
  PanelOperationActor,
  PanelOperationHost,
  PanelOperationTarget,
  PanelRecordTarget,
  PanelServerOperation,
  SinglePanelOperationOutcome,
} from "../product-panels/server-operations";

/*
 * The skill owner as a panel server operation: `skills.delete`, guarded by `skill-management`, inspecting readable
 * agent references before confirmation and delegating deletion to `skillManager.deleteSkill`. Read-only provider and
 * built-in packages, as well as permission denials, surface as owner refusals.
 */

const skillManagementPermissions = ["skill-management"] as const;

const skillObjectTarget = z.object({
  kind: z.literal("object"),
  objectType: z.literal(SKILL),
  primaryKey: z.string().min(1),
}).strict();

const deleteInputSchema = z.object({}).strict();
const emptyResultSchema = z.object({}).strict();

const loadSkillManager = async () => (await import("./skill-manager")).skillManager;

async function referenceAccess({ owner, credentials }: PanelOperationActor) {
  const { filterReadableAgentDefinitions } = await import("../assistant/definitions");
  return {
    credentials,
    readableAgentIds: (ids: readonly string[]) => filterReadableAgentDefinitions(owner, credentials, ids),
  };
}

async function skillTitle(host: PanelOperationHost, target: PanelRecordTarget): Promise<string> {
  const skillManager = await loadSkillManager();
  const found = (await skillManager.getAllSkills(host.initiator.owner.domainId, host.initiator.credentials))
    .find(skill => skill.id === target.primaryKey);
  if (!found) throw new HttpError(404, "Skill not found", "SKILL_NOT_FOUND");
  return found.title;
}

const deleteSkillImpact: PanelImpactInspector = {
  handlerRef: `${DELETE_SKILL}.inspect-impact`,
  async inspect(host, calls) {
    const skillManager = await loadSkillManager();
    const target = calls[0]!.target as PanelRecordTarget;
    const agents = await skillManager.getSkillReferences(
      host.initiator.owner.domainId,
      target.primaryKey,
      await referenceAccess(host.initiator),
    );
    return {
      summary: tForLocale(host.locale, "panels.confirmation.deleteSkillImpact", { count: agents.length }),
      objects: agents.map(agent => ({
        target: { objectType: AGENT_DEFINITION, primaryKey: agent.id },
        label: agent.name,
      })),
      total: agents.length,
    };
  },
};

function skillRefusalMessage(error: HttpError, locale?: string): string {
  if (error.code === "PUBLIC_SKILL_READ_ONLY") return tForLocale(locale, "panels.skill.readOnlyPublic");
  if (error.code === "SKILL_PROVIDER_READ_ONLY")
    return tForLocale(locale, "panels.skill.readOnlyProvider", { provider: (error.details as { providerName: string }).providerName });
  return error.message;
}

export const skillServerOperations = [
  {
    handlerRef: DELETE_SKILL,
    labelKey: "panels.skill.delete",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_SKILL },
    effect: "write",
    batch: false,
    targetType: SKILL,
    targetInput: "skill",
    targetSchema: skillObjectTarget,
    inputSchema: deleteInputSchema,
    resultSchema: emptyResultSchema,
    targetLabel: skillTitle,
    inspectImpact: deleteSkillImpact,
    async execute(host: PanelOperationHost, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Delete acts on a selected skill");
      const { owner, credentials } = host.executor;
      try {
        await assertPermission(credentials, skillManagementPermissions);
        const skillManager = await loadSkillManager();
        const result = await skillManager.deleteSkill(owner.domainId, target.primaryKey, await referenceAccess(host.executor));
        return {
          kind: "success",
          data: {},
          affected: {
            objects: [
              { objectType: SKILL, primaryKey: target.primaryKey },
              ...result.affectedAgents.map(agent => ({ objectType: AGENT_DEFINITION, primaryKey: agent.id })),
            ],
            objectTypes: result.cleanedAgentCount > 0 ? [SKILL, AGENT_DEFINITION] : [SKILL],
          },
        };
      } catch (error) {
        if (!(error instanceof HttpError) || error.status >= 500) throw error;
        return {
          kind: "refusal",
          code: error.code ?? "SKILL_DELETE_REFUSED",
          message: skillRefusalMessage(error, credentials.locale),
        };
      }
    },
  },
] satisfies readonly PanelServerOperation[];
