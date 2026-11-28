# Mechanism Triage for Masked Placeholders Appearing in Results

- **Scope**: a dataset, table, or reply contains `****`, and the source of that placeholder needs to be determined. Page/menu authorization failure is outside this entry.
- **Mechanism source**: `packages/data-engine-core/src/main/java/io/ontomato/dataengine/service/QueryPermissions.java` (`response` and `mask`).

## Facts and Candidate Causes

In the current ontology query path, `****` is backend-produced data masking. After execution, `QueryPermissions.response` uses the output source analysis to decide whether each output column is allowed. A denied output is replaced with `****`; nested vector or bucket values can be partially masked when only some children are unauthorized.

Two different situations must not be merged:

1. **`****` is inside the accepted dataset or query response.** This is a data-permission fact of that execution, unless the artifact itself is not the accepted source.
2. **The reply only says that data is restricted, but the accepted dataset does not contain masked cells.** The wording is an answer-generation claim, not evidence that masking happened; investigate the actual retrieval or execution result first.

## Distinguishing Characteristics

- There is no dedicated log line for normal masking. “No `****` appears in logs” is not evidence either way.
- Real column permission is stable for the same identity, class, field, and use. Different results under different identities can be evidence only when the query and data scope are otherwise the same.
- Row permission removes rows rather than writing `****` into cells.

## Verification and Localization

1. Open the accepted dataset or formal output artifact, not only the rendered reply. Confirm whether `****` is in `rows` and which output key it affects.
2. Compare that output key with `sourceAnalysis`: class, attribute, and whether the use is detail, grouping, or aggregation.
3. Have an authorized administrator confirm the current field permission, or compare the same narrow query under known identities without widening anyone's access.
4. If the dataset itself failed or is absent, investigate retrieval/execution failure first; do not treat a generated “permission restriction” explanation as a conclusion.

## When to Exclude

- The whole page or API is denied — see [Missing permission configuration causes pages inaccessible or data masked](missing-permission-config-blocks-access-or-masks-data.md).
- Rows are missing rather than cells masked — investigate row permission, filters, or data facts instead.
