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

The generated `exampleMarkdown` contains a one-item array as an illustration.
Submit its single DSL object, not the outer example array or Markdown. Use only
the returned class/attribute/relationship names and supported read operations.
Do not invent SQL or write actions. Re-fetch rules after changing class scope.

Responses contain `data` groups with `answer` and optional partial-result
metadata. Preserve nulls, source limits and errors; a partial zero-row result is
not proof of no matching business objects. No request-body admin/user override
or legacy `/dsl/execute` route is supported.
