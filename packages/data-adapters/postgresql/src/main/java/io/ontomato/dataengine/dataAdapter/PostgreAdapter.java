package io.ontomato.dataengine.dataAdapter;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.Date;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import org.postgresql.util.PSQLException;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.DslExecutionResult;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.util.ErrorText;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DslUtil;
import io.ontomato.dataengine.util.HttpRequestUtil;

import lombok.extern.slf4j.Slf4j;

@Slf4j
public class PostgreAdapter extends SandboxDataAdapter {

	private DataAdapterConnection connection;
	private Map<String, Object> jsonRule;

	public PostgreAdapter(DataAdapterConnection connection, Map<String, Object> jsonRule) {
		this.connection = connection;
		this.jsonRule = jsonRule;
	}

	@Override
	public Connection openConnection() throws SQLException {
		return DriverManager.getConnection(
				connection.get("url"),
				connection.get("user"),
				connection.get("password"));
	}

	@Override
	public String executeDsl(String queryJson, String sessionId, DslExecutionMode mode, List<String> generatedMqls) throws Exception {
		JSONArray dsls = JSONArray.parseArray(queryJson);
		DslRowLimit.Tracker rowLimit = new DslRowLimit.Tracker();
		String sql = toSql(dsls.getJSONObject(0), jsonRule, rowLimit);
		generatedMqls.add(sql);
		JSONArray data = querySql(sql);
		boolean truncated = rowLimit.defaulted() && data.size() > rowLimit.effectiveLimit();
		if (truncated) {
			data.remove(rowLimit.effectiveLimit()); // drop the truncation probe row
		}
		JSONArray answers = new JSONArray();
		JSONObject answer = new JSONObject();
		answer.put("answer", data);
		answer.put("mqls", generatedMqls);
		if (truncated) {
			answer.put(DslRowLimit.TRUNCATED, true);
			answer.put(DslRowLimit.ROW_LIMIT, rowLimit.effectiveLimit());
			answer.put(DslRowLimit.TRUNCATION_HINT, DslRowLimit.truncationHint(rowLimit.effectiveLimit()));
			log.warn("[" + sessionId + "] DSL result truncated at the default row limit of "
					+ rowLimit.effectiveLimit());
		}
		answers.add(answer);
		return JSON.toJSONString(answers, Feature.WriteMapNullValue);
	}

	private static final String TWO_STEP_SHAPE = "PostgreSQL renders exactly two steps as one chain: "
			+ "step 1 writes one temporary table with `to_user: false` and `save_table`, and step 2 reads "
			+ "that same temporary table through one object in one pattern and returns the final output with "
			+ "`to_user: true`. Split independent reads or multiple results into separate DSL queries or a query package.";

	private static final Set<String> AGGREGATE_FUNCTIONS = Set.of("AVG", "COUNT", "MIN", "MAX", "SUM");

	private static void requireSupportedTwoStepShape(JSONArray steps) {
		if (steps.size() > 2) {
			throw unsupportedStep("answer.steps[2]", "step 3 cannot be rendered. " + TWO_STEP_SHAPE);
		}
		JSONObject firstOutput = steps.getJSONObject(0).getJSONObject("output");
		JSONObject secondOutput = steps.getJSONObject(1).getJSONObject("output");
		if (firstOutput == null || !Boolean.FALSE.equals(firstOutput.getBoolean("to_user"))) {
			throw unsupportedStep("answer.steps[0].output.to_user",
					"step 1 must not return a separate output in a chained query. " + TWO_STEP_SHAPE);
		}
		String temporaryTable = firstOutput.getString("save_table");
		if (temporaryTable == null || temporaryTable.isBlank()) {
			throw unsupportedStep("answer.steps[0].output.save_table",
					"step 1 must declare the temporary table consumed by step 2. " + TWO_STEP_SHAPE);
		}
		if (secondOutput == null || !Boolean.TRUE.equals(secondOutput.getBoolean("to_user"))) {
			throw unsupportedStep("answer.steps[1].output.to_user",
					"step 2 must be the single final output. " + TWO_STEP_SHAPE);
		}
		JSONArray patterns = steps.getJSONObject(1).getJSONObject("graph").getJSONArray("patterns");
		if (patterns == null || patterns.size() != 1) {
			throw unsupportedStep("answer.steps[1].graph.patterns",
					"step 2 must have exactly one pattern. " + TWO_STEP_SHAPE);
		}
		JSONObject pattern = patterns.getJSONObject(0);
		JSONArray objects = pattern.getJSONArray("objects");
		if (objects == null || objects.size() != 1) {
			throw unsupportedStep("answer.steps[1].graph.patterns[0].objects",
					"step 2 must read exactly one temporary table object. " + TWO_STEP_SHAPE);
		}
		JSONArray relationships = pattern.getJSONArray("relationship");
		if (relationships != null && !relationships.isEmpty()) {
			throw unsupportedStep("answer.steps[1].graph.patterns[0].relationship",
					"step 2 cannot join another object. " + TWO_STEP_SHAPE);
		}
		JSONObject object = objects.getJSONObject(0);
		String className = object.getString("class");
		if (!temporaryTable.equals(className)) {
			throw unsupportedStep("answer.steps[1].graph.patterns[0].objects[0].class",
					"step 2 reads `" + className + "`, but its only supported input is the temporary table `"
							+ temporaryTable + "` written by step 1. " + TWO_STEP_SHAPE);
		}
	}

	private static void requireRenderableFirstStepShape(JSONObject step) {
		JSONArray patterns = step.getJSONObject("graph").getJSONArray("patterns");
		if (patterns == null || patterns.size() != 1) {
			throw unsupportedStep("answer.steps[0].graph.patterns",
					"PostgreSQL renders exactly one pattern per step; split multiple patterns into separate DSL queries");
		}
		JSONObject pattern = patterns.getJSONObject(0);
		JSONArray objects = pattern.getJSONArray("objects");
		if (objects == null || objects.isEmpty()) {
			throw invalidStep("answer.steps[0].graph.patterns[0].objects", "a step requires at least one object");
		}
		if (objects.size() == 1) {
			return;
		}
		JSONArray relationships = pattern.getJSONArray("relationship");
		Map<Integer, Set<Integer>> connected = new HashMap<>();
		for (int i = 0; i < objects.size(); i++) {
			connected.put(objects.getJSONObject(i).getInteger("idx"), new HashSet<>());
		}
		if (relationships != null) {
			for (int i = 0; i < relationships.size(); i++) {
				JSONObject relationship = relationships.getJSONObject(i);
				Integer from = relationship.getInteger("from");
				Integer to = relationship.getInteger("to");
				if (!connected.containsKey(from) || !connected.containsKey(to)) {
					throw invalidStep("answer.steps[0].graph.patterns[0].relationship[" + i + "]",
							"relationship endpoints must be object idx values in the same pattern");
				}
				connected.get(from).add(to);
				connected.get(to).add(from);
			}
		}
		Set<Integer> reached = new HashSet<>();
		List<Integer> queue = new ArrayList<>();
		Integer first = objects.getJSONObject(0).getInteger("idx");
		reached.add(first);
		queue.add(first);
		while (!queue.isEmpty()) {
			Integer current = queue.removeFirst();
			for (Integer next : connected.get(current)) {
				if (reached.add(next)) {
					queue.add(next);
				}
			}
		}
		if (reached.size() != objects.size()) {
			throw unsupportedStep("answer.steps[0].graph.patterns[0].relationship",
					"all objects in one step must be connected by relationships; PostgreSQL does not render independent objects as a Cartesian product, so split them into separate DSL queries or connect them explicitly");
		}
	}

	private static DslContractViolationException unsupportedStep(String path, String detail) {
		return new DslContractViolationException(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT, path, detail);
	}

	private static DslContractViolationException invalidStep(String path, String detail) {
		return new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR, path, detail);
	}

	private static final class OrderContext {
		final Map<String, Set<String>> variableFields = new HashMap<>();
		final Set<String> outputAliases = new LinkedHashSet<>();
		final Map<String, String> detailAliases = new HashMap<>();
		final Set<String> grouped = new HashSet<>();
		boolean aggregate;
		boolean temporary;
	}

	private static OrderContext orderContext(JSONObject step, String tmpClassAs,
			Map<String, Map<String, String>> classAttrTypeMap, Set<String> temporaryFields) {
		OrderContext context = new OrderContext();
		context.temporary = tmpClassAs != null;
		JSONArray patterns = step.getJSONObject("graph").getJSONArray("patterns");
		JSONArray objects = patterns.getJSONObject(0).getJSONArray("objects");
		for (int i = 0; i < objects.size(); i++) {
			JSONObject object = objects.getJSONObject(i);
			String variable = object.getString("variable");
			if (context.temporary) {
				context.variableFields.put(variable, temporaryFields);
			} else {
				Map<String, String> attributes = classAttrTypeMap.get(object.getString("class"));
				context.variableFields.put(variable, attributes == null ? Set.of() : attributes.keySet());
			}
		}
		JSONObject output = step.getJSONObject("output");
		JSONArray fields = output.getJSONArray("fields");
		boolean groupedOutput = false;
		for (int i = 0; i < fields.size(); i++) {
			JSONObject field = fields.getJSONObject(i);
			context.outputAliases.add(field.getString("as"));
			if (field.getString("expr") == null && (field.getString("function") == null || field.getString("function").isBlank())) {
				context.detailAliases.put(field.getString("as"), field.getString("variable") + "\u0000" + field.getString("field"));
			}
			String function = field.getString("function");
			if (function != null && AGGREGATE_FUNCTIONS.contains(function.trim().toUpperCase(Locale.ROOT))) {
				context.aggregate = true;
			}
		}
		JSONObject groupBy = output.getJSONObject("group_by");
		if (groupBy != null && groupBy.getJSONArray("fields") != null) {
			JSONArray groups = groupBy.getJSONArray("fields");
			groupedOutput = !groups.isEmpty();
			for (int i = 0; i < groups.size(); i++) {
				JSONObject group = groups.getJSONObject(i);
				context.grouped.add(group.getString("variable") + "\u0000" + group.getString("field"));
			}
		}
		context.aggregate = context.aggregate || groupedOutput;
		return context;
	}

	private String toSql(JSONObject dsl, Map<String, Object> jsonRule, DslRowLimit.Tracker rowLimit) throws Exception {
		try {
			@SuppressWarnings("unchecked")
			List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
			Map<String, Map<String, String>> classAttrTypeMap = new HashMap<>();
			Map<String, Set<String>> classEnableAttrsMap = new HashMap<String, Set<String>>();
			for (Map<String, Object> classDef : classDefs) {
				Map<String, String> attrTypeMap = new HashMap<>();
				Set<String> enableAttrs = new HashSet<String>();
				@SuppressWarnings("unchecked")
				List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
				for (Map<String, Object> attrDef : attrDefs) {
					attrTypeMap.put((String) attrDef.get("name"), (String) attrDef.get("type"));
					if (attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) {
						enableAttrs.add((String) attrDef.get("name"));
					}
				}
				classAttrTypeMap.put((String) classDef.get("className"), attrTypeMap);
				classEnableAttrsMap.put((String) classDef.get("className"), enableAttrs);
			}
			@SuppressWarnings("unchecked")
			Map<String, Object> relationship_rule = (Map<String, Object>) jsonRule.get("relationship_rule");

			JSONArray steps = dsl.getJSONObject("answer").getJSONArray("steps");
			JSONObject firstStep = steps.getJSONObject(0);
			requireRenderableFirstStepShape(firstStep);
			if (steps.size() > 1) {
				requireSupportedTwoStepShape(steps);
			}

			JSONArray objects = firstStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
					.getJSONArray("objects");
			String subSelectWhere = "";
			Map<Integer, String[]> idxMap = new HashMap<>();
			for (int i = 0; i < objects.size(); i++) {
				JSONObject object = objects.getJSONObject(i);
				String className = object.getString("class");
				String alias = object.getString("variable");
				idxMap.put(object.getInteger("idx"), new String[] { className, alias });
				Map<String, String> attrTypeMap = classAttrTypeMap.get(className);
				String objWhere = "";
				if (object.getJSONObject("conditions") != null) {
					JSONObject conditions = object.getJSONObject("conditions");
						if (conditions.getJSONObject("timeseries") != null) {
							throw new DslContractViolationException(
									DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
									"conditions.timeseries",
									"the timeseries condition is not implemented by " + getClass().getSimpleName());
						}
					if (conditions.getJSONObject("properties") != null) {
						objWhere = renderPropertiesWhere(conditions.getJSONObject("properties"), alias, attrTypeMap, false,
								"conditions.properties");
					}
					if (conditions.getJSONObject("text") != null) {
						JSONObject text = conditions.getJSONObject("text");
						if (text.getString("query") != null && !"".equals(text.getString("query").trim())) {
							String textWhere = "";
							String query = text.getString("query").trim().replace("'", "''");
							if (!query.startsWith("%") && !query.endsWith("%")) {
								query = "%" + query + "%";
							}
							boolean first = true;
							for (String enableAttr : classEnableAttrsMap.get(className)) {
								String type = attrTypeMap.get(enableAttr);
								if ("varchar".equals(type) || "text".equals(type)) {
									if (!first) {
										textWhere += " or ";
									}
									textWhere += columnReference(alias, physicalIdentifier(enableAttr)) + " like '" + query + "'";
									first = false;
								}
							}
							if (!"".equals(textWhere)) {
								if (!"".equals(objWhere)) {
									objWhere = "(" + objWhere + " and (" + textWhere + "))";
								} else {
									objWhere = "(" + textWhere + ")";
								}
							}
						}
					}
				}
				if (!"".equals(objWhere)) {
					subSelectWhere += objWhere + " and ";
				}
			}
			if (!"".equals(subSelectWhere)) {
				subSelectWhere = subSelectWhere.substring(0, subSelectWhere.length() - 5);
			}

			String subSelectFrom = "";
			JSONArray relationships = firstStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
					.getJSONArray("relationship");
			// This source joins key columns directly, so exactly one hop is all it can render. A wider range
			// must fail loudly: returning the one-hop answer would look like the requested result.
			KeyFieldGraphContract.requireSupported(relationships, "relationship");
			if (relationships != null && relationships.size() > 0) {
				Set<Integer> inJoinIdxs = new HashSet<>();
				Set<Integer> inJoinRelIndexes = new HashSet<>();
				List<String> innerJoinSqls = new ArrayList<>();
				List<Set<Integer>> innerJoinClassesList = new ArrayList<>();
				while (true) {
					int inJoinRelCount = inJoinRelIndexes.size();
					for (int i = 0; i < relationships.size(); i++) {
						if (!inJoinRelIndexes.contains(i)) {
							JSONObject relationship = relationships.getJSONObject(i);
							Integer fromIdx = relationship.getInteger("from");
							Integer toIdx = relationship.getInteger("to");
							String[] fromClassAlias = idxMap.get(fromIdx);
							String[] toClassAlias = idxMap.get(toIdx);
							String relationshipName = relationship.getJSONArray("type").getString(0).trim();
							OntologyRelation rel = OntologyRelation.of(relationshipName,
									relationship_rule.get(relationshipName),
									"relationship_rule[" + relationshipName + "]");
							if (!rel.usesKeyFields()) {
								throw new DslContractViolationException(
										DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
										"relationship[" + relationshipName + "]",
										"relationship [" + relationshipName + "] declares type '" + rel.kind()
												+ "', which this source cannot traverse; it stores edges as key columns");
							}
							if (rel.junction()) {
								String linkTable = junctionTableName(rel);
								String linkAlias = "__l" + i;
								// The DSL may traverse the relationship either way; the junction columns belong to
								// the ontomap's ends, so resolve which alias is which before placing them.
								boolean fromIsOntoFrom = classMatches(fromClassAlias[0], rel.fromClass());
								String ontoFromAlias = fromIsOntoFrom ? fromClassAlias[1] : toClassAlias[1];
								String ontoToAlias = fromIsOntoFrom ? toClassAlias[1] : fromClassAlias[1];
								String ontoFromClassName = fromIsOntoFrom ? fromClassAlias[0] : toClassAlias[0];
								String ontoToClassName = fromIsOntoFrom ? toClassAlias[0] : fromClassAlias[0];
								// Which end the DSL wrote first does not change what the columns mean: fromField
								// is always the column on the ontomap's from-class, linkTableFromField always the
								// junction column holding that class's key.
								String fromColumn = columnReference(ontoFromAlias, physicalIdentifier(rel.fromField()));
								String toColumn = columnReference(ontoToAlias, physicalIdentifier(rel.toField()));
								String fromLink = columnReference(linkAlias, physicalIdentifier(rel.linkTableFromField()));
								String toLink = columnReference(linkAlias, physicalIdentifier(rel.linkTableToField()));
								String junction = " inner join " + linkTable + " as " + quoteIdentifier(linkAlias) + " on ";
								String fromJunction = junction + fromColumn + " = " + fromLink;
								String toJunction = junction + toColumn + " = " + toLink;
								String joinTarget = " inner join " + physicalIdentifier(ontoToClassName)
										+ " as " + quoteIdentifier(ontoToAlias) + " on " + toLink + " = " + toColumn;
								String joinSource = " inner join " + physicalIdentifier(ontoFromClassName)
										+ " as " + quoteIdentifier(ontoFromAlias) + " on " + fromLink + " = " + fromColumn;

								boolean ontoFromInSet = inJoinIdxs.contains(fromIsOntoFrom ? fromIdx : toIdx);
								boolean ontoToInSet = inJoinIdxs.contains(fromIsOntoFrom ? toIdx : fromIdx);

								if (inJoinIdxs.isEmpty()) {
									// A logical one-hop edge is two joins here; the hop count the DSL wrote stays 1.
									innerJoinSqls.add(physicalIdentifier(ontoFromClassName) + " as " + quoteIdentifier(ontoFromAlias)
											+ fromJunction + joinTarget);
									inJoinIdxs.add(fromIdx);
									inJoinIdxs.add(toIdx);
									innerJoinClassesList.add(new HashSet<>(inJoinIdxs));
									inJoinRelIndexes.add(i);
								} else if (ontoFromInSet && !ontoToInSet) {
									innerJoinSqls.add(fromJunction + joinTarget);
									inJoinIdxs.add(fromIsOntoFrom ? toIdx : fromIdx);
									innerJoinClassesList.add(new HashSet<>(inJoinIdxs));
									inJoinRelIndexes.add(i);
								} else if (!ontoFromInSet && ontoToInSet) {
									innerJoinSqls.add(toJunction + joinSource);
									inJoinIdxs.add(fromIsOntoFrom ? fromIdx : toIdx);
									innerJoinClassesList.add(new HashSet<>(inJoinIdxs));
									inJoinRelIndexes.add(i);
								} else if (ontoFromInSet && ontoToInSet) {
									// Both ends are already joined: require a junction row between them without
									// introducing either class a second time.
									Integer groupIndex = null;
									for (int j = 0; j < innerJoinClassesList.size(); j++) {
										Set<Integer> group = innerJoinClassesList.get(j);
										if (group.contains(fromIdx) && group.contains(toIdx)) {
											groupIndex = j;
											break;
										}
									}
									if (groupIndex == null) {
										groupIndex = 0;
									}
									innerJoinSqls.set(groupIndex, innerJoinSqls.get(groupIndex)
											+ fromJunction + " and " + toLink + " = " + toColumn);
									inJoinRelIndexes.add(i);
								}
								continue;
							}
							String fromTable = physicalIdentifier(fromClassAlias[0]) + " as " + quoteIdentifier(fromClassAlias[1]);
							String toTable = physicalIdentifier(toClassAlias[0]) + " as " + quoteIdentifier(toClassAlias[1]);
							String joinCondition = columnReference(fromClassAlias[1], physicalIdentifier(rel.fromField()))
									+ " = " + columnReference(toClassAlias[1], physicalIdentifier(rel.toField()));
							if (inJoinIdxs.isEmpty()) {
								innerJoinSqls.add(fromTable + " inner join " + toTable + " on " + joinCondition);
								inJoinIdxs.add(fromIdx);
								inJoinIdxs.add(toIdx);
								Set<Integer> innerJoinClasses = new HashSet<>(inJoinIdxs);
								innerJoinClassesList.add(innerJoinClasses);
								inJoinRelIndexes.add(i);
							} else if (inJoinIdxs.contains(fromIdx) && !inJoinIdxs.contains(toIdx)) {
								innerJoinSqls.add("inner join " + toTable + " on " + joinCondition);
								inJoinIdxs.add(toIdx);
								Set<Integer> innerJoinClasses = new HashSet<>(inJoinIdxs);
								innerJoinClassesList.add(innerJoinClasses);
								inJoinRelIndexes.add(i);
							} else if (!inJoinIdxs.contains(fromIdx) && inJoinIdxs.contains(toIdx)) {
								innerJoinSqls.add("inner join " + fromTable + " on " + joinCondition);
								inJoinIdxs.add(fromIdx);
								Set<Integer> innerJoinClasses = new HashSet<>(inJoinIdxs);
								innerJoinClassesList.add(innerJoinClasses);
								inJoinRelIndexes.add(i);
							} else if (inJoinIdxs.contains(fromIdx) && inJoinIdxs.contains(toIdx)) {
								Integer innerJoinSqlIndex = null;
								for (int j = 0; j < innerJoinClassesList.size(); j++) {
									Set<Integer> innerJoinClasses = innerJoinClassesList.get(j);
									if (innerJoinClasses.contains(fromIdx) && innerJoinClasses.contains(toIdx)) {
										innerJoinSqlIndex = j;
										break;
									}
								}
								innerJoinSqls.set(innerJoinSqlIndex,
										innerJoinSqls.get(innerJoinSqlIndex) + " and " + joinCondition);
								inJoinRelIndexes.add(i);
							}
						}
					}
					if (inJoinRelIndexes.size() == relationships.size()
							|| inJoinRelIndexes.size() == inJoinRelCount) {
						break;
					}
				}
				for (String innerJoinSql : innerJoinSqls) {
					subSelectFrom += innerJoinSql + "\n";
				}
			} else {
				subSelectFrom = physicalIdentifier(objects.getJSONObject(0).getString("class")) + " as "
						+ quoteIdentifier(objects.getJSONObject(0).getString("variable"));
			}

			String subSelectSelect = "";
			JSONArray outputFields = firstStep.getJSONObject("output").getJSONArray("fields");
			boolean hadDistinct = false;
			for (int i = 0; i < outputFields.size(); i++) {
				JSONObject field = outputFields.getJSONObject(i);
				String column = columnReference(field.getString("variable"), physicalIdentifier(field.getString("field")));
				String function = field.getString("function");
				boolean distinct = field.getBooleanValue("distinct");
				String colSql;
				if (function != null && !function.isBlank()) {
					colSql = function + "(" + (distinct ? "distinct " : "") + column + ")";
				} else if (distinct && !hadDistinct) {
					colSql = "distinct " + column;
					hadDistinct = true;
				} else {
					colSql = column;
				}
				colSql += " as " + quoteIdentifier(field.getString("as"));
				subSelectSelect += colSql + (i == outputFields.size() - 1 ? "" : ",");
			}

			String subSelectSql = "select \n"
					+ "    " + subSelectSelect + "\n"
					+ "from \n"
					+ "    " + subSelectFrom + "\n"
					+ ("".equals(subSelectWhere) ? "" : "where\n    " + subSelectWhere);

			if (steps.size() == 1) {
				OrderContext orderContext = orderContext(firstStep, null, classAttrTypeMap, null);
				subSelectSql = appendGroupByHaving(firstStep, subSelectSql, null);
				subSelectSql = appendOrderBy(firstStep, subSelectSql, orderContext, "answer.steps[0]");
				subSelectSql = appendLimit(firstStep, subSelectSql, rowLimit);
				return subSelectSql;
			} else {
				OrderContext firstOrderContext = orderContext(firstStep, null, classAttrTypeMap, null);
				Map<String, String> temporaryTypes = temporaryFieldTypes(firstStep, classAttrTypeMap);
				subSelectSql = appendGroupByHaving(firstStep, subSelectSql, null);
				subSelectSql = appendOrderBy(firstStep, subSelectSql, firstOrderContext, "answer.steps[0]");
				subSelectSql = appendIntermediateLimit(firstStep, subSelectSql);

				JSONObject secondStep = steps.getJSONObject(1);
				String tmpClassAs = secondStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
						.getJSONArray("objects").getJSONObject(0).getString("variable");
				JSONArray secondOutputFields = secondStep.getJSONObject("output").getJSONArray("fields");
				String select = "";
				hadDistinct = false;
				for (int i = 0; i < secondOutputFields.size(); i++) {
					JSONObject field = secondOutputFields.getJSONObject(i);
					String colSql = "";
					String expr = field.getString("expr");
					if (expr != null && !expr.isBlank()) {
						// The grammar gate restricts expr to arithmetic over the temporary table's fields.
						colSql = expr;
					} else {
						String column = columnReference(tmpClassAs, quoteIdentifier(field.getString("field")));
						String function = field.getString("function");
						boolean distinct = field.getBooleanValue("distinct");
						if (function != null && !function.isBlank()) {
							colSql = function + "(" + (distinct ? "distinct " : "") + column + ")";
						} else if (distinct && !hadDistinct) {
							colSql = "distinct " + column;
							hadDistinct = true;
						} else {
							colSql = column;
						}
					}
					colSql += " as " + quoteIdentifier(field.getString("as"));
					select += colSql + (i == secondOutputFields.size() - 1 ? "" : ",");
				}
				String sql = "select\n"
						+ "    " + select + "\n"
						+ "from (\n"
						+ subSelectSql + "\n"
						+ ") as " + quoteIdentifier(tmpClassAs);
				String temporaryWhere = temporaryWhere(secondStep, tmpClassAs, temporaryTypes);
				if (!temporaryWhere.isEmpty()) {
					sql += "\nwhere\n    " + temporaryWhere;
				}

				OrderContext secondOrderContext = orderContext(secondStep, tmpClassAs, null, temporaryTypes.keySet());
				sql = appendGroupByHaving(secondStep, sql, tmpClassAs);
				sql = appendOrderBy(secondStep, sql, secondOrderContext, "answer.steps[1]");
				sql = appendLimit(secondStep, sql, rowLimit);
				return sql;
			}
		} catch (DslContractViolationException e) {
			// located + actionable: let it through unchanged
			log.warn(e.getMessage());
			throw e;
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			throw new Exception("Failed to convert DSL to SQL");
		}
	}

	private static Map<String, String> temporaryFieldTypes(JSONObject step,
			Map<String, Map<String, String>> classAttrTypeMap) {
		Map<String, String> objectClasses = new HashMap<>();
		JSONArray objects = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects");
		for (int i = 0; i < objects.size(); i++) {
			JSONObject object = objects.getJSONObject(i);
			objectClasses.put(object.getString("variable"), object.getString("class"));
		}
		Map<String, String> types = new LinkedHashMap<>();
		JSONArray fields = step.getJSONObject("output").getJSONArray("fields");
		for (int i = 0; i < fields.size(); i++) {
			JSONObject field = fields.getJSONObject(i);
			String alias = field.getString("as");
			if (field.getString("expr") != null && !field.getString("expr").isBlank()) {
				types.put(alias, null);
				continue;
			}
			String variable = field.getString("variable");
			String sourceField = field.getString("field");
			Map<String, String> sourceTypes = classAttrTypeMap.get(objectClasses.get(variable));
			String sourceType = sourceTypes == null ? null : sourceTypes.get(sourceField);
			String function = field.getString("function");
			if (function == null || function.isBlank()) {
				types.put(alias, sourceType);
				continue;
			}
			String normalized = function.trim().toLowerCase(Locale.ROOT);
			if ("count".equals(normalized)) {
				types.put(alias, "long");
			} else if ("avg".equals(normalized)) {
				types.put(alias, "double");
			} else if ("min".equals(normalized) || "max".equals(normalized) || "sum".equals(normalized)) {
				types.put(alias, sourceType);
			} else {
				types.put(alias, null);
			}
		}
		return types;
	}

	private String renderPropertiesWhere(JSONObject properties, String alias, Map<String, String> attrTypeMap,
			boolean quotedFields, String path) {
		String objWhere = "";
		List<Object[]> queue = new ArrayList<>();
		queue.add(new Object[] { properties, null });
		while (!queue.isEmpty()) {
			Object[] objs = queue.removeFirst();
			JSONObject cond = objs[0] == null ? null : (JSONObject) objs[0];
			String and_or_end = objs[1] == null ? null : (String) objs[1];
			if (cond == null && and_or_end != null) {
				objWhere += and_or_end;
			} else if (cond.getJSONArray("and") != null && cond.getJSONArray("and").size() > 0) {
				objWhere += "(";
				List<Object[]> newQueue = new ArrayList<>();
				JSONArray ands = cond.getJSONArray("and");
				for (int j = 0; j < ands.size(); j++) {
					JSONObject and = ands.getJSONObject(j);
					newQueue.add(new Object[] { and, null });
					if (j < ands.size() - 1) {
						newQueue.add(new Object[] { null, " and " });
					}
				}
				newQueue.add(new Object[] { null, ")" });
				newQueue.addAll(queue);
				queue = newQueue;
			} else if (cond.getJSONArray("or") != null && cond.getJSONArray("or").size() > 0) {
				objWhere += "(";
				List<Object[]> newQueue = new ArrayList<>();
				JSONArray ors = cond.getJSONArray("or");
				for (int j = 0; j < ors.size(); j++) {
					JSONObject or = ors.getJSONObject(j);
					newQueue.add(new Object[] { or, null });
					if (j < ors.size() - 1) {
						newQueue.add(new Object[] { null, " or " });
					}
				}
				newQueue.add(new Object[] { null, ")" });
				newQueue.addAll(queue);
				queue = newQueue;
			} else if (cond.getJSONArray("not") != null && cond.getJSONArray("not").size() > 0) {
				objWhere += "(not (";
				List<Object[]> newQueue = new ArrayList<>();
				newQueue.add(new Object[] { DslGrammarValidator.negated(cond), null });
				newQueue.add(new Object[] { null, "))" });
				newQueue.addAll(queue);
				queue = newQueue;
			} else {
				String attr = cond.getString("field");
				String type = attrTypeMap.get(attr);
				if (type == null && attrTypeMap.containsKey(attr)
						&& !"is".equals(cond.getString("operator")) && !"is not".equals(cond.getString("operator"))) {
					throw new DslContractViolationException(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT, path,
							"the type of field '" + attr + "' cannot be determined; project a typed source attribute or a count/avg/min/max/sum result before filtering it");
				}
				String column = columnReference(alias, quotedFields ? quoteIdentifier(attr) : physicalIdentifier(attr));
				String sqlCond = null;
				if ("=".equals(cond.getString("operator"))
						|| "!=".equals(cond.getString("operator"))) {
					if ("varchar".equals(type) || "text".equals(type)) {
						sqlCond = column + " " + cond.getString("operator")
								+ " '" + cond.getString("value").replace("'", "''") + "'";
					} else if ("int".equals(type) || "long".equals(type) || "float".equals(type) || "double".equals(type)) {
						sqlCond = column + " " + cond.getString("operator")
								+ " " + cond.get("value");
					} else if ("boolean".equals(type)) {
						sqlCond = column + " " + cond.getString("operator")
								+ " " + booleanLiteral(cond.get("value"));
					} else if ("date".equals(type) || "timestamp".equals(type) || "datetime".equals(type)) {
						sqlCond = column + " " + cond.getString("operator")
								+ " " + timeLiteral(cond.get("value"));
					}
				} else if ("like".equals(cond.getString("operator")) && LikePattern.escaped(cond)) {
					if ("varchar".equals(type) || "text".equals(type)) {
						String pattern = LikePattern.of(cond, true).sql("").replace("'", "''");
						sqlCond = column + " like '" + pattern + "' escape '!'";
					}
				} else if ("like".equals(cond.getString("operator"))
						|| "not like".equals(cond.getString("operator"))) {
					if ("varchar".equals(type) || "text".equals(type)) {
						String value = cond.getString("value").replace("'", "''").trim();
						if (!value.startsWith("%") && !value.endsWith("%")) {
							value = "%" + value + "%";
						}
						sqlCond = column + " " + cond.getString("operator")
								+ " '" + value + "'";
					}
				} else if (">".equals(cond.getString("operator"))
						|| ">=".equals(cond.getString("operator"))
						|| "<=".equals(cond.getString("operator"))
						|| "<".equals(cond.getString("operator"))) {
					if ("int".equals(type) || "long".equals(type) || "float".equals(type) || "double".equals(type)) {
						sqlCond = column + " " + cond.getString("operator")
								+ " " + cond.get("value");
					} else if ("date".equals(type) || "timestamp".equals(type) || "datetime".equals(type)) {
						sqlCond = column + " " + cond.getString("operator")
								+ " " + timeLiteral(cond.get("value"));
					} else if ("varchar".equals(type)) {
						sqlCond = column + " " + cond.getString("operator")
								+ " '" + cond.get("value").toString().replace("'", "''") + "'";
					}
				} else if ("between".equals(cond.getString("operator"))) {
					JSONArray value = cond.getJSONArray("value");
					if ("int".equals(type) || "long".equals(type) || "float".equals(type) || "double".equals(type)) {
						sqlCond = "(" + column + " >= " + value.get(0)
								+ " and " + column + " <= " + value.get(1) + ")";
					} else if ("date".equals(type) || "timestamp".equals(type) || "datetime".equals(type)) {
						sqlCond = "(" + column + " >= " + timeLiteral(value.get(0))
								+ " and " + column
								+ " <= " + timeLiteral(value.get(1)) + ")";
					} else if ("varchar".equals(type)) {
						sqlCond = "(" + column + " >= '" + value.get(0).toString().replace("'", "''")
								+ "' and " + column + " <= '" + value.get(1).toString().replace("'", "''") + "')";
					}
				} else if ("in".equals(cond.getString("operator"))) {
					JSONArray value = cond.getJSONArray("value");
					if ("varchar".equals(type) || "text".equals(type)) {
						String in = "";
						for (int j = 0; j < value.size(); j++) {
							in += "'" + value.getString(j).replace("'", "''") + "',";
						}
						in = "(" + in.substring(0, in.length() - 1) + ")";
						sqlCond = column + " in " + in;
					} else if ("int".equals(type) || "long".equals(type) || "float".equals(type) || "double".equals(type)) {
						String in = "";
						for (int j = 0; j < value.size(); j++) {
							in += value.get(j) + ",";
						}
						in = "(" + in.substring(0, in.length() - 1) + ")";
						sqlCond = column + " in " + in;
					} else if ("boolean".equals(type)) {
						String in = "";
						for (int j = 0; j < value.size(); j++) {
							in += booleanLiteral(value.get(j)) + ",";
						}
						in = "(" + in.substring(0, in.length() - 1) + ")";
						sqlCond = column + " in " + in;
					} else if ("date".equals(type) || "timestamp".equals(type) || "datetime".equals(type)) {
						String in = "";
						for (int j = 0; j < value.size(); j++) {
							in += timeLiteral(value.get(j)) + ",";
						}
						in = "(" + in.substring(0, in.length() - 1) + ")";
						sqlCond = column + " in " + in;
					}
				} else if ("is".equals(cond.getString("operator"))
						|| "is not".equals(cond.getString("operator"))) {
					sqlCond = column + " " + cond.getString("operator") + " null";
				}
				if (sqlCond == null) {
					throw new DslContractViolationException(
							DslContractViolationException.Code.UNSUPPORTED_OPERATOR_FOR_TYPE,
							path,
							"operator '" + cond.getString("operator") + "' on field '" + attr
									+ "' of type '" + type + "' is not supported by "
									+ getClass().getSimpleName());
				}
				objWhere += sqlCond;
			}
		}
		return objWhere;
	}

	private String appendGroupByHaving(JSONObject step, String sql, String tmpClassAs) {
		if (step.getJSONObject("output").getJSONObject("group_by") == null) {
			return sql;
		}
		JSONObject groupBy = step.getJSONObject("output").getJSONObject("group_by");
		if (groupBy.getJSONArray("fields") != null && groupBy.getJSONArray("fields").size() > 0) {
			sql += "\ngroup by\n    ";
			for (int i = 0; i < groupBy.getJSONArray("fields").size(); i++) {
				JSONObject field = groupBy.getJSONArray("fields").getJSONObject(i);
				if (tmpClassAs != null) {
					sql += columnReference(tmpClassAs, quoteIdentifier(field.getString("field")));
				} else {
					sql += columnReference(field.getString("variable"), physicalIdentifier(field.getString("field")));
				}
				sql += (i == groupBy.getJSONArray("fields").size() - 1 ? "" : ",");
			}
			if (groupBy.getJSONArray("having") != null && groupBy.getJSONArray("having").size() > 0) {
				sql += "\nhaving\n    ";
				for (int i = 0; i < groupBy.getJSONArray("having").size(); i++) {
					JSONObject havingCond = groupBy.getJSONArray("having").getJSONObject(i);
					String ref = tmpClassAs != null
							? columnReference(tmpClassAs, quoteIdentifier(havingCond.getString("field")))
							: (havingCond.getBoolean("distinct") != null && havingCond.getBoolean("distinct")
									? "distinct "
									: "")
									+ columnReference(havingCond.getString("variable"), physicalIdentifier(havingCond.getString("field")));
					sql += havingCond.getString("function") + "(" + ref
							+ ") " + havingCond.getString("operator") + " " + havingCond.get("value")
							+ (i == groupBy.getJSONArray("having").size() - 1 ? "" : " and ");
				}
			}
		}
		return sql;
	}

	private String appendOrderBy(JSONObject step, String sql, OrderContext context, String stepPath) {
		if (step.getJSONObject("output").getJSONObject("sort") == null) {
			return sql;
		}
		JSONObject orderBy = step.getJSONObject("output").getJSONObject("sort");
		if (orderBy.getJSONArray("fields") != null && orderBy.getJSONArray("fields").size() > 0) {
			sql += "\norder by\n    ";
			for (int i = 0; i < orderBy.getJSONArray("fields").size(); i++) {
				JSONObject order = orderBy.getJSONArray("fields").getJSONObject(i);
				String path = stepPath + ".output.sort.fields[" + i + "]";
				sql += orderReference(order, context, path)
						+ ("desc".equals(order.getString("order")) ? " desc" : "")
						+ (i == orderBy.getJSONArray("fields").size() - 1 ? "" : ",");
			}
		}
		return sql;
	}

	private static String orderReference(JSONObject order, OrderContext context, String path) {
		String variable = order.getString("variable");
		String field = order.getString("field");
		if (field == null || field.isBlank()) {
			throw invalidStep(path + ".field", "a sort field requires a nonblank `field`");
		}
		boolean hasVariable = variable != null && !variable.isBlank();
		if (!hasVariable) {
			if (context.outputAliases.contains(field)) {
				requireSortableAlias(field, context, path);
				return quoteIdentifier(field);
			}
			throw invalidStep(path + ".field", "sort field `" + field
					+ "` is not an output alias; write `variable` and `field` for a source attribute, or omit `variable` only for an output or calculation alias");
		}
		Set<String> sourceFields = context.variableFields.get(variable);
		if (sourceFields == null) {
			throw invalidStep(path + ".variable", "unknown sort variable `" + variable + "`");
		}
		if (sourceFields.contains(field)) {
			if (context.aggregate && !context.grouped.contains(variable + "\u0000" + field)) {
				throw invalidStep(path, "`" + variable + "." + field
						+ "` is a detail field in an aggregated query; group by it or sort by the output alias of an aggregate or grouped field such as `"
						+ String.join("`, `", context.outputAliases) + "`");
			}
			return columnReference(variable, context.temporary ? quoteIdentifier(field) : physicalIdentifier(field));
		}
		if (context.outputAliases.contains(field)) {
			requireSortableAlias(field, context, path);
			return quoteIdentifier(field);
		}
		throw invalidStep(path + ".field", "`" + field + "` is neither an attribute of `" + variable
				+ "` nor an output alias; use `variable` and `field` for a source attribute, or omit `variable` and use one of the output aliases `"
				+ String.join("`, `", context.outputAliases) + "`");
	}

	private static void requireSortableAlias(String alias, OrderContext context, String path) {
		String source = context.detailAliases.get(alias);
		if (context.aggregate && source != null && !context.grouped.contains(source)) {
			throw invalidStep(path, "sort field `" + alias
					+ "` is the output alias of an ungrouped detail field in an aggregated query; group by that field or sort by an aggregate output alias");
		}
	}

	private String temporaryWhere(JSONObject step, String tmpClassAs, Map<String, String> temporaryTypes) {
		JSONObject object = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
				.getJSONArray("objects").getJSONObject(0);
		JSONObject conditions = object.getJSONObject("conditions");
		if (conditions == null) {
			return "";
		}
		String path = "answer.steps[1].graph.patterns[0].objects[0].conditions";
		for (String key : conditions.keySet()) {
			if (!Set.of("properties", "timeseries", "text", "vector").contains(key)) {
				throw invalidStep(path + "." + key,
						"`conditions` only takes `properties`, `timeseries`, `text` or `vector`; put field filters under `conditions.properties`");
			}
		}
		for (String key : List.of("timeseries", "text", "vector")) {
			if (conditions.getJSONObject(key) != null) {
				throw unsupportedStep(path + "." + key,
						"PostgreSQL temporary-table conditions support only `conditions.properties`; move this filter into the first step or render it as a property condition");
			}
		}
		JSONObject properties = conditions.getJSONObject("properties");
		if (properties == null) {
			return "";
		}
		requireTemporaryConditionFields(properties, temporaryTypes.keySet(), path + ".properties");
		return renderPropertiesWhere(properties, tmpClassAs, temporaryTypes, true, path + ".properties");
	}

	private static void requireTemporaryConditionFields(JSONObject condition, Set<String> temporaryFields, String path) {
		JSONArray and = condition.getJSONArray("and");
		if (and != null) {
			if (and.isEmpty()) {
				throw invalidStep(path, "a logic condition requires a nonempty `and` list");
			}
			for (int i = 0; i < and.size(); i++) {
				requireTemporaryConditionFields(and.getJSONObject(i), temporaryFields, path);
			}
			return;
		}
		JSONArray or = condition.getJSONArray("or");
		if (or != null) {
			if (or.isEmpty()) {
				throw invalidStep(path, "a logic condition requires a nonempty `or` list");
			}
			for (int i = 0; i < or.size(); i++) {
				requireTemporaryConditionFields(or.getJSONObject(i), temporaryFields, path);
			}
			return;
		}
		JSONArray not = condition.getJSONArray("not");
		if (not != null) {
			requireTemporaryConditionFields(DslGrammarValidator.negated(condition), temporaryFields, path);
			return;
		}
		String field = condition.getString("field");
		if (field == null || field.isBlank()) {
			throw invalidStep(path, "a field condition requires `field`, `operator` and `value`, or a logic list under `and`, `or` or `not`");
		}
		if (!temporaryFields.contains(field)) {
			throw invalidStep(path + ".field", "unknown temporary-table field `" + field + "`; available fields are `"
					+ String.join("`, `", temporaryFields) + "`");
		}
	}

	private String appendIntermediateLimit(JSONObject step, String sql) {
		JSONObject limit = step.getJSONObject("output").getJSONObject("limit");
		if (limit == null) {
			return sql;
		}
		Integer offset = limit.getInteger("offset");
		if (offset == null) {
			offset = 0;
		}
		return sql + "\nlimit " + limit.getInteger("count") + " offset " + offset;
	}

	private String appendLimit(JSONObject step, String sql, DslRowLimit.Tracker rowLimit) {
		JSONObject limit = step.getJSONObject("output").getJSONObject("limit");
		if (limit == null) {
			// An omitted limit means "apply the engine default", never an unbounded read. Fetch one
			// extra row so a real truncation is detected without a count(*) pass.
			int cap = DslRowLimit.defaultRowLimit();
			rowLimit.terminalLimit(cap, true);
			return sql + "\nlimit " + (cap + 1);
		}
		Integer offset = limit.getInteger("offset");
		if (offset == null) {
			offset = 0;
		}
		sql += "\nlimit " + limit.getInteger("count") + " offset " + offset;
		rowLimit.terminalLimit(limit.getInteger("count"), false);
		return sql;
	}

	@Override
	public String getSampleDataFileName(String sampleDataDirName, String className) {
		return "conf/" + sampleDataDirName + "/" + className + ".json";
	}

	@Override
	public String querySampleDataByClassName(String className, List<String> attrs) {
		try {
			String select = "";
			for (int i = 0; i < attrs.size(); i++) {
				select += physicalIdentifier(attrs.get(i));
				if (i < attrs.size() - 1) {
					select += ", ";
				}
			}
			String sql = "select " + select + " from " + physicalIdentifier(className) + " limit 1";
			JSONArray data = querySql(sql);
			if (data.size() > 0) {
				JSONObject datum = data.getJSONObject(0);
				Set<String> keys = datum.keySet();
				for (String key : keys) {
					Object value = datum.get(key);
					if (value != null && value instanceof String) {
						String str = (String) value;
						if (str.length() > 100) {
							datum.put(key, str.substring(0, 100) + "...");
						}
					}
				}
				return datum.toString();
			} else {
				return className + " class has no data";
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return "Failed to get sample data for class [" + className + "]";
		}
	}

	private JSONArray querySql(String sql) throws Exception {
		Connection conn = null;
		PreparedStatement pst = null;
		ResultSet rs = null;
		try {
			JSONArray rows = new JSONArray();
			conn = openConnection();
			pst = conn.prepareStatement(sql);
			rs = pst.executeQuery();
			ResultSetMetaData meta = rs.getMetaData();
			while (rs.next()) {
				JSONObject row = new JSONObject();
				for (int i = 1; i <= meta.getColumnCount(); i++) {
					String label = meta.getColumnLabel(i);
					if (isTemporalColumn(meta.getColumnType(i))) {
						// Return the source's own text: a tz-aware column keeps its offset and a naive one keeps its wall clock.
						row.put(label, temporalValue(rs, i, meta.getColumnType(i)));
					} else {
						row.put(label, rs.getObject(i));
					}
				}
				rows.add(row);
			}
			return rows;
		} catch (Exception e) {
			throw e;
		} finally {
			if (rs != null) {
				try { rs.close(); } catch (Exception e) { log.error(e.getMessage(), e); }
			}
			if (pst != null) {
				try { pst.close(); } catch (Exception e) { log.error(e.getMessage(), e); }
			}
			if (conn != null) {
				try { conn.close(); } catch (Exception e) { log.error(e.getMessage(), e); }
			}
		}
	}

	@Override
	public void validatePrimaryKeyName(String attrName) throws Exception {
	}

	private static final java.util.regex.Pattern UNQUOTED_IDENTIFIER =
			java.util.regex.Pattern.compile("[A-Za-z_\\x80-\\x{10FFFF}][A-Za-z_0-9$\\x80-\\x{10FFFF}]*");

	// Keep PostgreSQL's legacy ASCII folding for names that could have been created unquoted.
	private static String physicalName(String name) {
		if (!UNQUOTED_IDENTIFIER.matcher(name).matches()) return name;
		StringBuilder folded = new StringBuilder(name.length());
		for (int i = 0; i < name.length(); i++) {
			char c = name.charAt(i);
			folded.append(c >= 'A' && c <= 'Z' ? (char) (c + 'a' - 'A') : c);
		}
		return folded.toString();
	}

	private static String quoteIdentifier(String name) {
		if (name.isEmpty() || name.indexOf(0) >= 0) {
			throw new IllegalArgumentException("PostgreSQL identifiers must be nonempty and cannot contain NUL");
		}
		int bytes = name.getBytes(StandardCharsets.UTF_8).length;
		if (bytes > 63) {
			throw new IllegalArgumentException("PostgreSQL identifier is " + bytes + " bytes; maximum is 63 bytes");
		}
		return "\"" + name.replace("\"", "\"\"") + "\"";
	}

	private static String physicalIdentifier(String name) {
		return quoteIdentifier(physicalName(name));
	}

	private static String columnReference(String alias, String quotedColumn) {
		return quoteIdentifier(alias) + "." + quotedColumn;
	}

	private String classIdentifier(String namespace, String className) {
		return physicalIdentifier(sandboxClassName(namespace, className));
	}

	@Override
	public String sandboxClassName(String sandboxId, String className) {
		if (sandboxTarget != null) return sandboxTarget.classTable(className);
		return inSandbox(sandboxId) ? sandboxId + className : className;
	}

	@Override
	public String sandboxObjectId(String sandboxId, String objectId) {
		return objectId;
	}

	@Override
	public void validateClassNameFormat(String className) throws Exception {
	}

	@Override
	public JSONObject createRecordedClass(String namespace, Map<String, Object> definition) {
		String className = (String) definition.get("className");
		createClass(namespace, definition);
		try (var connection = openConnection(); var statement = connection.prepareStatement(
				"SELECT c.relname,n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=to_regclass(?)")) {
			statement.setString(1, classIdentifier(namespace, className));
			try (var rows = statement.executeQuery()) {
				if (!rows.next()) {
					throw sandboxClassFailure(className, "PostgreSQL did not identify the created table", null);
				}
				return JSONObject.of("kind", "table", "name", rows.getString(1), "schema", rows.getString(2));
			}
		} catch (SQLException failure) {
			throw sandboxClassFailure(className, databaseReason(failure), failure);
		}
	}

	@Override
	public void validateSandboxClasses(String namespace, List<Map<String, Object>> classes) {
		var names = new HashMap<String, String>();
		for (var cls : classes) {
			String className = (String) cls.get("className");
			try {
				String table = classIdentifier(namespace, className);
				String previous = names.putIfAbsent(table, className);
				if (previous != null) {
					throw new IllegalArgumentException("table name also resolves to class [" + previous + "]");
				}
				var columns = new HashMap<String, String>();
				for (var attribute : (List<Map<String, Object>>) cls.get("attrs")) {
					if (Boolean.FALSE.equals(attribute.get("enable"))) continue;
					String field = (String) attribute.get("name");
					validateSandboxColumn(columns, field);
				}
			} catch (IllegalArgumentException failure) {
				throw sandboxClassFailure(className, failure.getMessage(), failure);
			}
		}
	}

	private static void validateSandboxColumn(Map<String, String> columns, String field) {
		String column;
		try {
			column = physicalIdentifier(field);
		} catch (IllegalArgumentException failure) {
			throw new IllegalArgumentException("attribute [" + field + "]: " + failure.getMessage(), failure);
		}
		String previous = columns.putIfAbsent(column, field);
		if (previous != null) {
			throw new IllegalArgumentException("attributes [" + previous + "] and [" + field + "] resolve to the same column");
		}
	}

	@Override
	public boolean supportsSandbox() {
		return true;
	}

	@Override
	public void createNamespace(String namespace) {
	}

	@Override
	public void truncateNamespace(String namespace) {
		clearNamespace(namespace, "delete from ");
	}

	@Override
	public void dropNamespace(String namespace) {
		clearNamespace(namespace, "drop table ");
	}

	private void clearNamespace(String namespace, String command) {
		try {
			var tables = querySql("SELECT table_schema, table_name FROM information_schema.tables"
					+ " WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'");
			String prefix = namespace == null ? "" : physicalName(namespace);
			for (var entry : tables.toJavaList(JSONObject.class)) {
				String table = entry.getString("table_name");
				if (table.startsWith(prefix)) {
					executeSql(command + recordedTable(entry.getString("table_schema"), table));
				}
			}
		} catch (Exception failure) {
			throw new IllegalStateException("Sandbox structure operation failed: " + failure.getMessage(), failure);
		}
	}

	private static String recordedTable(String schema, String table) {
		return quoteIdentifier(schema) + "." + quoteIdentifier(table);
	}

	@Override
	public void dropRecordedResource(JSONObject resource) {
		if (!"table".equals(resource.getString("kind"))) {
			throw new IllegalArgumentException("Unknown sandbox resource: " + resource);
		}
		try {
			executeSql("drop table if exists " + (resource.getString("schema") == null ? quoteIdentifier(resource.getString("name"))
					: recordedTable(resource.getString("schema"), resource.getString("name"))));
		} catch (Exception failure) {
			throw new IllegalStateException("Cannot drop recorded sandbox table: " + resource, failure);
		}
	}

	static String columnType(String type) {
		return switch (type) {
			case "varchar" -> "varchar(200)";
			case "text" -> "text";
			case "int" -> "int4";
			case "long" -> "int8";
			case "float" -> "float4";
			case "double" -> "float8";
			case "boolean" -> "boolean";
			case "date" -> "date";
			case "timestamp", "datetime" -> "timestamp";
			case "vector" -> "text";
			default -> throw new IllegalArgumentException("Unsupported attribute type: " + type);
		};
	}

	@Override
	public void createClass(String namespace, Map<String, Object> classDef) {
		String className = (String) classDef.get("className");
		try {
			String fullClassName = classIdentifier(namespace, className);
			List<Map<String, Object>> attrs = (List<Map<String, Object>>) classDef.get("attrs");
			List<String> fields = new ArrayList<String>();
			if (attrs != null) {
				for (Map<String, Object> attr : attrs) {
					if (attr.get("enable") == null || (Boolean)attr.get("enable")) {
						String name = (String) attr.get("name");
						fields.add(physicalIdentifier(name) + " " + columnType((String) attr.get("type")));
					}
				}
			}

			StringBuilder sql = new StringBuilder();
			sql.append("create table ").append(fullClassName).append(" ( \n");
			for (int i = 0; i < fields.size(); i++) {
				String field = fields.get(i);
				sql.append(" ").append(field).append(" " + (i == fields.size() - 1 ? "" : ",") + "\n");
			}
			sql.append(" );");
			executeSql(sql.toString());
		} catch (SQLException failure) {
			throw sandboxClassFailure(className, databaseReason(failure), failure);
		} catch (IllegalArgumentException failure) {
			throw sandboxClassFailure(className, failure.getMessage(), failure);
		}
	}

	private static IllegalArgumentException sandboxClassFailure(String className, String reason, Throwable cause) {
		return new IllegalArgumentException("Cannot create sandbox for class [" + className + "]: " + reason, cause);
	}

	private static String databaseReason(SQLException failure) {
		for (Throwable cause : failure) {
			if (cause instanceof PSQLException pg && pg.getServerErrorMessage() != null) {
				return pg.getServerErrorMessage().getMessage();
			}
		}
		return "PostgreSQL operation failed (SQLSTATE " + failure.getSQLState() + ")";
	}

	/**
	 * Create the physical carrier of one relationship.
	 *
	 * <p>Only an {@code n:n} relationship needs one: its junction table is the thing the ontology
	 * relationship is stored in, and a data source that starts from nothing has no such table yet.
	 * An {@code fk} relationship is a column that already belongs to a class, and a {@code graph}
	 * relationship is an edge this source kind cannot store — neither has anything to create here,
	 * which is why this method stays silent for both instead of inventing a table.</p>
	 *
	 * <p>Idempotent on purpose: the environment build drops the namespace and creates every class and
	 * relationship again, so an interrupted run must be able to repeat itself.</p>
	 */
	@Override
	public void createEdgeType(String namespace, String edgeName) {
		Map<String, Object> relationshipRule = (Map<String, Object>) jsonRule.get("relationship_rule");
		OntologyRelation rel = OntologyRelation.of(edgeName, relationshipRule.get(edgeName),
				"relationship_rule[" + edgeName + "]");
		if (!rel.junction()) {
			return;
		}
		try {
			String table = junctionTable(namespace, rel);
			executeSql("create table if not exists " + table + " (\n"
					+ " " + physicalIdentifier(rel.linkTableFromField()) + " " + joinColumnType(rel.fromClass(), rel.fromField()) + ",\n"
					+ " " + physicalIdentifier(rel.linkTableToField()) + " " + joinColumnType(rel.toClass(), rel.toField()) + "\n"
					+ ");");
		} catch (SQLException failure) {
			throw sandboxClassFailure(rel.fromClass(), "relationship [" + edgeName + "]: " + databaseReason(failure), failure);
		} catch (IllegalArgumentException failure) {
			throw sandboxClassFailure(rel.fromClass(), "relationship [" + edgeName + "]: " + failure.getMessage(), failure);
		}
	}

	/** The SQL type of a class's join column, so a junction column holds the same values its end does. */
	private String joinColumnType(String className, String fieldName) {
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		for (Map<String, Object> classDef : classDefs) {
			if (!className.equals(classDef.get("className"))) {
				continue;
			}
			List<Map<String, Object>> attrs = (List<Map<String, Object>>)classDef.get("attrs");
			if (attrs == null) {
				break;
			}
			for (Map<String, Object> attr : attrs) {
				if (!fieldName.equals(attr.get("name"))) {
					continue;
				}
				return columnType((String) attr.get("type"));
			}
		}
		return "varchar(200)";
	}

	@Override
	public void insertObjects(String namespace, Map<String, Object> classDef, JSONArray objs) throws Exception {
		SimpleDateFormat ymd = new SimpleDateFormat("yyyy-MM-dd");
		SimpleDateFormat ymdhms = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");

		String fullClassName = classIdentifier(namespace, (String) classDef.get("className"));

		// Field list
		int idIndex = -1;
		List<String> fields = new ArrayList<String>();
		Map<String, String> attrTypeMap = new HashMap<String, String>();
		if (classDef.get("attrs") != null) {
			List<Map<String, Object>> attrDefs = (List<Map<String, Object>>)classDef.get("attrs");
			for (Map<String, Object> attrDef : attrDefs) {
				if (attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) {
					if (attrDef.get("primaryKey") != null && (Boolean)attrDef.get("primaryKey")) {
						idIndex = fields.size();
					}
					fields.add((String)attrDef.get("name"));
					attrTypeMap.put((String)attrDef.get("name"), (String)attrDef.get("type"));
				}
			}
		}

		if (idIndex >= 0) {
			String pk = fields.get(idIndex);

			List<String> sqls = new ArrayList<String>();
			for (int i = 0; i < objs.size(); i++) {
				JSONObject obj = objs.getJSONObject(i);
				if (obj.get(pk) == null || "".equals(obj.getString(pk).trim())) {
					throw new Exception("The insert statement must contain the primary key [" + pk + "] field");
				}

				// Build mql: insert into /aaa/bbb(f1,f2,...) values(?,?,...)
				StringBuilder sql = new StringBuilder();
				sql.append("insert into ").append(fullClassName).append("(");
				sql.append(fields.stream().map(PostgreAdapter::physicalIdentifier).collect(Collectors.joining(",")));
				sql.append(") values(");
				for (int j = 0; j < fields.size(); j++) {
					if (j > 0) {
						sql.append(",");
					}
					String type = attrTypeMap.get(fields.get(j));
					Object value = obj.get(fields.get(j));
					if (value != null) {
						sql.append(toSqlValue(type, value, ymd, ymdhms));
					} else {
						sql.append("null");
					}
				}
				sql.append(")");

				sqls.add(sql.toString());
			}
			executeSql(sqls);
		} else {
			throw new Exception("The insert statement must contain the primary key field");
		}
	}

	private boolean inSandbox(String sandboxId) {
		return sandboxId != null && !"".equals(sandboxId.trim());
	}

	@Override
	public void updateObjects(String namespace, Map<String, Object> classDef, JSONObject setValues, JSONObject where)
			throws Exception {
		SimpleDateFormat ymd = new SimpleDateFormat("yyyy-MM-dd");
		SimpleDateFormat ymdhms = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");

		String fullClassName = classIdentifier(namespace, (String) classDef.get("className"));

		// Field list
		Map<String, String> attrTypeMap = new HashMap<String, String>();
		String pk = null;
		if (classDef.get("attrs") != null) {
			List<Map<String, Object>> attrDefs = (List<Map<String, Object>>)classDef.get("attrs");
			for (Map<String, Object> attrDef : attrDefs) {
				if (attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) {
					if (attrDef.get("primaryKey") != null && (Boolean)attrDef.get("primaryKey")) {
						pk = (String)attrDef.get("name");
					}
					attrTypeMap.put((String)attrDef.get("name"), (String)attrDef.get("type"));
				}
			}
		}

		String setStr = "";
		for (String key : setValues.keySet()) {
			if (key.equals(pk)) {
				throw new Exception("Updating the primary key [" + pk + "] field is not allowed");
			}
			String type = attrTypeMap.get(key);
			if (type != null) {
				Object value = setValues.get(key);
				setStr += physicalIdentifier(key) + " = ";
				if (value != null) {
					setStr += toSqlValue(type, value, ymd, ymdhms);
				} else {
					setStr += "null";
				}
				setStr += ",";
			} else {
				throw new Exception("Field [" + key + "] does not exist");
			}
		}
		if (setStr.length() > 0) {
			setStr = setStr.substring(0, setStr.length() - 1);
		}
		String sql = "update " + fullClassName + " set " + setStr;
		String whereStr = generateWhere(where, attrTypeMap, ymd, ymdhms);
		if (!"".equals(whereStr.trim())) {
			sql += " where " + whereStr;
		}

		executeSql(sql);
	}

	private String generateWhere(JSONObject condition, Map<String, String> attrTypeMap, SimpleDateFormat ymd, SimpleDateFormat ymdhms) throws Exception {
		String whereStr = "";
	    if (condition != null) {
	        whereStr = buildWhere(condition, true, attrTypeMap, ymd, ymdhms);
	    }
	    return whereStr;
	}

	/**
	 * Recursively build the where fragment
	 * @param condition   condition JSON (single-attribute condition or logic condition)
	 * @param topLevel    whether this is the top level (no parentheses at the top level, parentheses for nested logic)
	 */
	private String buildWhere(JSONObject condition, boolean topLevel, Map<String, String> attrTypeMap, SimpleDateFormat ymd, SimpleDateFormat ymdhms) throws Exception {
        if (topLevel) io.ontomato.dataengine.util.WriteWhereValidator.validate(condition, attrTypeMap::containsKey);
	    String operator = condition.getString("operator");
	    if (operator == null) {
	    	operator = "";
	    }

	    // Multi-attribute condition (logic)
	    if (condition.getJSONArray("and") != null && condition.getJSONArray("and").size() > 0 || condition.getJSONArray("or") != null && condition.getJSONArray("or").size() > 0) {
	        String connector;
	        JSONArray list;
	        if (condition.containsKey("and")) {
	            connector = " and ";
	            list = condition.getJSONArray("and");
	        } else if (condition.containsKey("or")) {
	            connector = " or ";
	            list = condition.getJSONArray("or");
	        } else {
	            throw new IllegalArgumentException("Invalid where condition: " + condition);
	        }
	        List<String> parts = new ArrayList<String>();
	        for (int i = 0; i < list.size(); i++) {
	            parts.add(buildWhere(list.getJSONObject(i), false, attrTypeMap, ymd, ymdhms));
	        }
	        String joined = String.join(connector, parts);
	        return topLevel ? joined : "(" + joined + ")";
	    }

	    // Single-attribute condition
	    String field = condition.getString("field");
	    String type = attrTypeMap.get(field);
	    String column = physicalIdentifier(field);
	    switch (operator) {
	        case "=":
	        case "!=":
	        case ">":
	        case ">=":
	        case "<":
	        case "<=":
	        case "like":
	        	Object value = condition.get("value");
	        	String valueSql = toSqlValue(type, value, ymd, ymdhms);
	            return column + " " + operator + " " + valueSql;
	        case "between":
	            JSONArray betweenArr = condition.getJSONArray("value");
	            return column + " between " + toSqlValue(type, betweenArr.get(0), ymd, ymdhms) + " and " + toSqlValue(type, betweenArr.get(1), ymd, ymdhms);
	        case "in":
	        	JSONArray vs = condition.getJSONArray("value");
	        	String inValue = "(";
	        	for (int i = 0; i < vs.size(); i++) {
	        		inValue += toSqlValue(type, vs.get(i), ymd, ymdhms) + (i == vs.size() - 1 ? ")" : ",");
	        	}
	            return column + " in " + inValue;
	        case "is":
	            return column + " is null";
	        case "is not":
	            return column + " is not null";
	        default:
	            throw new IllegalArgumentException("Invalid where condition: " + condition);
	    }
	}

	/** A time condition value is passed through verbatim: the source's own time convention is never re-interpreted. */
	private static String timeLiteral(Object value) {
		return "'" + String.valueOf(value).replace("'", "''") + "'";
	}

	private static final DateTimeFormatter TEMPORAL_TEXT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

	/** A temporal column is a date/time type, returned as its own text rather than re-rendered in the process zone. */
	private static boolean isTemporalColumn(int sqlType) {
		return sqlType == Types.DATE || sqlType == Types.TIME || sqlType == Types.TIMESTAMP
				|| sqlType == Types.TIME_WITH_TIMEZONE || sqlType == Types.TIMESTAMP_WITH_TIMEZONE;
	}

	/**
	 * The source's own text for a temporal column: a naive value keeps its wall clock, a tz-aware value
	 * keeps its offset, and the process zone is never applied. A driver without the typed read falls
	 * back to its own string form.
	 */
	private static Object temporalValue(ResultSet rs, int i, int sqlType) throws SQLException {
		try {
			switch (sqlType) {
				case Types.DATE: {
					LocalDate d = rs.getObject(i, LocalDate.class);
					return d == null ? null : d.toString();
				}
				case Types.TIME: {
					LocalTime t = rs.getObject(i, LocalTime.class);
					return t == null ? null : t.toString();
				}
				case Types.TIMESTAMP: {
					LocalDateTime dt = rs.getObject(i, LocalDateTime.class);
					return dt == null ? null : dt.format(TEMPORAL_TEXT);
				}
				default: {
					OffsetDateTime odt = rs.getObject(i, OffsetDateTime.class);
					return odt == null ? null : odt.toString();
				}
			}
		} catch (SQLException e) {
			return rs.getString(i);
		}
	}

	private static String booleanLiteral(Object value) {
		return ((Boolean) value).toString();
	}

	private String toSqlValue(String type, Object value, SimpleDateFormat ymd, SimpleDateFormat ymdhms) throws Exception {
		String valueSql = "";
		if ("varchar".equals(type) || "text".equals(type) || "vector".equals(type)) {
			String strValue = "vector".equals(type) && value != null && !(value instanceof String)
					? JSON.toJSONString(value) : (String)value;
            valueSql = "'" + strValue.replace("'", "''") + "'";
		} else if ("int".equals(type) || "long".equals(type) || "float".equals(type) || "double".equals(type)) {
			valueSql = value + "";
		} else if ("boolean".equals(type)) {
			valueSql = booleanLiteral(value);
		} else if ("date".equals(type)) {
			try {
				valueSql = "'" + ymd.format(ymd.parse((String)value)) + "'";
			} catch (Exception e) {
				log.error(e.getMessage(), e);
				throw new Exception("Invalid format for a date field, expected yyyy-MM-dd");
			}
		} else if ("timestamp".equals(type) || "datetime".equals(type)) {
			try {
				valueSql = "'" + ymdhms.format(ymdhms.parse((String)value)) + "'";
			} catch (Exception e) {
				log.error(e.getMessage(), e);
				throw new Exception("Invalid format for a timestamp field, expected yyyy-MM-dd HH:mm:ss");
			}
		}
		return valueSql;
	}

	@Override
	public void deleteObjects(String namespace, Map<String, Object> classDef, JSONObject where) throws Exception {
		SimpleDateFormat ymd = new SimpleDateFormat("yyyy-MM-dd");
		SimpleDateFormat ymdhms = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");

		String fullClassName = classIdentifier(namespace, (String) classDef.get("className"));

		Map<String, String> attrTypeMap = new HashMap<String, String>();
		if (classDef.get("attrs") != null) {
			List<Map<String, Object>> attrDefs = (List<Map<String, Object>>)classDef.get("attrs");
			for (Map<String, Object> attrDef : attrDefs) {
				if (attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) {
					attrTypeMap.put((String)attrDef.get("name"), (String)attrDef.get("type"));
				}
			}
		}

		String sql = "delete from " + fullClassName;
		String whereStr = generateWhere(where, attrTypeMap, ymd, ymdhms);
		if (!"".equals(whereStr.trim())) {
			sql += " where " + whereStr;
		}

		executeSql(sql);
	}

	@Override
	public void createEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
			String targetClassName, String targetObjId) throws Exception {
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		Map<String, Object> relationship_rule = (Map<String, Object>)jsonRule.get("relationship_rule");
		Map<String, Object> sourceClassDef = null;
		Map<String, Object> targetClassDef = null;
		for (Map<String, Object> classDef : classDefs) {
			if (classDef.get("className").equals(sourceClassName)) {
				sourceClassDef = classDef;
			}
			if (classDef.get("className").equals(targetClassName)) {
				targetClassDef = classDef;
			}
		}
		OntologyRelation rel = OntologyRelation.of(relationName, relationship_rule.get(relationName),
				"relationship_rule[" + relationName + "]");

		if (sourceClassDef == null || targetClassDef == null || !rel.fromEnd(sourceClassName)
				|| !rel.toClass().equals(targetClassName)) {
			throw new Exception("Object class [" + sourceClassName + "] and object class [" + targetClassName + "] have no relationship definition [" + relationName + "]");
		}
		if (rel.junction()) {
			// One semantic edge is one junction row; the two classes themselves are never touched.
			insertJunctionRow(namespace, rel, sourceObjId, targetObjId);
			return;
		}
		if (!rel.usesKeyFields()) {
			throw new UnsupportedDataAdapterOperationException("postgresql",
					"an edge stored as a graph relationship; relationship [" + relationName + "] declares type '"
							+ rel.kind() + "' but this source stores edges as key columns");
		}

		String sourcePk = DslUtil.getPrimaryKey(sourceClassDef);
		String targetPk = DslUtil.getPrimaryKey(targetClassDef);
		String sourceInnerField = rel.fromField();
		String targetInnerField = rel.toField();

		String sql = null;
		if (sourcePk.equals(sourceInnerField)) {
			if (targetPk.equals(targetInnerField)) {
				// Both join fields are the classes' own primary keys: a 1:1 link where the two rows share
				// one key value. Nothing to write — the connection IS the equal key. Deliberately not a gap.
				return;
			} else {
				String fullClassName = classIdentifier(namespace, targetClassName);
				sql = "update " + fullClassName + " set " + physicalIdentifier(targetInnerField) + " = " + toSqlValue("varchar", sourceObjId, null, null) + " where " + physicalIdentifier(targetPk) + " = " + toSqlValue("varchar", targetObjId, null, null);
			}
		} else {
			if (targetPk.equals(targetInnerField)) {
				String fullClassName = classIdentifier(namespace, sourceClassName);
				sql = "update " + fullClassName + " set " + physicalIdentifier(sourceInnerField) + " = " + toSqlValue("varchar", targetObjId, null, null) + " where " + physicalIdentifier(sourcePk) + " = " + toSqlValue("varchar", sourceObjId, null, null);
			} else {
				// Neither end is a primary key: there is no column that can carry this connection, so a
				// junction table is the only realization. Declaring type 'fk' therefore made the
				// relationship unexecutable, and saying so beats silently writing nothing.
				throw new DslContractViolationException(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
						"relationship_rule[" + relationName + "]",
						"relationship [" + relationName + "] joins two non-key fields (" + sourceInnerField + ", "
								+ targetInnerField + "), which needs a junction table; declare it as n:n with a linkTable");
			}
		}

		if (sql != null) {
			executeSql(sql);
		}
	}

	/** Insert one junction row, or leave it alone when this exact pairing is already recorded. */
	private void insertJunctionRow(String namespace, OntologyRelation rel, String sourceObjId, String targetObjId)
			throws Exception {
		String table = junctionTable(namespace, rel);
		String sql = "insert into " + table + " (" + physicalIdentifier(rel.linkTableFromField()) + ", " + physicalIdentifier(rel.linkTableToField()) + ")"
				+ " select " + toSqlValue("varchar", sourceObjId, null, null) + ", "
				+ toSqlValue("varchar", targetObjId, null, null)
				+ " where not exists (select 1 from " + table + " where " + physicalIdentifier(rel.linkTableFromField()) + " = "
				+ toSqlValue("varchar", sourceObjId, null, null) + " and " + physicalIdentifier(rel.linkTableToField()) + " = "
				+ toSqlValue("varchar", targetObjId, null, null) + ")";
		executeSql(sql);
	}

	/**
	 * The junction table name as the read path must spell it.
	 *
	 * <p>A sandbox run prefixes every class table with the namespace before the DSL reaches this
	 * adapter, and the junction table has to follow the same rule or the query would read the
	 * production junction. The prefix is recovered from a class definition rather than passed in,
	 * because the read path receives the already-rewritten names and nothing else.</p>
	 */
	private String junctionTableName(OntologyRelation rel) {
		if (sandboxTarget != null) return physicalIdentifier(sandboxTarget.edgeTable(rel.name()));
		String prefix = "";
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		if (classDefs != null) {
			for (Map<String, Object> classDef : classDefs) {
				String className = (String)classDef.get("className");
				if (className != null && rel.fromClass() != null && className.endsWith(rel.fromClass())
						&& !className.equals(rel.fromClass())) {
					prefix = className.substring(0, className.length() - rel.fromClass().length());
					break;
				}
			}
		}
		return classIdentifier(prefix, rel.linkTable());
	}

	/**
	 * Whether a class name as the DSL carries it names the given ontomap class. A sandbox run rewrites
	 * every class name with the namespace prefix before the DSL reaches this adapter, so the comparison
	 * cannot be plain equality.
	 */
	private boolean classMatches(String dslClassName, String ontoClassName) {
		if (sandboxTarget != null) return dslClassName.equals(sandboxTarget.classTable(ontoClassName));
		if (ontoClassName == null) {
			return false;
		}
		if (ontoClassName.equals(dslClassName)) {
			return true;
		}
		return dslClassName != null && dslClassName.endsWith(ontoClassName);
	}

	/** The junction table's physical name: it follows the same namespace rule as a class's table. */
	private String junctionTable(String namespace, OntologyRelation rel) {
		if (sandboxTarget != null) return physicalIdentifier(sandboxTarget.edgeTable(rel.name()));
		return classIdentifier(namespace, rel.linkTable());
	}

	@Override
	public void deleteEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
			String targetClassName, String targetObjId) throws Exception {
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		Map<String, Object> relationship_rule = (Map<String, Object>)jsonRule.get("relationship_rule");
		Map<String, Object> sourceClassDef = null;
		Map<String, Object> targetClassDef = null;
		for (Map<String, Object> classDef : classDefs) {
			if (classDef.get("className").equals(sourceClassName)) {
				sourceClassDef = classDef;
			}
			if (classDef.get("className").equals(targetClassName)) {
				targetClassDef = classDef;
			}
		}
		OntologyRelation rel = OntologyRelation.of(relationName, relationship_rule.get(relationName),
				"relationship_rule[" + relationName + "]");

		if (sourceClassDef == null || targetClassDef == null || !rel.fromEnd(sourceClassName)
				|| !rel.toClass().equals(targetClassName)) {
			throw new Exception("Object class [" + sourceClassName + "] and object class [" + targetClassName + "] have no relationship definition [" + relationName + "]");
		}
		if (rel.junction()) {
			String table = junctionTable(namespace, rel);
			executeSql("delete from " + table + " where " + physicalIdentifier(rel.linkTableFromField()) + " = "
					+ toSqlValue("varchar", sourceObjId, null, null) + " and " + physicalIdentifier(rel.linkTableToField()) + " = "
					+ toSqlValue("varchar", targetObjId, null, null));
			return;
		}
		if (!rel.usesKeyFields()) {
			throw new UnsupportedDataAdapterOperationException("postgresql",
					"an edge stored as a graph relationship; relationship [" + relationName + "] declares type '"
							+ rel.kind() + "' but this source stores edges as key columns");
		}

		String sourcePk = DslUtil.getPrimaryKey(sourceClassDef);
		String targetPk = DslUtil.getPrimaryKey(targetClassDef);
		String sourceInnerField = rel.fromField();
		String targetInnerField = rel.toField();

		String sql = null;
		if (sourcePk.equals(sourceInnerField)) {
			if (targetPk.equals(targetInnerField)) {
				// A 1:1 shared key: the connection is the equal key value, so there is no column to clear.
				return;
			} else {
				String fullClassName = classIdentifier(namespace, targetClassName);
				sql = "update " + fullClassName + " set " + physicalIdentifier(targetInnerField) + " = null where " + physicalIdentifier(targetPk) + " = " + toSqlValue("varchar", targetObjId, null, null);
			}
		} else {
			if (targetPk.equals(targetInnerField)) {
				String fullClassName = classIdentifier(namespace, sourceClassName);
				sql = "update " + fullClassName + " set " + physicalIdentifier(sourceInnerField) + " = null where " + physicalIdentifier(sourcePk) + " = " + toSqlValue("varchar", sourceObjId, null, null);
			} else {
				throw new DslContractViolationException(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
						"relationship_rule[" + relationName + "]",
						"relationship [" + relationName + "] joins two non-key fields (" + sourceInnerField + ", "
								+ targetInnerField + "), which needs a junction table; declare it as n:n with a linkTable");
			}
		}

		if (sql != null) {
			executeSql(sql);
		}
	}

	private void executeSql(String sql) throws SQLException {
		List<String> sqls = new ArrayList<String>();
		sqls.add(sql);
		executeSql(sqls);
	}

	private void executeSql(List<String> sqls) throws SQLException {
		Connection conn = null;
		Statement st = null;

		try {
			conn = openConnection();
			conn.setAutoCommit(false);
			st = conn.createStatement();
			for (String sql : sqls) {
				st.addBatch(sql);
			}
			st.executeBatch();
			conn.commit();
		} catch (SQLException e) {
			if (conn != null) {
				try {
					conn.rollback();
				} catch (Exception e1) {
					log.error(e1.getMessage(), e1);
				}
			}
			throw e;
		} finally {
			if (st != null) {
				try { st.close(); } catch (Exception e) { log.error(e.getMessage(), e); }
			}
			if (conn != null) {
				try { conn.close(); } catch (Exception e) { log.error(e.getMessage(), e); }
			}
		}
	}

	@Override
	public JSONArray queryVectorAttr(Map<String, Object> classDef, String attrName, String objectId) throws Exception {
		String fullClassName = (String) classDef.get("className");
		String pk = DslUtil.getPrimaryKey(classDef);
		String sql = "select " + physicalIdentifier(attrName) + " from " + physicalIdentifier(fullClassName)
				+ " where " + physicalIdentifier(pk) + " = '" + objectId.replace("'", "''") + "'";
		JSONArray rows = querySql(sql);
		if (rows == null || rows.isEmpty()) {
			throw new IllegalArgumentException("Object " + objectId + " of class " + fullClassName + " does not exist");
		}
		Object value = rows.getJSONObject(0).get(physicalName(attrName));
		return DslUtil.parseVectorAttr(value);
	}

	@Override
	public Map<String, Object> query(JSONObject dsl, String sandboxId, String domainId, VectorResourceDao vectorResourceDao, DataRagConfig dataRagConfig) throws Exception {
		boolean inSandbox = inSandbox(sandboxId);

		UserDataPermission userDataPermission = new UserDataPermission();
		JSONArray dsls = new JSONArray();
    	dsls.add(dsl);
    	List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		String dslStr = DslUtil.normalizeClassNames(JSONArray.toJSONString(dsls, Feature.WriteMapNullValue), classDefs);
		dslStr = DslUtil.setConditionTimeColumnToCorrectFormat(dslStr, dataRagConfig.getDslMightTimeFormats(), classDefs, timeConditionsAsEpochMillis(), timeConditionZone());

		JSONObject dataMap = new JSONObject();
		DslExecutionResult result = null;
		JSONObject data = null;
		if (inSandbox) { // Handle the logic of appending sandboxId to class names in the DSL
			classDefs = sandboxClasses(classDefs);
			jsonRule.put("classDef", classDefs);
			for (Map<String, Object> classDef : classDefs) {
				String className = sandboxClassName(sandboxId, (String) classDef.get("className"));
				classDef.put("className", className);
			}
			String sandboxDslStr = rewriteSandboxDsl(dslStr, sandboxId);
			result = HttpRequestUtil.executeDsl(dataRagConfig, this, sandboxDslStr, null, true, jsonRule, vectorResourceDao, userDataPermission, DslExecutionMode.OPTIMIZED, domainId)[1];
			data = result.data();
		} else {
			result = HttpRequestUtil.executeDsl(dataRagConfig, this, dslStr, null, true, jsonRule, vectorResourceDao, userDataPermission, DslExecutionMode.OPTIMIZED, domainId)[1];
			data = result.data();
		}

		dataMap.putAll(data);
		if (result.failed()) {
			dataMap.put("error", ErrorText.queryError(result.failure().cause()));
		}
		return dataMap;
	}

}
