# Student directory

Use this layout for a compact list with one record's details and editor alongside it. A narrow container
shows the selected student's detail directly. Back returns to the mounted list with its search and paging intact.

The template expects a customer type `Student`, an object-targeted save Action `student.update`, and a targetless
Action `student.create` with `affects: ["Student"]`. Use `panel type Student` to verify the real IDs and form fields
before registration. The update and create Actions must accept the fields that the reader can edit.

`ObjectList` emits `choose` without writing `selected`. The panel confirms before changing the committed selection
or opening Create. The edit form targets that committed selection. Cancel, Escape and Back share the host guard.
The header shows unreadable or missing records at the supplied address. `listed` is read once for default selection
only at an opening without a selection.

```sh
template="$SKILL/references/templates/list-detail-edit"
node "$SKILL/scripts/ontomato.mjs" panel check "$template"
node "$SKILL/scripts/ontomato.mjs" panel register "$template"
```

Open `/applications/app-student-directory/students`.
