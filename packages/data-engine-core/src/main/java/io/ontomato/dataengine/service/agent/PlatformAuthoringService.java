package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewBinding;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.service.*;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Supplier;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

@Service
public class PlatformAuthoringService {
  private final OntologyAgentStore store;
  private final GovernanceRuntimeClient runtime;
  private final RuntimeCodeClient code;
  private final GenerationOperations operations;
  private final OntologyGenerationService generation;
  private final OntologyQueryService ontology;
  private final QueryGrantService grants;
  private final IdentityService identity;
  private final DataPermissionLookup permissions;
  private final BuildTestContextService buildTests;
  private final ActionServiceImpl actions;
  private final ActionDao actionDao;
  private final MetricViewService metrics;
  private final MetricViewDao metricDao;
  private final LangService messages;

  public PlatformAuthoringService(OntologyAgentStore store, GovernanceRuntimeClient runtime,
      RuntimeCodeClient code, GenerationOperations operations, OntologyGenerationService generation,
      OntologyQueryService ontology, QueryGrantService grants, @Lazy IdentityService identity,
      @Lazy DataPermissionLookup permissions, BuildTestContextService buildTests,
      @Lazy ActionServiceImpl actions, ActionDao actionDao, @Lazy MetricViewService metrics, MetricViewDao metricDao,
      LangService messages) {
    this.store = store;
    this.runtime = runtime;
    this.code = code;
    this.operations = operations;
    this.generation = generation;
    this.ontology = ontology;
    this.grants = grants;
    this.identity = identity;
    this.permissions = permissions;
    this.buildTests = buildTests;
    this.actions = actions;
    this.actionDao = actionDao;
    this.metrics = metrics;
    this.metricDao = metricDao;
    this.messages = messages;
  }

  public record Run(String id, String session, Owner owner, String executor, List<String> classes,
      long expiresAt, JSONObject target) {
    public static Run parse(JSONObject body) {
      AgentJson.fields(body, "hostId", "sessionId", "runId", "ownerId", "executionUserId",
          "domainId", "classNames", "expiresAt", "target");
      if (!"workbench".equals(AgentJson.text(body, "hostId")))
        throw AgentHttpException.invalid("Unknown authoring host");
      if (!(body.get("classNames") instanceof List<?> names)
          || names.stream().anyMatch(name -> !(name instanceof String text) || text.isBlank()))
        throw AgentHttpException.invalid("classNames must be an array of class names");
      if (!(body.get("expiresAt") instanceof Number))
        throw AgentHttpException.invalid("expiresAt must be an epoch millisecond timestamp");
      return new Run(AgentJson.id(body.getString("runId")), AgentJson.id(body.getString("sessionId")),
          new Owner(AgentJson.text(body, "ownerId"), AgentJson.text(body, "domainId")),
          AgentJson.text(body, "executionUserId"), body.getList("classNames", String.class),
          body.getLongValue("expiresAt"), body.getJSONObject("target"));
    }

    String evidenceScope() {
      return AgentJson.hash(JSONObject.of("executor", executor, "classNames", classes.stream().sorted().toList()));
    }
  }

  public Object operate(String authoredKind, String operation, Run run, JSONObject input, String language)
      throws Exception {
    String kind = kind(authoredKind);
    if (operation.equals("read-test")) {
      AgentJson.fields(input, "executionId");
      row(run.id(), run.session(), run.owner(), false);
      return operations.readTest(run.id(), kind, AgentJson.id(input.getString("executionId")));
    }

    identity.requireQueryAccess(run.executor(), run.owner().domainId());
    if (kind.equals("action")) operations.requireWriteAccess(new Owner(run.executor(), run.owner().domainId()));
    if (operation.equals("adopt")) {
      AgentJson.fields(input, "definition");
      return adopt(run, kind, input.getJSONObject("definition"), language);
    }

    requireActive(run);
    var access = executionAccess(run);
    return switch (operation) {
      case "context" -> {
        var closedWindow = store.rows("SELECT closed FROM ontology_platform_authoring_runs WHERE run_id=? AND closed IS NOT NULL",
            uuid(run.id()));
        if (!closedWindow.isEmpty()) throw closed();
        yield context(kind, input, access);
      }
      case "prepare" -> {
        requireAction(kind);
        AgentJson.fields(input, "objDatas", "relDatas", "vectorDatas");
        var samples = operations.authorSamples(run.owner().domainId(), input, access.classNames());
        register(run);
        createSandbox(run, access.target().contextId());
        yield operations.storeSamples(window(run, kind, access), samples);
      }
      case "explain-draft" -> {
        requireAction(kind);
        register(run);
        var explained = explain(input, access, run.owner(), language);
        requireActive(run);
        store.transaction(() -> {
          open(run);
          generation.attachAuthoringExplanation(explained.explanationRef(), run.owner(), run.id());
          return null;
        });
        yield explained;
      }
      default -> {
        if (operation.equals("test")) register(run);
        yield operateWindow(operation, window(run, kind, access), input);
      }
    };
  }

  public Object operateExternal(String run, String authoredKind, String operation, JSONObject input,
      OntologyAgentAccess.Context caller) throws Exception {
    String kind = kind(authoredKind);
    var owner = caller.owner();
    store.one("""
        SELECT r.id FROM ontology_agent_runs r
          JOIN ontology_agent_sessions s ON s.id=r.session_id
          JOIN ontology_generations g ON g.run_id=r.id
          WHERE r.id=? AND r.external AND s.user_id=? AND s.domain_id=? AND g.kind=?
        """, uuid(run), owner.userId(), owner.domainId(), kind);
    if (operation.equals("read-test")) {
      AgentJson.fields(input, "executionId");
      return operations.readTest(run, kind, AgentJson.id(input.getString("executionId")));
    }
    if (operation.equals("adopt")) {
      AgentJson.fields(input, "definition");
      return adoptDefinition(run, owner, kind, input.getJSONObject("definition"), caller.language(),
          GenerationOperations.externalEvidenceScope(owner), () -> operations.gate(run, owner));
    }
    var window = operations.external(run, owner, kind, caller.access(), () -> {
      var target = caller.access().target();
      if (target.testing()) buildTests.require(target.contextId(), owner.userId(), owner.domainId());
    });
    window.recheck().run();
    store.transaction(window.gate());
    return switch (operation) {
      case "context" -> context(kind, input, window.access());
      case "prepare" -> {
        requireAction(kind);
        AgentJson.fields(input, "objDatas", "relDatas", "vectorDatas");
        var samples = operations.authorSamples(owner.domainId(), input, window.access().classNames());
        yield operations.storeSamples(window, samples);
      }
      case "explain-draft" -> {
        requireAction(kind);
        var explained = explain(input, window.access(), owner, caller.language());
        window.recheck().run();
        store.transaction(window.gate());
        yield explained;
      }
      default -> operateWindow(operation, window, input);
    };
  }

  private Object operateWindow(String operation, GenerationOperations.Window window, JSONObject input)
      throws Exception {
    return switch (operation) {
      case "reset" -> {
        requireAction(window.kind());
        AgentJson.fields(input);
        yield operations.reset(window);
      }
      case "query-sandbox" -> {
        requireAction(window.kind());
        AgentJson.fields(input, "dsl");
        yield operations.query(window, input);
      }
      case "test" -> {
        if (window.kind().equals("action")) AgentJson.fields(input, "code", "parameterDefs", "sourceAnalysis");
        else AgentJson.fields(input, "queryPackage", "columnLabels");
        yield operations.test(window, input);
      }
      default -> throw AgentHttpException.missing();
    };
  }

  private JSONObject context(String kind, JSONObject input, QueryAccessService.Access access) throws Exception {
    AgentJson.fields(input);
    var rule = ontology.rule(access);
    var classes = ((List<?>) rule.get("classDef")).stream()
        .map(item -> ((Map<?, ?>) item).get("className").toString()).toList();
    var lookup = JSONObject.of("query", kind + " " + String.join(" ", classes), "limit", 10);
    return JSONObject.of("ontology", rule, "knowledge", ontology.knowledge(lookup, access),
        "helpers", JSONObject.of("markdown", PythonHelperDocs.markdown()));
  }

  private ActionService.ExplainedDraft explain(JSONObject input, QueryAccessService.Access access,
      Owner owner, String language) {
    AgentJson.fields(input, "code", "parameterDefs");
    String source = AgentJson.text(input, "code");
    var parameters = operations.actionParameters(owner.domainId(), input.getJSONArray("parameterDefs"));
    return OntologyGenerationService.asOwner(access, () -> actions.explainDraft(source, parameters, owner, language));
  }

  private JSONObject adopt(Run run, String kind, JSONObject definition, String language) {
    var status = status(run);
    boolean running = "running".equals(status.getString("status"));
    if (!running && !"stop".equals(status.getString("stopReason"))) throw closed();
    if (running && run.expiresAt() <= System.currentTimeMillis()) throw closed();

    return adoptDefinition(run.id(), run.owner(), kind, definition, language, run.evidenceScope(), () -> {
      insert(run.id(), run.session(), run.owner(), null);
      var row = row(run.id(), run.session(), run.owner(), true);
      if ("cancelled".equals(row.getString("closed")) || running && row.getString("closed") != null)
        throw closed();
      return row;
    });
  }

  private JSONObject adoptDefinition(String run, Owner owner, String kind, JSONObject definition,
      String language, String evidenceScope, Supplier<JSONObject> gate) {
    if (definition == null) throw AgentHttpException.invalid("definition is required");
    Function function = Function.fromAsset(definition);
    String id = definition.get("id") == null ? null : AgentJson.text(definition, "id");
    return store.transaction(() -> {
      gate.get();
      if (kind.equals("action")) {
        ActionFunctionAdmission.requireSupported(function, messages, language);
        String digest = operations.actionDigest(owner.domainId(),
            AgentJson.text(definition.getJSONObject("function"), "code"),
            definition.getJSONObject("function").getJSONArray("parameters"));
        var same = id != null && digest.equals(currentActionDigest(id, owner));
        return accepted(definition, run, kind, new DefinitionDigests(digest, Set.of(digest)), evidenceScope, same);
      }
      if (!Function.OPERATION_READ.equals(function.getOperation()))
        throw AgentHttpException.invalid("MetricView requires a read Function");
      var current = id == null ? null : currentMetric(id, owner);
      List<MetricViewBinding> bindings = definition.containsKey("bindings")
          ? definition.getList("bindings", MetricViewBinding.class)
          : current == null ? List.of() : current.getBindings();
      if (bindings == null) bindings = current == null ? List.of() : current.getBindings();
      var requested = metricDigests(function, bindings);
      var same = current != null && requested.equals(metricDigests(current.getFunction(), current.getBindings()));
      return accepted(definition, run, kind, requested, evidenceScope, same);
    });
  }

  private JSONObject accepted(JSONObject definition, String run, String kind, DefinitionDigests digests,
      String evidenceScope, boolean same) {
    String executionId = null;
    if (!same) {
      for (String digest : digests.cases()) {
        var receipt = operations.requireTest(run, kind, digest, evidenceScope);
        if (digest.equals(digests.primary())) executionId = receipt.executionId();
      }
    }
    return JSONObject.of("definition", definition, "executionId", executionId, "digest", digests.primary());
  }

  private String currentActionDigest(String id, Owner owner) {
    actionDao.lock(id, owner.domainId());
    var action = actions.queryById(id);
    if (action == null || !owner.domainId().equals(action.getDomainId())
        || Action.ORIGIN_SYSTEM.equals(action.getOrigin())) throw AgentHttpException.missing();
    var function = action.getFunction();
    if (!owner.domainId().equals(function.getDomainId())) throw AgentHttpException.missing();
    JSONArray parameters = function.getParameters() == null ? null : JSONArray.from(function.getParameters());
    return operations.actionDigest(owner.domainId(), function.getCode(), parameters);
  }

  private MetricView currentMetric(String id, Owner owner) {
    metricDao.lock(id, owner.domainId());
    var metric = metrics.queryById(id, owner.domainId());
    if (metric == null || MetricView.ORIGIN_SYSTEM.equals(metric.getOrigin())) throw AgentHttpException.missing();
    return metric;
  }

  private record DefinitionDigests(String primary, Set<String> cases) {}

  private static DefinitionDigests metricDigests(Function function, List<MetricViewBinding> bindings) {
    var bundle = QueryPackage.accept(function.getQueryPackage());
    String primary = GenerationOperations.packageTestDigest("metric", bundle);
    var digests = new LinkedHashSet<String>();
    digests.add(primary);
    MetricViewBindings.validate(function, bindings);
    for (var binding : bindings) {
      var executable = QueryPackage.copy(bundle);
      for (Object raw : executable.getJSONObject("manifest").getJSONArray("parameterDefs")) {
        var parameter = (JSONObject) raw;
        parameter.put("value", binding.getParameters().get(parameter.getString("name")));
      }
      digests.add(GenerationOperations.packageTestDigest("metric", executable));
    }
    return new DefinitionDigests(primary, digests);
  }

  private QueryAccessService.Access executionAccess(Run run) {
    var target = executionTarget(run);
    var permission = permissions.getDataPermission(run.executor(), run.owner().domainId());
    var classes = run.classes();
    long expiresAt = run.expiresAt();
    var credentialExpiresAt = identity.getCurrentCredentialExpiresAt();
    if (credentialExpiresAt != null) expiresAt = Math.min(expiresAt, credentialExpiresAt);
    if (target.testing()) {
      var parentClasses = classes;
      classes = target.classNames().stream().filter(name -> parentClasses.isEmpty() || parentClasses.contains(name)).toList();
      if (classes.isEmpty())
        throw new AgentHttpException(403, "BUILD_TEST_FORBIDDEN", "No test classes in the authoring scope");
      expiresAt = Math.min(expiresAt, target.expiresAt());
    }
    if (expiresAt <= System.currentTimeMillis()) throw closed();
    return new QueryAccessService.Access(new QueryAccessService.GrantUser(run.executor(), run.owner().domainId()),
        permission, null, null, expiresAt, QueryAccessService.classScope(permission, classes), target,
        run.executor().equals(run.owner().userId()) ? null : run.executor(), run.owner().userId());
  }

  private ExecutionTarget executionTarget(Run run) {
    var target = run.target();
    if (target == null)
      throw new AgentHttpException(400, "BUILD_TEST_CONTEXT_REQUIRED", "Authoring requires a resolved target");
    return switch (AgentJson.text(target, "kind")) {
      case "live" -> {
        AgentJson.fields(target, "kind");
        yield ExecutionTarget.LIVE;
      }
      case "build-test" -> {
        AgentJson.fields(target, "kind", "contextId");
        yield buildTests.require(AgentJson.id(target.getString("contextId")), run.executor(), run.owner().domainId());
      }
      default -> throw AgentHttpException.invalid("Unknown authoring execution target");
    };
  }

  private GenerationOperations.Window window(Run run, String kind, QueryAccessService.Access access) {
    String contextId = access.target().contextId();
    return new GenerationOperations.Window(run.id(), run.owner(), kind, () -> {
      var row = open(run);
      if (kind.equals("action")) {
        if (row.getString("sandbox_id") == null)
          throw AgentHttpException.invalid("Prepare the authoring sandbox first");
        if (!Objects.equals(contextId, row.getString("sandbox_context")))
          throw new AgentHttpException(409, "BUILD_TEST_CONTEXT_CHANGED", "Authoring sandbox belongs to another test context");
      }
      row.put("kind", kind);
      return row;
    }, access, data -> store.update("UPDATE ontology_platform_authoring_runs SET test_data=?::jsonb WHERE run_id=?",
        AgentJson.json(data), uuid(run.id())), () -> {
          if (access.expiresAt() <= System.currentTimeMillis()) throw closed();
          requireActive(run);
          if (access.target().testing()) executionTarget(run);
        }, run.evidenceScope());
  }

  private void createSandbox(Run run, String contextId) {
    store.transaction(() -> {
      var row = open(run);
      if (row.getString("sandbox_id") != null) return null;
      String sandbox = "a" + run.id().replace("-", "");
      try {
        operations.createSandbox(sandbox, run.owner().domainId());
      } catch (Exception error) {
        throw new IllegalStateException(error);
      }
      store.update("UPDATE ontology_platform_authoring_runs SET sandbox_id=?, sandbox_context=? WHERE run_id=?",
          sandbox, contextId, uuid(run.id()));
      return null;
    });
  }

  private void register(Run run) {
    store.transaction(() -> {
      insert(run.id(), run.session(), run.owner(), null);
      open(run);
      return null;
    });
  }

  private void insert(String id, String session, Owner owner, String closed) {
    store.update("INSERT INTO ontology_platform_authoring_runs(run_id,session_id,user_id,domain_id,closed)"
            + " VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING", uuid(id), uuid(session), owner.userId(), owner.domainId(), closed);
  }

  private JSONObject status(Run run) {
    return runtime.status(run.owner().domainId(), run.session(), run.id());
  }

  private void requireActive(Run run) {
    if (run.expiresAt() <= System.currentTimeMillis() || !"running".equals(status(run).getString("status")))
      throw closed();
  }

  private JSONObject open(Run run) {
    var found = row(run.id(), run.session(), run.owner(), true);
    if (run.expiresAt() <= System.currentTimeMillis() || found.getString("closed") != null) throw closed();
    return found;
  }

  private static AgentHttpException closed() {
    return new AgentHttpException(409, "RUN_CLOSED", "Authoring execution is closed");
  }

  private JSONObject row(String run, String session, Owner owner, boolean lock) {
    return store.one("SELECT * FROM ontology_platform_authoring_runs WHERE run_id=? AND session_id=? AND user_id=? AND domain_id=?"
            + (lock ? " FOR UPDATE" : ""), uuid(run), uuid(session), owner.userId(), owner.domainId());
  }

  private record CloseWork(String sandbox, List<String> executions) {}

  public void close(String run, String session, Owner owner, String outcome) throws Exception {
    boolean cancelled = outcome.equals("cancelled");
    if (!cancelled && !outcome.equals("terminal")) throw AgentHttpException.invalid("Unknown authoring close outcome");
    if (!cancelled) {
      if (store.rows("SELECT 1 FROM ontology_platform_authoring_runs WHERE run_id=?", uuid(run)).isEmpty()) return;
      if (!"stopped".equals(runtime.status(owner.domainId(), session, run).getString("status"))) throw closed();
    }
    var work = store.transaction(() -> {
      if (cancelled) insert(run, session, owner, outcome);
      var found = row(run, session, owner, true);
      store.update("UPDATE ontology_platform_authoring_runs SET closed=COALESCE(closed,?) WHERE run_id=?", outcome, uuid(run));
      grants.revoke(owner.domainId(), run);
      var executions = store.rows("SELECT execution_id FROM ontology_generation_tests WHERE run_id=? AND result IS NULL", uuid(run))
          .stream().map(child -> child.getString("execution_id")).toList();
      for (String execution : executions) grants.revoke(owner.domainId(), execution);
      return new CloseWork(found.getString("sandbox_id"), executions);
    });
    // The runtime's closeIntent seals admission and waits for an already started process to stop.
    for (String execution : work.executions()) {
      code.closeIntent(owner.domainId(), execution);
      store.update("UPDATE ontology_generation_tests SET result=?::jsonb WHERE execution_id=? AND result IS NULL",
          AgentJson.json(JSONObject.of("error", "Authoring execution closed")), uuid(execution));
    }
    if (work.sandbox() != null) operations.dropSandbox(work.sandbox(), owner.domainId());
    store.update("UPDATE ontology_platform_authoring_runs SET test_data=NULL,sandbox_id=NULL WHERE run_id=?", uuid(run));
  }

  private static void requireAction(String kind) {
    if (!kind.equals("action")) throw AgentHttpException.missing();
  }

  private static String kind(String authoredKind) {
    return switch (authoredKind) {
      case "action" -> "action";
      case "metric-view" -> "metric";
      default -> throw AgentHttpException.missing();
    };
  }
}
