# Action detail: how the work on this page is done

This non-menu detail page at `/ontology/assets/actions/detail` inspects and edits one domain action (`platform:Action`):
its definition form, the definition the owner derives from its explained code, its annotated code explanation, and
deletion. The single-row page header carries the back link to `/ontology/assets/actions`, the action title/status
(`header.record`), the delete button (`remove.delete`), and the header Save/Discard controls wired to `form`.

## Seeing what is on the page

- The selected action is in this message's page context: `selected` (`className`: `platform:Action`, `primaryKey`:
  action ID). "This action" means it.
- The three tabs are controlled by `activeTab`: `"definition"`, `"derived"`, or `"code"`.
  - **Definition**: `form.form` (existing action) or `form.createForm` (when `creating: true` with `selected: null`),
    saved via `page_action` `form.save`.
  - **Derived definition**: `derivedSummary.record`, `derivedEffects.rows`, `derivedParameters.rows`, and
    `derivedConditions.rows`.
  - **Code explanation**: `explanation.content` (`annotatedExplanation`).
  The owner makes a system action read-only and a published action's code read-only; do not work around either.
- The mounted projection reads on this page are `header.record`, `form.form` / `form.createForm`,
  `derivedSummary.record`, `derivedEffects.rows`, `derivedParameters.rows`, `derivedConditions.rows`, and
  `explanation.content`. Use only these mounted reads.
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
the owner refuses the save. When a step is refused, do not fill the form; say which step stopped and quote the owner.
A sample class "outside the authoring scope" is outside the classes this run was admitted for: name that class and stop.

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

Do **not** pass a whole `/function` object as one field, and do **not** pass `explanationRef` in `fill_form`.

## Editing an action: fill the live form, the reader saves (or confirms)

1. Read `form.form` first. Use only the owner's declared field paths listed above and current values; do not invent
   field names.
2. When the change touches `/function/code` or `/function/parameters`, run the changed definition in the owner's
   sandbox (above) before filling the form. A change to `/name`, `/description`, `/status`, or `/target` alone needs no
   sandbox run: the owner compares the code and parameters with the saved ones.
3. Ensure the target action is open on the `"definition"` tab via `present` (`selected`, `activeTab: "definition"`).
4. Call `fill_form` on `form` with only the changed field paths (never a top-level `function` field and never
   `explanationRef`). The page marks the changed fields and keeps them unsaved in the header draft bar.
5. Leave saving to the reader, or invoke `page_action` `form.save` when the reader explicitly asks to save (default
   sessions ask for confirmation in chat first; full-auto saves directly).

When an edit changes `/function/code`, say so: on save the owner reuses or generates the explanation for the new code
from this verified run, and the derived definition and code explanation follow it. A published action's code cannot
change (the owner refuses at `/function/code`); stop using it or create another action instead.

## Creating an action via agent

1. Write and test the action in the owner's sandbox (above) until it passes with no `result.error`.
2. Open create mode on this page via `present` with `{ state: { selected: null, creating: true, activeTab: "definition" } }`.
3. Read `form.createForm` once for defaults, then call `fill_form` on `form` with the verified field paths.
4. Let the reader review and save in the header, or invoke `page_action` `form.save` when requested. On save, the page
   switches to edit mode on the newly created action.

## Deleting

- Delete the selected action with `page_action` `remove.delete` (targeting `selected`). The platform asks the reader to
  confirm and names the action; nothing is deleted before that. After deletion succeeds, the page returns to
  `/ontology/assets/actions`.
- A system action has no delete. The owner refuses to delete an action a scheduled task references and says why; tell
  the reader in its words and do not work around it.
- Deleting removes the action with its definition and code explanation. The write function it references is a separate
  asset and is not deleted with it.

## Returning to the catalog

- Click **Back to actions** in the header or navigate to `/ontology/assets/actions`.
