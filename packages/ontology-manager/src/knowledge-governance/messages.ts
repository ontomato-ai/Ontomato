/**
 * Governance text. The page reads one governance record's report and its sources; the conversation that produced the
 * record is the agent platform's, so the application's own column, list and model page have no words here.
 */
export interface GovernanceMessages {
  text: Readonly<Record<string, string>>;
}
export const englishGovernance: GovernanceMessages = {
  "text": {
    "title": "Knowledge governance",
    "subtitle": "Review existing knowledge and clarify business meaning",
    "loading": "Loading…",
    "progress": "Reviewed {done} of {total} knowledge entries",
    "sources": "Sources",
    "report": "Report",
    "feedback": "User feedback",
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
    "confirmed": "Meaning confirmed"
  }
};
