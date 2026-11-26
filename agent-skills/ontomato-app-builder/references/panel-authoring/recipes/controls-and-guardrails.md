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

## Pick items to add with PickerDialog

Do not hand-write a modal picker dialog. Declare a `PickerDialog` member bound to the candidate owner read
(`data.options` or `data.rows`) and bind `state.open` (boolean, `deepLink: false`) and `state.selected` (string
primary-key list, `deepLink: false`):

```json
{
  "manifest": {
    "state": {
      "addMembersOpen": { "type": { "kind": "scalar", "type": "boolean" }, "default": false, "deepLink": false },
      "pickedMembers": { "type": { "kind": "list", "items": { "kind": "scalar", "type": "string" } }, "default": [], "deepLink": false }
    },
    "members": {
      "memberPicker": {
        "component": "PickerDialog",
        "type": "platform:User",
        "data": { "options": "options" },
        "state": { "open": "addMembersOpen", "selected": "pickedMembers" },
        "config": {
          "titleKey": "role.addMembersTitle",
          "confirmLabelKey": "role.addMembersConfirm"
        }
      }
    }
  }
}
```

```html
<projection slot="memberPicker" @confirm="onMembersConfirmed">
  <template #extra>
    <!-- Optional placement-specific controls backed by the panel's own state -->
  </template>
</projection>
```

- **Automatic search:** complete owner lists filter locally with zero extra requests; truncated reads (`total > loaded`,
  `hasMore`, or `nextCursor`) send `keyword` (or `search` on `rows`) to the owner and display the narrow-results notice.
- **Agent parity (standard 2.4.2):** `open` and `selected` are public panel states that agents can inspect and update.
  When confirming invokes an owner write (such as adding role members or policies), call a registered panel operation
  whose parameter reads from `selected` (`usePanelOperation` / `OperationButton`) so human confirm and agent
  `page_action` execute the same operation — `PickerDialog` never calls owners directly. When confirming updates a form
  field (such as agent skills), agents fill the form directly via `fill_form` without opening the dialog.
