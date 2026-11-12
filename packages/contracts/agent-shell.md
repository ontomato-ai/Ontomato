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

A message belongs to the client and agent it was sent with. When the host moves
to another client or agent while one is on its way, the shell drops it and shows
the new context's blank conversation; a conversation whose first run was refused
is still handed to the host. A host that changes the client or agent and then
calls the shell's exposed `send` lets the change take effect first (after
`nextTick`), or the shell takes it for a change made while sending.

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

## List run state

A row's `latestRun` follows the runtime, not the conversation that happens to be
open. The host's own notice routes ([agent-host.md](agent-host.md)) are the source:
`sessionRuns` on the client is a passive port whose `subscribe` opens the one
user-level notice stream and whose `read(sessionIds)` returns the light snapshot of
those readable sessions. Creating a client opens nothing.

One page opens one stream, whatever number of lists it shows: a host page calls
`useSessionRunFeed({port, sessions, onNotice, onError})` once, with a getter for every
row it has loaded (the open list and any other expanded one). The feed reads every
row once after `ready`, reads one conversation after a notice that names a listed
one, and reads the rows again when the set of rows or the row objects change (a page,
a promoted conversation, a re-read, a workspace hand-over). It writes `latestRun` in
place, which triggers no further read, and it applies a snapshot only to rows still
listed. Reads are serialized, so a late answer never overwrites a newer one. A
dropped stream is reopened on the existing reconnect cadence, and its `ready` reads
every row again; a refused or off-contract stream is reported to `onError` and stops.
`onNotice` sees every frame, including one for a conversation no list shows, so the
page can refresh its own facts; an unknown conversation is never added to a list.

Nothing else writes list run state: a send response and the open conversation's run
watch no longer do. `useAgentNav` therefore has no `markRun` or exported `runStatus`,
and `promoteSession(session, title)` only places or moves a row and fills an empty
title, keeping the `latestRun` an existing row already has.

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
"Agent apps"): picking it opens it full with a composer floating over its foot;
it can collapse beside the conversation and expand again (`pageView` model:
`full` | `side`, which hosts may also set), and closing it returns to the
conversation, whose top right corner then opens it beside the conversation again.
Beside the conversation its width is dragged between bounds; dragged on 80px past
the widest and released, it expands, past the narrowest, it closes.
The page renders once and keeps its state while it moves; the `feature` slot also
gets `view`. Full, the pane keeps the composer's height (`--pane-dock-space`)
after the page's content; a page that fills the pane and scrolls inside itself
declares `scrollsItself` and keeps that room after its own scrolling content,
reading it as `--pane-dock-space` or `usePageDockSpace()` (the app builder hands
it to the app in its preview frame). The host's `composer-context` shows above
the conversation's composer and, `inline`, inside the full page's one-row
composer before the input. Its `unstarted` is true while the conversation in view
has not started: the shell holds no session for it and no message is on its way;
the app builder shows its workspace selection beside the composer only then.
While such a page is open, a sent message ends with the host's
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
  files and host page links.
- **Process, answer and reviews**: a response has three regions. The process holds the main
  agent's own text, thinking and tool steps, and the cards of the retrievals it delegated
  (each after the work that started it), in order; it is
  open and grows while the run works, and folds to one "worked for" line with the
  main run's duration once the run stops, which the user can open again. The answer
  holds only the text of the message the runtime named as `answerMessageId`; its
  thinking stays in the process. A run stopped without an answer (length, error,
  aborted) keeps all its text in the process, with the stop shown beside it.
  Copy, feedback and the `message-actions` slot target that answer message. After the
  answer and its actions come the quality reviews of the reply's data, one per checked
  branch, signed as another party's and folded to one line (score and first sentence);
  they update as checks settle, whether or not the run or its process is open.
- **Tasks**: a host that serves the [task routes](agent-tasks.md) sets `tasks` on its client
  and supplies `labels.tasks`. A retrieval card names its executor, each branch's outcome
  and, while the retriever runs, its live thinking, notes and steps, followed in their own
  state with the same reducer; its files show as names only. The conversation's corner opens
  the reply's task list, which leads to a card or a review.
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
  that runs `skills/<name>/...` is shown as that skill; asking for data is such a skill
  call, followed by its retrieval's card. Analyst and retrieval commands are named by
  their business action (inspect ontology, probe values, run query, search metrics and
  knowledge, prepare dataset, run calculation); a finished process row lists the
  distinct actions and the step count, and a retrieval card uses the same step views.
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
