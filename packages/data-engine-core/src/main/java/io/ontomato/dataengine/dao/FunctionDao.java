package io.ontomato.dataengine.dao;

import static io.ontomato.dataengine.service.OntologyNeighborFacts.ID_PADDING;

import io.ontomato.dataengine.service.MetricViewBindings;
import io.ontomato.dataengine.service.QueryPackage;
import java.sql.ResultSet;
import java.sql.SQLException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.SqlArrayValue;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.service.PythonProgramProtocol;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("functionDao")
public class FunctionDao {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	private static final String TABLE_NAME = "function";

	private static final String COLUMNS = "id, name, origin, description, operation, parameters, return_def, code, logic, class_names, create_timestamp, modify_timestamp, domain_id, query_package, source_artifact, created_by, published";

	@PostConstruct
	public void initIndex() {
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + TABLE_NAME + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "name VARCHAR(255), "
				+ "origin VARCHAR(32), "
				+ "description TEXT, "
				+ "operation VARCHAR(64), "
				+ "parameters TEXT, "
				+ "return_def TEXT, "
				+ "code TEXT, "
				+ "logic TEXT, "
				+ "class_names TEXT, "
				+ "create_timestamp BIGINT, "
				+ "modify_timestamp BIGINT, "
				+ "domain_id VARCHAR(64)"
				+ ")");
		jdbcTemplate.execute("ALTER TABLE " + TABLE_NAME + " ADD COLUMN IF NOT EXISTS query_package TEXT");
		jdbcTemplate.execute("ALTER TABLE " + TABLE_NAME + " ADD COLUMN IF NOT EXISTS source_artifact JSONB");
		jdbcTemplate.execute("ALTER TABLE " + TABLE_NAME + " ADD COLUMN IF NOT EXISTS created_by VARCHAR(64)");
		jdbcTemplate.execute("ALTER TABLE " + TABLE_NAME + " ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT TRUE");
		jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_" + TABLE_NAME + "_domain_id ON " + TABLE_NAME + "(domain_id)");
		log.info(">>>function table initialization complete");
	}

    public static void requireSupported(Function function, String lang) {
        if (!Function.OPERATION_READ.equals(function.getOperation()) && !Function.OPERATION_WRITE.equals(function.getOperation()))
            throw new IllegalArgumentException("Function.operation: expected OPERATION_READ or OPERATION_WRITE");
        if (Function.OPERATION_READ.equals(function.getOperation()) && function.getQueryPackage() != null)
            QueryPackage.validate(function.getQueryPackage());
        if (function.getParameters() != null) {
            for (var parameter : function.getParameters())
                if (parameter.getType() == null || !Parameter.TYPES.contains(parameter.getType()))
                    throw new IllegalArgumentException("Function.parameters." + parameter.getName() + ".type: received " + parameter.getType() + "; expected one of " + Parameter.TYPES.stream().sorted().toList() + "; boolean parameters are not supported");
            var values = MetricViewBindings.values(function);
            if (Function.OPERATION_READ.equals(function.getOperation())) MetricViewBindings.validateDeclaredValues(function, values);
            else MetricViewBindings.validateValues(function, values);
        }
        if (!(Function.OPERATION_READ.equals(function.getOperation()) && function.getQueryPackage() != null))
            PythonProgramProtocol.requireSupported(function.getCode(), lang);
    }

    public Function save(Function function, String lang) {
        requireSupported(function, lang);
		if (function.getId() == null) {
			function.setId(UUID.randomUUID().toString());
		}
		Long now = System.currentTimeMillis();
		if (function.getCreateTimestamp() == null) {
			function.setCreateTimestamp(now);
		}
		function.setModifyTimestamp(now);

		String classNamesStr = buildClassNamesStr(function);

		jdbcTemplate.update(
				"INSERT INTO " + TABLE_NAME + " (" + COLUMNS + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?) "
						+ "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, origin = EXCLUDED.origin, "
						+ "description = EXCLUDED.description, operation = EXCLUDED.operation, "
						+ "parameters = EXCLUDED.parameters, return_def = EXCLUDED.return_def, "
						+ "code = EXCLUDED.code, logic = EXCLUDED.logic, class_names = EXCLUDED.class_names, "
						+ "create_timestamp = EXCLUDED.create_timestamp, modify_timestamp = EXCLUDED.modify_timestamp, "
				+ "domain_id = EXCLUDED.domain_id, query_package = EXCLUDED.query_package, source_artifact = EXCLUDED.source_artifact, published = EXCLUDED.published",
				function.getId(), function.getName(), function.getOrigin(), function.getDescription(),
				function.getOperation(),
				function.getQueryPackage() == null ? JSON.toJSONString(function.getParameters(), Feature.WriteMapNullValue) : null,
				JSON.toJSONString(function.getReturnDef(), Feature.WriteMapNullValue),
				function.getCode(), function.getLogic(), classNamesStr,
				function.getCreateTimestamp(), function.getModifyTimestamp(), function.getDomainId(),
                JSON.toJSONString(function.getQueryPackage(), Feature.WriteMapNullValue),JSON.toJSONString(function.getSourceArtifact()), function.getCreatedBy(), function.isPublished());
		return function;
	}

	private String buildClassNamesStr(Function function) {
		Set<String> classNames = new HashSet<String>();
		List<Parameter> parameters = function.getParameters();
		if (parameters != null) {
			for (Parameter parameter : parameters) {
				if (parameter.getClassNames() != null && parameter.getClassNames().size() > 0) {
					classNames.addAll(parameter.getClassNames());
				}
			}
		}
		ReturnDef returnDef = function.getReturnDef();
		if (returnDef != null && returnDef.getClassNames() != null) {
			classNames.addAll(returnDef.getClassNames());
		}
		StringBuilder sb = new StringBuilder(",");
		for (String className : classNames) {
			sb.append(className).append(",");
		}
		return sb.toString();
	}

	public void delete(String id) {
		jdbcTemplate.update("DELETE FROM " + TABLE_NAME + " WHERE id = ?", id);
	}

	public void lock(String id) {
		jdbcTemplate.queryForList("SELECT id FROM function WHERE id=? FOR UPDATE", String.class, id);
	}

	public Function queryById(String id) {
		Function function = null;
		try {
			List<Function> list = jdbcTemplate.query(
					"SELECT " + COLUMNS + " FROM " + TABLE_NAME + " WHERE id = ?",
					(rs, rowNum) -> mapRow(rs), id);
			if (!list.isEmpty()) {
				function = list.get(0);
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		return function;
	}

	public Map<String, Function> queryByIds(Set<String> ids) {
		Map<String, Function> functions = new HashMap<>();
		if (ids.isEmpty()) return functions;
		var rows = jdbcTemplate.query("SELECT " + COLUMNS + " FROM " + TABLE_NAME + " WHERE id = ANY (?)",
				statement -> statement.setArray(1, statement.getConnection().createArrayOf("varchar", ids.toArray())),
				(rs, rowNum) -> mapRow(rs));
		for (Function function : rows) functions.put(function.getId(), function);
		return functions;
	}

	public List<Function> queryList(String operation, String className, String domainId) {
		List<Function> functions = new ArrayList<Function>();
		try {
			StringBuilder whereSql = new StringBuilder("1 = 1");
			List<Object> params = new ArrayList<>();
			if (operation != null && !"".equals(operation.trim())) {
				whereSql.append(" AND operation = ?");
				params.add(operation.trim());
			}
			if (className != null && !"".equals(className.trim())) {
				whereSql.append(" AND class_names LIKE ?");
				params.add("%," + className.trim() + ",%");
			}
			if (domainId != null && !"".equals(domainId.trim())) {
				whereSql.append(" AND domain_id = ?");
				params.add(domainId.trim());
			}

			functions = jdbcTemplate.query(
					"SELECT " + COLUMNS + " FROM " + TABLE_NAME + " WHERE " + whereSql + " ORDER BY modify_timestamp DESC",
					(rs, rowNum) -> mapRow(rs), params.toArray());
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		return functions;
	}

	public List<Function> queryReadCandidates(String domainId) {
		return jdbcTemplate.query("SELECT id, operation, domain_id, created_by, published FROM " + TABLE_NAME + " WHERE domain_id = ?",
				(rs, rowNum) -> mapReadFacts(rs), domainId);
	}

	public List<Function> queryReadCandidates(String domainId, String id) {
		return jdbcTemplate.query(
				"SELECT id, name, operation, domain_id, created_by, published FROM " + TABLE_NAME + " WHERE domain_id = ? AND id = ?",
				(rs, rowNum) -> {
					var function = mapReadFacts(rs);
					function.setName(rs.getString("name"));
					return function;
				}, domainId, id);
	}

	public record ObjectTypeReferences(Function definition, List<String> classNames) {}

	public List<Function> queryReadCandidates(String domainId, Set<String> ids) {
		if (ids.isEmpty()) return List.of();
		return jdbcTemplate.query(
				"SELECT id, name, operation, domain_id, created_by, published FROM " + TABLE_NAME + " WHERE domain_id = ? AND id = ANY (?)",
				(rs, rowNum) -> {
					var function = mapReadFacts(rs);
					function.setName(rs.getString("name"));
					return function;
				}, domainId, new SqlArrayValue("varchar", ids.toArray()));
	}

	public List<ObjectTypeReferences> objectTypeReferences(String domainId, String centerId, boolean outgoing) {
		// Match the parameters exposed by Function.getParameters(), including query-package manifests.
		var sql = """
				SELECT id, name, operation, domain_id, created_by, published, refs.class_ids
				FROM function
				CROSS JOIN LATERAL (
					SELECT ARRAY(
						SELECT btrim(ref, ?) FROM jsonb_array_elements_text(jsonb_path_query_array(
							jsonb_build_array(return_def::jsonb) ||
								CASE WHEN query_package IS NULL OR query_package::jsonb = 'null'::jsonb
									THEN COALESCE(NULLIF(parameters::jsonb, 'null'::jsonb), '[]'::jsonb)
									ELSE query_package::jsonb #> '{manifest,parameterDefs}' END,
							'$[*].classNames[*] ? (@.type() == "string")'
						)) AS names(ref)
					) AS class_ids
				) refs
				WHERE domain_id = ? AND
				""" + (outgoing ? "id = ?" : "? = ANY (refs.class_ids)") + " ORDER BY modify_timestamp DESC";
		return jdbcTemplate.query(sql, (rs, row) -> {
			var function = mapReadFacts(rs);
			function.setName(rs.getString("name"));
			var classes = outgoing ? List.of((String[]) rs.getArray("class_ids").getArray()).stream()
					.filter(id -> !id.isEmpty()).distinct().toList() : List.of(centerId);
			return new ObjectTypeReferences(function, classes);
		}, ID_PADDING, domainId, centerId);
	}

	public long countByIds(String domainId, List<String> ids) {
		return jdbcTemplate.queryForObject("SELECT COUNT(*) FROM " + TABLE_NAME + " WHERE domain_id = ? AND id = ANY (?)",
				Long.class, domainId, new SqlArrayValue("varchar", ids.toArray()));
	}

	private Function mapReadFacts(ResultSet rs) throws SQLException {
		Function function = new Function();
		function.setId(rs.getString("id"));
		function.setOperation(rs.getString("operation"));
		function.setDomainId(rs.getString("domain_id"));
		function.setCreatedBy(rs.getString("created_by"));
		function.setPublished(rs.getBoolean("published"));
		return function;
	}

	private Function mapRow(ResultSet rs) throws SQLException {
		Function function = mapReadFacts(rs);
		function.setName(rs.getString("name"));
		function.setOrigin(rs.getString("origin"));
		function.setDescription(rs.getString("description"));
		String parameters = rs.getString("parameters");
		function.setParameters(parameters == null ? null : JSONArray.parseArray(parameters, Parameter.class));
		String returnDef = rs.getString("return_def");
		function.setReturnDef(returnDef == null ? null : JSONObject.parseObject(returnDef, ReturnDef.class));
		function.setCode(rs.getString("code"));
        function.setQueryPackage(JSON.parseObject(rs.getString("query_package")));
        function.setSourceArtifact(JSON.parseObject(rs.getString("source_artifact")));
		function.setLogic(rs.getString("logic"));
		function.setCreateTimestamp(rs.getObject("create_timestamp") == null ? null : rs.getLong("create_timestamp"));
		function.setModifyTimestamp(rs.getObject("modify_timestamp") == null ? null : rs.getLong("modify_timestamp"));
		return function;
	}

}
