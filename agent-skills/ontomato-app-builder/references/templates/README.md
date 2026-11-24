# Panel page templates

| Page shape | Template |
| --- | --- |
| Compact list with detail, create and edit in the right pane | [List and detail editor](list-detail-edit/README.md) |
| Full-width table with row actions and a tabbed editor dialog | [Table and modal editor](table-inline-modal-edit/README.md) |
| Shared term selector, authorized menu and trailing counts | [Application frame](app-frame/README.md) |
| Full-width catalog and a separate detail entry | [Two-entry catalog and detail](two-entry-catalog-detail/README.md) |
| Full-width catalog, detail and create dialog in one entry | [Catalog, detail and create dialog](catalog-detail-dialog/README.md) |

Ask for confirmation before leaving a dirty form, including on row switches, Back, Escape and dialog close.
Keep lists and tabs mounted with `v-show` when they are merely off-screen. Use `v-if` for forms and actions
that are closed or unavailable. Leave missing or forbidden selections in place and show the owner's reason.
Put the selected record and shareable view state in flat named address parameters. Keep dialog and active-edit
state public with `deepLink: false`.

See [Vue authoring](../panel-authoring/CODE.md) for graph wiring, the offline checker, and component contracts.
