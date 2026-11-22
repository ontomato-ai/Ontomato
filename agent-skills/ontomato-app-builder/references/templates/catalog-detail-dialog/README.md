# Full-width catalog → full-width detail + centered create dialog

Derived from the verified Ontology Relations page pattern:

- **Catalog view**: full-width `ObjectList` with outer page gutter (`--page-gutter`), bottom scroll room for the
  floating composer (`calc(var(--page-content-gap) + 56px)`), and a primary `+ New …` page-header command
  (`manifest.commands.create` with `icon: "plus"`, automatically disabled while `creating` is `true`).
- **Detail view**: clicking a row hides the catalog and switches the enclosing platform page header into one unified
  detail bar (`← Back | <Object title> | [Delete] [Save]`) via `usePanelDetailHeader` and `usePanelBack` (browser Back,
  Escape, and unified unsaved-changes guard), with a local fallback bar for headerless previews. Content renders
  equal-height rounded white cards in a two-column `@container` grid that collapses to one column below `850px`.
- **Create dialog**: clicking the header's primary `+ New …` command sets public state `creating: true, selected: null`
  and opens a centered `<sdk-dialog>` hosting the same `ObjectForm` member (`config.actions: "create-only"` shows
  Cancel/Create in the dialog while edit mode saves from the detail header).

## Check and register directly

```sh
template="$SKILL/references/templates/catalog-detail-dialog"
node "$SKILL/ontomato.mjs" panel check "$template"
node "$SKILL/ontomato.mjs" panel register "$template"
```

Open `/applications/app-template-catalog-detail/manage` (or generate a customized copy for any owner type with
`node "$SKILL/ontomato.mjs" panel scaffold <type-id> ./my-panel --id app-my-panel`).

## Adapting this template to another type

1. **Inspect the owner**: run `node "$SKILL/ontomato.mjs" panel type <type-id>` and update `TYPE` in `panel.mjs`,
   `objectType` / `type` / `data` / `operation` in `panel.json`, and IDs/paths in `registration.json`.
2. **Configure table columns**: add `config.columns` on the `list` `ObjectList` member for multi-column tables (see
   `CODE.md#configure-an-official-list-or-summary`).
3. **Add a header Delete button**: declare a `remove` member on `manifest.members` and mount `<projection slot="remove">`
   in both the fallback titlebar and `.detail-header-op-host` (so its confirmation dialog and error feedback stay mounted
   while the platform header draws the button):

   ```json
   "remove": {
     "component": "OperationButton",
     "operation": "<owner.delete>",
     "target": "selected",
     "config": { "type": "danger", "plain": true, "icon": "trash", "placement": "header" }
   }
   ```

4. **Add localized labels**: keep all UI text in `panel.json`'s `content.messages` (never hardcode a single language in
   `panel.html` or `panel.mjs`). Add `"zh-CN"` (and other locales) beside `"en"`:

   ```json
   "content": {
     "messages": {
       "en": { "panel.name": "Relations", "command.new": "New relation", "detail.back": "Back to relations", "detail.save": "Save" },
       "zh-CN": { "panel.name": "关系类型", "command.new": "新建关系类型", "detail.back": "返回关系类型", "detail.save": "保存" }
     }
   }
   ```

5. **Form controls from the owner**: `ObjectForm` automatically shows word counters when the owner schema declares
   `maxLength`, and disables dependent select fields when the owner declares `disabledWhenEmpty` / upstream
   `source.params`. Keep validation and field rules on the owner side.
