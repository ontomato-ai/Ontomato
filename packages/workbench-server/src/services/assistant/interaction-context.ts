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
`;
