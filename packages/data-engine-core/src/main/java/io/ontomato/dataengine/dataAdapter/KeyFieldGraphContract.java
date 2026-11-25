package io.ontomato.dataengine.dataAdapter;

import java.util.ArrayList;
import java.util.List;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

/**
 * The graph subset a source that stores edges as key columns can render.
 *
 * <p>Such a source joins two aliases through one concrete relationship definition. It cannot
 * choose among a union of relationship types, match a wildcard, or traverse a hop range. Quietly
 * using the first type or rendering one hop would return a plausible but different answer, so the
 * unsupported shape is rejected with a located DSL violation.</p>
 */
public final class KeyFieldGraphContract {

	private KeyFieldGraphContract() {
	}

	/** Check every relationship of one pattern; {@code wherePrefix} locates each in the DSL. */
	public static void requireSupported(JSONArray relationships, String wherePrefix) {
		if (relationships == null) {
			return;
		}
		for (int i = 0; i < relationships.size(); i++) {
			JSONObject relationship = relationships.getJSONObject(i);
			String where = wherePrefix + "[" + i + "]";
			requireSingleHop(relationship, where);
			requireSingleType(relationship, where);
		}
	}

	/**
	 * Reject a relationship whose hop range is not exactly one hop.
	 *
	 * <p>An absent field means one hop. {@code max_hops=-1} and any explicit range still have a
	 * different meaning and cannot be represented by a direct key-column join.</p>
	 */
	public static void requireSingleHop(JSONObject relationship, String where) {
		Integer min = relationship.getInteger("min_hops");
		Integer max = relationship.getInteger("max_hops");
		boolean oneHop = (min == null || min == 1) && (max == null || max == 1);
		if (oneHop) {
			return;
		}
		JSONArray types = relationship.getJSONArray("type");
		String name = types != null && types.size() == 1 ? types.getString(0) : null;
		throw violation(
				where,
				"relationship" + (name == null ? "" : " [" + name + "]")
						+ " asks for hops " + (min == null ? 1 : min) + ".." + (max == null ? 1 : max)
						+ ", but this source stores edges as key columns and can only render exactly one hop");
	}

	/** Reject a relationship type union, wildcard, or missing named type. */
	public static void requireSingleType(JSONObject relationship, String where) {
		JSONArray types = relationship.getJSONArray("type");
		if (types == null || types.size() != 1) {
			throw violation(
					where + ".type",
					"relationship types " + typeLabel(types)
							+ " select " + (types == null ? 0 : types.size())
							+ " entries, but this source stores edges as key columns and requires exactly one named relationship type");
		}
		String name = types.getString(0);
		String normalized = name == null ? "" : name.trim();
		if (normalized.isEmpty() || "*".equals(normalized)) {
			throw violation(
					where + ".type",
					"relationship type " + typeLabel(types)
							+ " is a wildcard/empty selector, but this source stores edges as key columns and requires exactly one named relationship type");
		}
	}

	private static String typeLabel(JSONArray types) {
		if (types == null) {
			return "[]";
		}
		List<String> names = new ArrayList<>(types.size());
		for (int i = 0; i < types.size(); i++) {
			Object value = types.get(i);
			names.add(value == null ? "<null>" : String.valueOf(value));
		}
		return "[" + String.join(", ", names) + "]";
	}

	private static DslContractViolationException violation(String where, String message) {
		return new DslContractViolationException(
				DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
				where,
				message);
	}
}
