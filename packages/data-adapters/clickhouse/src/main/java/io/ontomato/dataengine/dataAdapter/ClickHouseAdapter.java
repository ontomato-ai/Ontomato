package io.ontomato.dataengine.dataAdapter;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Types;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.DslExecutionResult;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DslUtil;
import io.ontomato.dataengine.util.HttpRequestUtil;

import lombok.extern.slf4j.Slf4j;

/**
 * ClickHouse object-graph adapter.
 *
 * <p>ClickHouse has no schema or row-level UPDATE/DELETE: a namespace is a table-name prefix in the
 * current database, and every update/delete is an {@code ALTER TABLE ... UPDATE/DELETE} mutation
 * executed with {@code mutations_sync = 2} so the caller observes it immediately.</p>
 */
@Slf4j
public class ClickHouseAdapter implements DataAdapter {

	private static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd");
	private static final DateTimeFormatter TIMESTAMP_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

	private DataAdapterConnection connection;
	private Map<String, Object> jsonRule;

	public ClickHouseAdapter(DataAdapterConnection connection, Map<String, Object> jsonRule) {
		this.connection = connection;
		this.jsonRule = jsonRule;
	}

	@Override
	public Connection openConnection() throws SQLException {
		return DriverManager.getConnection(
				connection.getUrl(),
				connection.getUser(),
				connection.getPassword());
	}

	@Override
	public String executeDsl(String queryJson, String sessionId, DslExecutionMode mode, List<String> generatedMqls) throws Exception {
		log.debug("[{}] DSL to query ClickHouse: {}", sessionId, queryJson);
		JSONArray dsls = JSONArray.parseArray(queryJson);
		DslRowLimit.Tracker rowLimit = new DslRowLimit.Tracker();
		String sql = toSql(dsls.getJSONObject(0), jsonRule, rowLimit);
		generatedMqls.add(sql);
		log.debug("[{}] Converted ClickHouse sql: {}", sessionId, sql);
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

	private String toSql(JSONObject dsl, Map<String, Object> jsonRule, DslRowLimit.Tracker rowLimit) throws Exception {
		try {
			@SuppressWarnings("unchecked")
			List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
			Map<String, Map<String, String>> classAttrTypeMap = new HashMap<>();
			Map<String, Set<String>> classEnableAttrsMap = new HashMap<>();
			for (Map<String, Object> classDef : classDefs) {
				Map<String, String> attrTypeMap = new HashMap<>();
				Set<String> enableAttrs = new HashSet<>();
				@SuppressWarnings("unchecked")
				List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
				for (Map<String, Object> attrDef : attrDefs) {
					attrTypeMap.put((String) attrDef.get("name"), (String) attrDef.get("type"));
					if (attrDef.get("enable") == null || (Boolean) attrDef.get("enable")) {
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
						JSONObject properties = conditions.getJSONObject("properties");
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
									newQueue.add(new Object[] { ands.getJSONObject(j), null });
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
									newQueue.add(new Object[] { ors.getJSONObject(j), null });
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
								objWhere += renderLeaf(cond, alias, attrTypeMap);
							}
						}
					}
					if (conditions.getJSONObject("text") != null) {
						JSONObject text = conditions.getJSONObject("text");
						if (text.getString("query") != null && !"".equals(text.getString("query").trim())) {
							String textWhere = "";
							String query = text.getString("query").trim();
							if (!query.startsWith("%") && !query.endsWith("%")) {
								query = "%" + query + "%";
							}
							boolean first = true;
							Set<String> enableAttrs = classEnableAttrsMap.get(className);
							if (enableAttrs != null) {
								for (String enableAttr : enableAttrs) {
									String type = attrTypeMap.get(enableAttr);
									if ("varchar".equals(type) || "text".equals(type)) {
										if (!first) {
											textWhere += " or ";
										}
										textWhere += column(alias, enableAttr) + " like " + literal(query);
										first = false;
									}
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
							@SuppressWarnings("unchecked")
							Map<String, Object> relationDef = (Map<String, Object>) relationship_rule
									.get(relationshipName);
							if (relationDef == null) {
								throw new DslContractViolationException(
										DslContractViolationException.Code.INVALID_GRAMMAR,
										"steps[0].graph.patterns[0].relationship",
										"relationship '" + relationshipName + "' has no relationship_rule entry");
							}
							String fromField = (String) relationDef.get("fromField");
							String toField = (String) relationDef.get("toField");
							if (fromField == null || toField == null) {
								throw new DslContractViolationException(
										DslContractViolationException.Code.UNSUPPORTED_JOIN_ARITY,
										"relationship_rule." + relationshipName,
										"the relationship needs fromField/toField for this engine");
							}
							if (inJoinIdxs.isEmpty()) {
								innerJoinSqls.add(join(joinSource(fromClassAlias), toClassAlias[0], toClassAlias[1],
										fromClassAlias[1], fromField, toClassAlias[1], toField));
								inJoinIdxs.add(fromIdx);
								inJoinIdxs.add(toIdx);
								innerJoinClassesList.add(new HashSet<>(inJoinIdxs));
								inJoinRelIndexes.add(i);
							} else if (inJoinIdxs.contains(fromIdx) && !inJoinIdxs.contains(toIdx)) {
								innerJoinSqls.add("inner join " + tableAlias(toClassAlias[0], toClassAlias[1])
										+ " on " + column(fromClassAlias[1], fromField) + " = "
										+ column(toClassAlias[1], toField));
								inJoinIdxs.add(toIdx);
								innerJoinClassesList.add(new HashSet<>(inJoinIdxs));
								inJoinRelIndexes.add(i);
							} else if (!inJoinIdxs.contains(fromIdx) && inJoinIdxs.contains(toIdx)) {
								innerJoinSqls.add("inner join " + tableAlias(fromClassAlias[0], fromClassAlias[1])
										+ " on " + column(fromClassAlias[1], fromField) + " = "
										+ column(toClassAlias[1], toField));
								inJoinIdxs.add(fromIdx);
								innerJoinClassesList.add(new HashSet<>(inJoinIdxs));
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
										innerJoinSqls.get(innerJoinSqlIndex) + " and "
												+ column(fromClassAlias[1], fromField) + " = "
												+ column(toClassAlias[1], toField));
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
				subSelectFrom = tableAlias(objects.getJSONObject(0).getString("class"),
						objects.getJSONObject(0).getString("variable"));
			}

			String subSelectSelect = "";
			JSONArray outputFields = firstStep.getJSONObject("output").getJSONArray("fields");
			boolean hadDistinct = false;
			for (int i = 0; i < outputFields.size(); i++) {
				JSONObject field = outputFields.getJSONObject(i);
				String colSql = "";
				if (field.getString("function") != null && !"".equals(field.getString("function").trim())) {
					colSql = field.getString("function") + "("
							+ (Boolean.TRUE.equals(field.getBoolean("distinct")) ? "distinct " : "")
							+ column(field.getString("variable"), field.getString("field")) + ")";
				} else {
					if (hadDistinct) {
						colSql = column(field.getString("variable"), field.getString("field"));
					} else {
						if (Boolean.TRUE.equals(field.getBoolean("distinct"))) {
							colSql = "distinct " + column(field.getString("variable"), field.getString("field"));
							hadDistinct = true;
						} else {
							colSql = column(field.getString("variable"), field.getString("field"));
						}
					}
				}
				colSql += " as " + quote(field.getString("as"));
				subSelectSelect += colSql + (i == outputFields.size() - 1 ? "" : ",");
			}

			String subSelectSql = "select \n"
					+ "    " + subSelectSelect + "\n"
					+ "from \n"
					+ "    " + subSelectFrom + "\n"
					+ ("".equals(subSelectWhere) ? "" : "where\n    " + subSelectWhere);

			if (steps.size() == 1) {
				subSelectSql = appendGroupByHaving(firstStep, subSelectSql, null);
				subSelectSql = appendOrderBy(firstStep, subSelectSql, null);
				subSelectSql = appendLimit(firstStep, subSelectSql, rowLimit);
				return subSelectSql;
			} else {
				JSONObject secondStep = steps.getJSONObject(1);
				String tmpClassAs = secondStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
						.getJSONArray("objects").getJSONObject(0).getString("variable");
				JSONArray secondOutputFields = secondStep.getJSONObject("output").getJSONArray("fields");
				String select = "";
				hadDistinct = false;
				for (int i = 0; i < secondOutputFields.size(); i++) {
					JSONObject field = secondOutputFields.getJSONObject(i);
					String colSql = "";
					if (field.getString("variable") != null) {
						if (field.getString("function") != null && !"".equals(field.getString("function").trim())) {
							colSql = field.getString("function") + "("
									+ (Boolean.TRUE.equals(field.getBoolean("distinct")) ? "distinct " : "")
									+ column(tmpClassAs, field.getString("field")) + ")";
						} else {
							if (hadDistinct) {
								colSql = column(tmpClassAs, field.getString("field"));
							} else {
								if (Boolean.TRUE.equals(field.getBoolean("distinct"))) {
									colSql = "distinct " + column(tmpClassAs, field.getString("field"));
									hadDistinct = true;
								} else {
									colSql = column(tmpClassAs, field.getString("field"));
								}
							}
						}
					} else {
						if (field.getString("function") != null && !"".equals(field.getString("function").trim())) {
							colSql = field.getString("function") + "(" + field.getString("field") + ")";
						} else {
							if (hadDistinct) {
								if (field.getString("field").trim().startsWith("distinct ")) {
									colSql = field.getString("field").substring(field.getString("field").indexOf("distinct ") + 9);
								} else {
									colSql = field.getString("field");
								}
							} else {
								if (Boolean.TRUE.equals(field.getBoolean("distinct"))) {
									colSql = "distinct " + field.getString("field");
									hadDistinct = true;
								} else {
									colSql = field.getString("field");
									if (field.getString("field").trim().startsWith("distinct ")) {
										hadDistinct = true;
									}
								}
							}
						}
					}
					colSql += " as " + quote(field.getString("as"));
					select += colSql + (i == secondOutputFields.size() - 1 ? "" : ",");
				}
				String sql = "select\n"
						+ "    " + select + "\n"
						+ "from (\n"
						+ subSelectSql + "\n"
						+ ") as " + quote(tmpClassAs);

				sql = appendGroupByHaving(secondStep, sql, tmpClassAs);
				sql = appendOrderBy(secondStep, sql, tmpClassAs);
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

	/** Render one condition leaf against the attribute type; an unknown pair is a located violation. */
	private String renderLeaf(JSONObject cond, String alias, Map<String, String> attrTypeMap) {
		String attr = cond.getString("field");
		String type = attrTypeMap == null || attr == null ? null : attrTypeMap.get(attr);
		String operator = cond.getString("operator");
		String sqlCond = null;
		if (attr == null) {
			throw new DslContractViolationException(
					DslContractViolationException.Code.UNSUPPORTED_OPERATOR_FOR_TYPE,
					"conditions.properties",
					"a condition must name a field; got operator '" + operator + "'");
		}
		if ("=".equals(operator) || "!=".equals(operator)) {
			if ("varchar".equals(type) || "text".equals(type) || "vector".equals(type)) {
				sqlCond = column(alias, attr) + " " + operator + " " + literal(String.valueOf(cond.get("value")));
			} else if ("int".equals(type) || "long".equals(type) || "double".equals(type)) {
				sqlCond = column(alias, attr) + " " + operator + " " + cond.get("value");
			} else if ("date".equals(type) || "timestamp".equals(type)) {
				sqlCond = column(alias, attr) + " " + operator + " " + timeLiteral(cond.get("value"));
			}
		} else if (("like".equals(operator) || "not like".equals(operator)) && LikePattern.escaped(cond)) {
			if ("varchar".equals(type) || "text".equals(type) || "vector".equals(type)) {
				String pattern = LikePattern.of(cond, true).render("%", "_",
						c -> (c == '%' || c == '_' || c == '\\') ? "\\" + c : String.valueOf(c));
				// ClickHouse LIKE takes no ESCAPE clause; its pattern escape is the backslash.
				sqlCond = column(alias, attr) + " " + operator + " " + literal(pattern);
			}
		} else if ("like".equals(operator) || "not like".equals(operator)) {
			if ("varchar".equals(type) || "text".equals(type) || "vector".equals(type)) {
				String value = String.valueOf(cond.get("value")).trim();
				if (!value.startsWith("%") && !value.endsWith("%")) {
					value = "%" + value + "%";
				}
				sqlCond = column(alias, attr) + " " + operator + " " + literal(value);
			}
		} else if (">".equals(operator) || ">=".equals(operator) || "<=".equals(operator) || "<".equals(operator)) {
			if ("int".equals(type) || "long".equals(type) || "double".equals(type)) {
				sqlCond = column(alias, attr) + " " + operator + " " + cond.get("value");
			} else if ("date".equals(type) || "timestamp".equals(type)) {
				sqlCond = column(alias, attr) + " " + operator + " " + timeLiteral(cond.get("value"));
			} else if ("varchar".equals(type)) {
				sqlCond = column(alias, attr) + " " + operator + " " + literal(String.valueOf(cond.get("value")));
			}
		} else if ("between".equals(operator)) {
			JSONArray value = cond.getJSONArray("value");
			if ("int".equals(type) || "long".equals(type) || "double".equals(type)) {
				sqlCond = "(" + column(alias, attr) + " >= " + value.get(0)
						+ " and " + column(alias, attr) + " <= " + value.get(1) + ")";
			} else if ("date".equals(type) || "timestamp".equals(type)) {
				sqlCond = "(" + column(alias, attr) + " >= " + timeLiteral(value.get(0))
						+ " and " + column(alias, attr) + " <= " + timeLiteral(value.get(1)) + ")";
			} else if ("varchar".equals(type)) {
				sqlCond = "(" + column(alias, attr) + " >= " + literal(String.valueOf(value.get(0)))
						+ " and " + column(alias, attr) + " <= " + literal(String.valueOf(value.get(1))) + ")";
			}
		} else if ("in".equals(operator)) {
			JSONArray value = cond.getJSONArray("value");
			String in = "";
			if ("varchar".equals(type) || "text".equals(type) || "vector".equals(type)) {
				for (int j = 0; j < value.size(); j++) {
					in += literal(value.getString(j)) + ",";
				}
				in = "(" + in.substring(0, in.length() - 1) + ")";
				sqlCond = column(alias, attr) + " in " + in;
			} else if ("int".equals(type) || "long".equals(type) || "double".equals(type)) {
				for (int j = 0; j < value.size(); j++) {
					in += value.get(j) + ",";
				}
				in = "(" + in.substring(0, in.length() - 1) + ")";
				sqlCond = column(alias, attr) + " in " + in;
			} else if ("date".equals(type) || "timestamp".equals(type)) {
				for (int j = 0; j < value.size(); j++) {
					in += timeLiteral(value.get(j)) + ",";
				}
				in = "(" + in.substring(0, in.length() - 1) + ")";
				sqlCond = column(alias, attr) + " in " + in;
			}
		} else if ("is".equals(operator) || "is not".equals(operator)) {
			sqlCond = column(alias, attr) + " " + operator + " null";
		}
		if (sqlCond == null) {
			throw new DslContractViolationException(
					DslContractViolationException.Code.UNSUPPORTED_OPERATOR_FOR_TYPE,
					"conditions.properties",
					"operator '" + operator + "' on field '" + attr + "' of type '" + type
							+ "' is not supported by " + getClass().getSimpleName());
		}
		return sqlCond;
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
					sql += column(tmpClassAs, field.getString("field"));
				} else {
					sql += column(field.getString("variable"), field.getString("field"));
				}
				sql += (i == groupBy.getJSONArray("fields").size() - 1 ? "" : ",");
			}
			if (groupBy.getJSONArray("having") != null && groupBy.getJSONArray("having").size() > 0) {
				sql += "\nhaving\n    ";
				for (int i = 0; i < groupBy.getJSONArray("having").size(); i++) {
					JSONObject havingCond = groupBy.getJSONArray("having").getJSONObject(i);
					String ref = tmpClassAs != null
							? column(tmpClassAs, havingCond.getString("field"))
							: column(havingCond.getString("variable"), havingCond.getString("field"));
					sql += havingCond.getString("function") + "(" + ref
							+ ") " + havingCond.getString("operator") + " " + havingCond.get("value")
							+ (i == groupBy.getJSONArray("having").size() - 1 ? "" : " and ");
				}
			}
		}
		return sql;
	}

	private String appendOrderBy(JSONObject step, String sql, String tmpClassAs) {
		if (step.getJSONObject("output").getJSONObject("sort") == null) {
			return sql;
		}
		JSONObject orderBy = step.getJSONObject("output").getJSONObject("sort");
		if (orderBy.getJSONArray("fields") != null && orderBy.getJSONArray("fields").size() > 0) {
			sql += "\norder by\n    ";
			for (int i = 0; i < orderBy.getJSONArray("fields").size(); i++) {
				JSONObject order = orderBy.getJSONArray("fields").getJSONObject(i);
				sql += quote(order.getString("field")) + " "
						+ ("desc".equals(order.getString("order")) ? "desc" : "")
						+ (i == orderBy.getJSONArray("fields").size() - 1 ? "" : ",");
			}
		}
		return sql;
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
				select += quote(attrs.get(i));
				if (i < attrs.size() - 1) {
					select += ", ";
				}
			}
			String sql = "select " + select + " from " + quote(className) + " limit 1";
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
		log.debug(sql);
		try (Connection conn = openConnection();
				Statement st = conn.createStatement();
				ResultSet rs = st.executeQuery(sql)) {
			JSONArray rows = new JSONArray();
			ResultSetMetaData meta = rs.getMetaData();
			while (rs.next()) {
				JSONObject row = new JSONObject();
				for (int i = 1; i <= meta.getColumnCount(); i++) {
					String label = meta.getColumnLabel(i);
					Object value;
					if (isTemporalColumn(meta.getColumnType(i), meta.getColumnTypeName(i))) {
						// Return the source's own text: a value read back can feed straight back as a condition.
						value = rs.getString(i);
					} else {
						value = normalizeNumber(rs.getObject(i));
					}
					row.put(label, value);
				}
				rows.add(row);
			}
			return rows;
		}
	}

	/** ClickHouse returns UInt64 and other engine numbers; keep them plain JDBC numbers. */
	private static Object normalizeNumber(Object value) {
		if (value instanceof Number n && !(value instanceof Integer || value instanceof Long
				|| value instanceof Double || value instanceof Float || value instanceof Short
				|| value instanceof Byte || value instanceof BigDecimal || value instanceof BigInteger)) {
			return n.longValue();
		}
		return value;
	}

	private static boolean isTemporalColumn(int sqlType, String typeName) {
		if (sqlType == Types.DATE || sqlType == Types.TIME || sqlType == Types.TIMESTAMP
				|| sqlType == Types.TIME_WITH_TIMEZONE || sqlType == Types.TIMESTAMP_WITH_TIMEZONE) {
			return true;
		}
		if (typeName == null) {
			return false;
		}
		String type = typeName.toLowerCase(Locale.ROOT);
		return type.contains("date") || type.contains("datetime");
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

	@Override
	public void validateClassNameFormat(String className) throws Exception {
	}

	@Override
	public void createNamespace(String namespace) {
		// ClickHouse namespaces are table-name prefixes in the current database; nothing to create.
	}

	@Override
	public void truncateNamespace(String namespace) {
		for (String tableName : namespaceTables(namespace)) {
			executeSql("truncate table " + quote(tableName));
		}
	}

	@Override
	public void dropNamespace(String namespace) {
		for (String tableName : namespaceTables(namespace)) {
			executeSql("drop table if exists " + quote(tableName));
		}
	}

	/** Enumerate the current database's tables whose name starts with the namespace prefix. */
	private List<String> namespaceTables(String namespace) {
		try {
			JSONArray dbs = querySql("select currentDatabase() as db");
			String database = dbs.getJSONObject(0).getString("db");
			JSONArray tables = querySql("select name from system.tables where database = " + literal(database));
			List<String> matched = new ArrayList<>();
			for (int i = 0; i < tables.size(); i++) {
				String tableName = tables.getJSONObject(i).getString("name");
				if (namespace == null || tableName.toLowerCase(Locale.ROOT)
						.startsWith(namespace.toLowerCase(Locale.ROOT))) {
					matched.add(tableName);
				}
			}
			return matched;
		} catch (Exception e) {
			throw new IllegalStateException("Failed to enumerate ClickHouse tables for namespace [" + namespace + "]", e);
		}
	}

	@Override
	public void createClass(String namespace, Map<String, Object> classDef) {
		try {
			String fullClassName = namespace + ((String) classDef.get("className")).trim();
			@SuppressWarnings("unchecked")
			List<Map<String, Object>> attrs = (List<Map<String, Object>>) classDef.get("attrs");
			List<String> fields = new ArrayList<>();
			String primaryKey = null;
			if (attrs != null) {
				for (Map<String, Object> attr : attrs) {
					if (attr.get("enable") == null || (Boolean) attr.get("enable")) {
						String name = (String) attr.get("name");
						String type = (String) attr.get("type");
						if (name != null && isSupportedType(type)) {
							boolean isPrimaryKey = attr.get("primaryKey") != null && (Boolean) attr.get("primaryKey");
							if (isPrimaryKey) {
								primaryKey = name;
							}
							fields.add(quote(name) + " " + clickHouseType(type, isPrimaryKey));
						}
					}
				}
			}

			StringBuilder sql = new StringBuilder();
			sql.append("create table ").append(quote(fullClassName)).append(" (\n");
			for (int i = 0; i < fields.size(); i++) {
				sql.append("  ").append(fields.get(i)).append(i == fields.size() - 1 ? "" : ",").append("\n");
			}
			sql.append(") engine = MergeTree\n");
			sql.append("order by ").append(primaryKey == null ? "tuple()" : "(" + quote(primaryKey) + ")");
			executeSql(sql.toString());
		} catch (Exception e) {
			throw new IllegalStateException("Failed to create ClickHouse table for class ["
					+ classDef.get("className") + "]", e);
		}
	}

	private boolean isSupportedType(String type) {
		return "varchar".equals(type) || "text".equals(type) || "int".equals(type) || "long".equals(type)
				|| "double".equals(type) || "date".equals(type) || "timestamp".equals(type)
				|| "vector".equals(type);
	}

	/** The DSL type to ClickHouse type map. Every non-key column is nullable so a null stays null. */
	private static String clickHouseType(String type, boolean primaryKey) {
		switch (type) {
			case "varchar":
			case "text":
			case "vector":
				return primaryKey ? "String" : "Nullable(String)";
			case "int":
				return "Nullable(Int32)";
			case "long":
				return "Nullable(Int64)";
			case "double":
				return "Nullable(Float64)";
			case "date":
				return "Nullable(Date)";
			case "timestamp":
				return "Nullable(DateTime)";
			default:
				throw new IllegalArgumentException("Unsupported ClickHouse attribute type [" + type + "]");
		}
	}

	@Override
	public void createEdgeType(String namespace, String edgeName) {
	}

	@Override
	public void insertObjects(String namespace, Map<String, Object> classDef, JSONArray objs) throws Exception {
		boolean inSandbox = inSandbox(namespace);
		String fullClassName = inSandbox ? namespace + classDef.get("className") : (String) classDef.get("className");

		int idIndex = -1;
		List<String> fields = new ArrayList<>();
		Map<String, String> attrTypeMap = new HashMap<>();
		if (classDef.get("attrs") != null) {
			@SuppressWarnings("unchecked")
			List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
			for (Map<String, Object> attrDef : attrDefs) {
				if (attrDef.get("enable") == null || (Boolean) attrDef.get("enable")) {
					String type = (String) attrDef.get("type");
					if (isSupportedType(type)) {
						if (attrDef.get("primaryKey") != null && (Boolean) attrDef.get("primaryKey")) {
							idIndex = fields.size();
						}
						fields.add((String) attrDef.get("name"));
						attrTypeMap.put((String) attrDef.get("name"), type);
					}
				}
			}
		}

		if (idIndex < 0) {
			throw new Exception("The insert statement must contain the primary key field");
		}
		String pk = fields.get(idIndex);
		if (objs == null || objs.isEmpty()) {
			return;
		}

		StringBuilder sql = new StringBuilder();
		sql.append("insert into ").append(quote(fullClassName)).append(" (");
		for (int j = 0; j < fields.size(); j++) {
			sql.append(j == 0 ? "" : ",").append(quote(fields.get(j)));
		}
		sql.append(") values ");
		for (int i = 0; i < objs.size(); i++) {
			JSONObject obj = objs.getJSONObject(i);
			if (obj.get(pk) == null || "".equals(obj.getString(pk).trim())) {
				throw new Exception("The insert statement must contain the primary key [" + pk + "] field");
			}
			sql.append(i == 0 ? "" : ",").append("(");
			for (int j = 0; j < fields.size(); j++) {
				String type = attrTypeMap.get(fields.get(j));
				Object value = obj.get(fields.get(j));
				sql.append(j == 0 ? "" : ",");
				sql.append(value == null ? "null" : toSqlValue(type, value));
			}
			sql.append(")");
		}
		executeSql(sql.toString());
	}

	private boolean inSandbox(String sandboxId) {
		return sandboxId != null && !"".equals(sandboxId.trim());
	}

	@Override
	public void updateObjects(String namespace, Map<String, Object> classDef, JSONObject setValues, JSONObject where)
			throws Exception {
		boolean inSandbox = inSandbox(namespace);
		String fullClassName = inSandbox ? namespace + classDef.get("className") : (String) classDef.get("className");

		Map<String, String> attrTypeMap = new HashMap<>();
		String pk = null;
		if (classDef.get("attrs") != null) {
			@SuppressWarnings("unchecked")
			List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
			for (Map<String, Object> attrDef : attrDefs) {
				if (attrDef.get("enable") == null || (Boolean) attrDef.get("enable")) {
					String type = (String) attrDef.get("type");
					if (isSupportedType(type)) {
						if (attrDef.get("primaryKey") != null && (Boolean) attrDef.get("primaryKey")) {
							pk = (String) attrDef.get("name");
						}
						attrTypeMap.put((String) attrDef.get("name"), type);
					}
				}
			}
		}

		StringBuilder setStr = new StringBuilder();
		for (String key : setValues.keySet()) {
			if (key.equals(pk)) {
				throw new Exception("Updating the primary key [" + pk + "] field is not allowed");
			}
			String type = attrTypeMap.get(key);
			if (type == null) {
				throw new Exception("Field [" + key + "] does not exist");
			}
			Object value = setValues.get(key);
			setStr.append(setStr.length() == 0 ? "" : ", ").append(quote(key)).append(" = ")
					.append(value == null ? "null" : toSqlValue(type, value));
		}
		if (setStr.length() == 0) {
			return;
		}
		String whereStr = generateWhere(where, attrTypeMap);
		String sql = "alter table " + quote(fullClassName) + " update " + setStr
				+ " where " + ("".equals(whereStr.trim()) ? "1" : whereStr)
				+ " settings mutations_sync = 2";
		executeSql(sql);
	}

	private String generateWhere(JSONObject condition, Map<String, String> attrTypeMap) throws Exception {
		if (condition == null) {
			return "";
		}
		return buildWhere(condition, true, attrTypeMap);
	}

	/**
	 * Recursively build the where fragment using the same condition grammar as the read path.
	 *
	 * @param condition condition JSON (single-attribute condition or logic condition)
	 * @param topLevel  whether this is the top level (no parentheses at the top level, parentheses for nested logic)
	 */
	private String buildWhere(JSONObject condition, boolean topLevel, Map<String, String> attrTypeMap) throws Exception {
		String operator = condition.getString("operator");
		if (operator == null) {
			operator = "";
		}

		if (condition.getJSONArray("not") != null && condition.getJSONArray("not").size() > 0) {
			String inner = buildWhere(DslGrammarValidator.negated(condition), false, attrTypeMap);
			return "not (" + inner + ")";
		}

		if (condition.getJSONArray("and") != null && condition.getJSONArray("and").size() > 0
				|| condition.getJSONArray("or") != null && condition.getJSONArray("or").size() > 0) {
			String connector;
			JSONArray list;
			if (condition.containsKey("and")) {
				connector = " and ";
				list = condition.getJSONArray("and");
			} else {
				connector = " or ";
				list = condition.getJSONArray("or");
			}
			List<String> parts = new ArrayList<>();
			for (int i = 0; i < list.size(); i++) {
				parts.add(buildWhere(list.getJSONObject(i), false, attrTypeMap));
			}
			String joined = String.join(connector, parts);
			return topLevel ? joined : "(" + joined + ")";
		}

		String field = condition.getString("field");
		String type = field == null ? null : attrTypeMap.get(field);
		if (type == null) {
			throw new Exception("Field [" + field + "] does not exist");
		}
		switch (operator) {
			case "=":
			case "!=":
			case ">":
			case ">=":
			case "<":
			case "<=":
				return quote(field) + " " + operator + " " + toSqlValue(type, condition.get("value"));
			case "like":
			case "not like":
				if (LikePattern.escaped(condition)) {
					String pattern = LikePattern.of(condition, true).render("%", "_",
							c -> (c == '%' || c == '_' || c == '\\') ? "\\" + c : String.valueOf(c));
					return quote(field) + " " + operator + " " + literal(pattern);
				}
				return quote(field) + " " + operator + " " + toSqlValue(type, condition.get("value"));
			case "between": {
				JSONArray betweenArr = condition.getJSONArray("value");
				return quote(field) + " between " + toSqlValue(type, betweenArr.get(0)) + " and "
						+ toSqlValue(type, betweenArr.get(1));
			}
			case "in": {
				JSONArray vs = condition.getJSONArray("value");
				String inValue = "(";
				for (int i = 0; i < vs.size(); i++) {
					inValue += toSqlValue(type, vs.get(i)) + (i == vs.size() - 1 ? ")" : ",");
				}
				return quote(field) + " in " + inValue;
			}
			case "is":
				return quote(field) + " is null";
			case "is not":
				return quote(field) + " is not null";
			default:
				throw new Exception("Unsupported operator [" + operator + "] on field [" + field + "]");
		}
	}

	@Override
	public void deleteObjects(String namespace, Map<String, Object> classDef, JSONObject where) throws Exception {
		boolean inSandbox = inSandbox(namespace);
		String fullClassName = inSandbox ? namespace + classDef.get("className") : (String) classDef.get("className");

		Map<String, String> attrTypeMap = new HashMap<>();
		if (classDef.get("attrs") != null) {
			@SuppressWarnings("unchecked")
			List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
			for (Map<String, Object> attrDef : attrDefs) {
				if (attrDef.get("enable") == null || (Boolean) attrDef.get("enable")) {
					String type = (String) attrDef.get("type");
					if (isSupportedType(type)) {
						attrTypeMap.put((String) attrDef.get("name"), type);
					}
				}
			}
		}

		String whereStr = generateWhere(where, attrTypeMap);
		String sql = "alter table " + quote(fullClassName) + " delete where "
				+ ("".equals(whereStr.trim()) ? "1" : whereStr)
				+ " settings mutations_sync = 2";
		executeSql(sql);
	}

	@Override
	public void createEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
			String targetClassName, String targetObjId) throws Exception {
		EdgeUpdate edge = resolveEdge(namespace, relationName, sourceClassName, sourceObjId, targetClassName,
				targetObjId);
		if (edge == null) {
			return;
		}
		long matches = countByPk(edge.table(), edge.pkField(), edge.pkValue());
		if (matches == 0) {
			throw new Exception("No row [" + edge.pkValue() + "] in class [" + edge.table()
					+ "] to attach the [" + relationName + "] edge to");
		}
		executeSql("alter table " + quote(edge.table()) + " update " + quote(edge.storeField())
				+ " = " + literal(edge.storeValue()) + " where " + column(null, edge.pkField())
				+ " = " + literal(edge.pkValue()) + " settings mutations_sync = 2");
	}

	@Override
	public void deleteEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
			String targetClassName, String targetObjId) throws Exception {
		EdgeUpdate edge = resolveEdge(namespace, relationName, sourceClassName, sourceObjId, targetClassName,
				targetObjId);
		if (edge == null) {
			return;
		}
		executeSql("alter table " + quote(edge.table()) + " update " + quote(edge.storeField())
				+ " = null where " + column(null, edge.pkField())
				+ " = " + literal(edge.pkValue()) + " settings mutations_sync = 2");
	}

	/** The row an edge is stored on, resolved from the relationship's field roles. */
	private record EdgeUpdate(String table, String pkField, String pkValue, String storeField, String storeValue) {
	}

	private EdgeUpdate resolveEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
			String targetClassName, String targetObjId) throws Exception {
		boolean inSandbox = inSandbox(namespace);
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
		@SuppressWarnings("unchecked")
		Map<String, Object> relationship_rule = (Map<String, Object>) jsonRule.get("relationship_rule");
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
		Map<String, Object> relDef = relationship_rule == null ? null : (Map<String, Object>) relationship_rule.get(relationName);

		if (relDef == null || sourceClassDef == null || targetClassDef == null
				|| !relDef.get("fromclass").equals(sourceClassName)
				|| !relDef.get("toclass").equals(targetClassName)) {
			throw new Exception("Object class [" + sourceClassName + "] and object class [" + targetClassName
					+ "] have no relationship definition [" + relationName + "]");
		}
		String sourcePk = DslUtil.getPrimaryKey(sourceClassDef);
		String targetPk = DslUtil.getPrimaryKey(targetClassDef);
		String sourceInnerField = (String) relDef.get("fromField");
		String targetInnerField = (String) relDef.get("toField");
		if (sourceInnerField == null || targetInnerField == null) {
			throw new Exception("Relationship [" + relationName + "] has no fromField/toField for this engine");
		}

		if (sourcePk.equals(sourceInnerField)) {
			if (targetPk.equals(targetInnerField)) {
				return null; // both sides are already keyed by their own primary key
			}
			return new EdgeUpdate(physicalName(namespace, (String) targetClassDef.get("className"), inSandbox),
					targetPk, targetObjId, targetInnerField, sourceObjId);
		}
		if (targetPk.equals(targetInnerField)) {
			return new EdgeUpdate(physicalName(namespace, (String) sourceClassDef.get("className"), inSandbox),
					sourcePk, sourceObjId, sourceInnerField, targetObjId);
		}
		return null; // neither side stores the other's key
	}

	private String physicalName(String namespace, String className, boolean inSandbox) {
		return inSandbox ? namespace + className : className;
	}

	private long countByPk(String table, String pkField, String pkValue) throws Exception {
		JSONArray rows = querySql("select count() as c from " + quote(table) + " where "
				+ column(null, pkField) + " = " + literal(pkValue));
		return rows.getJSONObject(0).getLongValue("c");
	}

	private void executeSql(String sql) {
		log.debug(sql);
		try (Connection conn = openConnection(); Statement st = conn.createStatement()) {
			st.execute(sql);
		} catch (SQLException e) {
			throw new IllegalStateException("ClickHouse statement failed: " + sql, e);
		}
	}

	@Override
	public JSONArray queryVectorAttr(Map<String, Object> classDef, String attrName, String objectId) throws Exception {
		String fullClassName = (String) classDef.get("className");
		String pk = DslUtil.getPrimaryKey(classDef);
		String sql = "select " + quote(attrName) + " from " + quote(fullClassName)
				+ " where " + column(null, pk) + " = " + literal(objectId);
		JSONArray rows = querySql(sql);
		if (rows == null || rows.isEmpty()) {
			throw new IllegalArgumentException("Object " + objectId + " of class " + fullClassName + " does not exist");
		}
		Object value = rows.getJSONObject(0).get(attrName);
		return DslUtil.parseVectorAttr(value);
	}

	@Override
	public Map<String, Object> query(JSONObject dsl, String sandboxId, String domainId, VectorResourceDao vectorResourceDao, DataRagConfig dataRagConfig) throws Exception {
		boolean inSandbox = inSandbox(sandboxId);

		UserDataPermission userDataPermission = new UserDataPermission();
		JSONArray dsls = new JSONArray();
		dsls.add(dsl);
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
		String dslStr = DslUtil.normalizeClassNames(JSONArray.toJSONString(dsls, Feature.WriteMapNullValue), classDefs);
		dslStr = DslUtil.setConditionTimeColumnToCorrectFormat(dslStr, dataRagConfig.getDslMightTimeFormats(), classDefs, timeConditionsAsEpochMillis(), timeConditionZone());

		JSONObject dataMap = new JSONObject();
		DslExecutionResult result;
		JSONObject data;
		if (inSandbox) { // Handle the logic of appending sandboxId to class names in the DSL
			for (Map<String, Object> classDef : classDefs) {
				String className = sandboxId + ((String) classDef.get("className")).trim();
				classDef.put("className", className);
			}
			String sandboxDslStr = addSandboxId(dslStr, sandboxId);
			result = HttpRequestUtil.executeDsl(dataRagConfig, this, sandboxDslStr, null, true, jsonRule, vectorResourceDao, userDataPermission, DslExecutionMode.OPTIMIZED, domainId)[1];
			data = result.data();
		} else {
			result = HttpRequestUtil.executeDsl(dataRagConfig, this, dslStr, null, true, jsonRule, vectorResourceDao, userDataPermission, DslExecutionMode.OPTIMIZED, domainId)[1];
			data = result.data();
		}

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

	/** Quote an identifier with backticks; a backtick inside is escaped with a backslash. */
	private static String quote(String identifier) {
		if (identifier == null) {
			throw new IllegalArgumentException("ClickHouse identifier must not be null");
		}
		return "`" + identifier.replace("\\", "\\\\").replace("`", "\\`") + "`";
	}

	private static String column(String alias, String field) {
		return alias == null ? quote(field) : quote(alias) + "." + quote(field);
	}

	private static String tableAlias(String table, String alias) {
		return quote(table) + " as " + quote(alias);
	}

	private static String joinSource(String[] classAlias) {
		return tableAlias(classAlias[0], classAlias[1]);
	}

	private static String join(String from, String toClass, String toAlias, String fromAlias, String fromField,
			String toAliasField, String toField) {
		return from + " inner join " + tableAlias(toClass, toAlias)
				+ " on " + column(fromAlias, fromField) + " = " + column(toAliasField, toField);
	}

	/** A ClickHouse string literal: backslash and single quote are escaped. */
	private static String literal(String value) {
		return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'";
	}

	/** A time condition value is passed through verbatim: the source's own time convention is never re-interpreted. */
	private static String timeLiteral(Object value) {
		return literal(String.valueOf(value));
	}

	private static String toSqlValue(String type, Object value) throws Exception {
		if (type == null) {
			throw new Exception("No attribute type for value [" + value + "]");
		}
		if ("varchar".equals(type) || "text".equals(type) || "vector".equals(type)) {
			String strValue = "vector".equals(type) && value != null && !(value instanceof String)
					? JSON.toJSONString(value) : String.valueOf(value);
			return literal(strValue);
		}
		if ("int".equals(type) || "long".equals(type) || "double".equals(type)) {
			return String.valueOf(value);
		}
		if ("date".equals(type)) {
			try {
				return literal(LocalDate.parse(String.valueOf(value), DATE_FORMAT).format(DATE_FORMAT));
			} catch (Exception e) {
				log.error(e.getMessage(), e);
				throw new Exception("Invalid format for a date field, expected yyyy-MM-dd");
			}
		}
		if ("timestamp".equals(type)) {
			try {
				return literal(LocalDateTime.parse(String.valueOf(value), TIMESTAMP_FORMAT).format(TIMESTAMP_FORMAT));
			} catch (Exception e) {
				log.error(e.getMessage(), e);
				throw new Exception("Invalid format for a timestamp field, expected yyyy-MM-dd HH:mm:ss");
			}
		}
		throw new Exception("Unsupported ClickHouse attribute type [" + type + "]");
	}
}
