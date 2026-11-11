package io.ontomato.dataengine.dataAdapter;

import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

import org.bson.Document;
import org.bson.types.Decimal128;
import org.bson.types.ObjectId;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import com.mongodb.ConnectionString;
import com.mongodb.MongoClientSettings;
import com.mongodb.MongoCommandException;
import com.mongodb.MongoCredential;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import com.mongodb.client.MongoCursor;
import com.mongodb.client.MongoDatabase;
import com.mongodb.client.result.UpdateResult;

import io.ontomato.dataengine.bean.DslExecutionResult;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DslUtil;
import io.ontomato.dataengine.util.HttpRequestUtil;
import lombok.extern.slf4j.Slf4j;

/**
 * MongoDB data adapter — the document-store form.
 *
 * <p>MongoDB is not a JDBC data source: {@link #openConnection()} throws and {@link #testConnection()}
 * runs a driver probe instead. One object class maps to one collection, one object to one document,
 * and the object id is stored both as {@code _id} (the driver's natural identity) and under its own
 * declared primary-key field, so generic projections and conditions by that field keep working. The
 * namespace is a <b>collection-name prefix</b>, exactly as the relational and search adapters treat
 * it: {@code createNamespace} creates nothing.</p>
 *
 * <p>The read path translates one graph DSL into one aggregation pipeline: conditions become
 * {@code $match}, one-hop relationships become {@code $lookup} + {@code $unwind}, projection becomes
 * {@code $project}, aggregation becomes {@code $group} (+ {@code $match} for having), and ordering and
 * paging become {@code $sort}/{@code $skip}/{@code $limit}. An unrenderable construct is rejected with
 * a located {@link DslContractViolationException}, never dropped.</p>
 *
 * <p>Relationships are key fields on the source document (like the relational and search adapters);
 * there is no separate edge collection. Temporal values are stored in the textual DSL form
 * ({@code yyyy-MM-dd} / {@code yyyy-MM-dd HH:mm:ss}), so a returned value feeds straight back as a
 * condition and string ordering matches chronological ordering.</p>
 */
@Slf4j
public class MongoAdapter implements DataAdapter {

	private static final Set<String> SUPPORTED_TYPES = Set.of(
			"varchar", "text", "int", "long", "double", "date", "timestamp", "vector");

	/** The most rows one step may materialize as an intermediate working set. */
	private static final long DEFAULT_MAX_MATERIALIZE = 100_000L;

	private static final DateTimeFormatter TIMESTAMP_FORMAT =
			DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(ZoneId.systemDefault());

	/** Driver-independent product name reported by {@link #testConnection()}. */
	private static final String DATABASE_PRODUCT = "MongoDB";

	private final DataAdapterConnection connection;
	private final Map<String, Object> jsonRule;
	private final long maxMaterialize;

	public MongoAdapter(DataAdapterConnection connection, Map<String, Object> jsonRule) {
		this.connection = connection;
		this.jsonRule = jsonRule == null ? new HashMap<>() : jsonRule;
		this.maxMaterialize = Long.getLong("ontomato.mongodb.maxMaterialize", DEFAULT_MAX_MATERIALIZE);
	}

	// ----------------------------------------------------------------------------------
	// Connection (non-JDBC)
	// ----------------------------------------------------------------------------------

	@Override
	public Connection openConnection() throws SQLException {
		throw new UnsupportedOperationException("MongoDB is not a JDBC data source");
	}

	/** Probes the deployment with the Mongo driver and reports the database's collections as tables. */
	@Override
	public JSONObject testConnection() throws Exception {
		long startNanos = System.nanoTime();
		try (MongoClient client = newClient()) {
			MongoDatabase db = client.getDatabase(databaseName());
			Document buildInfo = db.runCommand(new Document("buildInfo", 1));
			List<String> collections = new ArrayList<>();
			db.listCollectionNames().into(collections);
			collections.sort(String::compareTo);

			JSONArray tables = new JSONArray();
			for (String name : collections) {
				tables.add(JSONObject.of("name", name, "type", "COLLECTION"));
			}

			JSONObject report = new JSONObject();
			report.put("kind", "catalog");
			report.put("elapsedMs", (System.nanoTime() - startNanos) / 1_000_000);
			report.put("databaseProduct", DATABASE_PRODUCT);
			report.put("databaseVersion", buildInfo.getString("version"));
			report.put("driverName", "MongoDB Java Driver");
			report.put("driverVersion", driverVersion());
			report.put("catalog", databaseName());
			report.put("schema", "");
			report.put("tables", tables);
			return report;
		}
	}

	private String driverVersion() {
		String version = MongoClient.class.getPackage().getImplementationVersion();
		return version == null || version.isBlank() ? "unknown" : version;
	}

	private ConnectionString connectionString() {
		String url = connection == null ? null : connection.getUrl();
		if (url == null || url.isBlank()) {
			throw new IllegalArgumentException("MongoDB connection url is required");
		}
		return new ConnectionString(url.trim());
	}

	/** The database named by the URL; a URL without one keeps the driver's default ("test"). */
	private String databaseName() {
		String database = connectionString().getDatabase();
		return database == null || database.isBlank() ? "test" : database;
	}

	private MongoClient newClient() {
		ConnectionString cs = connectionString();
		MongoClientSettings.Builder settings = MongoClientSettings.builder().applyConnectionString(cs);
		String user = connection.getUser();
		if (user != null && !user.isBlank() && cs.getCredential() == null) {
			String authDatabase = cs.getDatabase() == null || cs.getDatabase().isBlank() ? "admin" : cs.getDatabase();
			String password = connection.getPassword() == null ? "" : connection.getPassword();
			settings.credential(MongoCredential.createCredential(user, authDatabase, password.toCharArray()));
		}
		return MongoClients.create(settings.build());
	}

	@FunctionalInterface
	private interface DbFn<T> {
		T apply(MongoDatabase db) throws Exception;
	}

	private <T> T withDatabase(DbFn<T> fn) {
		try (MongoClient client = newClient()) {
			return fn.apply(client.getDatabase(databaseName()));
		} catch (RuntimeException e) {
			throw e;
		} catch (Exception e) {
			throw new RuntimeException(e.getMessage(), e);
		}
	}

	// ----------------------------------------------------------------------------------
	// Sample data / validation
	// ----------------------------------------------------------------------------------

	@Override
	public String getSampleDataFileName(String sampleDataDirName, String className) {
		return "conf/" + sampleDataDirName + "/" + className + ".json";
	}

	@Override
	public String querySampleDataByClassName(String className, List<String> attrs) {
		try {
			JSONObject row = withDatabase(db -> {
				Document projection = new Document("_id", 0);
				if (attrs != null) {
					for (String attr : attrs) {
						projection.put(attr, 1);
					}
				}
				Document found = db.getCollection(className).find().projection(projection).limit(1).first();
				return found == null ? null : toJsonObject(found);
			});
			if (row == null) {
				return className + " class has no data";
			}
			for (String key : new ArrayList<>(row.keySet())) {
				if (row.get(key) instanceof String text && text.length() > 100) {
					row.put(key, text.substring(0, 100) + "...");
				}
			}
			return row.toJSONString();
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return "Failed to get sample data for class [" + className + "]";
		}
	}

	@Override
	public void validateClassNameFormat(String className) {
		// A collection name is taken literally; there is no quoting or case folding to constrain.
	}

	@Override
	public void validatePrimaryKeyName(String attrName) {
		// The admin layer already enforces a single varchar primary key.
	}

	// ----------------------------------------------------------------------------------
	// Namespace lifecycle: the namespace is a collection-name prefix
	// ----------------------------------------------------------------------------------

	@Override
	public void createNamespace(String namespace) {
		// Collections are created per class; a namespace is only a name prefix.
	}

	@Override
	public void truncateNamespace(String namespace) {
		if (namespace == null || namespace.isBlank()) {
			log.warn("Refusing to truncate every MongoDB collection for a blank namespace");
			return;
		}
		withDatabase(db -> {
			for (String collection : collectionsOf(db, namespace)) {
				db.getCollection(collection).deleteMany(new Document());
			}
			return null;
		});
	}

	@Override
	public void dropNamespace(String namespace) {
		if (namespace == null || namespace.isBlank()) {
			log.warn("Refusing to drop every MongoDB collection for a blank namespace");
			return;
		}
		withDatabase(db -> {
			for (String collection : collectionsOf(db, namespace)) {
				db.getCollection(collection).drop();
			}
			return null;
		});
	}

	private List<String> collectionsOf(MongoDatabase db, String namespace) {
		List<String> all = new ArrayList<>();
		db.listCollectionNames().into(all);
		List<String> matching = new ArrayList<>();
		for (String name : all) {
			if (name.startsWith(namespace)) {
				matching.add(name);
			}
		}
		return matching;
	}

	// ----------------------------------------------------------------------------------
	// Schema
	// ----------------------------------------------------------------------------------

	@Override
	public void createClass(String namespace, Map<String, Object> classDef) {
		String collection = sandboxClassName(namespace, (String) classDef.get("className"));
		try {
			withDatabase(db -> {
				try {
					db.createCollection(collection);
				} catch (MongoCommandException e) {
					if (e.getErrorCode() != 48) { // NamespaceExists
						throw e;
					}
				}
				return null;
			});
		} catch (RuntimeException e) {
			log.error("Failed to create MongoDB collection [{}]: {}", collection, e.getMessage(), e);
			throw e;
		}
	}

	@Override
	public void createEdgeType(String namespace, String edgeName) {
		// Edges are key fields on the source document; there is no separate type to create.
	}

	// ----------------------------------------------------------------------------------
	// Object CRUD
	// ----------------------------------------------------------------------------------

	@Override
	public void insertObjects(String namespace, Map<String, Object> classDef, JSONArray objs) throws Exception {
		String collectionName = sandboxClassName(namespace, (String) classDef.get("className"));
		Map<String, String> attrTypes = attrTypes(classDef);
		String primaryKey = DslUtil.getPrimaryKey(classDef);
		List<Document> documents = new ArrayList<>();
		for (int i = 0; i < objs.size(); i++) {
			JSONObject obj = objs.getJSONObject(i);
			String id = obj.getString(primaryKey);
			if (id == null || id.trim().isEmpty()) {
				throw new IllegalArgumentException(
						"The insert statement must contain the primary key [" + primaryKey + "] field");
			}
			Document document = new Document();
			for (Map.Entry<String, String> attr : attrTypes.entrySet()) {
				Object value = obj.get(attr.getKey());
				if (value != null) {
					document.put(attr.getKey(), normalizeForWrite(attr.getValue(), value));
				}
			}
			// The driver's identity is the object id; keep the declared primary-key field as well, so a
			// generic projection or condition by that field sees the same value and no ObjectId is generated.
			document.put("_id", id);
			document.put(primaryKey, id);
			documents.add(document);
		}
		if (documents.isEmpty()) {
			return;
		}
		withDatabase(db -> {
			db.getCollection(collectionName).insertMany(documents);
			return null;
		});
	}

	@Override
	public void updateObjects(String namespace, Map<String, Object> classDef, JSONObject setValues, JSONObject where)
			throws Exception {
		String collectionName = sandboxClassName(namespace, (String) classDef.get("className"));
		Map<String, String> attrTypes = attrTypes(classDef);
		String primaryKey = DslUtil.getPrimaryKey(classDef);
		Document set = new Document();
		for (String key : setValues.keySet()) {
			if (key.equals(primaryKey)) {
				throw new IllegalArgumentException("Updating the primary key [" + primaryKey + "] field is not allowed");
			}
			String type = attrTypes.get(key);
			if (type == null) {
				throw new IllegalArgumentException("Field [" + key + "] does not exist");
			}
			set.put(key, normalizeForWrite(type, setValues.get(key)));
		}
		if (set.isEmpty()) {
			return;
		}
		Document filter = where == null || where.isEmpty()
				? new Document()
				: buildWhere(where, attrTypes);
		withDatabase(db -> {
			db.getCollection(collectionName).updateMany(filter, new Document("$set", set));
			return null;
		});
	}

	@Override
	public void deleteObjects(String namespace, Map<String, Object> classDef, JSONObject where) throws Exception {
		String collectionName = sandboxClassName(namespace, (String) classDef.get("className"));
		Map<String, String> attrTypes = attrTypes(classDef);
		Document filter = where == null || where.isEmpty()
				? new Document()
				: buildWhere(where, attrTypes);
		withDatabase(db -> {
			db.getCollection(collectionName).deleteMany(filter);
			return null;
		});
	}

	// ----------------------------------------------------------------------------------
	// Edges: a key field on the source document
	// ----------------------------------------------------------------------------------

	@Override
	public void createEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
			String targetClassName, String targetObjId) throws Exception {
		applyEdge(namespace, relationName, sourceClassName, sourceObjId, targetClassName, targetObjId, true);
	}

	@Override
	public void deleteEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
			String targetClassName, String targetObjId) throws Exception {
		applyEdge(namespace, relationName, sourceClassName, sourceObjId, targetClassName, targetObjId, false);
	}

	/** Mirrors the relational foreign-key maintenance: update the source side's key field, scoped by its id. */
	private void applyEdge(String namespace, String relationName, String sourceClassName, String sourceObjId,
			String targetClassName, String targetObjId, boolean connect) throws Exception {
		Map<String, Object> sourceDef = classDefOf(sourceClassName);
		Map<String, Object> targetDef = classDefOf(targetClassName);
		Map<String, Object> relDef = relationshipDef(relationName);
		if (relDef == null || sourceDef == null || targetDef == null
				|| !sourceClassName.equals(relDef.get("fromclass")) || !targetClassName.equals(relDef.get("toclass"))) {
			throw new IllegalArgumentException("Object class [" + sourceClassName + "] and object class ["
					+ targetClassName + "] have no relationship definition [" + relationName + "]");
		}
		String sourcePk = DslUtil.getPrimaryKey(sourceDef);
		String targetPk = DslUtil.getPrimaryKey(targetDef);
		String sourceInnerField = (String) relDef.get("fromField");
		String targetInnerField = (String) relDef.get("toField");
		if (sourceInnerField == null || targetInnerField == null) {
			throw new IllegalArgumentException("Relationship [" + relationName + "] has no fromField/toField");
		}
		if (sourcePk.equals(sourceInnerField)) {
			if (!targetPk.equals(targetInnerField)) {
				Document filter = connect
						? new Document(targetPk, targetObjId)
						: new Document(targetPk, targetObjId).append(targetInnerField, sourceObjId);
				setField(sandboxClassName(namespace, (String) targetDef.get("className")), filter, targetInnerField,
						connect ? sourceObjId : null, connect);
			}
		} else if (targetPk.equals(targetInnerField)) {
			Document filter = connect
					? new Document(sourcePk, sourceObjId)
					: new Document(sourcePk, sourceObjId).append(sourceInnerField, targetObjId);
			setField(sandboxClassName(namespace, (String) sourceDef.get("className")), filter, sourceInnerField,
					connect ? targetObjId : null, connect);
		} else {
			throw new IllegalArgumentException("Relationship [" + relationName + "] does not key either object class");
		}
	}

	private void setField(String collectionName, Document filter, String field, Object value, boolean requireMatch) {
		withDatabase(db -> {
			Document update = value == null
					? new Document("$unset", new Document(field, ""))
					: new Document("$set", new Document(field, value));
			UpdateResult result = db.getCollection(collectionName).updateMany(filter, update);
			if (requireMatch && result.getMatchedCount() == 0) {
				throw new IllegalArgumentException(
						"No object in collection [" + collectionName + "] matches the edge's owner " + filter.toJson());
			}
			return null;
		});
	}

	// ----------------------------------------------------------------------------------
	// Vector attribute (read/write only; MongoDB 5.0 has no vector search)
	// ----------------------------------------------------------------------------------

	@Override
	public JSONArray queryVectorAttr(Map<String, Object> classDef, String attrName, String objectId) throws Exception {
		String className = (String) classDef.get("className");
		String primaryKey = DslUtil.getPrimaryKey(classDef);
		JSONObject document = withDatabase(db -> {
			Document found = db.getCollection(className).find(new Document(primaryKey, objectId)).first();
			return found == null ? null : toJsonObject(found);
		});
		if (document == null) {
			throw new IllegalArgumentException("Object " + objectId + " of class " + className + " does not exist");
		}
		return DslUtil.parseVectorAttr(document.get(attrName));
	}

	// ----------------------------------------------------------------------------------
	// Object-graph query (mirrors the relational adapters)
	// ----------------------------------------------------------------------------------

	@Override
	public Map<String, Object> query(JSONObject dsl, String sandboxId, String domainId, VectorResourceDao vectorResourceDao,
			DataRagConfig dataRagConfig) throws Exception {
		UserDataPermission userDataPermission = new UserDataPermission();
		JSONArray dsls = new JSONArray();
		dsls.add(dsl);
		List<Map<String, Object>> classDefs = classDefs();
		String dslStr = DslUtil.normalizeClassNames(JSONArray.toJSONString(dsls, Feature.WriteMapNullValue), classDefs);
		dslStr = DslUtil.setConditionTimeColumnToCorrectFormat(dslStr, dataRagConfig.getDslMightTimeFormats(), classDefs,
				timeConditionsAsEpochMillis(), timeConditionZone());

		Map<String, Object> effectiveRule = jsonRule;
		String effectiveDsl = dslStr;
		if (sandboxId != null && !sandboxId.trim().isEmpty()) {
			// Do not mutate the caller's ontomap: the sandbox is a per-call view of the class names.
			List<Map<String, Object>> prefixed = new ArrayList<>();
			for (Map<String, Object> classDef : classDefs) {
				Map<String, Object> copy = new LinkedHashMap<>(classDef);
				copy.put("className", sandboxId + String.valueOf(classDef.get("className")).trim());
				prefixed.add(copy);
			}
			Map<String, Object> ruleCopy = new LinkedHashMap<>(jsonRule);
			ruleCopy.put("classDef", prefixed);
			effectiveRule = ruleCopy;
			effectiveDsl = addSandboxId(dslStr, sandboxId);
		}

		DslExecutionResult result = HttpRequestUtil.executeDsl(dataRagConfig, this, effectiveDsl, null, true,
				effectiveRule, vectorResourceDao, userDataPermission, DslExecutionMode.OPTIMIZED, domainId)[1];
		JSONObject dataMap = new JSONObject();
		dataMap.putAll(result.data());
		if (result.failed()) {
			dataMap.put("error", MultiThreadAIChatService.rawErrorText(result.failure().cause()));
		}
		return dataMap;
	}

	private String addSandboxId(String dslStr, String sandboxId) {
		JSONArray dsls = JSON.parseArray(dslStr);
		for (int dslIndex = 0; dslIndex < dsls.size(); dslIndex++) {
			JSONObject steps = dsls.getJSONObject(dslIndex).getJSONObject("answer");
			JSONArray stepList = steps == null ? null : steps.getJSONArray("steps");
			if (stepList == null) {
				continue;
			}
			JSONObject graph = stepList.getJSONObject(0).getJSONObject("graph");
			JSONArray patterns = graph == null ? null : graph.getJSONArray("patterns");
			if (patterns == null) {
				continue;
			}
			JSONArray objects = patterns.getJSONObject(0).getJSONArray("objects");
			if (objects == null) {
				continue;
			}
			for (int i = 0; i < objects.size(); i++) {
				JSONObject object = objects.getJSONObject(i);
				if (object != null) {
					object.put("class", sandboxId + object.getString("class").trim());
				}
			}
		}
		return JSON.toJSONString(dsls, Feature.WriteMapNullValue);
	}

	// ----------------------------------------------------------------------------------
	// DSL execution
	// ----------------------------------------------------------------------------------

	@Override
	public String executeDsl(String queryJson, String sessionId, DslExecutionMode mode, List<String> generatedMqls)
			throws Exception {
		log.debug("[{}] DSL to MongoDB aggregation: {}", sessionId, queryJson);
		List<String> mqls = generatedMqls == null ? new ArrayList<>() : generatedMqls;
		JSONArray dsls = JSONArray.parseArray(queryJson);
		if (dsls == null || dsls.isEmpty() || dsls.getJSONObject(0) == null) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"query", "the DSL request array is empty");
		}
		JSONObject answer = dsls.getJSONObject(0).getJSONObject("answer");
		JSONArray steps = answer == null ? null : answer.getJSONArray("steps");
		if (steps == null || steps.isEmpty()) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"answer.steps", "the DSL has no step to execute");
		}
		if (steps.size() > 2) {
			throw new DslContractViolationException(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
					"answer.steps[" + 2 + "]", "MongoDB supports at most two steps");
		}

		DslRowLimit.Tracker rowLimit = new DslRowLimit.Tracker();
		List<JSONObject> rows = steps.size() == 1
				? executeStep(steps.getJSONObject(0), 0, null, rowLimit, true, mqls)
				: executeTwoStep(steps.getJSONObject(0), steps.getJSONObject(1), rowLimit, mqls);

		JSONArray answers = new JSONArray();
		JSONObject answerObject = new JSONObject();
		JSONArray answerRows = new JSONArray();
		answerRows.addAll(rows);
		answerObject.put("answer", answerRows);
		answerObject.put("mqls", mqls);
		if (rowLimit.truncated()) {
			answerObject.put(DslRowLimit.TRUNCATED, true);
			answerObject.put(DslRowLimit.ROW_LIMIT, rowLimit.truncatedLimit());
			answerObject.put(DslRowLimit.TRUNCATION_HINT, rowLimit.hint());
			log.warn("[{}] {}", sessionId, rowLimit.hint());
		}
		answers.add(answerObject);
		return JSON.toJSONString(answers, Feature.WriteMapNullValue);
	}

	/**
	 * Two steps: step 0 projects the subgraph into rows; step 1 aggregates over those rows. MongoDB has
	 * no cross-aggregation temporary relation, so the intermediate is loaded into a temporary collection
	 * and step 1 runs as a native pipeline over it — the document-store form of {@code select ... from
	 * (subquery) as tmp}. The temporary collection is dropped in {@code finally}.
	 */
	private List<JSONObject> executeTwoStep(JSONObject first, JSONObject second, DslRowLimit.Tracker rowLimit,
			List<String> mqls) throws Exception {
		List<JSONObject> intermediate = executeStep(first, 0, null, rowLimit, false, mqls);
		String temporary = "ontomato_tmp_" + UUID.randomUUID().toString().replace("-", "");
		try {
			withDatabase(db -> {
				db.createCollection(temporary);
				if (!intermediate.isEmpty()) {
					List<Document> documents = new ArrayList<>();
					for (JSONObject row : intermediate) {
						documents.add(toDocument(row));
					}
					db.getCollection(temporary).insertMany(documents);
				}
				return null;
			});
			mqls.add("TWO-STEP " + temporary + " rows=" + intermediate.size());
			return executeStep(second, 1, temporary, rowLimit, true, mqls);
		} finally {
			try {
				withDatabase(db -> {
					db.getCollection(temporary).drop();
					return null;
				});
			} catch (RuntimeException e) {
				log.debug("dropping intermediate collection [{}] failed: {}", temporary, e.getMessage());
			}
		}
	}

	/** One step: join the graph's objects, then project / aggregate / sort / limit. */
	private List<JSONObject> executeStep(JSONObject step, int stepIndex, String baseCollection,
			DslRowLimit.Tracker rowLimit, boolean terminal, List<String> mqls) throws Exception {
		JSONObject graph = step.getJSONObject("graph");
		if (graph == null) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"steps[" + stepIndex + "].graph", "the step has no graph");
		}
		JSONArray patterns = graph.getJSONArray("patterns");
		if (patterns == null || patterns.isEmpty()) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"steps[" + stepIndex + "].graph.patterns", "the graph has no pattern");
		}
		if (patterns.size() > 1) {
			throw new DslContractViolationException(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
					"steps[" + stepIndex + "].graph.patterns",
					"MongoDB executes one pattern per step; a multi-pattern graph is not supported");
		}
		JSONObject pattern = patterns.getJSONObject(0);
		JSONArray objects = pattern.getJSONArray("objects");
		if (objects == null || objects.isEmpty()) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"steps[" + stepIndex + "].graph.patterns[0].objects", "the pattern has no object");
		}
		JSONObject output = step.getJSONObject("output");
		if (output == null || output.getJSONArray("fields") == null || output.getJSONArray("fields").isEmpty()) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"steps[" + stepIndex + "].output.fields", "the step has no output field");
		}

		Map<String, Map<String, String>> attrTypesByClass = attrTypesByIdentity();
		Map<String, Set<String>> enabledByClass = enabledAttrsByIdentity();

		Map<Integer, JSONObject> byIdx = new LinkedHashMap<>();
		Map<Integer, String> prefixByIdx = new HashMap<>();
		Map<String, String> prefixByVariable = new HashMap<>();
		for (int i = 0; i < objects.size(); i++) {
			JSONObject object = objects.getJSONObject(i);
			Integer idx = object.getInteger("idx") == null ? i : object.getInteger("idx");
			if (byIdx.put(idx, object) != null) {
				throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
						"steps[" + stepIndex + "].graph.patterns[0].objects[" + i + "].idx",
						"duplicate object index " + idx);
			}
		}

		JSONObject base = objects.getJSONObject(0);
		Integer baseIdx = base.getInteger("idx") == null ? 0 : base.getInteger("idx");
		String collection = baseCollection != null ? baseCollection : base.getString("class");
		if (collection == null || collection.isBlank()) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"steps[" + stepIndex + "].graph.patterns[0].objects[0].class", "the object has no class");
		}
		String baseVariable = base.getString("variable");
		if (baseVariable == null || baseVariable.isBlank()) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"steps[" + stepIndex + "].graph.patterns[0].objects[0].variable",
					"the object has no variable");
		}
		prefixByIdx.put(baseIdx, "");
		prefixByVariable.put(baseVariable, "");

		List<Document> pipeline = new ArrayList<>();
		String basePath = objectPath(stepIndex, 0);
		Document baseConditions = conditions(base.getJSONObject("conditions"),
				attrTypesByClass.getOrDefault(collection, new HashMap<>()),
				enabledByClass.getOrDefault(collection, new java.util.HashSet<>()), "", basePath);
		if (baseConditions != null) {
			pipeline.add(new Document("$match", baseConditions));
		}

		// Join the remaining objects one hop at a time. Each relationship is resolved to its two ends and
		// their key fields; only a not-yet-joined end can be a $lookup target.
		List<JSONObject> pending = new ArrayList<>();
		JSONArray relationships = pattern.getJSONArray("relationship");
		if (relationships != null) {
			for (int i = 0; i < relationships.size(); i++) {
				pending.add(relationships.getJSONObject(i));
			}
		}
		Set<Integer> joined = new LinkedHashSet<>();
		joined.add(baseIdx);
		while (!pending.isEmpty()) {
			boolean progress = false;
			for (Iterator<JSONObject> iterator = pending.iterator(); iterator.hasNext();) {
				JSONObject relationship = iterator.next();
				int from = relationship.getIntValue("from");
				int to = relationship.getIntValue("to");
				if (!byIdx.containsKey(from) || !byIdx.containsKey(to)) {
					throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
							"steps[" + stepIndex + "].graph.patterns[0].relationship",
							"relationship endpoint " + from + "/" + to + " names no object");
				}
				if (joined.contains(from) && joined.contains(to)) {
					throw new DslContractViolationException(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
							"steps[" + stepIndex + "].graph.patterns[0].relationship",
							"a relationship between two already-joined objects cannot be expressed as a lookup");
				}
				if (joined.contains(from)) {
					join(byIdx, prefixByIdx, prefixByVariable, joined, from, to, relationship, true,
							pipeline, stepIndex, attrTypesByClass, enabledByClass);
					iterator.remove();
					progress = true;
				} else if (joined.contains(to)) {
					join(byIdx, prefixByIdx, prefixByVariable, joined, to, from, relationship, false,
							pipeline, stepIndex, attrTypesByClass, enabledByClass);
					iterator.remove();
					progress = true;
				}
			}
			if (!progress) {
				break;
			}
		}
		if (joined.size() < byIdx.size()) {
			throw new DslContractViolationException(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
					"steps[" + stepIndex + "].graph.patterns[0].objects",
					"the pattern contains objects with no path to the first object; a cross join is not supported");
		}

		addOutputStages(pipeline, output, prefixByVariable, stepIndex);
		addSortStage(pipeline, output, stepIndex);

		LimitPlan limitPlan = applyLimit(pipeline, output.getJSONObject("limit"), rowLimit, terminal);
		List<JSONObject> rows = runAggregation(collection, pipeline, mqls);
		if (limitPlan.empty()) {
			return new ArrayList<>();
		}
		if (limitPlan.probeCap() > 0 && rows.size() > limitPlan.probeCap()) {
			rows.subList(limitPlan.probeCap(), rows.size()).clear();
			rowLimit.markTruncated();
		} else if (!terminal && rows.size() > maxMaterialize) {
			rows.subList((int) maxMaterialize, rows.size()).clear();
			rowLimit.markTruncated((int) maxMaterialize, "The working-set limit of " + maxMaterialize
					+ " was reached while materializing an intermediate result; it is incomplete.");
		}
		return rows;
	}

	private void join(Map<Integer, JSONObject> byIdx, Map<Integer, String> prefixByIdx,
			Map<String, String> prefixByVariable, Set<Integer> joined, int existingIdx, int newIdx,
			JSONObject relationship, boolean forward, List<Document> pipeline, int stepIndex,
			Map<String, Map<String, String>> attrTypesByClass, Map<String, Set<String>> enabledByClass) {
		JSONObject target = byIdx.get(newIdx);
		String targetVariable = target.getString("variable");
		if (targetVariable == null || targetVariable.isBlank()) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"steps[" + stepIndex + "].graph.patterns[0].objects",
					"an object has no variable");
		}
		if (prefixByVariable.containsKey(targetVariable)) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"steps[" + stepIndex + "].graph.patterns[0].objects",
					"duplicate object variable [" + targetVariable + "]");
		}

		String relationName = singleRelationType(relationship, stepIndex);
		Map<String, Object> relation = relationshipDef(relationName);
		if (relation == null) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"steps[" + stepIndex + "].graph.patterns[0].relationship",
					"relationship [" + relationName + "] is not defined in the ontomap");
		}
		String fromField = (String) relation.get("fromField");
		String toField = (String) relation.get("toField");
		if (fromField == null || toField == null) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"steps[" + stepIndex + "].graph.patterns[0].relationship",
					"relationship [" + relationName + "] has no fromField/toField to join on");
		}

		String targetCollection = target.getString("class");
		if (targetCollection == null || targetCollection.isBlank()) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"steps[" + stepIndex + "].graph.patterns[0].objects",
					"the object has no class");
		}
		String localField = prefixByIdx.getOrDefault(existingIdx, "") + (forward ? fromField : toField);
		String foreignField = forward ? toField : fromField;

		pipeline.add(new Document("$lookup", new Document("from", targetCollection)
				.append("localField", localField)
				.append("foreignField", foreignField)
				.append("as", targetVariable)));
		pipeline.add(new Document("$unwind", "$" + targetVariable));

		String targetPath = "steps[" + stepIndex + "].graph.patterns[0].objects["
				+ indexOfIdx(byIdx, newIdx) + "].conditions";
		Document targetConditions = conditions(target.getJSONObject("conditions"),
				attrTypesByClass.getOrDefault(targetCollection, new HashMap<>()),
				enabledByClass.getOrDefault(targetCollection, new java.util.HashSet<>()),
				targetVariable + ".", targetPath);
		if (targetConditions != null) {
			pipeline.add(new Document("$match", targetConditions));
		}

		prefixByIdx.put(newIdx, targetVariable + ".");
		prefixByVariable.put(targetVariable, targetVariable + ".");
		joined.add(newIdx);
	}

	private int indexOfIdx(Map<Integer, JSONObject> byIdx, int idx) {
		int position = 0;
		for (Integer key : byIdx.keySet()) {
			if (key == idx) {
				return position;
			}
			position++;
		}
		return position;
	}

	private String singleRelationType(JSONObject relationship, int stepIndex) {
		JSONArray types = relationship.getJSONArray("type");
		if (types == null || types.isEmpty()) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"steps[" + stepIndex + "].graph.patterns[0].relationship",
					"a relationship has no type");
		}
		if (types.size() > 1) {
			throw new DslContractViolationException(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
					"steps[" + stepIndex + "].graph.patterns[0].relationship",
					"MongoDB joins on one relationship; multiple types " + types + " are not supported");
		}
		String type = types.getString(0);
		if (type == null || type.isBlank() || "*".equals(type.trim())) {
			throw new DslContractViolationException(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
					"steps[" + stepIndex + "].graph.patterns[0].relationship",
					"the any-type relationship [\"*\"] is a graph-engine construct; MongoDB needs a named key-field relationship");
		}
		return type.trim();
	}

	// ----------------------------------------------------------------------------------
	// Output / aggregation stages
	// ----------------------------------------------------------------------------------

	private void addOutputStages(List<Document> pipeline, JSONObject output, Map<String, String> prefixByVariable,
			int stepIndex) {
		JSONArray fields = output.getJSONArray("fields");
		JSONObject groupBy = output.getJSONObject("group_by");
		boolean aggregated = groupBy != null;
		boolean distinct = false;
		for (int i = 0; i < fields.size(); i++) {
			JSONObject field = fields.getJSONObject(i);
			if (hasFunction(field)) {
				aggregated = true;
			}
			if (Boolean.TRUE.equals(field.getBoolean("distinct"))) {
				distinct = true;
			}
		}

		if (aggregated) {
			addGroupStages(pipeline, output, prefixByVariable, stepIndex);
		} else if (distinct) {
			Document id = new Document();
			for (int i = 0; i < fields.size(); i++) {
				JSONObject field = fields.getJSONObject(i);
				id.put("k" + i, "$" + fieldPath(field, prefixByVariable, stepIndex));
			}
			pipeline.add(new Document("$group", new Document("_id", id)));
			Document project = new Document("_id", 0);
			for (int i = 0; i < fields.size(); i++) {
				project.put(alias(fields.getJSONObject(i), stepIndex), "$_id.k" + i);
			}
			pipeline.add(new Document("$project", project));
		} else {
			Document project = new Document("_id", 0);
			for (int i = 0; i < fields.size(); i++) {
				JSONObject field = fields.getJSONObject(i);
				project.put(alias(field, stepIndex), "$" + fieldPath(field, prefixByVariable, stepIndex));
			}
			pipeline.add(new Document("$project", project));
		}
	}

	private void addGroupStages(List<Document> pipeline, JSONObject output, Map<String, String> prefixByVariable,
			int stepIndex) {
		JSONArray fields = output.getJSONArray("fields");
		JSONObject groupBy = output.getJSONObject("group_by");
		JSONArray having = groupBy == null ? null : groupBy.getJSONArray("having");

		// Every aggregate that a projection or a having clause names gets one accumulator.
		List<JSONObject> metrics = new ArrayList<>();
		for (int i = 0; i < fields.size(); i++) {
			metrics.add(fields.getJSONObject(i));
		}
		if (having != null) {
			for (int i = 0; i < having.size(); i++) {
				metrics.add(having.getJSONObject(i));
			}
		}

		Document groupId = new Document();
		Map<String, String> keyBySignature = new LinkedHashMap<>();
		int keySeq = 0;
		JSONArray groupFields = groupBy == null ? null : groupBy.getJSONArray("fields");
		if (groupFields != null) {
			for (int i = 0; i < groupFields.size(); i++) {
				JSONObject groupField = groupFields.getJSONObject(i);
				String signature = signature(groupField);
				if (!keyBySignature.containsKey(signature)) {
					String key = "k" + keySeq++;
					keyBySignature.put(signature, key);
					groupId.put(key, "$" + fieldPath(groupField, prefixByVariable, stepIndex));
				}
			}
		}
		// A projected column that is not a declared group key is still part of the row identity; group by
		// it too rather than dropping or guessing it.
		for (int i = 0; i < fields.size(); i++) {
			JSONObject field = fields.getJSONObject(i);
			if (hasFunction(field)) {
				continue;
			}
			String signature = signature(field);
			if (!keyBySignature.containsKey(signature)) {
				String key = "k" + keySeq++;
				keyBySignature.put(signature, key);
				groupId.put(key, "$" + fieldPath(field, prefixByVariable, stepIndex));
			}
		}

		Document group = new Document("_id", groupId.isEmpty() ? null : groupId);
		Map<String, String> accumulatorBySignature = new LinkedHashMap<>();
		List<String> distinctAccumulators = new ArrayList<>();
		int accSeq = 0;
		for (JSONObject metric : metrics) {
			if (!hasFunction(metric)) {
				continue;
			}
			String signature = signature(metric);
			if (accumulatorBySignature.containsKey(signature)) {
				continue;
			}
			String name = "a" + accSeq++;
			accumulatorBySignature.put(signature, name);
			String function = metric.getString("function").toLowerCase(Locale.ROOT);
			String path = "$" + fieldPath(metric, prefixByVariable, stepIndex);
			boolean metricDistinct = Boolean.TRUE.equals(metric.getBoolean("distinct"));
			if (metricDistinct) {
				if (!"count".equals(function)) {
					throw new DslContractViolationException(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
							"steps[" + stepIndex + "].output.fields",
							"distinct " + function + " is not supported by MongoAdapter; only distinct count is");
				}
				group.put(name, new Document("$addToSet", path));
				distinctAccumulators.add(name);
				continue;
			}
			switch (function) {
				case "count" -> {
					if ("*".equals(metric.getString("field"))) {
						group.put(name, new Document("$sum", 1));
					} else {
						group.put(name, new Document("$sum",
								new Document("$cond", Arrays.asList(new Document("$ne", Arrays.asList(path, null)), 1, 0))));
					}
				}
				case "sum" -> group.put(name, new Document("$sum", path));
				case "avg" -> group.put(name, new Document("$avg", path));
				case "min" -> group.put(name, new Document("$min", path));
				case "max" -> group.put(name, new Document("$max", path));
				default -> throw new DslContractViolationException(
						DslContractViolationException.Code.UNSUPPORTED_OPERATOR_FOR_TYPE,
						"steps[" + stepIndex + "].output.fields",
						"aggregate function '" + function + "' on field '" + metric.getString("field")
								+ "' is not supported by MongoAdapter");
			}
		}
		pipeline.add(new Document("$group", group));

		if (!distinctAccumulators.isEmpty()) {
			Document sizes = new Document();
			for (String name : distinctAccumulators) {
				// A distinct count excludes nulls, as SQL COUNT(DISTINCT col) does.
				sizes.put(name, new Document("$size",
						new Document("$setDifference", Arrays.asList("$" + name, Collections.singletonList(null)))));
			}
			pipeline.add(new Document("$addFields", sizes));
		}

		if (having != null && !having.isEmpty()) {
			List<Document> clauses = new ArrayList<>();
			for (int i = 0; i < having.size(); i++) {
				JSONObject condition = having.getJSONObject(i);
				if (!hasFunction(condition)) {
					throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
							"steps[" + stepIndex + "].output.group_by.having",
							"a having condition needs an aggregate function");
				}
				String name = accumulatorBySignature.get(signature(condition));
				clauses.add(comparison(name, condition.getString("operator"), condition.get("value"),
						"steps[" + stepIndex + "].output.group_by.having"));
			}
			pipeline.add(new Document("$match",
					clauses.size() == 1 ? clauses.get(0) : new Document("$and", clauses)));
		}

		Document project = new Document("_id", 0);
		for (int i = 0; i < fields.size(); i++) {
			JSONObject field = fields.getJSONObject(i);
			String as = alias(field, stepIndex);
			if (hasFunction(field)) {
				project.put(as, "$" + accumulatorBySignature.get(signature(field)));
			} else {
				project.put(as, "$_id." + keyBySignature.get(signature(field)));
			}
		}
		pipeline.add(new Document("$project", project));
	}

	private void addSortStage(List<Document> pipeline, JSONObject output, int stepIndex) {
		JSONObject sort = output.getJSONObject("sort");
		JSONArray sortFields = sort == null ? null : sort.getJSONArray("fields");
		if (sortFields == null || sortFields.isEmpty()) {
			return;
		}
		JSONArray fields = output.getJSONArray("fields");
		Document order = new Document();
		for (int i = 0; i < sortFields.size(); i++) {
			JSONObject sortField = sortFields.getJSONObject(i);
			String name = sortField.getString("field");
			String as = projectedAlias(name, fields);
			if (as == null) {
				throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
						"steps[" + stepIndex + "].output.sort.fields",
						"sort field [" + name + "] is not one of the projected fields");
			}
			order.put(as, "desc".equalsIgnoreCase(sortField.getString("order")) ? -1 : 1);
		}
		pipeline.add(new Document("$sort", order));
	}

	private String projectedAlias(String name, JSONArray fields) {
		for (int i = 0; i < fields.size(); i++) {
			JSONObject field = fields.getJSONObject(i);
			String as = field.getString("as");
			String source = field.getString("field");
			if (name.equals(as)) {
				return as;
			}
			if (name.equals(source)) {
				return as == null || as.isBlank() ? source : as;
			}
		}
		return null;
	}

	private record LimitPlan(int probeCap, boolean empty) {
	}

	private LimitPlan applyLimit(List<Document> pipeline, JSONObject limit, DslRowLimit.Tracker rowLimit,
			boolean terminal) {
		if (limit != null && limit.getInteger("count") != null) {
			int count = Math.max(0, limit.getIntValue("count"));
			int offset = limit.getInteger("offset") == null ? 0 : Math.max(0, limit.getIntValue("offset"));
			if (offset > 0) {
				pipeline.add(new Document("$skip", offset));
			}
			pipeline.add(new Document("$limit", Math.max(1, count)));
			if (terminal) {
				rowLimit.terminalLimit(count, false);
			}
			return new LimitPlan(0, count == 0);
		}
		if (!terminal) {
			pipeline.add(new Document("$limit", (int) Math.min(Integer.MAX_VALUE - 1L, maxMaterialize + 1)));
			return new LimitPlan(0, false);
		}
		int cap = DslRowLimit.defaultRowLimit();
		rowLimit.terminalLimit(cap, true);
		pipeline.add(new Document("$limit", cap + 1));
		return new LimitPlan(cap, false);
	}

	// ----------------------------------------------------------------------------------
	// Conditions -> $match
	// ----------------------------------------------------------------------------------

	/** The write path's condition grammar: like is anchored where written, without the read path's %-wrapping. */
	private Document buildWhere(JSONObject condition, Map<String, String> attrTypes) {
		if (condition == null || condition.isEmpty()) {
			return new Document();
		}
		Document where = property(condition, attrTypes, attrTypes.keySet(), "", "conditions", false);
		return where == null ? new Document() : where;
	}

	/**
	 * The condition tree of one object: {@code conditions.properties}, {@code conditions.text} and the
	 * constructs this adapter does not implement.
	 */
	private Document conditions(JSONObject conditions, Map<String, String> attrTypes, Set<String> enabled,
			String prefix, String path) {
		if (conditions == null || conditions.isEmpty()) {
			return null;
		}
		if (conditions.getJSONObject("timeseries") != null) {
			throw new DslContractViolationException(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
					path + ".timeseries", "the timeseries condition is not implemented by MongoAdapter");
		}
		if (conditions.getJSONObject("vector") != null) {
			throw new DslContractViolationException(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
					path + ".vector",
					"MongoDB search is not available in this deployment; only vector attribute read/write is supported");
		}

		List<Document> clauses = new ArrayList<>();
		JSONObject properties = conditions.getJSONObject("properties");
		if (properties != null) {
			Document clause = property(properties, attrTypes, enabled, prefix, path + ".properties", true);
			if (clause != null) {
				clauses.add(clause);
			}
		}
		JSONObject text = conditions.getJSONObject("text");
		String query = text == null ? null : text.getString("query");
		if (query != null && !query.trim().isEmpty()) {
			List<Document> alternatives = new ArrayList<>();
			for (String attr : enabled) {
				String type = attrTypes.get(attr);
				if ("text".equals(type) || "varchar".equals(type)) {
					alternatives.add(new Document(prefix + attr,
							Pattern.compile(".*" + Pattern.quote(query.trim()) + ".*", Pattern.CASE_INSENSITIVE)));
				}
			}
			if (alternatives.isEmpty()) {
				throw new DslContractViolationException(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
						path + ".text.query",
						"the text query needs an enabled text or varchar attribute, and this class has none");
			}
			clauses.add(new Document("$or", alternatives));
		}
		if (clauses.isEmpty()) {
			return null;
		}
		return clauses.size() == 1 ? clauses.get(0) : new Document("$and", clauses);
	}

	private Document property(JSONObject condition, Map<String, String> attrTypes, Set<String> enabled,
			String prefix, String path, boolean readPath) {
		JSONArray and = condition.getJSONArray("and");
		if (and != null && !and.isEmpty()) {
			List<Document> clauses = new ArrayList<>();
			for (int i = 0; i < and.size(); i++) {
				Document clause = property(and.getJSONObject(i), attrTypes, enabled, prefix, path + ".and[" + i + "]",
						readPath);
				if (clause != null) {
					clauses.add(clause);
				}
			}
			return clauses.isEmpty() ? null : new Document("$and", clauses);
		}
		JSONArray or = condition.getJSONArray("or");
		if (or != null && !or.isEmpty()) {
			List<Document> clauses = new ArrayList<>();
			for (int i = 0; i < or.size(); i++) {
				Document clause = property(or.getJSONObject(i), attrTypes, enabled, prefix, path + ".or[" + i + "]",
						readPath);
				if (clause != null) {
					clauses.add(clause);
				}
			}
			return clauses.isEmpty() ? null : new Document("$or", clauses);
		}
		JSONArray not = condition.getJSONArray("not");
		if (not != null && !not.isEmpty()) {
			JSONObject negated = DslGrammarValidator.negated(condition);
			Document clause = property(negated, attrTypes, enabled, prefix, path + ".not[0]", readPath);
			return clause == null ? null : new Document("$nor", Collections.singletonList(clause));
		}
		return leaf(condition, attrTypes, prefix, path, readPath);
	}

	private Document leaf(JSONObject condition, Map<String, String> attrTypes, String prefix, String path,
			boolean readPath) {
		String field = condition.getString("field");
		if (field == null || field.isBlank()) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR, path,
					"a condition has no 'field' property");
		}
		String type = attrTypes.get(field);
		String operator = condition.getString("operator");
		if (operator == null) {
			operator = "";
		}
		String key = prefix + field;
		Object value = condition.get("value");
		switch (operator) {
			case "=":
				requireValue(value, operator, field, path);
				return new Document(key, value);
			case "!=":
				requireValue(value, operator, field, path);
				return new Document(key, new Document("$ne", value));
			case ">", ">=", "<", "<=": {
				requireValue(value, operator, field, path);
				String op = switch (operator) {
					case ">" -> "$gt";
					case ">=" -> "$gte";
					case "<" -> "$lt";
					default -> "$lte";
				};
				return new Document(key, new Document(op, value));
			}
			case "between": {
				List<Object> bounds = listValue(value, "between", field, path);
				if (bounds.size() != 2) {
					throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR, path,
							"between on field '" + field + "' needs two values");
				}
				return new Document(key, new Document("$gte", bounds.get(0)).append("$lte", bounds.get(1)));
			}
			case "in":
				return new Document(key, new Document("$in", listValue(value, "in", field, path)));
			case "like", "not like": {
				if (isNumeric(type)) {
					throw new DslContractViolationException(
							DslContractViolationException.Code.UNSUPPORTED_OPERATOR_FOR_TYPE, path,
							"operator '" + operator + "' on field '" + field + "' of type '" + type
									+ "' is not supported by MongoAdapter");
				}
				Pattern pattern = Pattern.compile(likeRegex(condition, readPath, field, path));
				if ("not like".equals(operator)) {
					return new Document(key, new Document("$not", pattern));
				}
				return new Document(key, pattern);
			}
			case "is":
				return new Document(key, null);
			case "is not":
				return new Document(key, new Document("$ne", null));
			default:
				throw new DslContractViolationException(
						DslContractViolationException.Code.UNSUPPORTED_OPERATOR_FOR_TYPE, path,
						"operator '" + operator + "' on field '" + field + "' is not supported by MongoAdapter");
		}
	}

	private void requireValue(Object value, String operator, String field, String path) {
		if (value == null) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR, path,
					"operator '" + operator + "' on field '" + field + "' needs a value");
		}
	}

	private List<Object> listValue(Object value, String operator, String field, String path) {
		if (value instanceof List<?> list) {
			return new ArrayList<>(list);
		}
		throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR, path,
				"operator '" + operator + "' on field '" + field + "' needs an array value");
	}

	private boolean isNumeric(String type) {
		return "int".equals(type) || "long".equals(type) || "double".equals(type);
	}

	/**
	 * The regular expression of a like condition. An escape character makes the following character
	 * literal (via {@link LikePattern}); otherwise {@code %} and {@code _} are the wildcards and every
	 * other character is quoted, so a value is matched as data rather than as regex syntax.
	 */
	private String likeRegex(JSONObject condition, boolean readPath, String field, String path) {
		if (LikePattern.escaped(condition)) {
			return LikePattern.of(condition, readPath)
					.render(".*", ".", character -> Pattern.quote(String.valueOf(character)));
		}
		Object raw = condition.get("value");
		if (!(raw instanceof String patternText)) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR, path,
					"operator 'like' on field '" + field + "' needs a text value");
		}
		String pattern = patternText;
		if (readPath && !pattern.startsWith("%") && !pattern.endsWith("%")) {
			pattern = "%" + pattern + "%";
		}
		StringBuilder regex = new StringBuilder("^");
		for (char character : pattern.toCharArray()) {
			if (character == '%') {
				regex.append(".*");
			} else if (character == '_') {
				regex.append('.');
			} else {
				regex.append(Pattern.quote(String.valueOf(character)));
			}
		}
		return regex.append('$').toString();
	}

	private Document comparison(String field, String operator, Object value, String path) {
		String op = operator == null ? "" : operator;
		return switch (op) {
			case "=" -> new Document(field, value);
			case "!=" -> new Document(field, new Document("$ne", value));
			case ">" -> new Document(field, new Document("$gt", value));
			case ">=" -> new Document(field, new Document("$gte", value));
			case "<" -> new Document(field, new Document("$lt", value));
			case "<=" -> new Document(field, new Document("$lte", value));
			default -> throw new DslContractViolationException(
					DslContractViolationException.Code.UNSUPPORTED_OPERATOR_FOR_TYPE, path,
					"operator '" + op + "' on field '" + field + "' is not supported by MongoAdapter");
		};
	}

	// ----------------------------------------------------------------------------------
	// Engine execution / value conversion
	// ----------------------------------------------------------------------------------

	private List<JSONObject> runAggregation(String collection, List<Document> pipeline, List<String> generatedMqls) {
		if (generatedMqls != null) {
			generatedMqls.add("db." + collection + ".aggregate(" + new Document("pipeline", pipeline).toJson() + ")");
		}
		return withDatabase(db -> {
			List<JSONObject> rows = new ArrayList<>();
			try (MongoCursor<Document> cursor = db.getCollection(collection).aggregate(pipeline).allowDiskUse(true).iterator()) {
				while (cursor.hasNext()) {
					rows.add(toJsonObject(cursor.next()));
				}
			}
			return rows;
		});
	}

	private static JSONObject toJsonObject(Document document) {
		JSONObject json = new JSONObject();
		for (Map.Entry<String, Object> entry : document.entrySet()) {
			json.put(entry.getKey(), plainValue(entry.getValue()));
		}
		return json;
	}

	private static Object plainValue(Object value) {
		if (value instanceof Document document) {
			return toJsonObject(document);
		}
		if (value instanceof List<?> list) {
			JSONArray array = new JSONArray();
			for (Object item : list) {
				array.add(plainValue(item));
			}
			return array;
		}
		if (value instanceof ObjectId objectId) {
			return objectId.toHexString();
		}
		if (value instanceof Decimal128 decimal) {
			return decimal.bigDecimalValue();
		}
		if (value instanceof java.util.Date date) {
			return TIMESTAMP_FORMAT.format(Instant.ofEpochMilli(date.getTime()));
		}
		return value;
	}

	private static Document toDocument(JSONObject json) {
		Document document = new Document();
		for (String key : json.keySet()) {
			document.put(key, toBsonValue(json.get(key)));
		}
		return document;
	}

	private static Object toBsonValue(Object value) {
		if (value instanceof JSONObject json) {
			return toDocument(json);
		}
		if (value instanceof JSONArray array) {
			List<Object> list = new ArrayList<>();
			for (Object item : array) {
				list.add(toBsonValue(item));
			}
			return list;
		}
		return value;
	}

	// ----------------------------------------------------------------------------------
	// Naming / metadata helpers
	// ----------------------------------------------------------------------------------

	private String physicalName(String namespace, String className) {
		return (namespace == null ? "" : namespace) + className;
	}

	@Override
	public String sandboxClassName(String sandboxId, String className) {
		return physicalName(sandboxId, className);
	}

	@Override
	public String sandboxObjectId(String sandboxId, String objectId) {
		return objectId;
	}

	@SuppressWarnings("unchecked")
	private Map<String, Object> relationshipRule() {
		Object rule = jsonRule.get("relationship_rule");
		return rule instanceof Map<?, ?> map ? (Map<String, Object>) map : new HashMap<>();
	}

	private Map<String, Object> relationshipDef(String relationName) {
		Object relation = relationshipRule().get(relationName);
		return relation instanceof Map<?, ?> map ? castMap(map) : null;
	}

	@SuppressWarnings("unchecked")
	private static Map<String, Object> castMap(Map<?, ?> map) {
		return (Map<String, Object>) map;
	}

	@SuppressWarnings("unchecked")
	private List<Map<String, Object>> classDefs() {
		Object classDefs = jsonRule.get("classDef");
		return classDefs instanceof List<?> list ? (List<Map<String, Object>>) list : new ArrayList<>();
	}

	private Map<String, Object> classDefOf(String className) {
		for (Map<String, Object> classDef : classDefs()) {
			if (className.equals(classDef.get("className"))) {
				return classDef;
			}
		}
		return null;
	}

	private Map<String, Map<String, String>> attrTypesByIdentity() {
		Map<String, Map<String, String>> byClass = new HashMap<>();
		for (Map<String, Object> classDef : classDefs()) {
			byClass.put((String) classDef.get("className"), attrTypes(classDef));
		}
		return byClass;
	}

	private Map<String, Set<String>> enabledAttrsByIdentity() {
		Map<String, Set<String>> byClass = new HashMap<>();
		for (Map<String, Object> classDef : classDefs()) {
			byClass.put((String) classDef.get("className"), enabledAttrs(classDef));
		}
		return byClass;
	}

	private Map<String, String> attrTypes(Map<String, Object> classDef) {
		Map<String, String> types = new LinkedHashMap<>();
		for (String name : enabledAttrs(classDef)) {
			types.put(name, attrType(classDef, name));
		}
		return types;
	}

	private Set<String> enabledAttrs(Map<String, Object> classDef) {
		Set<String> enabled = new LinkedHashSet<>();
		List<Map<String, Object>> attrs = attrs(classDef);
		if (attrs != null) {
			for (Map<String, Object> attr : attrs) {
				Object name = attr.get("name");
				Object type = attr.get("type");
				boolean isEnabled = attr.get("enable") == null || Boolean.TRUE.equals(attr.get("enable"));
				if (isEnabled && name instanceof String text && isSupportedType((String) type)) {
					enabled.add(text);
				}
			}
		}
		return enabled;
	}

	private String attrType(Map<String, Object> classDef, String name) {
		List<Map<String, Object>> attrs = attrs(classDef);
		if (attrs != null) {
			for (Map<String, Object> attr : attrs) {
				if (name.equals(attr.get("name"))) {
					return (String) attr.get("type");
				}
			}
		}
		return null;
	}

	@SuppressWarnings("unchecked")
	private static List<Map<String, Object>> attrs(Map<String, Object> classDef) {
		Object attrs = classDef == null ? null : classDef.get("attrs");
		return attrs instanceof List<?> list ? (List<Map<String, Object>>) list : null;
	}

	private boolean isSupportedType(String type) {
		return type != null && SUPPORTED_TYPES.contains(type);
	}

	private Object normalizeForWrite(String type, Object value) {
		if (value == null) {
			return null;
		}
		if ("vector".equals(type) && !(value instanceof String)) {
			return JSON.toJSONString(value);
		}
		return value;
	}

	// ----------------------------------------------------------------------------------
	// Output-field helpers
	// ----------------------------------------------------------------------------------

	private boolean hasFunction(JSONObject field) {
		String function = field.getString("function");
		return function != null && !function.isBlank();
	}

	private String signature(JSONObject field) {
		return String.valueOf(field.getString("variable")) + '\u0002' + field.getString("field") + '\u0002'
				+ field.getString("function") + '\u0002' + Boolean.TRUE.equals(field.getBoolean("distinct"));
	}

	private String alias(JSONObject field, int stepIndex) {
		String as = field.getString("as");
		if (as == null || as.isBlank()) {
			as = field.getString("field");
		}
		if (as == null || as.isBlank()) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"steps[" + stepIndex + "].output.fields", "an output field has no alias");
		}
		if (as.startsWith("$") || as.contains(".")) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"steps[" + stepIndex + "].output.fields",
					"alias [" + as + "] is not a valid MongoDB field name");
		}
		return as;
	}

	private String fieldPath(JSONObject field, Map<String, String> prefixByVariable, int stepIndex) {
		String variable = field.getString("variable");
		String name = field.getString("field");
		if (name == null || name.isBlank()) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"steps[" + stepIndex + "].output.fields", "an output field has no source field");
		}
		String prefix = prefixByVariable.get(variable);
		if (prefix == null) {
			throw new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
					"steps[" + stepIndex + "].output.fields",
					"output variable [" + variable + "] names no object of this step");
		}
		return prefix + name;
	}

	private String objectPath(int stepIndex, int objectIndex) {
		return "steps[" + stepIndex + "].graph.patterns[0].objects[" + objectIndex + "].conditions";
	}
}
