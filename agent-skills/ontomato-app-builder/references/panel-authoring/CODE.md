# HTML, CSS and Vue panel

Write ordinary HTML and CSS in `panel.html`, with a `<div id="app">` Vue template. A named
`<projection slot="detail"></projection>` mounts the member declared as `detail`. Use Vue for conditional display
and interactions. For layout, use the CSS your page needs inside its host.

Declare the projections and shared typed state in `panel.json` as `{manifest, content?}`. The manifest has
`state`, `members` and `events`. For example, the list member's selected output and the detail member's object
input can use the same object-reference state. To retain that selection in the address, set its `deepLink` flag.

In `panel.mjs`, import the host runtime, read panel state from the current context and mount your component.

```js
import { computed } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected);
    return { selected };
  },
});
```

In this snippet, `selected` is the field you declared in the manifest. In the template you can use
`v-if="selected"` for the detail. Use `instance.state.set` or a declared panel event when page code changes
state. Read displays and owner forms through their projection members.

Use the supplied agent-settings example for the complete source layout and its registration inputs. The repository
source is `packages/apps-sdk/examples/panels/agent-settings/`. Use the example for its layout, state bindings and
form patterns. Give your page its own IDs, owner declarations and application use.

The panel registration input carries `manifest` and `content: {html, module}`. Use the same source text as
`panel.html` and `panel.mjs`. Include the generated translations or recipes when your page uses them.
Check and register as above, then open the use path.
