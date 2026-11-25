# Maintain student records

- To view a student, use `present` with their typed `selected` reference and `mode: "view"`.
- To edit that student, use `present` with the same `selected` and `mode: "edit"`, then `fill_form` on `editForm`.
- To add a student, use `present` with `mode: "create"`, then `fill_form` on `createForm`.
- Keep changes visible for review. When asked to save, call `page_action` for the mounted form's declared save.
