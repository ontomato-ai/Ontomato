# Preview execution context

An application or panel preview, and an App Builder run, carry `X-Ontomato-Execution-Context`
with exactly `{"kind":"preview"}`. The header is the preview identity, and it does one thing: it
refuses running. It never routes a read, changes the read target, enters a grant filter or a cache
key. Reads always use the caller's live authority.

**Building is not refused; running is.** Saving, publishing or deleting a definition, a model, a
panel, an application or a trigger is building: its owner judges it against the caller's permission,
as for any caller. Running is an entry that writes business data, or that starts on the spot an
execution which does. A preview is refused there with “预览里不执行写操作，动作的对错用动作试跑验”,
code `PREVIEW_WRITE_FORBIDDEN`.

## The entries

`carriesPreviewIdentity` in `src/execution-context.ts` is the one place Node lists them, by service
below the API root. There is no list of entries a preview may call.

| Entry | Owner | What a preview gets |
| --- | --- | --- |
| `POST /action/execute` | DataRAG | Refused before parameters, temporary files or an action runtime are prepared |
| `POST /platform/triggers/{id}/runs` (run a trigger now) | DataRAG | Refused before a run is admitted, whatever the trigger targets (Action, workflow, application) |
| `POST /writeFunctionOperation/insert\|update\|delete\|createEdge\|deleteEdge\|appendVector\|updateVector\|deleteVector` | DataRAG | Refused when the grant binds live data; admitted when it binds an action-trial or generation sandbox (`sandboxId`), where the run writes and reads back what it wrote |
| `POST /vectorResource/upload\|delete` | DataRAG | As the `writeFunctionOperation` writes |
| `POST /praxis/runs` (start a workflow run) | Praxis, through Node's `/api/praxis` | Refused before the request is read: no run, ledger entry or tick |
| `POST /panel-operations/intents/{id}/dispatch` | Node | The operation it carries out is the caller's; an Action it executes is refused at `/action/execute` |
| `POST /assistant/sessions`, `POST /assistant/sessions/{id}/runs` | Node | Not refused: the conversation and its runs become the preview's (below) |

Not running, so never marked: `/writeFunctionOperation/query`, `/action/trial`,
`/metricView/test|testExecute` and `/ontology/ai/generation/…` (they write only inside the run's own
sandbox); registering or editing a trigger, and its scheduled runs; reading Praxis.

A path is matched as loosely as its owner routes it: in any letter case, with or without
percent-decoding, with repeated or a trailing slash.

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
  The Praxis route passes it on only for `POST /runs`. A page operation a preview run prepared keeps
  the marker in its intent, so it is refused whoever confirms and dispatches it.
- A conversation opened with the identity is stored as the preview's (`assistant_sessions.preview`):
  every run in it runs with preview authority, wherever it is later sent from, and so does a run a
  preview sends into any conversation. Its callbacks then carry the identity as above. A preview run
  still cannot delegate: the agent channel refuses its commands, and a host refuses a delegated
  preview run of an agent that would run live.

A panel operation in a preview is refused by the preview host, with the same words.
