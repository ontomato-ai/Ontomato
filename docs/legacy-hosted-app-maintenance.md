# Maintain an existing hosted application

Use the application builder CLI at `agent-skills/ontomato-app-builder/ontomato.mjs` with the deployed application's
current workspace and authorized identity. Its [connection instructions](../agent-skills/ontomato-app-builder/GUIDE.md#connection-and-workspace)
apply to this CLI as well. Read the existing application's source, asset IDs and release records before changing it.

## SDK discovery and application source

```sh
node <skill>/ontomato.mjs sdk current
node <skill>/ontomato.mjs sdk read sdk.json
node <skill>/ontomato.mjs sdk read docs/index.md
node <skill>/ontomato.mjs sdk read docs/reference.md
node <skill>/ontomato.mjs sdk read examples/<example from the docs>
```

Discovery returns the installed release's `version`, `digest`, manifest, component catalogue, checker and documentation paths. Read the manifest, guide, reference and relevant examples of this version. Write HTML and ES modules using its local Vue, Element Plus, ECharts and Ontomato modules. Use the SDK's MetricView and Action APIs and refresh after writes. Draw charts, Markdown, code, content previews and Action forms with the platform's own components, as the guide shows: `<e-chart>` in `context.chartTheme`, `<markdown-view>`, `<code-editor>` for code and data as written such as JSON, `<table-preview>` with `parseCsv` for CSV and TSV, `<html-preview>` for an HTML document, and `<form-fields>` on `context.actions.form`. They look like the platform and follow its light and dark themes. Do not create a chart with ECharts itself, render Markdown another way, show code in a textarea or `<pre>`, parse CSV yourself or hand-build an Action's fields; import `echarts` only for the helpers an option uses. Follow its host integration for theme and language; use only context APIs and modules actually present in this version. The chart theme already keeps category labels from running into each other, so give the option the categories and their values and leave `axisLabel` alone: never set its `interval` to `0` to force every label out, and when the names are long and the slots narrow, change the chart (a horizontal bar chart gives each name its own row) or cut or wrap that one chart's labels through its own `axisLabel` (`width` with `overflow`, or a `formatter`), instead of restating a rule for every chart.

Every page reports what its reader looks at with `context.setPageContext({ page, selection })`, as the SDK guide describes: once when the page starts, with `selection: null`; whenever the reader moves to another page or tab of the app; and whenever they select a business object or clear the selection. `page` is the app's own name for the page in view, as the reader sees it. `selection` is `null` or the selected object as `{ className, primaryKey, name }`: its ontology class name from the platform, its primary key as text, and the name readers know it by. Keep the selection as the page's own state, set by the reader's clicks; do not scan the DOM, post messages between frames or describe the page in another format. A published app's call has no effect. While the builder's workspace panel is open, the user's message ends with a line naming what they look at: the preview with the app's page and the selected object (class, name and primary key), a file, or a commit. "This" or "this row" in the request means that.

The returned paths already include the deployment prefix. HTML module and stylesheet URLs use `sdkBasePath` exactly once; never embed the internal workbench address or fetch modules from a CDN. `sdk read` automatically uses the agent's reachable URL. The version's examples may show root deployment paths: apply `publicBasePath` when writing them into the application. Documentation belongs in the agent's scratch location, not the released directory.

## Legacy ProductAsset maintenance

This section applies to existing hosted applications and older personal workspace configurations. If a maintained page fits its existing product document contract, create or edit those same assets through the authoring CLI; manual editing and Agent editing must converge on the same asset IDs. Use custom source only for interactions the asset contract cannot express. Do not reproduce an existing configured page in HTML.

Custom source embeds existing assets with the SDK's `ProductAsset` component:

```js
import { connectAppContext, ProductAsset } from '@ontomato/sdk';
const context = await connectAppContext();
// Register ProductAsset in components and render:
// <product-asset :context="context" asset-id="actual-asset-id"></product-asset>
```

Declare embedded IDs in `ontomato.products.json`. Published applications resolve the frozen child revisions of their release; remounting does not upgrade them. Embedded content uses the shell's product runtime, current identity and theme. New source publications require a message-bridge SDK and run in an opaque sandbox; use `await connectAppContext()`. Embedding is unavailable in build-test previews; author assets with the CLI, then verify a published app.

Product parameters are default inputs and interaction preferences. Business windows, thresholds, legal values and operation eligibility must be defined and validated by capabilities, never solely by a page's literals, options or read-only fields. Deleting the page must not delete a business rule. Product-owned ObjectViews may read governed attributes and relationships without business predicates; computed values reference published MetricViews. Legacy object-view pointers require explicit ownership migration before a pinned release.

Commit `ontomato.products.json`; an empty `assetIds` array explicitly declares no product dependencies. The publisher derives `ontomato.product-review.json` from the actual source and ignores author attestations. Business reads use SDK capabilities, writes use Actions, and business calculations and eligibility rules remain in capabilities. Direct transports and parent-window access are rejected; the runtime network policy closes direct data access.

Reuse templates without replacing the user's personal workspace: `product create-page <template-id> <name>` creates a new private page with the template's layout and component references. The SDK exposes the same operation as `context.products.createPage(id, name)`. Use the returned ID to assemble an application and declare it in the product manifest. `product use-home` instead replaces the current personal workspace configuration.

`product create-dashboard <name>` creates a dashboard through its existing owner service and registers a product reference, returning `data.id` and `data.productAssetId`. The SDK's `context.products.createDashboard(name)` returns the product asset. Reuse an existing dashboard when appropriate. The Manager's dashboard creation uses this same path. Add content through the existing dashboard authoring workflow rather than embedding SQL or duplicating the definition in product storage.

Existing hosted assets use the three-category V2 model: elements are `object-projection`, `collection-view`, `metric-widget`, `action-view`; compositions are `page` and `navigation`; intelligent applications are `application` and `agent-profile`. A projection has one typed `renders` target. Pages contain asset IDs, never inline projection documents. Templates use `page.isTemplate`; pure display reusable pages use `page.embeddable` and cannot recursively contain Actions. Do not author legacy widget/group/panel/template types. Metric results remain row arrays; presentation selects fields and formats without calculating new measures.

Product-owned ObjectViews render ObjectType attributes and relationships through governed reads or reference published capabilities for calculations. Page parameters carry ontology types, such as `{selected:{kind:"object",objectType:"Person"}}`; projections bind identity paths such as `selected.primaryKey`. Personal resource selections and interaction preferences belong to principal overlays, not Page documents. AgentProfile contains tool/context IDs, instructions and an agentId reference to a same-domain Node agent definition. Execution permissions come from that definition's current executionUserId setting; only domain governance administrators can change the selected execution user. Product use/edit Grants remain separate from business execution permissions.

For maintenance of an existing hosted application or personal workspace, use `product types`, `product list` and `product home`. `product get <id>` returns the asset, derived references and visible parents. `product save <id> <json|@file>` takes `{name, description, document, revision}`; use a new UUID with revision 0 to create, or the returned ID and revision to edit. New assets grant use/edit only to their creator; manage sharing with governance Grants rather than a product visibility field. Read before editing and preserve unrelated fields. A stale revision fails with `PRODUCT_CONFLICT`: read again and merge the user's change. `product copy <id> <name>` makes an independent copy. `product use-home <id> <current-home-revision>` copies a page or layout template into the reader's personal workspace. `product delete <id> <revision>` rejects referenced assets.

Read `product types` for the exact current JSON Schema and existing documents for field mappings. Parameter bindings are typed literals or declared Page-state variables. CollectionView arguments must belong to the Definition signature. Business predicates, SQL, DSL and calculated measures never belong in product documents. Shared assets do not grant business permissions. Runtime results, conversations and business objects remain with their owning services.

Use `product grants <id>` to inspect authorization. `product grant <id> <json|@file>` accepts `{principalKind:"principal"|"role",principalId,verb:"use"|"edit",remove:boolean}`; `product domain-grant <id> true|false` manages domain-member use. Grant mutation requires edit authority and does not modify the product document or authorize underlying data and Actions.

The SDK exposes `context.products.list/get/home/save/copy/useHome/delete` for these assets. Make asset edits through the authoring CLI. A hosted source application declares its product references explicitly.

## Workspace history and hosted releases

For an existing hosted source application that uses product assets, include `ontomato.products.json` in the committed tree:
`{"schemaVersion":1,"assetIds":["<actual product ID>"]}`. Publication pins recursive child revisions and capability contracts. Rollback selects the release snapshot. Review evidence is build-derived. Use typed `context.navigate({pageId,params})` or `context.navigate({objectViewId,object})` to preserve application identity and frozen dependencies. Never copy capability logic into source.

| Command | Purpose |
| --- | --- |
| `workspace list [<page JSON>]`, `workspace create <name>`, `workspace get <id>` | Discover/create a workspace and read HEAD and active run |
| `workspace rename <id> <name>`, `workspace delete <id>` | Rename or remove the workspace |
| `workspace tree <id> [<query JSON>]`, `workspace content <id> <path> [<commit>]` | Inspect working or committed files |
| `workspace commits <id> [<page JSON>]` | Commit IDs and messages; page uses `offset`/`limit` |
| `workspace sessions <id> [<query JSON>]` | Conversations with timestamps and latest run; page uses `cursor`/`limit` |
| `workspace diff <id> <from> <to or working>` | Inspect the patch |
| `workspace restore <id> <commit>` | Restore old files by creating a new commit, preserving history |
| `workspace import <id> <directory> --message <text>` | External agent: replace the complete tree and return its commit; `.git` is excluded |
| `workspace publish <id> <commit> <declaration JSON>` | Publish an explicit existing commit |
| `workspace releases <id>` | Export records with app, release and commit IDs |
| `workspace rollback <id> <releaseId> <declaration JSON>` | Move the Java publication reference without changing source history |

The declaration uses `{names, descriptions, icon, groups, permissions}`; names and descriptions use the platform's language keys. Reuse an existing application's declaration when publishing another version. Java `GET /platform/applications/<appId>` is authoritative for the current release; the newest export record is not proof of successful publication. The existing identity and business permissions apply to every operation.

Choose a semantic icon from the platform library when first publishing: `users` for staff or teams, `microscope` for research, `presentation` for conferences, `graduation-cap` for education, `wallet` for finance, `shopping-cart` for orders, `package` for inventory, `clipboard-list` for tasks, `chart` for analytics, `workflow` for approvals, `book` for knowledge, or `app-window` as the generic fallback. Preserve an existing application's chosen icon on later publications. The publication configuration lets its owner search the system library and override the recommendation without republishing code.

Publish only a commit that already exists. When files were changed in this run, finish the run first, then publish through the platform drawer or in a later run. Never call a dirty tree HEAD the new version. End with the actual result and workspace-relative file links so the host can show the changed source. Runtime supplies the run's commit separately; do not guess it from a reply or from another run's HEAD.

## Upgrade workspace SDK references

When a legacy hosted workspace still refers to an old SDK directory, use `sdk current` and the current SDK manifest to update its import map, stylesheet links and explicit SDK imports. Read `sdk.json` and `docs/reference.md` from the current release to check its interfaces. Commit the updated source and preview before publishing an explicit commit.

Preview requires the SDK manifest's executionContext capability 1. Upgrade old workspace SDK references when the preview entry rejects them. Test samples are excluded from published application files.
