---
version: 0.3
name: Ontomato Product UI
description: >
  The design system for the Ontomato product interface: the Agent Platform (workbench,
  its admin pages) and the Ontology Service (formerly the Ontology Manager). It owns the shared foundation that every edition inherits — layout, density,
  type, spacing, shape, motion and component rules — and the open-source brand layer: a
  calm, editorial palette of warm paper, olive ink and leaf green taken from ontomato.ai.
status: >
  Implemented 2026-11-04. Every value is written once, in code: the foundation (type,
  spacing, shape, density, shell sizes, elevation, motion) in `@ontomato/design-tokens`
  `src/foundation.css`; the colours of each edition in its brand source — open source
  `@ontomato/design-tokens` `src/oss.ts`, enterprise `packages/brand-enterprise`. This file
  defines only the roles, their names and the rules; it holds no values.

# ── Shared foundation (all editions) ─────────────────────────────────────────
# Values and CSS variables: packages/design-tokens/src/foundation.css (its comments name
# the role each variable serves). Below: role names and what each is for.

typography:
  font-sans: the system UI stack for all text, including Chinese; no web fonts
  font-mono: identifiers users must recognise exactly
  caption:   meta only — timestamps, counts, ids under a name, tags
  label:     group headings, semibold, muted
  body-sm:   tables, list rows, form labels, buttons
  body:      default UI text
  reading:   chat answers and long text, on the content-max column
  title-sm:  small headings, semibold
  title:     page and dialog titles, semibold
  title-lg:  large headings, semibold
  display:   welcome and empty states only
  mono:      API names, field paths, SQL, DSL

spacing: 4px grid, steps --spacing-xs … --spacing-2xl

rounded:
  xs:    tags, checkboxes, inline code
  sm:    buttons, inputs, selects, segmented controls
  md:    cards inside content, menus, popovers, list-row highlight
  lg:    dialogs, drawers
  full:  avatars, status dots
  shell: shell panels sit edge to edge (no radius)

density:
  control-sm:  table row actions, inline filters
  control:     default button / input / select (Element Plus default size)
  control-lg:  login form and the chat composer only
  nav-row:     sidebar navigation, conversation history, tree rows
  list-row:    two-line rows (name + id / description)
  table-head:  table head
  table-row:   table rows
  table-row-compact: compact table rows
  page-header: page header
  panel-header: panel header

shell:
  platform-rail:            the platform's ground layer, expanded (196px)
  platform-rail-collapsed:  the same rail, collapsed to icons (58px)
  rail-button:              the rail's expand/collapse control, and an icon row when collapsed
  application-radius:       the radius of the corners where an application meets the rail (16px)
  application-column:       an application's own column, when it draws one (244px)
  page-gutter:              the one horizontal padding of a page and of its header (28px)
  conversation-gutter: Agent Platform, gap around the raised conversation panel
  conversation-radius: Agent Platform, radius of the raised conversation panel
  composer-height:     Agent Platform, pill composer (radius = height / 2)
  list-panel:          list panel
  inspector:           right-docked inspector
  content-max:         reading width for chat answers

elevation:
  flat:     everything in the data shell's page flow
  panel:    Agent Platform conversation panel only
  composer: Agent Platform composer only
  overlay:  dropdown, popover, toast (ring in `line`)
  modal:    dialog, drawer (ring in `line`)

motion:
  fast: hover, press
  base: expand, tab switch
  slow: drawer, dialog

# ── Brand layer (per edition) ────────────────────────────────────────────────
# Values: the edition's brand source (open source `@ontomato/design-tokens` src/oss.ts,
# enterprise `packages/brand-enterprise`), typed by `BrandSource` in
# `@ontomato/design-tokens` src/index.ts, whose keys are the camelCase of these roles.
# Every role has one value per mode (light, dark).

colors:
  canvas:        shell panels — list panel, admin navigation
  surface:       workspace, tables, forms, input fills
  raised:        overlays (with elevation.overlay)
  sunken:        inset wells, code blocks, table head
  hover:         hover background
  line:          hairline dividers and borders
  line-strong:   control borders
  ink:           primary text
  ink-2:         regular text
  muted:         secondary text
  placeholder:   placeholders, at least 4.5:1 on surface and raised
  faint:         disabled text only (exempt from contrast)
  primary:       actions, links, focus
  primary-hover: filled primary hover; on-primary keeps at least 4.5:1
  primary-press: filled primary active state
  on-primary:    text on filled primary
  primary-soft:  the selected state
  link:          optional — primary-coloured text where primary itself is under 4.5:1 as text
  brand-mark:    optional — the logo mark only, never a text or button colour
  accent:        brand signature only, never a state
  accent-ink:    accent as text
  accent-soft:   accent fill
  rail:          the platform rail: the ground layer of the shell
  panel:         an application's own column or menu, drawn inside its area
  workspace:     an application's main area; its page background
  rail-selected: the selected row on the rail
  panel-selected: the selected row in an application's column or menu
  edge:          the hairline between the rail and the application, a translucent tone
  success:       status, with an icon or label
  warning:       status, with an icon or label
  danger:        status and destructive buttons, with an icon or label
  info:          neutral notes

dataviz:
  categorical: 8 colours per mode in a fixed order, validated (CVD ΔE ≥ 8, normal ΔE ≥ 15, ≥ 3:1 on surface)
  sequential:  primary, one hue light → dark
---

# Ontomato Product UI

## Applications and shells

The product is one platform with several applications. They share this design language (colour
roles, type, density, controls, navigation rows, group labels) and one platform shell; each
application owns the area the shell gives it and organises its own pages there.

**Two layers.** The platform rail is the ground. The current application is one surface on top
of it: it fills everything to the right of the rail, with no margin above, right or below, and
is rounded only at the two corners where it meets the rail (`shell.application-radius`). One
hairline (`edge`) separates it from the rail. There is no shadow: the surface is a layer, not a
floating card.

The platform draws the rail and nothing else. A second column and a page header are pieces an
application may use (`AppPanel`/`AppPanelPages`, `PlatformPageHeader`); the platform never draws
them on an application's behalf.

**The rail.** Collapsed by default: the expand control at the top, then application icons, each
named by its tooltip and its accessible name. Expanded: the brand mark, the product name
(Ontomato), the collapse control, and the application names. The rail is a launcher — the
applications open full page beside it — and remembers the reader's choice.

Its rows sit in three sections separated by a hairline and named by no heading:

1. the ontology applications: Ontology Manager, Object Browser;
2. the business applications: Agent Platform, Operations diagnosis, Knowledge governance,
   Dashboards, Scheduled tasks — and, in the enterprise edition, the external Data Governance
   Platform last among them (it opens in a new tab and is never current);
3. the platform's own settings above the account: Permissions (enterprise), System settings.

An application's row opens its own entry (its first page, or the conversation). `app-builder` is
not built yet and is not listed.

**Applications.** Each application shows one of these frames inside its area:

| Application | Frame |
|---|---|
| Agent Platform (智能体平台), Operations diagnosis, Knowledge governance | conversation column: its own column, then the conversation |
| Ontology Manager (平台的前身本体服务) | its own menu (ontology, assets, knowledge) in its band, pages beside it |
| Object Browser, System settings | header with tabs; the page's own second-level tabs stay in the page |
| Dashboards, Scheduled tasks, Permissions | one page: header and page |

**Conversation applications.** The column belongs to the application and is drawn by the
conversation shell. From top to bottom: its head, a new conversation, the application's own
pages, the recent conversations, and the application's own entry at the foot. The head is the
agent switcher when the application runs on more than one agent — the current agent's name and a
dropdown of the agents, each with its name and one line of description, the current one checked
— and the application's name when it runs on one. The Agent Platform's column holds only a new
conversation, the recent conversations and "smart-agent settings" at the foot; its settings
replace the column with the settings' own navigation (back to the conversation, the agents, a
new agent, the capability library) while the main area edits the chosen agent.

**Agent apps.** An agent app is one agent plus a few pages, one page per piece of business,
each able to finish that business without the agent. It has three states: the conversation
alone; the conversation with one page beside it (a raised side panel of the artifact
panel's geometry, draggable width); and the page full, with the composer below it. The
column's page entries open a page full; collapsing it, sending from it, or opening an in-app
link from an answer puts it beside the conversation; closing it returns to the
conversation. The same page component serves both widths, so pages stay usable at the side
panel's width (360px and up), stacking split panes below a 720px container. Messages sent
while a page is open carry one line naming the page and its selection. The side panel is a
container, not something authored: it shows a page (written in code) or an expanded card
(an artifact the agent produced, which cannot write data). Results people need later live
on the page, not only in the conversation.

**Page applications.** One page that fills the area, under one header: the title, one line of
description below it, the page's own buttons at the right, and — for an application of several
pages — its tabs in a row under them. There is one header component for every page; an
application of several pages shows the application's name there and switches between its pages,
and a page that holds several screens keeps its own second-level tabs in the page. The
Dashboards' boards are tabs of their own page, and the Scheduled tasks' filters carry labels.

The header and the page share one horizontal padding (`shell.page-gutter`), written once: a
title, a toolbar and the content under them start at the same place, and a page never writes a
gutter of its own. A page that draws its own header carries that header's gutter instead.

**Addresses.** An application owns the addresses under its prefix. Old addresses that changed
home redirect in the front end: `/agents/dashboards` → `/dashboards`, `/agents/schedules` →
`/schedules` (carrying the agent it was narrowed to), `/agents/settings?tab=capabilities` →
`/agents/settings/capabilities`.

**Colour roles.** Three bands, each with its own role: the rail (`rail`), an application's own
column or menu (`panel`), and the application's main area (`workspace`). In light mode the rail
is the darkest and the main area the lightest; in dark mode the order reverses and the main area
is the darkest. `edge` is the hairline between the rail and the application, a translucent tone
rather than an opaque colour.

**Light and dark.** Each mode is uniform: every band of one mode belongs to that mode. No dark
rail beside a light application.

**Brand mark.** The rail carries the product's mark, not an application's: the current
application is named by its row and by its own header, not by a second mark.

## Scope and ownership

This file covers the product interface: the Agent Platform (agents, conversations, answers,
and its function-area pages) and the Ontology Service. The marketing site keeps its own styles.

It has two layers:

- **Foundation** — type, spacing, shape, density, shell layout, motion and component rules.
  Its roles and rules are owned here and its values in `foundation.css`, for every edition.
  An edition never redefines it.
- **Brand** — the values of the colour roles (light and dark), the chart palette and the
  brand mark. Each edition writes them in its one brand source; this file defines the roles
  and the open-source brand rules. Another edition states its brand rules in its own
  DESIGN.md and inherits everything else from here.

Where the values live in code:

| Layer | Code owner |
|---|---|
| Foundation variables | `@ontomato/design-tokens` — `packages/design-tokens/src/foundation.css` |
| Brand types and generator | `@ontomato/design-tokens` (`src/index.ts`) |
| Open-source brand source | `@ontomato/design-tokens/oss` |
| Enterprise brand source | enterprise `packages/brand-enterprise` |

`@ontomato/design-tokens` has no runtime dependencies; both applications depend on it and
not on each other's packages. One brand source per edition generates the Agent Platform
theme, the Ontology Service presentation and the graph `nodePalette` (one per mode, the
`dataviz` order), and the Agent Platform's dashboard and chart colours. No other file
declares a generated brand variable (the single-source tests guard this).

### Colour roles → Element Plus

Roles map onto the Element Plus 2.13 variables the code uses everywhere, following
Element Plus's own meaning of each variable. Only roles Element Plus lacks have their own
variables.

| Role | Variable | Element Plus uses it for |
|---|---|---|
| canvas | `--el-bg-color-page` | page background |
| surface | `--el-bg-color` | components, tables |
| raised | `--el-bg-color-overlay` | dialogs, popovers, dropdowns |
| sunken | `--el-fill-color` | fills, wells (table head via the component variable below) |
| hover | `--el-fill-color-light` | table row hover, option hover, disabled background |
| selected = primary-soft | `--el-color-primary-light-9` | table current row, menu hover, light tags |
| line / line-strong | `--el-border-color` / `--el-border-color-dark` | borders |
| ink / ink-2 / muted | `--el-text-color-primary` / `-regular` / `-secondary` | text |
| placeholder | `--el-text-color-placeholder` | placeholders; also the default disabled text |
| faint | `--el-disabled-text-color` | disabled text (overridden at `:root`) |
| primary / press | `--el-color-primary` / `--el-color-primary-dark-2` | actions, focus; active state |
| link | `--brand-link` (enterprise defines it; open source uses primary) | every place primary is used as **text**: links, text and link buttons, active tab and menu item, selected option |
| primary tint | `--brand-primary-tint` (primary at 10% over `surface`) | fill behind primary-coloured text: primary tags, plain primary buttons |
| primary ladder | `--el-color-primary-light-3/5/7/8` | derived the Element Plus way: primary mixed with `surface` at 30/50/70/80% |
| primary-hover | `--brand-primary-hover` | applied through the button variables below |
| on-primary | `--on-primary` | applied through the button variables below |
| success / warning / danger / info | `--el-color-*` and their `-light-8/-light-9` | status |
| brand-mark, accent, accent-ink, accent-soft | `--brand-mark`, `--brand-accent`, `--brand-accent-ink`, `--brand-accent-soft` | — |
| chart 1–8 | `--chart-1` … `--chart-8` | — |

Element Plus component variables that must be set, because the global ones above do not
reach them or carry a different meaning:

| Selector | Variables |
|---|---|
| `:root` | `--el-disabled-text-color: faint` |
| `.el-button--primary` | `--el-button-text-color`, `--el-button-hover-text-color`, `--el-button-active-text-color`: `var(--on-primary)`; `--el-button-hover-bg-color`, `--el-button-hover-border-color`: `var(--brand-primary-hover)` (Element Plus defaults to the lighter `light-3`; `primary-hover` is chosen per mode so on-primary text keeps at least 4.5:1); disabled uses the disabled roles, not a paler primary: `--el-button-disabled-bg-color: var(--el-fill-color-light)` (`hover`), `--el-button-disabled-border-color: var(--el-border-color-light)`, `--el-button-disabled-text-color: var(--el-disabled-text-color)` (`faint`) (Element Plus's `light-5` fill under on-primary text looks enabled in dark mode) |
| `.el-table` | `--el-table-header-bg-color: var(--el-fill-color)`; row hover and current row keep the defaults (`hover`, `selected`) |
| `.el-menu` | `--el-menu-hover-bg-color: var(--el-fill-color-light)` (default is the selected colour); `--el-menu-item-height: var(--nav-row-height)` |

No edition gives the sidebar a colour of its own: it sits on `canvas` with `ink-2` text and
`muted` meta; the current row is `selected` with `ink` text.

## Principles

1. **Data is loud, chrome is quiet.** Users come for answers, tables and the ontology
   graph. Frames, panels and navigation recede: no floating cards in the data shell, no
   coloured shadows, no gradients on controls. The conversation shell lifts exactly one
   panel, the conversation, so the eye lands on it.
2. **Density by default.** Operators scan lists of objects, fields and runs. Rows are
   32–44px, tables 40px, controls 32px. A screen should show a full list page of 15+ rows
   at 1440×900 without scrolling.
3. **Separate by tone and hairline, not by gaps.** Shell panels butt against each other
   and differ by surface tone (`canvas` vs `surface`) plus one 1px `line`. Whitespace is
   for grouping content, not for framing containers.
4. **Every colour has one job.** Primary means "you can act here"; as text it is always the
   `link` role, and text on a selected row is `ink`. Status colours mean
   state and always come with an icon or label. The accent is a brand signature, never a
   state. Chart colours mean identity and follow the entity, never the rank.
5. **Light and dark are both first-class.** Dark is designed with its own steps, not
   inverted; every pair in this file is contrast-checked in both modes.

## Layout

### Shell

Two layers, not three columns:

```
┌──────┬──────────────────────────────────────────────────┐
│ rail │ application                                      │
│ 58px │ one surface, rounded at the two left corners      │
│ rail │ ├ column/menu (panel) ─┬─ main area (workspace) ─┤ │
│      │ │ the app's own        │ page header 48px      │ │
│      │ │ navigation           │ page                  │ │
└──────┴──────────────────────────────────────────────────┘
```

- The rail is the ground and is full height; the application fills everything to its right
  with no margin above, right or below, rounded `application-radius` at the two corners where
  the two meet, divided from the rail by a 1px `edge` and by no shadow.
- The rail is `platform-rail` wide expanded (196px) and `platform-rail-collapsed` collapsed
  (58px); it starts collapsed. Below 760px the two layers stack, the application taking the
  full width and rounding its top corners instead.
- Inside an application, its own column (`panel`, `application-column` wide) and its main area
  (`workspace`) are divided by a 1px `line`. An application without its own column uses the
  whole surface.
- An inspector (path search, element details) docks on the right at 320px with the same
  rule: hairline, no card.

### Admin page anatomy

- **Page header, 48px:** title (`title`) on the left; the one-line description is muted
  `body-sm` after the title or in a tooltip; primary and secondary actions on the right.
  Toolbars are not wrapped in a card — filters sit in the header row or one 40px row below.
  An application of several pages puts them in the header as tabs (a 40px row under the title,
  on the `line` the header closes with); a page that holds several screens keeps its own tabs
  in the page, under the header.
- **Content:** the table or form fills the remaining width with 16px padding. A table is a
  bordered surface with `rounded.md`; it does not float on a shadow.
- **Admin navigation:** an application's own column or menu, on `panel`, `application-column`
  wide, with 32px `nav-row`s and `label` group headings. The Ontology Manager's three groups
  are its menu; the conversation applications' columns are the conversation shell's.

### Grid

4px spacing grid. Panel padding 12px; page content padding 16px (24px max on wide
screens); gap between related controls 8px, between groups 16px.

## Typography

- One sans stack — the system UI font — for all text, including Chinese. No web fonts in
  the product (offline deployments, CJK coverage).
- Default UI text is `body` 14px. Tables, list rows, form labels and buttons use
  `body-sm` 13px. Chat answers and long text use `reading` 15px on the 960px column.
- Headings stay at 600; there is no 700/800 display weight inside the product. `display`
  appears only on welcome and empty states.
- `label` is for group headings ("Agents", "History", "Object types"): 12px, 600, muted.
- `mono` is for identifiers users must recognise exactly: API names (`tech_duty`), field
  paths, SQL, DSL. Numbers in tables use `font-variant-numeric: tabular-nums`.
- Readability floor: content people read (cell values, names, answers, form text) is never
  below 13px; 12px is only for meta (timestamps, counts, ids under a name, group labels,
  tags). Text colours meet 4.5:1 on the surface they sit on, placeholders included.

### Acceptance viewports

The density is tuned for 1440×900 at 100%. Every screen must also work at 1280×720 (no
clipped headers or actions; the agent rail collapses) and at 200% browser zoom (content
reflows, nothing overlaps). There is one density; a looser "comfortable" mode is added
only if field use shows it is needed.

## Colour

### Open-source palette

The palette comes from ontomato.ai: warm paper (`canvas`), olive ink, leaf green and a
tomato accent. It should feel like a well-set technical document.

- **Primary is leaf green**, not the logo green (`brand-mark`). The logo green under white
  text fails body-text contrast, so it stays on the brand mark.
- **Sage (`primary-soft`)** is the selected state: current nav row, selected table row, active
  segment.
- **Tomato is the accent**, used only for brand moments: the brand mark, the emphasised
  word in a welcome or empty-state headline, and illustrations. It is never used for
  links, buttons, selection, status or charts, because red reads as error.
- **Accent text and danger share one red on purpose.** The website's red is the brand,
  and a second, different red in the product would read as two errors. They cannot be
  confused because they never meet: accent text appears only in welcome and empty-state
  headlines, which carry no status, and danger always comes with an icon and a verb
  ("Delete", "Connection failed").
- **Dark mode** keeps the warm olive tint in every neutral; primary becomes a light green
  with dark `on-primary` text on it.

### Status

| State | Rule |
|---|---|
| success | icon + label |
| warning | icon + label |
| danger  | icon + label; destructive buttons |
| info    | same value as `muted`; neutral notes |

Status tags use the soft fill (status at ~10% over `surface`) with status-coloured text;
every pair stays at or above 4.5:1 on that fill.

### Charts and the ontology graph

- Object-type nodes in the ontology graph and chart series take colours from `dataviz`
  in fixed order; a type keeps its colour on every view (hash the type id to a slot, not
  its position in the current list).
- More than 8 series fold into "Other" or small multiples; never generate extra hues.
- Magnitude uses one hue (primary) light → dark. No rainbow scales.
- Labels and values are in ink colours; the coloured mark carries identity.

## Shape and elevation

- Controls `sm` 6px; content cards, menus and row highlights `md` 8px; dialogs `lg` 12px.
  Pills only for avatars, status dots and count badges.
- Nothing in the data shell's page flow has a shadow. Overlays (dropdown, popover, toast)
  get `elevation.overlay`; dialogs and drawers get `elevation.modal`. In the conversation
  shell only the conversation panel (`elevation.panel`) and the composer
  (`elevation.composer`) are raised. Primary buttons have no glow.

## Components

**Button.** 32px, `rounded.sm`, `body-sm` 500. One primary (filled) button per view
region; secondary is `surface` with a `line-strong` border; tertiary is text-only. Table
row actions are 24px text buttons. The chat send button and login submit may use 40px.

**Input / select.** 32px, `surface` fill, `line-strong` border, `rounded.sm`; focus is a
1px primary border plus a 2px primary ring at 20% opacity. Placeholder in `placeholder`.

**Navigation row.** 32px, `rounded.md` highlight inset 8px from the panel edge, 16px icon,
`body-sm`. Hover → `hover`; current → `selected` with `ink` text and 600 weight. Counts
right-aligned in `caption` muted.

**List row (two lines).** 44px: name in `body-sm` 500, id or description in `caption`
muted (ids in `mono`). Rows are not cards: no border, no shadow, highlight on hover only.

**Conversation history.** Single-line 32px rows grouped under `label` date headings
(Today, Yesterday, Earlier); relative time right-aligned in `caption`, shown on hover.

**Table.** Head 36px on `sunken`, `label` style; rows 40px (`compact` 32px), 1px `line`
between rows, no zebra stripes, hover → `hover`, selected → `selected`. The table sits in
a `line` border with `rounded.md`. The empty state lives inside the table body. A table fills
the width it is given; when its columns need more, it scrolls sideways inside its own border
(a row's actions column may stay pinned at the right), and nothing of it is cut off.

**Tag.** 20px high, `rounded.xs`, `caption` 500, soft fill. Never use a primary-filled tag.

**Segmented control / tabs.** 28px segments on a `sunken` track; the active segment is
`surface` with `ink` text. Page-level tabs are text tabs with a 2px primary underline.

**Dialog.** `raised`, `rounded.lg`, `elevation.modal`, 20px padding, header `title`,
footer actions right-aligned. Widths: 480 / 640 / 880.

**Toast.** `raised`, `rounded.md`, `elevation.overlay`, status icon + one line.

**Empty state.** Centred in its container: a 40px muted icon, one `title-sm` line, one
`body-sm` muted line, at most one primary action. No large illustrations in admin pages.

**Chat answer.** Question as a right-aligned `sunken` bubble (`rounded.lg`); answer as
plain `reading` text on `surface` with no bubble. Tables and charts in answers use the
table and chart rules above. Trace and evidence ("why this answer") collapse under a
`label` disclosure row.

**Graph node.** 28px circle in its categorical colour with a 2px `surface` ring; label in
`caption` below; selected node gets a 2px primary ring. Edges are 1px `line-strong` with
`caption` muted labels.

## Do and don't

**Do**
- Fill the shell edge to edge and separate panels with tone and a hairline.
- Keep rows at 32–44px and tables at 40px; show more data per screen.
- Use primary for actions and focus only.
- Give every status an icon or label.
- Check both modes before shipping a screen.

**Don't**
- Don't wrap panels, toolbars or tables in floating cards with outer gaps (the conversation
  panel of the Agent Platform is the one exception).
- Don't use coloured shadows or gradients on buttons, or glows on focus.
- Don't use logo green for text or buttons, or tomato for anything interactive.
- Don't hard-code hex colours in components; use the role variables.
- Don't render a list as a stack of cards.
