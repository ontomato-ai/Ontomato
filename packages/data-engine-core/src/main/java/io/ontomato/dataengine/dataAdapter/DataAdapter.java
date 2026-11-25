package io.ontomato.dataengine.dataAdapter;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.VectorResourceDao;

public interface DataAdapter {

	/**
	 * Open a new JDBC connection from this adapter's own connection.
	 * Driver choice and URL rewriting stay in each adapter module.
	 */
	Connection openConnection() throws SQLException;

	/**
	 * Test this adapter's connection without touching any saved configuration.
	 * DuckDB overrides it to reject a missing database file before connecting; non-JDBC adapters run their own probe instead.
	 */
	default JSONObject testConnection() throws Exception {
		return new DataAdapterConnectionTester().test(this);
	}

	/**
	 * Whether this adapter's data source expects a date/timestamp condition as epoch milliseconds
	 * instead of the literal value the DSL wrote.
	 *
	 * <p>Default {@code false}: the value is passed through verbatim and compared against the column
	 * natively, so the source's own time convention is never reinterpreted. That is the only safe
	 * default for an existing customer source whose stored time convention is unknown. M3 overrides
	 * this because its store requires epoch millis.</p>
	 */
	default boolean timeConditionsAsEpochMillis() {
		return false;
	}

	/**
	 * The time zone used to turn a literal time condition into epoch milliseconds; only consulted
	 * when {@link #timeConditionsAsEpochMillis()} is true. {@code null} means the process default
	 * (the deployment time zone).
	 */
	default TimeZone timeConditionZone() {
		return null;
	}

	public String executeDsl(String queryJson, String sessionId, DslExecutionMode mode, List<String> generatedMqls) throws Exception;
	
	public String getSampleDataFileName(String sampleDataDirName, String className);
	
	public String querySampleDataByClassName(String className, List<String> attrs);
	
	public void validateClassNameFormat(String className) throws Exception;

	/** Refuse an attribute this data source cannot key a class's objects by. */
	public void validatePrimaryKeyName(String attrName) throws Exception;
	
    default JSONObject createRecordedClass(String namespace, Map<String, Object> definition) {
      String className = (String) definition.get("className");
      createClass(namespace, definition);
      String name = sandboxClassName(namespace, className);
      return listSandboxArtifacts(name).stream().filter(artifact -> name.equals(artifact.getString("name")))
          .findFirst().orElseThrow(() -> new IllegalStateException(
              "Database did not identify the sandbox table for class [" + className + "]: " + name));
    }
    default void validateSandboxClasses(String namespace, List<Map<String,Object>> classes) {}
    default void createRecordedNamespaces(String namespace, List<String> classes, java.util.function.Consumer<JSONObject> save) {
      createNamespace(namespace,classes);
    }
    default JSONObject sandboxClassArtifact(String namespace, String name) {
      return JSONObject.of("kind", "table", "name", sandboxClassName(namespace, name));
    }

    default boolean supportsSandboxRelationship(String name) { return true; }

    /** Returns the recorded carrier of a junction, or null when the source stores native edges. */
    default JSONObject sandboxEdgeArtifact(String name) {
      throw new UnsupportedOperationException("This source has no relationship table");
    }

    default void dropRecordedResource(JSONObject resource) {
      if(!"table".equals(resource.getString("kind"))) throw new IllegalArgumentException("Unknown sandbox resource: "+resource);
      try(var connection=openConnection();var statement=connection.createStatement()) {
        String name=JdbcSandboxArtifacts.quote(connection, resource.getString("name"));
        String schema=resource.getString("schema"),catalog=resource.getString("catalog");
        if(schema!=null && !schema.isBlank()) name=JdbcSandboxArtifacts.quote(connection, schema)+"."+name;
        if(catalog!=null && !catalog.isBlank() && connection.getMetaData().supportsCatalogsInTableDefinitions()) name=JdbcSandboxArtifacts.quote(connection, catalog)+"."+name;
        statement.execute("DROP TABLE IF EXISTS "+name);
      } catch(java.sql.SQLException failure) { throw new IllegalStateException("Cannot drop recorded sandbox table: "+resource,failure); }
    }
    default DataAdapter forSandbox(SandboxTarget target) {
      throw new UnsupportedOperationException("This data source type does not support write actions");
    }

    default String sandboxVectorTable(String physicalClass, String attribute) { return null; }

    default String sandboxObjectId(String namespace, String className, String objectId) {
      return sandboxObjectId(namespace, objectId);
    }

    default boolean supportsSandbox() { return false; }
    default boolean supportsWriteActions() { return supportsSandbox(); }
    default SandboxCapability probeSandboxPermission(String deployTag) {
      return supportsSandbox() ? JdbcSandboxArtifacts.probe(this, deployTag) : SandboxCapability.unsupported();
    }
    default List<JSONObject> listSandboxArtifacts(String deploymentPrefix) {
      return supportsSandbox() ? JdbcSandboxArtifacts.list(this, deploymentPrefix) : List.of();
    }
    default boolean supportsSandbox(java.util.List<String> classes) { return supportsSandbox(); }
    default void createNamespace(String namespace, java.util.List<String> classes) { createNamespace(namespace); }
    default void dropNamespace(String namespace, java.util.List<String> classes) { dropNamespace(namespace); }

    public void createNamespace(String namespace);
	
	public void truncateNamespace(String namespace);
	
	public void dropNamespace(String namespace);
	
	public void createClass(String namespace, Map<String, Object> classDef);
	
	public void createEdgeType(String namespace, String edgeName);
	
	public void insertObjects(String namespace, Map<String, Object> classDef, JSONArray objs) throws Exception;
	
	public void updateObjects(String namespace, Map<String, Object> classDef, JSONObject setValues, JSONObject where) throws Exception;
	
	public void deleteObjects(String namespace, Map<String, Object> classDef, JSONObject where) throws Exception;
	
	public void createEdge(String namespace, String relationName, String sourceClassName, String sourceObjId, String targetClassName, String targetObjId) throws Exception;
	
	public void deleteEdge(String namespace, String relationName, String sourceClassName, String sourceObjId, String targetClassName, String targetObjId) throws Exception;
	
	public Map<String, Object> query(JSONObject dsl, String sandboxId, String domainId, VectorResourceDao vectorResourceDao, DataRagConfig dataRagConfig) throws Exception;
	
	/**
	 * Query the current value of a single object's vector attribute.
	 *
	 * <p>A vector attribute is stored as a text column holding the JSON array string
	 * {@code [{"path":"...","text":"..."},...]}. This method returns that array parsed
	 * into a {@link JSONArray} (empty array when the attribute is null/blank).
	 * If the object does not exist, an {@link IllegalArgumentException} is thrown.</p>
	 *
	 * @param classDef the class definition (used to resolve the full class/table name and primary key)
	 * @param attrName the vector attribute name
	 * @param objectId the object's stored id value (M3 uses the {@code class:id} prefixed form,
	 *                 relational adapters use the plain primary-key value) — no prefix handling is done here
	 * @return the current vector attribute value as a JSON array
	 * @throws IllegalArgumentException if the object does not exist
	 */
	public JSONArray queryVectorAttr(Map<String, Object> classDef, String attrName, String objectId) throws Exception;

	/** Resolve a class through the bound target, or the namespace used by environment import. */
	public String sandboxClassName(String namespace, String className);

	/** Resolve the stored identifier for a sandbox object. */
	public String sandboxObjectId(String namespace, String objectId);

	/**
	 * Report the problems this adapter finds in a domain's ontomap under its own routing rules.
	 *
	 * <p>The default returns none: a single-source adapter can honour every relationship its ontomap
	 * declares. An adapter that constrains the ontomap (the multi-source adapter, whose cross-source
	 * relationships are not a graph query) returns the located problems, so the management layer can
	 * report them without knowing any adapter's constraints. Saving a multi-source configuration runs it
	 * against the domain's current ontomap.</p>
	 *
	 * @param jsonRule the domain's ontomap ({@code classDef} / {@code relationship_rule})
	 */
	default List<ConfigurationProblem> validateOntoMap(Map<String, Object> jsonRule) {
		return List.of();
	}

}
