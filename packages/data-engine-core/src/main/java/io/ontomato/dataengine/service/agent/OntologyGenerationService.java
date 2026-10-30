package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.util.SystemUtils;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

/** Runs ontology definitions and consumes only this run's immutable delivery. */
@Service
public class OntologyGenerationService {
  public static final Set<String> KINDS =
      Set.of(
          "action",
          "explain",
          "metric",
          "function",
          "instantiate",
          "name",
          "knowledge",
          "dashboard",
          "describe",
          "quality");
  private static final ThreadLocal<Owner> CURRENT = new ThreadLocal<>();
  private final OntologyAgentStore store;
  private final AgentRuntimeClient runtime;
  private final OntologyAgentDefinitions definitions;
  private final QueryGrantService grants;
  private final SessionRegistryService sessions;
  private final GenerationOperations operations;
  private final RuntimeCodeClient code;
  private final DataPermissionLookup permissions;
  private final Set<String> active = java.util.concurrent.ConcurrentHashMap.newKeySet();
  private static final org.slf4j.Logger LOG =
      org.slf4j.LoggerFactory.getLogger(OntologyGenerationService.class);

  public OntologyGenerationService(
      OntologyAgentStore store,
      AgentRuntimeClient runtime,
      OntologyAgentDefinitions definitions,
      QueryGrantService grants,
      SessionRegistryService sessions,
      GenerationOperations operations,
      RuntimeCodeClient code, @Lazy DataPermissionLookup permissions) {
    this.store = store;
    this.runtime = runtime;
    this.definitions = definitions;
    this.grants = grants;
    this.sessions = sessions;
    this.operations = operations;
    this.code = code;
    this.permissions = permissions;
  }

  @FunctionalInterface
  public interface Work<T> {
    T run() throws Exception;
  }

  public static <T> T asOwner(User user, Work<T> work) {
    var previous = CURRENT.get();
    CURRENT.set(new Owner(user.getId(), user.getDomainId()));
    try {
      return work.run();
    } catch (RuntimeException error) {
      throw error;
    } catch (Exception error) {
      throw new IllegalStateException(error);
    } finally {
      if (previous == null) CURRENT.remove();
      else CURRENT.set(previous);
    }
  }

  public Map<String, Object> authorizedRule(Map<String, Object> rule, String domain) {
    var actor = owner(domain);
    return QueryPermissions.visibleRule(rule, permissions.getDataPermission(actor.userId(), domain), List.of());
  }

  public QueryAccessService.Access executionAccess(String domain) {
    var actor = owner(domain);
    return new QueryAccessService.Access(new QueryAccessService.GrantUser(actor.userId(), domain),
        permissions.getDataPermission(actor.userId(), domain), null, null, null);
  }

  private Owner owner(String domain) {
    var owner = CURRENT.get();
    if (owner == null) {
      User user = SystemUtils.getCurUser();
      if (user == null)
        throw new AgentHttpException(401, "UNAUTHENTICATED", "Generation requires an owner");
      owner = new Owner(user.getId(), user.getDomainId());
    }
    if (!domain.equals(owner.domainId())) throw AgentHttpException.missing();
    return owner;
  }

  public static String agentId(String kind) {
    if (!KINDS.contains(kind)) throw AgentHttpException.invalid("Unknown generation kind");
    if (kind.equals("metric")) return OntologyAgentDefinitions.METRICVIEW_AGENT;
    return UUID.nameUUIDFromBytes(("ontology-generation:" + kind).getBytes(StandardCharsets.UTF_8))
        .toString();
  }

  public JSONObject open(
      String kind, String businessId, String source, Owner owner, boolean external) {
    String session = UUID.randomUUID().toString(), run = UUID.randomUUID().toString();
    String sandbox = kind.equals("action") ? "a" + run.replace("-", "") : null;
    String agent = agentId(kind);
    if (!external) active.add(run);
    try {
      store.transaction(
          () -> {
            store.createSession(session, owner, agent, !external);
            store.update(
                "INSERT INTO"
                    + " ontology_agent_runs(id,session_id,input_hash,request,open,deadline,external,decision_revision)"
                    + " VALUES(?,?,?,?::jsonb,true,?::timestamptz,?,0)",
                uuid(run),
                uuid(session),
                AgentJson.hash(JSONObject.of("kind", kind, "businessId", businessId)),
                "{}",
                Instant.now().plusSeconds(600).toString(),
                external);
            store.update(
                "INSERT INTO"
                    + " ontology_generations(run_id,business_id,kind,sandbox_id,source,owner_node)"
                    + " VALUES(?,?,?,?,?,?)",
                uuid(run),
                businessId,
                kind,
                sandbox,
                source,
                sessions.getNodeId());
            return null;
          });
    } catch (RuntimeException error) {
      active.remove(run);
      throw error;
    }
    try {
      if (sandbox != null) operations.createSandbox(sandbox, owner.domainId());
    } catch (Exception error) {
      close(session, run, owner);
      throw new IllegalStateException(error);
    }
    return JSONObject.of("sessionId", session, "runId", run);
  }

  public Generation generate(
      String kind, String businessId, String prompt, String lang, String domain) {
    return generate(kind, businessId, prompt, lang, domain, null);
  }

  public Generation generate(
      String kind, String businessId, String prompt, String lang, String domain, String source) {
    if (kind.equals("metric"))
      throw AgentHttpException.invalid("MetricView generation has its own agent");
    return generate(kind, businessId, prompt, lang, domain, source, false);
  }

  /** MetricView generation runs as its own agent with its own definition and skill package. */
  public Generation generateMetricView(
      String businessId, String prompt, String lang, String domain) {
    return generate("metric", businessId, prompt, lang, domain, null, true);
  }

  private Generation generate(
      String kind,
      String businessId,
      String prompt,
      String lang,
      String domain,
      String source,
      boolean metricView) {
    Owner owner = owner(domain);
    var ids = open(kind, businessId, source, owner, false);
    String session = ids.getString("sessionId"), run = ids.getString("runId");
    var delivery = new Generation(session, run, owner);
    try {
      checkBusiness(businessId);
      if (metricView) definitions.publishMetricView();
      else definitions.publishGeneration();
      runtime.json(domain, run, "/v1/sessions", "POST", Map.of(), session);
      var row = store.run(session, run, owner);
      long deadline = Instant.parse(row.getString("deadline")).toEpochMilli();
      String credential =
          grants.issue(
              owner.userId(), domain, "ontology-generation", run, deadline, List.of(), null);
      store.transaction(() -> store.gate(session, run, owner));
      runtime.json(
          domain,
          run,
          "/v1/sessions/" + session + "/runs",
          "POST",
          JSONObject.of(
              "language", lang == null ? "en" : lang,
              "input",
                  JSONObject.of(
                      "role",
                      "user",
                      "content",
                      "Complete the ontology "
                          + kind
                          + " task. Read the "
                          + (metricView ? "metricview-generation" : "ontology-generation")
                          + " skill and write outputs/result.json.",
                      "timestamp",
                      Instant.parse(row.getString("created_at")).toEpochMilli()),
              "definition",
                  metricView
                      ? definitions.metricView(prompt, lang, deadline - System.currentTimeMillis())
                      : definitions.generation(
                          kind, prompt, lang, deadline - System.currentTimeMillis()),
              "environment",
                  JSONObject.of(
                      "values",
                      JSONObject.of(
                          "ONTOMATO_ONTOLOGY_URL",
                          runtime.ontologyUrl(),
                          "ONTOMATO_GENERATION_ID",
                          run,
                          "ONTOMATO_GENERATION_KIND",
                          kind),
                      "secrets",
                      JSONObject.of(
                          "ONTOMATO_TK", credential))),
          run);
      JSONObject snapshot;
      while (true) {
        checkBusiness(businessId);
        var current = store.run(session, run, owner);
        if (current.getBooleanValue("cancel_requested")
            || Instant.parse(current.getString("deadline")).toEpochMilli()
                <= System.currentTimeMillis()) throw closed();
        snapshot = runtime.run(domain, run);
        if (!"running".equals(snapshot.getJSONObject("run").getString("status"))) break;
        Thread.sleep(150);
      }
      store.update(
          "UPDATE ontology_agent_runs SET open=false,observed_state=?::jsonb WHERE id=?",
          AgentJson.json(snapshot.getJSONObject("run")),
          uuid(run));
      if (!"stop".equals(snapshot.getJSONObject("run").getString("stopReason")))
        throw new IllegalStateException("Ontology generation did not complete successfully");
      var result = JSON.parseObject(file(domain, session, run, "outputs/result.json"));
      if (result == null) throw new IllegalArgumentException("Missing generation result");
      if (Set.of("action", "metric", "function", "dashboard").contains(kind)) {
        if (result.containsKey("code"))
          throw AgentHttpException.invalid("Use sourcePath, not embedded code");
        String code = file(domain, session, run, AgentJson.text(result, "sourcePath"));
        operations.requireTest(run, kind, code, result.getJSONArray("parameterDefs"));
        result.put("code", code);
      }
      delivery.result = result;
      return delivery;
    } catch (Exception error) {
      delivery.close();
      if (error instanceof RuntimeException runtimeError) throw runtimeError;
      throw new IllegalStateException("Ontology generation failed", error);
    }
  }

  private String file(String domain, String session, String run, String path) throws Exception {
    if (path == null || path.startsWith("/") || Arrays.asList(path.split("/", -1)).contains(".."))
      throw AgentHttpException.invalid("Invalid result path");
    var artifacts =
        runtime
            .json(
                domain,
                run,
                "/v1/runs/"
                    + run
                    + "/artifacts?path="
                    + java.net.URLEncoder.encode(path, StandardCharsets.UTF_8),
                "GET",
                null,
                null)
            .getJSONArray("artifacts");
    if (artifacts == null || artifacts.isEmpty())
      throw new IllegalStateException("Missing generation file: " + path);
    var artifact = artifacts.getJSONObject(artifacts.size() - 1);
    if (!run.equals(artifact.getString("runId"))
        || !session.equals(artifact.getString("sessionId")))
      throw new IllegalStateException("Inherited files are not generation deliveries");
    return new String(
        runtime.bytes(domain, run, "/v1/artifacts/" + artifact.getString("id") + "/content"),
        StandardCharsets.UTF_8);
  }

  private void checkBusiness(String id) {
    if (Thread.currentThread().isInterrupted() || sessions.isSessionCancelled(id))
      throw new SessionCancelledException(id);
  }

  public void cancel(String session, String run, Owner owner) {
    store.run(session, run, owner);
    String business =
        store
            .one("SELECT business_id FROM ontology_generations WHERE run_id=?", uuid(run))
            .getString("business_id");
    store.closeRun(session, run, owner);
    sessions.markSessionCancelled(business, System.currentTimeMillis());
    close(session, run, owner);
  }

  public void close(String session, String run, Owner owner) {
    store.closeRun(session, run, owner);
    active.remove(run);
    reconcileCancellation(session, run, owner);
  }

  private void reconcileCancellation(String session, String run, Owner owner) {
    boolean interrupted = Thread.interrupted();
    try {
      grants.revoke(owner.domainId(), run);
      sessions.markSessionCancelled(run, System.currentTimeMillis());
      for (var test :
          store.rows(
              "SELECT execution_id FROM ontology_generation_tests WHERE run_id=?", uuid(run)))
        code.closeIntent(owner.domainId(), test.getString("execution_id"));
      if (!store.run(session, run, owner).getBooleanValue("external"))
        runtime.json(
            owner.domainId(),
            run,
            "/v1/sessions/" + session + "/run-intents/" + run + "/cancel",
            "POST",
            Map.of(),
            null);
      var g = store.one("SELECT * FROM ontology_generations WHERE run_id=?", uuid(run));
      if (g.getString("sandbox_id") != null)
        operations.dropSandbox(g.getString("sandbox_id"), owner.domainId());
      store.transaction(
          () -> {
            store.update(
                "UPDATE ontology_generations SET source=NULL,test_data=NULL,sandbox_id=NULL WHERE"
                    + " run_id=?",
                uuid(run));
            store.update(
                "UPDATE ontology_agent_runs SET cancel_confirmed=true WHERE id=?", uuid(run));
            return null;
          });
    } catch (Exception error) {
      LOG.warn("Generation cleanup awaits reconciliation: {}", run, error);
    } finally {
      if (interrupted) Thread.currentThread().interrupt();
    }
  }

  @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 1000)
  public void recover() {
    for (var row :
        store.rows(
            "SELECT r.*,s.user_id,s.domain_id FROM ontology_generations g JOIN ontology_agent_runs"
                + " r ON r.id=g.run_id JOIN ontology_agent_sessions s ON s.id=r.session_id WHERE"
                + " g.owner_node=? AND r.cancel_confirmed=false AND s.agent_id<>?",
            sessions.getNodeId(),
            uuid(ActionCreationService.AGENT))) {
      String run = row.getString("id");
      boolean expired =
          Instant.parse(row.getString("deadline")).toEpochMilli() <= System.currentTimeMillis();
      if (row.getBooleanValue("cancel_requested")
          || expired
          || (!row.getBooleanValue("external") && !active.contains(run)))
        close(row.getString("session_id"), run, OntologyAgentStore.owner(row));
    }
  }

  public final class Generation implements AutoCloseable {
    private final String session, run;
    private final Owner owner;
    private JSONObject result;

    Generation(String session, String run, Owner owner) {
      this.session = session;
      this.run = run;
      this.owner = owner;
    }

    public JSONObject result() {
      return result;
    }

    public <T> T settle(Work<T> work) {
      return store.transaction(
          () -> {
            store.one("SELECT id FROM ontology_agent_runs WHERE id=? FOR UPDATE", uuid(run));
            var row = store.run(session, run, owner);
            var g = store.one("SELECT * FROM ontology_generations WHERE run_id=?", uuid(run));
            checkBusiness(g.getString("business_id"));
            if (row.getBooleanValue("cancel_requested")
                || g.getBooleanValue("settled")
                || Instant.parse(row.getString("deadline")).toEpochMilli()
                    <= System.currentTimeMillis()) throw closed();
            try {
              T value = work.run();
              store.update(
                  "UPDATE ontology_generations SET settled=true WHERE run_id=?", uuid(run));
              return value;
            } catch (RuntimeException e) {
              throw e;
            } catch (Exception e) {
              throw new IllegalStateException(e);
            }
          });
    }

    @Override
    public void close() {
      OntologyGenerationService.this.close(session, run, owner);
    }
  }
}
