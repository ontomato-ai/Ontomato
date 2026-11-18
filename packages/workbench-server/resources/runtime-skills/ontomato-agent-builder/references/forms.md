# Form: `AssistantAgentInput`

The page's save request, and the `form` inside a draft.

```json
{
  "name": "Customer assistant",
  "description": "Answers questions about customers",
  "icon": null,
  "enabled": true,
  "systemPrompt": "You are ...",
  "modelSelection": {"modelId": "openai/gpt-4.1"},
  "skills": [{"namespace": {"kind": "provider", "provider": "workbench"}, "name": "assistant-report"}],
  "classNames": ["Customer"],
  "enabledMcpServiceIds": [],
  "sortOrder": 0,
  "executionUserId": null
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | non-empty string | Name in the list. |
| `description` | string | One line shown in the list. |
| `icon` | string or `null` | Icon key. |
| `enabled` | boolean | Available in conversations. |
| `systemPrompt` | string | The agent's own prompt. |
| `modelSelection` | `{"modelId": string\|null}` | A `ref` from `models`; `null` follows the domain default. |
| `skills` | array of `{namespace, name}` | Copy entries from `skills` unchanged. |
| `classNames` | string array | Ontology classes it may query; empty means unrestricted. |
| `enabledMcpServiceIds` | UUID array | External MCP services. Keep the current IDs unless the user selects services on the page. |
| `sortOrder` | integer | Order in the list. |
| `executionUserId` | string or `null` | `null` runs with the reader's own permission; a user `id` from `execution-users` runs with that user's. Omitted on update keeps the stored value. |

A save replaces the whole definition. For an update, `get` it, edit the form in `work/`, keep every other field as it was, and remove `id`. The selected model and every selected skill must be in the catalogs.

`executionUserId` is a real, enabled user of the current domain, not a role or a credential. A new form writes `null`. Only a domain governance administrator may add, remove or replace it; another editor keeps the stored value, and a form that changes it is rejected with 403 instead of applied. If the configured user is disabled, deleted or removed from the domain, the next run fails explicitly and does not fall back to the reader. `validate-draft` reads the target's stored definition to compare against, so a draft that keeps the old value passes and a forged change does not.

## Drafts

A draft is one JSON file at `outputs/drafts/<name>.page-draft.json`:

```json
{
  "pageKey": "agent-settings",
  "operation": "agent.update",
  "target": {"id": "<agent id>"},
  "form": { "...": "AssistantAgentInput" }
}
```

`agent.create` has `"target": {}`; `agent.update` has the definition ID. There are no other operations on this page.

```sh
node skills/ontomato-agent-builder/scripts/page.mjs draft create @work/agent.json
node skills/ontomato-agent-builder/scripts/page.mjs draft update <id> @work/agent.json
node skills/ontomato-agent-builder/scripts/page.mjs validate-draft @outputs/drafts/agent.page-draft.json
node skills/ontomato-agent-builder/scripts/page.mjs draft-link @outputs/drafts/agent.page-draft.json
```

`draft` writes the file (default `outputs/drafts/agent.page-draft.json`) and prints its path. `validate-draft` sends `{target, form}` to `POST /api/assistant/agent-definitions/validate`: the owner loads the target definition (an empty target on creation), then runs the same form, model, skill and execution-setting checks as a save without writing anything or preparing a key. It prints `ok` or the error. `draft-link` prints the page link for this run:

```text
#/agents/settings/<id or new>?draftSessionId=<session>&draftRunId=<run>&draftPath=outputs%2Fdrafts%2Fagent.page-draft.json
```

Give that line to the user as a Markdown link. The page fills the form from it and stays unsaved; the user saves or discards it there.

## Direct writes

Outside the platform the same file can be written directly:

```sh
node scripts/page.mjs create @work/agent.json        # POST /api/assistant/agent-definitions
node scripts/page.mjs update <id> @work/agent.json   # PUT  /api/assistant/agent-definitions/<id>
node scripts/page.mjs delete <id>                    # DELETE /api/assistant/agent-definitions/<id>
```

`create` sends an idempotency key of its own; the other commands send the form as it is. All three print the returned definition, or `ok` for a delete.

Inside the platform (`ONTOMATO_SKILL_SCENARIO=platform`) these three commands refuse before any request is sent and name the draft commands instead.
