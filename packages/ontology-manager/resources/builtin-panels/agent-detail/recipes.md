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
- `grantDialog`, `grantPrincipalKind`, `grantUser`, `grantRole`, `grantPrincipalId`, `grantVerb` (`deepLink: false`):
  state for the Add Grant dialog (`grantVerb` is one of `"use"`, `"view"`, or `"edit"`).

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

- Set `tab: "grants"` on an editable agent to inspect current grants (`grantsList`, showing each principal or role's
  highest access level) and the domain-wide sharing status (`shareStatusDesc`).
- Toggle domain-wide use (`domain:*:use`) via `shareEnable.share` or `shareDisable.share`.
- Grant or update a member/role's single-select 3-level access (`use`, `view`, or `edit`) by opening the grant dialog
  (`grantDialog: true`), selecting `grantPrincipalKind` (`"principal"` or `"role"`), choosing `grantUser` or
  `grantRole`, setting `grantVerb`, and invoking `grantSubmit.grant`.
- Revoke an individual member or role grant via the row action `grantsList.revoke`.
