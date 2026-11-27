---
name: ontomato-page-operator
description: Discover applications and pages, read the current page, fill forms, and invoke declared page operations.
---

Use this skill to work with product pages through the platform's page boundary. It teaches method only. Do not assume that a page, entrance, projection, operation, or permission exists until the discovery client, generated page description, current page context, or a tool receipt supplies it.

## Discovery client

Use the bundled client instead of assembling curl commands:

```bash
node /skills/ontomato-page-operator/client.mjs catalog
node /skills/ontomato-page-operator/client.mjs catalog <applicationId>
node /skills/ontomato-page-operator/client.mjs search <query>
node /skills/ontomato-page-operator/client.mjs description <applicationId> <entryKey> <pageKey>
node /skills/ontomato-page-operator/client.mjs read '<read-request-json>'
```

The runtime mounts this skill at `/skills/ontomato-page-operator`. The client reads the run callback URL, credential, and run ID from the injected environment. Never copy or print those credentials.

Discovery is permission-bound and hierarchical:

1. `catalog` with no application lists only applications the initiating user can enter.
2. `catalog <applicationId>` lists that application's admitted groups and entries.
3. `search <query>` searches admitted applications, groups, entries, and usable panel metadata. If several entrances match, ask the user to choose instead of guessing.
4. `description ...` generates the current Markdown description for one exact admitted entrance. Use it only after choosing the entrance; do not fetch descriptions speculatively for many pages.
5. `read ...` reads named projection data using the exact registered source, member path, data name, and inputs documented by the generated page description or current page context.

If `read` fails or is forbidden, say plainly that the page data could not be read and give the failure reason. Never substitute data taken from another endpoint, prior knowledge, or a guess as though it were the page's current data. If your agent has a configured data scope, a successful read includes only data inside that scope; say that the result is within your configured data scope and do not present it as the unrestricted page total.

## Current page context

When the host says which page is open, use that placement directly: application, entry, use ID, panel, canonical path, and member path are already known. Do not search merely to establish the current page. Fetch its generated description only when the task needs projection, form, recipe, or operation details that are not already present.

## Open, observe, fill, and act

Use platform tools when exposed:

- `present({ target })` opens a canonical entry path beside the conversation; `present({ target, state })` also updates declared public page state. Read the receipt and stop if the target is refused.
- `observe_display` re-reads the live display, selections, open forms, and unsaved contents.
- `fill_form` fills explicit field paths. If existing unsaved edits are reported, do not overwrite them silently.
- `page_action` invokes only operations declared in the generated page description. It uses the same permission and confirmation boundary as the signed-in user; never call the underlying write endpoint directly.

For a write returning `awaiting_confirmation`, do not poll or retry. Finish the round or continue independent work; the host resumes after the user answers. Use the declared discard operation when the user asks to abandon unsaved edits.

Write platform links as site-relative paths beginning with `/`. Page access, panel/projection use, object/data permissions, write permissions, and confirmation remain enforced by the platform; this skill grants no extra access. If catalogue or search omits an entrance, treat it as unavailable to the initiating user.
