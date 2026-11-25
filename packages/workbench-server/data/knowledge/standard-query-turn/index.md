# Business Data Retrieval

This topic covers a business data question from the assistant's retrieval request to an accepted dataset and the reply that cites it.

## How a Question Becomes a Dataset

1. The assistant sends the complete question once using `start-retrieval`. The command starts the ontology-owned data retriever and recalls published metrics concurrently. The assistant can execute a published metric when its definition and parameters fit the question.
2. The data retriever explores the ontology and data, then submits its recipe and source metadata to ontology. Ontology executes the recipe under the applicable user permissions and issues a receipt. Published metric execution uses the same formal dataset delivery boundary.
3. Ontology accepts dataset artifacts that match their execution receipts. The retriever notifies the assistant when its result is ready. The assistant reads the delivered files and uses the dataset's scope, assumptions and limitations in its reply.

Implementation entry points include `agent-skills/ontomato-analyst-assistant/SKILL.md`, `agent-skills/ontomato-analyst/assistant.mjs` and the data engine's `OntologyRetrievalController` and `OntologyRetrievalService`.

## Where to Look

| Symptom | Evidence to compare |
| --- | --- |
| Retrieval did not start or answered a different question | The user's original question, the assistant's tool call and the retrieval run's admitted input. Check the run state and its stop reason or error. |
| A published metric gives an unexpected result | The chosen metric ID and revision, the submitted or preset parameters, and the published definition's scope. |
| Exploration produced rows but the assistant received no dataset | The formal output status and error, its execution receipt, and the accepted dataset IDs for that retrieval round. |
| The reply disagrees with the data | The exact accepted dataset cited by the reply, including its columns, rows, scope and assumptions. |

For DSL execution errors or missing conditions, see [Unregistered class names cause execution NPE or illegal SQL](unregistered-class-name-causes-npe-or-invalid-sql.md). For masked values, see [Mechanism triage for masked placeholders appearing in results](../infrastructure-and-runtime-prerequisites/desensitized-placeholder-mechanism-triage.md).
