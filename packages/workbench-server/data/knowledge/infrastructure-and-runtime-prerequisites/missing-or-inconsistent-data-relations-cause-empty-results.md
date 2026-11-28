# Missing Data Relations or Identifier Inconsistency Causes Empty Query Results

- **Scope**: metadata and query shape show no obvious problem, execution succeeds, but the result is empty or differs from the business baseline. This is data-fact and relationship-instance investigation.
- **Implementation source**: the configured adapter execution path in `packages/data-engine-core/src/main/java/io/ontomato/dataengine/service/impl/DslServiceImpl.java` and the adapters under `packages/data-adapters/`.

## Symptoms

- The formal output or read-only preview succeeds with zero rows, fewer rows than expected, or a join result that misses expected objects.
- Re-executing the same narrow query through authorized evidence still returns the same result.

## Possible Causes

- Filter values differ from the stored business values in case, whitespace, coded value, unit, or time representation.
- The objects exist but the relationship instances needed by the query were never created, were attached to different identifiers, or do not satisfy the business rule the user meant.
- Multi-source or adapter relationship mapping points to the wrong source or key mapping.
- Several individually satisfiable conditions are combined, but no single object or path satisfies all of them at once.

Do not assume one universal physical storage shape for relationships. The representation is adapter- and source-specific; use ontology metadata plus read-only query evidence rather than hard-coded table or graph idioms.

## Verification and Localization

1. Reduce the accepted query to the smallest read-only checks: base object exists, each filter value exists, one relationship hop connects, then the full combination.
2. Compare the values used in the query artifact with actual stored values under the same caller permissions. Preserve truncation state; a preview cannot prove a full population count.
3. When each single hop has rows but the combination is empty, verify whether the business baseline truly requires one object/path to satisfy all hops. If that baseline is missing, ask the user.
4. Data repair belongs to the data owner and requires authorization. This entry only localizes the first missing fact.

## When to Exclude

- The query is rejected, the adapter cannot resolve a name, or visible metadata is incomplete — first use [Schema/metadata inconsistency causes query anomalies](schema-metadata-mismatch-causes-query-errors.md) or the permission entries.
