# Preview execution context

An application or panel preview, and an App Builder run, carry `X-Ontomato-Execution-Context`
with exactly `{"kind":"preview"}`. The header is the preview identity, and it does one thing: it
refuses running. It never routes a read, changes the read target, enters a grant filter or a cache
key. Reads always use the caller's live authority.

**In a preview, writing formal business data, and starting or advancing a formal run, are refused;
only reads, and the writes that build (saving a definition, registering, workspace files), go
through.** Building is judged by its owner against the caller's permission, as for any caller.
Approving a step from a preview's to-do list changes a real approval and is refused. A refusal reads
“预览里不执行写操作，动作的对错用动作试跑验”, code `PREVIEW_WRITE_FORBIDDEN`.

## The entries

`carriesPreviewIdentity` in `src/execution-context.ts` is the one place Node lists them, by service
below the API root. There is no list of entries a preview may call.

| Entry | Owner | What a preview gets |
| --- | --- | --- |
| `POST /action/execute` | DataRAG | Refused before parameters, temporary files or an action runtime are prepared |
| `POST /platform/triggers/{id}/runs` (run a trigger now) | DataRAG | Refused before a run is admitted, whatever the trigger targets (Action, workflow, application) |
| `POST /writeFunctionOperation/insert\|update\|delete\|createEdge\|deleteEdge\|appendVector\|updateVector\|deleteVector` | DataRAG | Refused when the grant binds live data; admitted when it binds an action-trial or generation sandbox (`sandboxId`), where the run writes and reads back what it wrote |
| `POST /vectorResource/upload\|delete` | DataRAG | As the `writeFunctionOperation` writes |
| `POST /praxis/runs` (start), `/praxis/runs/{id}/tick` (advance), `/praxis/runs/{id}/case/submit\|fill\|close`, `/praxis/runs/{id}/acts-on`, `/praxis/steps/{id}/decide\|assign` | Praxis, through Node's `/api/praxis` | Refused before the body is read: no run, ledger entry, case, step or tick is touched |
| `POST /panel-operations/intents` (prepare a page operation) | Node | Not refused: the operation is recorded as the preview's when the request preparing it or the agent run it is for is one |
| `POST /panel-operations/intents/{id}/dispatch` | Node | The operation executes as the caller, or as the preview that prepared it whoever confirms it; an Action it executes is refused at `/action/execute` |
| `POST /assistant/sessions`, `POST /assistant/sessions/{id}/runs` | Node | Not refused: the conversation and its runs become the preview's (below) |
| `POST /ontology/ai/sessions/{id}/runs`, `POST /platform/agent-channel/commands` | DataRAG | Not refused: the agent run started there runs as the preview |
| `POST /observe/agent/sessions`, `/observe/agent/sessions/{id}/runs`, `/observe/diagnoses` | Node | Not refused: the legacy diagnosis conversation and its runs become the preview's, as an assistant conversation does |

Stopping, cancelling or deleting runs, conversations and workspaces, cancelling a pending page
operation or claiming a local confirmation (the platform's own records), and starting or stopping ops
test runs are not business writes: never marked, never refused for a preview.

Not running, so never marked: `/writeFunctionOperation/query`, `/action/trial`,
`/metricView/test|testExecute` and `/ontology/ai/generation/…` (they write only inside the run's own
sandbox); registering or editing a trigger, and its scheduled runs; reading Praxis. Node's
`/api/platform/schedule-applications/{appId}/runs` starts a scheduled application's run for the
platform's own trigger worker; it requires the platform service token, which neither a frame nor a run
callback can present.

A path is matched as loosely as its owner routes it: in any letter case, with or without
percent-decoding (a malformed encoding is read as spelled), with repeated or a trailing slash.

## How the identity reaches those entries

- A preview frame's requests go through the platform host, which drops any identity the frame
  states and sets the preview's on those entries only. A panel candidate drawn in the platform's own
  document sends its requests and its conversation the same way.
- A run callback proxy injects the run's identity on the same entries only: a DataRAG path as it
  is, a workbench path below `/api`. At those entries a caller-supplied different value is refused
  and values are never merged; elsewhere whatever the caller stated is dropped and the request
  travels as a live one.
- Node keeps an incoming identity as a marker inside the caller's credentials. The operation host
  turns it back into the header only on a server-side operation's request to a DataRAG entry above.
  The Praxis route passes it on only for the Praxis entries above. A page operation a preview run prepared keeps
  the marker in its intent, so it is refused whoever confirms and dispatches it.
- A conversation has one execution identity, fixed by its first run after provider prepare; later runs inherit it.
  A preview opening a new conversation therefore makes it preview, and a replayed create names only the conversation,
  not another identity. A preview request into an existing live conversation is refused before receipt with
  `PREVIEW_WRITE_FORBIDDEN` and “这是正式对话，预览里不能接着聊，请新开一个对话”; a live request into a preview
  conversation runs as preview. Agent results, messages and answers are ordinary inputs of the conversation they are
  sent to and do not start a separate identity's run.
- A preview run delegates as itself: the agent channel starts the agent it asks for with the same
  preview authority and class scope, and each provider (Node, DataRAG's ontology agents) prepares the
  delegated run keeping it. A run's own agent commands go only through its runtime session command
  route (bound to its active run). The delegated agent reads live data as usual; what it runs is
  refused at the entries above.
- A run never acts as its user at an agent entry. Node's callback proxy always adds
  `X-Ontomato-Agent-Execution` to a run's request (the run cannot drop or replace it), and the owners
  refuse a request carrying it, with 403 `FORBIDDEN`, at DataRAG's external agent entry
  (`/platform/agent-channel/commands`), where a new top-level conversation is opened
  (`POST /assistant/sessions`, `POST /observe/agent/sessions`, `/observe/diagnoses`, DataRAG's
  `POST /ontology/ai/sessions`) and where a message is sent to an existing one
  (`POST /assistant/sessions/{id}/runs`, `POST /observe/agent/sessions/{id}/runs`, DataRAG's
  `POST /ontology/ai/sessions/{id}/runs`). A run messages and starts agents only through its own agent
  channel. This is a permission boundary, not a preview refusal: a person in a preview frame is not a
  run, and uses conversations there as before.
- All runs of one conversation share model context, native engine, process space and resume reference. A Node analyst
  run continues the retrievals and quotes the user messages of that same conversation.
- A preview's conversation entry (a panel candidate's, or a preview frame's) reaches the page's
  composer marked as the preview's: whichever composer takes it opens a new conversation of the
  preview's own, never the reader's open one.

A panel operation in a preview is refused by the preview host, with the same words.
