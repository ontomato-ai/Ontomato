# Four-layer capability map: how this panel works

What a reader or an assistant cannot work out from the declaration and projections alone.

## What it covers

The platform's four-layer ontology — fact (`ObjectType`, `Attribute`, `Relationship`), capability (`MetricView`,
`Function`, `Action`, `Workflow`, `Trigger`, `Skill`, `BusinessKnowledge`, `Definition`), governance (`User`, `Role`),
and product (`SDKComponent`, `ProductProjection`, `ProductPanel`, `Application`, `AgentDefinition`) — and the declared
relations between them. All reads are strictly read-only, executed with the current reader's credentials through the
platform ontology composite query; no writes exist on this panel.

## Two modes: type and instance

- **Type mode** (`mode = "type"`): shows every declared object type and relation kind grouped in four layer columns.
  Each type node shows how many objects the current reader can see, or marks the type as `No permission`, `Read failed`,
  or `Pending` without collapsing it into zero. Stored relations are drawn as solid lines and derived relations as dashed
  lines.
- **Instance mode** (`mode = "instance"`, default): starts from the current signed-in user (or an explicit `start`
  object) and draws its one-hop neighbors. Clicking an unexpanded node selects it and fetches one more hop, merging new
  nodes and edges without moving already-placed nodes. Clicking a node in the right-hand **Node relations** list moves
  selection to that peer with its complete `{ className, primaryKey }` identity.

## Finding an object that is not drawn yet

The toolbar search box (`query`) only highlights nodes already drawn on the canvas; it never hides nodes and never runs
a full-domain search across owners. To inspect an object that is not currently drawn:

1. Switch to **Type mode** (`showTypeMode`).
2. Click the object's type on the four-layer graph (this writes `selectedType`).
3. Search and pick the object in the right-hand **Pick a starting object** list. Choosing it sets `start` to that
   object's complete identity and automatically opens **Instance mode** centered on it.

## Changing the starting node in instance mode

Three ways to change the starting node:

1. **Switch user**: open **Switch user** in the toolbar and pick any readable user from **Choose a starting user**.
2. **Promote the selected node**: select any drawn node on the graph or in **Node relations**, then click **Set
   selected as start** to recenter the graph around it.
3. **Pick from any type**: switch to **Type mode**, click a type, and pick an object from that type's list.

Click **Current user** (`resetToCurrentUser`) to clear `start` and return to the signed-in user.

## Interpreting empty, refused and failed relation states

- **No neighbors** (for example the default `admin` user in the open-source edition where subjects/roles are not enabled)
  means every queried relation kind succeeded with zero edges; the starting node remains drawn and the banner explicitly
  reports no neighbors.
- **No permission** means the relation's owner refused the current reader's request (HTTP 403); other permitted
  relations on the same node still render normally.
- **Read failed** means an owner service errored during the read.
- **Pending** means the relation's owner endpoint is not connected yet (such as product-layer records awaiting M2).

## Layer filter and viewport

The layer filter pills, expanded instance set, manually dragged node positions and canvas viewport live inside
`OntologyGraph` as internal view state rather than panel state, so toggling a layer or panning never mutates deep links
or page context selection.
