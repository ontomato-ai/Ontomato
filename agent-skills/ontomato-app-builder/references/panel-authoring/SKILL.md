---
name: ontomato-panel-authoring
description: Build and register an Ontomato panel from its owner's reads and operations.
---

# Author an Ontomato panel

1. **Discover the owner's contract before writing code.** Run `node "$SKILL/ontomato.mjs" panel type <type-id>`
   for the owner's reads, operations and result shapes. Use `--read <name>` for one read's signature,
   required parameters and `resultSchema`. Use these commands as the authoring reference for owner APIs.
2. Compare the original page's visible behavior with the owner's reads, forms and actions. Keep business rules,
   confirmation and permissions with their owner. For official components, use
   `node "$SKILL/ontomato.mjs" sdk read docs/components.md` for
   behavior, configuration, outputs and events. For third-party components, [look up the installed package](../../GUIDE.md#use-an-installed-component-package).
   Use the [member field reference](FIELDS.md) and [registration mapping](../../GUIDE.md#write-projections-inside-the-panel) to declare projections. Choose an official display component or
   [PanelData](CODE.md#read-declared-data) for custom Vue, and use `target.projectionId` for an existing projection.
   For graphs, see [graph wiring and selection](CODE.md#connect-a-graph-and-its-relations).
3. Write the template and interactions in Vue. Follow the [direct runtime and import rules](CODE.md#write-a-vue-panel)
   and declare the [state that travels in an address](CODE.md#open-a-panel-at-a-specific-state).
4. Check and register the workspace, then open the registered entry. Use the page's input box
   for the [assistant check](#check-the-assistant-from-the-page). If the result looks wrong, follow
   [the browser and CLI checks](CODE.md#when-a-panel-looks-wrong).

See [what the assistant receives](CODE.md#what-the-assistant-receives) for page context and `recipes.md`.

Use `ConversationEntry` when a page needs a button that opens the composer with a specific agent and an optional
opening line. The reader still sends the message. Use the page's existing composer for general questions.
For the opening line of a built-in panel's `ConversationEntry`, use `prefillKey` with a flat key in
`content.messages` and provide the line in every declared language, as verified by `panel check`.

```sh
node "$SKILL/ontomato.mjs" panel check "$WORKSPACE"
node "$SKILL/ontomato.mjs" panel register "$WORKSPACE"
```

To ship a tested trial at the original platform address, follow [Replace a built-in page](../../GUIDE.md#replace-a-built-in-page).

For a trial application, use a fresh ID starting with `app-` and a path under `/applications/<application-id>/`. In `registration.json`, provide
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
    "declaration": {"names": {"en": "Management page"}, "descriptions": {"en": "Management example"}, "icon": "app-window", "groups": [], "permissions": []},
    "entryAccess": ["domain-member"],
    "panelUses": [{"id": "my-use", "pageKey": "app-my-management-page-manage", "panelId": "my-panel", "path": "/applications/app-my-management-page/manage", "access": {"kind": "domain-member"}}]
  }
}
```

## Check the assistant from the page

Open the registered application entry in the browser and select a known test record. Choose a candidate from
the page input box's picker and send the prompts there. Replace the bracketed text with fields and operations
the page declares.

1. **Read.** “What page and record are selected? Read the current [field] on this record.” Compare the selected
   identity and the field value with the page.
2. **Draft.** “Draft a change to [field] on this record. Give me a site-relative draft link and leave it for me to save.”
   Open the link and inspect the proposed change. Save as the reader, then verify the value.
3. **Execute.** “Run [declared operation] on this test record, with confirmation when required.” Use the
   confirmation in the conversation and verify the outcome on the page.

For a read-only page, verify the read and any declared read operations. Mark draft and write checks as not
applicable. Candidate availability and page skill behavior are verified through the input box and its results.

Use the [Vue authoring guide](CODE.md) for panel sources, owner operations, forms and draft links.
