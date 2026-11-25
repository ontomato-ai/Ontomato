# Action detail: how the work on this page is done

This non-menu detail page at `/ontology/assets/actions/detail` inspects and edits one domain action (`platform:Action`):
its definition form, the definition the owner derives from its explained code, its annotated code explanation, and
deletion. The single-row page header carries the back link to `/ontology/assets/actions`, the action title/status
(`header.record`), sandbox trial, publish, delete, and the Save/Discard controls wired to `form`.

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
  `trialSummary.record`, `derivedSummary.record`, `derivedEffects.rows`, `derivedParameters.rows`, `derivedConditions.rows`, and
  `explanation.content`. Use only these mounted reads.
- Before editing or continuing the reader's edit, check `observe_display` and read `form.form` once; when it differs
  from what you were about to change, say how.
- To explain what an action does, read `explanation.content`: `segments` are the explained parts of the code, each with
  its `lineRange`, `kindLabel`, and `title`; `summary` lists what it does and what can go wrong. Read
  `derivedSummary.record`, `derivedEffects.rows`, `derivedParameters.rows`, and `derivedConditions.rows` for the
  effects, parameters, and submission conditions derived from the same code.

## Saving, trialing and publishing

1. Save the draft with `page_action` `form.save` (owner endpoint `POST /action/save`). Saving does not require a trial.
   Saving changed code generates a current explanation in the background. Wait for the save before trialing.
2. Trial the saved action with `page_action` `trial.trial` (`actions.trial`, targeting `selected`). Supply `sample`
   and `parameters` as JSON objects. An external caller uses `POST /action/trial` with `{ id, sample, parameters }`.
   A sample can contain `objDatas`, `relDatas`, and `vectorDatas`. Each item in `objDatas` has a technical
   `className` and a `rows` array. Include the primary keys and attributes the action uses. `parameters` maps
   each parameter name to its trial value. The owner opens the sandbox, loads the sample, runs the action,
   records its receipt, and closes the sandbox in the same call. Use the receipt's `passed` and `error` to report
   the result, and `trialSummary.record` to read the latest status before publishing.
3. Publish using `page_action` `publish.setStatus` with `input.status: "PUBLISHED"` (or catalog `setStatus.setStatus`).
   The owner requires an up-to-date code explanation and a passed latest trial for the exact saved code,
   target and parameter schema. Report the owner's reason if publication is blocked.

## Form field paths (`form.form` / `form.createForm`)

The live `form` exposes these field paths for `fill_form`:

- `/name`
- `/description`
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
2. Ensure the target action is open on the `"definition"` tab via `present` (`selected`, `activeTab: "definition"`).
3. Call `fill_form` on `form` with only the changed field paths (never a top-level `function` field and never
   `explanationRef`). The page marks the changed fields and keeps them unsaved in the header draft bar.
4. Leave saving to the reader, or invoke `page_action` `form.save` when the reader explicitly asks to save (default
   sessions ask for confirmation in chat first; full-auto saves directly).

Saving a new action creates a pending draft. Editing an existing action preserves its status. Follow the save, trial and publish workflow above for the saved action.
The owner refuses changes to a published action's code at `/function/code`.

## Creating an action via agent

1. Write the action.
2. Open create mode on this page via `present` with `{ state: { selected: null, creating: true, activeTab: "definition" } }`.
3. Read `form.createForm` once for defaults, then call `fill_form` on `form` with the authored fields.
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
