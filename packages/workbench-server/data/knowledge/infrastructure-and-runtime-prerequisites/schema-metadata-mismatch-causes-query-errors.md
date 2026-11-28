# Schema/Metadata Inconsistency Causes Query Anomalies

- **Scope**: ontology definitions, visible metadata, query artifacts, and adapter/source mapping disagree with one another, causing rejection, execution errors, missing graph links, or unexpected empty results.
- **Implementation source**: `packages/data-engine-core/src/main/java/io/ontomato/dataengine/service/OntologyQueryService.java`, `service/impl/AdminServiceImpl.java`, `util/DBSchemaUtil.java`, and the configured data adapters under `packages/data-adapters/`.

## Symptoms

- Query admission reports an unknown or invisible ontology class, field, or relationship.
- DSL validation rejects the query shape, or the adapter reports that a source table, field, or relationship cannot be resolved.
- The visible ontology overview lacks an expected class or relationship, or a two-step query cannot read its temporary table.

## Possible Causes and Boundaries

- The class, attribute, or relationship is absent or disabled in the stored JSONRule, or a relationship endpoint does not exactly match a defined class.
- The object is present in raw metadata but hidden from this run by data permission or class scope.
- Multi-source routing or adapter mapping points a class or relationship at the wrong source, or the source-side name no longer matches the ontology mapping.
- Leading-slash spelling is normalized to the schema's own spelling and is not by itself a mismatch. Other case, whitespace, or spelling differences are not normalized.
- A temporary table is known only after an earlier step in the same DSL saves it. Reading any other temporary or unregistered name is not a valid ontology class reference.

## Verification and Localization

1. Take the actual recipe, query package, or DSL and its `sourceAnalysis` from the failed round's artifact; do not reconstruct the query from the reply text.
2. Read current raw metadata with `ops.mjs metadata '{"format":"json"}'` and compare canonical class, attribute, relationship, endpoint, and enabled flags exactly.
3. Separate visible-scope absence from raw-metadata absence before changing anything. For adapter errors, use a narrow read-only query to verify the source-side resolution.
4. After the owning metadata or mapping is corrected, retest the original question rather than only the edited fragment.

## When to Exclude

- Metadata and query shape are consistent and execution succeeds, but the result is empty or wrong — continue with [Missing data relations or identifier inconsistency causes empty query results](missing-or-inconsistent-data-relations-cause-empty-results.md).
