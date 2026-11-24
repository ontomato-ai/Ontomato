# Academic planner frame

The frame owns `term` as deep-link state. Any frame state referenced by a child entry via
`frameState` must also declare `"external": true` in the frame manifest. Each entry passes it into its content panel with
`"inputs": { "term": { "frameState": "term" } }`. The content panels declare `term` as external, so an address such as
`/applications/app-academic-planner/courses?frame.term=2027-spring` works both full-page and beside a conversation.

The host supplies the authorized menu, omitting hidden entries and entries the reader cannot open. Mount each
`ObjectCount` inside a compact wrapper in its rendered menu item's trailing slot. The count is read by the projection. The narrow
menu's text uses the same published total. Reading its output alone never starts a request for an omitted item.

The example expects customer types `Course` and `Enrollment` with term codes searchable by their declared
`query.search` and owner totals in query responses. Use a dedicated term read parameter if your owner offers one,
binding it identically on the list and its matching count. The sample terms are Fall 2026 and Spring 2027.

Check all three panels, then register the two content panels before the frame, whose registration also creates the
application.

```sh
template="$SKILL/references/templates/app-frame"
for panel in courses enrollments frame; do
  node "$SKILL/scripts/ontomato.mjs" panel check "$template/$panel" || exit
done
for panel in courses enrollments frame; do
  node "$SKILL/scripts/ontomato.mjs" panel register "$template/$panel" || exit
done
```
