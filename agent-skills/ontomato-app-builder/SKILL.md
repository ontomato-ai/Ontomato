---
name: ontomato-app-builder
description: "Compose, check and register panel applications with the Ontomato SDK. Use when building a panel or adapting a page into a panel."
---

# Ontomato app builder

Start with the [Vue panel skill](references/panel-authoring/SKILL.md) and [page templates](references/templates/README.md).
The [technical guide](GUIDE.md) covers connection, CLI commands, registration, and capability authoring. For an existing
application, start with the [decomposition skill](references/app-standard/SKILL.md). When the platform supplies
`application-design`, read it before designing or polishing a panel.

Follow the platform's assembly boundaries:
- **Hierarchy**: platform sidebar → application menu / frame (use the platform's default menu; do not hand-author custom frame panels yet) → current entry panel → nested panels and components.
- **Display & logic**: universal components handle display; MetricViews (reads), Actions (writes), and platform-owned reads handle business calculations and rules. Panels only lay out and wire projection outputs — never read record fields directly or compute business logic (unsaved drafts do not count as ontology data; no panel-private components).
- **Projections bind read/write functions only**: use the platform's generic read functions parameterized by class (list / get one, shown by `panel type <class>`), MetricViews for filtered/calculated reads (currently rendered via `MetricChart` from a dashboard card), Actions for writes, and built-in platform reads/operations for `platform:*` types.
- **Authoring**: start from official component defaults, then `config`, and formal components only as a last resort. Write layout in normal HTML, CSS (`@container`), and Vue using `<page-header>`, `usePanelFormDraft`, `<sdk-*>` primitives, `v-sdk-*` directives, and `--sdk-*` tokens (never `el-*`, `--el-*`, `v-loading`, or `element-plus`).

Use the attached workspace and current identity. Run `panel check`, then register and open the application entry. For
new Actions and MetricViews, read the owner context, write a definition, and have the Java authoring API test and accept
it through the CLI. For delegated retrieval, use the product's analyst skill and follow
[agent delegation](GUIDE.md#agent-delegation).
