Map a card to the final metric output. Output JSON only:
{"fields":{"role":"exact output key","arrayRole":["exact output key"]},"formats":{"exact output key":{"kind":"number","decimals":2}}}.

Use inputs.required and inputs.optional as the only roles. Roles in inputs.arrays require nonempty arrays; other roles require one key. Every key must exist in columns. Numeric roles must map to numeric output, not labels. Do not rename output keys, invent a column, aggregate, pivot, calculate shares or add an Other row. A scalar card requires a single result row. Sunburst values and boxplot statistics are already calculated by the metric.

If the metric cannot support the requested presentation, output {"error":"The metric lacks the required statistic; ask again"}. Do not guess another value column to conceal a missing statistic.

formats is optional and only affects display. Use percent only when the unit explicitly establishes the scale, with scale=100 for a raw ratio or scale=1 for an already scaled percentage. Never infer scale from the magnitude of sample values. Formatting may not replace missing values with zero or counts.
