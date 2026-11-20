---
name: ontomato-panel-authoring
description: Build and register an Ontomato panel from its owner's reads and operations.
---

# Author an Ontomato panel

Use the original page to list what people can see and do. For each read, form and action, find the owner type and its
declared read or operation. Keep business rules, confirmation and permissions with that owner.

1. Read the current component catalogue with `node "$SKILL/ontomato.mjs" sdk read components.json`. Use the
   owner and component declarations for the names of data, inputs and outputs.
2. Write new projection definitions in `panel.json` and reference existing projections by ID. Use an official
   display component when it fits. For a custom Vue view, use a `Data` projection with `usePanelData`.
   Declare the public state that the assistant, address or other panels need.
3. Write the template and interactions in Vue. The declared member keys connect the layout to the projections.
   Add common page tasks in `recipes.md` when the assistant needs them.
4. Check the workspace, register the projection and panel records, and open the application entry.

Page selection supplies an object reference and may include its display name. If a page task needs current fields
such as status, expose the owner's `record` read that takes this reference. Use `recipes.md` for the owner's
page-specific rules.

Use `ConversationEntry` when a page needs a button that opens the composer with a specific agent and an optional
opening line. The reader still sends the message. Use the page's existing composer for general questions.

```sh
node "$SKILL/ontomato.mjs" panel check "$WORKSPACE"
node "$SKILL/ontomato.mjs" panel register "$WORKSPACE"
```

Use a fresh application ID and a path under `/applications/<application-id>/`. In `registration.json`, provide
one panel item with `id`, `mode` and `input` containing its name, description and visibility. Create omits
`revision`. Application creation supplies `entry`, `declaration`, `entryAccess` and `panelUses`. Each use
supplies its domain-unique `pageKey`, `panelId`, `path` and `access`. The platform derives the page skill.

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

Use the [Vue authoring guide](CODE.md) for the panel sources, owner operations, forms and draft links.
