---
version: 0.5
name: Ontomato Product UI
date: 2026-11-06
status: Design and engineering implementation standard; page acceptance is tracked separately
---

# Ontomato Product UI

## Product Design System & Implementation Standard

Applies to Agent Platform, Ontology Service, Object Browser, Operations Diagnosis, Knowledge Governance, Dashboards,
Scheduled Tasks, System Settings and Enterprise Edition. [UI-MIGRATION.md](UI-MIGRATION.md) owns the complete route,
component and acceptance inventory. This document does not assert that every existing page already complies.

## 1. Purpose and objectives

Deliver one coherent professional enterprise product: information-first, efficient, predictable, accessible,
maintainable and responsive. Data is loud, chrome is quiet. Information hierarchy precedes decoration. Consistency
comes from shared rules, not duplicated CSS. Every visual element needs a functional purpose.

Avoid unnecessary cards, gradients, coloured shadows, oversized gaps, excessive radii and decorative icons. Preserve
business meaning, permissions and task efficiency. An unsuitable rule must be revised with its shared implementation;
do not preserve it through permanent local overrides.

## 2. Design language

OSS uses **Editorial Enterprise**: warm paper neutrals, olive ink, leaf-green interaction, restrained tomato brand
signature, thin separators, compact controls and minimal elevation. Enterprise inherits the foundation with neutral
gray/white and graphite surfaces, indigo interaction and its own restrained auxiliary palette. Neither edition copies
one reference product. OpenCode, Open WebUI and assistant-ui are conversation implementation references, not standards.

Three environments share foundations but retain appropriate composition:

| Environment | Applications | Composition |
|---|---|---|
| Agent workspace | Agents, Operations, Governance | Readable conversation, expandable process/evidence, artifacts, distinct composer |
| Data management | Manager catalogs, Browser, Dashboards, administration | Dense tables/forms, quiet toolbars, continuous working surfaces |
| Technical workspace | Graphs, modeling, editors, diagnostics | Stable canvas/inspector geometry and precise interaction states |

Do not force technical workspaces into ordinary administration templates. A conversation may be elevated; a full
business page is a continuous workspace. Expanded artifacts and side pages have intentionally owned boundaries.

## 3. Design system architecture

| Resource | Authoritative owner |
|---|---|
| Type, spacing, radius, density, shell, elevation, motion | packages/design-tokens/src/foundation.css |
| Brand types and Element Plus generation | packages/design-tokens/src/index.ts |
| OSS palette | packages/design-tokens/src/oss.ts |
| Enterprise palette | enterprise/packages/brand-enterprise |
| Shared control/overlay/form treatment | packages/design-tokens/src/components.css |
| Page composition | Owning page component |

Do not duplicate tokens, invent colour roles in pages, hard-code business colours or add an edition-specific spacing
scale. Keep Element Plus mappings and compatibility aliases. Use semantic roles, not names such as green-1 or
special-button-color. Existing variables such as `--el-bg-color` are the supported semantic API; introducing a second
`--color-*` layer is unnecessary. Evaluate shared token changes against all consumers.

## 4. Foundation tokens

System UI fonts for all languages; no web fonts. Tokens own actual values; this table records reference roles.

| Type role | Reference | Usage |
|---|---:|---|
| caption / label | 12px / 16px line | Metadata / group labels |
| body-sm | 13px / 20px line | Tables, controls, form labels |
| body | 14px / 22px line | Default UI |
| reading | 15px / 26px line | Answers and long text |
| title-sm | 16px | Section headings |
| title | 18px | Page/dialog title |
| title-lg | 22px | Prominent heading |
| display | 28–32px | Welcome; ordinary empty states use title-sm |
| mono | 13px+ | Exact identifiers, SQL, DSL, code |

Normal text uses 400/500, headings normally 600. Essential text is at least 13px, metadata 12px. Use monospace only
for exact character recognition; table numerals are tabular. Control long-form width. Heading line height is 1.35–1.45.

| Spacing role | Reference |
|---|---:|
| xs / sm / md / lg | 4 / 8 / 12 / 16px |
| xl / 2xl | 24 / 32px |
| 3xl / 4xl | 40 / 48px |

Related controls use 8px, blocks 12–16px, major groups 24–32px. The existing `--spacing-3xl:48px` remains a compatibility
alias; `--spacing-4xl` is the canonical 48px name and `--spacing-section` provides 40px without silently changing old
layouts. Migrate consumers deliberately. `--page-gutter` is the header/content horizontal alignment owner, applied once
by the shell's `platform-page-gutter` class (§7); page content uses 16px vertical padding. Below 760px the token itself
narrows to 16px, so headers and content narrow together; that narrow value is defined only there, in foundation.css,
never in a component.

| Radius | Reference | Usage |
|---|---:|---|
| xs | 4px | Tags, inline code |
| sm | 6px | Controls |
| md | 8px | Inset content, menus, detached panels |
| lg | 12px | Dialogs/drawers |
| full | Circular | Avatars, dots, circular actions |
| shell | 0 | Continuous workspaces |

Platform outer corners (16px), user bubbles and pill composers are intentional exceptions. Legacy xl/2xl/3xl radius
aliases are not invitations to use arbitrary radii. Do not make process rows pills.

| Density | Reference |
|---|---:|
| control-sm / control / control-lg | 28 / 32 / 40px |
| nav / two-line list | 32 / 44px |
| table head / row / compact row | 36 / 40 / 32px |
| compact page header | 48px |

Compact table actions may remain 24px text buttons. Heights are minima or reference sizes, never clipping constraints.
Allow wrapping, localization and zoom to grow content; touch needs larger targets. Never shrink text for a row quota.

Elevation has five named roles: flat (data), panel (conversation/detached side panel), composer, overlay
(menu/popover/toast) and modal (dialog/drawer). No table/page shadows, coloured shadows or primary-button glows.
Fast/base/slow motion handles hover, expansion and overlays; no hover movement or layout-shifting decoration. Respect
reduced motion and never delay critical actions.

## 5. Brand colour system

Each brand defines light/dark values for canvas, surface, raised, sunken, hover, line, line-strong, ink, ink-2, muted,
placeholder, faint, primary, primary-hover, primary-press, on-primary, primary-soft, link, brand-mark, accent,
accent-ink, accent-soft, rail, panel, workspace, rail-selected, panel-selected, edge, success, warning, danger and info.
Optional brand-mark/link values retain supported fallbacks. Use the same semantic names in both modes.

Shell bands keep one order: the rail (`rail`), an application's own column or menu (`panel`) and its main area
(`workspace`). Light mode makes the rail darkest and the main area lightest; dark mode reverses the order, so the main
area is darkest. Each mode is uniform: no dark rail beside a light application. `edge`, the hairline between rail and
application, is a translucent tone rather than an opaque colour.

Element Plus receives backgrounds through `--el-bg-color-page`, `--el-bg-color`, `--el-bg-color-overlay`; inset and
hover through `--el-fill-color` / `--el-fill-color-light`; selected through `--el-color-primary-light-9`; borders through
`--el-border-color` / `--el-border-color-dark`; text through primary/regular/secondary/placeholder. Text interactions
use `--brand-link`, filled controls `--on-primary`, and shell bands `--shell-*-bg`. The generator owns derived tints.

OSS leaf green means interaction; tomato is a brand moment, never an interaction/category colour. Danger may share
the accessible tomato-related red only with explicit error/destructive semantics. Dark palettes are designed, not
inverted. Normal text needs 4.5:1, large text 3:1; meaningful boundaries/focus need non-text contrast. Placeholders
need 4.5:1 on surface/raised. Disabled text remains distinguishable. Check rendered combinations, not tokens alone.

Status uses an explicit label or icon and restrained soft fills. Success, warning and danger express meaning; info is
neutral. Large summary cards remain neutral with local status marks. Activation/submission uses primary, not success.

Charts use eight fixed categorical colours and a primary sequential scale; stable identity determines entity colour.
Labels/values use ink; do not rely on colour alone. Validate category contrast and CVD distinction separately from
text contrast. For more categories use filtering, labels, patterns or small multiples; "Other" must not hide meaning.

## 6. Platform shell and layout

Two layers: platform rail and current application. The application fills remaining space, with only its rail-facing
corners rounded and one subtle edge; it is not a floating card. Rail widths are 196px expanded / 58px collapsed,
initially collapsed with persisted preference. Icons need accessible labels/tooltips. Group applications with quiet
separators: ontology, business, platform settings. Applications own columns, headers and content. The rail carries
the product's mark, not an application's: the current application is named by its row and its own header.

Each application shows one frame in its area:

| Application | Frame |
|---|---|
| Agent Platform, Operations Diagnosis, Knowledge Governance | Its own conversation column, then the conversation (§9) |
| Ontology Service (Ontology Manager) | Its own menu (ontology, assets, knowledge) in its band, pages beside it |
| Object Browser, System Settings | PlatformPageHeader with the application's pages as tabs; a page's own tabs stay in it |
| Dashboards, Scheduled Tasks, Permissions (enterprise) | One page: header and page |

Pages and the frames around them paint no background of their own: the main area (§5) shows through, so no page sits on
it as a lighter card; tables, inputs, cards, toolbars and dialogs keep their surfaces, and a canvas takes the page tone
(`--el-bg-color-page`).

An application owns the addresses under its prefix. Addresses that moved redirect in the front end:
`/agents/dashboards` → `/dashboards`, `/agents/schedules` → `/schedules?app=agents` (the list filters by application
only), `/agents/settings?tab=capabilities` → `/agents/settings/capabilities`.

Application columns reference 244px; inspectors 320px. Continuous panels use 1px separators without shadows. At
1440×900 use standard density; at 1280×720 retain usable actions; below 760px reflow/stack. Use container queries for
embedded pages. At 200% zoom no essential action or content may become inaccessible.

## 7. Page architecture

Standard management pages use PlatformPageHeader: one title, optional useful description, actions and application
tabs. Compact technical headers reference 48px and grow/wrap as necessary. No redundant type subtitle or explanatory
eyebrow in a dense titlebar; contextual help can be available separately. Preserve useful business descriptions. An
application whose header carries its own name and line (Object Browser, System settings) keeps that header where it has
a single page — the open-source Object Browser, or an account that may open only one of its pages — without tabs.

Ontology Manager catalogs, graph, modeling and business knowledge use the shared `compact` header variant: a single
title/actions row in the page gutter and no standing generic description. Detail headers show the selected entity
name. Standard administrative headers retain useful descriptions; do not suppress them through global CSS.

Headers and content share one gutter, written once in the shell (`platform-page-gutter`): the header carries it, and
the frame or page that shows content under a header puts the class on the element holding that content, so no page
writes a side padding of its own and wrappers do not accumulate padding. A page drawing its own header takes the class
under it; a page another application hosts gets it from that host. Several panes under one header — a list and its
detail, an explorer, a canvas and an inspector — sit together in one block inside the gutter, with the table's 1px
border and 8px radius and hairlines between them: the page's content, like a table, not a card. Application tabs use a
40px row; a page's own tabs remain inside its content. Tabs may scroll horizontally on narrow widths, retaining keyboard
focus. Content fills remaining space; toolbars are plain rows, filters have labels, empty states stay in their content
area.

## 8. Shared components

| Component | Contract |
|---|---|
| Button | 32px, primary/neutral secondary/text/danger; one primary per action region; no gradient/glow/hover movement |
| Input/select | 32px, surface, strong border, 6px radius, semantic placeholder/focus/error/disabled, accessible label |
| Navigation | 32px, 16px icon, 8px inset, body-sm; selected background + ink text and persistent non-colour cue |
| List | 44px two-line reference, 13px primary / 12px metadata; no individual card frames or shadows |
| Table | 36px head, 40px row (32 compact), 1px border, 8px radius, sunken head; no zebra by default |
| Tag | 20px, 4px radius, caption; soft category/status fill, no decorative solid-primary tags |
| Dialog/drawer | Raised, 12px, modal shadow, shared title/padding/footer; adapt to task and viewport; body can scroll |
| Toast | Raised, 8px, overlay shadow, status icon + concise message; consistent duration/position |
| Empty state | Quiet 40px icon, small heading, short description, at most one primary action |
| Form | Shared labels, required/error/help, spacing, disabled treatment and submit/cancel placement |

Table alignment follows data type, numeric values are tabular, long cells use deliberate wrap/truncation, and
pagination/filter/error/loading treatments are consistent. Preserve readable headers and action reachability at zoom.
A table fills the width it is given; when its columns need more, it scrolls sideways inside its own border (a row's
actions column may stay pinned at the right), and nothing of it is cut off.
Do not constrain a complex editor to a small generic modal or remove functionality for visual simplicity.

Manager-specific button integration lives in `ontology-manager/src/buttons.css`, scoped to `.ontology-manager`
including instance-local overlays. Manager page actions and icon-only tools use a compact 28px minimum height with
13px text, 16px icons and restrained horizontal padding. Dialog/drawer footer actions retain a 32px minimum height.
Buttons may grow for wrapped text; do not shrink labels to fit. This task-specific density does not change the
platform's general control baseline.
Save/create/apply/approve are primary; navigation, refresh, preview and local add operations are neutral; delete is
danger plain/link. Status colours describe results rather than creating extra competing action hierarchies. Loading
uses a progress cursor; disabled tools retain their box and never acquire an enabled hover background. Narrow headers
wrap labelled actions instead of hiding their text with zero font size. Record/list buttons retain their own layout.

## 9. Agent conversation

The column belongs to the application and is drawn by the conversation shell; from top to bottom: its head, a new
conversation, the application's own pages, the recent conversations, and the application's own entry at the foot. The
head is the agent switcher when the application runs on several agents — the current agent's name and a dropdown of
the agents, each with its name and one line of description, the current one checked — and the application's name when
it runs on one. The Agent Platform's column holds only a new conversation, the recent conversations and Agent settings
at the foot. Agent settings replace the column with their own navigation (back to the conversation, the agents, a new
agent, the capability library) while the main area edits the chosen agent.

User messages are right-aligned on sunken bubbles; assistant answers are plain reading text without a bubble, with
maximum reading width around 960px. Answers dominate; process, tools and provenance are quiet expandable disclosures.
Do not expose all technical detail by default. Keep evidence accessible without hiding warnings/failures.

Rhythm: question→response 24px; response→next question 36px; answer blocks 12px; process/actions 8px. One owner per
gap. Tools use 13px/20px and restrained inset details. All message actions, including host slots, share
`shell-message-action`. Composer has a 40px minimum control, pill geometry, owned elevation, focus and multiline growth.
Never apply composer geometry to ordinary inputs. Preserve streaming, cancellation, feedback and artifact behaviour.

## 10. Technical workspaces

Quiet canvas, no decorative background/card, intentional grid where useful, stable zoom/pan and consistent controls.
Under a standard header the canvas and its panels sit in the page's one bordered block (§7), the canvas in the page
tone.
Inspector docks right with 320px reference width, independent scroll and 1px separator. Graph nodes reference 28px,
stable categorical colour, 2px surface ring and selected primary ring; caption labels. Edges use 1px strong line and
muted labels. Exact graph/editor dimensions may follow the technical task rather than a generic form rule.

## 11. Interaction states

Navigation hover is derived from ink mixed lightly over the actual rail/panel background, owned by the brand
generator (`--shell-rail-hover`, `--shell-panel-hover`). Selection retains each band's existing brand-tinted fill,
ink text, semibold label and readable link-coloured icon. Hovering a selected row uses its selected-hover derivative,
never the unselected hover fill. Keyboard focus adds an independent inset outline; unavailable items do not hover.
Conversation history follows the same panel rules. No new page-specific palette or geometry is introduced.

Implement default, hover, focus, pressed, selected, disabled, loading, success, warning and error consistently.
Hover never shifts geometry. Selection has an explicit semantic/non-colour cue (weight/checkmark/aria state).
Focus is visible, progress is clear without uncontrolled jumps, errors are useful, destructive actions explicit.
Keyboard operation and names are required. Shared components own state treatment.

## 12. Accessibility and responsiveness

WCAG AA text contrast, visible focus, semantic headings/landmarks, keyboard access, named icon actions, appropriate
tooltips, no colour-only essential information, no clipped zoomed content, usable touch targets and reduced motion.
Acceptance covers 1440×900, 1280×720, narrow panels, 200% zoom and both themes for both applicable editions.

## 13. Engineering rules

Before broad edits audit applications/routes, shared and duplicated components, token/brand/global/local CSS,
Element Plus overrides, third-party styling, theme persistence and screenshot/unit/E2E infrastructure. Maintain a
page inventory recording route/layout/components/styles/theme/problems/risks/implementation/visual status. No silent
omissions. Inventory component families from shell to graph/editor and identify their authoritative implementation.

Preserve routes, APIs, data, permission checks, interactions and responsive behaviour. No styling-only dependencies,
unnecessary component replacements, generated-artifact edits, hidden information-architecture changes or functional
removal. Record unavoidable functional changes separately. Protect unrelated work. Use existing checks and conventions.

CSS ownership: foundation tokens; edition brand; components.css for shared control treatment; platform shell geometry;
application navigation; PlatformPageHeader; shared controls; page composition; technical canvas-specific rules.
Avoid global selectors that affect unrelated components and `!important` except documented third-party conflicts.
Remove obsolete styling after migration, not temporary overrides. Do not begin with blind variable replacement.

## 14. Execution workflow

1. **Audit:** architecture/routes/components/tokens/duplication/themes/inconsistencies/functional risks; no broad rewrite.
2. **Foundation:** token compatibility, both brands/themes, mappings/type/space/radius/states; render a reference surface.
3. **Shell:** rail/app/column/header/inspector/responsiveness; check every application.
4. **Components:** buttons→inputs→navigation→lists→tables→forms→overlays→status→feedback; safely remove duplicates.
5. **Applications:** settings/admin→Manager→Browser→Dashboards→Schedules→Operations→Governance→Agents→complex editors.
6. **Conversation:** hierarchy/rhythm/Markdown/tables/charts/tools/evidence/artifacts/composer/loading/errors.
7. **Acceptance:** rendered matrix, fix regressions, then record acceptance.

Proceed in manageable phases; do not stop at the plan. Maintain exact progress and remaining work across sessions.

## 15. Visual acceptance

Every page needs actual rendered inspection: populated/empty/loading/error, long names/IDs/descriptions, large tables,
dropdowns/dialogs/drawers, selection, disabled/focus and permission restrictions. Agent pages additionally require
short/long conversation, multiple/expanded tools, Markdown, tables, charts, artifacts and expanded composer.

A page is accepted only when shell/header/type/spacing/colours/control dimensions/states are correct; there are no
unnecessary frames/shadows, clipping or overlaps; themes, keyboard and business functions work; no new console error
or layout regression. Capture before/after at the same viewport/data/state, inspect both themes, keep representative
references. Screenshots aid rather than replace review. A fixture must be identified as such; do not call it a live
business or permission acceptance. A successful build does not establish visual acceptance.

## 16. Completion and reporting

Statuses: **Not started**, **In progress**, **Implemented** (basic checks), **Accepted** (visual + functional).
Report modified files, new shared components, token changes, applications/pages completed and incomplete, tests/builds,
screenshots, remaining issues and functional risks. Track each page in UI-MIGRATION.md; never mark all accepted due
to global CSS. Real configuration, credentials and runtime data must not enter the report or screenshots.

## 17. Non-negotiable rules

No hard-coded business colours, independent page design systems, unnecessary floating cards/shadows, decorative
control gradients, filled decorative tags, meaningless status colour, inconsistent control sizes or arbitrary radii.
No unjustified duplicate components, functionality removed for appearance, false acceptance, theme mixing, clipped
fixed-height content or pages left outside inventory. Record justified exceptions by purpose in the shared rule.

## 18. Execution instruction

Modernize the whole product through audit, plan, foundations, shared components, application passes and actual
verification. Preserve business logic, contracts, permissions and information architecture. Do not claim completion
from builds alone. If a phase remains blocked, record exact progress and continue from the ledger. The outcome is
one professional, consistent, readable, efficient, accessible and maintainable product with task-appropriate frames.
