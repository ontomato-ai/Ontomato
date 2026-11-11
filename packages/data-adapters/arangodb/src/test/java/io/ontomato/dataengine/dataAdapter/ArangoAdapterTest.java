package io.ontomato.dataengine.dataAdapter;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.arangodb.ArangoDB;
import com.arangodb.ArangoCursor;
import com.arangodb.ArangoDatabase;

import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dataAdapter.test.AbstractDataAdapterTest;
import io.ontomato.dataengine.dataAdapter.test.DataAdapterCapability;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Full contract run for the ArangoDB adapter against a real instance.
 *
 * <p>Provisioning: {@code ONTOMATO_TEST_ARANGO_URL} (plus optional
 * {@code ONTOMATO_TEST_ARANGO_USER} and {@code ONTOMATO_TEST_ARANGO_PASSWORD}) points at an external
 * server; the default is the local test instance at {@code http://127.0.0.1:18529}. When neither the
 * environment nor a reachable local instance exists, the class is skipped, not failed. No container
 * is started: the test deliberately uses the running 3.12.4 community server.</p>
 *
 * <p>ArangoDB is non-JDBC, so the JDBC read-back helpers ({@link #selectAll}, {@link #countRows})
 * are overridden to run AQL through the native driver. The graph fixture is three classes
 * (person → org → project) linked by two real edge collections (works_at, belongs_to), mirroring the
 * Neo4j adapter.</p>
 */
class ArangoAdapterTest extends AbstractDataAdapterTest {

	private static final String EXTERNAL_URL = System.getenv("ONTOMATO_TEST_ARANGO_URL");
	private static final String EXTERNAL_USER = System.getenv("ONTOMATO_TEST_ARANGO_USER");
	private static final String EXTERNAL_PASSWORD = System.getenv("ONTOMATO_TEST_ARANGO_PASSWORD");
	private static final String DEFAULT_URL = "http://127.0.0.1:18529";

	private static String url;
	private static String user;
	private static String password;

	private final String ns = "it_" + System.nanoTime() + "_";

	@BeforeAll
	static void connectDatabase() {
		url = EXTERNAL_URL == null ? DEFAULT_URL : EXTERNAL_URL;
		user = EXTERNAL_USER == null ? "root" : EXTERNAL_USER;
		password = EXTERNAL_PASSWORD == null ? "ontomato" : EXTERNAL_PASSWORD;
		org.junit.jupiter.api.Assumptions.assumeTrue(reachable(url),
				"ArangoDB is not reachable at " + url + " and ONTOMATO_TEST_ARANGO_URL is not set; skipping ArangoDB contract tests");
	}

	private static boolean reachable(String candidate) {
		try (java.net.Socket socket = new java.net.Socket()) {
			java.net.URI uri = java.net.URI.create(ArangoAdapter.httpBaseUrl(candidate));
			socket.connect(new java.net.InetSocketAddress(uri.getHost(), uri.getPort() < 0 ? 80 : uri.getPort()), 2000);
			return true;
		} catch (Exception e) {
			return false;
		}
	}

	private static ArangoDB client() {
		String base = ArangoAdapter.httpBaseUrl(url);
		String authority = base.substring(base.indexOf("://") + 3);
		int colon = authority.lastIndexOf(':');
		String host = colon < 0 ? authority : authority.substring(0, colon);
		int port = colon < 0 ? 8529 : Integer.parseInt(authority.substring(colon + 1));
		return new ArangoDB.Builder().host(host, port).user(user).password(password).build();
	}

	private static ArangoDatabase database(ArangoDB client) {
		return client.db(ArangoAdapter.databaseName(url));
	}

	@Override
	protected DataAdapter newAdapter(JSONObject jsonRule) {
		DataAdapterConnection connection = new DataAdapterConnection();
		connection.setUrl(url);
		connection.setUser(user);
		connection.setPassword(password);
		return new ArangoAdapter(connection, jsonRule);
	}

	@Override
	protected Set<DataAdapterCapability> capabilities() {
		return EnumSet.of(
				DataAdapterCapability.READ_QUERY,
				DataAdapterCapability.SAMPLE_DATA,
				DataAdapterCapability.NAMESPACE_LIFECYCLE,
				DataAdapterCapability.CLASS_SCHEMA,
				DataAdapterCapability.OBJECT_CRUD,
				DataAdapterCapability.EDGE_CRUD,
				DataAdapterCapability.RELATIONSHIP_EDGES,
				DataAdapterCapability.GRAPH_QUERY,
				DataAdapterCapability.VECTOR_ATTR);
	}

	@Override
	protected String namespace() {
		return ns;
	}

	@Override
	protected String primaryKey() {
		return "id";
	}

	@Override
	protected JSONObject classDef() {
		JSONObject classDef = new JSONObject();
		classDef.put("className", "person");
		JSONArray attrs = new JSONArray();
		attrs.add(attr("id", "varchar", true));
		attrs.add(attr("name", "varchar", false));
		attrs.add(attr("bio", "text", false));
		attrs.add(attr("age", "int", false));
		attrs.add(attr("score", "long", false));
		attrs.add(attr("height", "double", false));
		attrs.add(attr("birthday", "date", false));
		attrs.add(attr("created_at", "timestamp", false));
		classDef.put("attrs", attrs);
		return classDef;
	}

	@Override
	protected JSONArray testObjects() {
		return JSONArray.of(
				person("1", "Alice", "engineer", 25, 100L, 1.70, "1990-01-01", "2020-01-01 10:00:00"),
				person("2", "Bob", "data scientist", 30, 200L, 1.80, "1991-02-02", "2020-02-02 11:00:00"),
				person("3", "Carol", null, 35, 300L, 1.90, "1992-03-03", "2020-03-03 12:00:00"),
				person("4", "Dave", null, 40, 400L, 2.00, "1993-04-04", "2020-04-04 13:00:00"),
				person("5", "Eve", "manager", 45, 500L, 1.60, "1994-05-05", "2020-05-05 14:00:00"));
	}

	private JSONObject person(String id, String name, String bio, int age, long score, double height,
			String birthday, String createdAt) {
		JSONObject o = new JSONObject();
		o.put("id", id);
		o.put("name", name);
		o.put("bio", bio);
		o.put("age", age);
		o.put("score", score);
		o.put("height", height);
		o.put("birthday", birthday);
		o.put("created_at", createdAt);
		return o;
	}

	// ----------------------------------------------------------------------------------
	// Graph fixture: person -works_at-> org -belongs_to-> project
	// ----------------------------------------------------------------------------------

	@Override
	protected List<JSONObject> graphClassDefs() {
		JSONObject person = new JSONObject();
		person.put("className", "person");
		person.put("attrs", JSONArray.of(
				attr("id", "varchar", true),
				attr("name", "varchar", false),
				attr("age", "int", false),
				attr("org_id", "varchar", false)));

		JSONObject org = new JSONObject();
		org.put("className", "org");
		org.put("attrs", JSONArray.of(
				attr("id", "varchar", true),
				attr("title", "varchar", false),
				attr("project_id", "varchar", false)));

		JSONObject project = new JSONObject();
		project.put("className", "project");
		project.put("attrs", JSONArray.of(
				attr("id", "varchar", true),
				attr("name", "varchar", false)));

		return List.of(person, org, project);
	}

	/** A relationship definition carries only its two classes; an edge is a real edge document. */
	@Override
	protected JSONObject relationshipRule() {
		JSONObject rule = new JSONObject();
		JSONObject worksAt = new JSONObject();
		worksAt.put("fromclass", "person");
		worksAt.put("toclass", "org");
		rule.put("works_at", worksAt);

		JSONObject belongsTo = new JSONObject();
		belongsTo.put("fromclass", "org");
		belongsTo.put("toclass", "project");
		rule.put("belongs_to", belongsTo);
		return rule;
	}

	/** There is no key field in the seed to imply edges, so seedGraph materializes them through createEdge. */
	@Override
	protected List<SeedEdge> seedEdges() {
		return List.of(
				new SeedEdge("works_at", 0, "p1", 1, "o1"),
				new SeedEdge("works_at", 0, "p2", 1, "o1"),
				new SeedEdge("works_at", 0, "p3", 1, "o2"),
				new SeedEdge("works_at", 0, "p4", 1, "o2"),
				new SeedEdge("belongs_to", 1, "o1", 2, "pr1"),
				new SeedEdge("belongs_to", 1, "o2", 2, "pr2"));
	}

	@Override
	protected Map<String, JSONArray> graphSeed() {
		JSONArray persons = JSONArray.of(
				gPerson("p1", "Alice", 25, "o1"),
				gPerson("p2", "Bob", 30, "o1"),
				gPerson("p3", "Carol", 35, "o2"),
				gPerson("p4", "Dave", 40, "o2"));
		JSONArray orgs = JSONArray.of(
				gOrg("o1", "Engineering", "pr1"),
				gOrg("o2", "Sales", "pr2"));
		JSONArray projects = JSONArray.of(
				gProject("pr1", "Alpha"),
				gProject("pr2", "Beta"));
		return Map.of("person", persons, "org", orgs, "project", projects);
	}

	private JSONObject gPerson(String id, String name, int age, String orgId) {
		JSONObject o = new JSONObject();
		o.put("id", id);
		o.put("name", name);
		o.put("age", age);
		o.put("org_id", orgId);
		return o;
	}

	private JSONObject gOrg(String id, String title, String projectId) {
		JSONObject o = new JSONObject();
		o.put("id", id);
		o.put("title", title);
		o.put("project_id", projectId);
		return o;
	}

	private JSONObject gProject(String id, String name) {
		JSONObject o = new JSONObject();
		o.put("id", id);
		o.put("name", name);
		return o;
	}

	private static JSONObject attr(String name, String type, boolean primaryKey) {
		JSONObject attr = new JSONObject();
		attr.put("name", name);
		attr.put("type", type);
		attr.put("primaryKey", primaryKey);
		attr.put("enable", true);
		return attr;
	}

	// ----------------------------------------------------------------------------------
	// JDBC read-back helpers, reimplemented over the native driver (ArangoDB is non-JDBC)
	// ----------------------------------------------------------------------------------

	@SuppressWarnings("rawtypes")
	@Override
	protected List<JSONObject> selectAll(String className) throws Exception {
		List<JSONObject> rows = new ArrayList<>();
		ArangoDB client = client();
		try {
			ArangoCursor<Map> cursor = database(client).query("FOR doc IN `" + fullTable(className) + "` RETURN doc",
					Map.class, Map.of());
			Map<String, String> types = attrTypes(className);
			while (cursor.hasNext()) {
				JSONObject row = new JSONObject(cursor.next());
				// ArangoDB numbers carry no int/double marker; restore the declared double form.
				for (Map.Entry<String, String> type : types.entrySet()) {
					if ("double".equals(type.getValue()) && row.get(type.getKey()) instanceof Number number) {
						row.put(type.getKey(), number.doubleValue());
					}
				}
				rows.add(row);
			}
		} finally {
			client.shutdown();
		}
		return rows;
	}

	private Map<String, String> attrTypes(String className) {
		List<JSONObject> defs = new ArrayList<>(graphClassDefs());
		defs.add(classDef());
		Map<String, String> types = new java.util.HashMap<>();
		for (JSONObject def : defs) {
			if (className.equals(def.getString("className"))) {
				JSONArray attrs = def.getJSONArray("attrs");
				for (int i = 0; i < attrs.size(); i++) {
					types.put(attrs.getJSONObject(i).getString("name"), attrs.getJSONObject(i).getString("type"));
				}
			}
		}
		return types;
	}

	@Override
	protected long countRows(String className) throws Exception {
		ArangoDB client = client();
		try {
			ArangoCursor<Long> cursor = database(client).query(
					"FOR doc IN `" + fullTable(className) + "` COLLECT WITH COUNT INTO c RETURN c",
					Long.class, Map.of());
			return cursor.hasNext() ? cursor.next() : 0L;
		} finally {
			client.shutdown();
		}
	}

	// ----------------------------------------------------------------------------------
	// Adapter-specific tests
	// ----------------------------------------------------------------------------------

	/** The connection probe is not covered by the JDBC-gated contract test, so assert it directly. */
	@Test
	void connectionProbeReportsCollections() throws Exception {
		JSONObject report = newAdapter().testConnection();
		assertEquals("catalog", report.getString("kind"));
		assertEquals("ArangoDB", report.getString("databaseProduct"));
		assertFalse(report.getString("databaseVersion").isBlank());
		assertEquals("_system", report.getString("catalog"));
		assertEquals("", report.getString("schema"));
		assertNotNull(report.getJSONArray("tables"));
	}

	/**
	 * A two-step DSL: the first step selects and projects the subgraph (flattening it into rows), the
	 * second step groups/aggregates/sorts over those rows. The adapter nests step 0 as an AQL subquery.
	 */
	@Test
	void readTwoStepFlattensThenGroups() throws Exception {
		seedGraph();
		JSONObject source = JSONObject.of("idx", 0, "variable", "p", "class", namespace() + "person");
		JSONObject step0 = JSONObject.of(
				"graph", JSONObject.of("patterns", JSONArray.of(JSONObject.of("objects", JSONArray.of(source)))),
				"output", JSONObject.of(
						"to_user", false,
						"save_table", "/t1",
						"fields", JSONArray.of(
								JSONObject.of("variable", "p", "field", "org_id", "as", "org_id"),
								JSONObject.of("variable", "p", "field", "id", "as", "person_id"))));

		JSONObject intermediate = JSONObject.of("idx", 0, "variable", "t1", "class", "/t1");
		JSONObject step1 = JSONObject.of(
				"graph", JSONObject.of("patterns", JSONArray.of(JSONObject.of("objects", JSONArray.of(intermediate)))),
				"output", JSONObject.of(
						"to_user", true,
						"fields", JSONArray.of(
								JSONObject.of("variable", "t1", "field", "org_id", "as", "org_id"),
								JSONObject.of("variable", "t1", "field", "person_id", "function", "count", "as", "cnt")),
						"group_by", JSONObject.of("fields", JSONArray.of(JSONObject.of("variable", "t1", "field", "org_id"))),
						"sort", JSONObject.of("fields", JSONArray.of(JSONObject.of("field", "org_id", "order", "asc")))));

		JSONArray rows = readQuery(JSONArray.of(
				JSONObject.of("answer", JSONObject.of("steps", JSONArray.of(step0, step1)))).toJSONString());

		assertEquals(2, rows.size());
		assertEquals(2L, ((Number) rows.getJSONObject(0).get("cnt")).longValue());
		assertEquals(2L, ((Number) rows.getJSONObject(1).get("cnt")).longValue());
		dropGraph();
	}

	/** The legacy object-graph entry returns the answer rows through the same AQL translation. */
	@Test
	@SuppressWarnings("unchecked")
	void graphQueryPathReturnsRows() throws Exception {
		seedGraph();
		JSONObject dsl = JSON.parseArray(singleStepDsl(JSONArray.of(readObject(0, "p", 0)), null,
				JSONArray.of(readField("p", "name", "person_name")), null, null, null)).getJSONObject(0);
		Map<String, Object> result = newAdapter(prefixedGraphRule()).query(dsl, "", "", null, new DataRagConfig());
		assertFalse(result.containsKey("error"), String.valueOf(result.get("error")));
		assertTrue(result.get("data") instanceof List<?>);
		List<Object> data = (List<Object>) result.get("data");
		assertEquals(1, data.size());
		Object answer = ((Map<?, ?>) data.get(0)).get("answer");
		assertTrue(answer instanceof List<?>);
		assertEquals(totalPersonCount(), ((List<Object>) answer).size());
		dropGraph();
	}

	/** A vector attribute is the JSON-array text field, read back through queryVectorAttr. */
	@Test
	void vectorAttrRoundTrip() throws Exception {
		JSONObject def = new JSONObject();
		def.put("className", "doc");
		def.put("attrs", JSONArray.of(
				attr("id", "varchar", true),
				attr("vec", "vector", false)));
		DataAdapter adapter = newAdapter();
		adapter.createClass(namespace(), def);

		JSONObject object = new JSONObject();
		object.put("id", "v1");
		object.put("vec", JSONArray.of(JSONObject.of("path", "a.txt", "text", "hello")));
		adapter.insertObjects(namespace(), def, JSONArray.of(object));

		JSONObject physical = new JSONObject();
		physical.put("className", namespace() + "doc");
		physical.put("attrs", def.getJSONArray("attrs"));
		JSONArray vector = adapter.queryVectorAttr(physical, "vec", "v1");
		assertEquals(1, vector.size());
		assertEquals("a.txt", vector.getJSONObject(0).getString("path"));
		assertEquals("hello", vector.getJSONObject(0).getString("text"));

		adapter.dropNamespace(namespace());
	}

	/** Sample data is one row of the named class, with long text values truncated to 100 characters. */
	@Test
	void sampleDataReadsOneTruncatedRow() throws Exception {
		DataAdapter adapter = newAdapter();
		adapter.createClass(namespace(), classDef());
		String longBio = "x".repeat(120);
		JSONObject object = person("s1", "Sample", longBio, 20, 1L, 1.5, "1990-01-01", "2020-01-01 10:00:00");
		adapter.insertObjects(namespace(), classDef(), JSONArray.of(object));

		JSONObject row = JSON.parseObject(adapter.querySampleDataByClassName(namespace() + "person",
				List.of("id", "name", "bio")));
		assertEquals("s1", row.getString("id"));
		assertEquals("Sample", row.getString("name"));
		assertEquals("x".repeat(100) + "...", row.getString("bio"));

		adapter.dropNamespace(namespace());
	}
}
