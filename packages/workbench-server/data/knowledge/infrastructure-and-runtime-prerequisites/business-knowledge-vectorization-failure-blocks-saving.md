# Business Knowledge Vectorization Failure Causes Save Failure

- **Scope**: creating, editing, or approving business knowledge fails while the ontology service is otherwise available.
- **Mechanism source**: `packages/data-engine-core/src/main/java/io/ontomato/dataengine/dao/KnowledgeDao.java`, `service/ai/EmbeddingService.java`, and `service/vector/VectorRetrievalGate.java`.

## Symptoms

- A business knowledge save or approval returns failure, while unrelated reads still work.
- Several knowledge writes fail in the same way; vector search may also be unavailable or not ready.

## Possible Causes

`KnowledgeDao.insertKnowledge` embeds the knowledge text synchronously inside the vector write gate before the database upsert. If embedding fails, the write does not complete. Embedding is supplied by the agent runtime's configured embedding model; candidate causes are missing embedding configuration, runtime unavailability, model call failure, or an invalid embedding response.

Vector rebuild state is a separate boundary: when the domain's vectors are not in the current ready generation, retrieval is refused. That explains search failure or missing knowledge recall, but it is not by itself proof that a save failed for the same reason.

## Verification and Localization

1. Record the exact save action, returned error, time, and whether all knowledge writes fail.
2. Read `ontology` and `agent-runtime` logs around that time with `ops.mjs logs`. Look for runtime embedding configuration or embedding call errors rather than inferring them from the page message.
3. The diagnostic configuration endpoint does not expose model connection parameters. Have an authorized administrator verify the embedding model configuration in the owning settings entry.
4. Distinguish save failure from recall failure: a successful save followed by no retrieval is a vector readiness or search problem, not this entry.

## When to Exclude

- Only one item fails while other knowledge writes succeed — check content, status, or domain ownership first.
- Business knowledge save succeeds but the retriever does not use it — check approval status, vector readiness, and the retrieval round's admitted input instead.
