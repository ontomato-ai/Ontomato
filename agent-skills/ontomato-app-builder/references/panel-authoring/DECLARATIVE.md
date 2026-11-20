# Direct declarative panel

Start from the supplied management-page example. Use `panel scaffold <type> <new directory>` to generate a panel,
projection records and an application use from the current type table. Use `--operation` for a selected object
and `--batch` for checked records when the owner operation supports that target.

Write the layout in `panel.html` with ordinary HTML, classes and one `<style>` block.
CSS styles this panel's layout and member containers. Use design variables to adjust a component's appearance.
Keep scripts and inline handlers out of the HTML. Use `<panel-member ref="detail"></panel-member>` to place members,
`when` for conditions, `each` for repetitions and declared member outputs or panel events for interactions.

In `panel.json`, write `{manifest, content?}`. The manifest holds `state`, `members` and `events`. Bind a list's
`outputs.selected` to an object-reference state, then use it as the detail or form input. Bind `outputs.search`
when other members or the address need the same search. A matching parameter name uses this state binding.
State that restores from the address has `deepLink: true`.

Use `data.rows` for the owner's list or query, `data.record` for a summary, `data.form` for editing and
`data.createForm` for creation. The component supplies runtime read parameters from its own declaration.
An empty selected state shows the create form when the projection declares `createForm`.

Use one `data.operation` on an OperationButton projection. Use the owner operation's `target.input` name in the
projection and the member binding. Bind that input to the selected object for a single action or the checked list
for a batch action. An operation placed on a member uses the member key and last segment of its owner ID.

Inspect the example's three files for the full layout, manifest and registration input. Check and register with
the commands in the skill, then open the application's use path.
