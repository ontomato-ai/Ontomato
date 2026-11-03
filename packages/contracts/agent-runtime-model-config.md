# Domain model settings and direct selection

Runtime owns one `model_settings(domain_id, settings)` document per platform domain.
All authenticated hosts in that domain share it. Model `name` is the stable configuration
ID; `displayName` is editable. Provider parameters belong exclusively to each model.
Executable schemas: `src/model-settings.ts`, `src/runtime-model-test.ts`.

```ts
type ModelSelection = { modelId: string | null };
type ModelSettings = { models: ModelEntry[]; defaultModelId: string | null };
type ModelOptions = { models: { name: string; displayName: string }[]; defaultModelId: string | null };
```

Run definitions replace `modelRole` with optional nullable `modelId`. Null or omission
selects the domain default. An explicit missing ID never falls back: unavailable selection
or default returns 422 `MODEL_NOT_CONFIGURED` before admission. A run and its compaction
retain their resolved model; changing settings affects subsequent runs. An admitted retry
retains the original run without resolving models again.

| Runtime route | Input | Output |
| --- | --- | --- |
| GET `/v1/models/settings` | — | `ModelSettings` with masked API keys |
| PUT `/v1/models/settings` | complete `ModelSettings` | normalized `ModelSettings` |
| GET `/v1/models/options` | — | `ModelOptions`, no connection parameters or secrets |
| POST `/v1/models/test` | `{model:ModelEntry,prompt?:string}` | `{content:string}` |

All routes require host Bearer credentials, verified `X-Domain-Id` and correlation context.
Runtime validates and atomically replaces the complete document under its existing domain
lock. Default references must exist in the submitted list or be null. A removed model may
remain referenced in host-owned agent definitions; the next run fails explicitly. There is
no reverse business dependency or cascading update. A first manual model does not implicitly
change a null default. Complete LLM seed environment initializes a new domain with the existing
`default` model/default ID; incomplete seed creates an empty library. Saved rows are never reseeded.

API keys remain encrypted at rest and masked on reads. An incoming mask restores a matching
saved key in the same domain and model ID, consuming duplicate masks in stored order.
Ciphertext and unmatched masks are rejected; plaintext replacement values are never echoed.
Tests restore masks against saved data, never save, and cancel when the upstream request is
cancelled. Connection errors expose the safe `MODEL_TEST_FAILED` result. Read failures never
become empty writable state. Existing parameter defaults and custom-request overrides remain.

Ontology is the browser's management host. The gateway prefix is `/api/data-query`:

| Java route | Permission | Success |
| --- | --- | --- |
| GET `/model-settings` | `system-config` | `{success:true,data:ModelSettings}` |
| POST `/model-settings/save` | `system-config` | same |
| POST `/model-settings/test` | `system-config` | `{success:true,data:{content:string}}` |
| GET `/model-options` | current domain identity | `{success:true,data:ModelOptions}` |
| GET `/ontology/ai/agent-models` | `system-config` | `{success:true,data:{agents:[{id,kind,name,modelSelection}]}}` |
| PUT `/ontology/ai/agent-models/:id` | `system-config` | `{success:true,data:{id,kind,name,modelSelection}}` |

The PUT body is `{modelSelection:ModelSelection}`. Only ontology-owned catalog IDs may be
configured. Domain comes from the current identity, never from the body. Runtime grants are
not user credentials for these APIs. Explicit model IDs are validated against runtime options
before host settings are saved. Unknown agents return 404, absent referenced models 400;
transport failures return 503 `DEPENDENCY_UNAVAILABLE`. New controller errors use non-2xx
`{success:false,code,message}`. Enterprise's existing `system-config` guard owns management
permissions; the options endpoint only requires identity. OSS keeps domain `1`.

Workbench owns `assistant_agents.model_selection` and `ops_diagnosis_settings.model_selection`.
Assistant definitions expose `modelSelection` instead of `modelRole`; creation/omission defaults
to `{modelId:null}`. Existing `/api/assistant/agent-definitions` CRUD retains `analysis-agent`.
GET/PUT `/api/assistant/diagnosis-model` uses that same permission and returns `{modelSelection}`;
PUT takes the same shape. Diagnosis execution permissions remain unchanged. Auxiliary report,
chart, preview and evaluation calls use the domain default. Ontology's Action input examples
also use only that default. Workbench `/api/model-settings` and its management proxy are removed.

Embedding remains Java-owned with its existing businessConfig and vector rebuild endpoints.
No embedding entries enter the runtime conversation-model list.

Existing deployments require the separate pre-release conversion in a stop-write window.
Convert each agent's old role to a direct ID; null roles become the domain default. Set the
domain default from old `general`, remove the old role map/column, and remove `modelRole` from
historical run definitions. Cross-version replay of old admissions is unsupported. Products
contain no legacy role parser, data conversion or compatibility branch.
