# Actions: how the work on this page is done

This page manages the domain's actions (`platform:Action`): reading them one by one, editing a definition, changing
status, deleting what is no longer wanted, and reading the definition and code explanation the owner derives from the
code. The page skill lists the projections, their reads and operations (read the current data, fill live forms, call
an operation via `page_action`); this adds what the page does not show.

## What the page shows

- The catalog (`catalog.rows`) is the whole `list` read of the domain's actions, one row each: the name in `label`, the
  description in `subtitle`, and in `fields` the `function` name, `origin`, `status`, `createdBy`, `reviewedBy` and
  `updatedAt`.
- The keyword above the catalog only filters the page by name and description and is not sent to the owner. Do not
  build a query for it; read `catalog.rows` and filter it yourself.
- Opening a row writes it into the panel state `selected` (a `platform:Action` reference). The checked rows are in
  `checked`, the targets of the batch status change.
- The details show the action header (`header.record`) and three tabs (`activeTab`: `"definition"`, `"derived"`, or
  `"code"`):
  - **Definition**: `form.form` (existing action) or `form.createForm` (new action), saved via `page_action` `form.save`.
  - **Derived definition**: `derivedSummary.record`, `derivedEffects.rows`, `derivedParameters.rows`, and
    `derivedConditions.rows`.
  - **Code explanation**: `explanation.content` (`annotatedExplanation`).
  The owner makes a system action read-only and a published action's code read-only; do not work around either.

## Seeing what is on the page

- The selected action is in this message's page context: the `selection` with `className` `platform:Action` and the
  action id as `primaryKey`, or empty when nothing is selected. "This action" means it.
- The mounted projection reads on this page are `catalog.rows`, `header.record`, `form.form` / `form.createForm`,
  `derivedSummary.record`, `derivedEffects.rows`, `derivedParameters.rows`, `derivedConditions.rows`, and
  `explanation.content`. Use only these mounted reads.
- The form's content is what `form.form` (or `form.createForm` in create mode) returns, and `observe_display` shows the
  live mounted form values including unsaved user edits. Read `form.form` for its `fields` and `values`.
- Before editing or continuing the reader's edit, check `observe_display` and read `form.form` once; when it differs
  from what you were about to change, say how.
- To explain what an action does, read `explanation.content`: `segments` are the explained parts of the code, each with
  its `lineRange`, `kindLabel`, and `title`; `summary` lists what it does and what can go wrong. Read
  `derivedSummary.record`, `derivedEffects.rows`, `derivedParameters.rows`, and `derivedConditions.rows` for the
  effects, parameters, and submission conditions derived from the same code.

## Running a definition in the owner's sandbox

The owner adopts a save that changes the code or the parameters only when the run that prepared it executed the
same code and parameters in the owner's sandbox and the owner accepted it. This run reaches the owner's authoring
endpoints under `$ONTOMATO_AUTHORING_URL`; send `X-Ontomato-Callback-Credential: $ONTOMATO_EXECUTION_CALLBACK` and
`X-Ontomato-Run-Id: $ONTOMATO_RUN_ID` with each call, and JSON bodies.

1. `GET $ONTOMATO_AUTHORING_URL/action/context`: the Python protocol and helpers the owner runs. Write the code by it.
2. `POST $ONTOMATO_AUTHORING_URL/action/prepare` with the sample the run executes against:
   `{"objDatas":[{"className":"<technical class>","rows":[{…}]}],"relDatas":[],"vectorDatas":[]}`. Each row carries
   its primary key and the attributes the code reads or writes, by the technical class and field names. Nothing is
   taken from live data.
3. `POST $ONTOMATO_AUTHORING_URL/action/reset` with `{}`.
4. `POST $ONTOMATO_AUTHORING_URL/action/test` with `{"code":"<function.code>","parameterDefs":<function.parameters>}`,
   each parameter carrying the sample value it runs with in `value`. A non-empty `result.error` is the owner's answer:
   fix the code or the sample and repeat from step 3.
5. Optionally call `POST $ONTOMATO_AUTHORING_URL/action/explain-draft` with the same `code` and `parameterDefs` to
   prepare or inspect the draft explanation in this run. Do **not** pass `explanationRef` into `fill_form`:
   `explanationRef` is not a form field (passing it fails with `unknown_field`); after sandbox verification, the owner
   reuses or generates the explanation for this run on save.

Run these in the same run that fills the form, and fill exactly the code and parameters that passed. Only a test of
that exact code and those parameters with no `result.error` counts: a probe or another version passing does not, and
the owner refuses the save. When a step is refused, do not fill the form; say which step stopped and
quote the owner. A sample class "outside the authoring scope" is outside the classes this run was admitted for: name
that class and stop. Do not retry with other classes and do not fill the form. To author on it, the reader switches to an agent
that can load this page's skill, whose class scope includes that class and whose executor may act on it.

## Form field paths (`form.form` / `form.createForm`)

The live `form` exposes these field paths for `fill_form`:

- `/name`
- `/description`
- `/status` (`PENDING_REVIEW`, `PUBLISHED`, or `UNUSED`)
- `/target` (nullable object `{ className, keyParameter }`, or leaf paths `/target/className` and `/target/keyParameter`)
- `/function/name`
- `/function/parameters`
- `/function/returnDef/classNames`
- `/function/logic`
- `/function/code`

Do **not** pass a whole `/function` object as one field, and do **not** pass `explanationRef` in `fill_form`
(`explanationRef` is not a declared form field and fails with `unknown_field`).

## Editing an action: fill the live form, the reader saves (or confirms)

1. Read `form.form` first. Use only the owner's declared field paths listed above and current values; do not invent
   field names.
2. When the change touches `/function/code` or `/function/parameters`, run the changed definition in the owner's
   sandbox (above) before filling the form. A change to `/name`, `/description`, `/status`, or `/target` alone needs no
   sandbox run: the owner compares the code and parameters with the saved ones.
3. Ensure the target action is open on the `"definition"` tab via `present` (`selected`, `activeTab: "definition"`).
4. Call `fill_form` on `form` with only the changed field paths (never a top-level `function` field and never
   `explanationRef`). The page marks the changed fields and keeps them unsaved.
5. Leave saving to the reader, or invoke `page_action` `form.save` when the reader explicitly asks to save (default
   sessions ask for confirmation in chat first; full-auto saves directly).

When an edit changes `/function/code`, say so: on save the owner reuses or generates the explanation for the new code
from this verified run, and the derived definition and code explanation follow it. A published action's code cannot
change (the owner refuses at `/function/code`); stop using it or create another action instead.

## Creating an action: the only way

The page has no blank manual creation. The new-action button on this page only opens this page's input with an
opening line; the reader sends the message. The action starts with you:

1. Write the action: its target object type and key parameter (a `TYPE_STRING` parameter carrying the object's primary
   key), and its write function fields (`name`, typed `parameters`, `returnDef.classNames`, `logic`, and Python `code`
   by the owner's protocol).
2. Run it in the owner's sandbox (above) until the owner accepts the run.
3. Read `form.createForm` once for the new action form's fields and defaults (the status defaults to `PENDING_REVIEW`).
4. Open the create form via `present` with `{ state: { selected: null, creating: true, activeTab: "definition" } }`.
5. Call `fill_form` on `form` using the individual field paths that passed: `/name`, `/description`, `/status` (if
   changing from `PENDING_REVIEW`), `/target` (or `/target/className` and `/target/keyParameter`; omit when there is no
   target), `/function/name`, `/function/parameters`, `/function/returnDef/classNames`, `/function/logic`, and
   `/function/code`. Do **not** pass a whole `function` object as one field and do **not** pass `explanationRef` (the
   owner reuses or generates the explanation for this verified run on save). Do not rewrite a parameter or a line of
   code after the run. Let the reader review and save, or invoke `page_action` `form.save` when requested.
6. Never write code segments or business meaning summaries yourself; they come from the owner's explanation on save.

## Changing status (batch)

- After the reader checks actions (`checked`), call `page_action` `setStatus.setStatus` (targeting `checked`) with
  `input.status` set to `"PENDING_REVIEW"`, `"PUBLISHED"`, or `"UNUSED"`.
- Put every checked target and one `input.status` in one intent. The owner answers each action on its own; report the
  successes, refusals and failures apart instead of a single "done".
- Publishing (`PUBLISHED`) records the person who did it as the reviewer. The owner refuses a system action; pass its
  words on to the reader.

## Deleting

- Delete one selected action at a time with `page_action` `remove.delete` (targeting `selected`). The platform first
  asks the reader to confirm and names the action; nothing is deleted before that.
- A system action has no delete. The owner refuses to delete an action a scheduled task references and says why; tell
  the reader in its words and do not work around it (for example by stopping the action first).
- Deleting removes the action with its definition and code explanation. The write function it references is a separate
  asset and is not deleted with it.
