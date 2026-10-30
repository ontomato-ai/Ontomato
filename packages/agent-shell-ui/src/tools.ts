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

/** The business action a step performs; the process view names steps and summarizes runs by it. */
export type StepActivity =
  | "read" | "write" | "edit" | "run" | "skill" | "other"
  | "schema" | "values" | "query" | "knowledge" | "retrieve" | "dataset" | "compute";

// Only a script that node actually runs counts; reading or editing the file (cat, sed) does not.
const SCRIPT_PATH = String.raw`(?:"[^"]*?|'[^']*?|[^\s"';&|]*?)`;
const ANALYST_COMMAND = new RegExp(String.raw`\bnode\s+${SCRIPT_PATH}ontomato\.mjs["']?\s+([\w-]+)`);
const DATASET_COMMAND = new RegExp(String.raw`\bnode\s+${SCRIPT_PATH}dataset\.mjs\b`);
const ANALYST_ACTIVITY: Record<string, StepActivity> = {
  ask: "retrieve",
  "execute-dsl": "query",
  "distinct-values": "values",
  overview: "schema",
  schema: "schema",
  relationships: "schema",
  "dsl-reference": "schema",
  "dataset-desc": "schema",
  metrics: "knowledge",
  knowledge: "knowledge",
};

/** Classifies a tool step by what its command does: analyst commands, dataset delivery, program runs. */
export function stepActivity(step: Pick<ProcessStepView, "toolName" | "skill" | "args">): StepActivity {
  switch (step.toolName) {
    case "read":
    case "write":
    case "edit":
      return step.toolName;
    case "bash": {
      const command = typeof step.args.command === "string" ? step.args.command : "";
      const analyst = ANALYST_COMMAND.exec(command)?.[1];
      if (analyst) return ANALYST_ACTIVITY[analyst] ?? "skill";
      if (DATASET_COMMAND.test(command)) return "dataset";
      if (/\bpython3?\s+[\w./-]+\.py\b/.test(command)) return "compute";
      return step.skill ? "skill" : "run";
    }
    default:
      return "other";
  }
}

type ActivityLabels = Pick<
  ShellLabels,
  | "toolRead" | "toolWrite" | "toolEdit" | "toolBash" | "toolSkill"
  | "activitySchema" | "activityValues" | "activityQuery" | "activityKnowledge"
  | "activityRetrieve" | "activityDataset" | "activityCompute"
>;

/** The phrase for an activity; "other" has none and uses the tool's own name. */
export function activityLabel(activity: StepActivity, labels: ActivityLabels): string {
  return {
    read: labels.toolRead,
    write: labels.toolWrite,
    edit: labels.toolEdit,
    run: labels.toolBash,
    skill: labels.toolSkill,
    other: "",
    schema: labels.activitySchema,
    values: labels.activityValues,
    query: labels.activityQuery,
    knowledge: labels.activityKnowledge,
    retrieve: labels.activityRetrieve,
    dataset: labels.activityDataset,
    compute: labels.activityCompute,
  }[activity];
}

/** One line for a finished group of steps: the distinct actions in order, e.g. "Inspect ontology · Run query". */
export function activitySummary(
  steps: Pick<ProcessStepView, "kind" | "toolName" | "skill" | "args">[],
  labels: ActivityLabels,
): string {
  const phrases: string[] = [];
  for (const step of steps) {
    if (step.kind !== "tool") continue;
    const activity = stepActivity(step);
    const phrase = activity === "other" ? step.toolName : activityLabel(activity, labels);
    if (phrase && !phrases.includes(phrase)) phrases.push(phrase);
  }
  return phrases.join(" · ");
}

/** How the default view names a step: a verb, its main subject and secondary detail. */
export function describeTool(
  step: Pick<ProcessStepView, "toolName" | "skill" | "text" | "args">,
  labels: ActivityLabels,
): { verb: string; subject: string; detail: string } {
  const activity = stepActivity(step);
  if (activity === "other") return { verb: step.toolName, subject: "", detail: step.text };
  const verb = activityLabel(activity, labels);
  if (activity === "read" || activity === "write" || activity === "edit") return { verb, subject: step.text, detail: "" };
  if (activity === "skill") return { verb, subject: step.skill ?? "", detail: step.text };
  return { verb, subject: "", detail: step.text };
}
