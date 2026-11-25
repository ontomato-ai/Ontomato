# When a panel looks wrong

Open the registered entry without query parameters first, keep browser Network and Console logs open across a hard
reload, and inspect the first failing request or error:

- **Blank panel or `panel-host-error`.** Inspect console errors, `GET /api/product-panels/<id>`, and SDK asset
  requests. Verify with `panel uses <app-id>`, `panel get <panel-id>`, `panel projection <id>`, and
  `panel check <directory>`.
- **List is empty or waiting.** Check `POST /api/product-panels/read` for `memberPath` and `dataName` against
  `panel type <type-id> --read <name>`. Missing required inputs leave a datum `awaiting`.
- **Form does not fill or save.** Verify the form member is mounted (`observe_display`), check field paths and read-only status from the `fill_form` receipt, and verify the save operation is admitted for the current target.
