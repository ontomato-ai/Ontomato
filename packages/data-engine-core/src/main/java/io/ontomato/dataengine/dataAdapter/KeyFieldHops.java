package io.ontomato.dataengine.dataAdapter;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

/**
 * The hop range a DSL relationship asks for, checked against what a key-field source can render.
 *
 * <p>A source that stores edges as key columns joins two aliases directly, so every relationship it can
 * render is exactly one hop. {@code max_hops} is not a performance hint there: it changes what the
 * answer means. Rendering one hop for a request that asked for two returns a plausible-looking but
 * different result, which is worse than refusing — the caller cannot tell the two apart. This class
 * turns that into a located violation instead.</p>
 *
 * <p>An absent field means one hop, which is what the DSL rule already states: {@code min_hops} may
 * only be 1, and {@code max_hops} of -1 means unlimited. Both of those are checked, because a
 * key-field source can render neither a range nor an unbounded traversal.</p>
 */
public final class KeyFieldHops {

	private KeyFieldHops() {
	}

	/**
	 * Reject a relationship whose hop range is not exactly one hop.
	 *
	 * @param relationship one element of the DSL's {@code graph.patterns[].relationship}
	 * @param where        the DSL path to name in the violation
	 */
	public static void requireSingleHop(JSONObject relationship, String where) {
		Integer min = relationship.getInteger("min_hops");
		Integer max = relationship.getInteger("max_hops");
		boolean oneHop = (min == null || min == 1) && (max == null || max == 1);
		if (oneHop) {
			return;
		}
		JSONArray types = relationship.getJSONArray("type");
		String name = types == null || types.size() == 0 ? null : types.getString(0);
		throw new DslContractViolationException(
				DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
				where,
				"relationship" + (name == null ? "" : " [" + name + "]")
						+ " asks for hops " + (min == null ? 1 : min) + ".." + (max == null ? 1 : max)
						+ ", but this source stores edges as key columns and can only render exactly one hop");
	}

	/** Check every relationship of one pattern; {@code wherePrefix} locates each in the DSL. */
	public static void requireSingleHop(JSONArray relationships, String wherePrefix) {
		if (relationships == null) {
			return;
		}
		for (int i = 0; i < relationships.size(); i++) {
			requireSingleHop(relationships.getJSONObject(i), wherePrefix + "[" + i + "]");
		}
	}
}
