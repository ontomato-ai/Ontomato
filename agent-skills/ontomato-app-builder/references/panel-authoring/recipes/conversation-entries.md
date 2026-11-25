# Open the page composer and inline conversation entries

Platform conversation shell chrome (`AgentShell`, sidebar history column, dockable page shell) belongs to the platform
host — never import `@ontomato/sdk/chat` in `panel.mjs` (direct panels allow only `vue` and `@ontomato/sdk/panel`).
Inside a registered panel, choose between two official projection members:

- **Embedded multi-turn chat (`AgentChat`):** Place an `AgentChat` projection (`agent: "page-default"`,
  `{ "kind": "id", "id": "<agentId>" }`, or `{ "kind": "preset", "agentKind": "<kind>" }`, optional `state.sessionId`)
  to hold a live conversation directly inside the panel; sessions stay on the agent platform, permissions follow the
  signed-in reader's agent grants, and any `panelUse` hosting `AgentChat` **must** set `"pageComposer": "none"`
  (enforced by `panel check`). See `sdk read docs/components/AgentChat.md`.
- **Button entry (`ConversationEntry`, `presentation="button"`, default):** Add a `ConversationEntry` projection when the page needs a button
  that opens the composer with a specific agent (`agent: "page-default"`, `{ "kind": "id", "id": "<agentId>" }`, or
  `{ "kind": "preset", "agentKind": "<kind>" }`) and an optional opening line (`prefill` or multi-locale `prefillKey`
  in `content.messages`). The reader still sends the message.
- **Inline composer (`ConversationEntry`, `presentation="inline"`):** When a page itself serves as a conversation entry (such as a workspace
  home), place a `ConversationEntry` member pointing to the target agent with `presentation="inline"` (supporting
  `placeholderKey`, `minLines`, `agentPickerVariant`, `attachPage`, and `@sent`) and set `"pageComposer": "none"` on
  that entry in `panelUses` so the host hides the bottom floating composer. While mounted, the inline
  `ConversationEntry` also serves sibling `ConversationEntry` buttons on the same page; submitting enters the platform
  conversation shell with that agent.

```json
// panel.json (manifest.members)
{
  "askAssistant": {
    "component": "ConversationEntry",
    "agent": { "kind": "id", "id": "<agent-uuid>" },
    "prefillKey": "chat.opening"
  }
}
```

```html
<!-- panel.html -->
<projection slot="askAssistant" presentation="inline" placeholder-key="chat.placeholder" :min-lines="3"></projection>
```

```json
// application.json (panelUses[] entry)
{
  "id": "home",
  "pageKey": "home",
  "panelId": "<panel-id>",
  "path": "/applications/app-my-app/home",
  "pageComposer": "none",
  "access": { "kind": "domain-member" },
  "names": { "en": "Home", "zh-CN": "首页" }
}
```
