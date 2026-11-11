package io.ontomato.dataengine.dataAdapter;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import com.arangodb.ArangoCursor;
import com.arangodb.ArangoDB;
import com.arangodb.ArangoDatabase;
import com.arangodb.entity.CollectionEntity;
import com.arangodb.entity.CollectionType;
import com.arangodb.model.CollectionCreateOptions;
import com.arangodb.model.DocumentCreateOptions;
import com.arangodb.model.OverwriteMode;
import com.arangodb.model.PersistentIndexOptions;

import io.ontomato.dataengine.bean.DslExecutionResult;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DslUtil;
import io.ontomato.dataengine.util.HttpRequestUtil;

import lombok.extern.slf4j.Slf4j;

/**
 * ArangoDB adapter over the ArangoDB Java driver — a document store with a native graph.
 *
 * <p>ArangoDB is a non-JDBC data source: {@link #openConnection()} throws, and
 * {@link #testConnection()} runs native HTTP probes ({@code GET /_api/version},
 * {@code GET /_api/collection}) instead of the JDBC tester. A class maps to a document collection,
 * an object to a document, and a relationship to a <b>real edge document</b> in the relation's edge
 * collection. A relationship definition therefore needs no {@code fromField}/{@code toField}: those
 * are the key-field adapters' way of expressing an edge as a column.</p>
 *
 * <p>The namespace is a <b>collection-name prefix</b>, exactly as in the relational adapters, not a
 * database. The document's primary-key value is stored both in ArangoDB's {@code _key} and in the
 * declared primary-key field, so generic projections and conditions by that field keep working.</p>
 *
 * <p>The read path translates one graph DSL to one AQL query. Objects become {@code FOR v IN coll}
 * clauses, relationships become {@code FOR v IN 1..1 OUTBOUND v0 edgeCollection} traversals, and a
 * two-step DSL nests the first step's projection as a subquery for the second step's aggregation.</p>
 */
@Slf4j
public class ArangoAdapter implements DataAdapter {

	/** An unbounded hop range (max_hops = -1) is capped here so a traversal cannot run away. */
	private static final int MAX_HOPS = 10;

	/** Document keys ArangoDB accepts as-is; anything else is replaced by a stable hash. */
	private static final Pattern SAFE_DOCUMENT_KEY = Pattern.compile("[A-Za-z0-9_:.@()+,=;$'\\-]{1,254}");

	private static final Pattern AQL_IDENTIFIER = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");

	private static final String DRIVER_NAME = "ArangoDB Java Driver";
	private static final String DRIVER_VERSION = "7.20.0";

	private final DataAdapterConnection connection;
	private final Map<String, Object> jsonRule;

	public ArangoAdapter(DataAdapterConnection connection, Map<String, Object> jsonRule) {
		this.connection = connection;
		this.jsonRule = jsonRule;
	}

	// ----------------------------------------------------------------------------------
	// Connection
	// ----------------------------------------------------------------------------------

	@Override
	public java.sql.Connection openConnection() throws java.sql.SQLException {
		throw new UnsupportedOperationException("ArangoDB is not a JDBC data source");
	}

	/** Probes the HTTP API and reports the collections as the source's "tables". */
	@Override
	public JSONObject testConnection() throws Exception {
		long startNanos = System.nanoTime();
		String baseUrl = httpBaseUrl(connection.getUrl());
		HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

		JSONObject version = httpGet(client, baseUrl, "/_api/version");
		String serverVersion = version.getString("version");
		if (serverVersion == null) {
			serverVersion = "";
		}

		JSONObject collections = httpGet(client, baseUrl, "/_api/collection");
		JSONArray tables = new JSONArray();
		JSONArray result = collections.getJSONArray("result");
		if (result != null) {
			for (int i = 0; i < result.size(); i++) {
				JSONObject collection = result.getJSONObject(i);
				Boolean isSystem = collection.getBoolean("isSystem");
				if (Boolean.TRUE.equals(isSystem)) {
					continue;
				}
				tables.add(JSONObject.of("name", collection.getString("name"), "type", "COLLECTION"));
			}
		}

		JSONObject report = new JSONObject();
		report.put("kind", "catalog");
		report.put("databaseProduct", "ArangoDB");
		report.put("databaseVersion", serverVersion);
		report.put("driverName", DRIVER_NAME);
		report.put("driverVersion", DRIVER_VERSION);
		report.put("catalog", databaseName(connection.getUrl()));
		report.put("schema", "");
		report.put("tables", tables);
		report.put("elapsedMs", (System.nanoTime() - startNanos) / 1_000_000);
		return report;
	}

	private JSONObject httpGet(HttpClient client, String baseUrl, String path) throws Exception {
		HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(baseUrl + path))
				.timeout(Duration.ofSeconds(15)).GET();
		String user = connection.getUser();
		String password = connection.getPassword() == null ? "" : connection.getPassword();
		if (user != null) {
			String token = Base64.getEncoder().encodeToString((user + ":" + password).getBytes(StandardCharsets.UTF_8));
			builder.header("Authorization", "Basic " + token);
		}
		HttpResponse<String> response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
		if (response.statusCode() != 200) {
			throw new IllegalStateException("ArangoDB " + path + " returned HTTP " + response.statusCode()
					+ ": " + response.body());
		}
		return JSON.parseObject(response.body());
	}

	/** The HTTP(S) base URL of a connection; {@code tcp}/{@code ssl} schemes map to HTTP. */
	static String httpBaseUrl(String url) {
		String value = url == null ? "" : url.trim();
		String scheme = "http://";
		if (value.startsWith("https://") || value.startsWith("ssl://")) {
			scheme = "https://";
			value = value.substring(value.indexOf("://") + 3);
		} else if (value.contains("://")) {
			value = value.substring(value.indexOf("://") + 3);
		}
		int slash = value.indexOf('/');
		String authority = slash < 0 ? value : value.substring(0, slash);
		return scheme + authority;
	}

	/** The database named by {@code /_db/<name>} in the URL, or {@code _system}. */
	static String databaseName(String url) {
		String value = url == null ? "" : url.trim();
		int db = value.indexOf("/_db/");
		if (db < 0) {
			return "_system";
		}
		String name = value.substring(db + "/_db/".length());
		int slash = name.indexOf('/');
		return slash < 0 ? name : name.substring(0, slash);
	}

	private ArangoDB buildClient() {
		String url = connection.getUrl() == null ? "" : connection.getUrl().trim();
		boolean ssl = url.startsWith("https://") || url.startsWith("ssl://");
		String httpBase = httpBaseUrl(url);
		String authority = httpBase.substring(httpBase.indexOf("://") + 3);
		int colon = authority.lastIndexOf(':');
		String host = colon < 0 ? authority : authority.substring(0, colon);
		int port = colon < 0 ? 8529 : Integer.parseInt(authority.substring(colon + 1));
		ArangoDB.Builder builder = new ArangoDB.Builder()
				.host(host, port)
				.user(connection.getUser())
				.password(connection.getPassword() == null ? "" : connection.getPassword());
		if (ssl) {
			builder.useSsl(true);
		}
		return builder.build();
	}

	@FunctionalInterface
	private interface DbFn<T> {
		T apply(ArangoDatabase db) throws Exception;
	}

	/** Every operation builds and closes its own client, so no connection pool outlives the adapter. */
	private <T> T withDb(DbFn<T> fn) throws Exception {
		ArangoDB client = buildClient();
		try {
			return fn.apply(client.db(databaseName(connection.getUrl())));
		} finally {
			client.shutdown();
		}
	}

	// ----------------------------------------------------------------------------------
	// DSL execution
	// ----------------------------------------------------------------------------------

	@Override
	public String executeDsl(String queryJson, String sessionId, DslExecutionMode mode, List<String> generatedMqls) throws Exception {
		log.debug("[{}] ArangoDB DSL to query: {}", sessionId, queryJson);
		JSONArray dsls = JSONArray.parseArray(queryJson);
		DslRowLimit.Tracker rowLimit = new DslRowLimit.Tracker();
		AqlQuery aql = toAql(dsls.getJSONObject(0), jsonRule, rowLimit);
		generatedMqls.add(aql.text);
		log.debug("[{}] Converted ArangoDB AQL: {}", sessionId, aql.text);
		log.debug("[{}] AQL bind variables: {}", sessionId, aql.params);
		JSONArray data = runQuery(aql);
		coerceTypes(data, aql);
		boolean truncated = rowLimit.defaulted() && data.size() > rowLimit.effectiveLimit();
		if (truncated) {
			data.remove(rowLimit.effectiveLimit()); // drop the truncation probe row
			rowLimit.markTruncated();
		}
		JSONArray answers = new JSONArray();
		JSONObject answer = new JSONObject();
		answer.put("answer", data);
		answer.put("mqls", generatedMqls);
		if (truncated) {
			answer.put(DslRowLimit.TRUNCATED, true);
			answer.put(DslRowLimit.ROW_LIMIT, rowLimit.truncatedLimit());
			answer.put(DslRowLimit.TRUNCATION_HINT, rowLimit.hint());
			log.warn("[" + sessionId + "] DSL result truncated at the default row limit of "
					+ rowLimit.effectiveLimit());
		}
		answers.add(answer);
		return JSON.toJSONString(answers, Feature.WriteMapNullValue);
	}

	/** An AQL statement and its bind parameters; names are p0, p1, ... in generation order. */
	private static final class AqlQuery {
		String text;
		final Map<String, Object> params = new HashMap<>();
		/** Output alias -> declared DSL type, used to restore a double's JSON form. */
		final Map<String, String> aliasTypes = new LinkedHashMap<>();
		/** Graph variable -> physical class name, used to resolve an output field's type. */
		final Map<String, String> variableClasses = new HashMap<>();
		int counter;

		String next() {
			return "p" + counter++;
		}

		String bind(Object value) {
			String name = next();
			params.put(name, value);
			return "@" + name;
		}
	}

	/** The class/relationship metadata the translator needs, derived once per DSL. */
	private static final class DslContext {
		final Map<String, Map<String, String>> attrTypes = new HashMap<>();
		final Map<String, Set<String>> enabledAttrs = new HashMap<>();
		final Map<String, Map<String, Object>> relations = new LinkedHashMap<>();
	}

	@SuppressWarnings("unchecked")
	private DslContext contextOf(Map<String, Object> rule) {
		DslContext context = new DslContext();
		List<Map<String, Object>> classDefs = rule == null ? null : (List<Map<String, Object>>) rule.get("classDef");
		if (classDefs != null) {
			for (Map<String, Object> classDef : classDefs) {
				Map<String, String> types = new HashMap<>();
				Set<String> enabled = new HashSet<>();
				List<Map<String, Object>> attrs = (List<Map<String, Object>>) classDef.get("attrs");
				if (attrs != null) {
					for (Map<String, Object> attr : attrs) {
						String name = (String) attr.get("name");
						types.put(name, (String) attr.get("type"));
						if (attr.get("enable") == null || Boolean.TRUE.equals(attr.get("enable"))) {
							enabled.add(name);
						}
					}
				}
				context.attrTypes.put((String) classDef.get("className"), types);
				context.enabledAttrs.put((String) classDef.get("className"), enabled);
			}
		}
		Map<String, Object> relations = rule == null ? null : (Map<String, Object>) rule.get("relationship_rule");
		if (relations != null) {
			for (String name : relations.keySet()) {
				context.relations.put(name, (Map<String, Object>) relations.get(name));
			}
		}
		return context;
	}

	/** Translate one graph DSL to one AQL statement. Only the first pattern of a step is used. */
	private AqlQuery toAql(JSONObject dsl, Map<String, Object> rule, DslRowLimit.Tracker rowLimit) throws Exception {
		try {
			DslContext context = contextOf(rule);
			JSONArray steps = dsl.getJSONObject("answer").getJSONArray("steps");
			if (steps == null || steps.isEmpty()) {
				throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
						"answer.steps", "the DSL carries no step");
			}
			JSONObject first = steps.getJSONObject(0);
			AqlQuery query = new AqlQuery();
			if (steps.size() == 1) {
				List<String> lines = new ArrayList<>(graphLines(first, context, query));
				lines.addAll(projectionLines(first.getJSONObject("output"), context, query, null,
						rowLimit, true));
				query.text = String.join("\n", lines);
				return query;
			}
			// Two-step: the first step is an inner projection; the second aggregates over it.
			JSONObject second = steps.getJSONObject(1);
			JSONArray objects = second.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects");
			String tmpVariable = objects.getJSONObject(0).getString("variable");
			List<String> innerLines = new ArrayList<>(graphLines(first, context, query));
			innerLines.addAll(projectionLines(first.getJSONObject("output"), context, query, null,
					null, false));
			String inner = String.join("\n", innerLines);
			List<String> lines = new ArrayList<>();
			lines.add("FOR " + tmpVariable + " IN (\n" + inner + ")");
			lines.addAll(projectionLines(second.getJSONObject("output"), context, query, tmpVariable,
					rowLimit, true));
			query.text = String.join("\n", lines);
			return query;
		} catch (DslContractViolationException e) {
			log.warn(e.getMessage());
			throw e;
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			throw new Exception("Failed to convert DSL to AQL: " + e.getMessage(), e);
		}
	}

	/** The {@code FOR}/{@code FILTER} clauses of one step's graph pattern. */
	private List<String> graphLines(JSONObject step, DslContext context, AqlQuery query) {
		JSONObject pattern = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0);
		JSONArray objects = pattern.getJSONArray("objects");
		Map<Integer, JSONObject> byIdx = new LinkedHashMap<>();
		for (int i = 0; i < objects.size(); i++) {
			JSONObject object = objects.getJSONObject(i);
			byIdx.put(object.getInteger("idx"), object);
		}

		List<JSONObject> relationships = new ArrayList<>();
		JSONArray relationshipArray = pattern.getJSONArray("relationship");
		if (relationshipArray != null) {
			for (int i = 0; i < relationshipArray.size(); i++) {
				relationships.add(relationshipArray.getJSONObject(i));
			}
		}

		List<String> lines = new ArrayList<>();
		Set<String> bound = new LinkedHashSet<>();
		List<JSONObject> ordered = new ArrayList<>();

		if (!objects.isEmpty()) {
			JSONObject first = objects.getJSONObject(0);
			ordered.add(first);
			bound.add(first.getString("variable"));
		}
		// Breadth-first emission: a traversal is only emitted after the variable it starts from.
		boolean progressed = true;
		while (progressed && ordered.size() < objects.size()) {
			progressed = false;
			for (JSONObject relationship : relationships) {
				JSONObject from = byIdx.get(relationship.getInteger("from"));
				JSONObject to = byIdx.get(relationship.getInteger("to"));
				if (from == null || to == null) {
					continue;
				}
				boolean fromBound = bound.contains(from.getString("variable"));
				boolean toBound = bound.contains(to.getString("variable"));
				if (fromBound && !toBound) {
					ordered.add(to);
					bound.add(to.getString("variable"));
					progressed = true;
				} else if (toBound && !fromBound) {
					ordered.add(from);
					bound.add(from.getString("variable"));
					progressed = true;
				}
			}
		}
		for (int i = 0; i < objects.size(); i++) {
			JSONObject object = objects.getJSONObject(i);
			if (!bound.contains(object.getString("variable"))) {
				ordered.add(object);
				bound.add(object.getString("variable"));
			}
		}

		Set<String> emitted = new LinkedHashSet<>();
		Set<String> traversed = new HashSet<>();
		for (JSONObject object : ordered) {
			String variable = object.getString("variable");
			String className = object.getString("class");
			boolean viaTraversal = false;
			for (JSONObject relationship : relationships) {
				if (traversed.contains(relationshipKey(relationship))) {
					continue;
				}
				JSONObject from = byIdx.get(relationship.getInteger("from"));
				JSONObject to = byIdx.get(relationship.getInteger("to"));
				if (from == null || to == null) {
					continue;
				}
				boolean arrivingFromSource = variable.equals(to.getString("variable"))
						&& emitted.contains(from.getString("variable"));
				boolean arrivingFromTarget = variable.equals(from.getString("variable"))
						&& emitted.contains(to.getString("variable"));
				if (!arrivingFromSource && !arrivingFromTarget) {
					continue;
				}
				String startVariable = arrivingFromSource ? from.getString("variable") : to.getString("variable");
				String direction = arrivingFromSource ? "OUTBOUND" : "INBOUND";
				String sourcePhysical = from.getString("class");
				lines.add("FOR " + variable + " IN " + hopRange(relationship) + " " + direction + " "
						+ startVariable + " " + edgeCollections(context, relationship, sourcePhysical));
				traversed.add(relationshipKey(relationship));
				viaTraversal = true;
				break;
			}
			if (!viaTraversal) {
				lines.add("FOR " + variable + " IN " + quote(className));
			}
			emitted.add(variable);
			query.variableClasses.put(variable, className);
			Map<String, String> types = context.attrTypes.getOrDefault(className, Map.of());
			String filter = conditions(object.getJSONObject("conditions"), variable, types,
					"steps[0].graph.patterns[0].objects." + object.getString("variable") + ".conditions", query, true);
			if (!filter.isEmpty()) {
				lines.add("FILTER " + filter);
			}
		}
		return lines;
	}

	private String relationshipKey(JSONObject relationship) {
		return relationship.getInteger("from") + "->" + relationship.getInteger("to") + ":"
				+ relationship.getJSONArray("type");
	}

	private String hopRange(JSONObject relationship) {
		Integer min = relationship.getInteger("min_hops");
		Integer max = relationship.getInteger("max_hops");
		int low = min == null || min < 1 ? 1 : min;
		int high = max == null || max < 0 ? (max != null && max < 0 ? MAX_HOPS : low) : max;
		if (high < low) {
			high = low;
		}
		return low + ".." + high;
	}

	/**
	 * The edge collection(s) of a relationship. An edge collection is namespace-prefixed like a
	 * document collection, so the prefix is the physical source class with the relation rule's plain
	 * source class removed. {@code type:["*"]} means every declared relation from that source class.
	 */
	private String edgeCollections(DslContext context, JSONObject relationship, String sourcePhysical) {
		JSONArray types = relationship.getJSONArray("type");
		Set<String> names = new LinkedHashSet<>();
		boolean any = types == null || types.isEmpty();
		if (types != null) {
			for (int i = 0; i < types.size(); i++) {
				String type = types.getString(i);
				if (type == null || type.isBlank() || "*".equals(type.trim())) {
					any = true;
				} else {
					names.add(type.trim());
				}
			}
		}
		if (any) {
			for (Map.Entry<String, Map<String, Object>> entry : context.relations.entrySet()) {
				Object fromClass = entry.getValue().get("fromclass");
				if (fromClass != null && sourcePhysical.endsWith(String.valueOf(fromClass))) {
					names.add(entry.getKey());
				}
			}
		}
		if (names.isEmpty()) {
			throw new DslContractViolationException(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
					"steps[0].graph.patterns[0].relationship",
					"the relationship type names no declared relation of class '" + sourcePhysical + "'");
		}
		List<String> collections = new ArrayList<>();
		for (String name : names) {
			collections.add(quote(edgeCollection(context, name, sourcePhysical)));
		}
		return String.join(", ", collections);
	}

	private String edgeCollection(DslContext context, String relationName, String sourcePhysical) {
		Map<String, Object> rule = context.relations.get(relationName);
		if (rule != null) {
			Object fromClass = rule.get("fromclass");
			if (fromClass != null) {
				String plain = String.valueOf(fromClass);
				if (sourcePhysical.endsWith(plain)) {
					return sourcePhysical.substring(0, sourcePhysical.length() - plain.length()) + relationName;
				}
			}
		}
		return relationName;
	}

	/** Quote an AQL collection name. */
	private static String quote(String name) {
		return "`" + name.replace("`", "``") + "`";
	}

	/** Quote an AQL attribute/variable name only when it is not a plain identifier. */
	private static String prop(String name) {
		return AQL_IDENTIFIER.matcher(name).matches() ? name : quote(name);
	}

	// ----------------------------------------------------------------------------------
	// Conditions
	// ----------------------------------------------------------------------------------

	/** Translate one object's conditions block to an AQL predicate, or "" when absent. */
	private String conditions(JSONObject conditions, String alias, Map<String, String> attrTypes, String path,
			AqlQuery query, boolean likeWrap) {
		if (conditions == null) {
			return "";
		}
		if (conditions.getJSONObject("timeseries") != null) {
			throw new DslContractViolationException(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
					path + ".timeseries", "the timeseries condition is not implemented by " + getClass().getSimpleName());
		}
		List<String> parts = new ArrayList<>();
		JSONObject properties = conditions.getJSONObject("properties");
		if (properties != null) {
			String predicate = conditionTree(properties, alias, attrTypes, path + ".properties", query, likeWrap);
			if (!predicate.isEmpty()) {
				parts.add(predicate);
			}
		}
		JSONObject text = conditions.getJSONObject("text");
		if (text != null) {
			String raw = text.getString("query");
			if (raw != null && !raw.trim().isEmpty()) {
				String param = query.bind(raw.trim());
				List<String> contains = new ArrayList<>();
				for (Map.Entry<String, String> attr : attrTypes.entrySet()) {
					String type = attr.getValue();
					if ("varchar".equals(type) || "text".equals(type)) {
						contains.add("CONTAINS(LOWER(" + alias + "." + prop(attr.getKey()) + "), LOWER(" + param + "))");
					}
				}
				if (!contains.isEmpty()) {
					parts.add("(" + String.join(" OR ", contains) + ")");
				}
			}
		}
		return String.join(" AND ", parts);
	}

	/** Recursively build an AQL predicate for an and/or/not nested condition tree. */
	private String conditionTree(JSONObject condition, String alias, Map<String, String> attrTypes, String path,
			AqlQuery query, boolean likeWrap) {
		JSONArray ands = condition.getJSONArray("and");
		if (ands != null && !ands.isEmpty()) {
			List<String> parts = new ArrayList<>();
			for (int i = 0; i < ands.size(); i++) {
				parts.add(conditionTree(ands.getJSONObject(i), alias, attrTypes, path, query, likeWrap));
			}
			return "(" + String.join(" AND ", parts) + ")";
		}
		JSONArray ors = condition.getJSONArray("or");
		if (ors != null && !ors.isEmpty()) {
			List<String> parts = new ArrayList<>();
			for (int i = 0; i < ors.size(); i++) {
				parts.add(conditionTree(ors.getJSONObject(i), alias, attrTypes, path, query, likeWrap));
			}
			return "(" + String.join(" OR ", parts) + ")";
		}
		JSONArray nots = condition.getJSONArray("not");
		if (nots != null && !nots.isEmpty()) {
			// The inner predicate is parenthesized so NOT applies to the whole comparison, not to its left side.
			return "(NOT (" + conditionTree(DslGrammarValidator.negated(condition), alias, attrTypes, path, query, likeWrap) + "))";
		}
		String field = condition.getString("field");
		String operator = condition.getString("operator");
		if (field == null || operator == null) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR, path,
					"a condition leaf needs a field and an operator");
		}
		return leaf(condition, field, operator, alias, attrTypes, path, query, likeWrap);
	}

	private String leaf(JSONObject condition, String field, String operator, String alias,
			Map<String, String> attrTypes, String path, AqlQuery query, boolean likeWrap) {
		String type = attrTypes.get(field);
		String column = alias + "." + prop(field);
		switch (operator) {
			case "is":
				return column + " == null";
			case "is not":
				return column + " != null";
			case "between": {
				JSONArray value = condition.getJSONArray("value");
				if (value == null || value.size() != 2) {
					throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR, path,
							"between on field '" + field + "' needs a two-element value array");
				}
				return "(" + column + " >= " + query.bind(value.get(0)) + " AND " + column + " <= "
						+ query.bind(value.get(1)) + ")";
			}
			case "in": {
				Object value = condition.get("value");
				if (!(value instanceof JSONArray values)) {
					throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR, path,
							"in on field '" + field + "' needs a value array");
				}
				return column + " IN " + query.bind(new ArrayList<>(values));
			}
			case "like":
			case "not like": {
				if (type != null && !"varchar".equals(type) && !"text".equals(type)) {
					throw new DslContractViolationException(
							DslContractViolationException.Code.UNSUPPORTED_OPERATOR_FOR_TYPE, path,
							"operator '" + operator + "' on field '" + field + "' of type '" + type
									+ "' is not supported by " + getClass().getSimpleName());
				}
				String regex = likeRegex(condition, likeWrap);
				String predicate = "REGEX_TEST(" + column + ", " + query.bind(regex) + ")";
				return "not like".equals(operator) ? "(NOT " + predicate + ")" : predicate;
			}
			case "=":
			case "!=":
			case ">":
			case ">=":
			case "<":
			case "<=": {
				String aqlOperator = "=".equals(operator) ? "==" : operator;
				return column + " " + aqlOperator + " " + query.bind(condition.get("value"));
			}
			default:
				throw new DslContractViolationException(
						DslContractViolationException.Code.UNSUPPORTED_OPERATOR_FOR_TYPE, path,
						"operator '" + operator + "' on field '" + field + "' is not supported by "
								+ getClass().getSimpleName());
		}
	}

	/**
	 * An AQL {@code REGEX_TEST} pattern with SQL {@code LIKE} semantics: {@code %} is any run,
	 * {@code _} is one character, everything else is literal. An escaped like condition renders
	 * through {@link LikePattern}, so a value bound as data never becomes a wildcard.
	 */
	private String likeRegex(JSONObject condition, boolean wrap) {
		Object raw = condition.get("value");
		if (!(raw instanceof String value)) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"conditions.properties", "the like condition on '" + condition.getString("field")
							+ "' needs a text value");
		}
		if (LikePattern.escaped(condition)) {
			return "^" + LikePattern.of(condition, wrap)
					.render(".*", ".", c -> Pattern.quote(String.valueOf(c))) + "$";
		}
		if (wrap && !value.startsWith("%") && !value.endsWith("%")) {
			value = "%" + value + "%";
		}
		StringBuilder regex = new StringBuilder("^");
		for (int i = 0; i < value.length(); i++) {
			char c = value.charAt(i);
			if (c == '%') {
				regex.append(".*");
			} else if (c == '_') {
				regex.append('.');
			} else {
				regex.append(Pattern.quote(String.valueOf(c)));
			}
		}
		return regex.append('$').toString();
	}

	/** The write path's condition builder (no bare-value wrapping, matching the other adapters). */
	private String where(JSONObject condition, String alias, Map<String, String> attrTypes, AqlQuery query) {
		if (condition == null) {
			return "";
		}
		return conditionTree(condition, alias, attrTypes, "where", query, false);
	}

	// ----------------------------------------------------------------------------------
	// Output
	// ----------------------------------------------------------------------------------

	/**
	 * The projection of one step: COLLECT when grouping/aggregating, then SORT, LIMIT and RETURN.
	 *
	 * @param sourceVar the second step's subquery variable, or null for a graph step
	 */
	private List<String> projectionLines(JSONObject output, DslContext context, AqlQuery query, String sourceVar,
			DslRowLimit.Tracker rowLimit, boolean terminal) {
		List<String> lines = new ArrayList<>();
		JSONArray fields = output == null ? null : output.getJSONArray("fields");
		if (fields == null || fields.isEmpty()) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"steps.output.fields", "the output names no field");
		}
		JSONObject groupBy = output.getJSONObject("group_by");
		JSONArray groupFields = groupBy == null ? null : groupBy.getJSONArray("fields");
		JSONArray having = groupBy == null ? null : groupBy.getJSONArray("having");
		boolean hasGroups = groupFields != null && !groupFields.isEmpty();
		boolean hasAggregates = false;
		for (int i = 0; i < fields.size(); i++) {
			if (fields.getJSONObject(i).getString("function") != null) {
				hasAggregates = true;
				break;
			}
		}

		Map<String, String> groupVars = new HashMap<>(); // variable\0field -> COLLECT variable
		Map<String, String> aggVars = new HashMap<>(); // function\0field -> COLLECT variable
		Map<String, String> aliasExpr = new LinkedHashMap<>(); // output alias -> sortable expression
		boolean distinct = false;

		if (hasGroups || hasAggregates) {
			StringBuilder collect = new StringBuilder("COLLECT ");
			List<String> keys = new ArrayList<>();
			List<String> aggregates = new ArrayList<>();
			if (groupFields != null) {
				for (int i = 0; i < groupFields.size(); i++) {
					JSONObject group = groupFields.getJSONObject(i);
					String variable = group.getString("variable");
					String field = group.getString("field");
					String collectVar = "g" + i;
					keys.add(collectVar + " = " + expression(variable, field, sourceVar));
					groupVars.put(variable + "\u0000" + field, collectVar);
				}
			}
			for (int i = 0; i < fields.size(); i++) {
				JSONObject field = fields.getJSONObject(i);
				String function = field.getString("function");
				if (function == null) {
					continue;
				}
				String name = field.getString("field");
				String variable = field.getString("variable");
				String arg = expression(variable, name, sourceVar);
				String collectVar = "a" + aggregates.size();
				boolean fieldDistinct = Boolean.TRUE.equals(field.getBoolean("distinct"));
				aggregates.add(collectVar + " = " + aggregate(function, arg, fieldDistinct, name));
				aggVars.put(function + "\u0000" + name, collectVar);
			}
			if (!keys.isEmpty()) {
				collect.append(String.join(", ", keys));
				if (!aggregates.isEmpty()) {
					collect.append(" AGGREGATE ").append(String.join(", ", aggregates));
				}
			} else {
				collect.append("AGGREGATE ").append(String.join(", ", aggregates));
			}
			lines.add(collect.toString());

			if (having != null && !having.isEmpty()) {
				List<String> predicates = new ArrayList<>();
				for (int i = 0; i < having.size(); i++) {
					JSONObject condition = having.getJSONObject(i);
					String variable = condition.getString("variable");
					String field = condition.getString("field");
					String function = condition.getString("function");
					String operator = condition.getString("operator");
					String target = function == null
							? groupVars.get(variable + "\u0000" + field)
							: aggVars.get(function + "\u0000" + field);
					if (target == null) {
						throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
								"steps.output.group_by.having",
								"having names '" + field + "' which is neither grouped nor aggregated");
					}
					predicates.add(target + " " + comparisonOperator(operator, field) + " "
							+ query.bind(condition.get("value")));
				}
				lines.add("FILTER " + String.join(" AND ", predicates));
			}
		}

		for (int i = 0; i < fields.size(); i++) {
			JSONObject field = fields.getJSONObject(i);
			String function = field.getString("function");
			String alias = field.getString("as") == null || field.getString("as").isBlank()
					? "f" + i : field.getString("as");
			String expression;
			if (function != null) {
				expression = aggVars.get(function + "\u0000" + field.getString("field"));
				if (expression == null) {
					throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
							"steps.output.fields", "aggregate field '" + field.getString("field") + "' has no COLLECT");
				}
			} else {
				String variable = field.getString("variable");
				String fieldName = field.getString("field");
				String groupVar = groupVars.get(variable + "\u0000" + fieldName);
				expression = groupVar != null ? groupVar
						: expression(variable, fieldName, sourceVar);
				if (hasGroups && groupVar == null) {
					throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
							"steps.output.fields", "field '" + fieldName
									+ "' is neither grouped nor aggregated");
				}
				if (i == 0 && Boolean.TRUE.equals(field.getBoolean("distinct"))) {
					distinct = true;
				}
				String type = sourceVar == null
						? context.attrTypes.getOrDefault(query.variableClasses.getOrDefault(variable, ""), Map.of())
								.get(fieldName)
						: query.aliasTypes.get(fieldName);
				if (type != null) {
					query.aliasTypes.put(alias, type);
				}
			}
			aliasExpr.put(alias, expression);
		}

		JSONObject sort = output.getJSONObject("sort");
		JSONArray sortFields = sort == null ? null : sort.getJSONArray("fields");
		if (sortFields != null && !sortFields.isEmpty()) {
			List<String> parts = new ArrayList<>();
			for (int i = 0; i < sortFields.size(); i++) {
				JSONObject sortField = sortFields.getJSONObject(i);
				String name = sortField.getString("field");
				String expression = aliasExpr.get(name);
				if (expression == null) {
					expression = prop(name);
					if (sourceVar != null) {
						expression = sourceVar + "." + expression;
					} else {
						expression = firstVariable(output, fields) + "." + expression;
					}
				}
				parts.add(expression + ("desc".equals(sortField.getString("order")) ? " DESC" : ""));
			}
			lines.add("SORT " + String.join(", ", parts));
		}

		JSONObject limit = output.getJSONObject("limit");
		if (limit != null && limit.getInteger("count") != null) {
			int offset = limit.getInteger("offset") == null ? 0 : limit.getInteger("offset");
			if (terminal && rowLimit != null) {
				rowLimit.terminalLimit(limit.getInteger("count"), false);
			}
			lines.add("LIMIT " + offset + ", " + limit.getInteger("count"));
		} else if (terminal) {
			int cap = DslRowLimit.defaultRowLimit();
			if (rowLimit != null) {
				rowLimit.terminalLimit(cap, true);
			}
			lines.add("LIMIT " + (cap + 1));
		}

		List<String> projections = new ArrayList<>();
		for (int i = 0; i < fields.size(); i++) {
			JSONObject field = fields.getJSONObject(i);
			String alias = field.getString("as") == null || field.getString("as").isBlank()
					? "f" + i : field.getString("as");
			projections.add(quote(alias) + ": " + aliasExpr.get(alias));
		}
		lines.add("RETURN " + (distinct ? "DISTINCT " : "") + "{" + String.join(", ", projections) + "}");
		return lines;
	}

	/** A field reference in a graph step or the second step's subquery. */
	private String expression(String variable, String field, String sourceVar) {
		if (sourceVar != null) {
			return sourceVar + "." + prop(field);
		}
		return variable + "." + prop(field);
	}

	private String firstVariable(JSONObject output, JSONArray fields) {
		for (int i = 0; i < fields.size(); i++) {
			String variable = fields.getJSONObject(i).getString("variable");
			if (variable != null && !variable.isBlank()) {
				return variable;
			}
		}
		return "v";
	}

	private String comparisonOperator(String operator, String field) {
		if (operator == null) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"steps.output.group_by.having", "having on '" + field + "' needs an operator");
		}
		switch (operator) {
			case "=":
			case "!=":
			case ">":
			case ">=":
			case "<":
			case "<=":
				return "=".equals(operator) ? "==" : operator;
			default:
				throw new DslContractViolationException(
						DslContractViolationException.Code.UNSUPPORTED_OPERATOR_FOR_TYPE,
						"steps.output.group_by.having",
						"operator '" + operator + "' on field '" + field + "' is not supported by "
								+ getClass().getSimpleName());
		}
	}

	/** Map a DSL aggregate function to its AQL form. */
	private String aggregate(String function, String argument, boolean distinct, String field) {
		String name = function == null ? "" : function.trim().toLowerCase();
		String inner = (distinct ? "DISTINCT " : "") + argument;
		switch (name) {
			case "count":
				return "COUNT(" + inner + ")";
			case "countdistinct":
			case "count_distinct":
				return "COUNT_DISTINCT(" + argument + ")";
			case "sum":
				return "SUM(" + inner + ")";
			case "avg":
			case "average":
				return "AVERAGE(" + inner + ")";
			case "min":
				return "MIN(" + inner + ")";
			case "max":
				return "MAX(" + inner + ")";
			default:
				throw new DslContractViolationException(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
						"steps.output.fields", "aggregate function '" + function + "' on field '" + field
								+ "' is not supported by " + getClass().getSimpleName());
		}
	}

	// ----------------------------------------------------------------------------------
	// Execution
	// ----------------------------------------------------------------------------------

	@SuppressWarnings("rawtypes")
	private JSONArray runQuery(AqlQuery query) throws Exception {
		return withDb(db -> {
			ArangoCursor<Map> cursor = db.query(query.text, Map.class, query.params);
			JSONArray rows = new JSONArray();
			while (cursor.hasNext()) {
				Map row = cursor.next();
				rows.add(toJson(row));
			}
			return rows;
		});
	}

	private void executeWrite(AqlQuery query) throws Exception {
		runQuery(query);
	}

	/**
	 * Restore the declared scalar form of a returned value. ArangoDB stores numbers without an
	 * int/double distinction, so a declared {@code double} holding 2.0 comes back as 2; the ontology's
	 * type is the only place that distinction exists, so the adapter re-applies it.
	 */
	private void coerceTypes(JSONArray rows, AqlQuery query) {
		if (query.aliasTypes.isEmpty()) {
			return;
		}
		for (int i = 0; i < rows.size(); i++) {
			JSONObject row = rows.getJSONObject(i);
			for (Map.Entry<String, String> alias : query.aliasTypes.entrySet()) {
				Object value = row.get(alias.getKey());
				if ("double".equals(alias.getValue()) && value instanceof Number number) {
					row.put(alias.getKey(), number.doubleValue());
				}
			}
		}
	}

	/** Convert a driver row map to a JSON object, preserving nulls and nested collections. */
	@SuppressWarnings("unchecked")
	private JSONObject toJson(Map<?, ?> row) {
		JSONObject json = new JSONObject();
		for (Map.Entry<?, ?> entry : row.entrySet()) {
			json.put(String.valueOf(entry.getKey()), toJsonValue(entry.getValue()));
		}
		return json;
	}

	private Object toJsonValue(Object value) {
		if (value instanceof Map<?, ?> map) {
			return toJson(map);
		}
		if (value instanceof Collection<?> collection) {
			JSONArray array = new JSONArray();
			for (Object item : collection) {
				array.add(toJsonValue(item));
			}
			return array;
		}
		return value;
	}

	// ----------------------------------------------------------------------------------
	// Sample data
	// ----------------------------------------------------------------------------------

	@Override
	public String getSampleDataFileName(String sampleDataDirName, String className) {
		return "conf/" + sampleDataDirName + "/" + className + ".json";
	}

	@Override
	public String querySampleDataByClassName(String className, List<String> attrs) {
		try {
			AqlQuery query = new AqlQuery();
			List<String> projections = new ArrayList<>();
			for (String attr : attrs) {
				projections.add(quote(attr) + ": doc." + prop(attr));
			}
			query.text = "FOR doc IN " + quote(className) + "\nLIMIT 1\nRETURN {" + String.join(", ", projections) + "}";
			JSONArray data = runQuery(query);
			if (!data.isEmpty()) {
				JSONObject datum = data.getJSONObject(0);
				for (String key : datum.keySet()) {
					if (datum.get(key) instanceof String str && str.length() > 100) {
						datum.put(key, str.substring(0, 100) + "...");
					}
				}
				return datum.toString();
			}
			return className + " class has no data";
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return "Failed to get sample data for class [" + className + "]";
		}
	}

	// ----------------------------------------------------------------------------------
	// Validation and naming
	// ----------------------------------------------------------------------------------

	@Override
	public void validateClassNameFormat(String className) throws Exception {
	}

	@Override
	public void validatePrimaryKeyName(String attrName) throws Exception {
	}

	@Override
	public String sandboxClassName(String sandboxId, String className) {
		return sandboxId + className;
	}

	@Override
	public String sandboxObjectId(String sandboxId, String objectId) {
		return objectId;
	}

	private boolean inSandbox(String namespace) {
		return namespace != null && !namespace.trim().isEmpty();
	}

	private String physicalName(String namespace, String className) {
		return (inSandbox(namespace) ? namespace : "") + className;
	}

	/** The collection name a class lives in, without touching the server. */
	private String physicalClassName(String namespace, Map<String, Object> classDef) {
		return physicalName(namespace, (String) classDef.get("className"));
	}

	// ----------------------------------------------------------------------------------
	// Namespace lifecycle — the namespace is a collection-name prefix
	// ----------------------------------------------------------------------------------

	@Override
	public void createNamespace(String namespace) {
		// A namespace is a collection-name prefix, not a schema; nothing to create.
	}

	@Override
	public void truncateNamespace(String namespace) {
		try {
			withDb(db -> {
				for (String name : collectionsWithPrefix(db, namespace)) {
					db.collection(name).truncate();
				}
				return null;
			});
		} catch (Exception e) {
			log.error("Failed to truncate ArangoDB collections with prefix [" + namespace + "]: " + e.getMessage(), e);
		}
	}

	@Override
	public void dropNamespace(String namespace) {
		try {
			withDb(db -> {
				for (String name : collectionsWithPrefix(db, namespace)) {
					db.collection(name).drop();
				}
				return null;
			});
		} catch (Exception e) {
			log.error("Failed to drop ArangoDB collections with prefix [" + namespace + "]: " + e.getMessage(), e);
		}
	}

	private List<String> collectionsWithPrefix(ArangoDatabase db, String namespace) {
		String prefix = inSandbox(namespace) ? namespace : "";
		List<String> names = new ArrayList<>();
		Collection<CollectionEntity> collections = db.getCollections();
		if (collections == null) {
			return names;
		}
		for (CollectionEntity collection : collections) {
			String name = collection.getName();
			if (name == null || Boolean.TRUE.equals(collection.getIsSystem())) {
				continue;
			}
			if (name.startsWith(prefix)) {
				names.add(name);
			}
		}
		return names;
	}

	// ----------------------------------------------------------------------------------
	// Schema
	// ----------------------------------------------------------------------------------

	@Override
	public void createClass(String namespace, Map<String, Object> classDef) {
		String collection = physicalClassName(namespace, classDef);
		String primaryKey = DslUtil.getPrimaryKey(classDef);
		try {
			withDb(db -> {
				ensureCollection(db, collection, false);
				if (primaryKey != null && !primaryKey.isBlank()) {
					db.collection(collection).ensurePersistentIndex(List.of(primaryKey), new PersistentIndexOptions());
				}
				return null;
			});
		} catch (Exception e) {
			throw new IllegalStateException("Failed to create ArangoDB collection [" + collection + "]: " + e.getMessage(), e);
		}
	}

	@Override
	public void createEdgeType(String namespace, String edgeName) {
		String collection = physicalName(namespace, edgeName);
		try {
			withDb(db -> {
				ensureCollection(db, collection, true);
				return null;
			});
		} catch (Exception e) {
			throw new IllegalStateException("Failed to create ArangoDB edge collection [" + collection + "]: " + e.getMessage(), e);
		}
	}

	private void ensureCollection(ArangoDatabase db, String name, boolean edge) throws Exception {
		if (db.collection(name).exists()) {
			return;
		}
		try {
			db.createCollection(name, new CollectionCreateOptions()
					.type(edge ? CollectionType.EDGES : CollectionType.DOCUMENT));
		} catch (Exception e) {
			// A concurrent create is a success for this caller; any other failure is real.
			if (!db.collection(name).exists()) {
				throw e;
			}
		}
	}

	// ----------------------------------------------------------------------------------
	// Objects
	// ----------------------------------------------------------------------------------

	private boolean isSupportedType(String type) {
		return "varchar".equals(type) || "text".equals(type) || "int".equals(type) || "long".equals(type)
				|| "double".equals(type) || "date".equals(type) || "timestamp".equals(type)
				|| "vector".equals(type);
	}

	/** The declared, enabled attributes that the store keeps, in declaration order. */
	private Map<String, String> storableAttrs(Map<String, Object> classDef) {
		Map<String, String> attrs = new LinkedHashMap<>();
		Object defs = classDef.get("attrs");
		if (defs instanceof List<?> list) {
			for (Object item : list) {
				if (!(item instanceof Map<?, ?> attr)) {
					continue;
				}
				Object enable = attr.get("enable");
				String type = (String) attr.get("type");
				if ((enable == null || Boolean.TRUE.equals(enable)) && isSupportedType(type)) {
					attrs.put((String) attr.get("name"), type);
				}
			}
		}
		return attrs;
	}

	/** A vector attribute is stored as the JSON-array text; anything else passes through. */
	private Object storeValue(String type, Object value) {
		if ("vector".equals(type) && value != null && !(value instanceof String)) {
			return JSON.toJSONString(value);
		}
		return value;
	}

	/**
	 * The document key for a primary-key value: the value itself when ArangoDB accepts it, otherwise a
	 * stable hash. The declared primary-key field always keeps the original value, so projections and
	 * conditions by that field never depend on the key encoding.
	 */
	static String documentKey(String value) {
		if (value != null && SAFE_DOCUMENT_KEY.matcher(value).matches()) {
			return value;
		}
		return "h" + md5(value == null ? "" : value);
	}

	private static String md5(String value) {
		try {
			MessageDigest digest = MessageDigest.getInstance("MD5");
			byte[] hash = digest.digest(value.getBytes(StandardCharsets.UTF_8));
			StringBuilder hex = new StringBuilder();
			for (byte b : hash) {
				hex.append(String.format("%02x", b));
			}
			return hex.toString();
		} catch (Exception e) {
			throw new IllegalStateException("MD5 is unavailable", e);
		}
	}

	@Override
	public void insertObjects(String namespace, Map<String, Object> classDef, JSONArray objs) throws Exception {
		String collection = physicalClassName(namespace, classDef);
		Map<String, String> attrs = storableAttrs(classDef);
		String pk = DslUtil.getPrimaryKey(classDef);
		withDb(db -> {
			ensureCollection(db, collection, false);
			for (int i = 0; i < objs.size(); i++) {
				JSONObject obj = objs.getJSONObject(i);
				if (obj.get(pk) == null || "".equals(obj.getString(pk).trim())) {
					throw new Exception("The insert statement must contain the primary key [" + pk + "] field");
				}
				Map<String, Object> document = new HashMap<>();
				document.put("_key", documentKey(obj.getString(pk)));
				for (Map.Entry<String, String> attr : attrs.entrySet()) {
					document.put(attr.getKey(), storeValue(attr.getValue(), obj.get(attr.getKey())));
				}
				db.collection(collection).insertDocument(document, new DocumentCreateOptions());
			}
			return null;
		});
	}

	@Override
	public void updateObjects(String namespace, Map<String, Object> classDef, JSONObject setValues, JSONObject where)
			throws Exception {
		String collection = physicalClassName(namespace, classDef);
		Map<String, String> attrs = storableAttrs(classDef);
		String pk = DslUtil.getPrimaryKey(classDef);

		Map<String, Object> values = new LinkedHashMap<>();
		for (String key : setValues.keySet()) {
			if (key.equals(pk)) {
				throw new Exception("Updating the primary key [" + pk + "] field is not allowed");
			}
			if (!attrs.containsKey(key)) {
				throw new Exception("Field [" + key + "] does not exist");
			}
			values.put(key, storeValue(attrs.get(key), setValues.get(key)));
		}

		AqlQuery query = new AqlQuery();
		StringBuilder aql = new StringBuilder("FOR doc IN ").append(quote(collection));
		String predicate = where(where, "doc", attrs, query);
		if (!predicate.isEmpty()) {
			aql.append("\nFILTER ").append(predicate);
		}
		aql.append("\nUPDATE doc WITH ").append(query.bind(values)).append(" IN ").append(quote(collection));
		query.text = aql.toString();
		executeWrite(query);
	}

	@Override
	public void deleteObjects(String namespace, Map<String, Object> classDef, JSONObject where) throws Exception {
		String collection = physicalClassName(namespace, classDef);
		Map<String, String> attrs = storableAttrs(classDef);
		AqlQuery query = new AqlQuery();
		StringBuilder aql = new StringBuilder("FOR doc IN ").append(quote(collection));
		String predicate = where(where, "doc", attrs, query);
		if (!predicate.isEmpty()) {
			aql.append("\nFILTER ").append(predicate);
		}
		aql.append("\nREMOVE doc IN ").append(quote(collection));
		query.text = aql.toString();
		executeWrite(query);
	}

	// ----------------------------------------------------------------------------------
	// Edges — a real edge document in the relation's edge collection
	// ----------------------------------------------------------------------------------

	/** One relationship definition; the edge is a real document in the relation's edge collection. */
	private record RelationshipDef(String type, String fromClass, String toClass) {
	}

	@SuppressWarnings("unchecked")
	private RelationshipDef relationshipDef(String relationName, String sourceClassName, String targetClassName) throws Exception {
		Map<String, Object> relationshipRule = jsonRule == null ? null : (Map<String, Object>) jsonRule.get("relationship_rule");
		Map<String, Object> def = relationshipRule == null ? null : (Map<String, Object>) relationshipRule.get(relationName);
		if (def == null || !sourceClassName.equals(def.get("fromclass")) || !targetClassName.equals(def.get("toclass"))) {
			throw new Exception("Object class [" + sourceClassName + "] and object class [" + targetClassName
					+ "] have no relationship definition [" + relationName + "]");
		}
		return new RelationshipDef(relationName, sourceClassName, targetClassName);
	}

	@Override
	public void createEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
			String targetClassName, String targetObjId) throws Exception {
		RelationshipDef relation = relationshipDef(relationName, sourceClassName, targetClassName);
		String prefix = inSandbox(namespace) ? namespace : "";
		String sourceCollection = prefix + sourceClassName;
		String targetCollection = prefix + targetClassName;
		String edgeCollection = prefix + relationName;
		String fromId = sourceCollection + "/" + documentKey(sourceObjId);
		String toId = targetCollection + "/" + documentKey(targetObjId);

		withDb(db -> {
			ensureCollection(db, edgeCollection, true);
			if (!Boolean.TRUE.equals(db.collection(sourceCollection).documentExists(documentKey(sourceObjId)))) {
				throw new Exception("The edge source object [" + sourceObjId + "] of class [" + sourceClassName
						+ "] does not exist");
			}
			if (!Boolean.TRUE.equals(db.collection(targetCollection).documentExists(documentKey(targetObjId)))) {
				throw new Exception("The edge target object [" + targetObjId + "] of class [" + targetClassName
						+ "] does not exist");
			}
			Map<String, Object> edge = new HashMap<>();
			edge.put("_key", "e" + md5(fromId + "|" + toId));
			edge.put("_from", fromId);
			edge.put("_to", toId);
			db.collection(edgeCollection).insertDocument(edge,
					new DocumentCreateOptions().overwriteMode(OverwriteMode.ignore));
			return null;
		});
	}

	@Override
	public void deleteEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
			String targetClassName, String targetObjId) throws Exception {
		relationshipDef(relationName, sourceClassName, targetClassName);
		String prefix = inSandbox(namespace) ? namespace : "";
		String edgeCollection = prefix + relationName;
		AqlQuery query = new AqlQuery();
		query.text = "FOR e IN " + quote(edgeCollection)
				+ "\nFILTER e._from == " + query.bind(prefix + sourceClassName + "/" + documentKey(sourceObjId))
				+ " AND e._to == " + query.bind(prefix + targetClassName + "/" + documentKey(targetObjId))
				+ "\nREMOVE e IN " + quote(edgeCollection);
		executeWrite(query);
	}

	// ----------------------------------------------------------------------------------
	// Vector attribute
	// ----------------------------------------------------------------------------------

	@Override
	public JSONArray queryVectorAttr(Map<String, Object> classDef, String attrName, String objectId) throws Exception {
		String collection = (String) classDef.get("className");
		String pk = DslUtil.getPrimaryKey(classDef);
		AqlQuery query = new AqlQuery();
		query.text = "FOR doc IN " + quote(collection)
				+ "\nFILTER doc." + prop(pk) + " == " + query.bind(objectId)
				+ "\nLIMIT 1\nRETURN {v: doc." + prop(attrName) + "}";
		JSONArray rows = runQuery(query);
		if (rows == null || rows.isEmpty()) {
			throw new IllegalArgumentException("Object " + objectId + " of class " + collection + " does not exist");
		}
		return DslUtil.parseVectorAttr(rows.getJSONObject(0).get("v"));
	}

	// ----------------------------------------------------------------------------------
	// Legacy object-graph query path
	// ----------------------------------------------------------------------------------

	@Override
	@SuppressWarnings("unchecked")
	public Map<String, Object> query(JSONObject dsl, String sandboxId, String domainId, VectorResourceDao vectorResourceDao,
			DataRagConfig dataRagConfig) throws Exception {
		boolean inSandbox = inSandbox(sandboxId);

		UserDataPermission userDataPermission = new UserDataPermission();
		JSONArray dsls = new JSONArray();
		dsls.add(dsl);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
		String dslStr = DslUtil.normalizeClassNames(JSONArray.toJSONString(dsls, Feature.WriteMapNullValue), classDefs);
		dslStr = DslUtil.setConditionTimeColumnToCorrectFormat(dslStr, dataRagConfig.getDslMightTimeFormats(),
				classDefs, timeConditionsAsEpochMillis(), timeConditionZone());

		DslExecutionResult result;
		if (inSandbox) {
			for (Map<String, Object> classDef : classDefs) {
				String className = sandboxId + ((String) classDef.get("className")).trim();
				classDef.put("className", className);
			}
			String sandboxDslStr = addSandboxId(dslStr, sandboxId);
			result = HttpRequestUtil.executeDsl(dataRagConfig, this, sandboxDslStr, null, true, jsonRule, vectorResourceDao,
					userDataPermission, DslExecutionMode.OPTIMIZED, domainId)[1];
		} else {
			result = HttpRequestUtil.executeDsl(dataRagConfig, this, dslStr, null, true, jsonRule, vectorResourceDao,
					userDataPermission, DslExecutionMode.OPTIMIZED, domainId)[1];
		}

		JSONObject data = result.data();
		Map<String, Object> dataMap = new JSONObject();
		dataMap.putAll(data);
		if (result.failed()) {
			dataMap.put("error", MultiThreadAIChatService.rawErrorText(result.failure().cause()));
		}
		return dataMap;
	}

	private String addSandboxId(String dslStr, String sandboxId) {
		JSONArray dsls = JSON.parseArray(dslStr);
		for (int dslIndex = 0; dslIndex < dsls.size(); dslIndex++) {
			JSONObject dsl = dsls.getJSONObject(dslIndex);
			JSONObject answer = dsl == null ? null : dsl.getJSONObject("answer");
			JSONArray steps = answer == null ? null : answer.getJSONArray("steps");
			if (steps == null) {
				continue;
			}
			JSONObject step = steps.getJSONObject(0);
			JSONObject graph = step == null ? null : step.getJSONObject("graph");
			JSONArray patterns = graph == null ? null : graph.getJSONArray("patterns");
			if (patterns == null) {
				continue;
			}
			JSONArray objects = patterns.getJSONObject(0).getJSONArray("objects");
			if (objects == null) {
				continue;
			}
			for (int objectIndex = 0; objectIndex < objects.size(); objectIndex++) {
				JSONObject object = objects.getJSONObject(objectIndex);
				if (object != null) {
					object.put("class", sandboxId + object.getString("class").trim());
				}
			}
		}
		return JSON.toJSONString(dsls, Feature.WriteMapNullValue);
	}
}
