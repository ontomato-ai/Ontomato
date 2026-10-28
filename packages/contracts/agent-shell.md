# Agent shell contract

Implemented contract, 2026-10-28 (batch 3), revised by the same day's decision
"default rendering in the shell, host overrides". The Vue implementation and its
TypeScript API are `@ontomato/agent-shell-ui`; runtime facts are
[agent-runtime.md](agent-runtime.md); artifact references are
[agent-artifact-markdown.md](agent-artifact-markdown.md).

## Ownership

`@ontomato/agent-shell-ui` is the platform conversation shell shared by every
host: the workbench now, the Ontology Manager (knowledge governance, ontology
service AI features) later. It owns the two-column layout with a right outlet,
navigation (feature entries, agent selector, the selected agent's sessions), the
conversation stream, the composer, default rendering of messages, tool calls and
artifacts, and the one client of the host proxy interface. Its only product
dependency is `@ontomato/contracts`; third-party libraries include vue,
markstream-vue, echarts and lucide. It imports no host code, store, router or
i18n instance; hosts pass labels, and theme values come from the CSS variables.

A host owns its routes under its own prefix, credentials, menu authorization,
feature pages, agent definitions, rendering overrides and business actions.
Hiding an entry never authorizes its server operation.

## Host proxy interface

The shell talks to every host through one interface shape, the agent-host
contract: agents, session list/creation/deletion, session and run snapshots,
starting a run (also the continuation after a clarifying answer), the event
stream, cancellation, artifact resolution and content, with paths relative to
the host's prefix. `createAgentHostClient({request})` implements it once;
a host supplies an authenticated `request` for paths under its prefix, which alone
scopes the host. The wire types are those of [agent-host.md](agent-host.md),
imported from `@ontomato/contracts/agent-host`.

Messages, events and artifacts keep the runtime's PI shapes. Run state is
`status` + `stopReason` + `errorMessage`; the shell never derives
completed/failed/needs-input states. A session's title is the first user message
verbatim; there is no model-generated title and no follow-up suggestion.

Snapshots and frames merge by message ID, `toolCallId` and artifact ID, never by
array position. Events at or below a run's applied `seq` are ignored;
`snapshot_required` or a transport error makes the shell re-read the run
snapshot and subscribe after its cursor. Detaching never cancels execution;
cancel is an explicit user action. Frames apply in batches once per animation
frame from a bounded queue.

Host-specific endpoints stay outside the shell. Feedback storage is one: the
shell shows rating buttons and calls the host's `feedback` port.

## Declarations

A workbench is code: `ShellWorkbenchDeclaration` lists its feature entries; its
agents come from the host interface. Feature entries are `page` (the host renders
it in the main area through the `feature` slot, keyed by feature ID), `action`
(the shell emits it and the host reacts in place, e.g. a dialog), `link`
(navigates away) or `unavailable` (visible placeholder; scheduled tasks use this
until they return). Editions supply their own entries to the same workbench.

## Default rendering and overrides

The shell renders everything by default; hosts override only where they mean to.
Lookup is always host override → shell default → generic file card or step.

- **Message text**: standard Markdown through markstream-vue. Single newlines are
  line breaks and only `~~` marks strikethrough, as in every delivery channel;
  raw HTML is escaped.
- **Artifacts**: `outputs/` image syntax renders inline, link syntax renders a
  card that opens the right panel; an unclosed reference shows a placeholder.
  Defaults by extension: `.chart.json` ECharts, `.csv`/`.json` paginated table,
  images, `.html` iframe with `sandbox="allow-scripts"` only, `.md` rendered like
  a message. Anything else is a file card with download. Overrides
  (`ArtifactRendererOverride`) match a path pattern first, then the longest
  extension. Components are keyed by run and path.
- **Tool calls**: consecutive thinking and tool steps collapse into one process
  row. Default step views for `read`, `write`, `edit` and `bash`; a bash command
  that runs `skills/<name>/...` is shown as that skill. Overrides
  (`ToolRendererOverride`) match a skill name first, then a tool name.
- **Charts**: hosts may pass a native ECharts theme; the default follows the CSS
  tokens.

Every override receives the component it replaces as `fallback`, so it can wrap
the default instead of re-implementing it.

Business actions (save as dashboard, export PPT and similar) never require an
override: hosts fill the `artifact-actions` slot (scope `{artifact}`, shown in
the panel header and inline captions) and the `message-actions` slot (scope
`{sessionId, runId, messageId, text}`, shown under an answer).
