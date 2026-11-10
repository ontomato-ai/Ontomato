package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessDashboardParameter;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.util.*;
import java.util.*;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

/**
 * Business tests and sandbox data are ontology-owned, independent of model tools or local files.
 */
@Service
public class GenerationOperations {
  @org.springframework.beans.factory.annotation.Autowired @Lazy
  private OntologyQueryService ontology;
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
    var objects=new JSONArray();
    for(var cls:(List<Map<String,Object>>)schema.get("classDef"))
      objects.add(JSONObject.of("className",cls.get("className"),"rows",new JSONArray()));
    sandboxService.createSampleStructure(sandbox,JSONObject.of("objDatas",objects),domain);
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
    // Generation historically supplied text with a fileId suffix, never file bytes.
    // Its boundary now declares that input explicitly as a text-only sample.
    body = JSONObject.parseObject(body.toJSONString());
    if (body.getJSONArray("vectorDatas") != null)
      for (var item : body.getJSONArray("vectorDatas")) ((JSONObject) item).remove("fileId");
    JSONObject data = sandboxService.validateSample(body, Map.of(), domainId);
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
          try {
            sandboxService.truncateNamespace(sandboxId, domainId);

            sandboxService.loadSample(sandboxId, data, Map.of(), domainId);
          } catch (RuntimeException error) {
            throw error;
          } catch (Exception error) {
            throw AgentHttpException.invalid("Reset failed: " + error.getMessage());
          }
          return JSONObject.of("reset", true);
        });
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
          } catch (RuntimeException error) {
            throw error;
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
    var row = store.transaction(() -> gate(run, owner));
    String kind = row.getString("kind");
    if (!kind.equals("action")) return testPackage(run, owner, body, kind);
    String code = AgentJson.text(body, "code");
    var defs = body.getJSONArray("parameterDefs");
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

  public static String packageTestDigest(String kind, JSONObject bundle) {
    var executable = QueryPackage.copy(QueryPackage.validate(bundle));
    var manifest = executable.getJSONObject("manifest");
    manifest.put("parameterDefs", executedParameters("function", manifest.getJSONArray("parameterDefs")));
    return AgentJson.hash(JSONObject.of("kind", kind, "package", executable));
  }

  private Object testPackage(String run, Owner owner, JSONObject body, String kind) throws Exception {
    if (!Set.of("metric", "function", "dashboard").contains(kind))
      throw AgentHttpException.invalid("This definition does not test query packages");
    var bundle = QueryPackage.accept(body.getJSONObject("queryPackage"));
    var parameters = QueryPackage.parameters(bundle, null);
    String digest = packageTestDigest(kind, bundle), execution = UUID.randomUUID().toString();
    long deadline = java.time.Instant.parse(store.one("SELECT deadline FROM ontology_agent_runs WHERE id=?", uuid(run)).getString("deadline")).toEpochMilli();
    String token = grants.issue(owner.userId(), owner.domainId(), "user-read", run, deadline, List.of(), null);
    var grant = grants.verify(token, run, "/ontology/query/execute-dsl");
    var access = new QueryAccessService.Access(new QueryAccessService.GrantUser(owner.userId(), owner.domainId()),
        permissions.getDataPermission(owner.userId(), owner.domainId()), grant, token, deadline);
    store.transaction(() -> {
      gate(run, owner);
      store.update("INSERT INTO ontology_generation_tests(run_id,digest,execution_id,result) VALUES(?,?,?,NULL)", uuid(run), digest, uuid(execution));
      return null;
    });
    var result = QueryPackageExecution.execute(execution, bundle, parameters, body.getJSONObject("columnLabels"),
        access, "en", 10, ontology, python);
    var output = result.execution();
    output.setResult(JSON.toJSONString(JSONObject.of("answer", result.rows()), JSONWriter.Feature.WriteMapNullValue));
    return store.transaction(() -> {
      gate(run, owner);
      store.update("UPDATE ontology_generation_tests SET result=?::jsonb WHERE run_id=? AND digest=? AND execution_id=?",
          AgentJson.json(output), uuid(run), digest, uuid(execution));
      return output;
    });
  }

  public void requirePackageTest(String run, String kind, JSONObject bundle) {
    requireDigest(run, packageTestDigest(kind, bundle));
  }

  public void requireTest(String run, String kind, String code, JSONArray parameters) {
    requireDigest(run, testDigest(kind, code, parameters));
  }

  private void requireDigest(String run, String digest) {
    var tests =
        store.rows(
            "SELECT result FROM ontology_generation_tests WHERE run_id=? AND digest=? ORDER BY"
                + " created_at DESC,execution_id DESC LIMIT 1",
            uuid(run),
            digest);
    var test = tests.isEmpty() ? null : tests.get(0).getJSONObject("result");
    if (test == null || (test.getString("error") != null && !test.getString("error").isBlank()))
      throw AgentHttpException.invalid("The exact source and parameters must pass a business test");
  }
}
