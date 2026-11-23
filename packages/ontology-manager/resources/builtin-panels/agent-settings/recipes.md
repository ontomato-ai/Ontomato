# Agent settings: how this panel works

The domain's agents: pick one on the left and change its definition, or create one with "New agent". The definition is the definitions service's one form: name, description, whether
it is on, its avatar, instructions, model, skills, execution identity, data scope and external MCP tools.

## State in the address

`selected` is the shown `platform:AgentDefinition`; `mode` is `list`, `edit` or `create`. Both travel in the
address. Opening with no state selects the first agent, as the original page's bare address did.

## Editing or creating an agent

Open the target agent with `present` (`selected` + `mode: "edit"`, or `selected: null` + `mode: "create"` for a new
agent), fill the changed fields in the mounted `form` via `fill_form` (which marks modified fields and keeps the form
unsaved), and either leave saving to the reader or call `page_action` on the form's save operation when requested.

## Deleting

`agents.delete` removes the selected agent; the platform asks the reader to confirm the impact first. After a
delete the panel falls back to the first agent in the list.
