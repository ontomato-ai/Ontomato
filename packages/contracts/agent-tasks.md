# Agent tasks contract

Shapes are owned by `src/agent-tasks.ts` and `src/agent-task-results.ts`. Runtime reads
its existing delegation intents; providers project business results. No task table is added.

| kind | Source | Parent |
| --- | --- | --- |
| agent | One provider-prepared execution; ID is its run ID | requestedBy execution, null at the selected conversation |
| quality | A retrieval branch's quality job | The agent execution whose branch it checks |

Retrieval is an agent task with an optional `retrieval` extension: question, current
decisionRevision and branch states, datasets and truncation. It has one card. Java interprets
the business status in RetrievalTasks: it runs until both branches end; partial datasets or
a normal retriever answer complete the business result, otherwise failures and cancellations
retain their reason. Quality jobs do not prolong that execution. An interrupted check reads
as failed, never a zero score. Older quality jobs have null createdAt.

The runtime's recursive subtree query fixes each task's root to the selected conversation's
requesting run. prepare/read/cancel/settle call the owning provider directly. A page process
links to that page; an inline process reads the child runtime's public run projection. System
prompts, host context and environment never cross into these public snapshots.

GET `/assistant/sessions/:sessionId/tasks` reads the projection. Its `/events` stream registers
before the initial read and pushes whole tasks_snapshot frames after runtime or provider
changes. There is no two-second polling read. Quality admission/completion and branch delivery
signal the runtime after their facts commit. The drawer renders every delegation depth and each
branch's quality child. Selecting deeper inline work expands its read-only process in the drawer,
using the existing task snapshot and event proxy; page-backed work links to its declared page.
Opening and continuing another host's conversation belongs to
[platform assistants and page activation](https://infohub.eloyzh.de/o/work_item-89187650).
`/tasks/:taskId/process` and its `/events` read the task's own execution
through the runtime's delegation authorization, under the normal public run projection.

The product-external task snapshot/events expose the same provider delivery: status, summary,
process, result references, retrieval extension, quality attachments, file references and questions.
Questions carry their original receipt ID and answered flag. A question does not stop the sender.
