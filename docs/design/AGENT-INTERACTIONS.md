# Agent interaction design

## Purpose and authority

Agent conversations advance a business objective: understand the goal, establish facts and decisions, present useful
next steps, confirm mutations, and read back authoritative results. Chat expresses intent; controls reduce repeated
typing and make scope and consequences inspectable. This document specializes DESIGN.md §9 and uses its components,
tokens, accessibility and responsive rules. It does not define business permissions or execution rules.

## Interaction stages

| Stage | Product responsibility | Interaction |
| --- | --- | --- |
| Goal | Understand the question, objects and scope | Natural language and contextual task starters |
| Decisions | Obtain missing time ranges, populations and definitions | Single/multiple choice, dates, searchable objects and notes |
| Evidence | Explain findings and their limits | Plain answer, datasets, charts and provenance |
| Next step | Continue analysis | Dataset row selection |
| Confirmation | Review target and intended changes | Before/after preview, missing fields and explicit confirmation |
| Readback | Establish what actually happened | Recorded outcome, fresh data and a new edit operation |

Simple questions do not need a mandatory stage tracker. Show a stage or blocker only when it helps the user continue.

## Surfaces and elements

| Element | Use | Rule |
| --- | --- | --- |
| Task starter | No established goal | Business name and short purpose, grounded in installed capabilities |
| Clarification | A necessary decision is missing | Ask only necessary questions without stopping; state the default; no preselection; the reader's own answer last |
| Scope chips | Established filters need adjustment | Show effective conditions; changes trigger a fresh query |
| Dataset | Structured evidence | Preserve raw values, identifiers, source and truncation |
| Chart | Comparisons, structure and trends | Include units/scope; title, legend and plot occupy distinct space |
| Change preview | Multiple fields or records | Unambiguous before/after values and affected scope |
| Task status | Long work or user intervention | Real states, no invented percentages |
| Result | Operation ended | Success, failure or unknown with an appropriate recovery action |
| Side panel | Review needs more room | Concise heading, no file metadata clutter, details on demand |
| Full workspace | Complex repeated editing | One task context; no duplicate implementation of business rules |

Simple choices stay inline. Reports, provenance and detailed review use the right side. Large multi-record tasks get a
dedicated surface. Do not turn every reply into a set of cards.

## Proposals and context

Mutation proposals cannot authorize a write. They must relate to actual findings and known capabilities; omit
unhelpful proposals and respect an explicit read-only request. Show one primary operation per region.

A continuation is one ordinary user message: it names the earlier file by its `outputs/` path and says what to
change. The model and the user see the same text; no hidden context, instructions or JSON travel with it. The
assistant skill reads the original scope, time and decisions from the referenced file. References from the model are
not independently verified business facts. Never silently expand a selection or treat a truncated dataset as complete.

## Dataset interaction

Single selection supports analysis; multiple selection adds comparison and applicable multi-record tasks. Show count
and clear-selection. Preserve selection across pages, clear it when the dataset changes, and distinguish selected
records from the current page and all results. Preserve 0, false, null, units and string identities. A continuation
names selected records by their row numbers in the immutable source file, never by display position. Data values are
untrusted content, not Agent instructions.

## Aggregate drilldown

An accepted aggregate dataset offers **View details** after one result row is selected. The host reads the immutable
accepted dataset on the server to preview that row's execution-owned group values. Clicking View details sends one
ordinary message naming the file, the row and its exact group values, without a confirmation dialog, preserving the
original dataset. Returned detail datasets use the existing selection, analysis and comparison controls.

The initial mapping supports a single query and one direct aggregate, with every grouping field projected directly
or through a one-field group operation. Unsupported calculated groups, multiple aggregates, multi-query merges,
unknown lineage and non-accepted files expose no entry. Aggregate measures are never converted into group filters.
Null, false, zero and string identities remain distinct.

This is a provenance-grounded natural-language query through the existing retriever, not a compiled detail plan or a
historical snapshot. The retriever must preserve filters, decisions, joins, distinctness and metric population, ask
when the detail grain is ambiguous, return object identities and disclose changes or truncation. Final model-result
equivalence still requires end-to-end acceptance. Object navigation continues to belong to the Manager.

## Decisions and clarification

No recommendation or default is consent: a default stays an assumption until someone answers. An answer goes to the
question it answers, in the same conversation; do not start a replacement retrieval to bypass an open question. Do not
claim a decision was accepted before the underlying task accepts it.

An agent that needs the reader's decision asks without stopping: it states the default it goes on with and may offer
options, one marked as that default. The questions wait right over the composer, folded to their count. Opened, the
panel shows one question at a time: the question, the default, the numbered options (a number key picks one) and the
reader's own answer last. The reader moves between questions with each draft kept, and may skip one, which only hides it
on this page and sends nothing. An answer goes back to the question that asked for it, into the agent's running reply or
as its next turn; a blank answer is not sent. The panel and the composer keep their own text, and the composer also
sends into a running reply, beside its stop button. Clarification cards written before (`.clarification.json`) stay
readable and take no answer. Accepted decisions do not certify that the resulting dataset implements the chosen scope;
final-result equivalence still requires end-to-end verification.

## Visual and interaction rules

Use existing system inputs, selects, dates, buttons, tokens and icons. Hover, focus, pressed, disabled, loading and
keyboard states must match the host components. Disclosures use ChevronRight, rotated on open. Status has text and
an icon, not colour alone. Static information does not acquire fake click affordances. Prefer neutral surfaces, light
separators and typography over coloured frames, heavy shadows or decoration. One container owns each spacing boundary.
Respect narrow panels, long content, dark theme, zoom and reduced motion.

## Acceptance

Verify normal, loading, empty, error and disabled states; correct source context; preserved input; duplicate-submission
handling; explainable history and reload behaviour; narrow panels, long values and both themes. Verify writes by an
independent authorized read. Distinguish component tests, runtime tests and visual acceptance in reports.

## Implementation sequence and evidence

| Capability | Current implementation | Remaining acceptance/boundary |
| --- | --- | --- |
| Dataset selection | Ordinary messages with the source file's row numbers; component tests | — |
| Questions to the reader | Agents ask through the channel's `needsInput` with a default and options; the panel over every shell composer answers with `send(replyTo)`; earlier clarification cards are read-only; component tests | A real retrieval asking, being answered from the panel and recomputing needs its own end-to-end acceptance |
| Editable query conditions | Dataset header opens source filters from accepted dataset provenance; the business-language change is sent as one ordinary message naming the file | This is a scoped natural-language requery, not direct editing of an executable query plan; typed field/operator controls and final model result acceptance remain future work |
| Aggregate → detail records | Single selected aggregate row; server-owned group mapping and typed values; one-click ordinary message without confirmation; shell selection reused for returned datasets | Initial support is one query and one direct aggregate with projected group fields; final model detail population and live data changes need end-to-end acceptance |
| Multi-object change preview | Pending | Requires authorized target set, per-record effects and execution semantics |
| Persistent task status | Pending | Must use owned task facts; never infer business completion from model prose |

Interaction prompts belong in services/assistant/interaction-context.ts.
How the assistant continues from a referenced file belongs once in the `ontomato-analyst-assistant` skill.
The Agent settings prompt is the user's editable agent instruction, supplemented per run by these host contracts.
