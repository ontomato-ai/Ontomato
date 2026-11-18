---
name: dashboard-pages
description: Open saved dashboards and cards, explain their current MetricView results, and prepare dashboard page edits.
compatibility: Requires Node.js 24 or newer. API commands use ONTOMATO_WORKBENCH_URL and the current user's ONTOMATO_TK or ONTOMATO_API_KEY.
metadata:
  ontomato.title: Dashboard pages
---

# Dashboard pages

Use this skill to open a saved dashboard or card, explain its current result, or draft changes to its drawing, name or parameters.
Run `node <this-skill>/scripts/dashboard-pages.mjs <command> [options]`.
API commands use `ONTOMATO_WORKBENCH_URL` before `/api`, the supplied `ONTOMATO_TK` or `ONTOMATO_API_KEY`, and optional `ONTOMATO_LANGUAGE`. Draft links use the supplied `ONTOMATO_SESSION_ID` and `ONTOMATO_RUN_ID`.

| Command | Result |
| --- | --- |
| `list` | List the user's dashboards. |
| `read --dashboard-id ID` | Read the dashboard, groups and saved card identities. |
| `link --dashboard-id ID [--card-id ID]` | Print the Markdown link to the saved dashboard, optionally selecting a card. |
| `card --dashboard-id ID --card-id ID` | Read the saved query, drawing, current columns/rows, MetricView description and truncation. |
| `parameters --dashboard-id ID --card-id ID` | Read parameter fields, current values, readonly keys and revision. |
| `draft --operation OP --form work/form.json --out outputs/drafts/name.page-draft.json` | Validate the save body, write a PageDraft and print its dashboard link. |
| `save --operation OP --form work/form.json` | Send the same validated body to the original save API; available for direct use outside the platform. |

## Find what the reader selected

A message sent from beside the board ends with a `Selected:` line naming the board and, when the reader chose one, the card: each entry is `name (id)`. Take the ids from that line — the board's for `--dashboard-id`, the card's for `--card-id` — and read them from the API as they are; the names are what the reader sees, not something to look up by. A message that names only the board is about the board, and which card it means has to be asked.

## Explain the selected result

Read the card and its parameters. Use the returned columns, actual rows and explicit value formats; preserve nulls and real zeros. Account for display sorting/limits when explaining the visible chart, separately from MetricView truncation. Describe only the returned scope when truncation is present. Totals, shares, units and business calculations belong to the MetricView, not to a guessed chart calculation. An unavailable result is not zero. Use IDs read from the page or API rather than guessing them from labels.

The `file.name` returned by `card` names the drawing inside the saved card, outside this conversation's workspace. Do not embed, reference or link to that name in your answer, including by adding `outputs/`. To show the chart, link to the saved card or use the chart skill to generate a conversation artifact and reference the path it prints.

## Link to the dashboard

When asked to take the reader to a saved dashboard or card, find its ID with `list` or `read` if needed, then use `link`, even if an earlier reply included a draft. Use `draft` to hand off proposed edits.

Paste the `link` from `link` or `draft` as clickable Markdown with its target intact. You may translate the label. Do not put it in a code block, link to the `.page-draft.json` file, or build the address from an `ONTOMATO_*_URL`. The printed link opens the page beside the conversation.

## Prepare a page edit

Each draft addresses one existing save action. The page receives it, marks changes and provides its save action. Its link carries only the draft session/run/path; the dashboard ID stays in target and form.

| Operation | Save body |
| --- | --- |
| `dashboard.layout` | `{id,groups}`. Keep every desired group/card ID and omit query/source from all card patches; chart patches contain id and optional name/layout/chartFile. |
| `dashboard.rename` | `{id,name}` |
| `dashboard.chart.rename` | `{id,chartId,resultSetName}` |
| `dashboard.metric.rename` | `{id,metricId,metricName}` |
| `dashboard.group.rename` | `{id,groupId,dimensionName}` |
| `dashboard.card.parameters` | `{dashboardId,cardId,revision,values}`. Use the parameter form's current revision and only edited text values; preserve readonly fields. |

Here chartId and metricId are saved chart/numeric-card IDs from read, not query.metricId; groupId is the saved group ID.

For example, write `{"id":"dashboard-id","name":"Quarterly sales"}` to `work/form.json`, then run `draft --operation dashboard.rename --form work/form.json --out outputs/drafts/rename.page-draft.json` and link to the printed URL.

For a drawing change, read the dashboard and the card's current data. Use the echarts, leaflet or admin-choropleth-map skill to produce the chart file. For an inline preview, reference the generated file as written. For the `dashboard.layout` form, copy it into the card's `chartFile: {name,content}` and make the copy storage-ready with empty metric rows and without `ontomato.metric` or `ontomato.dataset`. Keep all other cards and the existing query. Changes to business meaning or data source belong in the MetricView.
