# Agent tasks contract

Shapes are owned by `src/agent-tasks.ts` and `src/agent-task-results.ts`. Runtime reads
its existing delegation intents; providers project business results. No task table is added.

| kind | Source | Root | Parent |
| --- | --- | --- | --- |
| agent | One provider-prepared execution; ID is its run ID | The reply that delegated it | requestedBy execution, null at the selected conversation |
| quality | The check a finished reply asked for, of the outputs it cited from one retrieval | The reply that cited them | The retriever task that delivered them; null for a metric the assistant ran itself |

Retrieval is an agent task with an optional `retrieval` extension: question, current
decisionRevision and the delivered datasets with truncation. It has one card. Java interprets
the business status in RetrievalTasks: it runs until the retriever's delivery is recorded; a
normal stop completes it, otherwise failures and cancellations retain their reason. Checking
belongs to the reply that adopts the outputs and never prolongs the retrieval. A check's
`checks.datasets` names the cited formal outputs; one retrieval gets one check, kept by later
replies that cite it again. An interrupted check reads as failed, never a zero score. Older
quality jobs have null createdAt.

The runtime's recursive subtree query fixes each task's root to the selected conversation's
requesting run. prepare/read/cancel/settle call the owning provider directly. A page process
links to that page; an inline process reads the child runtime's public run projection. System
prompts, host context and environment never cross into these public snapshots.

GET `/assistant/sessions/:sessionId/tasks` reads the projection. Its `/events` stream registers
before the initial read and pushes whole tasks_snapshot frames after runtime or provider
changes. There is no two-second polling read. The runtime projects delegated executions; the
workbench adds each reply's checks from the ontology service, so the read and the stream share
one projection and a check has one job ID wherever it appears. Delivery signals the runtime after
its facts commit; a check's admission or completion reaches the workbench, which signals the reply's
run on its own host. The drawer renders every delegation depth and lists each check under the reply
that cited its data, beneath its retriever task when that task belongs to the same reply. Selecting deeper inline work expands its read-only process in the drawer,
using the existing task snapshot and event proxy; page-backed work links to its declared page.
Opening and continuing another host's conversation belongs to
[platform assistants and page activation](https://infohub.eloyzh.de/o/work_item-89187650).
`/tasks/:taskId/process` and its `/events` read the task's own execution
through the runtime's delegation authorization, under the normal public run projection.

The product-external task snapshot/events expose the same provider delivery: status, summary,
process, result references, retrieval extension, file references and questions.
Questions carry their original receipt ID and answered flag. A question does not stop the sender.
