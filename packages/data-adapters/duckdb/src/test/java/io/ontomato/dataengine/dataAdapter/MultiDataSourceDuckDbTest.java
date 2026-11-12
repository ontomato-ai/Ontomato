package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.config.multisource.ClassRoute;
import io.ontomato.dataengine.config.multisource.DataSourceEntry;
import io.ontomato.dataengine.config.multisource.MultiDataSourceDefinition;

/**
 * The second layer of the multi-source tests: real databases, no stubs.
 *
 * <p>DuckDB is embedded, so this needs no Docker and no server — it is the cheapest honest way to
 * prove the two things the stub tests cannot: that wrapping a real adapter changes nothing about its
 * answer, and that a route actually reaches the intended database rather than merely calling the
 * intended stub. It lives in the DuckDB module on purpose: the fixture that knows how to stand a
 * database up belongs with the adapter, not with the router.</p>
 */
class MultiDataSourceDuckDbTest {

	@TempDir
	Path dir;

	// ----------------------------------------------------------------------------------
	// Real databases
	// ----------------------------------------------------------------------------------

	/** A file DuckDB with one table and a single distinguishing row. */
	private String database(String fileName, String table, String row) throws Exception {
		String url = "jdbc:duckdb:" + dir.resolve(fileName);
		try (Connection connection = DriverManager.getConnection(url); Statement statement = connection.createStatement()) {
			statement.execute("CREATE TABLE " + table + "(id VARCHAR PRIMARY KEY, name VARCHAR)");
			statement.execute("INSERT INTO " + table + " VALUES ('1', '" + row + "')");
		}
		return url;
	}

	// ----------------------------------------------------------------------------------
	// Fixtures
	// ----------------------------------------------------------------------------------

	private static JSONObject classDef(String className) {
		JSONArray attrs = new JSONArray();
		attrs.add(attr("id", "varchar", true));
		attrs.add(attr("name", "varchar", false));
		return new JSONObject().fluentPut("className", className).fluentPut("attrs", attrs);
	}

	private static JSONObject attr(String name, String type, boolean primaryKey) {
		JSONObject attr = new JSONObject();
		attr.put("name", name);
		attr.put("type", type);
		attr.put("primaryKey", primaryKey);
		return attr;
	}

	private static JSONObject jsonRule(String... classNames) {
		JSONArray classDefs = new JSONArray();
		for (String className : classNames) {
			classDefs.add(classDef(className));
		}
		return new JSONObject().fluentPut("classDef", classDefs).fluentPut("relationship_rule", new JSONObject());
	}

	/** One step selecting one field of one class. */
	private static String dsl(String className) {
		JSONObject object = new JSONObject().fluentPut("idx", 0).fluentPut("variable", "v").fluentPut("class", className);
		JSONObject pattern = new JSONObject().fluentPut("objects", JSONArray.of(object));
		JSONObject graph = new JSONObject().fluentPut("patterns", JSONArray.of(pattern));
		JSONObject field = new JSONObject().fluentPut("variable", "v").fluentPut("field", "name").fluentPut("as", "name");
		JSONObject output = new JSONObject().fluentPut("fields", JSONArray.of(field));
		JSONObject step = new JSONObject().fluentPut("graph", graph).fluentPut("output", output);
		JSONObject answer = new JSONObject().fluentPut("steps", JSONArray.of(step));
		return JSONArray.of(new JSONObject().fluentPut("answer", answer)).toJSONString();
	}

	private DataAdapterConnection connection(String url) {
		DataAdapterConnection connection = new DataAdapterConnection();
		connection.put("url", url);
		return connection;
	}

	private static JSONArray rowsOf(String result) {
		return JSON.parseArray(result).getJSONObject(0).getJSONArray("answer");
	}

	/** A multi adapter over the given sources, each wired to its own real DuckDB file. */
	private MultiDataSourceAdapter multi(JSONObject jsonRule, List<DataSourceEntry> sources, List<ClassRoute> routes) {
		BusinessConfig businessConfig = new BusinessConfig();
		businessConfig.setDataAdapter("multi");
		MultiDataSourceDefinition definition = new MultiDataSourceDefinition();
		definition.getDataSources().addAll(sources);
		definition.getClasses().addAll(routes);
		businessConfig.setMultiDataSource(definition);
		DataAdapterRegistry registry = new DataAdapterRegistry(List.of(new DuckDBAdapterProvider()), new DataRagConfig());
		return new MultiDataSourceAdapter(registry, businessConfig, new DataRagConfig(), jsonRule);
	}

	private DataSourceEntry source(String id, String url) {
		DataSourceEntry entry = new DataSourceEntry();
		entry.setId(id);
		entry.setAdapterType("duckdb");
		entry.setConnection(connection(url));
		entry.setLabel(id);
		return entry;
	}

	private static ClassRoute route(String className, String sourceId) {
		ClassRoute route = new ClassRoute();
		route.setForOntoMap(className);
		route.setSourceId(sourceId);
		return route;
	}

	// ----------------------------------------------------------------------------------
	// Transparency: the wrapper must not change a real adapter's answer
	// ----------------------------------------------------------------------------------

	@Test
	void wrappingARealAdapterChangesNothing() throws Exception {
		String url = database("one.duckdb", "person", "solo");
		JSONObject jsonRule = jsonRule("person");

		DataAdapter direct = new DuckDBAdapter(connection(url), jsonRule);
		MultiDataSourceAdapter wrapped = multi(jsonRule, List.of(source("crm", url)), List.of(route("person", "crm")));

		String directResult = direct.executeDsl(dsl("person"), "s", null, new ArrayList<>());
		String wrappedResult = wrapped.executeDsl(dsl("person"), "s", null, new ArrayList<>());

		assertEquals(1, rowsOf(directResult).size(), directResult);
		assertEquals(rowsOf(directResult), rowsOf(wrappedResult));
	}

	// ----------------------------------------------------------------------------------
	// Routing reaches the intended real database
	// ----------------------------------------------------------------------------------

	@Test
	void eachClassReadsItsOwnRealDatabase() throws Exception {
		String crmUrl = database("crm.duckdb", "person", "crm-only");
		String erpUrl = database("erp.duckdb", "invoice", "erp-only");
		JSONObject jsonRule = jsonRule("person", "invoice");

		BusinessConfig businessConfig = new BusinessConfig();
		businessConfig.setDataAdapter("multi");
		MultiDataSourceDefinition definition = new MultiDataSourceDefinition();
		definition.getDataSources().add(source("crm", crmUrl));
		definition.getDataSources().add(source("erp", erpUrl));
		definition.getClasses().add(route("person", "crm"));
		definition.getClasses().add(route("invoice", "erp"));
		businessConfig.setMultiDataSource(definition);
		DataAdapterRegistry registry = new DataAdapterRegistry(List.of(new DuckDBAdapterProvider()), new DataRagConfig());
		MultiDataSourceAdapter adapter = new MultiDataSourceAdapter(registry, businessConfig, new DataRagConfig(), jsonRule);

		JSONArray people = rowsOf(adapter.executeDsl(dsl("person"), "s", null, new ArrayList<>()));
		JSONArray invoices = rowsOf(adapter.executeDsl(dsl("invoice"), "s", null, new ArrayList<>()));

		assertEquals("crm-only", people.getJSONObject(0).getString("name"));
		assertEquals("erp-only", invoices.getJSONObject(0).getString("name"));
	}

	@Test
	void aCrossSourceQueryIsRejectedBeforeEitherDatabaseIsTouched() throws Exception {
		String crmUrl = database("crm2.duckdb", "person", "crm-only");
		String erpUrl = database("erp2.duckdb", "invoice", "erp-only");
		JSONObject jsonRule = jsonRule("person", "invoice");

		BusinessConfig businessConfig = new BusinessConfig();
		businessConfig.setDataAdapter("multi");
		MultiDataSourceDefinition definition = new MultiDataSourceDefinition();
		definition.getDataSources().add(source("crm", crmUrl));
		definition.getDataSources().add(source("erp", erpUrl));
		definition.getClasses().add(route("person", "crm"));
		definition.getClasses().add(route("invoice", "erp"));
		businessConfig.setMultiDataSource(definition);
		DataAdapterRegistry registry = new DataAdapterRegistry(List.of(new DuckDBAdapterProvider()), new DataRagConfig());
		MultiDataSourceAdapter adapter = new MultiDataSourceAdapter(registry, businessConfig, new DataRagConfig(), jsonRule);

		// One step naming both classes: real tables, real routing, and it must still be refused.
		JSONObject first = new JSONObject().fluentPut("idx", 0).fluentPut("variable", "a").fluentPut("class", "person");
		JSONObject second = new JSONObject().fluentPut("idx", 1).fluentPut("variable", "b").fluentPut("class", "invoice");
		JSONObject pattern = new JSONObject().fluentPut("objects", JSONArray.of(first, second));
		JSONObject graph = new JSONObject().fluentPut("patterns", JSONArray.of(pattern));
		JSONObject field = new JSONObject().fluentPut("variable", "a").fluentPut("field", "name").fluentPut("as", "name");
		JSONObject step = new JSONObject().fluentPut("graph", graph)
				.fluentPut("output", new JSONObject().fluentPut("fields", JSONArray.of(field)));
		String crossSource = JSONArray.of(new JSONObject().fluentPut("answer",
				new JSONObject().fluentPut("steps", JSONArray.of(step)))).toJSONString();

		DslContractViolationException failure = assertThrows(DslContractViolationException.class,
				() -> adapter.executeDsl(crossSource, "s", null, new ArrayList<>()));

		assertEquals(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT, failure.getViolations().get(0).getCode());
	}
}
