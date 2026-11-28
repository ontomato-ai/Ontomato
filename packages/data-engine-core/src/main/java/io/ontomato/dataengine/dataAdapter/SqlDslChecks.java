package io.ontomato.dataengine.dataAdapter;

import static io.ontomato.dataengine.dataAdapter.DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

/** Checks selected by local SQL adapters that only translate output clauses on the terminal step. */
public final class SqlDslChecks {
	public enum TextSearch {
		UNAVAILABLE,
		ALL_TEXT_COLUMNS_LIKE
	}

	private SqlDslChecks() {}

	public static void requireSupported(JSONObject dsl, Class<? extends DataAdapter> source,
			TextSearch textSearch) {
		JSONArray steps = dsl.getJSONObject("answer").getJSONArray("steps");
		JSONObject firstStep = steps.getJSONObject(0);
		if (steps.size() == 2) {
			requireTerminalOutputClauses(firstStep.getJSONObject("output"), source);
		}
		requireSupportedText(firstStep, source, textSearch);
	}

	private static void requireTerminalOutputClauses(JSONObject output, Class<? extends DataAdapter> source) {
		JSONObject groupBy = output.getJSONObject("group_by");
		String hint = " is only supported on the final step of a two-step query.";
		if (groupBy != null) {
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

	private static void requireSupportedText(JSONObject step, Class<? extends DataAdapter> source,
			TextSearch textSearch) {
		JSONArray objects = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
				.getJSONArray("objects");
		for (int i = 0; i < objects.size(); i++) {
			JSONObject object = objects.getJSONObject(i);
			JSONObject conditions = object.getJSONObject("conditions");
			JSONObject text = conditions == null ? null : conditions.getJSONObject("text");
			if (text == null || text.getString("query") == null || text.getString("query").isBlank()) {
				continue;
			}
			String operator = text.getString("operator");
			boolean hasBoost = text.get("boost") != null;
			String path = "steps[0].graph.patterns[0].objects[" + i + "].conditions.text";
			if (textSearch == TextSearch.UNAVAILABLE) {
				if (hasEntries(text.getJSONArray("fields")) || operator != null || hasBoost) {
					throw unsupported(source, path, "Full-text search is unavailable. Use a property condition for a literal text filter.");
				}
				continue;
			}
			if (operator != null) {
				throw unsupported(source, path + ".operator",
						"Full-text mode '" + operator + "' is unavailable. Use a property condition for a literal text filter.");
			}
			if (hasBoost) {
				throw unsupported(source, path + ".boost", "Text search does not apply relevance weights. Remove boost.");
			}
		}
	}

	private static boolean hasEntries(JSONArray values) {
		return values != null && !values.isEmpty();
	}

	private static DslContractViolationException unsupported(Class<? extends DataAdapter> source, String path, String detail) {
		return new DslContractViolationException(UNSUPPORTED_CONSTRUCT, path, source.getSimpleName() + ": " + detail);
	}
}
