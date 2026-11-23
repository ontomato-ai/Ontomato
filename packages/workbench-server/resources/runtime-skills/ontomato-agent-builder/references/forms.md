# Form: `AssistantAgentInput`

Fields in an agent definition.

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
| `modelSelection` | `{"modelId": string\|null}` | A `ref` from `models`; `{"modelId":null}` follows the domain default. |
| `skills` | array of `{namespace, name}` | The whole selection: copy entries from `skills` unchanged, or send `[]` to clear it. Omit it on update to keep the agent's stored skills. |
| `classNames` | string array | Ontology classes it may query; empty means unrestricted. |
| `enabledMcpServiceIds` | UUID array | External MCP services. Keep the current IDs unless the user selects services on the page. |
| `sortOrder` | integer | Order in the list. Omit it to keep the stored order on update or use 0 on creation. |
| `executionUserId` | string or `null` | Default execution identity for automated/unattended runs (`null` by default). Interactive conversations with a logged-in user always inherit that user's permissions. Omitted on update keeps the stored value. |

A direct CLI update sends the definition. Use `get`, edit the input in `work/`, keep every other field as it was, and remove `id`. Omit `skills` to preserve the stored selection. An explicit array, including `[]`, replaces it. `name`, `description`, `icon`, `enabled` and `systemPrompt` are required. Omitted `classNames`, `enabledMcpServiceIds` and `modelSelection` take their defaults (`[]`, `[]`, the domain model). The selected model and every selected skill must be in the catalogs.

To keep the agent's skills, leave `skills` out of the form; never read the agent and send the skills it shows back. An agent may hold protected skills this caller cannot see, and `get`, the page and the catalogs show only the skills this caller may see. If the agent holds such a skill, an update that names `skills` is refused as a whole, and the same request's other fields are not written either; the refusal does not name the skill. That change needs someone who can see the complete selection. If the request is refused, report it in the owner's own words and do not try the array `get` showed instead.

`executionUserId` is a real, enabled user of the current domain, not a role or a credential, used only for automated/unattended runs (interactive runs with a logged-in user always inherit that user's permissions). A new form writes `null`. Only a domain governance administrator may add, remove or replace it; another editor keeps the stored value, and a form that changes it is rejected with 403 instead of applied. If the configured user is disabled, deleted or removed from the domain, an unattended run fails explicitly.

## Live page editing inside the platform

With live page tools, use `present({ target: "/agents/settings/new" })` to create or
`present({ target: "/agents/settings/<id>" })` to edit. The same paths work under
`/ontology/agents`. Call `fill_form({ member: "form", values })` with just the fields being
set or changed. Include `skills` only for a requested selection change. Leave the form visible
for review. When the user asks to save, call `page_action({ operation: "form.save" })`.
For a requested deletion, open the existing agent and call `page_action({ operation: "remove.delete" })`.
Writes default to user confirmation in the conversation.

If you need to validate the complete definition before handing over the form, send
`POST $ONTOMATO_WORKBENCH_URL/api/assistant/agent-definitions/validate` with
`{target:{objectType:"platform:AgentDefinition"},form}`. Add `id` to `target` for an edit.
`form` is the full definition input, with `skills` omitted on edit to preserve the stored selection.
Send JSON with `tk: $ONTOMATO_TK` or `X-API-Key: $ONTOMATO_API_KEY` at the service root.
At the run callback base ending in `/workbench`, send
`X-Ontomato-Callback-Credential: $ONTOMATO_EXECUTION_CALLBACK` and
`X-Ontomato-Run-Id: $ONTOMATO_RUN_ID`. HTTP 204 means the owner accepted the definition for
validation. The page still owns saving the live form.

## Direct writes

Outside the platform, set `ONTOMATO_URL` to the Workbench service root and set one of
`ONTOMATO_TK` (`tk` header) or `ONTOMATO_API_KEY` (`X-API-Key` header).

```sh
node scripts/page.mjs create @work/agent.json        # POST /api/assistant/agent-definitions
node scripts/page.mjs update <id> @work/agent.json   # PUT  /api/assistant/agent-definitions/<id>
node scripts/page.mjs delete <id>                    # DELETE /api/assistant/agent-definitions/<id>
```

`create` sends an idempotency key of its own. `update` sends the complete definition input from
the file as given. `delete` takes an ID. The commands print the returned definition or `ok` for a delete.

Platform background and delegated runs cannot write agent definitions without page tools.
Return the agent ID and proposed changes or the requested deletion as structured content.
