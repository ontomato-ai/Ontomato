---
name: ontomato-agent-builder
description: Create and edit Ontomato agent definitions (prompt, model, skills, classes and external MCP services) on the agent settings page, and hand the user a filled, unsaved page draft to save.
compatibility: Requires Node.js 18 or newer and an Ontomato 5.0 deployment. In the platform the runtime supplies the service addresses and the caller's credential; outside it, set ONTOMATO_URL and ONTOMATO_TK or ONTOMATO_API_KEY.
---

# Agent settings

The page is the agent platform's agent settings page (the ontology manager shows the same page in its product layer). It manages the agents of the domain: `/agents/settings` lists them, `/agents/settings/<id>` is one agent and `/agents/settings/new` creates one. One definition has these fields:

| Field | Meaning |
| --- | --- |
| `name`, `description`, `icon` | Identity in the agent list; `description` is one line. |
| `enabled` | Whether the agent is available in conversations. |
| `systemPrompt` | The agent's own prompt: role, which capability to use for which question, answer format. |
| `modelSelection` | `{"modelId":"<provider>/<model>"}` from `models`; `null` follows the domain default. |
| `skills` | Runtime skills it may use, each `{namespace, name}` from `skills`. |
| `classNames` | Ontology classes it may query; empty means unrestricted. |
| `enabledMcpServiceIds` | External MCP services it may call. |
| `sortOrder` | Order in the list. |
| `executionUserId` | `null` (the default) runs with the reader's own permission; a user ID from `execution-users` runs with that real domain user's permission. |

A definition is saved whole: read it, change the fields, and send every field back without `id`. The selected model and every skill must exist in the catalog, so read `models` and `skills` before choosing. Names, descriptions and prompts are business content; write them in the user's language.

Only a domain governance administrator may set `executionUserId`: `execution-users` reports `canSetExecutionUser`, and an editor who tries to add, remove or replace it is rejected. Other editors keep the stored value; an update that omits the field keeps it too, and a new form writes `null`. If the configured user is disabled, deleted or removed from the domain, the run fails explicitly; it never falls back to the reader.

## Commands

Inside the platform run these from the workspace root; installed outside, run `node scripts/page.mjs` in this skill's directory.

```sh
node skills/ontomato-agent-builder/scripts/page.mjs list
node skills/ontomato-agent-builder/scripts/page.mjs get <id>
node skills/ontomato-agent-builder/scripts/page.mjs skills
node skills/ontomato-agent-builder/scripts/page.mjs models
node skills/ontomato-agent-builder/scripts/page.mjs execution-users [keyword]
node skills/ontomato-agent-builder/scripts/page.mjs draft create @work/agent.json [outputs/drafts/agent.page-draft.json]
node skills/ontomato-agent-builder/scripts/page.mjs draft update <id> @work/agent.json [outputs/drafts/agent.page-draft.json]
node skills/ontomato-agent-builder/scripts/page.mjs validate-draft @outputs/drafts/agent.page-draft.json
node skills/ontomato-agent-builder/scripts/page.mjs draft-link @outputs/drafts/agent.page-draft.json
node skills/ontomato-agent-builder/scripts/page.mjs create @work/agent.json
node skills/ontomato-agent-builder/scripts/page.mjs update <id> @work/agent.json
node skills/ontomato-agent-builder/scripts/page.mjs delete <id>
```

Read [pages](references/pages.md) for the read commands and addresses, [forms](references/forms.md) for the form, drafts and direct writes, and [tasks](references/tasks.md) for typical procedures.

## Drafts inside the platform, direct writes outside

The platform sets `ONTOMATO_SKILL_SCENARIO=platform`. Then `create`, `update` and `delete` refuse: write a page draft, validate it, and give the user the `draft-link` URL. The page opens with the form filled and unsaved; the user saves or discards it. Never say a change is saved, and never simulate the page's save.

Without `ONTOMATO_SKILL_SCENARIO` (the Skill suite, using the reader's own credential) the same package writes directly through the same endpoints.

## Page context

When a message ends with the current page and the selected item, the selected item on this page is the agent definition ID — the `:id` in `/agents/settings/<id>` — not the display name. Read it with `get <id>` before changing it. On `/agents/settings/new` nothing is selected yet.

## Links

Write a page link as the page's path, for example `[Customer assistant](/agents/settings/<id>)`; the platform opens it beside the conversation. A draft link is the exact line `draft-link` prints, for example `[Open the draft](#/agents/settings/<id>?draftSessionId=...&draftRunId=...&draftPath=...)`.
