# Agent detail: how this panel works

Full-width edit-on-open detail panel for a single `platform:AgentDefinition`. Shared by Ontology Manager
(`/ontology/agents/detail`) and Agent Platform (`/agents/settings/detail`), each wiring its sibling `catalogPath`
via application entry `inputs`.

## State

- `selected` (`platform:AgentDefinition`, `deepLink: true`): the agent being read, edited, granted, or deleted.
- `tab` (`"config" | "grants"`, `deepLink: true`, default `"config"`): switches between agent configuration and
  permissions & sharing (only available when `header.canGrant` is true; otherwise falls back to `"config"`).
- `catalogPath` (`string`, `external: true`, `deepLink: false`): wired by the hosting application entry
  (`/ontology/agents` or `/agents/settings`) for the Back button and post-delete navigation.
- `grantDialog`, `grantPolicy`, `grantPolicyId`, `grantVerb` (`deepLink: false`): state for the add-to-policy dialog
  (`grantVerb` is one of `"use"`, `"view"`, or `"edit"`; `grantPolicyId` mirrors the chosen object policy).

## Editing, read-only access, and category protection

- Custom and product preset agents expose all six owner-declared sections (basics, model, prompt, capabilities,
  execution identity, and data scope). Fill fields in `form` via `fill_form` and save via `form.save` (mounted in
  the single-row page header via `usePanelFormDraft`).
- System built-in agents (`app-builder`, `ops-diagnosis`, `retrieval`) expose read-only identity fields and an
  editable model selection as described by the owner.
- Readers who only hold `view` access (`canEdit: false`, `canGrant: false`) see a read-only banner and owner-declared
  read-only fields; Save/Discard, Delete, and the Permissions & sharing tab are hidden.
- Deleting (`remove.delete`) is admitted only for editable custom agents; product preset, system built-in, and
  view-only agents are marked unavailable by the owner and their Delete button is hidden.

## Managing permissions & sharing

Adding to a policy is the agent-side shortcut for putting this object into one object policy; which members can use it
and at which level is decided in that policy.

- Set `tab: "grants"` on an editable agent to inspect the policies it is already in (`grantsList`: policy, permission
  level, actions) and the domain-wide sharing status (`shareStatusDesc`).
- Toggle domain-wide use (`domain:*:use`) via `shareEnable.share` or `shareDisable.share`.
- Add the agent to a policy by opening the dialog (`grantDialog: true`), choosing the policy in `policyPicker`, choosing
  one level (`use`, `view`, or `edit`) in the inline segmented control, and invoking `grantSubmit.grant`.
- Remove it from a policy via the row action `grantsList.revoke`.
