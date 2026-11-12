---
name: ontomato-app-builder
description: "Build and publish hosted applications using the current Ontomato SDK, published MetricViews and Actions on an existing ontology."
---

# Ontomato app builder

Use the shared [technical guide](GUIDE.md) and bundled `ontomato.mjs` to discover real ontology definitions, create business capabilities, and build the requested application. The same package works inside the platform and from an external agent without product source code.

When the platform supplies the `application-design` skill, read it before designing a new page or polishing a demo. Use the current SDK's components and host theme, reusable product assets and task-focused navigation. Keep business logic in published capabilities.

## Execution parameter contract (5.0)

Action and MetricView execution require every declared parameter name in the JSON object. Explicit `null` is allowed; empty strings and zero are real values. Missing parameters fail as `Missing parameter: <name>` before executing Python. An omitted parameter object means `{}` and works only for a definition with no parameters. The command passes server errors through unchanged.


Business testing uses the workspace's Java-owned test context. Write the sample under test-data/, run `test start`, then run the business commands against that context. Use `test status` / `test stop`; no live-data reset or production synchronization belongs to this skill. See GUIDE.md for the sample and workspace contract. Old SDK references must be upgraded for business preview.
