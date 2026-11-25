# DSL execution console recipes

- **Edit a DSL query draft**: Call `fill_form` on member `dslForm` setting field `/dsl` to a valid JSON string representing the DSL query object.
- **Execute the current DSL draft**: Call `page_action` on member `executeDsl` (`dslQuery.execute`) to run the read-only query against the current domain and display the returned multi-section result tabs (data table, any registered extension sections, and raw JSON response).
- **Reset or clear the editor**: Use the left pane header actions to restore the default DSL template or clear `/dsl` without persisting any draft state to browser storage.
