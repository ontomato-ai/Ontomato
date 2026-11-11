package io.ontomato.dataengine.dataAdapter;

import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dataAdapter.test.AbstractDataAdapterTest;
import io.ontomato.dataengine.dataAdapter.test.DataAdapterCapability;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Contract run for the ClickHouse adapter against a real ClickHouse instance.
 *
 * <p>The instance is external: {@code ONTOMATO_TEST_CLICKHOUSE_URL} overrides the URL, and
 * {@code ONTOMATO_TEST_CLICKHOUSE_USER}/{@code _PASSWORD} override the credentials. The defaults point
 * at the local test container on port 18123 (HTTP). ClickHouse has no schema-level namespaces, so the
 * fixture's namespace is a table-name prefix.</p>
 */
class ClickHouseAdapterTest extends AbstractDataAdapterTest {

	private static final String DEFAULT_URL = "jdbc:clickhouse://127.0.0.1:18123/default";
	private static final String EXTERNAL_URL = System.getenv("ONTOMATO_TEST_CLICKHOUSE_URL");
	private static final String EXTERNAL_USER = System.getenv("ONTOMATO_TEST_CLICKHOUSE_USER");
	private static final String EXTERNAL_PASSWORD = System.getenv("ONTOMATO_TEST_CLICKHOUSE_PASSWORD");

	private static String url;
	private static String user;
	private static String password;

	private final String ns = "it_" + System.nanoTime() + "_";

	@BeforeAll
	static void connect() {
		url = EXTERNAL_URL == null ? DEFAULT_URL : EXTERNAL_URL;
		user = EXTERNAL_USER == null ? "ontomato" : EXTERNAL_USER;
		password = EXTERNAL_PASSWORD == null ? "ontomato" : EXTERNAL_PASSWORD;
	}

	@Override
	protected DataAdapter newAdapter(JSONObject jsonRule) {
		DataAdapterConnection connection = new DataAdapterConnection();
		connection.setUrl(url);
		connection.setUser(user);
		connection.setPassword(password);
		return new ClickHouseAdapter(connection, jsonRule);
	}

	@Override
	protected Set<DataAdapterCapability> capabilities() {
		return CAPABILITIES;
	}

	/** Enabled one group at a time; a capability is declared only after its tests pass. */
	private static final Set<DataAdapterCapability> CAPABILITIES = EnumSet.of(
			DataAdapterCapability.JDBC_CONNECTION,
			DataAdapterCapability.READ_QUERY,
			DataAdapterCapability.SAMPLE_DATA,
			DataAdapterCapability.NAMESPACE_LIFECYCLE,
			DataAdapterCapability.CLASS_SCHEMA,
			DataAdapterCapability.OBJECT_CRUD,
			DataAdapterCapability.EDGE_CRUD,
			DataAdapterCapability.GRAPH_QUERY,
			DataAdapterCapability.VECTOR_ATTR);

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

	private static JSONObject attr(String name, String type, boolean primaryKey) {
		JSONObject attr = new JSONObject();
		attr.put("name", name);
		attr.put("type", type);
		attr.put("primaryKey", primaryKey);
		attr.put("enable", true);
		return attr;
	}

	// ----------------------------------------------------------------------------------
	// ClickHouse-specific: legacy query(), two-step aggregation, a lost-write edge and the vector read.
	// ----------------------------------------------------------------------------------

	@Test
	void legacyQueryPathReturnsTheAnswer() throws Exception {
		DataAdapter seeding = seedGraph();
		try {
			DataAdapter adapter = newAdapter(prefixedGraphRule());
			JSONArray objects = new JSONArray();
			objects.add(readObject(0, "p", 0));
			JSONArray fields = new JSONArray();
			fields.add(readField("p", "name", "person_name"));
			Map<String, Object> result = adapter.query(
					JSONArray.parseArray(singleStepDsl(objects, null, fields, null, null, null)).getJSONObject(0),
					"", "", null, new DataRagConfig());
			assertNotNull(result);
			assertFalse(result.containsKey("error"), String.valueOf(result.get("error")));
			List<?> data = (List<?>) result.get("data");
			assertEquals(1, data.size());
			Map<?, ?> payload = (Map<?, ?>) data.get(0);
			assertEquals(totalPersonCount(), ((List<?>) payload.get("answer")).size());
		} finally {
			seeding.dropNamespace(namespace());
		}
	}

	@Test
	void twoStepAggregationOverAProjectedSubquery() throws Exception {
		DataAdapter seeding = seedGraph();
		try {
			JSONObject firstPattern = new JSONObject();
			JSONArray firstObjects = new JSONArray();
			firstObjects.add(readObject(0, "p", 0));
			firstPattern.put("objects", firstObjects);
			JSONObject firstOutput = new JSONObject();
			firstOutput.put("fields", JSONArray.of(
					readField("p", "name", "person_name"),
					readField("p", "org_id", "org_id")));
			JSONObject firstStep = new JSONObject();
			firstStep.put("graph", new JSONObject(Map.of("patterns", JSONArray.of(firstPattern))));
			firstStep.put("output", firstOutput);

			JSONObject secondObject = new JSONObject();
			secondObject.put("class", namespace() + graphClass(0));
			secondObject.put("variable", "t");
			secondObject.put("idx", 0);
			JSONObject secondPattern = new JSONObject();
			secondPattern.put("objects", JSONArray.of(secondObject));
			JSONObject secondOutput = new JSONObject();
			secondOutput.put("fields", JSONArray.of(
					readAggField("t", "person_name", "count", "cnt"),
					readField("t", "org_id", "org_id")));
			JSONObject groupBy = new JSONObject();
			groupBy.put("fields", JSONArray.of(readGroupByField("t", "org_id")));
			secondOutput.put("group_by", groupBy);
			JSONObject secondStep = new JSONObject();
			secondStep.put("graph", new JSONObject(Map.of("patterns", JSONArray.of(secondPattern))));
			secondStep.put("output", secondOutput);

			JSONObject dsl = new JSONObject();
			dsl.put("answer", new JSONObject(Map.of("steps", JSONArray.of(firstStep, secondStep))));
			JSONArray rows = readQuery(JSONArray.of(dsl).toJSONString());
			assertEquals(2, rows.size());
			if ("o1".equals(rows.getJSONObject(0).getString("org_id"))) {
				assertEquals(2, rows.getJSONObject(0).getIntValue("cnt"));
			} else {
				assertEquals(2, rows.getJSONObject(1).getIntValue("cnt"));
			}
		} finally {
			seeding.dropNamespace(namespace());
		}
	}

	@Test
	void createEdgeIntoMissingRowIsSurfaced() throws Exception {
		DataAdapter adapter = seedGraph();
		try {
			assertThrows(Exception.class, () -> adapter.createEdge(namespace(), firstRelation(), graphClass(0),
					"missing-person", graphClass(1), "o1"));
		} finally {
			dropGraph();
		}
	}

	@Test
	void vectorAttrReadsTheStoredJsonArray() throws Exception {
		JSONObject classDef = new JSONObject();
		classDef.put("className", "vecperson");
		classDef.put("attrs", JSONArray.of(
				attr("id", "varchar", true),
				attr("tags", "vector", false)));
		DataAdapter adapter = newAdapter();
		adapter.createClass(ns, classDef);
		JSONObject row = new JSONObject();
		row.put("id", "v1");
		row.put("tags", "[{\"path\":\"a.txt\",\"text\":\"alpha\"},{\"path\":\"b.txt\",\"text\":\"beta\"}]");
		adapter.insertObjects(ns, classDef, JSONArray.of(row));

		JSONObject physical = new JSONObject();
		physical.put("className", fullTable("vecperson"));
		physical.put("attrs", classDef.getJSONArray("attrs"));
		JSONArray vectors = adapter.queryVectorAttr(physical, "tags", "v1");
		assertEquals(2, vectors.size());
		assertEquals("alpha", vectors.getJSONObject(0).getString("text"));
		adapter.dropNamespace(ns);
	}
}
