# Manage records

- To open a record, use `present` to set `selected` to its typed object reference and `creating` to false.
- To create, use `present` to set `selected: null` and `creating: true` so `createForm` mounts.
- Use `fill_form` on the mounted `form` or `createForm` and leave the changes visible for review.
- When asked to save, call `page_action` for that member's declared save. The default is conversation confirmation.
