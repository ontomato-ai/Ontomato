---
name: ontomato-panel-authoring
description: Build and register an Ontomato panel from its owner's reads and operations.
---

# Author an Ontomato panel

Use the original page to list what people can see and do. For each read, form and action, find the owner type and its
declared read or operation. Keep business rules, confirmation and permissions with that owner.

1. Run `node "$SKILL/ontomato.mjs" panel type <type-id>` for read names, parameters, required parameters, result
   schemas and operation declarations. Use `node "$SKILL/ontomato.mjs" sdk read components.json` for official components.
2. Use the [member field reference](FIELDS.md) to write each new projection in `panel.json`. Specify the
   component, named reads, configuration,
   applicable operation and state connections. The tool derives ports from the owner and component declarations.
   Use `target.projectionId` to reuse an existing projection. Choose an official display component or use
   `PanelData` with `usePanelData` for a custom Vue view. Declare public state once.
3. Write the template and interactions in Vue. The platform runs the panel directly from `panel.html` and
   the required `panel.mjs`. The declared member keys connect the layout to the projections.
   Add common page tasks in `recipes.md` when the assistant needs them.
4. Check and register the workspace, then open the registered application entry. Use the page's input box
   for the [assistant check](#check-the-assistant-from-the-page).

Page selection supplies an object reference and may include its display name. If a page task needs current fields
such as status, expose the owner's `record` read that takes this reference. Use `recipes.md` for the owner's
page-specific rules.

Use `ConversationEntry` when a page needs a button that opens the composer with a specific agent and an optional
opening line. The reader still sends the message. Use the page's existing composer for general questions.

```sh
node "$SKILL/ontomato.mjs" panel check "$WORKSPACE"
node "$SKILL/ontomato.mjs" panel register "$WORKSPACE"
```

Use a fresh application ID starting with `app-` and a path under `/applications/<application-id>/`. In `registration.json`, provide
one panel item with `id`, `mode` and `input` containing its name, description and visibility. Create omits
`revision`. Application creation supplies `entry`, `declaration`, `entryAccess` and `panelUses`. Each use
supplies its domain-unique `pageKey`, `panelId`, `path` and `access`. See [entry settings and page
skills](CODE.md#register-and-open) for the icon, default agent and recipes.

For a temporary domain application, the application item can have this shape. Choose your own IDs and use the
actual panel ID.

```json
{
  "id": "app-my-management-page",
  "mode": "create",
  "input": {
    "entry": {"path": "/applications/app-my-management-page", "renderer": "panels"},
    "declaration": {"names": {"en": "Management page"}, "descriptions": {"en": "Management example"}, "icon": "settings", "groups": [], "permissions": []},
    "entryAccess": ["domain-member"],
    "panelUses": [{"id": "my-use", "pageKey": "app-my-management-page-manage", "panelId": "my-panel", "path": "/applications/app-my-management-page/manage", "access": {"kind": "domain-member"}}]
  }
}
```

## Check the assistant from the page

Open the registered application entry in the browser and select a known record. Send these requests from the
page's input box. Choose any specific assistant through that input box's picker.

1. Ask it to read the selected record and report a current field. Compare its answer with the page.
2. Ask it to draft a small form edit. Open the draft link and check that the changed field is populated and
   highlighted. Confirm that the stored record changes when the reader saves it.
3. Ask it to run a declared operation on a suitable test record. Review and confirm the action in the conversation,
   then check the result on the page.

Use this conversation and its visible results to verify the page skill and candidate availability.

Use the [Vue authoring guide](CODE.md) for panel sources, owner operations, forms and draft links.
