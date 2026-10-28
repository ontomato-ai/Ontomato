# Agent shell contract

Implemented contract, 2026-10-28 (batch 3). Types live in
[src/agent-shell.ts](src/agent-shell.ts); the Vue implementation is
`packages/agent-shell-ui`. Runtime facts are [agent-runtime.md](agent-runtime.md);
artifact references are [agent-artifact-markdown.md](agent-artifact-markdown.md).
The host HTTP protocol behind the port is owned by the workbench server, not here.

## Ownership

`@ontomato/agent-shell-ui` owns the conversation shell: two-column layout with a
right-side outlet, navigation (feature entries, agent selector, the selected
agent's sessions), the conversation stream, the composer and the artifact outlet.
Its only product dependency is `@ontomato/contracts`. It imports no workbench,
Ontology Manager or server code, no Pinia store, router or i18n instance; the host
passes labels and reads theme values through the existing CSS variables.

The host owns navigation outside the shell, credentials, HTTP/SSE, the session
index, menu authorization, feature pages, concrete artifact renderers and
feedback storage. Hiding an entry never authorizes its server operation.

## Declarations

A workbench is code: `ShellWorkbenchDeclaration` lists its feature entries; its
agent definitions belong to the host and arrive through the port. Feature entries
are `page` (host renders it in the main area through the `feature` slot, keyed by
feature ID), `action` (the shell emits it and the host reacts in place, e.g. a
dialog), `link` (navigates away) or `unavailable` (visible placeholder, no action;
scheduled tasks use this until they return).
Editions supply their own feature entries to the same business workbench; there
is one layout. Workbenches in other applications are links.

## Port

`AgentShellPort` is the only data path. Every payload keeps the runtime's PI
shape (`RuntimeSessionSnapshot`, `RuntimeRunSnapshot`, `RuntimeStreamFrame`,
`RuntimeArtifact`). Run state is `status` + `stopReason` + `errorMessage`; the
shell never derives completed/failed/needs-input states. A clarification is an
ordinary answer and the next user message continues the same session.

- `listAgents()`: the host's agent definitions for this workbench; disabled agents
  stay listed so their history remains selectable, but cannot start runs.
- `listSessions(agentId, cursor)`: the host index for the current user, domain and
  agent, newest first, paged by an opaque cursor. The title is the first user
  message verbatim; no model call, no follow-up suggestions.
- `send({agentId, sessionId, text})`: `sessionId: null` creates the session first
  (`createdSession`). Every later message, including the answer to a clarifying
  question, starts a run in the same session. The result carries the admitted
  run snapshot; the shell subscribes after its cursor.
- `readRun` / `subscribe(sessionId, runId, {seq, streamId}, handlers)`: frames
  after the cursor. Events
  at or below the last applied `seq` are ignored. `snapshot_required` or a
  transport error makes the shell re-read the run snapshot and subscribe again;
  a stopped snapshot needs no stream. Detaching never cancels execution.
- `cancel(sessionId, runId)`: explicit user action only.
- `resolveArtifact({sessionId, runId, path})` then `readArtifact(artifact)`:
  resolution is per run (the version at the run's end, or the current one while
  it runs); bytes come through the host's authenticated proxy. Artifacts already
  seen in the run's snapshot or `artifact_registered` events resolve locally first.
- `feedback` (optional): rating and reason per assistant message.

## Projection

A pure reducer merges snapshots and frames by message ID, `toolCallId` and
artifact ID, never by array position. `message_update` applies content-block
deltas to the identified partial; `message_end` replaces it with the settled
message. Text blocks render as standard Markdown through markstream-vue; single
newlines are line breaks and only `~~` marks strikethrough, matching the other
delivery channels. Thinking and tool calls render as one generic collapsible
process row per run of consecutive blocks; there are no per-tool cards. System
messages never become bubbles.

## Artifact rendering

Markdown `outputs/` image syntax renders inline; link syntax renders a file card
that opens in the right panel. An unclosed reference shows a placeholder until the
parser settles it. Artifact components are keyed by run and path so streaming does
not remount them. Hosts register renderers as `{extensions, component}`; the shell
picks the longest matching suffix (`.chart.json` before `.json`) and falls back to
a download card. Renderer props are `{artifact, title, presentation, read}` with
`presentation` `inline` or `panel`; the same renderer serves both. HTML renders in
an iframe with `sandbox="allow-scripts"` only.
