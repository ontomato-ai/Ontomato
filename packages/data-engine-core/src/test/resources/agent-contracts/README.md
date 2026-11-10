# Recoverable write contract sample

Use only a disposable PostgreSQL test schema. `AgentWritePostgresContractTest` owns a unique schema and drops it in `finally`; it never connects to a business schema. CI supplies the database and fails if it is unavailable.

Schema: `contract_person(id varchar primary key, name varchar, age int)`.

- `sample.json` → `objDatas[0].rows`: three stable keys, `contract-person-1` through `contract-person-3`; ages 21, 22, 23. Insert these before exercising the sample.
- `actions.json`: importable published WRITE Action and embedded Python v2 Function. Explanation hash matches `update.py`; no model is needed to run it. Set the domain to your disposable test domain on import. Zip this file as `actions.json` for the import API.
- Execute with every parameter supplied: `{"id":"contract-person-1","age":99}`. Expect age 99 only on the first object; count stays three.
- Execute with `{"id":"contract-person-1"}`. Expect `Missing parameter: age`, no mutation.
- Explicit `null` is a supplied value; `""` and `0` retain their values. Whether a business column accepts null belongs to that business schema.
- `invalid-where.json`: historical array-shaped condition. Both update and delete must fail with a `where` error, leaving all three original rows intact.
- `valid-where.json`: delete only `contract-person-1`; expect count two. Restore it by inserting the first object from `sample.json` → `objDatas[0].rows`; expect count three and original age 21.

The CI test imports the valid asset through ActionService with real Function/Action PostgreSQL DAOs, refuses a published import missing its hash even with allowMissingExplanation=true, then runs the stored program through the actual Python helper, an HTTP endpoint, WriteFunctionOperationController/Service and PostgreAdapter. Identity, adapter selection and embeddings are test doubles. It does not claim to test the deployed agent-runtime code process or model generation.

Batch B uses the generation sample envelope (`objDatas`, `relDatas`, `vectorDatas`). `relDatas` links person 1 to group 1; vector entries reference actual bytes in `files/`. Install ontology metadata before loading. Without an embedding service, run the object/relationship subset and report vector/file ingestion as not executed. Never replace the embedding boundary with a mock and call it end-to-end proof.
