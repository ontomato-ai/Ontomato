# Panel page templates

Copy the chosen application tree into your source. Use the project's application ID in the entry paths,
and update owned panel and projection IDs together with their references when adapting a template to a new app.
For shared resources, keep the existing IDs and reference them from the consuming application.

| Page shape | Template |
| --- | --- |
| Full-width catalog and a separate full-width detail entry | [Two-entry catalog and detail](two-entry-catalog-detail/README.md) |
| Compact list with detail, create and edit in the right workspace, as in Business Knowledge | [List and detail editor](list-detail-edit/README.md) |
| Full-width table with row actions and a tabbed editor dialog | [Table and modal editor](table-inline-modal-edit/README.md) |
| Shared term selector, authorized menu and trailing counts | [Application frame](app-frame/README.md) |

For a full-width catalog, use the two-entry template. Place the primary New button at the top right of the
catalog header. Open a centered dialog with only the required fields, then navigate to the new object's
full-width detail after save. The detail header links back with `navigateBack(CATALOG_PATH)`. The host
returns to the in-platform previous page (falling back to `CATALOG_PATH` on direct open) and refreshes the list on return.

Ask for confirmation before leaving a dirty form, including on row switches, Back, Escape and dialog close.
Keep lists and tabs mounted with `v-show` when they are merely off-screen. Use `v-if` for forms and actions
that are closed or unavailable. Leave missing or forbidden selections in place and show the owner's reason.
Put the selected record and shareable view state in flat named address parameters. Keep dialog and active-edit
state public with `deepLink: false`.

See the [task-indexed recipes](../../SKILL.md#what-you-want-to-do--where-to-look) (`../panel-authoring/recipes/`) for graph wiring, the offline checker, and projection outputs, and `sdk read docs/components.md` / `docs/components/<Name>.md` for component contracts.
