---
name: ontomato-app-builder
description: "Compose and check panel application source with the Ontomato SDK. Use when building a panel or moving an existing page into the product layer."
---

# Ontomato app builder

## How Ontomato fits together

Ontomato is an ontology-driven platform. Applications are built as product-layer Vue panels (`panel.html`, `panel.mjs`,
`panel.json`, optional `recipes.md`) whose projections bind official SDK components to owner-declared reads,
MetricViews, and Actions. Business data, calculations, and permission checks always stay with their owners; the same
registered panel works full-page, beside a conversation, and under page-assistant control.

Build an application in three stages:

1. **Model the ontology and load data** — classes, properties, relations, and business records.
2. **Define capabilities, workflows, agents, and permissions** — MetricViews for calculated reads, Actions/Workflows
   for writes, roles/grants, and Agents where needed.
3. **Assemble and check application source (this skill)** — inspect available reads and operations (`panel type`), pick
   components from the two-layer SDK catalogue (`sdk read docs/components.md` → `sdk read docs/components/<Name>.md`),
   write the [application source tree](GUIDE.md#application-source), run `panel check`, and commit the changes.

**What other skills handle:**

| Area | Skill |
| --- | --- |
| Build ontology, mappings, and import business/test data | `ontomato-ontomap-builder` |
| Author Actions or MetricViews | `ontology-generation`, `metricview-generation` (or this skill's [GUIDE.md](GUIDE.md): `action save` → `action trial` → `action publish` and `metric-view generate`) |
| Build and publish multi-step business workflows & triggers | `ontomato-workflow-maker`, `ontomato-process-admin` |
| Set up organizations, roles, and API/menu/data permissions | `ontomato-process-admin` |
| Data retrieval, Q&A, and agent analysis | `ontomato-analyst`, `ontomato-analyst-assistant` (configure agents in platform agent settings / `platform:AgentDefinition`) |

## Publishing and synchronization

Edit and commit application source files. Publish and synchronize through the registered Application Builder
page operations. Under section 2.4.2 an agent may request either operation, and the page submits it after
the user confirms. Use this flow for changes to a published application.

## Essential commands

Run through `node "$SKILL/scripts/ontomato.mjs"` (the checker validates manifest
structure, allowed imports, CSS/UI guardrails, and bindings automatically):

```text
sdk current                              # current SDK release info
sdk read docs/components.md              # grouped overview of panel-usable components (a few KB)
sdk read docs/components/<Name>.md       # one component's full data, config, slots, and events
panel type <id> [--read <name>]          # object type reads, parameters, resultSchema, and operations
panel projections [--component <id>] [--object-type <typeId>] [--q <text>]  # find reusable projections
panel scaffold <type> <new-dir>          # scaffold an application with catalog and detail panels
panel check <dir>                        # validate sources, declarations, and bindings
```

There is no `sdk list` or top-level `read ObjectType`. For `<sdk-*>` UI primitives and `--sdk-*` theme tokens, read
`sdk read docs/components/ui-primitives.md` and `sdk read docs/components/theme-tokens.md`. `sdk read docs/reference.md`
is the full API reference — look up on demand, do not read upfront.

## What you want to do → where to look

Start here: pick the row for your task and read only that recipe or component page.

| What you want to do | Where to look |
| --- | --- |
| Browse available panel components by purpose | `sdk read docs/components.md` (then `sdk read docs/components/<Name>.md`) |
| Find reusable projections by component or bound object type | `panel projections [--component <componentId>] [--object-type <typeId>] [--q <text>]` (filters full visible catalogue before paging) |
| Pick a starter page layout (catalog + detail, split editor, modal edit, app frame) | [Page templates](references/templates/README.md) · [Panel authoring guide](references/panel-authoring/SKILL.md) |
| Move an existing page into the product layer | [Migrate an existing page](references/migrate-existing-page.md) · [App decomposition](references/app-standard/SKILL.md) |
| Lay out a page, `<page-header>`, split panes, button roles, and container responsiveness | [Layout & page header](references/panel-authoring/recipes/layout-and-page-header.md) · `sdk read docs/components/PageHeader.md` · `TwoPaneLayout.md` |
| Use `<sdk-*>` dialogs, drawers, notifications, and scoped CSS rules | [Controls & guardrails](references/panel-authoring/recipes/controls-and-guardrails.md) · `sdk read docs/components/ui-primitives.md` |
| Navigate between entries with flat named URL parameters (`deepLink`, `panelAddress`) | [Flat URL parameters](references/panel-authoring/recipes/url-parameters.md) |
| Decide between official defaults, `config`, Vue slots, or a custom component | [Component vs. panel responsibility](references/panel-authoring/recipes/component-vs-panel-responsibility.md) |
| Read projection outputs (`usePanelOutput`) or wire one member's output to another | [Projection outputs](references/panel-authoring/recipes/projection-outputs.md) |
| Show a list, table, card grid, tabs, or grouped grid | `sdk read docs/components/ObjectList.md` · `sdk read docs/components/GroupedGrid.md` |
| Filter or sort a list by field/status, or bind read parameters & component events | [Bind read parameters & events](references/panel-authoring/recipes/bind-read-parameters-and-events.md) · `sdk read docs/components/ObjectList.md` |
| Customize table columns, row detail expansion, or per-row operations | [List slots & row operations](references/panel-authoring/recipes/list-slots-and-row-operations.md) · `sdk read docs/components/ObjectList.md` |
| Display an object header, summary fields, typed value, banner, or reference card | `sdk read docs/components/ObjectHeader.md` · `ObjectSummary.md` · `TypedValue.md` · `RecordTemplate.md` · `InfoBanner.md` · `ObjectRefCard.md` |
| Build a create or edit form with Save/Discard (`ObjectForm`, `usePanelFormDraft`) | [Save a form](references/panel-authoring/recipes/save-a-form.md) · `sdk read docs/components/ObjectForm.md` |
| Wire a customer `ObjectType` form to edit/create `Action`s (including targetless Actions) | [Customer ObjectType forms & Actions](references/panel-authoring/recipes/customer-object-forms-and-actions.md) · `sdk read docs/components/ObjectForm.md` |
| Trigger a business operation button, batch action, or file upload | [Invoke owner operations](references/panel-authoring/recipes/invoke-owner-operations.md) · `sdk read docs/components/OperationButton.md` · `FileUploadControl.md` |
| Embed dashboard charts, KPI cards, counts, or single-member refresh | [Offline check & charts/SDK docs](references/panel-authoring/recipes/offline-check-and-sdk-docs.md) · `sdk read docs/components/MetricChart.md` · `MetricCard.md` · `ObjectCount.md` |
| Display an ontology or custom graph and link it to one-hop relations | [Graph & relations](references/panel-authoring/recipes/graph-and-relations.md) · `sdk read docs/components/OntologyGraph.md` · `ObjectGraph.md` · `ObjectRelations.md` |
| Select a child record or browse files, text, and annotated code | [Child records](references/panel-authoring/recipes/child-records.md) · `sdk read docs/components/ObjectTree.md` · `ObjectTextReader.md` · `AnnotatedCode.md` |
| Put a conversation entry or embedded agent chat pointing to an agent on a page | [Conversation entries](references/panel-authoring/recipes/conversation-entries.md) · `sdk read docs/components/ConversationEntry.md` · `sdk read docs/components/AgentChat.md` |
| Handle narrow containers, availability gating, and compact slot projections | [Availability & narrow containers](references/panel-authoring/recipes/availability-and-narrow-containers.md) |
| Run `panel check` offline against an installed SDK release | [Offline check & SDK docs](references/panel-authoring/recipes/offline-check-and-sdk-docs.md) |
| Check, preview, and publish application source | [Check & open](references/panel-authoring/recipes/register-and-open.md) · [Application source](GUIDE.md#application-source) |
| Debug a blank panel, empty list, or form that will not fill or save | [Troubleshooting](references/panel-authoring/recipes/troubleshooting.md) |
| Understand what the page assistant receives and verify assistant control | [Assistant context](references/panel-authoring/recipes/assistant-context.md) · [Runtime hooks](references/panel-authoring/RUNTIME.md) |
| Author customer Actions / MetricViews, CLI contract, or business tests | [Technical guide](GUIDE.md) · [Management page recipes](references/management-pages.md) · [Full standard](references/app-standard/references/standard.md) |

## Rules the author must follow

`panel check` catches structural, import, CSS, and binding errors automatically. Follow these judgment rules that
machine checks cannot enforce:

1. **Container-driven layout.** Size by container width and height (`@container`, flex, grid), never by window width or
   hardcoded viewport subtractions; the same panel must work full-page, embedded, and beside a conversation.
2. **Reads through projections, writes through declared operations.** Never render raw ontology records in panel HTML
   or call business APIs. Use `<sdk-button>` for local UI actions only; every business write invokes a declared member
   operation, and post-action updates/navigation rely on the operation outcome (never inferred from list changes).
3. **No business calculations or judgments in panels or components.** Calculations and thresholds belong in MetricViews,
   Actions, or owner reads. Use `usePanelOutput` only for wiring, visibility/equality/zero checks, or text-only slots;
   never present loaded row counts as a paged `total`.
4. **No automatic writes on display.** Writes happen only on explicit user action or an explicit agent `page_action`.
5. **Reuse first, follow lookup order.** Check existing components/panels first, advancing only when needed: official
   defaults → `config` → official Vue slots → custom domain component as last resort. Escalate missing business reads
   or Actions to the owner. Give each `ObjectList` column an explicit `labelKey` in `content.messages`.
6. **Public state, `deepLink`, and secrets.** Declare business view state and form/dialog switches in `manifest.state`.
   Set `deepLink: true` **only** on state needed to restore the same view (`selected`, `tab`, `search`, `filter`,
   `sort`) — **never** on dialog toggles or active-edit trackers. Only the human picks local files and enters/receives
   secrets (standard §2.4.2).
7. **Authoring custom components.** Never call business APIs directly; declare clear `meaning` stating what the
   component draws, can do, and when to use it.

When the platform supplies `application-design`, read it before designing or polishing a panel. For delegated retrieval,
use the product's analyst skill and follow [agent delegation](GUIDE.md#agent-delegation).
