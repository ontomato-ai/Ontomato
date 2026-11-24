# Workflows (`/ontology/assets/workflows`)

This panel manages domain workflows (`platform:Workflow`): searching the catalog, inspecting read-only definitions, auditing effective capability grants, creating new workflow drafts, and activating, deactivating, or deleting workflows.

## Rules from the owner (`platform:Workflow`)

1. **Existing workflows are read-only in the UI.** Open an existing workflow via `viewing` to inspect its definition, case object mapping (`runContract`), and steps (`steps`). Do not attempt to edit an existing workflow through `viewForm`.
2. **Creating a workflow saves a draft.** A draft grants no permissions until it is activated.
   - `name` is required.
   - Steps without either `roleCode` or `actionId` are dropped on save.
   - For steps with `actorPolicy.mode === "rule"`, `parameters`, `parameterBindings`, and `valueMap` must be valid JSON objects.
3. **Lifecycle operations:**
   - `catalog.activate` (`workflows.activate`): available when `canActivate` is true (inactive/draft workflows, or active workflows with an unpublished draft). Activation freezes a numbered revision and grants the step roles permission to run their actions.
   - `catalog.deactivate` (`workflows.deactivate`): available when `canDeactivate` is true (`statusCode === "ACTIVE"`). Deactivation revokes the grants written by the active revision.
   - `catalog.delete` (`workflows.delete`): disabled while `statusCode === "ACTIVE"`; deactivate the workflow first before deleting it.
4. **Effective capability grants (`inspectingGrants`)** show four read-only audit lists:
   - `grantCaseScopedSteps`: steps authorized per run for the current assignee (no role-level grant written on activation).
   - `grantInForce`: role capability grants currently in force for the active revision.
   - `grantSuperseded`: historical grant rows left by earlier revisions (no longer granted).
   - `grantDirect`: direct domain grants not owned by any workflow (unaffected by workflow deactivation).

## Common assistant tasks

### Search workflows

Use `present` with `{ search: "<keyword>" }` to filter the catalog by workflow name, description, step summary, status, or provenance. Clear the search with `{ search: "" }`.

### Inspect an existing workflow definition (read-only)

Use `present` with `{ viewing: { className: "platform:Workflow", primaryKey: "<workflowId>" } }` to open the read-only definition dialog. Close it with `{ viewing: null }`.

### Inspect effective capability grants

Use `present` with `{ inspectingGrants: { className: "platform:Workflow", primaryKey: "<workflowId>" } }` to open the effective grants modal and inspect `grantCaseScopedSteps`, `grantInForce`, `grantSuperseded`, and `grantDirect`. Close it with `{ inspectingGrants: null }`.

### Create a new workflow draft

1. Open the create modal using `present` with `{ creating: true }`.
2. Fill the live `createForm` fields (`/name`, `/description`, `/runContract`, `/steps`) using `fill_form` without saving yet.
3. When the user confirms saving, invoke `page_action` on `createForm`'s save operation (`platform:Workflow.save`). On success, the modal closes and the catalog refreshes automatically.

### Activate, deactivate, or delete a workflow

Invoke the row operation on `catalog` via `page_action`:
- `catalog.activate` (with the target workflow row)
- `catalog.deactivate` (with the target workflow row)
- `catalog.delete` (with the target workflow row; deactivate first if currently active)

Every write asks for confirmation by default and refreshes the catalog automatically after completion.
