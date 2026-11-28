# Metadata

- **Scope**: the ontology JSONRule, the permission- and scope-filtered metadata visible to a run, and the actual schema and data facts behind the configured adapters.
- **Implementation source**: `packages/data-engine-core/src/main/java/io/ontomato/dataengine/service/impl/AdminServiceImpl.java`, `service/OntologyQueryService.java`, `util/DBSchemaUtil.java`, and the evidence metadata endpoint in `packages/workbench-server/src/api/routes/ops-diagnosis.ts`.

## Role and Dependencies

- The stored JSONRule carries `datasetdesc`, `classDef`, and `relationship_rule`. Class definitions carry the canonical class name, enabled attributes, types, primary-key marker, and descriptions; relationships carry their endpoint classes. Management projections may use pretty names such as `classDefs` and `relationshipDefs`; do not confuse those projection names with storage keys.
- The retrieval chain has no separate planning agent. The assistant receives an ontology overview, starts the data retriever, and the retriever uses the admitted question, business knowledge, class scope, visible overview, schema, relationships, and DSL reference.
- Metadata visible to a caller is filtered by data permission and by the run's class scope. A class missing from visible metadata can be absent from the ontology, outside the run scope, or not readable by the execution identity; these are different causes.
- The query boundary normalizes only the leading-slash spelling of a class name to the schema's own spelling. Other unknown names are not rewritten. A temporary table is valid only when an earlier step in the same DSL saves it.
- The ontology service does not keep a second authoritative copy of every external source schema. Adapter mapping and source-side naming are verified through the configured adapter and read-only query evidence.

## On-Site Evidence

- `ops.mjs metadata '{"format":"json"}'` reads the raw ontology schema; `format=markdown` reads the generated dataset-description Markdown. Both are current reads, not facts frozen at the original failed run.
- Prefer the failed round's runtime artifacts for what the retriever actually saw and submitted: admitted input, scope, recipe or query package, source analysis, output receipt, and final reply. Use current metadata only to test whether the same cause still exists.
- Use `ops.mjs query` only for a narrow read-only hypothesis. Its rows are a caller-permissioned preview, not proof of the full population.

## Deviation Propagation and Verification

- Metadata deviation can appear as a visible-scope absence, an ontology rejection, an adapter source error, or a legal but empty result. Identify the first layer that diverges instead of rewriting the final symptom into “metadata problem”.
- After disposition, reread metadata and retest the original question. Confirm the retriever's input, formal output, and user-visible answer consistently, not only one intermediary artifact.
