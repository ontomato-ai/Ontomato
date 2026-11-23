---
name: ontomato-app-builder
description: "Compose, check and register panel applications with the Ontomato SDK. Use when building a panel or adapting a page into a panel."
---

# Ontomato app builder

## Rules for authoring pages

**Rules the author must follow (not machine-checked, or not yet checked)**

Authoring panels:

1. A panel must lay out according to the width and height of its container: when the container's width or height changes, the layout adapts accordingly; when content exceeds the container's height, it scrolls inside the container. The same code must render and operate properly in all three placements: full page, embedded in another panel, and beside a conversation.
2. A panel must read business data only through projections and modify business data only by invoking registered operations. Panel code must not call business APIs directly.
3. A panel must not render ontology data itself. Any place that displays business data as text, graphics, or options, or provides an entry point for a business operation, must place a projection rendered by a base component. Exception: unsaved input inside a form does not count as ontology data; the panel may read it directly for live preview. Static content that does not display ontology data (subheadings, dividers) and controls that only toggle local view state (selection, checkboxes, expand/collapse, tab switching) are written directly in the panel and do not require registering a projection.
4. Panels and base components must not implement business calculations or business decisions. Computed results, sentences composed from business data, and decision outcomes must be provided by capability-layer MetricViews (reads) or Actions (writes); the platform's own objects are served by the platform's built-in reads.
5. The only business values a panel may use are the outputs declared by its projections (for example, the selected object and its name, record count, or current value). Those values have only three permitted uses: as inputs to other projections; to decide which block to show, which item to select, or where to navigate; or inserted verbatim into text-only slots such as titles and tab labels. Panels must not read record fields and must not compute on these values.
6. A panel must not trigger business writes on load, URL restoration, selection, or re-render. Business writes happen only when the user explicitly acts or an agent explicitly invokes a registered operation.
7. Use official components in this order, advancing to the next step only when the previous step cannot meet the need: (1) default appearance; (2) component configuration options; (3) placing other components in slots provided by the component; (4) writing a custom component.
8. The platform does not draw page headers. When a panel needs a header, place the official page header component at the top of the panel content and supply its title, description, back action, and buttons; without it, there is no page header. Buttons in the page header may only update the panel's declared public state or invoke registered operations.
9. A panel declaration must declare its public state and common usages. State that needs to be read or controlled by an agent, written to the URL, saved per user, or exposed externally must be declared as public state; temporary interaction state used only inside a panel instance stays in Vue and is not declared.
10. Before implementing a page, search for reusable base components, projections, and panels. When business capabilities (read functions, forms, operations) are missing, the capability owner must add them; when generic UI primitives are missing, the platform must add them to the official SDK. When renovating an existing page, check every user action against the original page item by item.

Authoring components:

11. A base component must not call business APIs directly; the platform supplies its data according to the projection declaration. The "meaning" in its declaration must make clear to both humans and agents what the component renders and what it can do.

**Machine-checked rules (violations fail checks; no need to memorize)**

- Page code uses Vue single-file components and standard CSS; scripts may import only Vue and the platform SDK.
- Data-free UI primitives (buttons, tabs, tables, dialogs, etc.) are imported from the platform SDK using SDK component names; third-party UI library component names must not be referenced directly.
- Panel declaration structure: members, the four attributes of each public state field (type, persisted per user, synced to URL, exposed externally), and the five items when adding a new projection (base component, data source, component config, operations, and public state wired to inputs/outputs).
- Every base component must include a declaration covering its meaning, required data, configuration options, inputs, outputs, and invocable operations.

## Getting started

Start with the [Vue panel skill](references/panel-authoring/SKILL.md) and [page templates](references/templates/README.md).
The [technical guide](GUIDE.md) covers connection, CLI commands (`scripts/ontomato.mjs`), registration, and capability
authoring. For an existing application, start with the [decomposition skill](references/app-standard/SKILL.md). When
the platform supplies `application-design`, read it before designing or polishing a panel.

Use the attached workspace and current identity. Run `panel check`, then register and open the application entry. For
new Actions and MetricViews, read the owner context, write a definition, and have the Java authoring API test and accept
it through the CLI. For delegated retrieval, use the product's analyst skill and follow
[agent delegation](GUIDE.md#agent-delegation).
