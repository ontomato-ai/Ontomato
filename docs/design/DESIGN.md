---
version: 0.2
name: Ontomato Product UI
description: >
  The design system for the Ontomato product interface: the Agent Platform (workbench,
  its admin pages) and the Ontology Service (formerly the Ontology Manager). It owns the shared foundation that every edition inherits — layout, density,
  type, spacing, shape, motion and component rules — and the open-source brand layer: a
  calm, editorial palette of warm paper, olive ink and leaf green taken from ontomato.ai.
status: >
  Adopted 2026-11-04 with the amendments in "Applications and shells" (user decision after
  reviewing mock-ups). Not implemented yet; "Current vs proposed" lists what changes. On
  implementation the hex values move into one code source per edition (see "Scope and
  ownership") and this front matter keeps only roles and rules.

# ── Shared foundation (all editions) ─────────────────────────────────────────

typography:
  font-sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif'
  font-mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
  caption:   { fontSize: 12px, lineHeight: 16px, fontWeight: 400 }
  label:     { fontSize: 12px, lineHeight: 16px, fontWeight: 600, letterSpacing: 0.02em }
  body-sm:   { fontSize: 13px, lineHeight: 20px, fontWeight: 400 }
  body:      { fontSize: 14px, lineHeight: 22px, fontWeight: 400 }
  reading:   { fontSize: 15px, lineHeight: 26px, fontWeight: 400 }
  title-sm:  { fontSize: 14px, lineHeight: 20px, fontWeight: 600 }
  title:     { fontSize: 16px, lineHeight: 24px, fontWeight: 600 }
  title-lg:  { fontSize: 20px, lineHeight: 28px, fontWeight: 600 }
  display:   { fontSize: 28px, lineHeight: 36px, fontWeight: 600, letterSpacing: -0.02em }
  mono:      { fontSize: 12.5px, lineHeight: 18px, fontWeight: 400 }

spacing:      # 4px grid
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  5: 20px
  6: 24px
  8: 32px

rounded:
  xs: 4px      # tags, checkboxes, inline code
  sm: 6px      # buttons, inputs, selects, segmented controls
  md: 8px      # cards inside content, menus, popovers, list-row highlight
  lg: 12px     # dialogs, drawers
  full: 9999px # avatars, status dots
  shell: 0     # shell panels sit edge to edge

density:
  control-sm: 24px     # table row actions, inline filters
  control:    32px     # default button / input / select (Element Plus default size)
  control-lg: 40px     # login form and the chat composer only
  nav-row:    32px     # sidebar navigation, conversation history, tree rows
  list-row:   44px     # two-line rows (name + id / description)
  table-head: 36px
  table-row:  40px
  table-row-compact: 32px
  page-header: 48px
  panel-header: 44px

shell:
  agent-rail: 232px        # collapses to 56px icon rail below 1280px
  conversation-gutter: 10px  # Agent Platform: gap around the raised conversation panel
  conversation-radius: 18px  # Agent Platform: radius of the raised conversation panel
  composer-height: 56px      # Agent Platform: pill composer (radius = height / 2)
  list-panel: 264px
  inspector:  320px
  content-max: 960px       # reading width for chat answers

elevation:
  flat: none                                    # everything in the data shell's page flow
  panel:   "0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.04)" # Agent Platform conversation panel only
  composer: "0 6px 20px rgba(0,0,0,.08)"        # Agent Platform composer only
  overlay: "0 0 0 1px {line}, 0 8px 24px rgba(0,0,0,.10)"   # dropdown, popover, toast
  modal:   "0 0 0 1px {line}, 0 24px 64px rgba(0,0,0,.18)"  # dialog, drawer

motion:
  fast: 120ms cubic-bezier(.2,0,0,1)    # hover, press
  base: 180ms cubic-bezier(.2,0,0,1)    # expand, tab switch
  slow: 260ms cubic-bezier(.2,0,0,1)    # drawer, dialog

# ── Open-source brand layer ──────────────────────────────────────────────────

colors:
  light:
    canvas:        "#f8f8f4"   # shell panels: rail, list panel, admin nav
    surface:       "#ffffff"   # workspace, tables, forms
    raised:        "#ffffff"   # overlays (with elevation.overlay)
    sunken:        "#f1f2ec"   # inset wells, code blocks, table head
    hover:         "#eef1e8"
    line:          "#e2e5dc"
    line-strong:   "#d8dcd1"
    ink:           "#282c25"
    ink-2:         "#3d4238"
    muted:         "#62665c"
    placeholder:   "#6c7166"   # 5.0:1 on surface
    faint:         "#8a8f82"   # disabled text only (exempt from contrast)
    primary:       "#42613f"   # leaf green — actions, links, focus (white text 7.0:1)
    primary-hover: "#36512f"
    primary-press: "#2c4327"
    on-primary:    "#ffffff"
    primary-soft:  "#e8ede3"   # sage — also the selected state
    brand-mark:    "#639c2d"   # logo green — the mark only, never a text or button colour
    accent:        "#dc4b35"   # tomato — brand moments only
    accent-ink:    "#bc3928"   # same family as danger by design; see Colour
    accent-soft:   "#f3e5dd"   # blush
    success:       "#3d7a1a"   # 5.3:1
    warning:       "#946000"   # 5.3:1
    danger:        "#bc3928"   # 5.6:1
    info:          "#62665c"
  dark:
    canvas:        "#161814"
    surface:       "#1c1f1a"
    raised:        "#242822"
    sunken:        "#121410"
    hover:         "#262a23"
    line:          "#2c3128"
    line-strong:   "#3a4035"
    ink:           "#e9ece3"
    ink-2:         "#cfd4c6"
    muted:         "#a3a99a"
    placeholder:   "#8f9586"   # 5.4:1 on surface
    faint:         "#7d8376"
    primary:       "#8fbf5a"
    primary-hover: "#a0cb6e"
    primary-press: "#7dad49"
    on-primary:    "#14180f"   # dark text on light green (8.4:1)
    primary-soft:  "#2c3527"
    brand-mark:    "#8fbf5a"
    accent:        "#ef7b65"
    accent-ink:    "#ef7b65"
    accent-soft:   "#3a231d"
    success:       "#7dbb4b"
    warning:       "#d9a441"
    danger:        "#ef7b65"
    info:          "#a3a99a"

dataviz:   # categorical order is fixed; validated (CVD ΔE ≥ 8, normal ΔE ≥ 15, ≥ 3:1)
  categorical-light: ["#4a8f1f", "#3d6fd1", "#b97d08", "#0f9488", "#d4553c", "#9b4fb5", "#7a7f1a", "#d24d8a"]
  categorical-dark:  ["#68a03b", "#6a8fe0", "#b98820", "#2ba597", "#dc6e58", "#a970c8", "#919530", "#d86b9c"]
  sequential: primary   # one hue, light → dark
---

# Ontomato Product UI

## Applications and shells

Decided 2026-11-04 after reviewing mock-ups; this section overrides any older wording below.

The product has two applications with their own pages, services and shells. They share this
design language (colour roles, type, density, controls, navigation rows, group labels) but
not a shell, and they do not switch inside one page:

| Application | Former name | What it is | Shell |
|---|---|---|---|
| Agent Platform (智能体平台) | workbench, "Data Agent", 数据分析平台 | where business users talk to agents | conversation shell |
| Ontology Service (本体服务) | Ontology Manager (本体管理器) | the platform: ontology, assets, knowledge and platform administration | data shell |

Renaming covers interface text and documents only. URL paths (`/ontology-manager/`),
package names and image names stay, so deployments do not change again.

**Cross-application links** sit in each application's left function area as ordinary
navigation rows with an external-link mark, and open in a new tab:

- Agent Platform: "Ontology Service" among New chat, Dashboards, Graph, Agent settings and
  Scheduled tasks.
- Ontology Service: "Agent Platform" and (enterprise) "Data Governance Platform" at the top of
  its sidebar, above the navigation groups.

**Conversation shell (Agent Platform).** Keep the current structure: logo, function area,
agent selector, recent conversations, user row. The sidebar sits on `canvas` with no divider.
The workspace is one raised panel: `surface`, `conversation-radius`, `conversation-gutter`
around it, a 1px `line` and `elevation.panel`. The composer is a pill of `composer-height`
with `elevation.composer` and a round send button. Admin pages of the Agent Platform keep
their current layout and only adopt the colour roles and component rules.

**Data shell (Ontology Service, data-dense pages).** Edge to edge, separated by tone and a
1px `line` (the Layout section below). One sidebar and one router: groups Ontology (graph,
object types, attributes, relation types, actions, visual modelling, data browser), Assets
(metric views, functions, scheduled tasks), Knowledge (business knowledge) and Platform
administration (permission centre, models, system configuration, licence, audit log, system
monitor), each entry shown by permission. There is no separate "platform area" with its
own header and back button.

**Light and dark.** Each mode is uniform: in light mode the sidebar, list panel and workspace
are all light; in dark mode all dark. No dark sidebar beside a light workspace.

**Brand mark.** The Agent Platform mark uses `accent`, the Ontology Service mark `primary`,
so the current application is recognisable at a glance.

## Scope and ownership

This file covers the product interface: the Agent Platform (agents, conversations, answers,
its admin pages) and the Ontology Service. The marketing site keeps its own styles.

It has two layers:

- **Foundation** — type, spacing, shape, density, shell layout, motion and component rules.
  Owned here for every edition. An edition never redefines it.
- **Brand** — colours (light and dark), the chart palette and the shell signature. This
  file defines the open-source brand. Another edition defines its own brand layer in its
  own DESIGN.md and inherits everything else from here.

Where the values live in code once adopted:

| Layer | Code owner |
|---|---|
| Foundation variables | `@ontomato/design-tokens` — `packages/design-tokens/src/foundation.css` |
| Brand types and generator | `@ontomato/design-tokens` (`src/index.ts`) |
| Open-source brand source | `@ontomato/design-tokens/oss` |
| Enterprise brand source | enterprise `packages/brand-enterprise` |

`@ontomato/design-tokens` has no runtime dependencies; both applications depend on it and
not on each other's packages. One brand source per edition generates the Agent Platform
theme, the Ontology Service presentation and the graph `nodePalette` (one per mode, the
`dataviz` order). Dashboard chart colours are still a separate copy in the Agent Platform
and move onto the brand source with its restyle. (Before 2026-11-04 each edition kept its
colours twice: `apps/workbench/web/src/theme.css` and `apps/ontology-manager/src/presentation.ts`.)

### Colour roles → Element Plus

Roles map onto the Element Plus 2.13 variables the code already uses everywhere, following
Element Plus's own meaning of each variable. Only roles Element Plus lacks get new
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
| primary-hover | `--brand-primary-hover` (new) | applied through the button variables below |
| on-primary | `--on-primary` (exists) | applied through the button variables below |
| success / warning / danger / info | `--el-color-*` and their `-light-8/-light-9` | status |
| brand-mark, accent, accent-ink, accent-soft | `--brand-mark`, `--brand-accent`, `--brand-accent-ink`, `--brand-accent-soft` (new) | — |
| shell rail | `--shell-rail-bg`, `--shell-rail-ink`, `--shell-rail-muted`, `--shell-rail-active`, `--shell-rail-active-ink` (new) | — |
| chart 1–8 | `--chart-1` … `--chart-8` (new) | — |

Element Plus component variables that must be set, because the global ones above do not
reach them or carry a different meaning:

| Selector | Variables |
|---|---|
| `:root` | `--el-disabled-text-color: faint` |
| `.el-button--primary` | `--el-button-text-color`, `--el-button-hover-text-color`, `--el-button-active-text-color`, `--el-button-disabled-text-color`: `var(--on-primary)`; `--el-button-hover-bg-color`, `--el-button-hover-border-color`: `var(--brand-primary-hover)` (Element Plus defaults to the lighter `light-3`; `primary-hover` is chosen per mode so on-primary text keeps at least 4.5:1) |
| `.el-table` | `--el-table-header-bg-color: var(--el-fill-color)`; row hover and current row keep the defaults (`hover`, `selected`) |
| `.el-menu` | `--el-menu-hover-bg-color: var(--el-fill-color-light)` (default is the selected colour); `--el-menu-item-height: 32px` |

The open-source shell rail has no signature colour: rail = `canvas`, rail ink = `ink-2`,
rail muted = `muted`, rail active = `selected` with `ink`.

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

```
┌──────────┬──────────────┬──────────────────────────────────┐
│ agent    │ list panel   │ workspace                        │
│ rail     │ (history,    │ page header 48px                 │
│ 232px    │  objects)    ├──────────────────────────────────┤
│ canvas   │ 264px canvas │ surface                          │
│          │              │                                  │
└──────────┴──────────────┴──────────────────────────────────┘
```

- Panels are full height, edge to edge, `rounded.shell` (0), divided by a 1px `line`.
  No outer page gutter.
- The agent rail collapses to a 56px icon rail below 1280px; on mobile each column becomes
  its own view (the current mobile behaviour stays).
- An inspector (path search, element details) docks on the right at 320px with the same
  rule: hairline, no card.

### Admin page anatomy

- **Page header, 48px:** title (`title`) on the left; the one-line description is muted
  `body-sm` after the title or in a tooltip; primary and secondary actions on the right.
  Toolbars are not wrapped in a card — filters sit in the header row or one 40px row below.
- **Content:** the table or form fills the remaining width with 16px padding. A table is a
  bordered surface with `rounded.md`; it does not float on a shadow.
- **Admin navigation:** a 200px `canvas` sidebar with 32px `nav-row`s and `label` group
  headings.

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

- **Primary is leaf green `#42613f`**, not the logo green. Logo green `#639c2d` gives
  white text only 3.3:1, which fails body-text contrast; it stays on the brand mark.
- **Sage `#e8ede3`** is the selected state: current nav row, selected table row, active
  segment.
- **Tomato is the accent**, used only for brand moments: the brand mark, the emphasised
  word in a welcome or empty-state headline, and illustrations. It is never used for
  links, buttons, selection, status or charts, because red reads as error.
- **Accent text and danger share one red on purpose.** The website's red is the brand,
  and a second, different red in the product would read as two errors. They cannot be
  confused because they never meet: accent text appears only in welcome and empty-state
  headlines, which carry no status, and danger always comes with an icon and a verb
  ("Delete", "Connection failed").
- **Dark mode** keeps the warm olive tint in every neutral; primary becomes light green
  `#8fbf5a` with dark text on it.

### Status

| State | Light | Dark | Rule |
|---|---|---|---|
| success | `#3d7a1a` | `#7dbb4b` | icon + label |
| warning | `#946000` | `#d9a441` | icon + label |
| danger  | `#bc3928` | `#ef7b65` | icon + label; destructive buttons |
| info    | muted | muted | neutral notes |

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
1px primary border plus a 2px primary ring at 20% opacity. Placeholder in `faint`.

**Navigation row.** 32px, `rounded.md` highlight inset 8px from the panel edge, 16px icon,
`body-sm`. Hover → `hover`; current → `selected` with `ink` text and 600 weight. Counts
right-aligned in `caption` muted.

**List row (two lines).** 44px: name in `body-sm` 500, id or description in `caption`
muted (ids in `mono`). Rows are not cards: no border, no shadow, highlight on hover only.

**Conversation history.** Single-line 32px rows grouped under `label` date headings
(Today, Yesterday, Earlier); relative time right-aligned in `caption`, shown on hover.

**Table.** Head 36px on `sunken`, `label` style; rows 40px (`compact` 32px), 1px `line`
between rows, no zebra stripes, hover → `hover`, selected → `selected`. The table sits in
a `line` border with `rounded.md`. The empty state lives inside the table body.

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

## Current vs proposed

As of 2026-10-28 the code differs from this proposal as follows.

| Area | Current | Proposed |
|---|---|---|
| Primary (light) | logo green `#639c2d` (3.3:1 with white) | leaf green `#42613f` (7.0:1) |
| Page background | `#fbfdf8`, green-tinted fills | warm paper `#f8f8f4`, sage selection |
| Shell | three floating cards, 16px gutters, 24px radius | Agent Platform: one raised conversation panel, 10px gutter, 18px radius; Ontology Service and data pages: edge-to-edge panels, hairline dividers |
| Ontology Manager | two shells (workspace header with text controls; platform area with its own header, back link and icon controls) | one Ontology Service shell: one sidebar, one router, cross-application links in the sidebar |
| Body size | 15px | 14px (13px in tables and lists) |
| Table | head 44px, rows 48px, card shadow | head 36px, rows 40px, border only |
| List rows | 56–72px cards | 32px single-line or 44px two-line rows |
| Shadows | green-tinted shadows on cards and primary buttons | overlays only |
| Graph and chart colours | `nodePalette` of 6 greens and browns in the Manager presentation; Ontology Manager components hold 122 distinct hard-coded hex values | 8 validated colours in fixed order, one per object type |
| Colour sources | `theme.css` and the Manager `presentation.ts`, copied by hand | one brand source per edition generating both |
| Placeholder | `#a0ad96` (2.3:1) | `#6c7166` (5.0:1) |
