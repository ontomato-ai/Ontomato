package io.ontomato.dataengine.dataAdapter;

import java.util.List;
import java.util.Map;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

/**
 * The DSL-layer grammar gate: checks only what can be judged without a data source.
 *
 * <p>Today that is one rule — a {@code timeseries} condition must reference an attribute of type
 * {@code bucket}, which is the construct's own precondition. A contradiction like that is a property
 * of the DSL itself, not of any deployment, so it is rejected here with
 * {@link DslContractViolationException.Code#INVALID_GRAMMAR} before any adapter is asked to render it.</p>
 *
 * <p>Anything a deployment <em>cannot</em> render stays an adapter-level concern
 * ({@link DslContractViolationException.Code#UNSUPPORTED_CONSTRUCT}): this gate never decides what a
 * data source supports, so the adapter-blind planner still only needs to retry with a supported shape.
 * Both codes share one failure channel, so ABC, the legacy pipeline and MCP all pass the same door.</p>
 */
public final class DslGrammarValidator {

	/** Resources a vector query returns when it names no {@code topK}. */
	public static final int VECTOR_TOP_K_DEFAULT = 20;

	/** The most resources one vector query may ask for. */
	public static final int VECTOR_TOP_K_MAX = 50;

	private DslGrammarValidator() {
	}

	/**
	 * The {@code topK} of a vector query item (a {@code conditions.vector} entry or an output field
	 * with {@code query}), or the default when absent. {@link #validate} has already rejected any
	 * value outside 1..{@value #VECTOR_TOP_K_MAX}.
	 */
	public static int vectorTopK(JSONObject item) {
		Integer topK = item.getInteger("topK");
		return topK == null ? VECTOR_TOP_K_DEFAULT : topK;
	}

	private static void checkTopK(JSONObject item, String path) {
		Object value = item == null ? null : item.get("topK");
		if (value == null) {
			return;
		}
		if (!(value instanceof Integer || value instanceof Long) || ((Number) value).longValue() < 1
				|| ((Number) value).longValue() > VECTOR_TOP_K_MAX) {
			throw new DslContractViolationException(
					DslContractViolationException.Code.INVALID_GRAMMAR,
					path + ".topK",
					"topK of a vector query must be an integer from 1 to " + VECTOR_TOP_K_MAX + ", got " + value);
		}
	}

	/**
	 * Validate one normalized DSL against the domain's class definitions.
	 *
	 * @throws DslContractViolationException when the DSL contradicts itself (e.g. {@code timeseries}
	 *         on a non-bucket attribute)
	 */
	public static void validate(JSONObject dsl, List<Map<String, Object>> classDefs) {
		if (dsl == null || dsl.getJSONObject("answer") == null) {
			return;
		}
		JSONArray steps = dsl.getJSONObject("answer").getJSONArray("steps");
		if (steps == null) {
			return;
		}
		for (int s = 0; s < steps.size(); s++) {
			JSONObject step = steps.getJSONObject(s);
			checkOutputTopK(step, "steps[" + s + "].output.fields");
			JSONArray patterns = step == null || step.getJSONObject("graph") == null
					? null
					: step.getJSONObject("graph").getJSONArray("patterns");
			if (patterns == null) {
				continue;
			}
			for (int p = 0; p < patterns.size(); p++) {
				JSONObject pattern = patterns.getJSONObject(p);
				JSONArray objects = pattern == null ? null : pattern.getJSONArray("objects");
				if (objects == null) {
					continue;
				}
				for (int o = 0; o < objects.size(); o++) {
					JSONObject object = objects.getJSONObject(o);
					JSONObject conditions = object == null ? null : object.getJSONObject("conditions");
					String conditionsPath = "steps[" + s + "].patterns[" + p + "].objects[" + o + "].conditions";
					checkVectorTopK(conditions == null ? null : conditions.getJSONObject("vector"), conditionsPath + ".vector");
					JSONObject timeseries = conditions == null ? null : conditions.getJSONObject("timeseries");
					if (timeseries == null) {
						continue;
					}
					// An unresolvable class is a different failure; do not disguise it as a grammar error.
					Map<String, Object> classDef = findClassDef(classDefs, object.getString("class"));
					if (classDef == null) {
						continue;
					}
					String path = "steps[" + s + "].patterns[" + p + "].objects[" + o + "].conditions.timeseries";
					checkTimeseriesFields(timeseries.getJSONObject("properties"), path, object.getString("class"),
							classDef);
				}
			}
		}
	}

	/** Each {@code and}/{@code or} entry of a {@code vector} condition may carry a valid {@code topK}. */
	private static void checkVectorTopK(JSONObject vector, String path) {
		JSONArray entries = vector == null ? null : logicList(vector.getJSONObject("properties"));
		if (entries == null) {
			return;
		}
		for (int i = 0; i < entries.size(); i++) {
			checkTopK(entries.getJSONObject(i), path + ".properties[" + i + "]");
		}
	}

	/** An output field that queries a vector attribute may carry a valid {@code topK}. */
	private static void checkOutputTopK(JSONObject step, String path) {
		JSONObject output = step == null ? null : step.getJSONObject("output");
		JSONArray fields = output == null ? null : output.getJSONArray("fields");
		if (fields == null) {
			return;
		}
		for (int i = 0; i < fields.size(); i++) {
			Object field = fields.get(i);
			if (field instanceof JSONObject json) {
				checkTopK(json, path + "[" + i + "]");
			}
		}
	}

	/** Every field a {@code timeseries} block names must be a bucket-type attribute of its class. */
	private static void checkTimeseriesFields(JSONObject properties, String path, String className,
			Map<String, Object> classDef) {
		JSONArray blocks = logicList(properties);
		if (blocks == null) {
			return;
		}
		for (int i = 0; i < blocks.size(); i++) {
			JSONObject block = blocks.getJSONObject(i);
			String field = block == null ? null : block.getString("field");
			if (field == null) {
				continue;
			}
			String type = attrType(classDef, field);
			if (!"bucket".equals(type)) {
				throw new DslContractViolationException(
						DslContractViolationException.Code.INVALID_GRAMMAR,
						path + "." + field,
						"the timeseries condition uses `" + field + "` of class `" + className + "`, but that attribute is "
								+ (type == null ? "not defined" : "of type `" + type + "`") + ", not `bucket`");
			}
		}
	}

	/**
	 * The one condition a {@code not} negates. {@code not} takes exactly one condition (combine several with
	 * {@code and}/{@code or} inside it); any other arity has no defined meaning and is rejected.
	 */
	public static JSONObject negated(JSONObject condition) {
		JSONArray negated = condition.getJSONArray("not");
		if (negated.size() != 1 || negated.getJSONObject(0) == null) {
			throw new DslContractViolationException(
					DslContractViolationException.Code.INVALID_GRAMMAR,
					"conditions.properties",
					"not takes exactly one condition; combine several with and/or inside it");
		}
		return negated.getJSONObject(0);
	}

	/** The {@code and}/{@code or}/{@code not} list of a timeseries properties block, or null when absent. */
	private static JSONArray logicList(JSONObject properties) {
		if (properties == null) {
			return null;
		}
		for (String key : new String[] { "and", "or", "not" }) {
			JSONArray list = properties.getJSONArray(key);
			if (list != null) {
				return list;
			}
		}
		return null;
	}

	private static Map<String, Object> findClassDef(List<Map<String, Object>> classDefs, String className) {
		if (classDefs == null || className == null) {
			return null;
		}
		for (Map<String, Object> classDef : classDefs) {
			if (className.equals(classDef.get("className"))) {
				return classDef;
			}
		}
		// The DSL may carry the class name with or without the leading separator.
		String alt = className.startsWith("/") ? className.substring(1) : "/" + className;
		for (Map<String, Object> classDef : classDefs) {
			if (alt.equals(classDef.get("className"))) {
				return classDef;
			}
		}
		return null;
	}

	private static String attrType(Map<String, Object> classDef, String field) {
		List<Map<String, Object>> attrs = (List<Map<String, Object>>) classDef.get("attrs");
		if (attrs == null) {
			return null;
		}
		for (Map<String, Object> attr : attrs) {
			if (field.equals(attr.get("name"))) {
				return (String) attr.get("type");
			}
		}
		return null;
	}
}
