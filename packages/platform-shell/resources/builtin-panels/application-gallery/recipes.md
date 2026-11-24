# Application gallery

Use this panel to browse applications and agents available to the current user, filter them by category or search term, open them, and pin or unpin shortcuts in the user's personal workspace.

## Common tasks

1. **Filter by category or keyword**:
   - Set public state `category` to one of `all`, `business`, `agents`, `build`, or `admin`.
   - Set public state `search` to filter applications and agents by localized name or description.
2. **Pin or unpin an application**:
   - Locate the target `platform:Application` row in `applications`.
   - Call `applications.favorite` with `rowKey` to pin it to the user's personal workspace, or `applications.unfavorite` to remove it. Both operations are idempotent and only affect the current user's personal preferences.
3. **Pin or unpin an agent**:
   - Locate the target `platform:AgentDefinition` row in `agents`.
   - Call `agents.favorite` with `rowKey` to pin it to the user's personal workspace, or `agents.unfavorite` to remove it.
4. **Confirm before mutating**:
   - Unless the session runs in full-auto mode, request user confirmation through `page_action` before pinning or unpinning an application or agent.
