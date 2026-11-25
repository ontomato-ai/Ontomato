package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.util.*;
import java.util.*;
import java.util.function.Supplier;
import java.util.stream.Collectors;
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
  private final DataSandboxService sandboxService;
  private final WriteFunctionOperationService writes;
  private final PythonExecuteService python;
  private final QueryGrantService grants;
  private final DataPermissionLookup permissions;
  private final ActionTrialStore actionTrials;

  public GenerationOperations(
      OntologyAgentStore store,
      io.ontomato.dataengine.dao.JSONRuleDao schemas,
      DataSandboxService sandboxService,
      WriteFunctionOperationService writes,
      PythonExecuteService python,
      QueryGrantService grants, @Lazy DataPermissionLookup permissions, @Lazy IdentityService identity, ActionTrialStore actionTrials) {
    this.store = store;
    this.schemas = schemas;
    this.sandboxService = sandboxService;
    this.writes = writes;
    this.python = python;
    this.grants = grants;
    this.permissions = permissions;
    this.actionTrials = actionTrials;
  }

  @org.springframework.beans.factory.annotation.Autowired
  private io.ontomato.dataengine.service.authorization.ActionAuthorization actionAuthorization;

  public void requireWriteAccess(Owner owner) {
    try {
      actionAuthorization.requireCreate(actionAuthorization.subject(owner.domainId(), owner.userId()));
    } catch (io.ontomato.dataengine.service.authorization.ActionAuthorization.Denied denied) {
      throw new AgentHttpException(403, denied.code(), denied.getMessage());
    }
  }

  public JSONObject gate(String run, Owner owner) {
    var row = store.one("SELECT * FROM ontology_agent_runs WHERE id=?", uuid(run));
    store.gate(row.getString("session_id"), run, owner);
    var generation = store.one("SELECT * FROM ontology_generations WHERE run_id=?", uuid(run));
    String selected=row.getJSONObject("request").getString("executionUserId");
    if ("action".equals(generation.getString("kind"))) requireWriteAccess(new Owner(selected==null?owner.userId():selected,owner.domainId()));
    generation.put("sandboxClasses", row.getJSONObject("request").getList("sandboxClasses", String.class));
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
      QueryAccessService.Access access, Check recheck, String evidenceScope) {}

  private Window legacy(String run, Owner owner, String kind) {
    return new Window(run, owner, kind, () -> gate(run, owner), executionAccess(run, owner),
        () -> {}, null);
  }

  Window external(String run, Owner owner, String kind, QueryAccessService.Access requestAccess, Check recheck) {
    var deadline = executionAccess(run, owner).expiresAt();
    if (requestAccess.expiresAt() != null) deadline = Math.min(deadline, requestAccess.expiresAt());
    if (requestAccess.target().testing()) deadline = Math.min(deadline, requestAccess.target().expiresAt());
    var access = new QueryAccessService.Access(requestAccess.user(), requestAccess.permission(), null, null,
        deadline, QueryAccessService.classScope(requestAccess.permission(), requestAccess.classNames()),
        requestAccess.target());
    return new Window(run, owner, kind, () -> gate(run, owner), access,
        () -> {
          if (access.expiresAt() <= System.currentTimeMillis()) throw closed();
          recheck.run();
        }, externalEvidenceScope(owner));
  }

  static String externalEvidenceScope(Owner owner) {
    return AgentJson.hash(JSONObject.of("external", owner.userId()));
  }


  public String source(String run, Owner owner) {
    return store.transaction(() -> gate(run, owner).getString("source"));
  }

  @SuppressWarnings("unchecked")
  List<String> sandboxClasses(String domain, List<String> requested, List<String> allowed) {
    if (requested.isEmpty()) return List.of();
    var definitions = (List<Map<String, Object>>) schemas.query(domain).get("classDef");
    var names = definitions.stream().map(cls -> (String) cls.get("className")).collect(Collectors.toSet());
    return requested.stream().map(name -> {
      String canonical = DBSchemaUtil.normalizeClassName(name, definitions);
      if (!names.contains(canonical)) throw AgentHttpException.invalid("Unknown sandbox class: " + name);
      requireSampleAccess(canonical, allowed);
      return canonical;
    }).distinct().sorted().toList();
  }

  String openSandbox(String run, Owner owner, long expiresAt, List<String> classes) {
    return sandboxService.open(owner.domainId(), owner.userId(), run, expiresAt, classes);
  }

  private static void requireSampleAccess(String name, List<String> allowed) {
    if (!allowed.isEmpty() && !allowed.contains(name))
      throw new AgentHttpException(403, "FORBIDDEN", "Sample class is outside the authoring scope: " + name)
          .localized("Authoring.sampleOutsideScope", Map.of("className", name));
  }

  public static List<String> requestedSandboxClasses(JSONObject body) {
    if (!body.containsKey("classNames")) return List.of();
    if (!(body.get("classNames") instanceof List<?> names)
        || names.stream().anyMatch(name -> !(name instanceof String text) || text.isBlank()))
      throw AgentHttpException.invalid("classNames must be an array of nonempty strings");
    return body.getList("classNames", String.class);
  }

  public void dropSandbox(String sandbox, String domain) {
    sandboxService.close(sandbox, domain);
  }

  private void requireActionRun(JSONObject row) {
    if (!"action".equals(row.getString("kind")))
      throw AgentHttpException.invalid("Only Action generation has a write sandbox")
          .localized("Authoring.writeSandboxActionOnly", Map.of());
  }

  private String sandbox(JSONObject row) {
    requireActionRun(row);
    if (row.getString("sandbox_id") == null)
      throw AgentHttpException.invalid("Prepare test data first")
          .localized("Authoring.prepareFirst", Map.of());
    return row.getString("sandbox_id");
  }

  public JSONObject prepare(String run, Owner owner, JSONObject body) throws Exception {
    var window = legacy(run, owner, "action");
    store.transaction(() -> {
      requireActionRun(window.gate().get());
      return null;
    });
    var access = window.access();
    return storeSamples(window, authorSamples(owner.domainId(), body,
        QueryAccessService.classScope(access.permission(), access.classNames())));
  }

  JSONObject authorSamples(String domain, JSONObject body, List<String> allowed) {
    // Authoring accepts text samples, never uploaded file bytes.
    body = AgentJson.copy(body);
    if (body.getJSONArray("vectorDatas") != null)
      for (var item : body.getJSONArray("vectorDatas")) ((JSONObject) item).remove("fileId");
    JSONObject data = sandboxService.validateSample(body, Map.of(), domain);
    var requested = new ArrayList<>(requestedSandboxClasses(body));
    for (var item : data.getJSONArray("objDatas").toJavaList(JSONObject.class))
      requested.add(item.getString("className"));
    data.put("classNames", sandboxClasses(domain, requested, allowed));
    return data;
  }

  JSONObject storeSamples(Window window, JSONObject data) throws Exception {
    window.recheck().run();
    store.transaction(() -> {
      var row = window.gate().get();
      requireActionRun(row);
      String domain = window.owner().domainId();
      var declared = row.getList("sandboxClasses", String.class);
      var classes = new TreeSet<String>();
      if (declared != null) classes.addAll(declared);
      classes.addAll(data.getList("classNames", String.class));
      String sandboxId = row.getString("sandbox_id");
      if (sandboxId == null) {
        sandboxId = openSandbox(window.run(), window.owner(), window.access().expiresAt(), List.copyOf(classes));
        store.update("UPDATE ontology_generations SET sandbox_id=? WHERE run_id=?", sandboxId, uuid(window.run()));
      }
      sandboxService.replaceClasses(sandboxId, List.copyOf(classes), data, domain);
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
          sandboxService.reset(sandboxId, domainId);
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

  /**
   * A receipt binds only the executed input: the parameter name, type and value.
   * Descriptive fields such as description or sample never require another business test.
   */
  private static JSONArray executedParameters(JSONArray parameters) {
    var executed = new JSONArray();
    if (parameters == null) return executed;
    for (int i = 0; i < parameters.size(); i++) {
      JSONObject parameter = parameters.getJSONObject(i), kept = new JSONObject();
      kept.put("name", parameter.get("name"));
      kept.put("type", parameter.get("type"));
      kept.put("value", parameter.get("value"));
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
    String digest = actionTrials.digest(window.owner().domainId(), code, null, function.getParameters());
    String execution = UUID.randomUUID().toString();
    var access = window.access();
    var authority = PythonAuthority.write(access.user().getId(), window.owner().domainId(), sandbox(row))
        .withClasses(access.classNames()).withExecution(access.executionUserId(), window.owner().userId())
        .withTarget(access.target()).withAuthorSandbox(sandbox(row));
    String grant = startTest(window, execution, digest, authority);
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
    return actionTrials.digest(domainId, code, null,
        defs == null || defs.isEmpty() ? List.of() : actionParameters(domainId, defs));
  }

  private String startTest(Window window, String execution, String digest, PythonAuthority authority) throws Exception {
    window.recheck().run();
    return store.transaction(() -> {
      window.gate().get();
      var access = window.access();
      var target = access.target();
      String grant = grants.issueAuthoringParent(authority, window.run(), access.expiresAt());
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
      if ("action".equals(window.kind()))
        actionTrials.recordAuthoringTrial(window.owner().domainId(), digest, result, window.owner().userId());
      return new Receipt(execution, digest, recorded);
    });
  }

  public static String packageTestDigest(String kind, JSONObject bundle) {
    var executable = QueryPackage.copy(QueryPackage.validate(bundle));
    var manifest = executable.getJSONObject("manifest");
    manifest.put("parameterDefs", executedParameters(manifest.getJSONArray("parameterDefs")));
    return AgentJson.hash(JSONObject.of("kind", kind, "package", executable));
  }

  private Receipt testPackage(Window window, JSONObject body) throws Exception {
    if (!window.kind().equals("metric"))
      throw AgentHttpException.invalid("This definition does not test query packages")
          .localized("Authoring.queryPackageNotTested", Map.of());
    var bundle = QueryPackage.accept(body.getJSONObject("queryPackage"));
    var parameters = QueryPackage.parameters(bundle, null);
    String digest = packageTestDigest(window.kind(), bundle), execution = UUID.randomUUID().toString();
    var binding = window.access();
    var authority = PythonAuthority.read(binding.user().getId(), window.owner().domainId())
        .withExecution(binding.executionUserId(), binding.initiatorUserId())
        .withClasses(binding.classNames()).withTarget(binding.target());
    String token = startTest(window, execution, digest, authority);
    var grant = grants.verify(token, window.run());
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

  Receipt latestTest(String run, String kind, String digest, String evidenceScope) {
    var rows = store.rows("SELECT execution_id,digest,result FROM ontology_generation_tests"
        + " WHERE run_id=? AND kind=? AND digest=? AND evidence_scope=?"
        + " ORDER BY created_at DESC,execution_id DESC LIMIT 1", uuid(run), kind, digest, evidenceScope);
    return rows.isEmpty() ? null : receipt(rows.getFirst());
  }

  Receipt requireTest(String run, String kind, String digest, String evidenceScope) {
    Receipt test = latestTest(run, kind, digest, evidenceScope);
    requirePassed(test == null ? null : (JSONObject) test.result());
    return test;
  }

  public String actionTrialStatus(Action action) {
    return actionTrials.statusCode(actionTrials.latest(action));
  }

  private static Receipt receipt(JSONObject row) {
    return new Receipt(row.getString("execution_id"), row.getString("digest"), row.getJSONObject("result"));
  }

  public void requirePackageTest(String run, String kind, JSONObject bundle) {
    requireDigest(run, packageTestDigest(kind, bundle));
  }

  public void requireActionTest(String run, String domain, String code, JSONArray parameters) {
    requireDigest(run, actionTrials.digest(domain, code, null, legacyActionParameters(domain, parameters)));
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
