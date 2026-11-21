package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.util.*;
import java.util.*;
import java.util.function.Consumer;
import java.util.function.Supplier;
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
    this.identity = identity;
  }

  public void requireWriteAccess(Owner owner) {
    identity.requireActionExecutionAccess(owner.userId(), owner.domainId());
  }

  public JSONObject gate(String run, Owner owner) {
    var row = store.one("SELECT * FROM ontology_agent_runs WHERE id=?", uuid(run));
    store.gate(row.getString("session_id"), run, owner);
    var generation = store.one("SELECT * FROM ontology_generations WHERE run_id=?", uuid(run));
    String selected=row.getJSONObject("request").getString("executionUserId");
    if ("action".equals(generation.getString("kind"))) requireWriteAccess(new Owner(selected==null?owner.userId():selected,owner.domainId()));
    return generation;
  }

  private QueryAccessService.Access executionAccess(String run,Owner owner) {
    var row=store.one("SELECT request,deadline FROM ontology_agent_runs WHERE id=?",uuid(run));
    var request=row.getJSONObject("request");
    String selected=request.getString("executionUserId"),user=selected==null?owner.userId():selected;
    return new QueryAccessService.Access(new QueryAccessService.GrantUser(user,owner.domainId()),permissions.getDataPermission(user,owner.domainId()),
      null,null,java.time.Instant.parse(row.getString("deadline")).toEpochMilli(),request.getList("classNames",String.class))
      .withExecution(selected,owner.userId());
  }

  @FunctionalInterface
  interface Check {
    void run() throws Exception;
  }

  record Window(String run, Owner owner, String kind, Supplier<JSONObject> gate,
      QueryAccessService.Access access, Consumer<JSONObject> samples, Check recheck, String evidenceScope) {}

  private Window legacy(String run, Owner owner, String kind) {
    return new Window(run, owner, kind, () -> gate(run, owner), executionAccess(run, owner),
        data -> storeGenerationSamples(run, data), () -> {}, null);
  }

  Window external(String run, Owner owner, String kind, QueryAccessService.Access requestAccess, Check recheck) {
    var deadline = executionAccess(run, owner).expiresAt();
    if (requestAccess.expiresAt() != null) deadline = Math.min(deadline, requestAccess.expiresAt());
    if (requestAccess.target().testing()) deadline = Math.min(deadline, requestAccess.target().expiresAt());
    var access = new QueryAccessService.Access(requestAccess.user(), requestAccess.permission(), null, null,
        deadline, QueryAccessService.classScope(requestAccess.permission(), requestAccess.classNames()),
        requestAccess.target());
    return new Window(run, owner, kind, () -> gate(run, owner), access,
        data -> storeGenerationSamples(run, data), () -> {
          if (access.expiresAt() <= System.currentTimeMillis()) throw closed();
          recheck.run();
        }, externalEvidenceScope(owner));
  }

  static String externalEvidenceScope(Owner owner) {
    return AgentJson.hash(JSONObject.of("external", owner.userId()));
  }

  private void storeGenerationSamples(String run, JSONObject data) {
    store.update("UPDATE ontology_generations SET test_data=?::jsonb WHERE run_id=?",
        AgentJson.json(data), uuid(run));
  }

  public String source(String run, Owner owner) {
    return store.transaction(() -> gate(run, owner).getString("source"));
  }

  public void createSandbox(String sandbox, String domain) throws Exception {
    createSandbox(sandbox, domain, List.of());
  }

  @SuppressWarnings("unchecked")
  void createSandbox(String sandbox, String domain, List<String> classes) throws Exception {
    var schema = schemas.query(domain);
    var objects = new JSONArray();
    for (var cls : (List<Map<String, Object>>) schema.get("classDef")) {
      String name = (String) cls.get("className");
      if (classes.isEmpty() || classes.contains(name))
        objects.add(JSONObject.of("className", name, "rows", new JSONArray()));
    }
    sandboxService.createSampleStructure(sandbox, JSONObject.of("objDatas", objects), domain);
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
      throw AgentHttpException.invalid("Only Action generation has a write sandbox")
          .localized("Authoring.writeSandboxActionOnly", Map.of());
    return row.getString("sandbox_id");
  }

  public JSONObject prepare(String run, Owner owner, JSONObject body) throws Exception {
    var window = legacy(run, owner, "action");
    store.transaction(() -> sandbox(window.gate().get()));
    return storeSamples(window, authorSamples(owner.domainId(), body, List.of()));
  }

  JSONObject authorSamples(String domain, JSONObject body, List<String> allowed) {
    // Authoring accepts text samples, never uploaded file bytes.
    body = AgentJson.copy(body);
    if (body.getJSONArray("vectorDatas") != null)
      for (var item : body.getJSONArray("vectorDatas")) ((JSONObject) item).remove("fileId");
    JSONObject data = sandboxService.validateSample(body, Map.of(), domain);
    if (!allowed.isEmpty()) {
      for (var item : data.getJSONArray("objDatas").toJavaList(JSONObject.class)) {
        String name = item.getString("className");
        if (!allowed.contains(name))
          throw new AgentHttpException(403, "FORBIDDEN", "Sample class is outside the authoring scope: " + name)
              .localized("Authoring.sampleOutsideScope", Map.of("className", name));
      }
    }
    return data;
  }

  JSONObject storeSamples(Window window, JSONObject data) throws Exception {
    window.recheck().run();
    store.transaction(() -> {
      window.gate().get();
      window.samples().accept(data);
      return null;
    });
    return JSONObject.of("prepared", true);
  }

  public JSONObject reset(String run, Owner owner) {
    return reset(legacy(run, owner, "action"));
  }

  JSONObject reset(Window window) {
    return store.transaction(
        () -> {
          var row = window.gate().get();
          String sandboxId = sandbox(row), domainId = window.owner().domainId();
          JSONObject data = row.getJSONObject("test_data");
          if (data == null)
            throw AgentHttpException.invalid("Prepare test data first").localized("Authoring.prepareFirst", Map.of());
          try {
            sandboxService.truncateNamespace(sandboxId, domainId);
            sandboxService.loadSample(sandboxId, data, Map.of(), domainId);
          } catch (RuntimeException error) {
            throw error;
          } catch (Exception error) {
            throw AgentHttpException.invalid("Reset failed: " + error.getMessage())
                .localized("Authoring.resetFailed", Map.of("reason", String.valueOf(error.getMessage())));
          }
          return JSONObject.of("reset", true);
        });
  }

  public Object query(String run, Owner owner, JSONObject body) {
    return query(legacy(run, owner, "action"), body);
  }

  @SuppressWarnings("unchecked")
  Object query(Window window, JSONObject body) {
    return store.transaction(
        () -> {
          var row = window.gate().get();
          try {
            var access = window.access();
            var permission = access.permission();
            var rule = schemas.query(window.owner().domainId());
            var definitions = ((List<Map<String, Object>>) rule.get("classDef")).stream()
                .filter(definition -> access.classNames().isEmpty() || access.classNames().contains(definition.get("className"))).toList();
            var query = body.getJSONObject("dsl");
            QueryPermissions.restrictRelations(query, rule, permission);
            var analysis = QuerySourceAnalysis.fromDsl(query, definitions);
            QueryPermissions.authorizeInputs(analysis, permission, definitions);
            var restricted = (JSONObject) DslPermissionUtil.addRowPermission("[" + query.toJSONString() + "]", definitions, permission)[0];
            return QueryPermissions.response(writes.query(restricted, sandbox(row), window.owner().domainId()), analysis, permission, false);
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
      kept.put("value", "action".equals(kind)
          ? ParameterValues.normalize(parameter.getString("type"), parameter.get("value"))
          : parameter.get("value"));
      executed.add(kept);
    }
    return executed;
  }

  public Object test(String run, Owner owner, JSONObject body) throws Exception {
    String kind = store.transaction(() -> gate(run, owner)).getString("kind");
    return test(legacy(run, owner, kind), body).result();
  }

  record Receipt(String executionId, String digest, Object result) {}

  Receipt test(Window window, JSONObject body) throws Exception {
    var row = store.transaction(window.gate());
    if (!window.kind().equals("action")) return testPackage(window, body);
    String code = AgentJson.text(body, "code");
    var defs = body.getJSONArray("parameterDefs");
    boolean legacy = window.evidenceScope() == null;
    var function = new Function();
    function.setParameters(legacy ? legacyActionParameters(window.owner().domainId(), defs)
        : actionParameters(window.owner().domainId(), defs));
    var parameters = MetricViewBindings.values(function);
    if (!legacy) MetricViewBindings.validateValues(function, parameters);
    String digest = legacy ? testDigest("action", code, defs) : actionDigest(code, function.getParameters());
    String execution = UUID.randomUUID().toString();
    var access = window.access();
    var authority = PythonAuthority.write(access.user().getId(), window.owner().domainId(), sandbox(row))
        .withClasses(access.classNames()).withExecution(access.executionUserId(), window.owner().userId())
        .withTarget(access.target()).withAuthorSandbox(sandbox(row));
    String grant = startTest(window, execution, digest);
    var result = python.execute(
        window.run(), code, 10, "en",
        authority.forExecution(execution).withParent(new PythonAuthority.ParentGrant(grant, window.run(), access.expiresAt())),
        parameters, Map.of());
    result.setResult(result.getError() != null && !result.getError().isBlank() ? null : "{\"completed\":true}");
    return finishTest(window, execution, digest, result);
  }

  @SuppressWarnings("unchecked")
  private List<Parameter> legacyActionParameters(String domainId, JSONArray defs) {
    if (defs == null)
      throw AgentHttpException.invalid("parameterDefs are required").localized("Authoring.parameterDefsRequired", Map.of());
    var classes = (List<Map<String, Object>>) schemas.query(domainId).get("classDef");
    return DBSchemaUtil.buildParameters(defs.toList(Map.class), classes);
  }

  @SuppressWarnings("unchecked")
  List<Parameter> actionParameters(String domainId, JSONArray defs) {
    if (defs == null)
      throw AgentHttpException.invalid("parameterDefs are required").localized("Authoring.parameterDefsRequired", Map.of());
    var classes = (List<Map<String, Object>>) schemas.query(domainId).get("classDef");
    var parameters = Function.fromInput(JSONObject.of("parameters", defs)).getParameters();
    for (var parameter : parameters) {
      parameter.setValue(ParameterValues.normalize(parameter.getType(), parameter.getValue()));
      if (parameter.getClassNames() != null)
        parameter.setClassNames(parameter.getClassNames().stream()
            .map(name -> DBSchemaUtil.normalizeClassName(name, classes)).distinct().sorted().toList());
    }
    return parameters;
  }

  String actionDigest(String domainId, String code, JSONArray defs) {
    return actionDigest(code, defs == null ? List.of() : actionParameters(domainId, defs));
  }

  private static String actionDigest(String code, List<Parameter> parameters) {
    var declared = parameters.stream().map(parameter -> JSONObject.of("name", parameter.getName(),
        "type", parameter.getType(), "value", parameter.getValue(),
        "classNames", parameter.getClassNames() == null ? List.of() : parameter.getClassNames())).toList();
    return AgentJson.hash(JSONObject.of("kind", "action", "code", code, "parameterDefs", declared));
  }

  private String startTest(Window window, String execution, String digest) throws Exception {
    window.recheck().run();
    return store.transaction(() -> {
      window.gate().get();
      var access = window.access();
      var target = access.target();
      var binding = JSONObject.of("executionUserId", access.executionUserId(), "initiatorUserId", window.owner().userId());
      String grant = grants.issueAuthoringParent(access.user().getId(), window.owner().domainId(),
          window.run(), access.expiresAt(), access.classNames(), target, binding);
      store.update("INSERT INTO ontology_generation_tests(run_id,digest,execution_id,result,kind,evidence_scope,target_context)"
              + " VALUES(?,?,?,NULL,?,?,?)", uuid(window.run()), digest, uuid(execution), window.kind(),
          window.evidenceScope(), target.contextId());
      return grant;
    });
  }

  private Receipt finishTest(Window window, String execution, String digest, PythonExecuteResult result) throws Exception {
    Object recorded = window.evidenceScope() == null ? result : JSONObject.of(
        "result", result.getResult(), "error", result.getError(), "spendTime", result.getSpendTime(),
        "partialQuery", result.getPartialQuery());
    window.recheck().run();
    return store.transaction(() -> {
      window.gate().get();
      store.update("UPDATE ontology_generation_tests SET result=?::jsonb WHERE run_id=? AND execution_id=?",
          AgentJson.json(recorded), uuid(window.run()), uuid(execution));
      return new Receipt(execution, digest, recorded);
    });
  }

  public static String packageTestDigest(String kind, JSONObject bundle) {
    var executable = QueryPackage.copy(QueryPackage.validate(bundle));
    var manifest = executable.getJSONObject("manifest");
    manifest.put("parameterDefs", executedParameters("function", manifest.getJSONArray("parameterDefs")));
    return AgentJson.hash(JSONObject.of("kind", kind, "package", executable));
  }

  private Receipt testPackage(Window window, JSONObject body) throws Exception {
    if (!Set.of("metric", "function", "dashboard").contains(window.kind()))
      throw AgentHttpException.invalid("This definition does not test query packages")
          .localized("Authoring.queryPackageNotTested", Map.of());
    var bundle = QueryPackage.accept(body.getJSONObject("queryPackage"));
    var parameters = QueryPackage.parameters(bundle, null);
    String digest = packageTestDigest(window.kind(), bundle), execution = UUID.randomUUID().toString();
    String token = startTest(window, execution, digest);
    var binding = window.access();
    var grant = grants.verify(token, window.run(), "/ontology/query/execute-dsl");
    var access = new QueryAccessService.Access(binding.user(), binding.permission(), grant, token, binding.expiresAt(),
        binding.classNames(), binding.target(), binding.executionUserId(), binding.initiatorUserId());
    var labels = body.getJSONObject("columnLabels");
    var result = window.evidenceScope() == null
        ? QueryPackageExecution.execute(execution, bundle, parameters, labels, access, "en", 10, ontology, python)
        : QueryPackageExecution.test(execution, bundle, parameters, labels, access, "en", 10, ontology, python);
    var output = result.execution();
    if (output.getError() == null || output.getError().isBlank()) {
      output.setResult(JSON.toJSONString(JSONObject.of("answer", result.rows()), JSONWriter.Feature.WriteMapNullValue));
    }
    return finishTest(window, execution, digest, output);
  }

  Receipt readTest(String run, String kind, String execution) {
    var row = store.one("SELECT execution_id,digest,result FROM ontology_generation_tests WHERE run_id=? AND kind=? AND execution_id=?",
        uuid(run), kind, uuid(execution));
    if (row.getJSONObject("result") == null) throw conflict("Authoring test has not completed");
    return receipt(row);
  }

  Receipt requireTest(String run, String kind, String digest, String evidenceScope) {
    var rows = store.rows("SELECT execution_id,digest,result FROM ontology_generation_tests"
        + " WHERE run_id=? AND kind=? AND digest=? AND evidence_scope=?"
        + " ORDER BY created_at DESC,execution_id DESC LIMIT 1", uuid(run), kind, digest, evidenceScope);
    var row = rows.isEmpty() ? null : rows.getFirst();
    requirePassed(row == null ? null : row.getJSONObject("result"));
    return receipt(row);
  }

  private static Receipt receipt(JSONObject row) {
    return new Receipt(row.getString("execution_id"), row.getString("digest"), row.getJSONObject("result"));
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
    requirePassed(tests.isEmpty() ? null : tests.getFirst().getJSONObject("result"));
  }

  private static void requirePassed(JSONObject test) {
    if (test == null || (test.getString("error") != null && !test.getString("error").isBlank()))
      throw AgentHttpException.invalid("The exact source and parameters must pass a business test")
          .localized("Authoring.businessTestRequired", Map.of());
  }
}
