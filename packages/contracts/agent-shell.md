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
artifacts, and the one client of the host proxy interface. Its product
dependencies are `@ontomato/contracts` and `@ontomato/foundation-ui`, whose
`EChart` draws its charts, `MarkdownView` its message text and `useDarkMode`
follows the host's dark mode (the `dark` class on the document root);
third-party libraries include vue, echarts and lucide. It imports no host code,
store, router or i18n instance; hosts pass labels, and theme values come from
the CSS variables.

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
(navigates away) or `unavailable` (visible placeholder). The business workbench's
scheduled tasks are a `page`. Editions supply their own entries to the same workbench.

A `page` declared `withConversation` follows the agent-app states (DESIGN.md
"Agent apps"): picking it opens it full with a composer below; it can collapse
beside the conversation and expand again (`pageView` model: `full` | `side`,
which hosts may also set), and closing it returns to the conversation. The page
renders once and keeps its state while it moves; the `feature` slot also gets
`view`. While such a page is open, a sent message ends with the host's
`pageContext` line (plain text, visible in the message), so the agent knows what
"this" means. `pageLinks(href)` lets a host recognise its own addresses in
answers; a recognised link opens its page beside the conversation. The agent
selector shows only when there is more than one agent.

## Default rendering and overrides

The shell renders everything by default; hosts override only where they mean to.
Lookup is always host override → shell default → generic file card or step.

- **Message text**: the product Markdown through the foundation `MarkdownView`
  (markstream-vue), the same as every other page: single newlines are line
  breaks and only `~~` marks strikethrough, as in every delivery channel; raw
  HTML is escaped. The shell adds only its link and image nodes for `outputs/`
  files and host page links. Text in a message that also calls tools is the agent's
  progress note: it stays visible in the timeline in a quieter style, while the
  answer is the text of messages without tool calls.
- **Artifacts**: `outputs/` image syntax renders inline, link syntax renders a
  card that opens the right panel; an unclosed reference shows a placeholder.
  Defaults by extension: `.chart.json` ECharts, `.csv`/`.json` in the foundation's
  shared table, a page at a time (record arrays, and dataset files headed by their
  column labels; other JSON as its formatted source), images, `.html` in the
  foundation's HTML preview with `sandbox="allow-scripts"` only, `.md` rendered like
  a message. Anything else is a file card with download. Overrides
  (`ArtifactRendererOverride`) match a path pattern first, then the longest
  extension. Components are keyed by run and path.
- **Tool calls**: consecutive thinking and tool steps collapse into one process
  row. Default step views for `read`, `write`, `edit` and `bash`; a bash command
  that runs `skills/<name>/...` is shown as that skill. Analyst and retrieval
  commands are named by their business action (inspect ontology, probe values,
  run query, search metrics and knowledge, retrieve data, prepare dataset, run
  calculation); a finished process row lists the distinct actions and the step
  count, and retrieval activity uses the same step views and summary. Each
  response shows its elapsed time from the request, ticking while it runs.
  Overrides (`ToolRendererOverride`) match a skill name first, then a tool name.
- **Charts**: hosts may pass a native ECharts theme; the default follows the CSS
  tokens.

Every override receives the component it replaces as `fallback`, so it can wrap
the default instead of re-implementing it.

Business actions (save as dashboard, export PPT and similar) never require an
override: hosts fill the `artifact-actions` slot (scope `{artifact, title}`,
where `title` is the name the shell shows for the file; shown in the panel
header and inline captions) and the `message-actions` slot (scope
`{sessionId, runId, messageId, text}`, shown under an answer).
