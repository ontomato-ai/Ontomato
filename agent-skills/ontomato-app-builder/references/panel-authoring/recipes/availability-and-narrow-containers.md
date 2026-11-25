# Availability, narrow containers, and projections

Use `v-if` to unmount a closed editor or an unavailable action. Where the component declares `when` or
`disabledWhen`, use them for current availability, so the same entry is gated for humans and assistants.
Use `v-show` for another tab of the same object, a collapsed section, or a list behind a detail view, preserving
the forms and list interaction. Keep a named `#actions` slot declared and put conditional content inside it.

Measure a container with `const root = ref(null); const narrow = usePanelNarrow(root)` and put `ref="root"`
on the layout element. The hook reads `--pane-narrow-breakpoint` by default, or an explicit `{ token }`.
Use the result to open the selected detail directly beside a conversation, and CSS `@container` for layout.
Route local Back or dialog close through `usePanelBack`. Leave `<sdk-dialog>` Escape handling enabled and
call the guarded `back()` from the dialog model's close setter.

`<projection>` provides a `.sdk-panel-member` wrapper and may render a brief loading state as its component
mounts. Constrain the wrapper in tight slots. For an app-menu badge, scope
`.menu-count:not(:has(.sdk-object-count)) { display: none; }` to the trailing projection to suppress placeholders and
empty spacing. Use `v-if` inside the visible menu item's slot so hidden or unauthorized entries do not mount readers.
