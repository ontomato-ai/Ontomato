---
name: ontomato-panel-authoring
description: Build and register an Ontomato panel from its owner's reads and operations.
---

# Author an Ontomato panel

Use the original page to list what people can see and do. For each read, form and action, find the owner type and its
declared read or operation. Keep business rules, confirmation and permissions with that owner.

1. Read the current component catalogue with `node "$SKILL/ontomato.mjs" sdk read components.json`. Use the
   owner and component declarations for the names of data, inputs and outputs.
2. Give each projection its component, named reads and configuration. Declare inputs that the placement supplies.
   Bind typed panel state for values shared by members, such as a selected object.
3. Write the panel sources following the assigned example. The declared member keys connect the layout to the
   projections. Add common page tasks in `recipes.md` when an agent needs them.
4. Check the workspace, register the projection and panel records, and open the application entry.

In `recipes.md`, tell the assistant how to identify and read the selected record. The selection gives the object's
identity and may include its display name. Before describing a current field such as status, use the owner's
declared `record` read with that identity. If the read is denied or fails, say the field could not be confirmed.

Use `ConversationEntry` when a page needs a button that opens the composer with a specific agent and an optional
opening line. The reader still sends the message. Use the page's existing composer for general questions.

```sh
node "$SKILL/ontomato.mjs" panel check "$WORKSPACE" --material "$WORKSPACE/registration.json"
node "$SKILL/ontomato.mjs" panel register "@$WORKSPACE/registration.json"
```

Use a fresh application ID and a path under `/applications/<application-id>/`. In `registration.json` each
`projections`, `panels` or `applications` item has `id`, `mode` and `input`. Create omits `revision`. Application
creation supplies `entry`, `declaration`, `entryAccess` and `panelUses`. Each use supplies its actual `pageKey`,
`panelId`, `path` and `access`. The registered use lets the platform derive the page skill.

For a temporary domain application, the application item can have this shape. Choose your own IDs and use the
actual panel ID.

```json
{
  "id": "my-management-page",
  "mode": "create",
  "input": {
    "entry": {"path": "/applications/my-management-page", "renderer": "panels"},
    "declaration": {"names": {"en": "Management page"}, "descriptions": {"en": "Management example"}, "icon": "settings", "groups": [], "permissions": []},
    "entryAccess": ["domain-member"],
    "panelUses": [{"id": "my-use", "pageKey": "management", "panelId": "my-panel", "path": "/applications/my-management-page/manage", "access": {"kind": "domain-member"}}]
  }
}
```

For the two writing routes, see [direct layout](DECLARATIVE.md) and [HTML, CSS and Vue](CODE.md).
