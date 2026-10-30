# Query source subgraph

`DatasetPayload.sourceAnalysis` is one `QuerySubgraph`, exported from
`@ontomato/contracts/query-subgraph`. Java owns the accepted analysis, bound to the
dataset execution receipt and exact recipe. The same graph supplies permission
dependencies and the renderer; there is no second display graph or permission verdict from an agent.

The contract is introduced before the producer cutover. New datasets will always
carry it; existing stored datasets may omit it and must not be reverse-engineered
by the UI. Initial class scope remains `classNames`, unrelated to this result graph.

## Rendering and identity

- `queries` identifies actual DSL occurrences, including separate Python queries.
- `nodes` contains class occurrences (query, class and variable), extracted fields,
  operations and final output columns. Repeated classes/self joins have different
  IDs. Node/edge/filter/query IDs are unique within the graph, not ontology IDs.
- `contains` edges attach each field to exactly one class occurrence.
- `relation` edges carry ontology relationship name/type, label, direction and hop
  bounds. Null maximum means unbounded; direction is relative to source/target.
- `dependency` edges connect fields/operations to operations/outputs. `value` is
  a value dependency; `group`, `filter`, `join` identify other contributions.
  Grouping and aggregation are explicit operation nodes, not inferred by the UI.
- `filters` supplies ready-to-display labels/expressions and target IDs. It includes
  predicates even when their fields are not final output values.
- Output node `key` matches a dataset column key; each output has exactly one value
  predecessor. A multi-source output points to an operation with multiple inputs.
- Cross-query Python operations have `queryId: null`. Constants have no inputs;
  `unknown` denotes unresolved lineage and is not permission evidence.

The frontend lays out and renders these nodes, edges and labels directly. It does
not parse Python/DSL, infer relationships, compute hop counts, or reconstruct
output lineage. It may group graph elements visually but cannot change meaning.
No raw rows, credentials or unrestricted diagnostic output belong in this object.

## Validation boundary

The Zod structural shape generates `src/query-subgraph.schema.json` using
`pnpm --filter @ontomato/contracts generate:query-subgraph`. Java packages that
same generated schema and validates it using existing Fastjson2. Reference,
ownership, hop-range, unique-output and dependency-cycle checks run in both
`querySubgraphIssues` and `QuerySubgraphContract`; shared fixtures keep them aligned.
Java additionally checks ontology references, execution provenance and user permissions.

The preparation/Function cutover will replace single-source `outKeyRefs` as the
live permission input. Legacy stored declarations are handled at their read
boundary, never as a second set of editable graph facts.

`examples/query-subgraphs.json` contains `singleDsl` (relation, filter, grouping,
aggregation) and `pythonMerge` (two queries, join and derived output). Both are
invented examples; labels are already prepared for display.
