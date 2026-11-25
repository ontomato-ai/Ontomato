# Actions catalog: how the work on this page is done

This page is the full-width catalog of the domain's actions (`platform:Action`) at `/ontology/assets/actions`. Editing
an action's definition, reading its derived definition and code explanation, and deleting an action all live on the
dedicated detail entry `/ontology/assets/actions/detail`.

## What the page shows

- The catalog (`catalog.rows`) is the whole `list` read of the domain's actions, one row each: the name in `label`, the
  description in `subtitle`, and in `fields` the `function` name, `origin`, `status`, `createdBy`, `reviewedBy` and
  `updatedAt`.
- `keyword` filters the catalog locally by name and description and is not sent to the owner. Do not build a query for
  it; read `catalog.rows` and filter it yourself.
- The checked rows are in `checked`, the targets of the batch status change (`setStatus.setStatus`).
- Clicking a row navigates to `/ontology/assets/actions/detail?selected=<primaryKey>`.
- The header's primary **New action** button (`newAction`) opens this page's agent input with an opening line without
  sending it. There is no blank manual creation form on the catalog page.

## Changing status (batch)

- After the reader checks actions (`checked`), call `page_action` `setStatus.setStatus` (targeting `checked`) with
  `input.status` set to `"PENDING_REVIEW"`, `"PUBLISHED"`, or `"UNUSED"`.
- Put every checked target and one `input.status` in one intent. The owner answers each action on its own; report the
  successes, refusals and failures apart instead of a single "done".
- Publishing (`PUBLISHED`) records the person who did it as the reviewer. The owner refuses a system action; pass its
  words on to the reader.

## Creating an action: the only way

The catalog has no blank manual creation modal. The header's New action button only opens this page's input with an
opening line; the reader sends the message. The action starts with you:

1. Write the action: its target object type and key parameter (a `TYPE_STRING` parameter carrying the object's primary
   key), and its write function fields (`name`, typed `parameters`, `returnDef.classNames`, `logic`, and Python `code`
   by the owner's protocol).
2. Run it in the owner's sandbox under `$ONTOMATO_AUTHORING_URL` (`GET /action/context`, `POST /action/prepare`,
   `POST /action/reset`, `POST /action/test`, optionally `POST /action/explain-draft`) with headers
   `X-Ontomato-Callback-Credential: $ONTOMATO_EXECUTION_CALLBACK` until the owner accepts the exact code and
   parameters with no `result.error`. The session bridge supplies the active run header.
3. Open the detail entry in create mode via `present` at `/ontology/assets/actions/detail` with
   `{ state: { selected: null, creating: true, activeTab: "definition" } }`, read `form.createForm`, and fill the live
   `form` via `fill_form` using the individual field paths (`/name`, `/description`, `/status`, `/target`,
   `/function/name`, `/function/parameters`, `/function/returnDef/classNames`, `/function/logic`, `/function/code`).
   Do **not** pass a whole `function` object or `explanationRef`.
4. Let the reader review and save in the header, or invoke `page_action` `form.save` when explicitly requested.

## Opening an action's detail

- To view, edit, inspect derived rules or code explanation, or delete an action, navigate to
  `/ontology/assets/actions/detail?selected=<primaryKey>` (and optionally `activeTab` set to `"definition"`,
  `"derived"`, or `"code"`).
