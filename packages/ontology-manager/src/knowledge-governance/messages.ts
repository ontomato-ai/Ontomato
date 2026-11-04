import type { ShellLabels } from "@ontomato/agent-shell-ui";
/**
 * Governance text. `shell` is the shell's labels as stored: the three the page formats from text
 * (steps, rows, elapsed) keep their keys but hold the pattern instead of the formatter, so a
 * missing key is a type error here rather than a silent `{...}` cast.
 */
export interface GovernanceMessages {
  text: Readonly<Record<string, string>>;
  shell: Readonly<Omit<ShellLabels, "steps" | "rows" | "elapsed"> & Record<"steps" | "rows" | "elapsed", string>>;
}
export const governanceAgentId = "56a15178-ae22-4e6f-9974-ababeb42a676";
export const englishGovernance: GovernanceMessages = {
  "text": {
    "title": "Knowledge governance",
    "subtitle": "Review existing knowledge and clarify business meaning",
    "welcomeTitle": "What would you like to check?",
    "loading": "Loading…",
    "progress": "Reviewed {done} of {total} knowledge entries",
    "sources": "Sources",
    "report": "Report",
    "placeholder": "Explain the business rule, ask a question, or add an exception…",
    "saved": "Suggestions only — knowledge, ontology and data are not changed. Saved automatically.",
    "reportHint": "These are proposed changes for people to apply. Confirmation does not modify knowledge, ontology or data.",
    "noIssues": "Findings will appear here as the review progresses.",
    "noSources": "Referenced materials will appear here.",
    "evidenceHint": "This is an execution-evidence reference. The report explains the relevant observed facts and any evidence gaps.",
    "sourceMissing": "The original is no longer available. Review the finding before acting.",
    "more": "Read the next part",
    "problem": "Problem",
    "before": "Current description or state",
    "after": "Proposed change",
    "basis": "Basis",
    "ontology": "Ontology governance",
    "knowledge": "Knowledge organization",
    "data": "Data defects",
    "proposed": "Proposed",
    "pending": "Pending clarification",
    "confirmed": "Meaning confirmed",
    "context": "(Current page: {page})",
    "contextIssue": "{report} · finding “{title}”",
    "back": "Back"
  },
  "shell": {
    "newConversation": "New chat",
    "agent": "Agent",
    "sessions": "Recent",
    "noSessions": "No conversations yet",
    "more": "Show more",
    "loadFailed": "Couldn't load",
    "retry": "Retry",
    "deleteSession": "Delete conversation",
    "deleteConfirm": "Delete?",
    "unavailable": "Unavailable",
    "scheduledSession": "Started by a scheduled task",
    "placeholder": "Ask anything about your data…",
    "send": "Send",
    "stop": "Stop",
    "greeting": "What would you like to know?",
    "steps": "{n} step | {n} steps",
    "thinking": "Thinking",
    "working": "Working",
    "toolInput": "Input",
    "toolOutput": "Output",
    "stopped": "Stopped",
    "truncated": "The answer was cut off at the length limit.",
    "failed": "The run ended with an error.",
    "copy": "Copy",
    "copied": "Copied",
    "like": "Helpful",
    "dislike": "Not helpful",
    "feedbackReason": "What went wrong?",
    "submit": "Submit",
    "cancel": "Cancel",
    "open": "Open in panel",
    "download": "Download",
    "close": "Close",
    "preparing": "Preparing a step",
    "artifactMissing": "File not available",
    "menu": "Menu",
    "scrollToBottom": "Scroll to latest",
    "expand": "Expand page",
    "collapse": "Show beside chat",
    "loading": "Loading…",
    "rows": "{n} row | {n} rows",
    "emptyFile": "This file is empty.",
    "invalidChart": "This chart file could not be drawn.",
    "previousPage": "Previous page",
    "nextPage": "Next page",
    "toolRead": "Read",
    "toolWrite": "Write",
    "toolEdit": "Edit",
    "toolBash": "Run",
    "toolSkill": "Skill",
    "activitySchema": "Inspect ontology",
    "activityValues": "Probe values",
    "activityQuery": "Run query",
    "activityKnowledge": "Search metrics and knowledge",
    "activityRetrieve": "Retrieve data",
    "activityDataset": "Prepare dataset",
    "activityCompute": "Run calculation",
    "datasetData": "Data",
    "datasetLineage": "Lineage",
    "done": "Done",
    "elapsed": "{time} elapsed",
  }
};
/** The page's vue-i18n translation: a named-parameter lookup and a plural lookup that sets `{n}` and `{count}`. */
export interface GovernanceTranslate {
  (key: string, params?: Record<string, string | number>): string;
  (key: string, plural: number): string;
}

/** The agent shell's labels from the `governance.shell` messages of the page's vue-i18n tree. */
export function shellLabels(t: GovernanceTranslate): ShellLabels {
  const keys = Object.keys(englishGovernance.shell) as (keyof GovernanceMessages["shell"])[];
  const labels = Object.fromEntries(keys.map((key) => [key, t(`governance.shell.${key}`)])) as Record<
    keyof GovernanceMessages["shell"],
    string
  >;
  return {
    ...labels,
    placeholder: t("governance.text.placeholder"),
    greeting: t("governance.text.welcomeTitle"),
    steps: (n: number) => t("governance.shell.steps", n),
    rows: (n: number) => t("governance.shell.rows", n),
    elapsed: (time: string) => t("governance.shell.elapsed", { time }),
  };
}
