# Agent detail: how this panel works

Full-width edit-on-open detail panel for a single `platform:AgentDefinition`. Shared by Ontology Manager
(`/ontology/agents/detail`) and Agent Platform (`/agents/settings/detail`), each wiring its sibling `catalogPath`
via application entry `inputs`.

## State

- `selected` (`platform:AgentDefinition`, `deepLink: true`): the agent being read, edited, or deleted.
- `catalogPath` (`string`, `external: true`, `deepLink: false`): wired by the hosting application entry
  (`/ontology/agents` or `/agents/settings`) for the Back button and post-delete navigation.

## Editing and category protection

- Custom and product preset agents expose all six owner-declared sections (basics, model, prompt, capabilities,
  execution identity, and data scope). Fill fields in `form` via `fill_form` and save via `form.save` (mounted in
  the single-row page header via `usePanelFormDraft`).
- System built-in agents (`app-builder`, `ops-diagnosis`, `retrieval`) expose read-only identity fields and an
  editable model selection as described by the owner.
- Deleting (`remove.delete`) is admitted only for custom agents; product preset and system built-in agents are marked
  unavailable by the owner and their Delete button is hidden. After a successful delete the panel returns to the
  sibling catalog entry.
