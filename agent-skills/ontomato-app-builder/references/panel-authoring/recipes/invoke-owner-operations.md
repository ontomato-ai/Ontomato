# Invoke declared owner operations

Prefer a mounted `OperationButton`. It works with both platform operations (`kind: "PlatformOperation"`) and customer
business Actions (`kind: "Action"`, either object-targeted or targetless). Bind the owner's full ID and (for targeted
operations) the target object or checked list. When an operation is unavailable and `hideWhenUnavailable` is false,
`OperationButton` keeps the button disabled and shows the owner's reason in a hover/focus tooltip rather than adding a
second line below the button.

### Wire a customer business `Action` on `OperationButton`

- **Standalone projection file (`projections/<id>.json`):** set `"componentId": "@ontomato/sdk:OperationButton"`,
  declare the object or object-list input under `inputs` (`"data"` may be omitted when the projection declares no data reads), bind `operations.<localName>.operation` to
  `{ "kind": "Action", "id": "<action-id>" }`, and point `config.operation` to `"<localName>"`:

```json
{
  "componentId": "@ontomato/sdk:OperationButton",
  "inputs": {
    "target": { "kind": "object", "objectType": "ExpenseClaim" }
  },
  "outputs": {},
  "operations": {
    "approve": {
      "operation": { "kind": "Action", "id": "expense.approve" },
      "target": { "input": "target" }
    }
  },
  "config": {
    "operation": "approve",
    "type": "primary",
    "hideWhenUnavailable": true
  },
  "name": "approve-expense",
  "description": "Approve the selected expense claim",
  "visibility": "domain"
}
```

  Then reference the projection in `panel.json` with `"inputs": { "target": { "state": "selected" } }`.
- **Inline member shorthand (`panel.json`):** set `"component": "OperationButton"`, `"type": "<Class>"`,
  `"target": "selected"`, and `"operation": "<action-id>"`. For a targetless customer `Action` (such as creating a new
  record or running a global job), omit `target` (and `type`); see
  [Customer `ObjectType` forms and targetless Actions](customer-object-forms-and-actions.md).

### Custom button or menu (`usePanelOperation`)

If you draw a custom button or menu, call `usePanelOperation(member, name, options?)` in synchronous setup. Use the same
availability and disabled conditions for the visible control and the hook, and put shared post-operation behavior
in `onSettled`. The mounted hook registers the action automatically, so a reader's click and `page_action` share
its target, confirmation and settlement. Pass `entry: false` for a background flow or to read a dialog operation before its button mounts.
For example, subscribe with `usePanelOperation("submit", "apply", { entry: false })`. When its `state.value.status`
is `"ready"`, pass `state.value.value.apply?.unavailable?.reason` to `<sdk-tooltip>` on the outer disabled toolbar
button (rather than printing it as a separate line). The dialog's `OperationButton` is the entry registered for
`page_action`.

```js
const { run, running, operation } = usePanelOperation("archive", "archive", {
  available: () => detailReady.value,
  disabled: () => saving.value,
  onSettled: (receipt) => {
    if (receipt.response?.outcome?.kind === "success") return goBack();
  },
});
```

Invoke `run()` from the button, use `!operation || saving || running` for its disabled state and show the button
only when `detailReady`. Setting a self-managed flag to `true` in the click handler before `run()` makes the click
a no-op if that same flag is passed as `options.busy`. Use the hook's returned `running` state to track its own run.
See [the operation receipt](../RUNTIME.md#operation-ids-and-write-results).

For an assistant row action, pass `rowKey` in the exact `<ClassName>:<primaryKey>` format. Copy it verbatim from
the snapshot row and pass it to `page_action` with the declared operation ID.
