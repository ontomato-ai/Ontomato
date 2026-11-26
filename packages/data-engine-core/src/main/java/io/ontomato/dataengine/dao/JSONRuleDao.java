package io.ontomato.dataengine.dao;

import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;

import io.ontomato.dataengine.service.OntologyModelService;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("jsonRuleDao")
public class JSONRuleDao {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	private static final String TABLE_NAME = "json_rule";

	@PostConstruct
	public void initIndex() {
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + TABLE_NAME + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "content TEXT"
				+ ")");
		removeRetiredPermissionFieldMarks();
		log.info(">>>jsonRule table initialization complete");
	}

	/**
	 * Parameterized row permissions no longer require fields to be marked in advance, so the retired
	 * {@code permissionField} attribute key is stripped from stored rules once at startup. Rows without the key
	 * are not touched, so later startups do nothing; each row is rewritten whole, so an interrupted run leaves
	 * only rows that the next startup finishes.
	 */
	void removeRetiredPermissionFieldMarks() {
		List<Map<String, Object>> rows = jdbcTemplate.queryForList(
				"SELECT id, content FROM " + TABLE_NAME + " WHERE content LIKE ?", "%\"permissionField\"%");
		for (Map<String, Object> row : rows) {
			JSONObject jsonRule = JSONObject.parseObject((String) row.get("content"));
			if (!removePermissionFieldMarks(jsonRule)) continue;
			jdbcTemplate.update("UPDATE " + TABLE_NAME + " SET content = ? WHERE id = ?",
					JSON.toJSONString(jsonRule, Feature.WriteMapNullValue), row.get("id"));
			log.info("jsonRule retired permissionField marks removed (domainId={})", row.get("id"));
		}
	}

	static boolean removePermissionFieldMarks(JSONObject jsonRule) {
		boolean changed = false;
		List<?> classDefs = jsonRule.getJSONArray("classDef");
		if (classDefs == null) return false;
		for (Object classDef : classDefs) {
			if (!(classDef instanceof JSONObject definition)) continue;
			List<?> attrs = definition.getJSONArray("attrs");
			if (attrs == null) continue;
			for (Object attr : attrs) {
				if (attr instanceof JSONObject attrDef && attrDef.containsKey("permissionField")) {
					attrDef.remove("permissionField");
					changed = true;
				}
			}
		}
		return changed;
	}

	public void save(Map<String, Object> jsonRule, String domainId) {
		jdbcTemplate.update(
				"INSERT INTO " + TABLE_NAME + " (id, content) VALUES (?, ?) "
						+ "ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content",
				domainId, JSON.toJSONString(jsonRule, Feature.WriteMapNullValue));
	}

	public void initialize(Map<String, Object> jsonRule, String domainId) {
		jdbcTemplate.update(
				"INSERT INTO " + TABLE_NAME + " (id, content) VALUES (?, ?) ON CONFLICT (id) DO NOTHING",
				domainId, JSON.toJSONString(jsonRule, Feature.WriteMapNullValue));
	}

	public Map<String, Integer> countMetadata(String domainId) {
		return countMetadata(domainId, null, true);
	}

	public Map<String, Integer> countModelMetadata(String domainId, List<String> classScope) {
		return countMetadata(domainId, classScope, false);
	}

	private Map<String, Integer> countMetadata(String domainId, List<String> classScope, boolean namedOnly) {
		return jdbcTemplate.query("""
				WITH rule AS (
					SELECT model.*, ?::text[] AS class_scope, ?::boolean AS named_only
					FROM json_rule
					CROSS JOIN LATERAL jsonb_to_record(content::jsonb) AS model("classDef" jsonb, relationship_rule jsonb)
					WHERE id = ? AND content IS NOT NULL
				), object_types AS (
					SELECT item.value
					FROM rule CROSS JOIN LATERAL jsonb_array_elements(rule."classDef") AS item(value)
					WHERE (NOT rule.named_only OR (jsonb_typeof(item.value->'className') = 'string'
						AND item.value->>'className' ~ '[^[:space:]]'))
						AND (rule.class_scope IS NULL OR item.value->>'className' = ANY(rule.class_scope))
				)
				SELECT (SELECT count(*) FROM object_types) AS object_types,
					(SELECT count(*) FROM object_types o
						CROSS JOIN LATERAL jsonb_array_elements(o.value->'attrs') AS attr(value)
						WHERE NOT rule.named_only OR (jsonb_typeof(attr.value->'name') = 'string'
							AND attr.value->>'name' ~ '[^[:space:]]')) AS attributes,
					(SELECT count(*) FROM jsonb_each(rule.relationship_rule) AS rel(key, value)
						WHERE (NOT rule.named_only OR (jsonb_typeof(rel.value) = 'object' AND (rel.key ~ '[^[:space:]]' OR
							(jsonb_typeof(rel.value->'relationship') = 'string' AND rel.value->>'relationship' ~ '[^[:space:]]'))))
						AND (rule.class_scope IS NULL OR (rel.value->>'fromclass' = ANY(rule.class_scope)
							AND rel.value->>'toclass' = ANY(rule.class_scope)))) AS relationships
				FROM rule
				""", statement -> {
			if (classScope == null) {
				statement.setNull(1, java.sql.Types.ARRAY);
			} else {
				statement.setArray(1, statement.getConnection().createArrayOf("text", classScope.toArray()));
			}
			statement.setBoolean(2, namedOnly);
			statement.setString(3, domainId);
		}, rs -> rs.next() ? Map.of("objectTypes", rs.getInt("object_types"),
				"attributes", rs.getInt("attributes"), "relationships", rs.getInt("relationships")) : null);
	}

	public Map<String, Object> query(String domainId) {
		String content;
		try {
			content = jdbcTemplate.queryForObject(
					"SELECT content FROM " + TABLE_NAME + " WHERE id = ?",
					String.class, domainId);
		} catch (org.springframework.dao.EmptyResultDataAccessException e) {
			return null;
		}
		Map<String, Object> jsonRule = JSONObject.parseObject(content);
		if (jsonRule != null) OntologyModelService.normalizeRuleAttributeTypes(jsonRule, false);
		return jsonRule;
	}
}
