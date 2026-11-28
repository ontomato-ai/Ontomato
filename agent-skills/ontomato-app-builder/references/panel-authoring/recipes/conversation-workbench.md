# Compose a conversation workbench page

Use official SDK blocks for a page whose center is a live conversation. Do not import or copy the platform shell. Official components are not divided into “platform only” and “application usable”: if a platform page uses a page-building block and the catalogue does not offer it, report the missing generic block instead of changing product code or reimplementing it in the panel.

This recipe uses the application-tree format. In an application tree, every component member is a formal projection in `projections/<projectionId>.json`; `manifest.members` only places that projection or another panel. The short inline member syntax in `panel.json` is for platform built-in panels and legacy single-panel registration material, not for a new application tree.

## Composition

A conversation workbench is normally four cooperating members plus application-specific slot content:

1. **Agent navigation** — an `ObjectList` projection bound to `platform:AgentDefinition.list`. Its `choose` event carries the selected object reference; write `primaryKey` to the chat's `agentId` state. Use `AgentPicker` only when the page already has a complete `agents` array (normally inside a `ConversationEntry` `#agent-picker` slot or as fixed application-specific configuration); do not treat it as a data-reading list.
2. **All-task/session list** — an `ObjectList` projection bound to `platform:AgentSession.tasks`. Pass explicit read parameters instead of relying on server-side page exceptions:
   - `search`: keyword;
   - `limit`: page size;
   - `cursor`: the owner cursor;
   - `agentId` / `agentIds`: one or several agent UUIDs;
   - `agentKinds`: one or several agent kinds;
   - `origins`: an array such as `["user", "scheduled"]` (the third origin is `delegated`; omit the parameter for no origin restriction);
   - `workspaceId`: a workspace UUID or the literal `"none"`.

   A row's `primaryKey` is the chat session ID for both user-started and scheduled-origin sessions. Bind row activation with `@choose` and write that key to the chat's `sessionId` state. Useful row fields include `title`, `agentId`, `agentName`, `agentKind`, `origin`, `workspaceId`, `createdAt`, `updatedAt`, `favorite`, `status`, `running`, `runningStatus`, and `latestRun`. The owner output `openPath` is the platform conversation shell's address; an embedded workbench normally uses the session identity itself instead of navigating there.
3. **Conversation center** — an `AgentChat` projection. Declare its starting target in `conversationEntry`, bind `sessionId`, `agentId`, and `artifact` to panel state, and set `"pageComposer": "none"` on the application entry. The chat owns platform session history; the panel must not duplicate it. Opening a cross-agent historical session makes the chat emit `update:agentId`.
4. **Artifact preview beside the conversation** — an `AgentArtifactPreview` projection whose `artifact` input and output are bound to the same panel state as the chat's `artifact` port. Artifact cards in the conversation emit a serializable `{ sessionId, runId, path, title? }` target; the preview resolves content through the signed-in reader's chat host.
5. **Scheduled-task creation** — nest the platform schedules panel `builtin-product-scheduled-tasks` and bind its public state. This reuses the owner's real create form, validation, permission checks, and result handling instead of copying them.

## Application-tree skeleton

`application.json` excerpt:

```json
{
  "panelUses": [
    {
      "id": "workbench",
      "pageKey": "workbench",
      "panelId": "conversation-workbench",
      "path": "/applications/app-example/workbench",
      "pageComposer": "none",
      "names": { "en": "Conversation workbench" }
    }
  ],
  "initialOpenEntryIds": ["workbench"]
}
```

`panels/conversation-workbench/panel.json` excerpt:

```json
{
  "name": "Conversation workbench",
  "description": "Agent conversations, task history, artifact preview, and scheduled-task creation.",
  "visibility": "domain",
  "manifest": {
    "state": {
      "agent": { "type": { "kind": "scalar", "type": "string" }, "default": null, "deepLink": true },
      "session": { "type": { "kind": "scalar", "type": "string" }, "default": null, "deepLink": true },
      "artifact": { "type": { "kind": "json" }, "default": null },
      "scheduleCompose": { "type": { "kind": "scalar", "type": "string" }, "default": null },
      "scheduleValues": { "type": { "kind": "json" }, "default": null },
      "createdTask": { "type": { "kind": "object", "objectType": "platform:Trigger" }, "default": null },
      "createCancelled": { "type": { "kind": "scalar", "type": "boolean" }, "default": null }
    },
    "members": {
      "agents": { "target": { "projectionId": "<agents-projection-uuid>" } },
      "tasks": { "target": { "projectionId": "<tasks-projection-uuid>" } },
      "chat": {
        "target": { "projectionId": "<chat-projection-uuid>" },
        "inputs": {
          "agentId": { "state": "agent" },
          "sessionId": { "state": "session" },
          "artifact": { "state": "artifact" }
        },
        "outputs": {
          "agentId": { "state": "agent" },
          "sessionId": { "state": "session" },
          "artifact": { "state": "artifact" }
        }
      },
      "preview": {
        "target": { "projectionId": "<preview-projection-uuid>" },
        "inputs": { "artifact": { "state": "artifact" } },
        "outputs": { "artifact": { "state": "artifact" } }
      },
      "schedules": {
        "target": { "panelId": "builtin-product-scheduled-tasks" },
        "inputs": {
          "workspace": { "literal": "agent" },
          "app": { "literal": "agents" },
          "workspaceAgent": { "state": "agent" },
          "workspaceCompose": { "state": "scheduleCompose" },
          "initialValues": { "state": "scheduleValues" }
        },
        "outputs": {
          "workspaceCompose": { "state": "scheduleCompose" },
          "createdTask": { "state": "createdTask" },
          "createCancelled": { "state": "createCancelled" }
        }
      }
    }
  }
}
```

`projections/<chat-projection-uuid>.json`:

```json
{
  "name": "Conversation",
  "description": "Live conversation with the selected agent.",
  "visibility": "domain",
  "componentId": "@ontomato/sdk:AgentChat",
  "inputs": {
    "sessionId": { "kind": "scalar", "type": "string" },
    "agentId": { "kind": "scalar", "type": "string" },
    "artifact": { "kind": "json" }
  },
  "outputs": {
    "sessionId": { "kind": "scalar", "type": "string" },
    "agentId": { "kind": "scalar", "type": "string" },
    "artifact": { "kind": "json" }
  },
  "data": {},
  "config": { "showHeader": true },
  "conversationEntry": {
    "target": { "kind": "id", "id": "<starting-agent-uuid>" }
  }
}
```

`projections/<preview-projection-uuid>.json`:

```json
{
  "name": "Artifact preview",
  "description": "Preview the artifact selected in the conversation.",
  "visibility": "domain",
  "componentId": "@ontomato/sdk:AgentArtifactPreview",
  "inputs": { "artifact": { "kind": "json" } },
  "outputs": { "artifact": { "kind": "json" } },
  "data": {},
  "config": { "showHeader": true, "inline": true }
}
```

`projections/<tasks-projection-uuid>.json`:

```json
{
  "name": "All tasks",
  "description": "Conversation sessions from user and scheduled origins.",
  "visibility": "domain",
  "componentId": "@ontomato/sdk:ObjectList",
  "inputs": {},
  "outputs": {},
  "data": {
    "rows": {
      "source": { "type": { "kind": "PlatformObjectType", "id": "platform:AgentSession" } },
      "read": "tasks",
      "params": {
        "origins": { "literal": ["user", "scheduled"] },
        "limit": { "literal": 20 }
      }
    }
  },
  "config": {
    "layout": "list",
    "subtitleField": "agentName",
    "statusField": "runningStatus",
    "searchable": true
  }
}
```

The agents list is the same shape with `platform:AgentDefinition.list` and usually a compact list layout. Use `@choose` for both lists; no raw row record reaches panel code.

## Template wiring

```html
<projection slot="agents" @choose="selectAgent"></projection>
<projection slot="tasks" @choose="openTask"></projection>

<projection
  slot="chat"
  :values="{ customInput: isPptRequest, inlineArtifactAlreadyShown }"
  @run-complete="onRunComplete"
>
  <template #header-actions="session">
    <sdk-button
      v-if="session.sessionId && session.hasInitialInstruction"
      @click="prepareSchedule(session)"
    >Schedule from session</sdk-button>
  </template>
  <template #input="input"><!-- application-specific user-message card --></template>
  <template #artifact-link="link"><!-- application-specific artifact card, fallback otherwise --></template>
</projection>

<projection slot="preview"></projection>
<projection v-if="scheduleCompose" slot="schedules"></projection>
```

```js
function selectAgent(agent) {
  instance.state.setState({ agent: agent.primaryKey, session: null, artifact: null });
}
function openTask(task) {
  instance.state.setState({ session: task.primaryKey, artifact: null });
}
async function prepareSchedule(session) {
  const instruction = await session.initialInstruction();
  instance.state.setState({
    scheduleValues: {
      "/task/title": session.title ?? "",
      "/agentId": session.agentId,
      "/instruction": instruction,
      "/task/enabled": true
    },
    createdTask: null,
    createCancelled: null,
    scheduleCompose: "new"
  });
}
```

Editable schedule defaults use the owner's field pointers. The common task fields are `/task/title`, `/agentId`, `/instruction`, `/task/frequency`, `/task/enabled`, `/task/description`, `/task/executorId`, `/task/coauthorIds`, `/task/timeZone`, and `/task/notifyEmail`. `initialValues` supplies editable defaults; it does not hide or lock fields. Watch `createdTask` and `createCancelled` in the parent panel and clear `scheduleValues` after the attempt is consumed.

## Generic extension points

Read `sdk read docs/components/AgentChat.md` and `AgentArtifactPreview.md` before authoring. In particular:

- `#welcome` and `#conversation-empty` customize the first visible state without replacing the conversation.
- `#message-actions` renders in the response footer and receives the standard message context, including `outcome` when the run produced one.
- `#artifact-link`, `#artifact`, and `#artifact-actions` customize artifact cards and preview chrome. They receive the generic fallback component and props; render the fallback whenever the artifact is not the application's special case.
- `customInput` is `(text: string) => boolean`; `#input` receives `{ inputId, text, queued, run, preparationFailed }`.
- `artifactRenderers`, `inlineArtifactAlreadyShown`, and `continueConversation` are runtime component inputs, so pass them through `:values` at the placement (functions may live in `panel.mjs`), not in persisted JSON `config`.
- `@run-complete` includes the completed `sessionId` and `runId`; when artifact registration was readable it also carries `artifacts`. The panel decides whether to open or select an artifact. The chat does not open one by rule.
- `header-actions` slot scope exposes the current session ID, agent ID, title, origin, whether an initial instruction exists, and the initial-instruction reader. Use those generic facts instead of parsing conversation items.

## Example: report-to-PPT card

The application owns the fixed prompt convention, the report filename convention, and the PPT card. The platform owns only the generic rendering hooks:

1. Put the prompt predicate in `panel.mjs` and pass it as `customInput` through `:values`.
2. In `#input`, render the application-specific card only for that prompt; otherwise render the normal user-message bubble outside the slot path. Use `input.run` and `input.preparationFailed` for progress and failure display.
3. In `#artifact-link`, recognize the PPT artifact by its path or media type and render the application card; otherwise render `link.fallback.component` with `link.fallback.props`.
4. When a run completes, inspect `event.artifacts` and write the chosen artifact target to the shared `artifact` state only if the application wants automatic preview. A common application convention is to select the newest `report.md` or `report-*.md` by `createdAt` and `seq`; the platform deliberately does not decide which artifact is “the report” for every application.

## Scheduled task creation from a session

Prefer the nested schedules panel shown above. It already owns application/target choices, frequency control, validation, create operation, cancellation, and the created-object receipt. The parent supplies only session-derived `initialValues` and observes `createdTask` / `createCancelled`. After `createdTask`, return to the conversation or select the created task according to the application's own navigation rule.

Use a standalone `ObjectForm` only when the page needs a materially different creation flow. In that case bind `platform:Trigger.createForm` and the `triggers.create` operation explicitly; do not copy the schedules panel's form logic into panel code.
