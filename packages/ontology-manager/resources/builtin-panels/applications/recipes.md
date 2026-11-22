# Applications catalogue — agent recipes

This page manages platform and domain applications (`platform:Application`).

## Common flows

1. **Create an application**:
   - Draft `platform:Application.save` with a `draft` target (`createForm`), filling `/declaration/names`, `/declaration/descriptions`, `/declaration/icon`, and `/shared` (initial domain sharing).
2. **Edit application identity**:
   - Draft `platform:Application.save` targeting the application ID (`section: "identity"`), updating `/names`, `/descriptions`, or `/icon`.
3. **Add or edit a single entry**:
   - Draft `platform:Application.save` on `entryForm` (`section: "entry"`, `entryId`), updating `/id`, `/pageKey`, `/path`, `/panelId`, `/names`, `/descriptions`, `/groupKey`, `/access`, `/defaultAgent`, or `/inputs`.
4. **Reorder or bulk edit entries**:
   - Draft `platform:Application.save` on `entriesForm` (`section: "entries"`), updating `/entry/path` or `/panelUses`.
5. **Manage grants and domain sharing**:
   - Call `applications.grant` (`principalKind: "principal" | "role"`, `principalId`, `verb: "use" | "edit"`, `remove`) or `applications.share` (`shared: boolean`).
6. **Delete a domain application**:
   - Call `applications.delete` targeting the application ID (requires confirmation; built-in applications cannot be deleted).
