# Conversation model configuration ownership

Approved by the controller and implemented, 2026-10-29. Baseline: public
`5865de9146ef87c3533d566e1486c9ad9b5cfb64`, enterprise
`0723e509af2da1906553e53a8e187b6132c7f810`.
The [wire contract](../packages/contracts/agent-runtime-model-config.md)
owns request/response shapes and save semantics.

## Outcome and ownership

Editing the existing workbench model page changes the configuration used by both
workbench and ontology agents on their next model resolution. Runtime is the only
conversation-model configuration store. Java retains Embedding, vector rebuilding
and its unrelated business configuration. Page placement and interactions stay
unchanged; no old-data conversion, dual writes or Java fallback are introduced.

Configuration belongs to the **platform domain**, not to a runtime host. Workbench
and ontology hosts must resolve the same model library and five role references
for the same domain. Runtime sessions, runs, artifacts, MCP services and their
existing host/domain access checks retain their separate ownership.

Use the existing runtime PostgreSQL pool/schema and a `model_settings` table with
`domain_id` as primary key and one JSON document containing the models and roles.
The document is replaced atomically. Restore masked keys, validate references and
perform first-model assignment under the same domain transaction lock. Persist
API keys sealed with the existing AES-256-GCM codec and
`ONTOMATO_MODEL_RUNTIME_TOKEN`; add sealing beside the existing Node unsealing
function. No new secret, key rotation or secret-management subsystem is needed.

At first access, initialize a missing domain from `LLM_BASE_URL`, `LLM_API_KEY` and
`LLM_MODEL` only when all three are present; otherwise initialize an empty library
and five null references. Move the existing complete-seed behavior and defaults
from Java to runtime. Existing rows, including intentionally emptied libraries,
are never seeded again. No process configuration cache is added.

## Call paths

| Consumer | New path |
| --- | --- |
| Existing model page | Workbench authenticated `/api/model-settings` routes → runtime configuration API |
| Existing model connection test | Same page → workbench → runtime; runtime restores masked keys and calls its existing pi-ai test implementation |
| Runtime agent / compaction | Read one domain configuration snapshot locally at model resolution; retain it for that run |
| Remaining workbench model calls | Existing `resolveModelForRole` → `RuntimeClient` settings read → local unsealing; no Java read |
| Configuration diagnosis | Java supplies its safe Embedding/business view; runtime supplies its safe conversation-model view; the existing workbench tool composes these owner-provided views |

The remaining workbench model callers are not migrated to a new inference API in
this task. They continue using the existing sealed-key transport, now sourced
from runtime, until the separate remaining-model-calls cleanup. This keeps this
task about configuration ownership and avoids coupling it to LangChain removal.

`modelRole` remains in run definitions. Remove `modelCredential` from StartRun,
all TS/Java producers, fixtures and admission handling: runtime no longer calls
Java to resolve models. Callback credentials remain in `environment.secrets` for
skills; generation grants no longer authorize the removed model-settings GET.

## Approved domain alignment

The baseline has two IDs for the OSS single domain:

- `apps/workbench/src/identity.ts`: `default`.
- `apps/data-engine/.../AnonymousIdentityService.java` and `SingleDomainSvc.java`:
  `1`. The ontology host sends this ID to runtime unchanged.

Java previously resolved model domains from credentials, hiding this mismatch.
Keying runtime configuration directly by the current request domain would split
OSS workbench and ontology models into two independent configurations.

Controller decision (2026-10-29): use the platform's existing OSS domain ID `1` in OSS
workbench identity assembly and its fixed-domain defaults. Enterprise continues
using its verified domain unchanged. Do not teach the runtime that `default` and
`1` are aliases, or add model-only domain mappings to consumers. Keep session
host isolation unchanged.

This also changes the domain used for newly accessed OSS workbench resources.
Existing local `default`-scoped workbench/runtime data will need the separately
planned pre-release conversion. No conversion or historical-data fallback is
included here. The controller explicitly accepted this consequence.

## Replacement scope

- Runtime: configuration storage/service, management routes, local role
  resolution, masked-key testing, safe diagnostic projection and shared schemas.
- Workbench: authenticated settings routes with the existing identity seam;
  `system-config` authorization for save/test, verified domain for reads;
  `RuntimeClient`, resolver, diagnosis consumer and the page API adapter. The
  `system-model-config` business settings remain workbench-owned.
- Java: delete conversation model GET/save/test handlers, `BusinessConfig.models`
  and `.agents`, their DAO shape checks, seeds, configuration defaults, model
  DTO/resolver/sealing helpers and conversation fields in full/diagnostic views.
  Preserve Embedding masking, saves, tests and vector-generation semantics.
- Enterprise: remove deleted Java route permission entries and the special
  model-read interceptor/grant exception; retain management guards for Embedding
  and data adapters. Workbench management uses the existing `system-config`
  permission check, without a new permission system.
- Deployment and dev assembly: remove `AGENT_RUNTIME_MODEL_CONFIG_URL` and the
  runtime's Java model adapter options; move LLM seed variables to runtime;
  remove Java's model-token requirement. Runtime and workbench retain
  `ONTOMATO_MODEL_RUNTIME_TOKEN` while sealed-key workbench readers exist.
- Update current runtime/ontology-AI contracts and corresponding fixtures in the
  implementation commit. Superseded Java model tests are replaced with tests at
  the new owner; Embedding regression coverage remains.

No main-checkout edits, service startup, image build, remote access, push or
InfoHub edits are part of this executor's scope.

## Verification and acceptance

Contract tests protect domain sharing and foreign-domain isolation, first-model
role assignment, atomic rejection of invalid references, duplicate-tail mask
restoration, secret-free responses/diagnostics, saved-key connection testing,
host management permissions and removal of the obsolete run credential.
Use the existing runtime HTTP integration fixture to prove that a saved setting
is consumed without a Java model-config server and survives runtime restart.

Run the repository typechecks, applicable lint and both Maven reactors' compile
targets. Do not run unfiltered Java tests. Controller acceptance in the main
checkout remains: change a model on the original page, run a workbench question
and ontology generation, verify both use the changed model, verify keys cannot
be read back in plaintext, and run image/registry smoke checks.

Local check results are reported with the implementation commits. They do not
claim controller-owned main-checkout or real-model product acceptance.
