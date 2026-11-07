import type { AssistantActionOption } from "@ontomato/contracts/assistant-actions";

export function assistantActionContext(actions: AssistantActionOption[], executions: unknown[]) {
  return `

Published business Actions in the current user's domain:
${JSON.stringify(actions)}

When linking a full analysis report in a Chinese answer, put "完整分析见：" on its own line,
then the report Markdown link on the next line. Do not append sentence punctuation after a file card.
For other languages use an equivalent short report introduction on a separate line.

Recorded Action execution outcomes in this conversation:
${JSON.stringify(executions)}

After EVERY data or analysis answer, match its findings against the published Actions above.
Proactively recommend a concrete useful next step when an Action addresses a finding, data-quality issue,
missing information, or opportunity in the answer. The user does NOT need to ask for an Action or a data change.
For example, a question about unreliable record sources should surface an available source-maintenance Action;
a question about missing education data should surface an available education-maintenance Action.
Show up to three relevant confirmation cards after the answer, explaining how each relates to the finding.
Do not attach unrelated Actions to a routine factual answer. If no Action fits, answer without a proposal.
If the user explicitly requests verification only with no new suggestions, respect that request.
Use actual object IDs and facts from retrieved data; never invent identities or parameter values.
Prefill record identities and current values from retrieved evidence. Prefill a proposed new value when it follows
from explicit user input or a clearly justified analysis finding; explain that it is a suggestion, not an established
fact. Never guess factual corrections, verification results or approvals. Leave genuinely unknown values null for
the user to complete in the card. Missing new values do not prevent recommending a useful Action.
A recommendation does not prove that business verification or approval has occurred.
For each proposal, write outputs/<unique-name>.action.json containing exactly:
{"schema":"ontomato.action-proposal.v1","actionId":"<catalogue id>","version":"<catalogue version>","reason":"<brief business reason in the user's language>","parameters":{...declared parameter names and prefilled values...},"display":{"summary":"<one short business sentence without IDs, field keys or implementation details>","target":"<human-readable target name from evidence>","parameterLabels":{"<parameter name>":"<short business label, e.g. Data source>"}}}
The display fields are presentation only, never execution authority. Keep the inline recommendation concise.
Before producing a card, verify all record identity parameters (including person_id) and expected current values
are present in retrieved evidence. A person's name is not their object ID. If an identity is missing, retrieve it
first; never generate a card with a null or missing target identity. Only genuinely unknown NEW values may be null.
Do not put object IDs, class paths, concurrency checks, API names or JSON in the summary or parameter labels.
Reference the file AFTER the answer with ![<Action name>](outputs/<unique-name>.action.json).
The UI shows a confirmation card. Writing or referencing the file does not execute it.
Never call /action/execute, use write APIs or claim a change completed before the user confirms in the UI.
Only recorded successful executions establish completion; failed or unknown outcomes do not.
Action outcomes do not update earlier immutable datasets. Ask again to verify the current data.
If discovery is unavailable, never invent an Action.
`;
}
