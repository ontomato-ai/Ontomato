# Agent detail: how this panel works

Full-width edit-on-open detail panel for a single `platform:AgentDefinition`. Shared by Ontology Manager
(`/ontology/agents/detail`) and Agent Platform (`/agents/settings/detail`), each wiring its sibling `catalogPath`
via application entry `inputs`.

## State

- `selected` (`platform:AgentDefinition`, `deepLink: true`): the agent being read, edited, granted, or deleted.
- `tab` (`"basics" | "model" | "prompt" | "capabilities" | "data" | "sharing"`, `deepLink: true`, default
  `"basics"`): the current left-navigation section. Legacy `"config"` opens as `"basics"` and legacy `"grants"` as
  `"sharing"` in the panel script.
- `catalogPath` (`string`, `external: true`, `deepLink: false`): wired by the hosting application entry
  (`/ontology/agents` or `/agents/settings`) for the Back button and post-delete navigation.
- `grantDialog`, `grantPolicy`, `grantPolicyId`, `grantVerb` (`deepLink: false`): state for the add-to-policy dialog
  (`grantVerb` is one of `"use"`, `"view"`, or `"edit"`; `grantPolicyId` mirrors the chosen object policy).
- `classChecked` (`platform:ObjectType[]`, `deepLink: false`): transient checked rows of the by-name data-scope list;
  the panel script mirrors it into the owner form's `/classNames` field and back.

## Six sections and saving

The left navigation and the right screen correspond one to one, in this order: basic information, model, prompt,
capabilities, data scope, permissions & sharing. The owner form stays mounted as one `ObjectForm`; its declarative
groups map the owner's `execution` section into the sharing screen, so `/executionUserId` keeps its owner semantics
without becoming a separate screen. At containers up to 720px the navigation becomes a horizontal scrollable row;
the form is not remounted and unsaved edits stay in the same draft. After `/engine` is edited, the model picker is
remounted for the current engine so its choices are read again rather than left stale.

The page header has Back, the object title, `Chat with this agent`, and an overflow menu for delete. It has no Save
button. Save and Discard live in the sticky save bar at the top of the right screen whenever the `form` draft is dirty;
the bar is still backed by `usePanelFormDraft("form")`, so platform leave confirmation and stashed-draft behavior stay
with the SDK form registry.

## Editing, read-only access, and category protection

- Custom and product preset agents expose all owner-declared fields across the six screens. Fill fields in `form` via
  `fill_form` and save via `form.save` or the save bar.
- System built-in agents (`app-builder`, `ops-diagnosis`, `retrieval`) expose read-only identity fields and an
  editable model selection as described by the owner.
- Readers who only hold `view` access (`canEdit: false`) see owner-declared read-only fields; Save is unavailable and
  delete is hidden. Grant management controls remain owner-gated through `canGrant` and each operation's own admission.
- The owner-declared per-field Reset controls are visually consolidated into one section-level Reset button. That
  button only appears for product preset agents and writes the same owner-declared `defaultValue`s back into the
  fields of the active screen; it does not save by itself.
- Deleting (`remove.delete`) is admitted only for editable custom agents; product preset, system built-in, and
  view-only agents are marked unavailable by the owner. The visible menu item follows that operation admission.

## Managing permissions & sharing

Adding to a policy is the agent-side shortcut for putting this object into one object policy; which members can use it
and at which level is decided in that policy.

- The sharing screen shows the two-state audience control (`explicitly granted only` / `everyone in this domain`),
  backed by the original `shareEnable.share` and `shareDisable.share` operation declarations. The corresponding
  `OperationButton` projections stay mounted in a non-rendered operation-source container so the owner operation
  descriptors and agent action entries remain registered while the segmented control owns their presentation; the
  same arrangement backs the overflow delete menu through `remove.delete`.
- The policy table (`grantsList`) and the add-to-policy dialog stay in the same screen. Choose the policy in
  `policyPicker`, choose one level (`use`, `view`, or `edit`) in the inline segmented control, and invoke
  `grantSubmit.grant`.
- Remove access via the row action `grantsList.revoke`.
- `/executionUserId` renders below the sharing controls through the owner form's `#field-executionUserId` slot.

## Capabilities and data scope in this batch

Skills and external MCP tools intentionally keep the previous card-wall/reference-picker presentation inside the
capabilities screen; replacing them with the shared selected-table-plus-add-dialog picker is a separate later batch.

Data scope is one form field with two modes: the existing relationship graph (`scope`) and a by-name multi-select
`ObjectList` (`classPicker`). The list's checked object references are only panel state; the form field remains the
single owner value written to `/classNames`. Selected classes are listed beneath the control with individual removal
and clear actions.
