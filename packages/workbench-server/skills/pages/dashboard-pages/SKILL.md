---
name: dashboard-pages
description: Read dashboard cards and their current MetricView results, explain charts with their parameters and data limits, and prepare dashboard page edits.
compatibility: Requires Node.js 24 or newer. API commands use ONTOMATO_WORKBENCH_URL and the current user's ONTOMATO_TK or ONTOMATO_API_KEY.
metadata:
  ontomato.title: Dashboard pages
---

# Dashboard pages

Use this skill for a selected dashboard or card: explain its current result, change its drawing or name, or edit its parameters.
Run `node <this-skill>/scripts/dashboard-pages.mjs <command> [options]`.
API commands use `ONTOMATO_WORKBENCH_URL` before `/api`, the supplied `ONTOMATO_TK` or `ONTOMATO_API_KEY`, and optional `ONTOMATO_LANGUAGE`. Draft links use the supplied `ONTOMATO_SESSION_ID` and `ONTOMATO_RUN_ID`.

| Command | Result |
| --- | --- |
| `list` | List the user's dashboards. |
| `read --dashboard-id ID` | Read the dashboard, groups and saved card identities. |
| `card --dashboard-id ID --card-id ID` | Read the saved query, drawing, current columns/rows, MetricView description and truncation. |
| `parameters --dashboard-id ID --card-id ID` | Read parameter fields, current values, readonly keys and revision. |
| `draft --operation OP --form work/form.json --out outputs/drafts/name.page-draft.json` | Validate the save body, write a PageDraft and print its dashboard link. |
| `save --operation OP --form work/form.json` | Send the same validated body to the original save API; available for direct use outside the platform. |

## Explain the selected result

Read the card and its parameters. Use the returned columns, actual rows and explicit value formats; preserve nulls and real zeros. Account for display sorting/limits when explaining the visible chart, separately from MetricView truncation. Describe only the returned scope when truncation is present. Totals, shares, units and business calculations belong to the MetricView, not to a guessed chart calculation. An unavailable result is not zero. Use IDs read from the page or API rather than guessing them from labels.

## Prepare a page edit

Each draft addresses one existing save action. The page receives it, marks changes and provides its save action. Its link carries only the draft session/run/path; the dashboard ID stays in target and form.

Return the command's `link` as a clickable Markdown link, keeping its target unchanged. You may translate its label. Do not put the page URL in a code block, link to the `.page-draft.json` file, or build a URL from an `ONTOMATO_*_URL`: that file opens a JSON preview; the printed page link opens the dashboard with the draft.

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

For a drawing change, read the whole dashboard and the card's current data. Use the echarts, leaflet or admin-choropleth-map skill to produce the new chart file. Put its storage-ready `{name,content}` into that card's `chartFile` in a `dashboard.layout` form: empty metric source and no ontomato.metric/dataset. Keep all other cards and the existing query. Changing business meaning or data source requires the appropriate MetricView, not a layout patch. Parameter parsing and field errors remain the original API's responsibility.
