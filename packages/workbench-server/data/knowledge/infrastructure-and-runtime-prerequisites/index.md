# Infrastructure and Runtime Prerequisites

This topic describes runtime prerequisites shared by business data retrieval and operations diagnosis. Select only the topic that matches the problem; checking every prerequisite is not a fixed diagnostic flow.

| Goal | File to read |
| --- | --- |
| Which service or dependency is the earliest unavailable one | `services.md` |
| Whether the current effective non-secret configuration explains the failure stage | `configuration.md` |
| Whether page/API authorization or data visibility matches the current identity | `permissions.md` |
| Whether ontology metadata, visible scope, or actual data facts match the query | `metadata.md` |

These files store stable meanings and evidence directions, not current service addresses, keys, namespaces, model parameters, user permissions, or schemas.

## Failure Modes

Read only when the symptom characteristics match; entries only provide candidate directions, and conclusions must return to current evidence.

| Symptom characteristic | Entry |
| --- | --- |
| Results or tables contain `****` placeholders | [Mechanism triage for masked placeholders appearing in results](desensitized-placeholder-mechanism-triage.md) |
| Page/API unavailable or entry missing, pointing to authorization | [Missing permission configuration causes pages inaccessible or data masked](missing-permission-config-blocks-access-or-masks-data.md) |
| Business knowledge fails to save | [Business knowledge vectorization failure causes save failure](business-knowledge-vectorization-failure-blocks-saving.md) |
| Ontology service startup failure, or metadata storage missing after startup | [System index and table initialization failure causes startup or link anomalies](system-index-and-table-init-failure-causes-startup-or-link-errors.md) |
| Ontology class/field/relationship definitions disagree with the query or source mapping | [Schema/metadata inconsistency causes query anomalies](schema-metadata-mismatch-causes-query-errors.md) |
| Query is legal and executes, but the result is empty or inconsistent with the business baseline | [Missing data relations or identifier inconsistency causes empty query results](missing-or-inconsistent-data-relations-cause-empty-results.md) |

For the current retrieval chain and dataset receipt boundary, see [Business Data Retrieval](../standard-query-turn/index.md).
