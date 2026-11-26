# Agent control of a live panel

A conversation can observe its displayed page with `observe_display`, navigate or patch public state with `present`, edit mounted forms with `fill_form`, and invoke a mounted button or form action with `page_action`. Each call receives a receipt from the bound view. The page owns the live values, button behavior and form submission. The runtime tools carry field edits and action selectors through the presentation channel.

A run with the page operator skill reads persisted data through the sealed execution callback's `panels/read` and `panels/nested` routes. The callback restores the run's caller and validates the application entrance plus panel and projection use. A user-facing execution inherits the logged-in user's permissions. An unattended execution uses its configured identity and calls business capabilities independently of the page.

## Prepare and execute

The page prepares an operation through the same server intent endpoint used by a human click. The server validates the panel, operation binding, target and owner input. For an agent-initiated operation it also checks the active run, its authority, the human session and the run's page-control capability. The intent freezes the server-resolved operation and concrete call, and records its origin.

When confirmation is required, the conversation presents the intent's operation, target and impact. The page keeps the continuation bound to its current instance, target and form values. On approval the page checks those facts before sending the prepared intent ID for execution. An edit, manual save or navigation invalidates the confirmation. Full-auto mode executes the prepared intent immediately with the same permissions and owner validation.

The execution request has an empty body. The server rechecks the operation definition, claims the intent once, invokes the owner with the user's credentials and stores its receipt. A missing receipt can be investigated through the intent read endpoint. Historical intent records remain readable through the stored intent contract.

| Method and path | Contract |
| --- | --- |
| `POST /api/panel-operations/intents` | Prepare a human or agent-page intent and return its confirmation details |
| `POST /api/panel-operations/intents/:intentId/dispatch` | Execute the prepared intent |
| `POST /api/panel-operations/intents/:intentId/cancel` | Cancel a pending intent |
| `GET /api/panel-operation-intents/:intentId` | Read the caller's stored intent |
| `GET /api/panel-operation-settings/:providerId/:sessionId` | Read confirmation settings for the owning session |
| `PUT /api/panel-operation-settings/:providerId/:sessionId` | Update confirmation settings for future intents |
