import type { Component } from "vue";
import type { ProcessStepView, ShellLabels, ToolRendererOverride } from "./types";

const SKILL_SCRIPT = /(?:^|[\s"'=/])skills\/([A-Za-z0-9][A-Za-z0-9._-]*)\//;

/** The skill a bash command runs a script of (skills/<name>/...), or null. */
export function skillOfCommand(command: string): string | null {
  return SKILL_SCRIPT.exec(command)?.[1] ?? null;
}

/** Host override for a step: skill name first, then tool name; null means the shell default. */
export function resolveToolRenderer(
  step: Pick<ProcessStepView, "toolName" | "skill">,
  overrides: readonly ToolRendererOverride[],
): Component | null {
  if (step.skill) {
    const bySkill = overrides.find((entry) => entry.skills?.includes(step.skill!));
    if (bySkill) return bySkill.component;
  }
  return overrides.find((entry) => entry.tools?.includes(step.toolName))?.component ?? null;
}

/** How the default view names a step: a verb, its main subject and secondary detail. */
export function describeTool(
  step: Pick<ProcessStepView, "toolName" | "skill" | "text">,
  labels: Pick<ShellLabels, "toolRead" | "toolWrite" | "toolEdit" | "toolBash" | "toolSkill">,
): { verb: string; subject: string; detail: string } {
  switch (step.toolName) {
    case "read":
      return { verb: labels.toolRead, subject: step.text, detail: "" };
    case "write":
      return { verb: labels.toolWrite, subject: step.text, detail: "" };
    case "edit":
      return { verb: labels.toolEdit, subject: step.text, detail: "" };
    case "bash":
      return step.skill
        ? { verb: labels.toolSkill, subject: step.skill, detail: step.text }
        : { verb: labels.toolBash, subject: "", detail: step.text };
    default:
      return { verb: step.toolName, subject: "", detail: step.text };
  }
}
