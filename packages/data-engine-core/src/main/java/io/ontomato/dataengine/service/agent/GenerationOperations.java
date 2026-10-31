package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessDashboardParameter;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.util.*;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

/**
 * Business tests and sandbox data are ontology-owned, independent of model tools or local files.
 */
@Service
public class GenerationOperations {
  private final OntologyAgentStore store;
  private final io.ontomato.dataengine.dao.JSONRuleDao schemas;
  private final SandboxService sandboxService;
  private final WriteFunctionOperationService writes;
  private final PythonExecuteService python;
  private final QueryGrantService grants;
  private final DataPermissionLookup permissions;
  private final ABCProgramService programs;
  private final IdentityService identity;

  public GenerationOperations(
      OntologyAgentStore store,
      io.ontomato.dataengine.dao.JSONRuleDao schemas,
      SandboxService sandboxService,
      WriteFunctionOperationService writes,
      PythonExecuteService python,
      QueryGrantService grants, @Lazy DataPermissionLookup permissions, ABCProgramService programs, @Lazy IdentityService identity) {
    this.store = store;
    this.schemas = schemas;
    this.sandboxService = sandboxService;
    this.writes = writes;
    this.python = python;
    this.grants = grants;
    this.permissions = permissions;
    this.programs = programs;
    this.identity = identity;
  }

  public void requireWriteAccess(Owner owner) {
    identity.requireActionExecutionAccess(owner.userId(), owner.domainId());
  }

  public JSONObject gate(String run, Owner owner) {
    var row = store.one("SELECT * FROM ontology_agent_runs WHERE id=?", uuid(run));
    store.gate(row.getString("session_id"), run, owner);
    var generation = store.one("SELECT * FROM ontology_generations WHERE run_id=?", uuid(run));
    if ("action".equals(generation.getString("kind"))) requireWriteAccess(owner);
    return generation;
  }

  public String source(String run, Owner owner) {
    return store.transaction(() -> gate(run, owner).getString("source"));
  }

  @SuppressWarnings("unchecked")
  public void createSandbox(String sandbox, String domain) throws Exception {
    var schema = schemas.query(domain);
    sandboxService.createNamespace(sandbox, domain);
    for (var cls : (List<Map<String, Object>>) schema.get("classDef"))
      sandboxService.createClass(sandbox, cls, domain);
    for (var relation : ((Map<String, Object>) schema.get("relationship_rule")).keySet())
      sandboxService.createEdge(sandbox, relation, domain);
  }

  public void dropSandbox(String sandbox, String domain) {
    try {
      sandboxService.truncateNamespace(sandbox, domain);
      sandboxService.dropNamespace(sandbox, domain);
    } catch (Exception error) {
      throw new IllegalStateException("Cannot remove generation sandbox", error);
    }
  }

  private String sandbox(JSONObject row) {
    if (!"action".equals(row.getString("kind")) || row.getString("sandbox_id") == null)
      throw AgentHttpException.invalid("Only Action generation has a write sandbox");
    return row.getString("sandbox_id");
  }

  @SuppressWarnings("unchecked")
  public JSONObject prepare(String run, Owner owner, JSONObject body) throws Exception {
    String domainId = owner.domainId();
    String sandboxId = store.transaction(() -> sandbox(gate(run, owner)));
    List<Map> objDatas = body.getList("objDatas", Map.class),
        relDatas = body.getList("relDatas", Map.class),
        vectorDatas = body.getList("vectorDatas", Map.class);
    if (objDatas == null || relDatas == null)
      throw AgentHttpException.invalid("objDatas and relDatas are required");
    // Check the object data
    Map<String, Object> jsonRule = schemas.query(domainId);
    List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
    Map<String, Map<String, Object>> classDefMap = new HashMap<String, Map<String, Object>>();
    for (Map<String, Object> classDef : classDefs) {
      classDefMap.put((String) classDef.get("className"), classDef);
    }
    Map<String, Set<String>> classIdsMap = new HashMap<String, Set<String>>();
    for (Map<String, Object> objData : objDatas) {
      // ABC and DSL accept both "/orders" and "orders"; fixtures must normalize too, otherwise
      // reset() later stores a class name that the sandbox class map cannot resolve.
      String className =
          DBSchemaUtil.normalizeClassName((String) objData.get("className"), classDefs);
      objData.put("className", className);
      Map<String, Object> classDef = classDefMap.get(className);
      if (classDef != null) {
        Set<String> attrNameSet = new HashSet<String>();
        String pk = DslUtil.getPrimaryKey(classDef);
        List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
        for (Map<String, Object> attrDef : attrDefs) {
          if (attrDef.get("enable") == null || (Boolean) attrDef.get("enable")) {
            attrNameSet.add((String) attrDef.get("name"));
          }
        }
        Set<String> ids = new HashSet<String>();
        List<Map<String, Object>> rows = (List<Map<String, Object>>) objData.get("rows");
        for (Map<String, Object> row : rows) {
          for (String key : row.keySet()) {
            if (!attrNameSet.contains(key)) {
              throw new Exception(
                  "The row of Class["
                      + className
                      + "] has a property["
                      + key
                      + "], but that property does not belong to Class["
                      + className
                      + "].");
            }
          }
          if (row.get(pk) != null && !"".equals(((String) row.get(pk)).trim())) {
            String id = ((String) row.get(pk));
            for (String cn : classIdsMap.keySet()) {
              if (classIdsMap.get(cn).contains(id)) {
                throw new Exception("Property[" + pk + "]: " + id + ", is duplicated.");
              }
            }
            if (ids.contains(id)) {
              throw new Exception("Property[" + pk + "]: " + id + ", is duplicated.");
            }
            ids.add(id);
          } else {
            throw new Exception(
                "The row of Class["
                    + className
                    + "] has not primary key property["
                    + pk
                    + "], or the value of primary key property["
                    + pk
                    + "] is null or empty string.");
          }
        }
        classIdsMap.put(className, ids);
      } else {
        throw new Exception("Class[" + className + "] is not exist.");
      }
    }

    // Check the relationship data
    List<Map<String, Object>> newRelDatas = new ArrayList<Map<String, Object>>();
    Map<String, Object> relationship_rule = (Map<String, Object>) jsonRule.get("relationship_rule");
    for (Map<String, Object> relData : relDatas) {
      String relationName = (String) relData.get("relationName");
      String sourceObjId = (String) relData.get("sourceObjId");
      String targetObjId = (String) relData.get("targetObjId");

      if (relationship_rule.get(relationName) != null) {
        Map<String, String> relationDef = (Map<String, String>) relationship_rule.get(relationName);
        String fromClass = relationDef.get("fromclass");
        String toClass = relationDef.get("toclass");
        Set<String> fromIds = classIdsMap.get(fromClass);
        if (fromIds == null || !fromIds.contains(sourceObjId)) {
          throw new Exception(
              "The relation data: {relationName:"
                  + relationName
                  + ", sourceObjId: "
                  + sourceObjId
                  + ", targetObjId: "
                  + targetObjId
                  + "}, sourceObjId["
                  + sourceObjId
                  + "] is not in Class["
                  + fromClass
                  + "].");
        }
        Set<String> toIds = classIdsMap.get(toClass);
        if (toIds == null || !toIds.contains(targetObjId)) {
          throw new Exception(
              "The relation data: {relationName:"
                  + relationName
                  + ", sourceObjId: "
                  + sourceObjId
                  + ", targetObjId: "
                  + targetObjId
                  + "}, targetObjId["
                  + targetObjId
                  + "] is not in Class["
                  + toClass
                  + "].");
        }
        Map<String, Object> newRelData = new HashMap<String, Object>();
        newRelData.put("relationName", relationName);
        newRelData.put("sourceClassName", fromClass);
        newRelData.put("sourceObjId", sourceObjId);
        newRelData.put("targetClassName", toClass);
        newRelData.put("targetObjId", targetObjId);
        newRelDatas.add(newRelData);
      } else {
        throw new Exception("Relation[" + relationName + "] is not exist.");
      }
    }

    // Check the vector data
    List<Map<String, Object>> newVectorDatas = new ArrayList<Map<String, Object>>();
    if (vectorDatas != null) {
      for (Map<String, Object> vectorData : vectorDatas) {
        String className =
            DBSchemaUtil.normalizeClassName((String) vectorData.get("className"), classDefs);
        String objectId = (String) vectorData.get("objectId");
        String attrName = (String) vectorData.get("attrName");
        String text = (String) vectorData.get("text");
        String fileId = (String) vectorData.get("fileId");
        Map<String, Object> classDef = classDefMap.get(className);
        if (classDef == null) {
          throw new Exception("The vector data: Class[" + className + "] is not exist.");
        }
        Set<String> ids = classIdsMap.get(className);
        if (ids == null || !ids.contains(objectId)) {
          throw new Exception(
              "The vector data: objectId[" + objectId + "] is not in Class[" + className + "].");
        }
        if (attrName == null || "".equals(attrName.trim())) {
          throw new Exception("The vector data: attrName is empty.");
        }
        boolean isVectorAttr = false;
        List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
        for (Map<String, Object> attrDef : attrDefs) {
          if (attrName.equals(attrDef.get("name")) && "vector".equals(attrDef.get("type"))) {
            isVectorAttr = true;
            break;
          }
        }
        if (!isVectorAttr) {
          throw new Exception(
              "The vector data: attrName["
                  + attrName
                  + "] is not a vector attribute of Class["
                  + className
                  + "].");
        }
        if (text == null || "".equals(text.trim())) {
          throw new Exception("The vector data: text is empty.");
        }
        Map<String, Object> newVectorData = new HashMap<String, Object>();
        newVectorData.put("className", className);
        newVectorData.put("objectId", objectId);
        newVectorData.put("attrName", attrName);
        newVectorData.put("text", text);
        newVectorData.put("fileId", fileId);
        newVectorDatas.add(newVectorData);
      }
    }

    JSONObject data =
        JSONObject.of("objDatas", objDatas, "relDatas", newRelDatas, "vectorDatas", newVectorDatas);
    store.transaction(
        () -> {
          gate(run, owner);
          store.update(
              "UPDATE ontology_generations SET test_data=?::jsonb WHERE run_id=?",
              AgentJson.json(data),
              uuid(run));
          return null;
        });
    return JSONObject.of("prepared", true);
  }

  @SuppressWarnings("unchecked")
  public JSONObject reset(String run, Owner owner) {
    return store.transaction(
        () -> {
          var row = gate(run, owner);
          String sandboxId = sandbox(row), domainId = owner.domainId();
          JSONObject data = row.getJSONObject("test_data");
          if (data == null) throw AgentHttpException.invalid("Prepare test data first");
          Map<String, Object> jsonRule = schemas.query(domainId);
          List<Map<String, Object>> classDefs =
              (List<Map<String, Object>>) jsonRule.get("classDef");
          Map<String, Map<String, Object>> classDefMap = new HashMap<>();
          for (var cls : classDefs) classDefMap.put((String) cls.get("className"), cls);
          try {
            sandboxService.truncateNamespace(sandboxId, domainId);

            JSONArray objDatas = data.getJSONArray("objDatas");
            for (int i = 0; i < objDatas.size(); i++) {
              JSONObject objData = objDatas.getJSONObject(i);
              String className =
                  DBSchemaUtil.normalizeClassName(objData.getString("className"), classDefs);
              objData.put("className", className);
              JSONArray rows = objData.getJSONArray("rows");
              Map<String, Object> classDef = classDefMap.get(className);
              sandboxService.insertObjects(sandboxId, classDef, rows, domainId);
            }

            JSONArray relDatas = data.getJSONArray("relDatas");
            sandboxService.insertRelations(sandboxId, relDatas, domainId);

            JSONArray vectorDatas = data.getJSONArray("vectorDatas");
            if (vectorDatas != null) {
              for (int i = 0; i < vectorDatas.size(); i++) {
                JSONObject vectorData = vectorDatas.getJSONObject(i);
                String className =
                    DBSchemaUtil.normalizeClassName(vectorData.getString("className"), classDefs);
                String objectId = vectorData.getString("objectId");
                String attrName = vectorData.getString("attrName");
                String text = vectorData.getString("text");
                String fileId = vectorData.getString("fileId");
                String suffix = getSuffixFromFileId(fileId);
                writes.appendVector(
                    className,
                    attrName,
                    objectId,
                    text,
                    new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)),
                    suffix,
                    sandboxId,
                    domainId);
              }
            }
          } catch (Exception error) {
            throw new IllegalStateException(error);
          }
          return JSONObject.of("reset", true);
        });
  }

  private String getSuffixFromFileId(String id) {
    return id == null || !id.contains(".") ? "txt" : id.substring(id.lastIndexOf('.') + 1);
  }

  public Object query(String run, Owner owner, JSONObject body) {
    return store.transaction(
        () -> {
          var row = gate(run, owner);
          try {
            var permission = permissions.getDataPermission(owner.userId(), owner.domainId());
            var rule = schemas.query(owner.domainId());
            var definitions = (List<Map<String, Object>>) rule.get("classDef");
            var query = body.getJSONObject("dsl");
            QueryPermissions.restrictRelations(query, rule, permission);
            var analysis = QuerySourceAnalysis.fromDsl(query, definitions);
            QueryPermissions.authorizeInputs(analysis, permission, definitions);
            var restricted = (JSONObject) DslPermissionUtil.addRowPermission("[" + query.toJSONString() + "]", definitions, permission)[0];
            return QueryPermissions.response(writes.query(restricted, sandbox(row), owner.domainId()), analysis, permission, false);
          } catch (Exception error) {
            throw new IllegalStateException(error);
          }
        });
  }

  public static String testDigest(String kind, String code, JSONArray parameters) {
    return AgentJson.hash(
        JSONObject.of(
            "kind", kind, "code", code, "parameterDefs", executedParameters(kind, parameters)));
  }

  /**
   * A receipt binds only the executed input: the parameter name (or dashboard key), type and value.
   * Descriptive fields such as description or sample never require another business test.
   */
  private static JSONArray executedParameters(String kind, JSONArray parameters) {
    var executed = new JSONArray();
    if (parameters == null) return executed;
    boolean dashboard = kind.equals("dashboard");
    for (int i = 0; i < parameters.size(); i++) {
      JSONObject parameter = parameters.getJSONObject(i), kept = new JSONObject();
      kept.put(dashboard ? "key" : "name", parameter.get(dashboard ? "key" : "name"));
      kept.put("type", parameter.get("type"));
      kept.put("value", parameter.get("value"));
      executed.add(kept);
    }
    return executed;
  }

  @SuppressWarnings("unchecked")
  public Object test(String run, Owner owner, JSONObject body) throws Exception {
    String code = AgentJson.text(body, "code");
    var defs = body.getJSONArray("parameterDefs");
    var row = store.transaction(() -> gate(run, owner));
    String kind = row.getString("kind");
    if (!Set.of("action", "metric", "function", "dashboard").contains(kind))
      throw AgentHttpException.invalid("This definition does not test programs");
    JSONObject parameters = new JSONObject();
    var classes = (List<Map<String, Object>>) schemas.query(owner.domainId()).get("classDef");
    if (kind.equals("dashboard")) {
      if (defs == null) throw AgentHttpException.invalid("parameterDefs are required");
      for (var p : defs.toJavaList(ABCHarnessDashboardParameter.class)) {
        p.setClassName(DBSchemaUtil.normalizeClassName(p.getClassName(), classes));
        parameters.put(p.getKey(), p.getValue());
      }
    } else {
      if (kind.equals("action") && defs == null)
        throw AgentHttpException.invalid("parameterDefs are required");
      for (var p :
          DBSchemaUtil.buildParameters(
              defs == null ? List.<Map>of() : defs.toList(Map.class), classes))
        parameters.put(p.getName(), p.getValue());
    }
    JSONObject analysis = body.getJSONObject("sourceAnalysis");
    var permission = permissions.getDataPermission(owner.userId(), owner.domainId());
    if (!kind.equals("action")) QueryPermissions.authorizeInputs(analysis, permission, classes);
    String digest = testDigest(kind, code, defs), execution = UUID.randomUUID().toString();
    store.transaction(
        () -> {
          gate(run, owner);
          store.update(
              "INSERT INTO ontology_generation_tests(run_id,digest,execution_id,result)"
                  + " VALUES(?,?,?,NULL)",
              uuid(run),
              digest,
              uuid(execution));
          return null;
        });
    PythonAuthority authority =
        kind.equals("action")
            ? PythonAuthority.write(owner.userId(), owner.domainId(), sandbox(row))
            : PythonAuthority.read(owner.userId(), owner.domainId());
    long deadline =
        java.time.Instant.parse(
                store
                    .one("SELECT deadline FROM ontology_agent_runs WHERE id=?", uuid(run))
                    .getString("deadline"))
            .toEpochMilli();
    String grant =
        grants.issue(
            owner.userId(),
            owner.domainId(),
            authority.purpose(),
            run,
            deadline,
            List.of(),
            authority.sandboxId());
    var result =
        python.execute(
            run,
            code,
            10,
            "en",
            authority
                .forExecution(execution)
                .withParent(new PythonAuthority.ParentGrant(grant, run, deadline)),
            parameters,
            Map.of());
    if (result.getError() != null && !result.getError().isBlank()) {
      result.setResult(null);
    } else if (kind.equals("action")) {
      result.setResult("{\"completed\":true}");
    } else {
      var rows = QueryPermissions.mask(programs.parsePythonReturn(result.getResult(), null), analysis, permission);
      result.setResult(JSON.toJSONString(JSONObject.of("answer", rows), JSONWriter.Feature.WriteMapNullValue));
    }
    return store.transaction(
        () -> {
          gate(run, owner);
          store.update(
              "UPDATE ontology_generation_tests SET result=?::jsonb WHERE run_id=? AND digest=? AND"
                  + " execution_id=?",
              AgentJson.json(result),
              uuid(run),
              digest,
              uuid(execution));
          return result;
        });
  }

  public void requireTest(String run, String kind, String code, JSONArray parameters) {
    var tests =
        store.rows(
            "SELECT result FROM ontology_generation_tests WHERE run_id=? AND digest=? ORDER BY"
                + " created_at DESC,execution_id DESC LIMIT 1",
            uuid(run),
            testDigest(kind, code, parameters));
    var test = tests.isEmpty() ? null : tests.get(0).getJSONObject("result");
    if (test == null || (test.getString("error") != null && !test.getString("error").isBlank()))
      throw AgentHttpException.invalid("The exact source and parameters must pass a business test");
  }
}
