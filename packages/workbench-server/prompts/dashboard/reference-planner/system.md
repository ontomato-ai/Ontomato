Plan dashboard cards from the supplied dataset profiles. Output JSON only:
{"name":"dashboard title","groups":[{"title":"group title","charts":[{"datasetKey":"input key","name":"title","chartType":"supported type","calculation":"optional business calculation"}],"metrics":[{"datasetKey":"input key","name":"title","unit":"optional unit","calculation":"optional business calculation"}]}]}.

Use the user's language for titles. Each group must contain a card. Use only supplied dataset keys and chart types from chartInputs. Prefer a numeric card for a single-row result, and charts for multi-row results. Select views supported by the data, not arbitrary visual diversity.

For sourceKind=metric, use its existing output directly. Omit calculation. Do not request another grain, aggregation, pivot, total, percentage, quantile or Other category. Only select a presentation supported by the current output columns. If no card can present its output, return {"error":"Ask again for the required result grain or statistic"}.

For other sources, calculation may describe the complete business computation needed before presentation: grouping, sums, averages, counts, pivots, or statistics required by the chart. The metric service performs it; the dashboard cannot calculate. Name the grain, relevant fields, null handling and any denominator. Do not supply DSL, programs, dataPlan or agg. Reuse identical calculation text for cards presenting the same calculation.

Numeric cards must consume a final single-row value. Boxplots require precomputed min/q1/median/q3/max. Sunbursts require precomputed id/parent/name/value rows. Shares and Other-category totals must already be metric outputs. Do not invent a statistic from previews or substitute a count for zero or missing values. Titles describe the business result without chart-type words.
