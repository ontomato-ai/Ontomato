---
name: data-retrieval
description: Deliver a query logic package as a dataset by rerunning it through Ontomato under the user's authorization.
compatibility: Requires Node.js 18 or newer and an authorized Ontomato ontology service credential.
---

# Data retrieval

Each result table is delivered as a dataset: the host reruns your query under the user's permissions and writes the file. Read [delivery inputs](references/dataset.md) before the first delivery; read [query packages](references/query-package.md) only when you need Python.

```sh
node <this-skill>/scripts/dataset.mjs deliver @work/q.json --meta @work/delivery.json [--out outputs/name.dataset.json]
```

In a delegated ontology retrieval session, include `--active` with the delivery options. The platform owns the active retrieval lifecycle.

For a count through a direct relationship to one already resolved object, use `related-count @work/spec.json --meta @work/delivery.json` with the same script. It checks the current schema and delivers the two-step DSL in one call. The spec takes `objectClass` (the class whose objects are counted), `objectKey` (its primary key), `relatedClass` (the class that is filtered), `relatedKey` (its primary key), `value` (the resolved primary-key value), and `relationship` (the declared relationship, in either direction). Optional `groupField` adds a breakdown by an attribute of `objectClass`. Output keys are `headcount` and, when grouped, `category`. Use `deliver` with your own DSL for additional filters or other query shapes.

- Run it from the workspace root. Paths inside a package are relative to the manifest's directory.
- Deliver when the logic is ready. `preview` takes the same arguments and is only for a real doubt.
- One table per delivery; several tables mean several deliveries.
- Reference the returned file; never edit its rows or receipt.

## Minimize query round trips

The host may supply a frozen `queryIntent`. Preserve all its conditions and requested outputs;
it is the main assistant's extracted interpretation, not authorization or a verified business rule.
Do not resubmit or edit it in delivery metadata. Coverage is diagnostic only and does not reject
execution based on a structural mismatch. Unmapped conditions, Python and multi-step queries remain explicitly unverified.
Read the returned dataset's `queryCoverage` and report unresolved scope before any partial figures.

For the direct related-count path, reuse an already fetched schema with `--schema @work/schema.json`.
When the related primary key is not yet known, omit `value` and supply `matchField` and `matchValue`
for an exact entity name. The same command resolves one visible primary key, compiles the count
and delivers it. Zero or multiple entity matches and incomplete lookup results fail explicitly;
never choose the first match. This avoids writing a separate entity-resolution DSL.
Optional `filters: [{field,operator,value}]` applies conjunctive predicates on the counted class,
using enabled fields and the same operators as query intent. This compiles without another model
request. Conditions on other classes, disjunctions and custom computations require custom DSL.
This avoids another schema round trip; Java still authorizes and validates formal execution against
current metadata. Use this path only for the supported relationship count, not for an intent whose
additional predicates the helper cannot express. The delivery command returns rows for tables of
at most ten records, avoiding another model/tool round solely to open a small result file.

For a direct count with a required date condition, first verify the date field in the schema. If
completeness is unknown, pass that field as `coverageField` to `related-count` and reuse the schema.
Keep the date predicate out of `filters` for this diagnostic, preserving all other scope filters.
Deliver it as a labelled coverage summary (`scope_count`, `known_count`), with the requested date
predicate recorded as not applied. Both counts use the same primary-key-deduplicated scope. If the
summary is complete and the scope is nonempty with `known_count: 0`, stop and explain that the
condition is unverifiable. Do not deliver individual records for a count question. If some dates
are known, use `related-count` with the original date predicate in `filters` and no `coverageField`,
and disclose any unknown dates. Never infer completeness from a truncated result.

Before querying, keep a short working checklist of the question's required filters, relationship
path, count identity and requested tables. Fetch all related classes in one schema call and the
DSL reference alongside it. Probe only a specific unresolved item on that checklist. Reuse every
verified field, entity and value; do not restart discovery after a syntax error or a message that
only repeats an existing assumption.

For independent probes, write a JSON array and run
`node <this-skill>/scripts/probe.mjs @work/probes.json`. Each item has a unique `id`,
an `operation` (`schema`, `dsl-reference`, `distinct-values`, or `execute-dsl`) and the existing
endpoint's `input` object. The command runs up to four requests concurrently, keeps the original
result and completeness markers under each id, and reports failures separately. Dependent
queries belong in later batches. Use one schema item with all relevant `classNames` rather than
one item per class. For example:

```json
[
  {"id":"schema","operation":"schema","input":{"classNames":["/object","/related-object"]}},
  {"id":"syntax","operation":"dsl-reference","input":{"classNames":["/object","/related-object"]}}
]
```

For a later batch that probes text values, pass `--schema @work/schema.json` with the saved
schema response. The script checks the class, field and type before sending `distinct-values`.
That operation only supports `varchar` and `text`; use a scoped DSL query for dates, numbers and
other types. A rejected probe is a query error, never a zero-match result.

Verify required filters early with a scoped query that includes the relevant fields together.
A missing field or null value is unknown, never evidence that the record meets the filter.
A limited sample cannot prove all scoped values are null. Once complete scoped evidence shows
a required condition cannot be verified, report the limitation and stop speculative searches
for substitutes. Do not silently relax the user's condition. Continue unrelated work or deliver
a clearly labelled partial result only when useful; never claim that result satisfies the original
scope. Keep unknown coverage distinct from a verified zero-match result.

Plan related detail and aggregate outputs together. Reuse the same filters and unique object
identity in their query definitions, but deliver each requested table separately. Do not sum
over a capped detail result to claim a complete count. Once the required outputs and their
coverage are verified, deliver and end; do not generate alternative variants without a concrete
error or changed user decision.

For a category share and its breakdown of one population, use one grouped delivery when the
category is a single-valued field on the counted class and the complete breakdown contains all
the evidence requested. With a direct relationship, pass `groupField` and the population's
`filters` to `related-count`. Keep the null group. The assistant can derive the total, target
category count and share from the complete, mutually exclusive groups. Do not run a separate
numerator or denominator query. If the table is truncated, the categories overlap, or an
independent summary table is explicitly requested, this shortcut does not apply.

Outside the product, set ONTOMATO_ONTOLOGY_URL and ONTOMATO_TK (or ONTOMATO_API_KEY), optionally ONTOMATO_LANGUAGE and ONTOMATO_OUTPUT_DIR, run `begin @work/question.json` with `{"question":"..."}` before delivering and `close` when done. In a delegated ontology session, use `--active` to deliver through the platform bridge. Keep work/.retrieval-*.json and work/.dataset-*.json for external retrieval and output reconciliation.
