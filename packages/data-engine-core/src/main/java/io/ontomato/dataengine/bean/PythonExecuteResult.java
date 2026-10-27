package io.ontomato.dataengine.bean;

import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.dataAdapter.DslRowLimit;
import lombok.Data;

@Data
public class PythonExecuteResult {

	private String result;
	private String error;
	private Long spendTime;
	/**
	 * Present only when a query this run sent to {@code /ontology/query/execute-dsl} returned a partial answer:
	 * the engine's answer-level {@code truncated}/{@code rowLimit}/{@code truncationHint}, recorded
	 * by the Python runtime. Anything the program computed from that query covers only the
	 * processed portion, even when it prints a single row.
	 */
	private JSONObject partialQuery;

	/** Mark {@code target} with this run's partial-result fields; a complete run leaves it untouched. */
	public void markCompleteness(JSONObject target) {
		if (partialQuery != null) {
			target.put(DslRowLimit.TRUNCATED, true);
			target.put(DslRowLimit.ROW_LIMIT, partialQuery.getInteger(DslRowLimit.ROW_LIMIT));
			target.put(DslRowLimit.TRUNCATION_HINT, partialQuery.getString(DslRowLimit.TRUNCATION_HINT));
		}
	}

	/** Tool feedback for the model after a test run; empty when every query was complete or the run failed (the error is reported instead). */
	public String partialResultNotice() {
		if (partialQuery == null || (error != null && !error.isBlank())) {
			return "";
		}
		Integer rowLimit = partialQuery.getInteger(DslRowLimit.ROW_LIMIT);
		String hint = partialQuery.getString(DslRowLimit.TRUNCATION_HINT);
		return "IMPORTANT: at least one query in this program returned an INCOMPLETE result"
				+ (rowLimit == null ? ". " : " (working-set/output limit: " + rowLimit + " rows; the rows actually returned can be fewer). ")
				+ (hint == null ? "" : hint + " ")
				+ "The program output is a valid partial result and the platform marks it as incomplete on delivery."
				+ " Totals, rankings, statistics and empty results describe only the processed portion; do not present"
				+ " them as complete, and do not treat this as an execution error or keep retrying merely to remove the notice.\n";
	}

}
