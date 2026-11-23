# Typical procedures

Read `skills` and `models` before choosing one, and `get` for the current definition of anything being changed. Use the [form and operations](forms.md) for the current run. In a platform run without page tools, return the proposed input as structured content for the user or assigning agent to apply.

## Create an agent

1. Read `skills` and `models`. Ask for whatever the user has not decided: the job of the agent, its prompt, which skills it may use and which model.
2. With live page tools, open `/agents/settings/new` with `present`, then fill `form` with `fill_form`. Leave it visible for review. If asked to save, use `page_action({ operation: "form.save" })`. Leave `executionUserId` as `null` unless the user wants a default identity for automated/unattended runs.
3. Outside the platform: write the whole form in `work/agent.json` with no `id` and run `create @work/agent.json`. The reply names the new agent and links `/agents/settings/<id>`.

## Change a prompt, skill or model

1. `get <id>`; read `skills` and `models` if the change selects one.
2. With live page tools, use `present` to open `/agents/settings/<id>`, and `fill_form` to fill only the fields being changed. Use `page_action({ operation: "form.save" })` when asked to save.
3. Outside the platform: copy the definition to `work/agent.json` without `id`, keep `executionUserId` as returned, omit `skills` unless changing them, and run `update <id> @work/agent.json`.

## Change the skills

1. Read `skills` for the catalog this caller may choose from, and `get <id>` for the skills the agent holds now.
2. Supply the full requested selection, using `[]` to clear the skills. Omit `skills` when the change leaves them alone.
3. With live page tools, fill the `skills` field of `form` and use `form.save` when asked to save. Outside the platform, send the complete definition with `update`, preserving the other fields.

An agent may hold protected skills this caller cannot see, and `get`, the page and the catalog show only the ones this caller may see. If the agent holds such a skill, an update that names `skills` is refused as a whole and none of its fields are written; the refusal does not name the skill. That change needs someone who can see the complete selection. Report the owner's words and leave the skills alone; do not work around it by sending back the skills `get` showed.

## Change the execution permission

1. Run `execution-users [keyword]`. If `canSetExecutionUser` is false, only a domain governance administrator can change this field: say so and leave it alone.
2. Otherwise pick the user by `id` from the result, and set `executionUserId` to that ID (or to `null`).
3. Update the definition as above. A save that changes the field is rejected with 403 for anyone else; a form that keeps the stored value passes.

`executionUserId` applies only to automated/unattended runs (interactive sessions with a logged-in user always inherit that user's permissions). If the configured user later stops being an enabled member, unattended runs fail explicitly. List results show the stored user by ID; do not claim a user's data access without running the agent as them.

## Delete an agent

With live page tools, pass the intended agent ID as `state.selected.primaryKey` in `present`
as shown in [forms](forms.md). Check the returned snapshot for the same selected primary key
and the page instance ID. Pass both to `page_action` for `remove.delete` as `expectedTarget`
and `expectedPageInstanceId`. If the selection is absent, the list falls back to a different
agent, or the page instance cannot be verified, stop and tell the user. Outside the platform,
`delete <id>` removes the definition.

## Check the result

After the user saves, `get <id>` and confirm every field, including `executionUserId`. `get` shows only the skills this caller may see, so it does not prove a kept protected selection; the agent's own runs do. A saved definition does not show that the agent uses the skills as intended; that needs a real conversation with the agent, opened from `/agents/settings/<id>`.
