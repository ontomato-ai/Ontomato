import { z } from "zod";
import { runtimeSkillKey, runtimeSkillRefSchema, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import {
  panelReadParameterSchemas,
  type PanelOption,
  type PanelOptionList,
  type PanelRecord,
  type PanelRecordQuery,
} from "@ontomato/contracts/panel-projection";
import type { SkillCatalogDiagnostics, SkillInfo, SkillWriteRestriction } from "@ontomato/contracts/skills";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { assistantSkillCatalog } from "../assistant/skills";
import type { ProductOwner } from "../product-governance/service-authentication";
import { skillManager } from "./skill-manager";
import { skillDeleteRefusal } from "./panel-operations";
import { type SkillView } from "./view";

/*
 * The skill owner's named reads for panels:
 * - `options` and `resolve` answer a reference picker from the catalogue the initiating reader can see.
 * - `query`, `record`, `files`, and `file` browse the skill library and its package files through `skillManager`,
 *   marking read-only provider and public packages in each row.
 */

/** The values a form already holds, each a complete skill reference, in their submitted order. */
export interface SkillResolveRequest {
  values: readonly RuntimeSkillRef[];
}

export type SkillReads = {
  count(): Promise<PanelRecordQuery>;
  options(): Promise<PanelOptionList>;
  resolve(request: SkillResolveRequest): Promise<PanelOptionList>;
  query(params: Record<string, unknown>): Promise<PanelRecordQuery>;
  record(primaryKey: string): Promise<PanelRecord>;
  files(primaryKey: string): Promise<PanelRecord[]>;
  file(primaryKey: string, params: Record<string, unknown>): Promise<PanelRecord>;
};

const queryInputSchema = z.object({
  search: z.string().optional(),
  cursor: z.string().regex(/^\d+$/).optional(),
  size: z.number().int().positive().optional(),
}).strict();

const fileInputSchema = z.object({
  path: panelReadParameterSchemas.skillFilePath,
}).strict();

export function createSkillReadAdapter(
  owner: ProductOwner, viewer: AssistantCredentials, _callerUserName?: string, libraryView?: SkillView,
): SkillReads {
  const t = (key: string, params?: Record<string, unknown>) => tForLocale(viewer.locale, key, params);

  function diagnosticText(diagnostics?: SkillCatalogDiagnostics): string[] | undefined {
    if (!diagnostics) return;
    const messages = diagnostics.items.map(({ title, field, reason }) => {
      const label = title ?? t("assistant.skills.unavailable.name");
      return [label, field, t(`skills.diagnostics.${reason}`)].filter(Boolean).join(" · ");
    });
    if (diagnostics.sourceUnavailable) messages.push(t("skills.diagnostics.sourceUnavailable"));
    return messages.length ? messages : undefined;
  }
  const unavailable = () => ({
    label: t("assistant.skills.unavailable.name"),
    reason: t("assistant.skills.unavailable.reason"),
  });

  function sourceText(restriction: SkillWriteRestriction): string {
    if (restriction === null) return t("panels.skill.sourceDomain");
    return restriction.kind === "public" ? t("panels.skill.sourcePublic") : restriction.providerName;
  }

  function skillFieldLabels() {
    return {
      description: t("panels.skill.fields.description"),
      source: t("panels.skill.fields.source"),
      writeRestriction: t("panels.skill.fields.writeRestriction"),
    };
  }

  function skillRow(skill: SkillInfo, fieldLabels: Record<string, string>): PanelRecord {
    return {
      primaryKey: skill.id,
      label: skill.title,
      ...(skill.description ? { subtitle: skill.description } : {}),
      fieldLabels,
      fields: {
        description: skill.description,
        source: sourceText(skill.writeRestriction),
        writeRestriction: skillDeleteRefusal(skill.writeRestriction, viewer.locale)?.reason ?? "",
      },
    };
  }

  return {
    async count() {
      return { rows: [], total: libraryView
        ? libraryView.registry.getSkills().length : await skillManager.countSkills(owner.domainId, viewer) };
    },
    async options() {
      const { skills, diagnostics } = await assistantSkillCatalog(owner.domainId, viewer);
      const messages = diagnosticText(diagnostics);
      const ordered = [...skills].sort((a, b) => Number(Boolean(a.unavailable)) - Number(Boolean(b.unavailable)));
      return {
        options: ordered.map(({ skill, title, description, unavailable }): PanelOption => ({
          primaryKey: runtimeSkillKey(skill),
          value: skill,
          label: title,
          description,
          ...(unavailable ? { unavailable } : {}),
        })),
        ...(messages ? { diagnostics: messages } : {}),
      };
    },
    async resolve({ values }: SkillResolveRequest) {
      const { skills } = await assistantSkillCatalog(owner.domainId, viewer);
      const catalogue = new Map(skills.map(option => [runtimeSkillKey(option.skill), option]));
      const { label, reason } = unavailable();
      return {
        options: values.map((held): PanelOption => {
          const skill = runtimeSkillRefSchema.parse(held);
          const visible = catalogue.get(runtimeSkillKey(skill));
          return visible
            ? { primaryKey: runtimeSkillKey(skill), value: skill, label: visible.title, description: visible.description,
              ...(visible.unavailable ? { unavailable: visible.unavailable } : {}) }
            : { primaryKey: runtimeSkillKey(skill), value: skill, label, unavailable: { reason } };
        }),
      };
    },
    async query(params: Record<string, unknown>) {
      const { search, cursor, size } = queryInputSchema.parse(params);
      const needle = search?.trim() ?? "";
      const catalogue = libraryView
        ? skillManager.describeLibrary(libraryView, viewer.locale)
        : needle ? await skillManager.searchSkills(owner.domainId, needle, viewer) : await skillManager.getAllSkills(owner.domainId, viewer);
      const { skills, diagnostics } = libraryView && needle ? skillManager.searchLibrary(catalogue, needle) : catalogue;
      const messages = diagnosticText(diagnostics);
      const offset = cursor === undefined ? 0 : Number(cursor);
      const labels = skillFieldLabels();
      return {
        rows: skills.slice(offset, size === undefined ? undefined : offset + size).map(skill => skillRow(skill, labels)),
        ...(size !== undefined && offset + size < skills.length ? { nextCursor: String(offset + size) } : {}),
        total: skills.length,
        ...(messages ? { diagnostics: messages } : {}),
      };
    },
    async record(primaryKey: string) {
      const skill = libraryView
        ? skillManager.describeSkill(libraryView.requireSkillById(primaryKey), viewer.locale)
        : await skillManager.getSkillInfo(owner.domainId, primaryKey, viewer);
      return skillRow(skill, skillFieldLabels());
    },
    async files(primaryKey: string) {
      const files = libraryView
        ? await skillManager.listFilesFromEntry(libraryView.requireSkillById(primaryKey))
        : await skillManager.listSkillFiles(owner.domainId, primaryKey, viewer);
      const fieldLabels = { size: t("panels.skill.fields.size") };
      return files.map(entry => ({
        primaryKey: entry.path,
        label: entry.path,
        fieldLabels,
        fields: { size: String(entry.size) },
      }));
    },
    async file(primaryKey: string, params: Record<string, unknown>) {
      const { path } = fileInputSchema.parse(params);
      const content = libraryView
        ? await skillManager.readFileFromEntry(libraryView.requireSkillById(primaryKey), path, viewer.locale)
        : await skillManager.readSkillFile(owner.domainId, primaryKey, path, viewer);
      return {
        primaryKey: path,
        label: path,
        fieldLabels: { content: t("panels.skill.fields.content") },
        fields: { content },
      };
    },
  };
}
