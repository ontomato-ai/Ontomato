import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { readSkillPackage } from "../../core/skills/package";
import type { SkillEntry } from "../../core/skills/types";
import { tForLocale } from "../../i18n";
import { workbenchBuiltinSkillRoot } from "./builtin-paths";

const workbenchSkill = (name: string): RuntimeSkillRef => ({ namespace: { kind: "provider", provider: "workbench" }, name });
const ontologySkill = (name: string): RuntimeSkillRef => ({ namespace: { kind: "provider", provider: "ontology" }, name });

function fileBackedSkill(name: string, description: string, selectionRestricted = false): SkillEntry {
  const skill = workbenchSkill(name);
  const root = workbenchBuiltinSkillRoot(skill);
  return {
    skill,
    manifest: { name, description },
    source: { kind: "public", path: root },
    ...(selectionRestricted ? { selectionRestricted } : {}),
    provide: () => readSkillPackage(root, skill),
  };
}

function generatedSkillMarkdown(skill: RuntimeSkillRef, description: string) {
  return `---\nname: ${skill.name}\ndescription: ${JSON.stringify(description)}\n---\n\n${description}\n`;
}

function generatedSkill(name: string, description: string, selectionRestricted = false): SkillEntry {
  const skill = ontologySkill(name);
  return {
    skill,
    manifest: { name, description },
    source: { kind: "generated" },
    ...(selectionRestricted ? { selectionRestricted } : {}),
    provide: async () => ({ skill, files: [{ path: "SKILL.md", content: generatedSkillMarkdown(skill, description) }] }),
  };
}

/** Platform skills that are part of the domain catalogue but are not scanned from the editable skill roots. */
export function builtinSkillEntries(): SkillEntry[] {
  return [
    generatedSkill("knowledge-governance", "Review ontology and business knowledge, extract source-backed knowledge from unstructured material, import pending knowledge, and maintain governance work with traceable evidence."),
    fileBackedSkill("assistant-report", "Deliver a requested analysis as an evidence-based report, or turn an existing report into a PowerPoint presentation when explicitly requested."),
    fileBackedSkill("application-design", "Design coherent Ontomato applications and demos using the platform SDK, shared theme and reusable product assets."),
    fileBackedSkill("ontomato-agent-builder", "Create and edit Ontomato agent definitions (prompt, model, skills, classes and external MCP services) on the agent settings page through live page tools or direct CLI outside the platform."),
    fileBackedSkill("ontomato-page-operator", "Discover applications and pages, read the current page, fill forms, and invoke declared page operations."),
    generatedSkill("ontomato-analyst-assistant", "Answer business data questions: delegate them to the data retriever, reuse a published metric when one fits, and explain the dataset the answer relies on."),
    generatedSkill("ontology-query", "Query ontology structure, DSL syntax, stored values, business knowledge and published metrics through Ontomato."),
    generatedSkill("knowledge-submit", "Submit a clarified business caliber as pending business knowledge for administrator review."),
    fileBackedSkill("ontomato-app-builder", "Compose and check panel application source with the Ontomato SDK. Use when building a panel or moving an existing page into the product layer.", true),
    fileBackedSkill("ops-diagnosis", "Diagnose an Ontomato question or service fault using authorized read-only evidence: service logs, runtime sessions and artifacts, configuration, health, metadata, DSL queries and operations knowledge.", true),
    generatedSkill("data-retrieval", "Deliver a query logic package as a dataset by rerunning it through Ontomato under the user's authorization.", true),
  ];
}

/** Existing user-facing names and descriptions of built-in assistant skills. */
export function builtinSkillDisplay(skill: RuntimeSkillRef, locale?: string): { title: string; description: string } | null {
  const key = runtimeSkillKey(skill);
  if (key === runtimeSkillKey(ontologySkill("knowledge-governance")))
    return { title: tForLocale(locale, "assistant.default.knowledge-governance.name"), description: tForLocale(locale, "assistant.default.knowledge-governance.description") };
  if (key === runtimeSkillKey(ontologySkill("ontomato-analyst-assistant")))
    return { title: tForLocale(locale, "assistant.skills.analyst.title"), description: tForLocale(locale, "assistant.skills.analyst.description") };
  if (key === runtimeSkillKey(workbenchSkill("assistant-report")))
    return { title: tForLocale(locale, "assistant.skills.report.title"), description: tForLocale(locale, "assistant.skills.report.description") };
  if (key === runtimeSkillKey(workbenchSkill("ontomato-page-operator")))
    return { title: tForLocale(locale, "assistant.skills.pageOperator.title"), description: tForLocale(locale, "assistant.skills.pageOperator.description") };
  return null;
}
