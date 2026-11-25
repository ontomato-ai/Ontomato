# Course catalogue

The full-width `ObjectList` declares Edit and Archive on each row. Edit is local UI navigation. Archive is a
declared owner operation, so a human or an assistant uses the same row entry and confirmation.

The template expects a customer type `Course`, editable fields `name`, `description` and `capacity`, and
object-targeted Actions `course.update` and `course.archive`. Use `panel type Course` to verify your declarations
and adapt the field pointers and Action IDs.

`editing` is the typed dialog target and its presence opens the dialog. `editing` and the dialog's `tab` are public
with `deepLink: false`. Both tabs are views of the same form and stay mounted while switching. Closing the dialog
checks for unsaved changes and unmounts the editor. Reopening on a different row binds that row's reference.

```sh
template="$SKILL/references/templates/table-inline-modal-edit"
node "$SKILL/scripts/ontomato.mjs" panel check "$template"
```

After publishing through Application Builder, open `/applications/app-course-catalogue/courses`.
