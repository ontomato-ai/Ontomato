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
- A conversation has one execution identity, fixed by its first run after provider prepare; later runs inherit it.
  A preview opening a new conversation therefore makes it preview, and a replayed create names only the conversation,
  not another identity. A preview request into an existing live conversation is refused before receipt with
  `PREVIEW_WRITE_FORBIDDEN` and “这是正式对话，预览里不能接着聊，请新开一个对话”; a live request into a preview
  conversation runs as preview. Agent results, messages and answers are ordinary inputs of the conversation they are
  sent to and do not start a separate identity's run.
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
- All runs of one conversation share model context, native engine, process space and resume reference. A Node analyst
  run continues the retrievals and quotes the user messages of that same conversation.
- A preview's conversation entry (a panel candidate's, or a preview frame's) reaches the page's
  composer marked as the preview's: whichever composer takes it opens a new conversation of the
  preview's own, never the reader's open one.

A panel operation in a preview is refused by the preview host, with the same words.
