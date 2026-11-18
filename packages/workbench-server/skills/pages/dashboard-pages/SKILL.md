---
name: dashboard-pages
description: Take the reader to a saved dashboard or card. Always run link when asked for its page link. Explain current MetricView results and draft dashboard changes.
compatibility: Requires Node.js 24 or newer. API commands use ONTOMATO_WORKBENCH_URL and the current user's ONTOMATO_TK or ONTOMATO_API_KEY.
metadata:
  ontomato.title: Dashboard pages
---

# Dashboard pages

Run `node <this-skill>/scripts/dashboard-pages.mjs <command> [options]`.
API commands use `ONTOMATO_WORKBENCH_URL` before `/api`, the supplied `ONTOMATO_TK` or `ONTOMATO_API_KEY`, and optional `ONTOMATO_LANGUAGE`. Draft links use the supplied `ONTOMATO_SESSION_ID` and `ONTOMATO_RUN_ID`.

| Command | Result |
| --- | --- |
| `link --dashboard-id ID [--card-id ID]` | Run whenever you give a link to a saved dashboard or card. Prints the Markdown page link and selects the card if given. |
| `list` | List the user's dashboards. |
| `read --dashboard-id ID` | Read the dashboard, groups and saved card identities. |
| `card --dashboard-id ID --card-id ID` | Read the saved query, drawing, current columns/rows, MetricView description and truncation. |
| `parameters --dashboard-id ID --card-id ID` | Read parameter fields, current values, readonly keys and revision. |
| `draft --operation OP --form work/form.json --out outputs/drafts/name.page-draft.json` | Validate the save body, write a PageDraft and print its dashboard link. |
| `save --operation OP --form work/form.json` | Send the same validated body to the original save API; available for direct use outside the platform. |

## Dashboard links in replies

Dashboard links come from these commands. Run `link` to open a saved dashboard or card and `draft` to show proposed edits. Paste the command's printed `link` as clickable Markdown with its target intact. You may translate the label. Do not build a dashboard address yourself, including from an `ONTOMATO_*_URL`, link to the `.page-draft.json` file, or put the link in a code block.

## Link to a saved dashboard or card

Use the selected IDs if the page supplied them. Otherwise use `list` to find the dashboard and `read` to identify a requested card. Run `link` with the saved IDs even if an earlier reply included a draft.

## Find what the reader selected

A message sent from beside the board ends with a `Selected:` line naming the board and, when the reader chose one, the card: each entry is `name (id)`. Take the ids from that line — the board's for `--dashboard-id`, the card's for `--card-id` — and read them from the API as they are; the names are what the reader sees, not something to look up by. A message that names only the board is about the board, and which card it means has to be asked.

## Explain the selected result

Read the card and its parameters. Use the returned columns, actual rows and explicit value formats; preserve nulls and real zeros. Account for display sorting/limits when explaining the visible chart, separately from MetricView truncation. Describe only the returned scope when truncation is present. Totals, shares, units and business calculations belong to the MetricView, not to a guessed chart calculation. An unavailable result is not zero. Use IDs read from the page or API rather than guessing them from labels.

The `file.name` returned by `card` names the drawing inside the saved card, outside this conversation's workspace. Do not embed, reference or link to that name in your answer, including by adding `outputs/`. To show the chart, link to the saved card or use the chart skill to generate a conversation artifact and reference the path it prints.

## Prepare a page edit

A card's title is its `name`. To change the title, set that card's `name` in the draft. Put the changes from one request in one draft. Use `dashboard.layout` to change a card's name, drawing and layout together. Put the `link` printed by `draft` in the reply so the reader can review all changes and save them on the page.

| Operation | Save body |
| --- | --- |
| `dashboard.layout` | `{id,groups}`. Keep every desired group/card ID and omit query/source from all card patches; chart patches contain id and optional name/layout/chartFile. |
| `dashboard.rename` | `{id,name}` |
| `dashboard.chart.rename` | `{id,chartId,resultSetName}` |
| `dashboard.metric.rename` | `{id,metricId,metricName}` |
| `dashboard.group.rename` | `{id,groupId,dimensionName}` |
| `dashboard.card.parameters` | `{dashboardId,cardId,revision,values}`. Use the parameter form's current revision and only edited text values; preserve readonly fields. |

Here chartId and metricId are saved chart/numeric-card IDs from read, not query.metricId; groupId is the saved group ID.

For a drawing change, read the dashboard and the card's current data. Use the echarts, leaflet or admin-choropleth-map skill to produce the chart file. For an inline preview, reference the generated file as written. For the `dashboard.layout` form, copy it into the card's `chartFile: {name,content}` and make the copy storage-ready with empty metric rows and without `ontomato.metric` or `ontomato.dataset`. Keep all other cards and the existing query. Changes to business meaning or data source belong in the MetricView.
