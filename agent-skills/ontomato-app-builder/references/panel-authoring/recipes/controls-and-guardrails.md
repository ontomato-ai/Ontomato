# Panel controls and platform guardrails

- **Allowed imports in `panel.mjs`.** Only `vue` and `@ontomato/sdk/panel` (`mountPanel`, `usePanelContext`,
  `usePanelFormDraft`, `usePanelBack`, `usePanelNarrow`, `usePanelOutput`, `usePanelOperation`, `savePanelFile`,
  `appIcon`). Never import `element-plus` or any third-party UI library, and never write `<el-*>` tags, `v-loading`,
  or `--el-*` CSS tokens.
- **Overlays & notifications.** Use `<sdk-dialog>` / `<sdk-drawer>` for modal/drawer overlays (such as centered create
  forms). The SDK guards close-button, backdrop, Escape and `handleClose()` requests. Discard affects only dirty
  forms inside the overlay. For an `ObjectForm` with dialog Back handling, bind `:model-value` one way and use
  `:before-close` to call `done()` only when `await dialogBack.back()` succeeds. Drive a custom footer Save with
  `usePanelFormDraft`. See the [dialog recipe](../../management-pages.md#guard-a-form-dialog).
- **Native panel CSS.** `SdkPopover`, `SdkDialog` and `SdkDrawer` mount in the panel's
  `[data-panel-overlay-root][data-panel-instance]`. Panel `<style>` applies directly there. Use ordinary
  descendant selectors such as `.wrap .sdk-owner-form`. Omit Vue SFC selectors `:deep` and `::v-deep`.
