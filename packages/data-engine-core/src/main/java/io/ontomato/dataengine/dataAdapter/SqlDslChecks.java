package io.ontomato.dataengine.dataAdapter;

import static io.ontomato.dataengine.dataAdapter.DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

/** Checks selected by local SQL adapters that only translate output clauses on the terminal step. */
public final class SqlDslChecks {
	private SqlDslChecks() {}

	public static void requireSupported(JSONObject dsl, Class<? extends DataAdapter> source) {
		JSONArray steps = dsl.getJSONObject("answer").getJSONArray("steps");
		if (steps.size() == 2) {
			requireTerminalOutputClauses(steps.getJSONObject(0), source);
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
