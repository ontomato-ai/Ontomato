# Page drafts

[src/page-draft.ts](src/page-draft.ts) owns these shapes (`@ontomato/contracts/page-draft`).

A page draft is what an agent wrote for one page to fill in, and the reader saves. It is a run artifact, not a table
and not a confirmation card: no draft is stored or confirmed anywhere else, and a discarded draft is only a file the
conversation no longer uses.

```ts
type PageDraft<Form> = {
  pageKey: string;          // the page's registration key, e.g. agent-settings
  operation: string;        // the page's own form action, e.g. agent.update
  target: { id?: string };  // the owner's opaque id, 1-200 characters; a create leaves it out
  form: Form;               // the page's save request body
};
```

`pageKey`, `operation` and `target` belong to the page; `form` is the owner's own save input, so only the page checks
its structure. The envelope does not fix the id's format either: the page and the object's owner check it, e.g. the
agent settings page expects a UUID while a business knowledge id is any stable string. Each page's form types stay with
their API owner; the shared envelope carries the page key the page compares before filling anything.

## Writing and reading

A run writes drafts to `outputs/drafts/<name>.page-draft.json`. The page link carries only the run artifact:

```text
#/ontology/agents/<id>?draftSessionId=<session>&draftRunId=<run>&draftPath=outputs%2Fdrafts%2Fagent.page-draft.json
```

It never carries the form itself, a credential or a local path.

| Method/path | Input | Output |
| --- | --- | --- |
| GET `/sessions/:sessionId/runs/:runId/page-draft?path=` | draft path | `PageDraft` |

The route serves the workbench assistant prefix (`/api/assistant`). It reuses the existing session ownership check and
the run-and-path artifact resolution, and reads drafts from `outputs/drafts/*.page-draft.json` only: another file of
the same run is not a draft, and the path schema rejects it. Reading a draft is not the target page's permission; the
page still reads the object and saves through the owner's own endpoints, which decide whether the reader may write.

Filling, marking the changed fields and saving stay in the page: opening a draft never calls a write endpoint, and the
saved call is the page's own.
