package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.bson.Document;
import org.bson.types.Decimal128;
import org.bson.types.ObjectId;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.mongodb.ConnectionString;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;

import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dataAdapter.test.AbstractDataAdapterTest;
import io.ontomato.dataengine.dataAdapter.test.DataAdapterCapability;

/**
 * Full contract run for the MongoDB adapter against a real instance.
 *
 * <p>Provisioning: {@code ONTOMATO_TEST_MONGODB_URL} points at a running MongoDB; the local contract
 * environment uses {@code mongodb://127.0.0.1:27019}. MongoDB is non-JDBC, so the JDBC read-back
 * helpers ({@link #selectAll}, {@link #countRows}) read through the driver instead. The graph fixture
 * mirrors the relational adapters: person -works_at-> org -belongs_to-> project, with the edge stored
 * as a key field on the source document.</p>
 */
class MongoAdapterTest extends AbstractDataAdapterTest {

	private static final String EXTERNAL_URL = System.getenv("ONTOMATO_TEST_MONGODB_URL");
	private static final String DEFAULT_URL = "mongodb://127.0.0.1:27019";

	private static String url;

	private final String ns = "it_" + System.nanoTime() + "_";

	@BeforeAll
	static void startDatabase() {
		url = EXTERNAL_URL == null || EXTERNAL_URL.isBlank() ? DEFAULT_URL : EXTERNAL_URL;
	}

	private String databaseName() {
		String database = new ConnectionString(url).getDatabase();
		return database == null || database.isBlank() ? "test" : database;
	}

	@Override
	protected DataAdapter newAdapter(JSONObject jsonRule) {
		DataAdapterConnection connection = new DataAdapterConnection();
		connection.setUrl(url);
		return new MongoAdapter(connection, jsonRule);
	}

	/**
	 * The operations this adapter actually passes. MongoDB is non-JDBC (no {@code JDBC_CONNECTION}) and
	 * stores edges as key fields (no {@code RELATIONSHIP_EDGES}).
	 */
	@Override
	protected Set<DataAdapterCapability> capabilities() {
		return EnumSet.of(
				DataAdapterCapability.READ_QUERY,
				DataAdapterCapability.SAMPLE_DATA,
				DataAdapterCapability.NAMESPACE_LIFECYCLE,
				DataAdapterCapability.CLASS_SCHEMA,
				DataAdapterCapability.OBJECT_CRUD,
				DataAdapterCapability.EDGE_CRUD,
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
		classDef.put("attrs", JSONArray.of(
				attr("id", "varchar", true),
				attr("name", "varchar", false),
				attr("bio", "text", false),
				attr("age", "int", false),
				attr("score", "long", false),
				attr("height", "double", false),
				attr("birthday", "date", false),
				attr("created_at", "timestamp", false)));
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

	@Override
	protected JSONObject relationshipRule() {
		JSONObject rule = new JSONObject();
		JSONObject worksAt = new JSONObject();
		worksAt.put("fromclass", "person");
		worksAt.put("toclass", "org");
		worksAt.put("fromField", "org_id");
		worksAt.put("toField", "id");
		rule.put("works_at", worksAt);

		JSONObject belongsTo = new JSONObject();
		belongsTo.put("fromclass", "org");
		belongsTo.put("toclass", "project");
		belongsTo.put("fromField", "project_id");
		belongsTo.put("toField", "id");
		rule.put("belongs_to", belongsTo);
		return rule;
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

	@Override
	protected String joinField(int i) {
		return i == 0 ? "org_id" : "project_id";
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

	// ----------------------------------------------------------------------------------
	// Non-JDBC read-back overrides
	// ----------------------------------------------------------------------------------

	@Override
	protected List<JSONObject> selectAll(String className) throws Exception {
		try (MongoClient client = MongoClients.create(url)) {
			List<JSONObject> rows = new ArrayList<>();
			for (Document document : client.getDatabase(databaseName()).getCollection(fullTable(className)).find()) {
				JSONObject row = new JSONObject();
				for (Map.Entry<String, Object> entry : document.entrySet()) {
					if (!"_id".equals(entry.getKey())) {
						row.put(entry.getKey(), plain(entry.getValue()));
					}
				}
				rows.add(row);
			}
			return rows;
		}
	}

	@Override
	protected long countRows(String className) throws Exception {
		try (MongoClient client = MongoClients.create(url)) {
			return client.getDatabase(databaseName()).getCollection(fullTable(className))
					.countDocuments(new Document());
		}
	}

	private static Object plain(Object value) {
		if (value instanceof Document document) {
			JSONObject json = new JSONObject();
			for (Map.Entry<String, Object> entry : document.entrySet()) {
				json.put(entry.getKey(), plain(entry.getValue()));
			}
			return json;
		}
		if (value instanceof List<?> list) {
			JSONArray array = new JSONArray();
			for (Object item : list) {
				array.add(plain(item));
			}
			return array;
		}
		if (value instanceof ObjectId objectId) {
			return objectId.toHexString();
		}
		if (value instanceof Decimal128 decimal) {
			return decimal.bigDecimalValue();
		}
		return value;
	}

	// ----------------------------------------------------------------------------------
	// Adapter-specific coverage
	// ----------------------------------------------------------------------------------

	/** The connection probe is not covered by the JDBC-gated contract test, so assert it directly. */
	@Test
	void connectionProbeReportsCatalog() throws Exception {
		JSONObject report = newAdapter().testConnection();
		assertEquals("catalog", report.getString("kind"));
		assertEquals("MongoDB", report.getString("databaseProduct"));
		assertTrue(report.getString("databaseVersion").startsWith("5."), report.getString("databaseVersion"));
		assertNotNull(report.getString("driverName"));
		assertNotNull(report.getString("driverVersion"));
		assertEquals(databaseName(), report.getString("catalog"));
	}

	/** A vector attribute is a text field holding the JSON array; read/write is supported without vector search. */
	@Test
	void queryVectorAttrReadsTheStoredArray() throws Exception {
		DataAdapter adapter = newAdapter(null);
		JSONObject classDef = classDef();
		classDef.getJSONArray("attrs").add(attr("embedding", "vector", false));
		adapter.createClass(ns, classDef);

		JSONObject row = new JSONObject();
		row.put("id", "v1");
		row.put("name", "Vector");
		row.put("embedding", JSONArray.of(JSONObject.of("path", "docs/a.txt", "text", "hello")));
		adapter.insertObjects(ns, classDef, JSONArray.of(row));

		JSONObject qualified = JSON.parseObject(classDef.toJSONString());
		qualified.put("className", ns + "person");
		JSONArray vector = adapter.queryVectorAttr(qualified, "embedding", "v1");
		assertEquals(1, vector.size());
		assertEquals("docs/a.txt", vector.getJSONObject(0).getString("path"));
		assertEquals("hello", vector.getJSONObject(0).getString("text"));
		adapter.dropNamespace(ns);
	}

	/** A two-step DSL flattens the first step into an intermediate collection and aggregates over it. */
	@Test
	void readTwoStepFlattensThenGroups() throws Exception {
		seedGraph();
		JSONObject source = JSONObject.of("idx", 0, "variable", "p", "class", ns + "person");
		JSONObject step0 = JSONObject.of(
				"graph", JSONObject.of("patterns", JSONArray.of(JSONObject.of("objects", JSONArray.of(source)))),
				"output", JSONObject.of(
						"fields", JSONArray.of(
								JSONObject.of("variable", "p", "field", "org_id", "as", "org_id"),
								JSONObject.of("variable", "p", "field", "id", "as", "person_id"))));

		JSONObject intermediate = JSONObject.of("idx", 0, "variable", "t1", "class", "ontomato_intermediate");
		JSONObject step1 = JSONObject.of(
				"graph", JSONObject.of("patterns", JSONArray.of(JSONObject.of("objects", JSONArray.of(intermediate)))),
				"output", JSONObject.of(
						"fields", JSONArray.of(
								JSONObject.of("variable", "t1", "field", "org_id", "as", "org_id"),
								JSONObject.of("variable", "t1", "field", "person_id", "function", "count", "as", "cnt")),
						"group_by", JSONObject.of("fields",
								JSONArray.of(JSONObject.of("variable", "t1", "field", "org_id"))),
						"sort", JSONObject.of("fields", JSONArray.of(JSONObject.of("field", "org_id", "order", "asc")))));

		JSONArray rows = readQuery(JSONArray.of(
				JSONObject.of("answer", JSONObject.of("steps", JSONArray.of(step0, step1)))).toJSONString());

		assertEquals(2, rows.size());
		assertEquals("o1", rows.getJSONObject(0).getString("org_id"));
		assertEquals(2L, ((Number) rows.getJSONObject(0).get("cnt")).longValue());
		dropGraph();
	}

	/** {@code query()} resolves plain class names and applies the sandbox prefix before executing. */
	@Test
	void graphQueryAppliesTheSandboxPrefix() throws Exception {
		seedGraph();
		// query() takes plain class names: it resolves them against the ontomap and applies the sandbox
		// prefix itself, so the DSL must not carry one.
		JSONArray objects = new JSONArray();
		objects.add(JSONObject.of("class", graphClass(0), "variable", "p", "idx", 0));
		JSONArray fields = new JSONArray();
		fields.add(readField("p", "name", "person_name"));
		JSONObject dsl = JSON.parseArray(singleStepDsl(objects, null, fields, null, null, null)).getJSONObject(0);

		Map<String, Object> result = newAdapter(graphRule()).query(dsl, ns, null, null, new DataRagConfig());
		Object data = result.get("data");
		assertNotNull(data, () -> "query() failed: " + result);
		List<?> answers = (List<?>) data;
		assertEquals(1, answers.size());
		Map<?, ?> first = (Map<?, ?>) answers.get(0);
		assertEquals(4, ((List<?>) first.get("answer")).size());
		dropGraph();
	}

	/** Sample data reads the requested attributes from the class's collection. */
	@Test
	void sampleDataReturnsTheFirstRow() throws Exception {
		DataAdapter adapter = newAdapter(null);
		adapter.createClass(ns, classDef());
		adapter.insertObjects(ns, classDef(), testObjects());
		String sample = adapter.querySampleDataByClassName(ns + "person", List.of("id", "name"));
		assertTrue(sample.contains("Alice"), sample);
		adapter.dropNamespace(ns);
	}

	private static JSONObject attr(String name, String type, boolean primaryKey) {
		JSONObject attr = new JSONObject();
		attr.put("name", name);
		attr.put("type", type);
		attr.put("primaryKey", primaryKey);
		attr.put("enable", true);
		return attr;
	}
}
