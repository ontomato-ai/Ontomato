# Runtime-owned conversation model settings

Proposed contract for controller review, 2026-10-29; not implemented. Extends
[agent-runtime](agent-runtime.md). Placement, replacement scope and the OSS domain
decision are in the [design](../../docs/model-config-runtime-design.md).

## Identity and scope

All routes use the existing host service Bearer credential, `X-Correlation-Id`
and host-verified `X-Domain-Id`. The host authenticates the end user and decides
management permissions. Runtime never accepts domain or host identity from the
body. A model library is shared by authorized hosts in the same platform domain;
it is not keyed by host. Other domains cannot read, retain masks from or overwrite
it. Existing session/run/MCP host isolation is unchanged.

## Settings and requests

The executable schemas will live in `src/model-settings.ts`, replacing its
handwritten interfaces. Runtime, host and page use that single definition. Model
request parameter fields retain the current editor/Java model shape, including
optional fields round-tripped by the editor without dedicated controls. They
share the provider parameter shape with `src/runtime-model-test.ts` rather than
maintaining a second model field list.

```ts
type ModelRole = "query" | "coding" | "general" | "diagnosis" | "knowledgeGovernance";
type ModelSettingsWrite = {
  models: ModelEntry[];
  agents: Record<ModelRole, string | null>;
};
type ModelSettingsView = {
  models: ModelEntry[]; // apiKeys contain only masks; defaults normalized
  agents: Record<ModelRole, { model: string | null }>;
};
type ModelSettingsServerView = ModelSettingsView & {
  sealedApiKeys: Record<string, string[]>;
};
```

`name` remains the domain-unique configuration ID, and `displayName` remains an
editable label. Roles only reference IDs; parameters belong to the model entry.
An empty/absent label becomes the ID. Null or absent `maxTokens` and
`contextWindow` use the existing defaults, 50000 and 256000. Nullable optional
fields from the existing editor are normalized at the request boundary. Custom
request parameters remain an object applied as final top-level body overrides.

Save is a complete replacement of models and all five references; no partial
model save or dual write. Require nonempty unique IDs, complete model connections
and all five role keys with no unknown roles. References must be null/blank or
refer to a submitted model. Blank references normalize to null. If and only if
the previous library is empty and the submitted library contains exactly one
model, assign that model to every empty role. Return the resulting normalized
references so the page shows what was actually saved.

Saved API keys retain the established write-only semantics: keys longer than
eight characters show `******` plus the last four characters; shorter keys show
`******`. An incoming mask restores one matching stored key from the same domain
and model ID. Match in stored order, using each stored key at most once, including
duplicate tails. Reject unmatched masks without writing any part of the document.
Plain values replace keys; omitted list elements are removed. Never echo plaintext
keys in success or error responses, diagnostics or logs.

## Runtime HTTP

| Method/path | Request | Success |
| --- | --- | --- |
| GET `/v1/models/settings` | — | 200 `ModelSettingsServerView` |
| PUT `/v1/models/settings` | `ModelSettingsWrite` | 200 `ModelSettingsView` |
| POST `/v1/models/test` | `{model: ModelEntry, prompt?: string}` | 200 `{content: string}` |
| GET `/v1/models/diagnostics` | — | 200 safe model and role projection described below |

Settings GET is an authenticated server boundary. It returns masks plus the
existing `enc:v1:` AES-256-GCM sealed-key map for remaining workbench model
callers. Workbench page responses project `ModelSettingsView` and omit that map.
There is no plaintext-key endpoint. Ciphertext is never accepted as a replacement
API key or a substitute for the current domain's saved mask.

The test route replaces its current raw `apiKey` draft shape with the existing
editor's `apiKeys` shape. Runtime resolves any masks against saved settings,
selects the first key as before, then calls the existing pi-ai connection test.
An unsaved draft with plaintext keys does not need a configuration ID; restoring
a mask requires the matching saved model ID. Test does not assign any roles.
Blank/omitted prompts use `Hello`. Nothing is saved, no session is created, no
provider retry is added, and client disconnect cancels the request. Model
provider errors use the existing safe `MODEL_TEST_FAILED` response.

Diagnostics expose only model ID, display label, API model name,
`connectionConfigured`, timeout, retry count, output/context limits and role
references, matching the current safe model projection. They contain no URL,
key, ciphertext, header values or custom request parameter values. Runtime owns
this projection; Java supplies only its remaining diagnostic fields.

Errors use the existing `{error:{code,message},correlationId}` envelope: invalid
credentials 401; invalid settings/masks 400 `INVALID_REQUEST`; absent model for a
requested role 422 `MODEL_NOT_CONFIGURED`; test provider failure 502
`MODEL_TEST_FAILED`. Read/storage errors are failures, never empty libraries.
Configuration writes have no automatic retry. Concurrent saves serialize on the
domain document; the last committed complete replacement is authoritative.

## Workbench boundary

The existing page calls `GET /api/model-settings`,
`POST /api/model-settings/save`, and `POST /api/model-settings/test`. The API
adapter changes; page location, controls, dialogs, first-model behavior and
success/error presentation stay the same. Read requires authenticated domain
identity; save and test additionally require the existing `system-config`
permission. OSS keeps its anonymous single-domain behavior.

The host forwards through `RuntimeClient`, using only server-verified domain
context and its service credential. It preserves the existing page envelopes:
`{success:true,data:ModelSettingsView}` for read/save and
`{success:true,data:string}` for test. Failures carry a safe message and runtime
status/code; transport failure is 503 `DEPENDENCY_UNAVAILABLE`. Failed reads must
not become writable empty state.

## Agent execution and cutover

Runtime resolves `definition.modelRole` from its local domain store when preparing
a new run. It captures that resolved model for the run and compaction; later saves
affect the next resolution, not an in-flight request. An unassigned role fails
explicitly without falling back to another role.

Remove `modelCredential` from StartRun and all producers in the same change;
credentials required by skills remain in `environment.secrets`. Delete
`AGENT_RUNTIME_MODEL_CONFIG_URL`, the Java settings adapter and the Java
`businessConfig` conversation-model endpoints/fields. Stored old configuration
is not read or converted by this code; pre-release conversion is separate.
