# Agent settings: how this panel works

What a reader of the platform cannot work out from the panel itself. Its declaration and its projections say the rest,
and the platform describes those from their current definitions.

## What it covers

The domain's agents: choose one and change its definition, or create a new one. The definition is one form, the
definitions service's own: its name, description, whether it is on, its instructions, its model, its skills, who it runs
as and its data scope. Avatars, MCP services and deleting an agent are not part of this panel yet; an agent's avatar
and MCP services are kept as they are when it is saved.

## How an agent is chosen

The list is the domain's `platform:AgentDefinition` objects in the service's order. Choosing one writes it into
`selectedAgent` and the panel edits it (`mode` is `edit`); choosing it again lets go and the panel returns to the list.
The `newAgent` operation clears the selection and sets `mode` to `create`: the form then holds the service's defaults for
a new agent, and saving creates it and selects it.

## One form, several groups

The model, the skills, who the agent runs as and the data scope are fields of the same form, drawn in their own groups:
choosing one changes the form, marks it unsaved and is saved, discarded or drafted with it. The service decides which
fields may change; who an agent runs as is read-only unless the identity service lets this reader change it, and the
field says why.

The data scope is chosen on the graph of ontology classes and their relationships: choosing a class adds or removes it,
the classes one relationship away are marked, and one action adds them all. Nothing chosen keeps the default scope.

## How a change gets here from an agent

A run may write a draft for this page (`agent.update` for an existing agent, `agent.create` for a new one) and hand the
reader a link. Opening it fills the form after the service has checked the whole draft, marks the fields it changed and
leaves them unsaved; the reader saves. A draft the service refuses is refused whole, with the fields and the reasons.
