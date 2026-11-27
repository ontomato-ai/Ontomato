# Preview execution context

An application or panel preview carries `X-Ontomato-Execution-Context` with exactly
`{"kind":"preview"}`. The header is the preview identity used for write admission, and for nothing
else: it never routes a read, changes the read target, enters a grant filter or a cache key. Reads
always use the caller's live authority.

**A preview is restricted in one way only: it does not write business object data.** The business
data write entries (`entersBusinessDataWrite` in `src/execution-context.ts`, the one place Node lists
them) are:

- `POST /action/execute`;
- `POST /writeFunctionOperation/insert|update|delete|createEdge|deleteEdge|appendVector|updateVector|deleteVector`
  (`/writeFunctionOperation/query` reads);
- `POST /vectorResource/upload|delete`;
- `POST /platform/triggers/{id}/runs`, a trigger's manual run, whose Action target runs as that request.

Definitions, models, a trigger's registration and lifecycle, workflows, environment imports and the
platform's own objects are not in it: a preview building an application asks for those like any
other caller, and their owner judges the request against the caller's permission. There is no list of
entries a preview may call.

The marker is carried to those entries and to no others:

- A preview frame marks a request only when it goes straight to one of those DataRAG entries.
- A run callback proxy injects it only when that request enters one: a DataRAG write, or the
  workbench dispatch that carries out a prepared panel operation as the run. A caller-supplied
  different value is refused; values are never merged.
- Workbench keeps an incoming preview identity as a marker inside the caller's credentials and turns
  it back into the header only on a server-side operation's request to one of those entries. A page
  operation a preview run prepared keeps the marker in its intent, so it is refused whoever confirms
  and dispatches it.

Java refuses a marked `/action/execute` before parameters, temporary files or an action runtime are
prepared: “预览里不执行写操作，动作的对错用动作试跑验”, code `PREVIEW_WRITE_FORBIDDEN`. A marked
manual run of an Action trigger is refused with the same code and words before a run is admitted;
application and workflow triggers run as usual. A marked `/writeFunctionOperation/…` or
`/vectorResource/…` write is refused only when its grant binds no action-trial or generation
sandbox: inside such a sandbox the run writes and reads back what it wrote, which is how a trial or a
generation check answers its question.

A panel operation in a preview is refused by the preview host, with the same words.
