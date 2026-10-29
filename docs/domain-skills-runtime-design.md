# Domain skill runtime integration

Implemented 2026-10-29 after controller review on 2026-10-28, based on public
`cc5ac842`. Success is a standard script-bearing package imported through existing
management, selected for an agent, executed by PI, and updated for the next run
while the running version and historical digest stay intact. The
[contract](../packages/contracts/domain-skills.md) owns the wire changes.

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
`resolvedSkills`. Workbench now publishes selected domain packages, assembles the current-user
environment and exposes the existing digest in the host projection.
Assistant scripts receive the current user credential as ONTOMATO_TK. The
[ontology-host migration](ontology-ai-runtime-design.md) removes assistant-retrieval
and its ONTOMATO_RETRIEVAL_CALLBACK_TOKEN. The shared analyst uses that same user
credential and the ontology-owned caller scope.

## Replacement and deletion

Paths are relative to `packages/workbench-server/` unless qualified. Delete
exclusive imports, exports, prompts and obsolete tests with each removed path.

| Existing path / behavior | Destination |
| --- | --- |
| `src/core/skills/registry/manager.ts`: `matchKnowledgeSkillsWithLLM`, direct `Skill-Executor` model call, eager `getSkillsForAgentContext` | PI's existing selected catalogue and progressive read; retain management discovery/enablement |
| `src/core/skills/execution/{executor,runtime}.ts`, dynamic `execute(input)`, retry/metrics state; `/api/skills/metrics` | Standard runtime tools and run facts; metrics endpoint has no current UI consumer |
| `src/services/skills/skill-manager.ts`: in-process debug | `src/services/skills/preview.ts` starts an ordinary auxiliary runtime run selecting just the inspected skill; existing debug response is a view of final text, PI state and file metadata |
| `src/core/skills/manifest.ts` / `discovery/scanner.ts`: private manifest requirements and `migrateLegacySkillManifest` | Shared standard package validation, workbench display metadata; remove automatic legacy rewriting |
| `prompts/skills/executor/knowledge/user.md` and edition `Skill-Executor` labels | Delete with the retired model call; retain unrelated diagnosis/model callers |
| `src/services/agent-runtime/skills.ts`: provider-only publication helper | One file-publication helper also accepting verified domain context |
| Assistant's direct `a.skills` admission and frontend's hidden `providerSkills` passthrough | Current enabled selection, domain publication and full-reference catalogue; no provider/domain name aliases |
| Host projection drops runtime skill versions | Shared `AgentHostRun.resolvedSkills`; coordinate this field with other host implementers |

Retain management resource/export routes, public-package read-only behavior,
domain state, assistant deletion cleanup, provider startup publication and
runtime name/digest storage. No startup migration of old packages or definitions.

## Approved scope and implementation evidence

Management stays in its existing location with the same controls/layout. Script
examples now show a normal CLI; debug shows the final answer, PI state and file
metadata of an ordinary runtime run. The agent selector edits provider and domain
references together. Its catalogue must load successfully before saving.

Seven bundled public packages are standard sources published as workbench
provider skills: growth-rate-calc, generate-ppt, echarts, leaflet, network-graph,
admin-choropleth-map and quality-trace-graph. Their calculations and interactive
rendering stay in ordinary scripts. HTML embeds bundled library distribution
assets so the exported package and result do not depend on workbench static routes.
The canonical ECharts and Leaflet sources remain the existing bundled libraries;
package-local copies carry them in the standalone distributions.
`generate-ppt` calls the existing authenticated conversation export API. No stored
customer package or agent-definition conversion is performed.

Focused contract/component checks cover standard ZIP bytes, independent package
validation, domain selection, edit publication, shared host metadata and retained
edition labels. Type/lint checks and both editions' Maven compilation pass. The
seven public CLIs also run from copied standalone directories; PPT transport uses
a loopback fixture, not a real presentation generation proof.

Main-directory UI, full-stack, image and runtime-registry smoke remain
controller-owned, including active-run immutability and the next message in an
old session using the new digest. The separate ontology-host line owns replacing
assistant-retrieval with its ask skill and updating the assistant's platform
catalogue accordingly. This module changes only the old callback variable name.
