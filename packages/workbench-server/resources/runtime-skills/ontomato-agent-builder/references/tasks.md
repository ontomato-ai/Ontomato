# Typical procedures

Read `skills` and `models` first; they are also what a save validates against. Use `get` for the current definition of anything being changed, and work on a copy in `work/` so the form's other fields stay as they were.

## Create an agent

1. Read `skills` and `models`. Ask for whatever the user has not decided: the job of the agent, its prompt, which skills it may use and which model.
2. Write the form in `work/agent.json` with no `id`.
3. Inside the platform: `draft create @work/agent.json`, `validate-draft @outputs/drafts/agent.page-draft.json`, then give the user the `draft-link` line. The page opens as a new agent with the form filled; the user saves it.
4. Outside the platform: `create @work/agent.json`. The reply names the new agent and links `/ontology/agents/<id>`.

## Change a prompt, skill or model

1. `get <id>`; copy the definition to `work/agent.json` and remove `id`.
2. Read `skills` and `models` if the change selects one, and edit only the fields the user asked about.
3. Inside the platform: `draft update <id> @work/agent.json`, validate it, and give the user the draft link. The page marks the changed fields and stays unsaved.
4. Outside the platform: `update <id> @work/agent.json`.

If the user asks to change one thing after seeing the draft, edit the same form and run the three draft commands again; do not claim the earlier draft was saved.

## Delete an agent

Inside the platform, the page owns deletion: open `/ontology/agents/<id>` and tell the user to delete it there. Outside the platform, `delete <id>` removes the definition.

## Check the result

After the user saves, `get <id>` and confirm every field. A saved definition does not show that the agent uses the skills as intended; that needs a real conversation with the agent, opened from `/ontology/agents/<id>`.
