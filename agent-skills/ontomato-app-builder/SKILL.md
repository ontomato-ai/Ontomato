---
name: ontomato-app-builder
description: "Compose, check and register panel applications with the Ontomato SDK. Use when building a panel or adapting a page into a panel."
---

# Ontomato app builder

Use the [Vue panel skill](references/panel-authoring/SKILL.md) and [page templates](references/templates/README.md) for panel authoring (official components first, normal HTML/CSS/Vue for layout with no layout components, `<sdk-*>` UI primitives, `--sdk-*` theme tokens, and domain-registered small components only as a last resort). The [technical guide](GUIDE.md) covers connection, registration, domain components vs. installed packages, and errors. For an existing application, start with the [decomposition skill](references/app-standard/SKILL.md). When the platform supplies `application-design`, read it before designing or polishing a panel.

Use the attached workspace and current identity. The guide covers external connections, owner-provided business capabilities, build-test data and registration. For new Actions and MetricViews, read the owner context, write a definition and have the Java authoring API test and accept it through the CLI. For delegated retrieval, use the product's analyst skill and follow [agent delegation](GUIDE.md#agent-delegation).
