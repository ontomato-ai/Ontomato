package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.Connection;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.config.multisource.ClassRoute;
import io.ontomato.dataengine.config.multisource.DataSourceEntry;
import io.ontomato.dataengine.config.multisource.MultiDataSourceDefinition;
import io.ontomato.dataengine.config.multisource.RelationshipRoute;
import io.ontomato.dataengine.dao.VectorResourceDao;

/**
 * The multi-source adapter's own logic, exercised against recording delegates so every test is
 * deterministic and needs no database.
 *
 * <p>What this covers: routing by ontology name, rejection of a cross-source query, the two-step
 * shape, write routing and namespace fan-out, configuration validation, and the fact that the adapter
 * neither rewrites a DSL it forwards nor hides which source a failure came from. It deliberately does
 * not try to be a substitute for each adapter's own contract suite — a delegate is never inspected here.</p>
 */
class MultiDataSourceAdapterTest {

	// ----------------------------------------------------------------------------------
	// Fixture
	// ----------------------------------------------------------------------------------

	/** Records every call and answers with a marker naming itself, so routing is observable. */
	static class RecordingAdapter implements DataAdapter {
		final String name;
		final List<String> calls = new ArrayList<>();
		String lastDsl;
		/** The ontomap this adapter was last built with: the source's own view. */
		Map<String, Object> jsonRule;
		boolean closed = false;
		Exception writeFailure;

		RecordingAdapter(String name) {
			this.name = name;
		}

		private void record(String call) {
			calls.add(call);
		}

		@Override
		public Connection openConnection() {
			record("openConnection");
			return null;
		}

		@Override
		public JSONObject testConnection() {
			record("testConnection");
			return new JSONObject().fluentPut("kind", "stub").fluentPut("name", name);
		}

		@Override
		public String executeDsl(String queryJson, String sessionId, DslExecutionMode mode, List<String> generatedMqls) {
			record("executeDsl");
			lastDsl = queryJson;
			return "[{\"answer\":[],\"mqls\":[],\"source\":\"" + name + "\"}]";
		}

		@Override
		public String getSampleDataFileName(String sampleDataDirName, String className) {
			record("getSampleDataFileName:" + className);
			return sampleDataDirName + "/" + className;
		}

		@Override
		public String querySampleDataByClassName(String className, List<String> attrs) {
			record("querySampleDataByClassName:" + className);
			return "[]";
		}

		@Override
		public void validateClassNameFormat(String className) {
			record("validateClassNameFormat:" + className);
		}

		@Override
		public void validatePrimaryKeyName(String attrName) {
			record("validatePrimaryKeyName:" + attrName);
		}

		@Override
		public void createNamespace(String namespace) {
			record("createNamespace:" + namespace);
		}

		@Override
		public void truncateNamespace(String namespace) {
			record("truncateNamespace:" + namespace);
		}

		@Override
		public void dropNamespace(String namespace) {
			record("dropNamespace:" + namespace);
		}

		@Override
		public void createClass(String namespace, Map<String, Object> classDef) {
			record("createClass:" + classDef.get("className"));
		}

		@Override
		public void createEdgeType(String namespace, String edgeName) {
			record("createEdgeType:" + edgeName);
		}

		@Override
		public void insertObjects(String namespace, Map<String, Object> classDef, JSONArray objs) throws Exception {
			failIfWriteFails();
			record("insertObjects:" + classDef.get("className"));
		}

		@Override
		public void updateObjects(String namespace, Map<String, Object> classDef, JSONObject setValues, JSONObject where)
				throws Exception {
			failIfWriteFails();
			record("updateObjects:" + classDef.get("className"));
		}

		@Override
		public void deleteObjects(String namespace, Map<String, Object> classDef, JSONObject where) throws Exception {
			failIfWriteFails();
			record("deleteObjects:" + classDef.get("className"));
		}

		@Override
		public void createEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
				String targetClassName, String targetObjId) {
			record("createEdge:" + relationName);
		}

		@Override
		public void deleteEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
				String targetClassName, String targetObjId) {
			record("deleteEdge:" + relationName);
		}

		@Override
		public Map<String, Object> query(JSONObject dsl, String sandboxId, String domainId,
				VectorResourceDao vectorResourceDao, DataRagConfig dataRagConfig) {
			record("query");
			return new JSONObject().fluentPut("source", name);
		}

		@Override
		public JSONArray queryVectorAttr(Map<String, Object> classDef, String attrName, String objectId) {
			record("queryVectorAttr:" + classDef.get("className"));
			return new JSONArray();
		}

		@Override
		public String sandboxClassName(String sandboxId, String className) {
			record("sandboxClassName:" + className);
			return sandboxId + className;
		}

		@Override
		public String sandboxObjectId(String sandboxId, String objectId) {
			record("sandboxObjectId:" + objectId);
			return objectId;
		}

		private void failIfWriteFails() {
			if (writeFailure != null) {
				throw new UnsupportedDataAdapterOperationException(name, "write");
			}
		}

		boolean called(String prefix) {
			return calls.stream().anyMatch(call -> call.startsWith(prefix));
		}
	}

	/** Hands out one recording adapter per connection url, so two sources of one type stay distinct. */
	static class RecordingProvider implements DataAdapterProvider {
		private final String type;
		final Map<String, RecordingAdapter> byUrl = new LinkedHashMap<>();

		RecordingProvider(String type) {
			this.type = type;
		}

		RecordingAdapter adapter(String url, String name) {
			RecordingAdapter adapter = new RecordingAdapter(name);
			byUrl.put(url, adapter);
			return adapter;
		}

		@Override
		public String type() {
			return type;
		}

		@Override
		public String label() {
			return type;
		}

		@Override
		public boolean requiresJoinFields() {
			return true;
		}

		@Override
		public List<String> connectionFields() {
			return List.of("url");
		}

		@Override
		public Map<String, String> connectionExamples() {
			return Map.of();
		}

		@Override
		public DataAdapter create(DataAdapterConnection connection, DataRagConfig dataRagConfig, Map<String, Object> jsonRule) {
			RecordingAdapter adapter = byUrl.get(connection.get("url"));
			if (adapter == null) {
				throw new IllegalArgumentException("no stub adapter for url " + connection.get("url"));
			}
			adapter.jsonRule = jsonRule;
			return adapter;
		}
	}

	private final DataRagConfig dataRagConfig = new DataRagConfig();
	private final MultiDataSourceAdapterProvider multiProvider = new MultiDataSourceAdapterProvider();
	private final List<DataAdapterProvider> providers = new ArrayList<>();

	private DataSourceEntry source(String id, String adapterType) {
		DataSourceEntry entry = new DataSourceEntry();
		entry.setId(id);
		entry.setAdapterType(adapterType);
		entry.setConnection(connection("jdbc:" + id));
		return entry;
	}

	private ClassRoute classRoute(String className, String sourceId) {
		ClassRoute route = new ClassRoute();
		route.setForOntoMap(className);
		route.setSourceId(sourceId);
		return route;
	}

	private MultiDataSourceAdapter build(MultiDataSourceDefinition definition) {
		BusinessConfig businessConfig = new BusinessConfig();
		businessConfig.setDataAdapter("multi");
		businessConfig.setMultiDataSource(definition);
		DataAdapterRegistry registry = new DataAdapterRegistry(providers, dataRagConfig);
		multiProvider.registry = registry;
		return new MultiDataSourceAdapter(registry, businessConfig, dataRagConfig, null);
	}

	/** Two sources of one adapter type, one class each, routed. */
	private MultiDataSourceAdapter twoSources(RecordingAdapter[] out) {
		return twoSources(out, null, List.of());
	}

	/** {@link #twoSources(RecordingAdapter[])} with an ontomap and relationship routes. */
	private MultiDataSourceAdapter twoSources(RecordingAdapter[] out, Map<String, Object> jsonRule,
			List<RelationshipRoute> relationships) {
		RecordingProvider pg = new RecordingProvider("postgresql");
		out[0] = pg.adapter("jdbc:crm", "crm");
		out[1] = pg.adapter("jdbc:erp", "erp");
		providers.add(pg);

		BusinessConfig businessConfig = new BusinessConfig();
		businessConfig.setDataAdapter("multi");
		MultiDataSourceDefinition definition = new MultiDataSourceDefinition();
		definition.getDataSources().add(source("crm", "postgresql"));
		definition.getDataSources().add(source("erp", "postgresql"));
		definition.getClasses().add(classRoute("Person", "crm"));
		definition.getClasses().add(classRoute("Invoice", "erp"));
		definition.getRelationships().addAll(relationships);
		businessConfig.setMultiDataSource(definition);

		DataAdapterRegistry registry = new DataAdapterRegistry(providers, dataRagConfig);
		multiProvider.registry = registry;
		return new MultiDataSourceAdapter(registry, businessConfig, dataRagConfig, jsonRule);
	}

	private static RelationshipRoute physicalEdge(String relationshipName, String realEdge) {
		RelationshipRoute route = new RelationshipRoute();
		route.setForOntoMap(relationshipName);
		route.setRealEdge(realEdge);
		return route;
	}

	private static JSONObject relationshipDef(String fromClass, String toClass) {
		return new JSONObject().fluentPut("fromclass", fromClass).fluentPut("toclass", toClass);
	}

	/**
	 * Person and Invoice, each with a self relationship whose physical name is {@code KNOWS} in its own
	 * source, plus one relationship crossing the two sources.
	 */
	private static JSONObject ontomapWithSameNamedEdges() {
		return new JSONObject()
				.fluentPut("classDef", JSONArray.of(classDef("Person"), classDef("Invoice")))
				.fluentPut("relationship_rule", new JSONObject()
						.fluentPut("knows_a", relationshipDef("Person", "Person"))
						.fluentPut("knows_b", relationshipDef("Invoice", "Invoice"))
						.fluentPut("person_invoice", relationshipDef("Person", "Invoice")));
	}

	private static List<RelationshipRoute> bothKnows() {
		return List.of(physicalEdge("knows_a", "KNOWS"), physicalEdge("knows_b", "KNOWS"));
	}

	private static String dslWithRelationship(String className, String relationshipName) {
		JSONObject first = new JSONObject().fluentPut("idx", 0).fluentPut("variable", "a").fluentPut("class", className);
		JSONObject second = new JSONObject().fluentPut("idx", 1).fluentPut("variable", "b").fluentPut("class", className);
		JSONObject relationship = new JSONObject().fluentPut("from", 0).fluentPut("to", 1)
				.fluentPut("type", JSONArray.of(relationshipName));
		JSONObject pattern = new JSONObject().fluentPut("objects", JSONArray.of(first, second))
				.fluentPut("relationship", JSONArray.of(relationship));
		JSONObject step = new JSONObject().fluentPut("graph", new JSONObject().fluentPut("patterns", JSONArray.of(pattern)))
				.fluentPut("output", new JSONObject().fluentPut("to_user", true));
		return JSONArray.of(new JSONObject().fluentPut("answer",
				new JSONObject().fluentPut("steps", JSONArray.of(step)))).toJSONString();
	}

	private static DataAdapterConnection connection(String url) {
		DataAdapterConnection connection = new DataAdapterConnection();
		connection.put("url", url);
		return connection;
	}

	private static JSONObject dslElement(String... classNames) {
		JSONArray objects = new JSONArray();
		for (int i = 0; i < classNames.length; i++) {
			objects.add(new JSONObject().fluentPut("idx", i).fluentPut("variable", "v" + i)
					.fluentPut("class", classNames[i]));
		}
		JSONObject pattern = new JSONObject().fluentPut("objects", objects);
		JSONObject graph = new JSONObject().fluentPut("patterns", JSONArray.of(pattern));
		JSONObject output = new JSONObject().fluentPut("to_user", true);
		JSONObject step = new JSONObject().fluentPut("graph", graph).fluentPut("output", output);
		JSONObject answer = new JSONObject().fluentPut("steps", JSONArray.of(step));
		return new JSONObject().fluentPut("answer", answer);
	}

	private static String dsl(String... classNames) {
		return JSONArray.of(dslElement(classNames)).toJSONString();
	}

	private static Map<String, Object> classDef(String className) {
		return new JSONObject().fluentPut("className", className);
	}

	// ----------------------------------------------------------------------------------
	// Routing
	// ----------------------------------------------------------------------------------

	@Test
	void routesEachClassToItsOwnSource() throws Exception {
		RecordingAdapter[] adapters = new RecordingAdapter[2];
		MultiDataSourceAdapter adapter = twoSources(adapters);

		String result = adapter.executeDsl(dsl("Person"), "s", DslExecutionMode.RAW, new ArrayList<>());

		assertTrue(result.contains("\"source\":\"crm\""), result);
		assertTrue(adapters[0].called("executeDsl"));
		assertFalse(adapters[1].called("executeDsl"), "the other source must not be queried");
	}

	@Test
	void routesWhenTheClassIsWrittenWithALeadingSlash() throws Exception {
		RecordingAdapter[] adapters = new RecordingAdapter[2];
		MultiDataSourceAdapter adapter = twoSources(adapters);

		adapter.executeDsl(dsl("/Person"), "s", DslExecutionMode.RAW, new ArrayList<>());

		assertTrue(adapters[0].called("executeDsl"));
		assertFalse(adapters[1].called("executeDsl"));
	}

	@Test
	void forwardsTheDslUnchanged() throws Exception {
		RecordingAdapter[] adapters = new RecordingAdapter[2];
		MultiDataSourceAdapter adapter = twoSources(adapters);
		String element = dslElement("Person").toJSONString();

		adapter.executeDsl("[" + element + "]", "s", DslExecutionMode.RAW, new ArrayList<>());

		assertEquals("[" + element + "]", adapters[0].lastDsl);
	}

	@Test
	void queriesThroughTheSameRoutingAsExecuteDsl() throws Exception {
		RecordingAdapter[] adapters = new RecordingAdapter[2];
		MultiDataSourceAdapter adapter = twoSources(adapters);

		Map<String, Object> result = adapter.query(dslElement("Invoice"), null, "d", null, dataRagConfig);

		assertEquals("erp", result.get("source"));
		assertTrue(adapters[1].called("query"));
		assertFalse(adapters[0].called("query"));
	}

	// ----------------------------------------------------------------------------------
	// Cross-source rejection
	// ----------------------------------------------------------------------------------

	@Test
	void rejectsAQueryWhoseClassesSpanSources() {
		RecordingAdapter[] adapters = new RecordingAdapter[2];
		MultiDataSourceAdapter adapter = twoSources(adapters);

		DslContractViolationException failure = assertThrows(DslContractViolationException.class,
				() -> adapter.executeDsl(dsl("Person", "Invoice"), "s", DslExecutionMode.RAW, new ArrayList<>()));

		assertEquals(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT, failure.getViolations().get(0).getCode());
		String detail = failure.getMessage();
		assertTrue(detail.contains("Person") && detail.contains("crm"), detail);
		assertTrue(detail.contains("Invoice") && detail.contains("erp"), detail);
		assertFalse(adapters[0].called("executeDsl"), "a rejected query must not reach any source");
		assertFalse(adapters[1].called("executeDsl"));
	}

	@Test
	void rejectsAClassThatIsNotRoutedWhenSeveralSourcesExist() {
		RecordingAdapter[] adapters = new RecordingAdapter[2];
		MultiDataSourceAdapter adapter = twoSources(adapters);

		DslContractViolationException failure = assertThrows(DslContractViolationException.class,
				() -> adapter.executeDsl(dsl("Unknown"), "s", DslExecutionMode.RAW, new ArrayList<>()));

		assertTrue(failure.getMessage().contains("Unknown"), failure.getMessage());
	}

	/** A two-step DSL is one source's business: only the first step names classes, and it is single-source. */
	@Test
	void routesBothStepsToTheFirstStepsSource() throws Exception {
		RecordingAdapter[] adapters = new RecordingAdapter[2];
		MultiDataSourceAdapter adapter = twoSources(adapters);

		JSONObject element = dslElement("Person");
		JSONArray steps = element.getJSONObject("answer").getJSONArray("steps");
		steps.add(dslElement("Person").getJSONObject("answer").getJSONArray("steps").getJSONObject(0));

		adapter.executeDsl(JSONArray.of(element).toJSONString(), "s", DslExecutionMode.RAW, new ArrayList<>());

		assertTrue(adapters[0].called("executeDsl"));
		assertFalse(adapters[1].called("executeDsl"));
	}

	// ----------------------------------------------------------------------------------
	// Write path
	// ----------------------------------------------------------------------------------

	@Test
	void routesClassWritesByClassName() throws Exception {
		RecordingAdapter[] adapters = new RecordingAdapter[2];
		MultiDataSourceAdapter adapter = twoSources(adapters);

		adapter.createClass("ns", classDef("Invoice"));
		adapter.insertObjects("ns", classDef("Person"), new JSONArray());

		assertTrue(adapters[0].called("insertObjects:Person"));
		assertTrue(adapters[1].called("createClass:Invoice"));
		assertFalse(adapters[1].called("insertObjects"));
	}

	@Test
	void fansOutNamespaceOperationsToEveryWritableSource() {
		RecordingAdapter[] adapters = new RecordingAdapter[2];
		MultiDataSourceAdapter adapter = twoSources(adapters);

		adapter.createNamespace("ns");

		for (RecordingAdapter recording : adapters) {
			assertTrue(recording.called("createNamespace:ns"), recording.name + " must be fanned out to");
		}
	}

	@Test
	void skipsReadOnlySourcesDuringFanOut() {
		RecordingProvider pg = new RecordingProvider("postgresql");
		RecordingAdapter writable = pg.adapter("jdbc:crm", "crm");
		RecordingAdapter readOnly = pg.adapter("jdbc:dw", "dw");
		providers.add(pg);

		BusinessConfig businessConfig = new BusinessConfig();
		businessConfig.setDataAdapter("multi");
		MultiDataSourceDefinition definition = new MultiDataSourceDefinition();
		definition.getDataSources().add(source("crm", "postgresql"));
		DataSourceEntry warehouse = source("dw", "postgresql");
		warehouse.setReadOnly(true);
		definition.getDataSources().add(warehouse);
		businessConfig.setMultiDataSource(definition);

		DataAdapterRegistry registry = new DataAdapterRegistry(providers, dataRagConfig);
		multiProvider.registry = registry;
		MultiDataSourceAdapter adapter = new MultiDataSourceAdapter(registry, businessConfig, dataRagConfig, null);

		adapter.dropNamespace("ns");

		assertTrue(writable.called("dropNamespace:ns"));
		assertFalse(readOnly.called("dropNamespace:ns"), "a read-only source must be skipped, not attempted");
	}

	@Test
	void reportsAPartialFanOutFailureInsteadOfHidingIt() {
		RecordingProvider pg = new RecordingProvider("postgresql");
		pg.adapter("jdbc:crm", "crm");
		RecordingProvider erp = new RecordingProvider("mysql");
		providers.add(pg);
		providers.add(erp);
		// No stub adapter is registered for erp's connection, so building its delegate fails.

		BusinessConfig businessConfig = new BusinessConfig();
		businessConfig.setDataAdapter("multi");
		MultiDataSourceDefinition definition = new MultiDataSourceDefinition();
		definition.getDataSources().add(source("crm", "postgresql"));
		definition.getDataSources().add(source("erp", "mysql"));
		businessConfig.setMultiDataSource(definition);

		DataAdapterRegistry registry = new DataAdapterRegistry(providers, dataRagConfig);
		multiProvider.registry = registry;
		MultiDataSourceAdapter adapter = new MultiDataSourceAdapter(registry, businessConfig, dataRagConfig, null);

		IllegalStateException failure = assertThrows(IllegalStateException.class, () -> adapter.truncateNamespace("ns"));
		assertTrue(failure.getMessage().contains("erp"), failure.getMessage());
	}

	// ----------------------------------------------------------------------------------
	// Capability flags: what a single boolean can and cannot say for a mixed domain
	// ----------------------------------------------------------------------------------

	@Test
	void reportsTheDomainLevelScalarsThatAreSafeForAMixedDomain() {
		RecordingAdapter[] adapters = new RecordingAdapter[2];
		MultiDataSourceAdapter adapter = twoSources(adapters);

		assertFalse(adapter.timeConditionsAsEpochMillis(),
				"each delegate re-applies its own time convention, so this level must not rewrite");
		assertNull(adapter.timeConditionZone());
		assertTrue(multiProvider.requiresJoinFields(),
				"the modelling dialog must keep offering join fields for the relational sources");
	}

	@Test
	void multiHasNoConnectionOfItsOwn() {
		assertThrows(UnsupportedDataAdapterOperationException.class, () -> twoSources(new RecordingAdapter[2]).openConnection());
		assertTrue(multiProvider.connectionFields().isEmpty());
	}

	/** Each source is tested through its own type; the multi type has nothing of its own to test. */
	@Test
	void doesNotTestAsAWhole() {
		assertThrows(UnsupportedDataAdapterOperationException.class, () -> twoSources(new RecordingAdapter[2]).testConnection());
	}

	// ----------------------------------------------------------------------------------
	// Configuration validation
	// ----------------------------------------------------------------------------------

	@Test
	void rejectsADuplicateClassRoute() {
		providers.add(new RecordingProvider("postgresql"));

		MultiDataSourceDefinition definition = new MultiDataSourceDefinition();
		definition.getDataSources().add(source("crm", "postgresql"));
		definition.getDataSources().add(source("erp", "postgresql"));
		definition.getClasses().add(classRoute("Person", "crm"));
		definition.getClasses().add(classRoute("/Person", "erp"));

		IllegalArgumentException failure = assertThrows(IllegalArgumentException.class, () -> build(definition));
		assertTrue(failure.getMessage().contains("duplicate class route"), failure.getMessage());
	}

	@Test
	void rejectsARouteToAnUnknownSource() {
		providers.add(new RecordingProvider("postgresql"));

		MultiDataSourceDefinition definition = new MultiDataSourceDefinition();
		definition.getDataSources().add(source("crm", "postgresql"));
		definition.getClasses().add(classRoute("Person", "nope"));

		IllegalArgumentException failure = assertThrows(IllegalArgumentException.class, () -> build(definition));
		assertTrue(failure.getMessage().contains("unknown source"), failure.getMessage());
	}

	@Test
	void rejectsANestedMultiSource() {
		providers.add(new RecordingProvider("postgresql"));

		MultiDataSourceDefinition definition = new MultiDataSourceDefinition();
		definition.getDataSources().add(source("inner", "multi"));

		IllegalArgumentException failure = assertThrows(IllegalArgumentException.class, () -> build(definition));
		assertTrue(failure.getMessage().contains("nest"), failure.getMessage());
	}

	@Test
	void rejectsAnUninstalledAdapterType() {
		MultiDataSourceDefinition definition = new MultiDataSourceDefinition();
		definition.getDataSources().add(source("crm", "oracle"));

		IllegalArgumentException failure = assertThrows(IllegalArgumentException.class, () -> build(definition));
		assertTrue(failure.getMessage().contains("not installed"), failure.getMessage());
	}

	@Test
	void refusesToBeBuiltWithoutAMultiSourceBlock() {
		BusinessConfig businessConfig = new BusinessConfig();
		businessConfig.setDataAdapter("multi");
		DataAdapterRegistry registry = new DataAdapterRegistry(providers, dataRagConfig);
		multiProvider.registry = registry;

		assertThrows(IllegalStateException.class,
				() -> new MultiDataSourceAdapter(registry, businessConfig, dataRagConfig, null));
	}

	// ----------------------------------------------------------------------------------
	// Physical edge names on the read path
	// ----------------------------------------------------------------------------------

	/**
	 * A graph source traverses the name the DSL carries, so a relationship whose ontology name is not its
	 * physical edge name has to be rewritten before the element is handed over — otherwise the traversal
	 * asks for an edge that does not exist.
	 */
	@Test
	void rewritesARelationshipTypeToItsPhysicalEdgeName() throws Exception {
		RecordingProvider pg = new RecordingProvider("postgresql");
		RecordingAdapter graphSource = pg.adapter("jdbc:gph", "gph");
		providers.add(pg);

		BusinessConfig businessConfig = new BusinessConfig();
		businessConfig.setDataAdapter("multi");
		MultiDataSourceDefinition definition = new MultiDataSourceDefinition();
		definition.getDataSources().add(source("gph", "postgresql"));
		definition.getClasses().add(classRoute("Person", "gph"));
		definition.getClasses().add(classRoute("Org", "gph"));
		RelationshipRoute relationshipRoute = new RelationshipRoute();
		relationshipRoute.setForOntoMap("person_works_at");
		relationshipRoute.setRealEdge("WORKS_AT");
		definition.getRelationships().add(relationshipRoute);
		businessConfig.setMultiDataSource(definition);

		DataAdapterRegistry registry = new DataAdapterRegistry(providers, dataRagConfig);
		multiProvider.registry = registry;
		MultiDataSourceAdapter adapter = new MultiDataSourceAdapter(registry, businessConfig, dataRagConfig, null);

		JSONObject first = new JSONObject().fluentPut("idx", 0).fluentPut("variable", "a").fluentPut("class", "Person");
		JSONObject second = new JSONObject().fluentPut("idx", 1).fluentPut("variable", "b").fluentPut("class", "Org");
		JSONObject relationship = new JSONObject().fluentPut("from", 0).fluentPut("to", 1)
				.fluentPut("type", JSONArray.of("person_works_at"));
		JSONObject pattern = new JSONObject().fluentPut("objects", JSONArray.of(first, second))
				.fluentPut("relationship", JSONArray.of(relationship));
		JSONObject graph = new JSONObject().fluentPut("patterns", JSONArray.of(pattern));
		JSONObject field = new JSONObject().fluentPut("variable", "a").fluentPut("field", "name").fluentPut("as", "name");
		JSONObject step = new JSONObject().fluentPut("graph", graph)
				.fluentPut("output", new JSONObject().fluentPut("fields", JSONArray.of(field)));
		String dslJson = JSONArray.of(new JSONObject().fluentPut("answer",
				new JSONObject().fluentPut("steps", JSONArray.of(step)))).toJSONString();

		adapter.executeDsl(dslJson, "s", DslExecutionMode.RAW, new ArrayList<>());

		assertTrue(graphSource.lastDsl.contains("WORKS_AT"), graphSource.lastDsl);
		assertFalse(graphSource.lastDsl.contains("person_works_at"),
				"the ontology name must not reach the source when a physical edge name is configured");
	}

	/** With no configured physical name the element is forwarded exactly as it arrived. */
	@Test
	void leavesARelationshipTypeAloneWithoutAPhysicalEdgeName() throws Exception {
		RecordingAdapter[] adapters = new RecordingAdapter[2];
		MultiDataSourceAdapter adapter = twoSources(adapters);

		JSONObject first = new JSONObject().fluentPut("idx", 0).fluentPut("variable", "a").fluentPut("class", "Person");
		JSONObject second = new JSONObject().fluentPut("idx", 1).fluentPut("variable", "b").fluentPut("class", "Person");
		JSONObject relationship = new JSONObject().fluentPut("from", 0).fluentPut("to", 1)
				.fluentPut("type", JSONArray.of("person_manager"));
		JSONObject pattern = new JSONObject().fluentPut("objects", JSONArray.of(first, second))
				.fluentPut("relationship", JSONArray.of(relationship));
		JSONObject graph = new JSONObject().fluentPut("patterns", JSONArray.of(pattern));
		JSONObject field = new JSONObject().fluentPut("variable", "a").fluentPut("field", "name").fluentPut("as", "name");
		JSONObject step = new JSONObject().fluentPut("graph", graph)
				.fluentPut("output", new JSONObject().fluentPut("fields", JSONArray.of(field)));
		String dslJson = JSONArray.of(new JSONObject().fluentPut("answer",
				new JSONObject().fluentPut("steps", JSONArray.of(step)))).toJSONString();

		adapter.executeDsl(dslJson, "s", DslExecutionMode.RAW, new ArrayList<>());

		assertTrue(adapters[0].lastDsl.contains("person_manager"), adapters[0].lastDsl);
	}

	// ----------------------------------------------------------------------------------
	// Ontomap validation hook
	// ----------------------------------------------------------------------------------

	@Test
	void reportsACrossSourceRelationshipFromTheOntomap() {
		RecordingAdapter[] adapters = new RecordingAdapter[2];
		MultiDataSourceAdapter adapter = twoSources(adapters);

		JSONObject relationshipDef = new JSONObject().fluentPut("fromclass", "Person").fluentPut("toclass", "Invoice");
		JSONObject jsonRule = new JSONObject()
				.fluentPut("classDef", JSONArray.of(classDef("Person"), classDef("Invoice")))
				.fluentPut("relationship_rule", new JSONObject().fluentPut("person_invoice", relationshipDef));

		List<ConfigurationProblem> violations = adapter.validateOntoMap(jsonRule);

		assertEquals(1, violations.size());
		assertTrue(violations.get(0).path().contains("person_invoice"), violations.toString());
	}

	@Test
	void reportsNothingForAnOntomapThatStaysWithinOneSource() {
		RecordingAdapter[] adapters = new RecordingAdapter[2];
		MultiDataSourceAdapter adapter = twoSources(adapters);

		JSONObject jsonRule = new JSONObject()
				.fluentPut("classDef", JSONArray.of(classDef("Person")))
				.fluentPut("relationship_rule", new JSONObject().fluentPut("person_manager",
						new JSONObject().fluentPut("fromclass", "Person").fluentPut("toclass", "Person")));

		assertTrue(adapter.validateOntoMap(jsonRule).isEmpty());
	}

	/** A single configured source has no ambiguity, so an unrouted name simply belongs to it. */
	@Test
	void aSingleSourceNeedsNoRouteTable() throws Exception {
		RecordingProvider pg = new RecordingProvider("postgresql");
		RecordingAdapter only = pg.adapter("jdbc:crm", "crm");
		providers.add(pg);

		BusinessConfig businessConfig = new BusinessConfig();
		businessConfig.setDataAdapter("multi");
		MultiDataSourceDefinition definition = new MultiDataSourceDefinition();
		definition.getDataSources().add(source("crm", "postgresql"));
		businessConfig.setMultiDataSource(definition);

		DataAdapterRegistry registry = new DataAdapterRegistry(providers, dataRagConfig);
		multiProvider.registry = registry;
		MultiDataSourceAdapter adapter = new MultiDataSourceAdapter(registry, businessConfig, dataRagConfig, null);

		String result = adapter.executeDsl(dsl("Anything"), "s", DslExecutionMode.RAW, new ArrayList<>());

		assertTrue(result.contains("\"source\":\"crm\""), result);
		assertTrue(adapter.validateOntoMap(new JSONObject().fluentPut("classDef", JSONArray.of(classDef("Anything")))
				.fluentPut("relationship_rule", new JSONObject())).isEmpty());
		assertDoesNotThrow(() -> adapter.createClass("ns", classDef("Anything")));
		assertTrue(only.called("createClass:Anything"));
	}

	// ----------------------------------------------------------------------------------
	// Physical edge names on the write path, and each source's view of the ontomap
	// ----------------------------------------------------------------------------------

	/** Two sources may each hold an edge named KNOWS; each delegate sees only its own, under that name. */
	@Test
	void handsEachDelegateOnlyItsOwnRelationshipsUnderPhysicalNames() throws Exception {
		RecordingAdapter[] adapters = new RecordingAdapter[2];
		MultiDataSourceAdapter adapter = twoSources(adapters, ontomapWithSameNamedEdges(), bothKnows());

		adapter.executeDsl(dslWithRelationship("Person", "knows_a"), "s", DslExecutionMode.RAW, new ArrayList<>());
		adapter.executeDsl(dslWithRelationship("Invoice", "knows_b"), "s", DslExecutionMode.RAW, new ArrayList<>());

		Map<?, ?> crmRules = (Map<?, ?>) adapters[0].jsonRule.get("relationship_rule");
		Map<?, ?> erpRules = (Map<?, ?>) adapters[1].jsonRule.get("relationship_rule");
		assertEquals(java.util.Set.of("KNOWS"), crmRules.keySet());
		assertEquals("Person", ((Map<?, ?>) crmRules.get("KNOWS")).get("fromclass"));
		assertEquals(java.util.Set.of("KNOWS"), erpRules.keySet());
		assertEquals("Invoice", ((Map<?, ?>) erpRules.get("KNOWS")).get("fromclass"));
		assertTrue(adapters[0].lastDsl.contains("\"KNOWS\"") && !adapters[0].lastDsl.contains("knows_a"), adapters[0].lastDsl);
		assertTrue(adapters[1].lastDsl.contains("\"KNOWS\"") && !adapters[1].lastDsl.contains("knows_b"), adapters[1].lastDsl);
	}

	/** A write uses the same physical name as a read, so an edge written through the adapter can be read back. */
	@Test
	void writesAndDeletesAnEdgeUnderItsPhysicalName() throws Exception {
		RecordingAdapter[] adapters = new RecordingAdapter[2];
		MultiDataSourceAdapter adapter = twoSources(adapters, ontomapWithSameNamedEdges(), bothKnows());

		adapter.createEdge("ns", "knows_b", "Invoice", "1", "Invoice", "2");
		adapter.deleteEdge("ns", "knows_b", "Invoice", "1", "Invoice", "2");

		assertTrue(adapters[1].called("createEdge:KNOWS"), adapters[1].calls.toString());
		assertTrue(adapters[1].called("deleteEdge:KNOWS"), adapters[1].calls.toString());
		assertFalse(adapters[0].called("createEdge"));
	}

	@Test
	void rejectsAnEdgeWhoseEndsLiveInDifferentSources() {
		RecordingAdapter[] adapters = new RecordingAdapter[2];
		MultiDataSourceAdapter adapter = twoSources(adapters, ontomapWithSameNamedEdges(), bothKnows());

		IllegalArgumentException failure = assertThrows(IllegalArgumentException.class,
				() -> adapter.createEdge("ns", "person_invoice", "Person", "1", "Invoice", "2"));
		assertTrue(failure.getMessage().contains("spans data sources"), failure.getMessage());
	}

	/** An edge type carries only its name, so its source is found from its endpoint classes in the ontomap. */
	@Test
	void createsAnEdgeTypeInTheSourceOfItsEndpointClasses() {
		RecordingAdapter[] adapters = new RecordingAdapter[2];
		MultiDataSourceAdapter adapter = twoSources(adapters, ontomapWithSameNamedEdges(), bothKnows());

		adapter.createEdgeType("ns", "knows_b");

		assertTrue(adapters[1].called("createEdgeType:KNOWS"), adapters[1].calls.toString());
		assertFalse(adapters[0].called("createEdgeType"));
	}

	@Test
	void refusesToRouteAnEdgeTypeWithoutTheOntomap() {
		MultiDataSourceAdapter adapter = twoSources(new RecordingAdapter[2], null, bothKnows());

		assertThrows(IllegalStateException.class, () -> adapter.createEdgeType("ns", "knows_b"));
	}

	// ----------------------------------------------------------------------------------
	// Located problems, for the save endpoint
	// ----------------------------------------------------------------------------------

	@Test
	void reportsAnUnroutedClassWhenSeveralSourcesExist() {
		MultiDataSourceAdapter adapter = twoSources(new RecordingAdapter[2]);
		JSONObject jsonRule = new JSONObject()
				.fluentPut("classDef", JSONArray.of(classDef("Person"), classDef("Order")))
				.fluentPut("relationship_rule", new JSONObject().fluentPut("person_order", relationshipDef("Person", "Order")));

		List<ConfigurationProblem> problems = adapter.validateOntoMap(jsonRule);

		assertEquals(List.of("classDef[Order]"), problems.stream().map(ConfigurationProblem::path).toList(), problems.toString());
	}

	@Test
	void reportsTwoRelationshipsOfOneSourceSharingAPhysicalName() {
		MultiDataSourceAdapter adapter = twoSources(new RecordingAdapter[2], null,
				List.of(physicalEdge("knows_a", "KNOWS")));
		JSONObject jsonRule = new JSONObject()
				.fluentPut("classDef", JSONArray.of(classDef("Person")))
				.fluentPut("relationship_rule", new JSONObject()
						.fluentPut("knows_a", relationshipDef("Person", "Person"))
						.fluentPut("KNOWS", relationshipDef("Person", "Person")));

		List<ConfigurationProblem> problems = adapter.validateOntoMap(jsonRule);

		assertEquals(1, problems.size(), problems.toString());
		assertTrue(problems.get(0).detail().contains("KNOWS"), problems.toString());
	}

	@Test
	@SuppressWarnings("unchecked")
	void allowsOnePhysicalNameInTwoSources() {
		MultiDataSourceAdapter adapter = twoSources(new RecordingAdapter[2], null, bothKnows());
		JSONObject jsonRule = ontomapWithSameNamedEdges();
		((Map<String, Object>) jsonRule.get("relationship_rule")).remove("person_invoice");

		assertTrue(adapter.validateOntoMap(jsonRule).isEmpty());
	}

	@Test
	void listsEveryDefinitionProblemWithItsLocation() {
		providers.add(new RecordingProvider("postgresql"));
		MultiDataSourceDefinition definition = new MultiDataSourceDefinition();
		definition.getDataSources().add(source("crm", "postgresql"));
		definition.getDataSources().add(source("crm", "oracle"));
		definition.getClasses().add(classRoute("Person", "nope"));
		definition.getRelationships().add(physicalEdge("knows", "KNOWS"));
		definition.getRelationships().add(physicalEdge("/knows", "KNOWS2"));

		List<ConfigurationProblem> problems = MultiDataSourceValidator.problems(definition,
				new DataAdapterRegistry(providers, dataRagConfig));

		List<String> paths = problems.stream().map(ConfigurationProblem::path).toList();
		assertTrue(paths.containsAll(List.of("dataSources[crm]", "classes[Person]", "relationships[/knows]")),
				problems.toString());
	}

	@Test
	void reportsMissingListsInsteadOfFailingOnThem() {
		MultiDataSourceDefinition definition = new MultiDataSourceDefinition();
		definition.setClasses(null);

		List<ConfigurationProblem> problems = MultiDataSourceValidator.problems(definition,
				new DataAdapterRegistry(providers, dataRagConfig));

		assertEquals(1, problems.size(), problems.toString());
	}

	@Test
	void reportsADefinitionWithoutDataSources() {
		List<ConfigurationProblem> problems = MultiDataSourceValidator.problems(new MultiDataSourceDefinition(),
				new DataAdapterRegistry(providers, dataRagConfig));

		assertEquals(List.of("dataSources"), problems.stream().map(ConfigurationProblem::path).toList(), problems.toString());
	}

	/** Entries with no name are told apart by position, so two of them never share one locator. */
	@Test
	void locatesUnnamedEntriesByPosition() {
		providers.add(new RecordingProvider("postgresql"));
		MultiDataSourceDefinition definition = new MultiDataSourceDefinition();
		definition.getDataSources().add(source("crm", "postgresql"));
		definition.getDataSources().add(source(" ", "postgresql"));
		definition.getDataSources().add(source(null, "postgresql"));
		definition.getClasses().add(classRoute("", "crm"));
		definition.getRelationships().add(physicalEdge(null, "KNOWS"));

		List<ConfigurationProblem> problems = MultiDataSourceValidator.problems(definition,
				new DataAdapterRegistry(providers, dataRagConfig));

		List<String> paths = problems.stream().map(ConfigurationProblem::path).toList();
		assertTrue(paths.containsAll(List.of("dataSources[#2]", "dataSources[#3]", "classes[#1]", "relationships[#1]")),
				problems.toString());
		assertEquals(paths.size(), new java.util.HashSet<>(paths).size(),
				"two unnamed entries never share one locator: " + problems);
	}
}
