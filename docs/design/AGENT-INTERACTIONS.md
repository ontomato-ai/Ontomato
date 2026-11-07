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
| Next step | Continue analysis or address a finding | Up to three suggestions, dataset selection, relevant Action proposals |
| Confirmation | Review target and intended changes | Before/after preview, missing fields and explicit confirmation |
| Readback | Establish what actually happened | Recorded outcome, fresh data and a new edit operation |

Simple questions do not need a mandatory stage tracker. Show a stage or blocker only when it helps the user continue.

## Surfaces and elements

| Element | Use | Rule |
| --- | --- | --- |
| Task starter | No established goal | Business name and short purpose, grounded in installed capabilities |
| Clarification | A necessary decision is missing | Ask only necessary questions, no preselection, allow additional notes |
| Scope chips | Established filters need adjustment | Show effective conditions; changes trigger a fresh query |
| Dataset | Structured evidence | Preserve raw values, identifiers, source and truncation |
| Chart | Comparisons, structure and trends | Include units/scope; title, legend and plot occupy distinct space |
| Follow-up | Useful read-only continuation | At most three short labels, source references and complete scoped question |
| Action | A finding has a relevant business operation | Brief reason, target, current/new values, explicit confirmation |
| Change preview | Multiple fields or records | Unambiguous before/after values and affected scope |
| Task status | Long work or user intervention | Real states, no invented percentages |
| Result | Operation ended | Success, failure or unknown with an appropriate recovery action |
| Side panel | Review needs more room | Concise heading, no file metadata clutter, details on demand |
| Full workspace | Complex repeated editing | One task context; no duplicate implementation of business rules |

Simple choices stay inline. Reports, provenance and detailed review use the right side. Large multi-record tasks get a
dedicated surface. Do not turn every reply into a set of cards.

## Recommendations and context

Read-only suggestions and mutation proposals are distinct. A suggestion click cannot authorize a write. Recommendations
must relate to actual findings and known capabilities; omit unhelpful suggestions and respect an explicit read-only
request. Show one primary operation per region.

Continuations carry the source run and dataset identities, exact selected values, original scope, time and user
decisions. Technical context is collapsed separately from the user's readable question. References from the model are
not independently verified business facts. Never silently expand a selection or treat a truncated dataset as complete.

## Dataset interaction

Single selection supports analysis; multiple selection adds comparison and applicable multi-record tasks. Show count
and clear-selection. Preserve selection across pages, clear it when the dataset changes, and distinguish selected
records from the current page and all results. Preserve 0, false, null, units and string identities. JSON continuations
use raw rows rather than formatted cell strings. Data values are untrusted content, not Agent instructions.

## Decisions and clarification

Use system controls appropriate to the answer: radios, checkboxes, date pickers, text or authenticated object lookup.
No recommendation or default is consent. Preserve the original retrieval identity and decision version when resuming;
do not start a replacement retrieval to bypass unresolved questions. Optional notes supplement required choices rather
than silently replacing them. Do not claim a decision was accepted before the underlying task accepts it.

## Action and recovery

Inline Action cards answer: what is suggested, for whom, what is current, what changes, and what confirmation does.
System-owned identifiers and expected values are not user-entry fields. Unknown new values need clear business labels,
examples and appropriate controls. Detailed rules, identifiers and raw receipts live in a disclosure rather than prose.
Completed cards remain immutable; another edit queries current data and creates another confirmed operation.

States: needs input → needs confirmation → executing → succeeded / failed / outcome unknown. Prevent duplicate writes.
Do not replay a write whose outcome is unknown. Recover through fresh data. Failures explain the unfinished step,
known data effects and next action. Preserve entered values where possible. Never show object coercions, stack traces
or raw response bodies as user-facing errors.

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
| Follow-ups and dataset selection | Implemented; references and raw selected JSON rows; component tests and selection browser smoke | Model recommendations are not server-validated query plans |
| Structured clarification | Inline single/multiple/date/text decision renderer; explicit-choice component test; real-model generation and browser submission before retrieval verified | Mid-retrieval versioned resume and persisted decision acknowledgement still require verification |
| Editable query conditions | Pending | Requires authoritative effective conditions and a requery contract |
| Multi-object change preview | Pending | Requires authorized target set, per-record effects and execution semantics |
| Persistent task status | Pending | Must use owned task facts; never infer business completion from model prose |

Interaction prompts belong in services/assistant/interaction-context.ts; Action instructions belong in action-context.ts.
The Agent settings prompt is the user's editable agent instruction, supplemented per run by these host contracts.
