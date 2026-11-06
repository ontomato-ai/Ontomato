# UI v0.5 migration ledger

Updated 2026-11-06. This ledger covers both local checkouts. `Implemented` means source changes and basic checks;
`Accepted` requires rendered visual and functional checks. Earlier changes remain reviewable in the working trees.
No page is accepted merely because it inherits shared CSS. Route parameters and redirects are grouped with their
owning page rather than treated as independent designs.

## Architecture and ownership

`apps/workbench` assembles platform-web, platform-shell, platform-admin, ontology-manager, platform-schedules and
workbench-ui. Enterprise consumes the same source plus platform-admin-enterprise and workbench-ui-enterprise.
Agent-shell-ui owns conversations for agents, operations and governance. Node/Java API and permission contracts
are outside this visual migration. Vue/Element Plus controls, AntV G6/X6 canvases, ECharts, CodeMirror and
markstream renderers retain their implementations. The star map is a separately built iframe, not a Vue page.

Foundation and components.css own shared values/treatment; oss.ts and enterprise/brand-enterprise own colours.
Host preferences install the brand and persist theme/locale. Manager also has instance-level theme selectors:
verify teleported overlays as well as the document theme. Do not rewrite generated bundles.

## Component inventory and risks

| Family | Authoritative owner | Audit findings / migration |
|---|---|---|
| Rail, account, application surface | platform-shell | Shared; preserve app identity, links and permissions; review narrow rail |
| Standard headers | PlatformPageHeader | Wrap actions and tabs, token typography; compact graph headers stay local |
| Buttons, forms, overlays, tags | design-tokens/components.css | Remove competing host treatment; retain editor-specific geometry |
| Admin tables/toolbars | platform-admin styles + workbench legacy styles | Duplicate rules; converge common treatment, do not change table operations |
| Setting rows | platform-admin config and models | Duplicate typography/geometry; consolidate reusable CSS |
| Conversations/process/actions | agent-shell-ui | Shared rhythm; host action slots use shared action class |
| Artifacts/technical previews | agent-shell-ui + diagnosis | Preserve file handling and safe HTML behaviour |
| Graph/modeling/browser | ontology-manager | Preserve selection/pan/editing; no blanket card or height changes |
| Schedules | platform-schedules | Long labels, filters, run history and dialog widths need rendered checks |
| Brand/status/charts | edition brand sources + chart-theme | Contrast tests exist; do not use category colour as status |
| Legacy star map | enterprise/apps/workbench/legacy-graph | Separate build, WebGL and iframe theme integration need explicit verification |

Regression risks: shared size changes affect small controls; global CSS may override scoped styles; larger headings
may wrap; fixed grid minima and fixed title bars can overflow; theme inheritance differs across poppers and iframes.
Preserve selected state, unsaved drafts, API keys, roles, ownership and routing during all checks.

## Page inventory

All rows require light/dark, 1440×900, 1280×720 and 200% zoom. Side-page-capable rows also require narrow-container
checks. Unless explicitly recorded below, visual acceptance is pending, including normal/empty/loading/error,
long data, keyboard, dropdown/overlay and permission variants.

| App / page | Route / variant | Source and layout | Implementation | Visual acceptance |
|---|---|---|---|---|
| Agent conversation | /agents/chat | BusinessWorkbench / AgentShell; tools, artifacts, composer | Implemented (shared) | Pending real conversation matrix |
| Agent editor/new | /agents/settings, /new, /:agentId | AgentEditor; form/editor | In progress | Pending |
| Capability library | /agents/settings/capabilities | CapabilityLibrary; list, Skill/MCP dialogs | In progress | Pending |
| Ontology graph | /ontology/playground | OntologyPlayground; canvas/inspectors | Implemented | Pending graph matrix |
| Object/attribute/relation catalog | /ontology/objects, /attributes, /relations | OntologyModelCatalog; table | In progress | Pending |
| Object detail | /ontology/objects/:className | OntologyObjectDetail; forms/attributes/relations | Implemented | Pending |
| Relation detail | /ontology/relations/:relationship | OntologyRelationDetail; endpoints/form | Implemented | Pending |
| Visual modeling | /ontology/visual-modeling | VisualModeling + right panel; X6/editor | Implemented | Pending editing/zoom |
| Metric/action/function catalog | /ontology/assets/{metrics,actions,functions} | OntologyAssetCatalog; grid table | Implemented | Pending populated lists |
| Metric/action/function detail/new | /ontology/assets/{metrics,actions,functions}/:id | OntologyAssetDetail; forms/query/code/test/generation | Implemented | Browser fixture checked at 1200/800/480; full matrix pending |
| Business knowledge | /ontology/knowledge | BusinessKnowledge; list/editor/dialog | In progress | Pending |
| Object browser | /browser/data/:className? | DataBrowser + InstanceGraph; table/filter/graph | In progress | Pending |
| Star map (enterprise) | /browser/graph | LegacyGraphView + legacy-graph; iframe/WebGL | Not started | Pending theme/interaction |
| Dashboards | /dashboards | DashboardView/Panel; board/chart/table/AI drawer | Implemented | Pending populated charts and editor |
| Platform schedules | /schedules | PlatformSchedulesList/Form/Runs; table/dialog | In progress | Pending |
| Agent schedules | /agents/schedules | Same schedules components; agent scope | In progress | Pending owner/agent filtering |
| Operations chat | /ops/diagnosis | ObserveLayout / AgentShell | Implemented (shared) | Pending |
| Turn evidence | /ops/turn, /:turnKey | ListDetail/ArtifactDetail/FilePreview | Implemented | Pending real artifacts |
| Operations tests/results/cases | /ops/test, /results, /cases, /autotest/runs/:runId/cases/:caseId | AutotestPage/TestPage/TestcasesPage/ResultsPage/CaseArtifactPage | In progress | Pending run history/edit dialogs |
| Live logs | /ops/live-logs | LiveLogsPage; resizable log panes | Implemented | Pending streaming/error |
| DSL test | /ops/dsl | DslTestPage; editor/result, enterprise MQL | Implemented | Pending execution/result |
| Operations knowledge | /ops/knowledge | KnowledgePage; tree/editor | In progress | Pending |
| Operations model | /ops/model | OpsModelPage/DiagnosisModelPanel; settings | In progress | Pending |
| Governance conversation/report | /governance/chat/:sessionId? | GovernancePage / AgentShell; report/sources | In progress | Pending findings/sources |
| Feedback records | /governance/feedback | FeedbackRecordsPage; table/detail | In progress | Pending |
| Model usage | /settings/model-config/usage | ModelConfigPage/ModelUsagePanel; settings | In progress | Pending |
| Model providers | /settings/model-config/providers | ProviderList/Detail/Add/Edit/Discover | In progress | Pending dialogs/secrets |
| General settings | /settings/system-config/general | GeneralSettingsTab; shared setting rows | In progress | Pending |
| Data adapters | /settings/system-config/data-adapters | DataAdapterSettingsTab/MultiDataSourceEditor/TestReport | In progress | Pending long schema/test failure |
| Authorization (enterprise) | /settings/system-config/authorization | LicensePage; status/activation/QR | Implemented | Component tests; visual matrix pending |
| Audit log | /settings/records/audit-log | AuditLogPage; table/filter | In progress | Pending |
| System monitor | /settings/records/system-monitor | SystemMonitorPage; resources/services | In progress | Pending |
| Permission members/roles/policies/org (enterprise) | /permissions?tab=… | UserManager/RoleManager/PostManager/OrganizationManager | In progress | Pending all four tabs and dialogs |
| Sign-in/callback (enterprise) | /login, /auth/callback | LoginPage/AuthCallbackPage | Implemented | Browser geometry 1440/1280 checked; theme/zoom pending |
| Super admin accounts/domains/services (enterprise) | /super-admin | SuperAdminConsole/Accounts/Domains/SystemMonitor | In progress | Pending platform-admin account |

Redirects and wrapper routes `/`, `/ontology`, `/ops`, `/settings/model-config`, `/settings/system-config`,
`/settings/records` and historical aliases use their destination's acceptance. External Data Governance Platform
is outside this repository; verify its launch affordance, not its external UI.

## Verification infrastructure and execution plan

Existing Vitest component suites cover Manager routing, provider/config forms, schedules and enterprise pages.
Playwright is available through workbench-server; use browser screenshots and computed geometry with local services.
There is no complete checked-in screenshot baseline. Keep artifacts outside tracked runtime/config data.

1. Inventory and specification: this ledger and DESIGN.md v0.5.
2. Foundation/reference: semantic type roles, small-control compatibility, shared form/status/overlay rules; render a
   reference surface before broad application checks.
3. Shell/components: responsive headers, tabs, table minima and settings-row ownership.
4. Application passes: follow inventory, fix source-level issues in manageable groups.
5. Agent refinement: preserve process semantics, verify long/short content and artifact modes.
6. Acceptance: record each actual scenario and screenshot; never promote uninspected pages to Accepted.

## Evidence

**Screenshot capability caveat.** Visual review by reading screenshots was attempted twice in this session and the
runtime rejected image input ("this model does not support image input"). No page below is accepted on the strength of
a screenshot I read. The script `ui-audit.mjs` (kept outside the repositories) renders every route with deterministic
fixtures, measures computed styles and writes 1440x900 PNGs so a reviewer or an image-capable model can inspect them.
Screenshots live in a temporary directory, not the repository.

**Rendered audit, 31 routes, both themes, 1440x900 / 1280x720 / 640x720.** Measured, not visually judged:
no document-level horizontal overflow and no uncaught runtime error on any route after the fixes below.
Automated checks covered text below 12px, computed text contrast, non-scale border radii, clipped containers and
overflowing frames. Automation produces false positives (a sibling thumb paints the segmented selection; disabled
controls are contrast-exempt; table wrappers scroll by design), so every remaining item was re-probed individually.

Fixed from the audit:

| Finding | Evidence | Fix |
|---|---|---|
| Segmented selection label unreadable in dark mode | label `rgb(255,255,255)` on thumb `rgb(143,191,90)`, ratio ~1.6 | components.css maps selection text to `--on-primary`; measured 6.97:1 in both themes |
| Segmented thumb/item/external radius off-scale | computed 3px / 5px | one 6px control radius |
| Small buttons 5px, pagination 2px | Element Plus derives both by subtraction | explicit `--radius-sm`; measured 6px |
| System monitor clipped 8px | `.el-row` negative gutter inside an `overflow-x:hidden` scroller | container inline padding; scrollWidth now equals clientWidth |
| Nine 10px radii | ad-hoc values for avatar options, artifact cards, renderers, graph | `--radius-md` (8px) |
| Gutter and panel subtitles at 4.39:1, empty-state hint 4.45:1 | placeholder role used for readable text | secondary role; 4.5:1+ |
| Conversation crashed with `Cannot read properties of undefined (reading 'name')` | `appearance.value?.brand.name` missing optional chaining on `brand` | corrected; no runtime errors remain |
| Graph toolbar buttons 5px and 34x32 | off-scale radius and mixed box | 6px and 32x32 |
| Graph edge labels 11px | canvas text below the readable floor | 12px |

Earlier focused checks remain: Manager 85 tests; agent-shell 20; foundation 19; enterprise brand 5; enterprise
platform-admin 142; platform-admin 63; platform-schedules 44; platform-shell 16; authorization/navigation 15;
workbench-ui 81. Both frontend builds pass. These establish implementation health, not page acceptance.

Still **Pending** and requiring a human or image-capable reviewer with real data: populated tables and long values,
expanded/streaming conversations with artifacts, every dialog and drawer, permission-gated enterprise pages,
the legacy star-map iframe in both themes, and the full 200% zoom pass. `/agents/schedules` still redirects to
`/schedules`; that is existing routing, not a styling defect.