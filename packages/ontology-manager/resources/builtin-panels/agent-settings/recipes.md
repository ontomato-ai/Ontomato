# Agents catalog: how this panel works

Full-width directory of the domain's `platform:AgentDefinition` records — custom agents, product preset agents, and
system built-in agents (`app-builder`, `ops-diagnosis`, `retrieval`). Shared by Ontology Manager (`/ontology/agents`)
and Agent Platform (`/agents/settings`), each wiring its own sibling `detailPath` via application entry `inputs`.

## State

- `search` (`string`, `deepLink: true`): local search query filtering agents by name, category, status, or description.
- `creating` (`boolean`, `deepLink: false`): opens the centered creation dialog (`createForm`) in place.
- `detailPath` (`string`, `external: true`, `deepLink: false`): wired by the hosting application entry
  (`/ontology/agents/detail` or `/agents/settings/detail`).

## Navigation and creation

- Opening the catalog selects nothing automatically. Clicking any row opens `<detailPath>?selected=<id>`.
- Creating an agent opens the centered dialog backed by `platform:AgentDefinition.createForm` (showing `/name` and
  optional `/description`, matching the owner's validation). Closing the dialog with unsaved edits asks before
  discarding. After saving through `createForm.save`, the dialog closes and navigates to `<detailPath>?selected=<id>`
  to configure the remaining sections.
