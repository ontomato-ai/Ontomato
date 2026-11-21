# Page drafts

[src/page-draft.ts](src/page-draft.ts) owns these shapes (`@ontomato/contracts/page-draft`).

A page draft is what an agent wrote for one page to fill in, and the reader saves. It is a run artifact, not a table
and not a confirmation card: no draft is stored or confirmed anywhere else, and a discarded draft is only a file the
conversation no longer uses. The one fact kept beside it is the object a create draft's first save created (below).

```ts
type PageDraft<Form> = {
  pageKey: string;          // the page's registration key, e.g. agent-settings
  operation: string;        // the page's own form action, e.g. agent.update
  target: { objectType: string; id?: string }; // the type and, for an edit, the owner's opaque id
  form: Form;               // the page's save request body
  created?: { id: string }; // read only: the object a create draft's first save created
};
```

`pageKey`, `operation` and `target` belong to the page; `form` is the owner's own save input, so only the page checks
its structure. The page checks the target type before choosing a form. The page and object owner check the id format,
for example, a UUID for an agent definition or a stable string for business knowledge. Each page's form types stay with
their API owner; the shared envelope carries the page key the page compares before filling anything.

## Writing and reading

A run writes drafts to `outputs/drafts/<name>.page-draft.json`. The page link carries only the run artifact:

```text
#/agents/settings/<id>?draftSessionId=<session>&draftRunId=<run>&draftPath=outputs%2Fdrafts%2Fagent.page-draft.json
```

It never carries the form itself, a credential or a local path.

| Method/path | Input | Output |
| --- | --- | --- |
| GET `/sessions/:sessionId/runs/:runId/page-draft?path=` | draft path | `PageDraft` (`pageDraftReadSchema`) |
| POST `/sessions/:sessionId/runs/:runId/page-draft/created` | `{ path, id }` (`pageDraftCreatedSchema`) | 204 |

The routes serve the workbench assistant prefix (`/api/assistant`). They reuse the existing session ownership check and
the run-and-path artifact resolution, and read drafts from `outputs/drafts/*.page-draft.json` only: another file of
the same run is not a draft, and the path schema rejects it. Reading a draft is not the target page's permission; the
page still reads the object and saves through the owner's own endpoints, which decide whether the reader may write.

## A create draft's object

A create draft names an object type and omits `target.id`. It has no real object until its first save, so the page that saves
it records the id that save created with `POST .../page-draft/created`, as the reader who may read the draft. The
record is written once: the same id again is accepted, another id is `409 PAGE_DRAFT_CREATED_CONFLICT`, and a draft
that names its target is `409 PAGE_DRAFT_NOT_CREATE`. The agent's file is never rewritten, and the file cannot carry
`created` itself: only the read adds it, from the record. The record lives in `assistant_page_draft_creations`, keyed
by the conversation, the run and the draft's path, and goes with its conversation.

The shared `draftTarget(draft)` returns `{ kind: "update", objectType, id }` for an edit or a draft that
carries `created`, and `{ kind: "create", objectType }` for a new object. A create draft saved once is from
then on an update of the object it created, so its link opens that object and, unchanged, opens it as it is. If that
object has since been deleted, the page reports it missing as it would any missing object; it never offers the create
again.

Filling, marking the changed fields and saving stay in the page: opening a draft never calls a write endpoint, and the
saved call is the page's own. A draft is a change to the object the page reads: when filling it in changes nothing —
the same link opened again after its draft was saved — the page opens as the object is, with no draft note, no marked
field and nothing unsaved.
