# Invoke declared owner operations

Prefer a mounted `OperationButton`. Bind the owner's full ID and the target object or checked list. If you draw
a custom button or menu, call `usePanelOperation(member, name, options?)` in synchronous setup. Use the same
availability and disabled conditions for the visible control and the hook, and put shared post-operation behavior
in `onSettled`. The mounted hook registers the action automatically, so a reader's click and `page_action` share
its target, confirmation and settlement. Pass `entry: false` for a background flow or to read a dialog operation before its button mounts.
For example, subscribe with `usePanelOperation("submit", "apply", { entry: false })`. When its `state.value.status`
is `"ready"`, read `state.value.value.apply?.unavailable?.reason` for the outer toolbar button. The dialog's
`OperationButton` is the entry registered for `page_action`.

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
