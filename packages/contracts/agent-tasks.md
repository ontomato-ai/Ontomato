# Agent tasks contract

Implemented 2026-11-12 for the first step (retriever and quality check). Shapes are in
`src/agent-tasks.ts`; Node and the shell import them, Java writes the same wire.

A task is work a reply delegated, read from the record that already owns it. Nothing is
stored as a task:

| Task | Is | ID | Parent |
| --- | --- | --- | --- |
| `retrieval` | one retrieval round (`ontology_agent_runs`), both its branches | the round ID | none |
| `quality` | the quality job one branch of that round scheduled | the job ID | the round |

The ontology service interprets status once, in `RetrievalTasks`. A round runs until both
branches end; it completed when something was delivered (a dataset, or the retriever's
normal answer or question), otherwise it failed when a branch failed and was cancelled when
none did. Each branch keeps its own status, error, datasets and truncation. A quality job's
status is its own; `interrupted` reads as failed with `JOB_INTERRUPTED`. A failed check has
its error and no result, never a zero score. `createdAt` is null for jobs admitted before
job start times were kept. `process` is `inline` (the task's runtime session and run) once the
retriever run was admitted, otherwise `none`. The shell never reads business facts from
titles or runtime stop reasons.

## Routes

| Method/path | Shape / meaning |
| --- | --- |
| GET ontology `/ontology/retrieval-callers/tasks?callerIds=…` | Workbench service only. `CallerTasks`: the callers' rounds and quality tasks with their `callerId`, completed checks' results and `settled` (no task running, no branch owing its check) |
| GET `/assistant/sessions/:sessionId/tasks` | `AgentTasksSnapshot`, the authoritative read |
| GET `/assistant/sessions/:sessionId/tasks/events` | `event: tasks`, `AgentTasksFrame` (`tasks_snapshot`): the whole snapshot on connect and after every change |
| GET `/assistant/sessions/:sessionId/tasks/:taskId/process` | The retrieval task's run snapshot, under the conversation's public projection |
| GET `…/process/events?afterSeq=&streamId=` | That run's own `event: runtime` frames on its own cursor |

The workbench owns the root: each admitted turn's caller scope is its reply's run, so a task's
`root` is `{sessionId, runId: turn.id}`. Java keeps no conversation ownership and never reads
the workbench database. Old and new conversations take the same path; a conversation without
rounds has no tasks.

The ontology projection is the only source of change. While the task stream is open and
anything can change (a task running, a check owed, or the latest turn not settled), the
workbench reads it again every two seconds and sends a frame only when it changed. A settled
frame ends the stream; the shell opens it again when the conversation's next run starts, and
after a broken stream, reading the whole snapshot again. No cursor, replay or cache.

The process routes find the task in the session's snapshot and read its run through the
caller scope of the reply that delegated it. They use the same projection as the conversation
(no system prompts, environment or credentials) and the shell's ordinary reducer, in a state
of their own.

Retrieval reads (`ask --status`, snapshots, binding datasets) name each branch's quality task
(`qualityTasks: [{taskId, source}]`, a binding dataset's `qualityTaskId`) instead of embedding
the job.
