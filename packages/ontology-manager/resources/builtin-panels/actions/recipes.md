# Actions: how the work on this page is done

This page manages the domain's actions (`platform:Action`): reading them one by one, editing a definition, changing
status, deleting what is no longer wanted, and reading the definition and code explanation the owner derives from the
code. The page skill lists the projections, their reads and operations (read the current data, draft a change, call
an operation); this adds what the page does not show.

## What the page shows

- The catalog is the whole `list` read of the domain's actions, one row each: the name in `label`, the description in
  `subtitle`, and in `fields` the `function` name, `origin`, `status`, `createdBy`, `reviewedBy` and `updatedAt`.
- The keyword above the catalog only filters the page by name and description and is not sent to the owner. Do not
  build a query for it; read `list` and filter it yourself.
- Opening a row writes it into the panel state `selected` (a `platform:Action` reference). The checked rows are in
  `checked`, the targets of the batch status change.
- The details have three parts: the **definition** (the `form` read, saved by `platform:Action.save`), the **derived
  definition** (the `definition` read) and the **code explanation** (the `explanation` read). The owner makes a system
  action read-only and a published action's code read-only; do not work around either.

## Seeing what is on the page

- The selected action is in this message's page context: the `selection` with `className` `platform:Action` and the
  action id as `primaryKey`, or empty when nothing is selected. "This action" means it.
- The form's content is what the owner's form read returns: read the action's `form` (the page skill gives the exact
  read) for its `fields`, `values` and `save.draftOperation`. That is the definition form on the page now.
- The reader's unsaved edits do not reach you; the page does not copy the form's values. Before confirming or
  continuing the reader's edit, read the form once; when it differs from what you were about to change, say how.
- To explain what an action does, read its `explanation`: `codeSegments` are the explained parts of the code, each
  with its `codeRange` lines, `kindLabel` and `title`; `businessMeaning.operations` are what it does and
  `businessMeaning.negativeEffect` what can go wrong. `definition` is what the owner derives from the same code:
  effects, parameters and submission conditions.

## Editing an action: draft it, the reader saves

1. Read the action's `form` first. Use only the owner's field paths and current values; do not invent field names.
2. When the change touches the code or the parameters, write the full changed definition and run it with
   `action generate --sample <sample row>` without `--save`, so the owner executes it in its own sandbox. Fix what the
   owner reports until it accepts the run. The owner adopts a draft only against a passing run of the same code and
   parameters. A change to the name, description, status or target alone needs no run: the owner compares the code
   and parameters with the saved ones.
3. Write the page draft `outputs/drafts/<name>.page-draft.json`:

```json
{
  "pageKey": "<the pageKey in the current page context>",
  "operation": "action.update",
  "target": { "id": "<the selected action id>" },
  "form": { "description": "…" }
}
```

4. Put only the changed fields in the draft's `form`. The owner checks the whole form and shows a refusal beside the
   field it concerns.
5. Hand the reader the draft link with the draft path and the current `sessionId` and `runId` (`draftSessionId`,
   `draftRunId`, `draftPath`). Opening it fills the form and marks the changed fields; the reader saves. You never save.

When a draft changes `function/code`, say so: on save the owner explains the code again, and the derived definition and
code explanation follow. A published action's code cannot change (the owner refuses at `/function/code`); stop using
it or create another action instead.

## Creating an action: the only way

The page has no blank manual creation. The new-action button above the catalog only opens this page's input with an
opening line; the reader sends the message. The action starts with you:

1. Write the action by the App Builder skill: target object type and key parameter, parameters, return, Python code
   and logic. Run it with `action generate --sample <sample row>` without `--save` so the owner executes it in its own
   sandbox. When it fails, fix what the owner reports until it accepts the run. When no build-test context lets it run,
   do not draft the creation; say which step stopped and quote the owner.
2. Read `createForm` once for the new action form's fields and defaults (the draft operation is `action.create` and the
   status defaults to `PENDING_REVIEW`).
3. Put the definition the owner accepted into the form as it is: `name`, `description`, `target` (`className` and
   `keyParameter`, omitted when there is no target) and `function` (`name`, `parameters`, `returnDef`, `logic`,
   `code`). Do not rewrite a parameter or a line of code.
4. Write it as a page draft with an empty target (`{}`) and the `action.create` operation, and hand the reader the link.
   The reader checks and saves it, and the action appears in the catalog.
5. The owner writes the code explanation when it saves; never write `codeSegments` or the business meaning yourself.

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
