---
name: dashboard-pages
description: Take the reader to a saved dashboard or card. Always run link when asked for its page link. Explain current MetricView results and update saved dashboards.
compatibility: Requires Node.js 24 or newer. API commands use ONTOMATO_WORKBENCH_URL and ONTOMATO_TK, ONTOMATO_API_KEY, or ONTOMATO_EXECUTION_CALLBACK.
metadata:
  ontomato.title: Dashboard pages
---

# Dashboard pages

Run `node <this-skill>/scripts/dashboard-pages.mjs <command> [options]`.
API commands use `ONTOMATO_WORKBENCH_URL` before `/api`, the supplied `ONTOMATO_TK`, `ONTOMATO_API_KEY`, or `ONTOMATO_EXECUTION_CALLBACK` (sent as `X-Ontomato-Callback-Credential` with `X-Ontomato-Run-Id`), and optional `ONTOMATO_LANGUAGE`.

| Command | Result |
| --- | --- |
| `link --dashboard-id ID [--card-id ID]` | Run whenever you give a link to a saved dashboard or card. Prints the Markdown page link and selects the card if given. |
| `list` | List the user's dashboards. |
| `read --dashboard-id ID` | Read the dashboard, groups and saved card identities. |
| `card --dashboard-id ID --card-id ID` | Read the saved query, drawing, current columns/rows, MetricView description and truncation. |
| `parameters --dashboard-id ID --card-id ID` | Read parameter fields, current values, readonly keys and revision. |
| `save --operation OP --form work/form.json` | Validate and send the dashboard update directly to the save API. **Use only in headless runs where `present` / `fill_form` / `page_action` are unavailable.** |

## Dashboard links in replies

Dashboard links come from `link`. When `present` is available, open `/dashboards?dashboardId=<id>` beside the conversation immediately in the same round. Paste the command's printed `link` as clickable Markdown with its target intact when referencing it in your reply. You may translate the label. Do not build a dashboard address yourself from an `ONTOMATO_*_URL`, or put the link in a code block.

## Link to a saved dashboard or card

Use the selected IDs if the page supplied them. Otherwise use `list` to find the dashboard and `read` to identify a requested card. Run `link` with the saved IDs.

## Find what the reader selected

A message sent from beside the board ends with a `Selected:` line naming the board and, when the reader chose one, the card: each entry is `name (id)`. Take the ids from that line — the board's for `--dashboard-id`, the card's for `--card-id` — and read them from the API as they are; the names are what the reader sees, not something to look up by. A message that names only the board is about the board, and which card it means has to be asked.

## Explain the selected result

Read the card and its parameters. Use the returned columns, actual rows and explicit value formats; preserve nulls and real zeros. Account for display sorting/limits when explaining the visible chart, separately from MetricView truncation. Describe only the returned scope when truncation is present. Totals, shares, units and business calculations belong to the MetricView, not to a guessed chart calculation. An unavailable result is not zero. Use IDs read from the page or API rather than guessing them from labels.

The `file.name` returned by `card` names the drawing inside the saved card, outside this conversation's workspace. Do not embed, reference or link to that name in your answer, including by adding `outputs/`. To show the chart, link to the saved card or use the chart skill to generate a conversation artifact and reference the path it prints.

## Update a dashboard

Choose the update mode according to whether the conversation has live page tools (`present`, `fill_form`, `page_action`):

### 1. Conversation with a live page (`present` / `fill_form` / `page_action` available)

**Always remote-control the live page. Never call CLI `save` to write directly when live page tools are available.**

#### Card parameters

1. Run `parameters --dashboard-id <dashboardId> --card-id <cardId>` to inspect fields, current values, readonly keys, and revision.
2. Open the dashboard with `present({ target: "/dashboards?dashboardId=<dashboardId>" })`.
3. Open the card parameter dialog with `page_action({ operation: "card.parameters.open", input: { cardId: "<cardId>" } })`.
4. Fill edited parameter values with `fill_form({ member: "card.parameters", values: { ... }, overwriteUnsaved })` so the changes stay visible in the dialog for the reader to review. Do not include readonly keys.
5. Only when the user asks to save, call `page_action({ operation: "card.parameters.save" })` (posts a confirmation prompt in default mode, or saves directly in auto mode). Use `page_action({ operation: "card.parameters.discard" })` to discard unsaved edits.

#### Whole-board edits (board name, group names, card names, chart drawing, layout)

1. Read the dashboard with `read --dashboard-id <dashboardId>` (and `card` when changing a chart drawing).
2. Open the dashboard with `present({ target: "/dashboards?dashboardId=<dashboardId>" })`.
3. Apply an unsaved live preview directly on the open board with `fill_form({ member: "board", values, overwriteUnsaved })`. All referenced `groupId`, `chartId`, and `metricId` must belong to the currently open dashboard.
   - **Flat fields form** (recommended; any combination of fields may be passed together):
     - `name` (or `boardName`): new dashboard name.
     - `groupNames`: `{ "<groupId>": "<newTitle>" }`.
     - `cardNames`: `{ "<cardId>": "<newName>" }` (works for both chart cards and metric cards).
     - `groups`: full `dashboard.layout` groups array matching `[{ id, title, charts: [{ id, name?, layout?, chartFile? }], metrics: [{ id, name?, layout?, ... }] }]` (omit `query` and `source`).
   - **Single operation form** (also accepted):
     - `{ operation: "dashboard.rename", name }`
     - `{ operation: "dashboard.group.rename", groupId, dimensionName }`
     - `{ operation: "dashboard.chart.rename", chartId, resultSetName }`
     - `{ operation: "dashboard.metric.rename", metricId, metricName }`
     - `{ operation: "dashboard.layout", groups }`
4. The unsaved preview renders directly over the board (charts redraw using their current queried rows) with Save and Cancel controls for the user.
5. Only when the user asks to save, call `page_action({ operation: "board.save" })` (posts a confirmation prompt in default mode, or saves directly in auto mode). Use `page_action({ operation: "board.discard" })` to discard the unsaved preview.

### 2. Headless run without a page (background scheduled task or delegated run without `present` / `fill_form` / `page_action`)

Write the request body to `work/form.json` and call `save --operation <OP> --form work/form.json` directly against the dashboard capability API. Both user credentials (`ONTOMATO_TK` / `ONTOMATO_API_KEY`) and default-executor callback credentials (`ONTOMATO_EXECUTION_CALLBACK` + `ONTOMATO_RUN_ID`) are supported.

| Operation | Save body |
| --- | --- |
| `dashboard.layout` | `{id,groups}`. Keep every desired group/card ID and omit query/source from all card patches; chart patches contain id and optional name/layout/chartFile. |
| `dashboard.rename` | `{id,name}` |
| `dashboard.chart.rename` | `{id,chartId,resultSetName}` |
| `dashboard.metric.rename` | `{id,metricId,metricName}` |
| `dashboard.group.rename` | `{id,groupId,dimensionName}` |
| `dashboard.card.parameters` | `{dashboardId,cardId,revision,values}`. Use the parameter form's current revision and only edited text values; preserve readonly fields. |

Here `chartId` and `metricId` are saved chart/numeric-card IDs from `read`, not `query.metricId`; `groupId` is the saved group ID.

## Chart drawing updates

For a drawing change, read the dashboard and the card's current data. Use the `echarts`, `leaflet`, or `admin-choropleth-map` skill to produce the chart file. For an inline preview, reference the generated file as written. For a dashboard `groups` update (`fill_form({ member: "board", values: { groups } })` or headless `dashboard.layout`), copy it into the card's `chartFile: {name,content}` and make the copy storage-ready with empty metric rows and without `ontomato.metric` or `ontomato.dataset`. Keep all other cards and the existing query. Changes to business meaning or data source belong in the MetricView.
