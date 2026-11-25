# Maintain courses

- To edit a course, use `present` with its typed `editing` reference and the relevant `tab` (`details` or `capacity`).
- Use `fill_form` on `form`. When asked to save, call `page_action` for its declared save.
- To archive a course, use the table's declared archive operation with that row's key. The default is conversation confirmation.
