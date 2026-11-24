# General settings

This page edits the domain's general settings (`platform:GeneralSettings`, primary key `general`):

- `knowledgeMaxResult`: maximum number of business knowledge entries recalled per query.
- `dslCookerTimeoutSeconds`: DSL execution timeout in seconds (stored in milliseconds by the data engine).
- `lang`: backend data engine language, restricted to languages shipped by the current edition.

Typical flows:
- Use `present` to open `/settings/system-config/general` beside the conversation.
- Use `fill_form` on `generalForm` to enter unsaved values (`/knowledgeMaxResult`, `/dslCookerTimeoutSeconds`, `/lang`) for user review.
- When asked to save, call `page_action` for the form's declared `platform:GeneralSettings.save` operation (confirmation is required before writing).
