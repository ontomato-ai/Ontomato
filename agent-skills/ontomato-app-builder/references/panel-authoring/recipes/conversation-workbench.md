# Compose a conversation workbench page

Use official SDK blocks for a page whose center is a live conversation. Do not import or copy the platform shell. Official components are not divided into “platform only” and “application usable”: if a platform page uses a page-building block and the catalogue does not offer it, report the missing generic block instead of changing product code or reimplementing it in the panel.

## Composition

A conversation workbench is normally four cooperating members plus application-specific slot content:

1. **Agent/task navigation** — `AgentPicker` for choosing the current agent and `ObjectList` members bound to
   `platform:AgentDefinition.list` and `platform:AgentSession.tasks`. Write their selections to ordinary panel state.
   For a task list, pass explicit read parameters such as `agentIds`, `agentKinds`, `origins` (`user`, `scheduled`,
   `system`), and `workspaceId`; do not infer application scope from a special server-side switch.
2. **Conversation center** — an `AgentChat` member. Declare the target with `agent`, bind `sessionId` and usually
   `agentId` and `artifact` to panel state, and set `"pageComposer": "none"` on the application entry. The chat owns
   platform session history; the panel must not duplicate it.
3. **Artifact preview beside the conversation** — an `AgentArtifactPreview` member whose `artifact` input is bound to
   the same panel state as the chat's `artifact` output. Artifact cards in the conversation emit a serializable
   `{ sessionId, runId, path, title? }` target; the preview resolves content through the signed-in reader's chat host.
4. **Create/edit supporting objects** — ordinary object members such as an `ObjectForm` create form for
   `platform:ScheduledTask`. Pass conversation-derived values through `initialValues` and return to the workbench when
   the panel reports `createdTask` or `createCancelled`.

```json
// panel.json manifest excerpt
{
  "state": {
    "session": { "type": { "kind": "scalar", "type": "string" }, "default": null, "deepLink": true },
    "agent": { "type": { "kind": "scalar", "type": "string" }, "default": null },
    "artifact": { "type": { "kind": "json" }, "default": null },
    "scheduleValues": { "type": { "kind": "json" }, "default": null }
  },
  "members": {
    "chat": {
      "component": "AgentChat",
      "agent": { "kind": "id", "id": "<agent-uuid>" },
      "state": { "sessionId": "session", "agentId": "agent", "artifact": "artifact" },
      "config": { "showHeader": true, "placeholderKey": "chat.placeholder" }
    },
    "preview": {
      "component": "AgentArtifactPreview",
      "state": { "artifact": "artifact" },
      "config": { "showHeader": true, "inline": true }
    }
  }
}
```

```html
<!-- panel.html excerpt -->
<projection slot="chat" @run-complete="onRunComplete">
  <template #welcome="scope"><!-- application-specific welcome --></template>
  <template #conversation-empty><!-- empty-session content --></template>
  <template #composer-context><!-- current page/task context --></template>
  <template #input="scope"><!-- optional specialized user-message rendering --></template>
  <template #message-actions="scope"><!-- actions for one completed response --></template>
  <template #artifact-link="scope"><!-- specialized artifact card --></template>
</projection>
<projection slot="preview" />
```

## Generic extension points

Read `sdk read docs/components/AgentChat.md` and `AgentArtifactPreview.md` before authoring. In particular:

- `#welcome` and `#conversation-empty` customize the first visible state without replacing the conversation.
- `#message-actions` renders in the response footer and receives the standard message context, including `outcome` when
  the run produced one.
- `#artifact-link`, `#artifact`, and `#artifact-actions` customize artifact cards and preview chrome. They receive the
  generic fallback component and props; render the fallback whenever the artifact is not the application's special case.
- `customInput`, `artifactRenderers`, `inlineArtifactAlreadyShown`, and `continueConversation` are runtime component
  inputs, so pass them through `:values` at the placement (functions may live in `panel.mjs`), not in persisted JSON
  `config`.
- `@run-complete` includes the completed `sessionId` and `runId`; when artifact registration was readable it also
  carries `artifacts`. The panel decides whether to open or select an artifact. The chat does not open one by rule.
- `header-actions` slot scope and the component's exposed reads expose the current session title, whether an initial
  instruction exists, and the initial-instruction reader. Use those generic facts instead of parsing conversation items.

## Example: report-to-PPT card

The application owns the fixed prompt convention and the PPT card. The platform owns only the generic rendering hooks:

1. Put the prompt predicate in `panel.mjs` and pass it as `customInput` through `:values`.
2. In `#input`, render the application-specific card only for that prompt; otherwise render the fallback user-message
   bubble supplied by the slot.
3. In `#artifact-link`, recognize the PPT artifact by its path/metadata and render the application card; otherwise
   render `scope.fallback.component` with `scope.fallback.props`.
4. When a run completes, inspect `event.artifacts` and write the chosen artifact target to the shared `artifact` state
   only if the application wants automatic preview. That decision belongs to the panel.

## Scheduled task creation from a session

Do not write a DataAgent-specific route or server exception. Put the current session-derived draft in panel state, open
the schedules create mode with `initialValues`, and clear the draft on `createCancelled`; after `createdTask`, return to
the conversation or select the created task according to the application's own navigation rule. Use
`instance.state.setState` / `navigate` exactly as with any other panel-owned flow.
