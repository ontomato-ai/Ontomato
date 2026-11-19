# Typical procedures

Read `skills` and `models` first; they are also what a save validates against. Use `get` for the current definition of anything being changed, and work on a copy in `work/` so every other field goes back as the agent holds it. Only `skills` may be left out, to keep the stored ones.

## Create an agent

1. Read `skills` and `models`. Ask for whatever the user has not decided: the job of the agent, its prompt, which skills it may use and which model.
2. Write the whole form in `work/agent.json` with no `id` — a creation names its fields, its skills included (`[]` for none) — and `"executionUserId": null` unless the user asked to run it as another user: then read `execution-users` and use the chosen real user.
3. Inside the platform: `draft create @work/agent.json`, `validate-draft @outputs/drafts/agent.page-draft.json`, then give the user the `draft-link` line. The page opens as a new agent with the form filled; the user saves it.
4. Outside the platform: `create @work/agent.json`. The reply names the new agent and links `/agents/settings/<id>`.

## Change a prompt, skill or model

1. `get <id>`; copy the definition to `work/agent.json` and remove `id`.
2. Read `skills` and `models` if the change selects one, and edit only the fields the user asked about. Keep `executionUserId` exactly as `get` returned it. Remove `skills` from the copy unless the user is changing the agent's skills.
3. Inside the platform: `draft update <id> @work/agent.json`, validate it, and give the user the draft link. The page marks the changed fields and stays unsaved.
4. Outside the platform: `update <id> @work/agent.json`.

If the user asks to change one thing after seeing the draft, edit the same form and run the three draft commands again; do not claim the earlier draft was saved.

## Change the skills

1. Read `skills` for the catalog this caller may choose from, and `get <id>` for the skills the agent holds now.
2. To keep the agent's skills, remove `skills` from the copy. To replace them, write the whole array this change wants; `[]` clears them.
3. The form stays the whole definition: every other field goes back as `get` returned it. `get` shows only the skills this caller may see, so never send that array back to keep them — that is an explicit whole-selection change. Write and validate the draft, or run `update` outside the platform.

An agent may hold protected skills this caller cannot see, and `get`, the page and the catalog show only the ones this caller may see. If the agent holds such a skill, an update that names `skills` is refused as a whole and none of its fields are written; the refusal does not name the skill. That change needs someone who can see the complete selection. Report the owner's words and leave the skills alone; do not work around it by sending back the skills `get` showed.

## Change the execution permission

1. Run `execution-users [keyword]`. If `canSetExecutionUser` is false, only a domain governance administrator can change this field: say so and leave it alone.
2. Otherwise pick the user by `id` from the result, and set `executionUserId` to that ID (or to `null` for the reader's own permission).
3. Update the definition as above. A save or draft that changes the field is rejected with 403 for anyone else; a form that keeps the stored value passes.

The agent runs with that user's current permissions from the next run; a user who later stops being an enabled member makes the run fail explicitly, not fall back to the reader. List results show the stored user by ID; do not claim a user's data access without running the agent as them.

## Delete an agent

Inside the platform, the page owns deletion: open `/agents/settings/<id>` and tell the user to delete it there. Outside the platform, `delete <id>` removes the definition.

## Check the result

After the user saves, `get <id>` and confirm every field, including `executionUserId`. `get` shows only the skills this caller may see, so it does not prove a kept protected selection; the agent's own runs do. A saved definition does not show that the agent uses the skills as intended; that needs a real conversation with the agent, opened from `/agents/settings/<id>`.
