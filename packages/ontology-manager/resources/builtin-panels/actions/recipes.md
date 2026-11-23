# Actions: how the work on this page is done

This page manages the domain's actions (`platform:Action`): reading them one by one, editing a definition, changing
status, deleting what is no longer wanted, and reading the definition and code explanation the owner derives from the
code. The page skill lists the projections, their reads and operations (read the current data, fill live forms, call
an operation via `page_action`); this adds what the page does not show.

## What the page shows

- The catalog is the whole `list` read of the domain's actions, one row each: the name in `label`, the description in
  `subtitle`, and in `fields` the `function` name, `origin`, `status`, `createdBy`, `reviewedBy` and `updatedAt`.
- The keyword above the catalog only filters the page by name and description and is not sent to the owner. Do not
  build a query for it; read `list` and filter it yourself.
- Opening a row writes it into the panel state `selected` (a `platform:Action` reference). The checked rows are in
  `checked`, the targets of the batch status change.
- The details have three parts: the **definition** (the `form` read, saved by `platform:Action.save`), the **derived
  definition** (the `derivedSummary`, `derivedEffects`, `derivedParameters` and `derivedConditions` reads, or the raw
  `definition` read) and the **code explanation** (the `annotatedExplanation` read, or the raw `explanation` read). The
  owner makes a system action read-only and a published action's code read-only; do not work around either.

## Seeing what is on the page

- The selected action is in this message's page context: the `selection` with `className` `platform:Action` and the
  action id as `primaryKey`, or empty when nothing is selected. "This action" means it.
- The form's content is what the owner's form read returns (and `observe_display` shows the live mounted form values,
  including unsaved user edits). Read the action's `form` for its `fields` and `values`.
- Before editing or continuing the reader's edit, check `observe_display` and read the form once; when it differs from
  what you were about to change, say how.
- To explain what an action does, read its `annotatedExplanation` (or `explanation`): `segments` (`codeSegments`) are
  the explained parts of the code, each with its line range, `kindLabel` and `title`; `summary` (`businessMeaning`)
  lists what it does and what can go wrong. `derivedSummary`, `derivedEffects`, `derivedParameters` and
  `derivedConditions` (or `definition`) are what the owner derives from the same code: effects, parameters and
  submission conditions.

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
5. `POST $ONTOMATO_AUTHORING_URL/action/explain-draft` with the same `code` and `parameterDefs`, and keep its
   `explanationRef` for the form.

Run these in the same run that fills the form, and fill exactly the code and parameters that passed. Only a test of
that exact code and those parameters with no `result.error` counts: a probe or another version passing does not, and
the owner refuses the save. When a step is refused, do not fill the form; say which step stopped and
quote the owner. A sample class "outside the authoring scope" is outside the classes this run was admitted for: name
that class and stop. Do not retry with other classes and do not fill the form. To author on it, the reader switches to an agent
that can load this page's skill, whose class scope includes that class and whose executor may act on it.

## Editing an action: fill the live form, the reader saves (or confirms)

1. Read the action's `form` first. Use only the owner's field paths and current values; do not invent field names.
2. When the change touches the code or the parameters, run the changed definition in the owner's sandbox (above)
   before filling the form. A change to the name, description, status or target alone needs no run: the owner compares the
   code and parameters with the saved ones.
3. Ensure the target action is open on the `"definition"` tab via `present` (`selected`, `activeTab: "definition"`).
4. Call `fill_form` on `form` with only the changed fields, plus `explanationRef` when you ran the code. The page marks
   the changed fields and keeps them unsaved.
5. Leave saving to the reader, or invoke `page_action` on `form.save` when the reader explicitly asks to save (default
   sessions ask for confirmation in chat first; full-auto saves directly).

When an edit changes `function/code`, say so: on save the owner explains the new code, and the derived definition and
code explanation follow it. A
published action's code cannot change (the owner refuses at `/function/code`); stop using it or create another action
instead.

## Creating an action: the only way

The page has no blank manual creation. The new-action button on this page only opens this page's input with an
opening line; the reader sends the message. The action starts with you:

1. Write the action: its target object type and key parameter (a `TYPE_STRING` parameter carrying the object's primary
   key), and `function` with `operation: "OPERATION_WRITE"`, a `name`, typed `parameters`, `returnDef`, `logic` and
   the Python `code` by the owner's protocol.
2. Run it in the owner's sandbox (above) until the owner accepts the run.
3. Read `createForm` once for the new action form's fields and defaults (the status defaults to `PENDING_REVIEW`).
4. Open the create form via `present` with `{ state: { selected: null, creating: true, activeTab: "definition" } }`.
5. Call `fill_form` on `form` with the definition that passed as it is: `name`, `description`, `target` (`className` and
   `keyParameter`, omitted when there is no target), `function` (`name`, `operation`, `parameters`, `returnDef`,
   `logic`, `code`) and `explanationRef`. Do not rewrite a parameter or a line of code after the run. Let the reader
   review and save, or invoke `page_action` on `form.save` when requested.
6. Never write `codeSegments` or the business meaning yourself; they come from the owner's explanation.

## Changing status (batch)

- After the reader checks actions, this page's `setStatus` (the owner's `actions.setStatus`, which takes a batch)
  changes them to `PENDING_REVIEW`, `PUBLISHED` or `UNUSED`.
- Put every checked target and one `status` in one intent. The owner answers each action on its own; report the
  successes, refusals and failures apart instead of a single "done".
- Publishing (`PUBLISHED`) records the person who did it as the reviewer. The owner refuses a system action; pass its
  words on to the reader.

## Deleting

- Delete one action at a time with `actions.delete`. The platform first asks the reader to confirm and names the
  action; nothing is deleted before that.
- A system action has no delete. The owner refuses to delete an action a scheduled task references and says why; tell
  the reader in its words and do not work around it (for example by stopping the action first).
- Deleting removes the action with its definition and code explanation. The write function it references is a separate
  asset and is not deleted with it.
