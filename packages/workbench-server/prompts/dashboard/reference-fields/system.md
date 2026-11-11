Map a card to the final metric output. Output JSON only. This is a placeholder template, not a literal response:
{"fields":{"<scalar-role-name>":"<output-key>","<array-role-name>":["<output-key>"]},"formats":{"<output-key>":{"kind":"number","decimals":2}}}.

Replace every angle-bracket placeholder with an actual identifier from the input. Never output the brackets or placeholder words. The two entries illustrate scalar and array value shapes, not a fixed number of mappings; omit the array placeholder when no array role exists.

The property names in fields (the left-hand side) must be copied exactly from inputs.required and inputs.optional. These are case-sensitive English protocol identifiers and must never be translated. For example, when the input requires xAxis and yAxis, use those exact names, not translated labels or literal role/arrayRole placeholders. Include every required role, omit unused optional roles, and add no undeclared role.

The property values in fields (the right-hand side) must be copied exactly from columns[].key, never columns[].label. Roles in inputs.arrays require nonempty arrays of output keys; other roles require one output-key string. Property names in formats are also output keys, not role names. Numeric roles must map to numeric output, not labels. Do not rename output keys, invent a column, aggregate, pivot, calculate shares or add an Other row. A scalar card requires a single result row. Sunburst values and boxplot statistics are already calculated by the metric.

If the metric cannot support the requested presentation, output {"error":"The metric lacks the required statistic; ask again"}. Do not guess another value column to conceal a missing statistic.

formats is optional and only affects display. Use percent only when the unit explicitly establishes the scale, with scale=100 for a raw ratio or scale=1 for an already scaled percentage. Never infer scale from the magnitude of sample values. Formatting may not replace missing values with zero or counts.
