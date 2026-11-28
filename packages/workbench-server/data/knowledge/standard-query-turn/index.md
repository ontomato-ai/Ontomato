# Business Data Retrieval

This topic covers a business data question from the assistant's retrieval request to an accepted dataset and the reply that cites it.

## How a Question Becomes a Dataset

1. The assistant starts the ontology-owned data retriever once through the native `agent` channel and, in the same turn, recalls published metrics with `ontology-query`'s `recall-metrics`. A published metric is used only when its definition and parameters answer the question over the same population.
2. The data retriever explores the ontology, business knowledge, and data, then submits a formal output recipe. Current recipes can reference a query package, a metric, direct DSL, or Python protocol output. The ontology service executes the recipe under the applicable user permissions and records an execution receipt.
3. Ontology accepts dataset artifacts only when their bytes match the admitted output digest and receipt. When retrieval settles, the runtime maps accepted datasets read-only into the assistant session under `outputs/agents/<taskId>/` and wakes the assistant with the retriever's final reply. The assistant answers from that reply and displays the datasets it relies on.

Implementation entry points include `agent-skills/ontomato-analyst-assistant/SKILL.md`, `agent-skills/ontology-query/scripts/ontomato.mjs`, `packages/data-engine-core/src/main/java/io/ontomato/dataengine/service/agent/OntologyRetrievalService.java`, and `service/QueryOutputService.java`.

## Where to Look

| Symptom | Evidence to compare |
| --- | --- |
| Retrieval did not start or answered a different question | The user's original question, the assistant's native delegation input, the retrieval round's admitted input, run state, stop reason, and admission error. |
| A published metric gives an unexpected result | The metric ID and revision, binding or explicit parameters, published query package or program definition, execution input digest, and population scope. |
| Exploration produced rows but the assistant received no dataset | Formal output status and error, execution receipt, output digest, accepted dataset artifact IDs, and the runtime mapping under `outputs/agents/<taskId>/`. |
| The reply disagrees with the data | The exact accepted dataset cited by the reply: columns, rows, source analysis, assumptions, truncation, scope, and receipt. |
| Query execution or DSL shape is suspected | The recipe or query package in the artifact, visible metadata, permission scope, adapter error, and a narrow read-only verification query. |

Use the operations evidence entry points rather than reconstructing the chain from page text: resolve the target, read the workbench and ontology runtime runs and artifacts, then query service logs in the established windows. For masked values, see [Mechanism triage for masked placeholders appearing in results](../infrastructure-and-runtime-prerequisites/desensitized-placeholder-mechanism-triage.md).
