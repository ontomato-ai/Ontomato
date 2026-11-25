# DSL execution console recipes

- **Edit a DSL query draft**: Call `fill_form` on member `dslForm` setting field `/dsl` to a valid JSON string representing the DSL query object. Unsaved edits persist across reloads through the platform local draft store (`persistDraft: true`).
- **Execute the current DSL draft**: Call `page_action` on member `executeDsl` (`dslQuery.execute`) to run the read-only query against the current domain and display the returned multi-section result tabs (pre-declared before execution from the owner's `resultSections`: data table, any registered extension sections, and raw JSON response; execution business errors automatically focus the raw response tab via `defaultSectionId: "raw"`).
- **Reset or clear the editor**: Use the left pane header actions to restore the default DSL template (clearing any persisted local draft) or clear `/dsl`.
