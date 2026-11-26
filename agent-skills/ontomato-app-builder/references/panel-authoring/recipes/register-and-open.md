# Check and open an application

## Preview and publish a local application tree

Use this flow for a directory with `application.json`, `panels/`, and any owned `projections/`. Connect the CLI to the
same deployment and domain as your browser using the [connection guide](../../../GUIDE.md#connection-and-workspace).
You need access to Application Builder and permission to publish the application.

1. In **Application Builder**, select **New application** and open the resulting draft. Use the assigned `app-…` ID
   shown in the selected draft's address for the application and entry paths under `/applications/<app-id>/`.
   For the first publish, set `initialOpenEntryIds` in `application.json` to the entry IDs to open to the domain.
2. From your terminal, check the complete local source against the target deployment.

   ```sh
   node "$SKILL/scripts/ontomato.mjs" panel check "$APP_DIR"
   ```

   Set `APP_DIR` to the directory containing `application.json`. The component single page, `components.json`, and
   this check share the camelCase `config` names. Use the keys listed in the error to correct an unpublished key.
3. In the selected draft's Application Builder conversation, provide the local files with their relative paths and
   ask the agent to copy them into the mounted `work/` directory and run `panel check` on that tree. The runtime
   records a source commit after the run. Use **Files** to inspect the copied tree and **History** to identify the commit.
   The CLI's `workspace create` and `workspace import` operate on personal workspaces. Application Builder's draft
   source is stored in the application's workspace.
4. Open the workspace pane and select **Preview**. Choose the entry to review. After user confirmation, use
   **Publish** for the checked commit. If the page reports drift for an existing app, follow the
   [Sync and Publish instructions](../../../GUIDE.md#check-preview-and-publish).
5. Open the published app from Application Builder or use `entry.home` (when set) or `entry.path` from
   `application.json` on the deployment. Check that the entry opens with the intended access.

## Register an existing single-panel source

For an existing root with `panel.json` and `panel.html`, use a registration file that identifies the panel and,
if it should open as an application entry, declares the application and its panel uses. Run the following with
the authorized credentials, the panel's source directory as `PANEL_DIR`, and the registration file as `MATERIAL`.

```sh
node "$SKILL/scripts/ontomato.mjs" panel check "$PANEL_DIR" --material "$MATERIAL"
node "$SKILL/scripts/ontomato.mjs" panel register "$PANEL_DIR" --material "$MATERIAL"
node "$SKILL/scripts/ontomato.mjs" panel applications
```

After the check passes, run registration with permission to write the declared resources. Open the registered
application's declared entry from the deployment. `panel preview <working|commit> --workspace <id>` returns JSON
for a single-panel candidate in a personal workspace. To inspect the candidate there, run `workspace create <name>`,
import the single-panel root with `workspace import <id> <directory> --message <text>`, then pass the returned
commit or `working` to `panel preview`. The candidate needs a runtime-ready `panel.json` whose manifest references
existing authorized panels and projections. The **Preview** tab in Application Builder renders complete application trees.
