# Register and open

Write each new projection inline in `manifest.members`, run `panel check <directory>`, then `panel register <directory>`.
Registration writes each new projection's UUID into `panel.json` as `id` (keep it on future edits). Use
`target.projectionId` to reuse an existing projection.

- Application IDs start with `app-`, and paths start with `/applications/<application-id>/`.
- Give every `panelUse` a domain-unique `pageKey`. Include `names` for menu entries; omit `names` for detail entries
  opened only via navigation or deep links. Optional per-entry `icon` uses any key from `sdk icons`, and optional
  `pageComposer: "none"` suppresses the host's bottom floating composer (defaults to `"bottom"`).
- For domain-member apps, set `entryAccess: ["domain-member"]` and `access: { kind: "domain-member" }`. For restricted
  apps, declare app-owned permissions (e.g. `app:app-my-app:view`).
- Set `"allowStandalone": true` when the application should support standalone external links (`standalone=1`, copied
  from the sidebar application menu or application properties).
- Choose `declaration.icon` from `node "$SKILL/scripts/ontomato.mjs" sdk icons`.
- Omit `defaultAgent` to use the general assistant; set `{ kind: "id", id }` or `{ kind: "preset", agentKind }` only
  when that agent already selects this panel's skill.
