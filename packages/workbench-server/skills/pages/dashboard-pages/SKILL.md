---
name: dashboard-pages
description: Headless CLI skill for reading, linking, creating, and updating saved dashboards in unattended or background runs without a live page.
compatibility: Requires Node.js 24 or newer. API commands use ONTOMATO_WORKBENCH_URL and ONTOMATO_TK, ONTOMATO_API_KEY, or ONTOMATO_EXECUTION_CALLBACK.
metadata:
  ontomato.title: Dashboard pages (CLI)
---

# Dashboard pages (headless / background CLI)

This skill is for **headless or background runs without a live dashboard page** (for example, scheduled tasks or delegated runs where `present` / `fill_form` / `page_action` are unavailable). When a live `/dashboards` page is open beside a conversation, use the current page placement and the page operator methods instead.

Run `node <this-skill>/scripts/dashboard-pages.mjs <command> [options]`.
API commands use `ONTOMATO_WORKBENCH_URL` before `/api`, the supplied `ONTOMATO_TK`, `ONTOMATO_API_KEY`, or `ONTOMATO_EXECUTION_CALLBACK` (sent as `X-Ontomato-Callback-Credential` with `X-Ontomato-Run-Id`), and optional `ONTOMATO_LANGUAGE`.

| Command | Result |
| --- | --- |
| `link --dashboard-id ID [--card-id ID]` | Run whenever you give a link to a saved dashboard or card. Prints the Markdown page link and selects the card if given. |
| `list` | List the user's dashboards. |
| `read --dashboard-id ID` | Read the dashboard, groups and saved card identities. |
| `card --dashboard-id ID --card-id ID` | Read the saved query, drawing, current columns/rows, MetricView description and truncation. |
| `parameters --dashboard-id ID --card-id ID` | Read parameter fields, current values, readonly keys and revision. |
| `create --name NAME` | Create an empty dashboard and print its `data.id` and `data.name`. Use the returned ID with `read`, `link` and `save`. |
| `save --operation OP --form work/form.json` | Validate and send the dashboard update directly to the save API in headless runs without a live page. |

## Dashboard links in replies

Dashboard links come from `link`. Paste the command's printed `link` as clickable Markdown with its target intact when referencing it in your reply. You may translate the label. Do not build a dashboard address yourself from an `ONTOMATO_*_URL`, or put the link in a code block.

## Link to a saved dashboard or card

Use `list` to find the dashboard and `read` to identify a requested card. Run `link` with the saved IDs.

## Explain a saved card result

Read the card and its parameters. Use the returned columns, actual rows and explicit value formats; preserve nulls and real zeros. Account for display sorting/limits when explaining the visible chart, separately from MetricView truncation. Describe only the returned scope when truncation is present. Totals, shares, units and business calculations belong to the MetricView, not to a guessed chart calculation. An unavailable result is not zero. Use IDs read from the API rather than guessing them from labels.

The `file.name` returned by `card` names the drawing inside the saved card, outside this conversation's workspace. Do not embed, reference or link to that name in your answer, including by adding `outputs/`. To show the chart, link to the saved card or use the chart skill to generate a conversation artifact and reference the path it prints.

## Update a dashboard in headless runs

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

For a drawing change, read the dashboard and the card's current data. Use the `echarts`, `leaflet`, or `admin-choropleth-map` skill to produce the chart file. For a headless `dashboard.layout` update, copy it into the card's `chartFile: {name,content}` and make the copy storage-ready with empty metric rows and without `ontomato.metric` or `ontomato.dataset`. Keep all other cards and the existing query. Changes to business meaning or data source belong in the MetricView.
