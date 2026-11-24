---
name: ontomato-agent-builder
description: Create and edit Ontomato agent definitions (prompt, model, skills, classes and external MCP services) on the agent settings page through live page tools or direct CLI outside the platform.
compatibility: Requires Node.js 18 or newer and an Ontomato 5.0 deployment. In the platform the runtime supplies the service addresses and the caller's credential; outside it, set ONTOMATO_URL and ONTOMATO_TK or ONTOMATO_API_KEY.
---

# Agent settings

The page is the agent platform's agent settings page (the ontology manager shows the same page in its product layer). It manages the agents of the domain: `/agents/settings` lists them, `/agents/settings/<id>` is one agent and `/agents/settings/new` creates one. One definition has these fields:

| Field | Meaning |
| --- | --- |
| `name`, `description`, `icon` | Identity in the agent list; `description` is one line. |
| `enabled` | Whether the agent is available in conversations. |
| `systemPrompt` | The agent's own prompt: role, which capability to use for which question, answer format. |
| `modelSelection` | `{"modelId":"<provider>/<model>"}` from `models`. `{"modelId":null}` follows the domain default. |
| `skills` | The agent's skills, each `{namespace, name}` from `skills`. Send the array to replace the whole selection, `[]` to clear it, or leave it out to keep the stored skills. |
| `classNames` | Ontology classes it may query; empty means unrestricted. |
| `enabledMcpServiceIds` | External MCP services it may call. |
| `sortOrder` | Order in the list. |
| `executionUserId` | Default execution identity for automated/unattended runs (`null` by default). Interactive conversations with a logged-in user always inherit that user's permissions. |

Fill only the requested fields in the live form. A direct CLI update takes the complete definition input described in [forms](references/forms.md). Include `skills` only when replacing the selection. Read `models` and `skills` before choosing catalog entries. Write names, descriptions and prompts in the user's language.

Some skills are protected: an agent may hold skills this caller cannot see, and the page, `get` and the catalogs show only the ones this caller may see. If the agent holds such a skill, an update that names `skills` is refused as a whole, and none of that request is written; the refusal does not name the skill. Leave `skills` out unless the user asked to change them. When an explicit skills change is refused, say it must be made by someone who can see the complete selection; never send back the skills `get` showed as a way around it.

Only a domain governance administrator may set `executionUserId`: `execution-users` reports `canSetExecutionUser`, and an editor who tries to add, remove or replace it is rejected. Other editors keep the stored value; an update that omits the field keeps it too, and a new form writes `null`. If the configured user is disabled, deleted or removed from the domain, the run fails explicitly; it never falls back to the reader.

## Commands

Inside the platform run these from the workspace root; installed outside, run `node scripts/page.mjs` in this skill's directory.

```sh
node skills/ontomato-agent-builder/scripts/page.mjs list
node skills/ontomato-agent-builder/scripts/page.mjs get <id>
node skills/ontomato-agent-builder/scripts/page.mjs skills
node skills/ontomato-agent-builder/scripts/page.mjs models
node skills/ontomato-agent-builder/scripts/page.mjs execution-users [keyword]
```

Read [pages](references/pages.md) for the read commands and addresses, [forms](references/forms.md) for the form and direct writes, and [tasks](references/tasks.md) for typical procedures.

## Create, edit and delete

- With `present`, `fill_form` and `page_action`, use the live Agent Settings page. Fill only the requested fields and leave the form open for review. Use `page_action` for the requested write. See [forms](references/forms.md) for the form member and operations.
- In a platform background or delegated run without page tools, agent settings have no capability-layer write operation. Return the target ID and structured proposed fields or requested deletion to the user or assigning agent, with the write still pending.
- Outside the platform, the [direct CLI commands](references/forms.md#direct-writes) use your own credential and the deployment's agent settings API.

## Page context

When a message ends with the current page and the selected item, the selected item on this page is the agent definition ID — the `:id` in `/agents/settings/<id>` — not the display name. Read it with `get <id>` before changing it. On `/agents/settings/new` nothing is selected yet.

## Links

Write a page link as the page's path, for example `[Customer assistant](/agents/settings/<id>)`; the platform opens it beside the conversation.
