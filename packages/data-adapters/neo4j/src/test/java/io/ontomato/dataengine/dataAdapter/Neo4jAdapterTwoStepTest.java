package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.db.mql.MQLQuery.LogicQuery;
import io.ontomato.dataengine.core.db.mql.MQLQuery.PropertyQuery;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DslPermissionUtil;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.junit.jupiter.api.Test;
import org.neo4j.driver.AuthToken;
import org.neo4j.driver.Driver;
import org.neo4j.driver.GraphDatabase;
import org.neo4j.driver.Record;
import org.neo4j.driver.Result;
import org.neo4j.driver.Session;
import org.neo4j.driver.Values;

class Neo4jAdapterTwoStepTest {
	private static final List<Map<String, Object>> CLASSES = List.of(Map.of(
			"className", "/Item", "attrs", List.of(
					Map.of("name", "id", "type", "varchar", "primaryKey", true),
					Map.of("name", "category", "type", "varchar"),
					Map.of("name", "scope", "type", "varchar"))));

	@Test
	void twoStepCountKeepsFirstStepSearchAndRowPermissionBindingsAtTheDriver() throws Exception {
		var permission = new UserDataPermission();
		permission.addRowPermission("role", "/Item", LogicQuery.and(new PropertyQuery("scope", "=", "permitted")));
		JSONObject source = JSONObject.of("class", "/Item", "variable", "i", "idx", 0, "conditions",
				JSONObject.of("properties", JSONObject.of("field", "category", "operator", "like", "value", "%pump%")));
		JSONObject first = step(source, JSONObject.of("variable", "i", "field", "id", "as", "n", "function", "count"));
		JSONObject details = step(source, JSONObject.of("variable", "i", "field", "id", "as", "detail_id"));
		details.getJSONObject("output").put("save_table", "/details");
		details.getJSONObject("output").put("to_user", false);
		JSONObject second = step(JSONObject.of("class", "/details", "variable", "t", "idx", 0),
				JSONObject.of("variable", "t", "field", "detail_id", "as", "n", "function", "count"));

		Captured direct = execute(restrict(dsl(first), permission), "n", statement -> List.of(2L));
		Captured twoStep = execute(restrict(dsl(details, second), permission), "n", statement -> List.of(2L));

		assertEquals(2, direct.parameters().size());
		assertTrue(direct.parameters().containsValue("permitted"));
		assertEquals(direct.parameters(), twoStep.parameters());
		assertEquals(direct.statement().substring(0, direct.statement().indexOf("\nreturn ")),
				twoStep.statement().substring(0, twoStep.statement().indexOf("\nwith ")));
		assertTrue(twoStep.statement().contains("count(detail_id)"), twoStep.statement());
		assertEquals(direct.rows(), twoStep.rows());
	}

	@Test
	void twoStepPlainDistinctUsesTheSameDistinctProjectionAsOneStep() throws Exception {
		JSONObject source = JSONObject.of("class", "/Item", "variable", "i", "idx", 0);
		JSONObject first = step(source, JSONObject.of("variable", "i", "field", "category", "as", "value", "distinct", true));
		JSONObject details = step(source, JSONObject.of("variable", "i", "field", "category", "as", "detail_category"));
		details.getJSONObject("output").put("save_table", "/details");
		details.getJSONObject("output").put("to_user", false);
		JSONObject second = step(JSONObject.of("class", "/details", "variable", "t", "idx", 0),
				JSONObject.of("variable", "t", "field", "detail_category", "as", "value", "distinct", true));
		Function<String, List<Object>> rows = statement -> statement.toLowerCase().contains("return distinct ")
				? List.of("pump") : List.of("pump", "pump");

		Captured direct = execute(dsl(first), "value", rows);
		Captured twoStep = execute(dsl(details, second), "value", rows);

		assertEquals(JSONArray.of(JSONObject.of("value", "pump")), direct.rows());
		assertEquals(direct.rows(), twoStep.rows());
		assertTrue(twoStep.statement().contains("distinct detail_category"), twoStep.statement());
	}

	private static JSONArray restrict(JSONArray dsl, UserDataPermission permission) {
		return JSONArray.of(DslPermissionUtil.addRowPermission(dsl.toJSONString(), CLASSES, permission)[0]);
	}

	private static JSONObject step(JSONObject object, JSONObject field) {
		JSONObject graph = JSONObject.of("patterns", JSONArray.of(JSONObject.of("objects", JSONArray.of(object))));
		return JSONObject.of("graph", graph, "output", JSONObject.of("to_user", true, "fields", JSONArray.of(field)));
	}

	private static JSONArray dsl(JSONObject... steps) {
		return JSONArray.of(JSONObject.of("answer", JSONObject.of("steps", JSONArray.of(steps))));
	}

	private static Captured execute(JSONArray dsl, String column, Function<String, List<Object>> values) throws Exception {
		var connection = new DataAdapterConnection();
		connection.put("url", "bolt://127.0.0.1:7687");
		connection.put("user", "test");
		connection.put("password", "test");
		var adapter = new Neo4jAdapter(connection, Map.of("classDef", CLASSES));
		var driver = mock(Driver.class);
		var session = mock(Session.class);
		when(driver.session()).thenReturn(session);
		List<String> statements = new ArrayList<>();
		List<Map<String, Object>> parameters = new ArrayList<>();
		when(session.run(anyString(), anyMap())).thenAnswer(call -> {
			String statement = call.getArgument(0);
			statements.add(statement);
			parameters.add(Map.copyOf(call.getArgument(1)));
			var hits = values.apply(statement).iterator();
			var result = mock(Result.class);
			when(result.hasNext()).thenAnswer(ignored -> hits.hasNext());
			when(result.next()).thenAnswer(ignored -> {
				var record = mock(Record.class);
				when(record.keys()).thenReturn(List.of(column));
				when(record.get(column)).thenReturn(Values.value(hits.next()));
				return record;
			});
			return result;
		});
		try (var factory = mockStatic(GraphDatabase.class)) {
			factory.when(() -> GraphDatabase.driver(anyString(), any(AuthToken.class))).thenReturn(driver);
			String response = adapter.executeDsl(dsl.toJSONString(), "test", DslExecutionMode.OPTIMIZED, new ArrayList<>());
			JSONArray rows = JSONArray.parseArray(response).getJSONObject(0).getJSONArray("answer");
			return new Captured(statements.getFirst(), parameters.getFirst(), rows);
		}
	}

	private record Captured(String statement, Map<String, Object> parameters, JSONArray rows) {}
}
