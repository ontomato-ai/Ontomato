package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.config.multisource.ClassRoute;
import io.ontomato.dataengine.config.multisource.DataSourceEntry;
import io.ontomato.dataengine.config.multisource.MultiDataSourceDefinition;

/**
 * The second layer of the multi-source tests over a real PostgreSQL, where the adapter actually
 * renders SQL — so this is the honest check that wrapping it changes nothing about a query whose
 * rendering depends on the ontomap's class definitions.
 *
 * <p>Provisioning matches {@code PostgreAdapterTest}: a Testcontainers instance when Docker is
 * available, an external URL through {@code ONTOMATO_TEST_PG_URL} otherwise, and a skip (not a
 * failure) when neither is present.</p>
 */
class MultiDataSourcePostgreTest {

	private static final String EXTERNAL_URL = System.getenv("ONTOMATO_TEST_PG_URL");
	private static final String EXTERNAL_USER = System.getenv("ONTOMATO_TEST_PG_USER");
	private static final String EXTERNAL_PASSWORD = System.getenv("ONTOMATO_TEST_PG_PASSWORD");

	private static String url;
	private static String user;
	private static String password;

	private static final String PERSON = "md_person_" + Long.toHexString(System.nanoTime());
	private static final String INVOICE = "md_invoice_" + Long.toHexString(System.nanoTime());

	@BeforeAll
	static void startDatabase() throws Exception {
		if (EXTERNAL_URL != null) {
			url = EXTERNAL_URL;
			user = EXTERNAL_USER == null ? "postgres" : EXTERNAL_USER;
			password = EXTERNAL_PASSWORD == null ? "" : EXTERNAL_PASSWORD;
		} else {
			Assumptions.assumeTrue(isDockerAvailable(),
					"Docker is not running and ONTOMATO_TEST_PG_URL is not set; skipping multi-source PostgreSQL tests");
			org.testcontainers.containers.PostgreSQLContainer<?> pg =
					new org.testcontainers.containers.PostgreSQLContainer<>("postgres:16-alpine");
			pg.start();
			url = pg.getJdbcUrl();
			user = pg.getUsername();
			password = pg.getPassword();
		}
		createTable(PERSON, "crm-only");
		createTable(INVOICE, "erp-only");
	}

	private static boolean isDockerAvailable() {
		try {
			return org.testcontainers.DockerClientFactory.instance().isDockerAvailable();
		} catch (Throwable t) {
			return false;
		}
	}

	private static void createTable(String table, String row) throws Exception {
		try (Connection connection = DriverManager.getConnection(url, user, password);
				Statement statement = connection.createStatement()) {
			statement.execute("DROP TABLE IF EXISTS " + table);
			statement.execute("CREATE TABLE " + table + "(id VARCHAR PRIMARY KEY, name VARCHAR)");
			statement.execute("INSERT INTO " + table + " VALUES ('1', '" + row + "')");
		}
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

	private static DataAdapterConnection connection() {
		DataAdapterConnection connection = new DataAdapterConnection();
		connection.put("url", url);
		connection.put("user", user);
		connection.put("password", password);
		return connection;
	}

	private static JSONArray rowsOf(String result) {
		return JSON.parseArray(result).getJSONObject(0).getJSONArray("answer");
	}

	private static DataSourceEntry source(String id) {
		DataSourceEntry entry = new DataSourceEntry();
		entry.setId(id);
		entry.setAdapterType("postgresql");
		entry.setConnection(connection());
		entry.setLabel(id);
		return entry;
	}

	private static ClassRoute route(String className, String sourceId) {
		ClassRoute route = new ClassRoute();
		route.setForOntoMap(className);
		route.setSourceId(sourceId);
		return route;
	}

	/** A multi adapter whose sources all point at the one test instance. */
	private MultiDataSourceAdapter multi(JSONObject jsonRule, List<String> sourceIds, List<ClassRoute> routes) {
		BusinessConfig businessConfig = new BusinessConfig();
		businessConfig.setDataAdapter("multi");
		MultiDataSourceDefinition definition = new MultiDataSourceDefinition();
		for (String sourceId : sourceIds) {
			definition.getDataSources().add(source(sourceId));
		}
		definition.getClasses().addAll(routes);
		businessConfig.setMultiDataSource(definition);
		DataAdapterRegistry registry = new DataAdapterRegistry(List.of(new PostgreAdapterProvider()), new DataRagConfig());
		return new MultiDataSourceAdapter(registry, businessConfig, new DataRagConfig(), jsonRule);
	}

	// ----------------------------------------------------------------------------------
	// Tests
	// ----------------------------------------------------------------------------------

	@Test
	void wrappingARealSqlAdapterChangesNothing() throws Exception {
		JSONObject jsonRule = jsonRule(PERSON);
		DataAdapter direct = new PostgreAdapter(connection(), jsonRule);
		MultiDataSourceAdapter wrapped = multi(jsonRule, List.of("crm"), List.of(route(PERSON, "crm")));

		String directResult = direct.executeDsl(dsl(PERSON), "s", null, new ArrayList<>());
		String wrappedResult = wrapped.executeDsl(dsl(PERSON), "s", null, new ArrayList<>());

		assertEquals(1, rowsOf(directResult).size(), directResult);
		assertEquals("crm-only", rowsOf(directResult).getJSONObject(0).getString("name"));
		assertEquals(rowsOf(directResult), rowsOf(wrappedResult));
	}

	@Test
	void eachClassRoutesToItsOwnSource() throws Exception {
		JSONObject jsonRule = jsonRule(PERSON, INVOICE);
		MultiDataSourceAdapter adapter = multi(jsonRule, List.of("crm", "erp"),
				List.of(route(PERSON, "crm"), route(INVOICE, "erp")));

		assertEquals("crm-only", rowsOf(adapter.executeDsl(dsl(PERSON), "s", null, new ArrayList<>()))
				.getJSONObject(0).getString("name"));
		assertEquals("erp-only", rowsOf(adapter.executeDsl(dsl(INVOICE), "s", null, new ArrayList<>()))
				.getJSONObject(0).getString("name"));
	}

	@Test
	void aCrossSourceQueryIsRejectedAgainstRealTables() throws Exception {
		JSONObject jsonRule = jsonRule(PERSON, INVOICE);
		MultiDataSourceAdapter adapter = multi(jsonRule, List.of("crm", "erp"),
				List.of(route(PERSON, "crm"), route(INVOICE, "erp")));

		JSONObject first = new JSONObject().fluentPut("idx", 0).fluentPut("variable", "a").fluentPut("class", PERSON);
		JSONObject second = new JSONObject().fluentPut("idx", 1).fluentPut("variable", "b").fluentPut("class", INVOICE);
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
