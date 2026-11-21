# Agent settings: how this panel works

The domain's agents: pick one on the left and change its definition, or create one with "New agent". The definition is the definitions service's one form: name, description, whether
it is on, its avatar, instructions, model, skills, execution identity, data scope and external MCP tools.

## State in the address

`selected` is the shown `platform:AgentDefinition`; `mode` is `list`, `edit` or `create`. Both travel in the
address. Opening with no state selects the first agent, as the original page's bare address did.

## Drafting a change

For the agent definition form, follow the page skill's draft format. Use `agent.update` for an existing agent and
`agent.create` for a new one. Read the owner's form for the intended target first — `save.draftOperation`
says the same operation. Publish the draft as a run artifact and hand the reader the draft link on this page's
address. The reader opens it and saves.

## Deleting

`agents.delete` removes the selected agent; the platform asks the reader to confirm the impact first. After a
delete the panel falls back to the first agent in the list.
