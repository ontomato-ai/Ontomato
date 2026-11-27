# Preview execution context

An application or panel preview, and an App Builder run, sends every request with
`X-Ontomato-Execution-Context: preview`. The header is the preview identity. It never routes a read,
changes the read target, enters a grant filter or a cache key. Reads always use the caller's live
authority.

**Each write entry refuses the preview itself.** In a preview, writing formal business data, and
starting or advancing a formal run, are refused; only reads, and the writes that build (saving a
definition, registering, workspace files), go through. Building is judged by its owner against the
caller's permission, as for any caller. Approving a step from a preview's to-do list changes a real
approval and is refused. A refusal reads “预览里不执行写操作，动作的对错用动作试跑验”, code
`PREVIEW_WRITE_FORBIDDEN`.

A write bound to an action-trial or generation sandbox is that run's own verification and is
admitted: writing there and reading it back is how a trial or generation check answers its question.
Stopping, cancelling or deleting runs, conversations and workspaces, the platform's own records of
pending page operations, and ops test runs are platform state, not business writes. They carry the
same header when a preview sends them and their owners do not treat it as a refusal.

The only identity value is exactly `preview`. Any other value is no identity.

## How the identity reaches the owners

- A preview frame's requests go through the platform host, which drops any identity the frame states
  and sets the preview identity on every request it forwards. A panel candidate drawn in the
  platform's own document sends its requests and its conversation the same way.
- A run callback proxy writes the run's own identity on every callback request of a preview run and
  no identity on a live run's. What the caller supplied is never merged or forwarded.
- Node keeps an incoming preview identity as a marker inside the caller's credentials. Server-side
  page operations executed for that caller turn it back into the header on every request they send to
  Java or back to the workbench. The Praxis route passes an incoming preview identity through as it
  is.
- A conversation opened with the identity is stored as the preview's (`assistant_sessions.preview`,
  `ops_sessions.preview` for legacy diagnosis); a replayed create naming the other identity is
  refused (409), and a provider preparing a run in a stored conversation keeps its stored identity.
  Its callbacks then carry the identity as above. An input joins a running or waiting run only with
  the same identity, taken from trusted facts (the caller's channel, the delegating run, or the run
  it answers or reports to); a preview's message, answer or agent result never joins a live run, and
  a live one never a preview's — it queues as its own run.
- A preview run delegates as itself: the agent channel starts the agent it asks for with the same
  preview authority and class scope, and each provider (Node, DataRAG's ontology agents) prepares the
  delegated run keeping it. A run's own agent commands go only through its runtime session command
  route (bound to its active run). The delegated agent reads live data as usual; what it writes is
  refused by the write entries.
- A run never acts as its user at an agent entry. Node's callback proxy always adds
  `X-Ontomato-Agent-Execution` to a run's request (the run cannot drop or replace it), and the owners
  refuse a request carrying it, with 403 `FORBIDDEN`, at the agent entries. This is a permission
  boundary, not a preview refusal: a person in a preview frame is not a run, and uses conversations
  there as before.
- Runs of the two identities in one conversation never share model context. Each identity has its own
  native engine, process space and resume reference in the runtime; an engine opened afresh is told
  only what runs of its identity consumed, and only a live run reads the stored compaction summary. A
  Node analyst run continues the retrievals and quotes the user messages of its own identity's runs
  only.
- A preview's conversation entry (a panel candidate's, or a preview frame's) reaches the page's
  composer marked as the preview's: whichever composer takes it opens a new conversation of the
  preview's own, never the reader's open one.

A panel operation in a preview is refused by the preview host, with the same words.
