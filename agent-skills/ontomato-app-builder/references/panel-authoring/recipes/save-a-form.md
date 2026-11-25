# Save a form

An `ObjectForm` projection needs its own operation or a sibling write that binds its draft (inline
`draft: "form"` or formal `operationDrafts`). This also applies to a read-only form with
`config.actions: "none"`. For a form with its own save:
- For `platform:*` types, bind the type's declared `form.save` operation (for example `platform:AgentDefinition.save`).
- For customer ontology `ObjectType`s (such as `Student`, `Order`), bind a published write `Action`: an object-targeted
  `Action` for edit (`data: { form: "form" }`, `target: "<selectedState>"`) or a top-level targetless `Action`
  (`target: { source: "none" }`) for create (`data: { createForm: "createForm" }`), wiring parameter names with
  `{ "formField": "/pointer" }` or `{ "formFields": { ... } }` whenever they differ from form attribute names (see
  [Customer `ObjectType` forms and targetless Actions](customer-object-forms-and-actions.md)).

- **`config.actions`**:
  - `"footer"` (default): non-overlapping document-flow Save/Discard/Cancel bar at the bottom of the form.
  - `"create-only"`: Cancel/Create bar only in create mode (pair with `<page-header :draft="formDraft">` in edit mode).
  - `"none"`: omit the form's own bar in both modes (ideal on a dedicated detail entry with `<page-header :draft="formDraft">`).
- **`usePanelFormDraft("form")`**: wire directly into `<page-header :draft="formDraft">` for Save, Discard (with
  confirmation), busy state, and unsaved-changes notice — no manual submit boilerplate needed.
- **`config.fixedFields`**: fix parent-determined fields by JSON Pointer path (`{"state":"selected","path":"/primaryKey"}`
  or `{"literal":"..."}`) so they display read-only and submit with every save.
- `ObjectForm` automatically renders word counters for schema `maxLength` fields, password masking (`show-password`) for
  single-line `text` fields declaring `secret: true`, and disables cascading select fields
  when the owner declares `disabledWhenEmpty`.
- For separate dialogs editing different parts of one owner form, use `config.groups` with
  `unassignedFields: "omit"` on each form. Include only that dialog's fields and let the owner apply its
  `submittedFields`.
- Use either `:parent="activeClassParent" :exclude="['/rowPermission']"` on `<object-form-fields>` or pass
  absolute JSON pointers with `:fields` and omit `:parent`. The component ignores `:fields` when `:parent` is set.
- Call `refreshDraft()` through the form handle or `usePanelFormDraft` controls to refresh owner options,
  fields and errors while preserving a dirty draft and its baseline. A clean form adopts the new baseline.
- The `saved` event carries `{ className, primaryKey }`. On create the key comes from the successful operation's
  `outcome.created` and is `null` when no identity was returned. Use the SDK's save feedback and avoid a second
  success `panel.notify` from `@saved`.

### Secret input and delivery

The owner marks secret inputs with `secret: true`. `OperationInputDialog` uses a password field.
`PanelHost` shows one-time secrets through `SecretDeliveryDialog` for all write entries, including row actions
and `usePanelOperation` writes. Assistant observation hides plaintext. People enter and receive the secrets.

### Assistant live form filling and saving

Use `present` to open the target page, tab or dialog beside the conversation, then `fill_form` on the mounted
`ObjectForm`. Changed fields are marked and stay unsaved for review. When asked to save, use `page_action`
for the form's declared save, with conversation confirmation by default. When an agent's same-page `present` would switch a dirty form's target
or unmount it, the host returns `blocked_unsaved`. Unrelated state updates succeed while the dirty form stays
mounted on the same target. Human clicks go through the panel's unsaved confirmation.

To split one form across sections, configure `presentation` and `groups` or place `<object-form-fields>` in
the form's default slot. The sections share the same draft and save. A form's `saved` event gives
`{ className, primaryKey }`; a successful create can report `primaryKey: null`.
