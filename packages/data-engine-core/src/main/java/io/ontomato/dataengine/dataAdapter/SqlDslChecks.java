package io.ontomato.dataengine.dataAdapter;

import static io.ontomato.dataengine.dataAdapter.DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

/** Rejects constructs the local SQL adapters would otherwise omit during translation. */
public final class SqlDslChecks {
	private SqlDslChecks() {}

	public static void requireSupported(JSONObject dsl, Class<? extends DataAdapter> source) {
		JSONArray steps = dsl.getJSONObject("answer").getJSONArray("steps");
		requireRelationshipsForMultipleObjects(steps, source);
		if (steps.size() == 2) {
			requireTerminalOutputClauses(steps.getJSONObject(0), source);
		}
	}

	private static void requireRelationshipsForMultipleObjects(JSONArray steps, Class<? extends DataAdapter> source) {
		for (int s = 0; s < steps.size(); s++) {
			JSONObject graph = steps.getJSONObject(s).getJSONObject("graph");
			JSONArray patterns = graph == null ? null : graph.getJSONArray("patterns");
			if (patterns == null) {
				continue;
			}
			for (int p = 0; p < patterns.size(); p++) {
				JSONObject pattern = patterns.getJSONObject(p);
				JSONArray objects = pattern.getJSONArray("objects");
				if (objects != null && objects.size() > 1 && !hasEntries(pattern.getJSONArray("relationship"))) {
					throw unsupported(source, "steps[" + s + "].graph.patterns[" + p + "].relationship",
							"This data source does not support multiple objects in one pattern without relationships. "
							+ "Connect them using declared relationships or query them separately.");
				}
			}
		}
	}

	private static void requireTerminalOutputClauses(JSONObject firstStep, Class<? extends DataAdapter> source) {
		JSONObject output = firstStep.getJSONObject("output");
		JSONObject groupBy = output.getJSONObject("group_by");
		String hint = " is only supported on the final step of a two-step query.";
		if (groupBy != null && !DslGrammarValidator.hasMultipleObjects(firstStep)) {
			if (hasEntries(groupBy.getJSONArray("having"))) {
				throw unsupported(source, "steps[0].output.group_by.having", "HAVING" + hint);
			}
			if (hasEntries(groupBy.getJSONArray("fields"))) {
				throw unsupported(source, "steps[0].output.group_by", "GROUP BY" + hint);
			}
		}
		JSONObject sort = output.getJSONObject("sort");
		if (sort != null && hasEntries(sort.getJSONArray("fields"))) {
			throw unsupported(source, "steps[0].output.sort", "Sorting" + hint);
		}
		JSONObject limit = output.getJSONObject("limit");
		if (limit != null && limit.get("count") != null) {
			throw unsupported(source, "steps[0].output.limit", "Limiting rows" + hint);
		}
	}

	private static boolean hasEntries(JSONArray values) {
		return values != null && !values.isEmpty();
	}

	private static DslContractViolationException unsupported(Class<? extends DataAdapter> source, String path, String detail) {
		return new DslContractViolationException(UNSUPPORTED_CONSTRUCT, path, source.getSimpleName() + ": " + detail);
	}
}
