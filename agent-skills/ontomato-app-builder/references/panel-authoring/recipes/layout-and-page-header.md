# Layout, `<page-header>`, and container responsiveness

- **Host content box.** Every entry (full page or beside a conversation) receives a content box with no host page
  header, host padding, or outer card frame. Style outer gutter and layout directly in your panel CSS (for example
  `padding: var(--spacing-lg) var(--page-gutter) var(--page-content-gap)`). The platform floats the page composer above
  the viewport without consuming your content box — do not reserve extra bottom padding for it.
- **Container-driven responsiveness.** Prefer container-relative sizing and CSS `@container` rather than
  `window.innerWidth` or viewport units (`vh`/`vw`/`dvh`) so the same code works full-page, embedded in another panel,
  and beside a conversation. When the container has no definite height, grow naturally with content; when it has a
  definite height, either grow and let the outer container scroll or fill the container and scroll the needed sub-region.
- **No layout components.** Write catalog tables, full-width detail cards, split panes, and tabs with normal HTML, CSS
  grid/flex, and Vue. Start from a matching [page template](../../templates/README.md).
- **Button classification (Rule 2):**
  1. **Local UI interaction only** (open/close a create dialog, switch tabs/view modes, navigate, go back, discard
     unsaved draft): write `<sdk-button>` directly in `panel.html` without registering a projection.
  2. **Direct business write** (delete, approve, publish, run task, disable): place an `OperationButton` projection, an
     `ObjectList` `config.rowActions` item, or an `ObjectHeader` `operations` item calling a declared member binding.
  3. **Form save / discard**: use `ObjectForm`'s own bar (`config.actions: "footer" | "create-only"`) or wire the form
     member to `<page-header :draft="usePanelFormDraft('form')">` (so both save and discard operate on the exact same
     form member without creating a separate save projection).
- **Pure presentational `<page-header>`.** Place `<page-header>` at the top of `panel.html` when the page needs a
  header (omit it for headerless pages):
  - `title` (string) or `#title` slot (for example `<projection slot="headerTitle"></projection>` using `ObjectHeader`)
  - Keep `#title` on one horizontal line. For an `ObjectHeader` title, set `config.subtitle: ""` and the owner field
    for `config.statusField`, and pass `:fallback-title="selectedKey"` to the projection. Place descriptive content
    in `#description` with `TypedValue`.
  - optional `back-label` + `@back` (wired to `navigate(CATALOG_PATH)` or `usePanelBack`)
  - Always declare `<template #actions>` for custom actions and put visibility conditions inside. Use `v-show`
    on the delete projection: `letGo` can clear `selected` before `@done` runs, so keep the button mounted
    until completion can navigate.
  - `:draft="formDraft"` wired to `usePanelFormDraft("form")` for automatic Save, Discard, and unsaved-changes feedback

```html
<page-header :title="selectedTitle" :back-label="t('detail.back')" :draft="formDraft" @back="goBack">
  <template #actions>
    <projection v-show="selectedKey && ready" slot="remove" @done="onRemoveDone"></projection>
  </template>
</page-header>
```

```js
import { mountPanel, usePanelContext, usePanelFormDraft } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { navigate } = usePanelContext();
    const formDraft = usePanelFormDraft("form");
    // Routing back to the catalog entry triggers the platform's unified unsaved-changes leave guard automatically.
    const goBack = () => navigate(CATALOG_PATH);
    return { formDraft, goBack };
  },
});
```

- **Full-width catalog → full-width detail.** Put the catalog in the application menu (`names` set on its
  `panelUse`) and give the detail page its own non-menu entry (`names` omitted). Clicking a row (`@choose`) builds a
  flat URL with `panelAddress(DETAIL_PATH, { selected: item.primaryKey })` from `@ontomato/sdk/panel` and calls
  `navigate(address)`. Put New in the catalog header's top-right actions, open a centered dialog for required fields,
  and use the saved identity to open the detail entry. Back calls `navigate(CATALOG_PATH)`; the platform retains the
  catalog state and refreshes the list on return.
