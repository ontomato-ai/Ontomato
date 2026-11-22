import { z } from "zod";
import { panelDownloadReceiptSchema } from "@ontomato/contracts/panel-download";
import { AGENT_DEFINITION, DELETE_SKILL, EXPORT_SKILL, IMPORT_SKILL, SKILL } from "@ontomato/contracts/panel-client-requests";
import { panelFileInputSchema, type PanelUploadDeclaration } from "@ontomato/contracts/panel-upload";
import { InvalidSkillPackageError } from "../../core/skills/manifest";
import { tForLocale } from "../../i18n";
import { assertPermission } from "../../identity/installed";
import { HttpError } from "../../utils/errors";
import type {
  PanelImpactInspector,
  PanelOperationActor,
  PanelOperationHost,
  PanelOperationTarget,
  PanelRecordTarget,
  PanelReadServerOperation,
  PanelServerOperation,
  SinglePanelOperationOutcome,
} from "../product-panels/server-operations";
import type { PanelUploadedFile } from "../product-panels/upload-store";

/*
 * The skill owner as panel server operations. `skills.import` takes the skill ZIP the reader staged and installs it
 * through `skillManager.importSkill`; a package whose name exists is refused with its `skillId`, and the same staged file
 * may then be sent again with `overwrite`, which the reader confirms against the named skill. Both are guarded by
 * `skill-management`. `skills.delete` inspects readable agent references before confirmation and delegates deletion to
 * `skillManager.deleteSkill`. Read-only provider and built-in packages, as well as permission denials, surface as owner
 * refusals.
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
  return (await skillManager.getSkillInfo(host.initiator.owner.domainId, target.primaryKey, host.initiator.credentials)).title;
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

const skillPackageUpload = {
  input: "file", accept: [{ mime: "application/zip", extension: ".zip" }], maxBytes: 20 * 1024 * 1024,
} satisfies PanelUploadDeclaration;
const importInputSchema = z.object({
  file: panelFileInputSchema,
  /** Replace the skill of the same name, after the reader confirmed it. */
  overwrite: z.boolean().optional(),
}).strict();
const importResultSchema = z.object({ id: z.string(), title: z.string() }).strict();
const importedInput = (input: Record<string, unknown>) => input as { file: PanelUploadedFile; overwrite?: boolean };

const importSkillImpact: PanelImpactInspector = {
  handlerRef: `${IMPORT_SKILL}.inspect-impact`,
  async inspect({ initiator: { owner, credentials }, locale }, calls) {
    const { file, overwrite } = importedInput(calls[0]!.input);
    if (!overwrite) return null;
    let existing;
    try { existing = await (await loadSkillManager()).importedSkill(owner.domainId, file.bytes, credentials); }
    // An unreadable package needs no confirmation; the import itself refuses it.
    catch (error) { if (error instanceof InvalidSkillPackageError) return null; throw error; }
    if (!existing) return null;
    return {
      summary: tForLocale(locale, "panels.confirmation.overwriteSkillImpact", { skill: existing.title }),
      objects: [{ target: { objectType: SKILL, primaryKey: existing.id }, label: existing.title }],
      total: 1,
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
    handlerRef: IMPORT_SKILL,
    labelKey: "panels.skill.import",
    kind: "action",
    binding: { kind: "PlatformOperation", id: IMPORT_SKILL },
    effect: "write",
    batch: false,
    targetType: SKILL,
    targetSchema: z.null(),
    upload: skillPackageUpload,
    inputSchema: importInputSchema,
    resultSchema: importResultSchema,
    inspectImpact: importSkillImpact,
    async execute(host: PanelOperationHost, _target: null, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const { file, overwrite } = importedInput(input);
      const { owner, credentials } = host.executor;
      const { locale } = credentials;
      try {
        await assertPermission(credentials, skillManagementPermissions);
        const skill = await (await loadSkillManager()).importSkill(owner.domainId, file.bytes, credentials, overwrite === true);
        return {
          kind: "success",
          message: tForLocale(locale, "panels.skill.imported", { skill: skill.title }),
          data: { id: skill.id, title: skill.title },
          affected: { objects: [{ objectType: SKILL, primaryKey: skill.id }], objectTypes: [SKILL] },
        };
      } catch (error) {
        if (error instanceof InvalidSkillPackageError)
          return { kind: "refusal", code: error.code, message: tForLocale(locale, "panels.skill.invalidPackage", { reason: error.message }) };
        if (!(error instanceof HttpError) || error.status >= 500) throw error;
        if (error.code === "SKILL_EXISTS") {
          const { skillId } = error.details as { skillId: string };
          return { kind: "refusal", code: error.code, message: tForLocale(locale, "panels.skill.importExists", { skill: skillId }), details: { skillId } };
        }
        return { kind: "refusal", code: error.code ?? "SKILL_IMPORT_REFUSED", message: skillRefusalMessage(error, locale) };
      }
    },
  },
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
    done: (host, name) => tForLocale(host.locale, "panels.skill.deleted", { name }),
    inspectImpact: deleteSkillImpact,
    async unavailable(host: PanelOperationHost, target: PanelRecordTarget) {
      const skillManager = await loadSkillManager();
      let info;
      try { info = await skillManager.getSkillInfo(host.initiator.owner.domainId, target.primaryKey, host.initiator.credentials); }
      catch (error) { if (error instanceof HttpError && error.status < 500) return undefined; throw error; }
      if (info.writeRestriction === null) return undefined;
      return {
        reason: info.writeRestriction.kind === "public"
          ? tForLocale(host.locale, "panels.skill.readOnlyPublic")
          : tForLocale(host.locale, "panels.skill.readOnlyProvider", { provider: info.writeRestriction.providerName }),
      };
    },
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
            removed: [{ objectType: SKILL, primaryKey: target.primaryKey }],
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

export const skillExportOperation = {
  handlerRef: EXPORT_SKILL,
  labelKey: "panels.skill.export",
  kind: "action",
  binding: { kind: "PlatformOperation", id: EXPORT_SKILL },
  effect: "read",
  batch: false,
  targetType: SKILL,
  target: { source: "input", input: "skill" },
  targetSchema: skillObjectTarget,
  inputSchema: deleteInputSchema,
  resultSchema: panelDownloadReceiptSchema,
  async execute({ executor: { owner, credentials } }, call) {
    const { primaryKey } = skillObjectTarget.parse(call.target);
    const skillManager = await loadSkillManager();
    const bytes = await skillManager.exportSkill(owner.domainId, primaryKey, credentials);
    return { kind: "file", bytes: new Uint8Array(bytes), suggestedName: `${primaryKey}.zip`, mime: "application/zip" };
  },
} satisfies PanelReadServerOperation & { labelKey: string };
