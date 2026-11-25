# Read-only projection outputs

Render business data with projections. Use `usePanelOutput(member, name)` in synchronous Vue setup for a declared
read-only output. It starts no reads. Only mounting the projection lets its component request its data. Keep the
producer mounted with `v-show` when temporarily hidden and its output controls surrounding layout. Wrap trailing
projections in a compact container (for example an inline-flex span inside `<app-menu #item-trailing>`) so the
projection's box fits the slot. Mount dependent UI only when its inputs are ready.

Wire one member's read-only output directly to another member's inputs. For example, connect the
`ObjectForm` member `form` to `AnnotatedCode.currentCode` inside the code member:

```json
{
  "inputs": {
    "currentCode": { "output": { "member": "form", "name": "draft", "path": "/function/code" } },
    "language": { "literal": "python" }
  }
}
```

(`AnnotatedCode` applies zero-dependency syntax highlighting automatically whenever a supported `language` is supplied
via `config.language`, `inputs.language`, or the `content` datum.)

Use a JSON Pointer for nested values and omit `path` for the whole output. Keep outputs such as
`usePanelOutput("list", "listed")` and `usePanelOutput("form", "draft")` outside writable `manifest.state`.
A member's `state` shorthand maps the named component inputs or writable outputs and owner read parameters
to public state. It expands to the matching inputs and outputs declared by the component. Use `state` and,
where explicit input sources are needed, `inputs` on inline shorthand members. The `outputs` key is reserved
for formal placements.

Read [the component reference](offline-check-and-sdk-docs.md) for data ports, props, configuration, slots,
events, output types and defaults.

For each component's full data ports, configuration, inputs, outputs, slots, and events, read the SDK catalogue directly instead of duplicating it here:

- **Grouped overview (a few KB):** `node "$SKILL/scripts/ontomato.mjs" sdk read docs/components.md`
- **Single component page:** `node "$SKILL/scripts/ontomato.mjs" sdk read docs/components/<ComponentId>.md` (for example `ObjectList.md`, `ObjectForm.md`, `OperationButton.md`, `ConversationEntry.md`)
- **UI primitives & theme tokens:** `sdk read docs/components/ui-primitives.md` and `sdk read docs/components/theme-tokens.md`
