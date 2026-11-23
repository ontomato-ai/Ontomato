# Ontology graph workbench (`ObjectGraph`)

Reference template for a **canvas-centered workbench** combining header statistics, a searchable resource sidebar, an
interactive graph canvas, and a right-hand path-finder & detail inspector — composed 100% from official projections:

- **Header stats:** `ObjectCount` projections (`objectStats`, `attributeStats`, `relationStats`) showing live counts.
- **Left sidebar:** `search` & `filter` (`deepLink: true`) driving `ObjectList` projections (`objectList`,
  `relationList`) synchronized with canvas highlighting (`highlightedNodes`, `highlightedEdges`).
- **Center canvas:** `ObjectGraph` (`nodes` + `edges`) with zoom, fit, relayout, PNG download, per-user saved node
  positions (`positions`, `personal: true`), and directed shortest-path highlighting (`pathFrom`, `pathTo`) over the
  visible graph.
- **Right inspector:** `ReferencePicker` path endpoints + `ObjectHeader`, `TypedValue`, `ObjectRefCard`, and child
  `ObjectList` projections for attributes and relations, responding cleanly across container widths via `@container`.

## Check and register

```sh
base="$SKILL/references/templates/ontology-graph-workbench"
node "$SKILL/scripts/ontomato.mjs" panel check "$base"
node "$SKILL/scripts/ontomato.mjs" panel register "$base"
```
