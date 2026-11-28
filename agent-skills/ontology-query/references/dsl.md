# DSL reference entry

The ontology service generates the DSL rules and examples from the selected
classes and their actual attribute types. This package does not duplicate the
grammar. Run:

```bash
node ontomato.mjs schema /your-class
node ontomato.mjs dsl-reference /your-class
node ontomato.mjs execute-dsl @query.json
```

The runtime tool equivalents are `ontology_schema`, `ontology_dsl_reference` and
`ontology_execute_dsl`. Pass `classNames` for the first two. The execution tool
accepts either `dsl` or a workspace JSON `path`. Its Java endpoint receives one
DSL object, never a runtime path or user/domain override.

The generated `exampleMarkdown` contains one DSL object as an illustration.
Submit that object itself, not the Markdown fence. Use only
the returned class/attribute/relationship names and supported read operations.
Do not invent SQL or write actions. Re-fetch rules after changing class scope.

A response is `{"data": [{"answer": [rows]}], ...}` with optional partial-result
metadata: `data` is an array, and the rows of the query are `data[0].answer`, each
row keyed by its output `as` names. A script that reads a saved response takes
`data[0].answer` (inside a query package, `execute_dsl_file` already returns the
rows). Preserve nulls, source limits and errors; a partial zero-row result is
not proof of no matching business objects. No request-body admin/user override
or legacy `/dsl/execute` route is supported.
