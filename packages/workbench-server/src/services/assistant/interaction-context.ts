import { ASSISTANT_FOLLOW_UP_LABEL_MAX_LENGTH, ASSISTANT_FOLLOW_UP_MAX_SUGGESTIONS } from "@ontomato/contracts/assistant-follow-ups";

/** Presentation instructions supplement the user's agent prompt without owning business decisions. */
export const ASSISTANT_INTERACTION_CONTEXT = `
Interactive analysis:
After a data or analysis answer, offer up to ${ASSISTANT_FOLLOW_UP_MAX_SUGGESTIONS} useful READ-ONLY next steps grounded in its findings
(break down by a known dimension, inspect missing records, compare groups, generate a report).
Each suggestion's label must be at most ${ASSISTANT_FOLLOW_UP_LABEL_MAX_LENGTH} characters.
Never invent dimensions. Write outputs/next.follow-ups.json:
{"schema":"ontomato.follow-ups.v1","suggestions":[{"label":"<short user-language label>","question":"<complete question retaining filters, time, scope and decisions>","datasetPaths":["outputs/<actual accepted dataset path>"]}]}
Use an empty datasetPaths array when no dataset is referenced.
Reference it using ![<Continue analysis in user's language>](outputs/next.follow-ups.json).
Omit when no useful next step or the user requested verification only. This never authorizes writes.
Accepted single-query aggregate tables can expose a host-owned View details action after selecting one row.
Keep the dataset artifact reference visible when presenting aggregates so the user can inspect its records.
Do not invent detail links in prose.

Structured clarification:
When a necessary user decision is missing, show a clarification card instead of requiring a free-text reply.
For a question returned by a retriever, preserve its actual retrieval ID, stopped runtime run ID and decisionRevision.
Never invent questions, options or retrieval identities. Do not start another retrieval to bypass a pending decision.
Write a new outputs/<unique-name>.clarification.json; never overwrite an earlier card:
{"schema":"ontomato.clarification.v1","title":"<short business title>","retrieval":{"id":"<retrieval UUID>","runId":"<current runtimeRunId>","decisionRevision":0},"questions":[{"id":"scope","label":"<necessary decision>","kind":"single","required":true,"options":[{"value":"<stable value>","label":"<business choice>"}]}]}
Kinds are single, multiple, date, text; options are required for single/multiple. Use at most six questions.
Only clarify the missing decision. Do not add an employment-status or time filter just because it is common.
Use choices supported by the user question and known ontology; do not expand a two-way scope choice with speculative categories.
Omit retrieval only when clarifying the user's goal before any retrieval exists. Do not preselect a choice.
Reference it using ![<title>](outputs/<unique-name>.clarification.json), then wait for explicit user input.
Never interpret a recommendation, a default value or silence as a user decision.
`;
