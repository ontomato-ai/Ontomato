# Domain skill runtime integration

Proposed, 2026-10-28, inspected at public `cc5ac842`. Segment 1 is documentation
only. Success is a standard script-bearing package imported through existing
management, selected for an agent, executed by PI, and updated for the next run
while the running version and historical digest stay intact. The
[contract](../packages/contracts/domain-skills.md) owns the proposed wire changes.

## Decisions and ownership

| Owner | Retained responsibility / change |
| --- | --- |
| Workbench skill management | Editable domain directories, ZIP/form operations, domain enablement and administrator permission; replace private package requirements with standard frontmatter plus optional display metadata |
| Workbench assistant | Definition selection, current user/domain, prepare selected packages before each new admission; reuse existing admission replay and auxiliary-session ownership |
| Runtime | Existing publication, digest resolution, immutable source, per-run read-only installation, PI read/bash and run history; no second executor |
| Contracts | Shared package validation, selectable catalogue shape and historical resolved-skill projection |
| UI | Existing management location/layout and one agent selector; consume complete skill references and ordinary run results |

Publish domain packages just before a new run, not in a background synchronizer.
This leaves one editable source and reuses content-addressed publication without
adding a publication-status database. Read source bytes once under the same domain
operation boundary as create/edit/import/toggle/delete, then publish and admit
before releasing it. Keep network waits outside database transactions. Resolve
an already-admitted retry before this boundary. Preserve the existing host gate
cleanup when preparation fails.

The runtime already replaces selected packages between rounds and saves
`resolvedSkills`. The missing pieces are host publication, current-user
environment assembly and exposing the existing digest in the host projection.
The current assistant supplies a retrieval-route callback token; replace that
assistant use with ordinary user authentication. Keep callbacks still owned by
other services. No change to the retrieval business gate or PI state is needed.

## Replacement and deletion

Paths are relative to `packages/workbench-server/` unless qualified. Delete
exclusive imports, exports, prompts and obsolete tests with each removed path.

| Existing path / behavior | Destination |
| --- | --- |
| `src/core/skills/registry/manager.ts`: `matchKnowledgeSkillsWithLLM`, direct `Skill-Executor` model call, eager `getSkillsForAgentContext` | PI's existing selected catalogue and progressive read; retain management discovery/enablement |
| `src/core/skills/execution/{executor,runtime}.ts`, dynamic `execute(input)`, retry/metrics state; `/api/skills/metrics` | Standard runtime tools and run facts; metrics endpoint has no current UI consumer |
| `src/services/skills/skill-manager.ts`: in-process debug | Ordinary auxiliary runtime run selecting just the inspected skill; existing debug response is a view of final text, PI state and file metadata |
| `src/core/skills/manifest.ts` / `discovery/scanner.ts`: private manifest requirements and `migrateLegacySkillManifest` | Shared standard package validation, workbench display metadata; remove automatic legacy rewriting |
| `prompts/skills/executor/knowledge/user.md` and edition `Skill-Executor` labels | Delete with the retired model call; retain unrelated diagnosis/model callers |
| `src/services/agent-runtime/skills.ts`: provider-only publication helper | One file-publication helper also accepting verified domain context |
| Assistant's direct `a.skills` admission and frontend's hidden `providerSkills` passthrough | Current enabled selection, domain publication and full-reference catalogue; no provider/domain name aliases |
| Host projection drops runtime skill versions | Shared `AgentHostRun.resolvedSkills`; coordinate this field with other host implementers |

Retain management resource/export routes, public-package read-only behavior,
domain state, assistant deletion cleanup, provider startup publication and
runtime name/digest storage. No startup migration of old packages or definitions.

## Controller decisions before implementation

1. **Meaning of unchanged management UI.** Recommend keeping its location,
   controls and layout, with the minimum script-placeholder/template change and
   debug result mapping needed for standard CLI skills. Debug becomes an ordinary
   model run using the selected package and the supplied JSON as task input; its
   existing response carries final text plus run/file metadata, not a fabricated
   `execute(input)` result. Also make provider skills editable in the existing
   agent selector. Source inspection shows they are currently preserved invisibly,
   despite analysis/visualization having already become one list. Strictly no UI
   edits would leave a misleading script example and incomplete selection control.
2. **Bundled public packages.** The management catalogue currently includes seven
   executable public packages using private frontmatter/entry conventions.
   Recommend adapting these source assets in this module to standard packages
   under the existing workbench provider, keeping their calculations/rendering
   code as ordinary scripts. `generate-ppt` must call the existing authenticated
   conversation export API instead of `input.services.generatePpt`. This is source
   replacement, not conversion of stored customer packages. If excluded, assign
   their replacement/removal and catalogue behavior explicitly; do not retain an
   old executor or silently publish private packages as if they were standard.

After these decisions, keep only contract checks for standard-package round trip,
selected-domain scope and old/new run digests across an edit. Use type/lint gates
for shared projections and both editions' Maven compile. Main-directory UI,
full-stack, image and registry smoke remain controller-owned. No implementation,
build, service startup or runtime proof is claimed by this document.
