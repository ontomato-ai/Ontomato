package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.Owner;
import static io.ontomato.dataengine.service.agent.OntologyAgentStore.uuid;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.service.SessionRegistryService;
import jakarta.annotation.PostConstruct;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.DependsOn;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Owns the persistent "create an action by talking to an agent" sessions. Each message is an
 * Action generation run: it has a write sandbox and the generation skill, so the agent can read
 * the schema, write the program, run the business test and leave the final files under outputs/.
 * The draft is built from those files afterwards; this service never persists an Action.
 */
@Slf4j
@Service
@DependsOn("ontologyAgentStore")
public class ActionCreationService {
  /** Stable identity of the conversational action-creation agent. */
  public static final String AGENT =
      UUID.nameUUIDFromBytes("ontology-action-creation".getBytes(StandardCharsets.UTF_8)).toString();

  private final OntologyAgentStore store;
  private final AgentRuntimeClient runtime;
  private final OntologyAgentDefinitions definitions;
  private final QueryGrantService grants;
  private final GenerationOperations operations;
  private final AdminService admin;
  private final BusinessConfigService businessConfig;
  private final KnowledgeDao knowledge;
  private final LangService langService;
  private final SessionRegistryService sessions;

  public ActionCreationService(
      OntologyAgentStore store,
      AgentRuntimeClient runtime,
      OntologyAgentDefinitions definitions,
      QueryGrantService grants,
      GenerationOperations operations,
      AdminService admin,
      BusinessConfigService businessConfig,
      KnowledgeDao knowledge,
      LangService langService,
      SessionRegistryService sessions) {
    this.store = store;
    this.runtime = runtime;
    this.definitions = definitions;
    this.grants = grants;
    this.operations = operations;
    this.admin = admin;
    this.businessConfig = businessConfig;
    this.knowledge = knowledge;
    this.langService = langService;
    this.sessions = sessions;
  }

  @PostConstruct
  public void initialize() {
    store.update(
        """
        CREATE TABLE IF NOT EXISTS ontology_action_creation_sessions (
          id uuid PRIMARY KEY REFERENCES ontology_agent_sessions(id),
          latest_run_id uuid,
          revision bigint NOT NULL DEFAULT 0);
        """);
  }

  private JSONObject session(String id, Owner owner) {
    var row = store.session(id, owner);
    if (!AGENT.equals(row.getString("agent_id"))) throw AgentHttpException.missing();
    return row;
  }

  private JSONObject state(String id, Owner owner, boolean lock) {
    session(id, owner);
    return store.one(
        "SELECT * FROM ontology_action_creation_sessions WHERE id=?" + (lock ? " FOR UPDATE" : ""),
        uuid(id));
  }

  public boolean create(String id, Owner owner) throws Exception {
    boolean replayed =
        store.transaction(
            () -> {
              boolean existed = store.createSession(id, owner, AGENT, true);
              store.update(
                  "INSERT INTO ontology_action_creation_sessions(id) VALUES(?) ON CONFLICT DO"
                      + " NOTHING",
                  uuid(id));
              return existed;
            });
    runtime.json(owner.domainId(), id, "/v1/sessions", "POST", Map.of(), id);
    return replayed;
  }

  public boolean start(String id, String run, String message, OntologyAgentAccess.Context context)
      throws Exception {
    if (message == null || message.isBlank() || message.length() > 20_000)
      throw AgentHttpException.invalid("A message of 1 to 20000 characters is required");
    Owner owner = context.owner();
    session(id, owner);
    JSONObject snapshot = runtime.json(owner.domainId(), id, "/v1/sessions/" + id, "GET", null, null);
    JSONObject latest = snapshot.getJSONObject("latestRun");
    if (latest != null && "running".equals(latest.getJSONObject("run").getString("status")))
      throw new AgentHttpException(409, "SESSION_BUSY", "An action creation run is active");
    if (latest != null) settle(latest.getJSONObject("run").getString("id"));

    String sandbox = "a" + run.replace("-", "");
    long deadline = Math.min(System.currentTimeMillis() + 600_000,
        context.expiresAt() == null ? Long.MAX_VALUE : context.expiresAt());
    if (deadline <= System.currentTimeMillis()) throw closed();
    JSONObject input = JSONObject.of("message", message);
    boolean replayed =
        store.transaction(
            () -> {
              var previous = store.rows("SELECT * FROM ontology_agent_runs WHERE id=?", uuid(run));
              if (!previous.isEmpty()) {
                var row = previous.get(0);
                if (!id.equals(row.getString("session_id"))
                    || !AgentJson.hash(input).equals(row.getString("input_hash")))
                  throw conflict("Run input changed");
                return true;
              }
              store.update(
                  "INSERT INTO"
                      + " ontology_agent_runs(id,session_id,input_hash,request,open,deadline,external,decision_revision)"
                      + " VALUES(?,?,?,?::jsonb,true,?::timestamptz,false,0)",
                  uuid(run),
                  uuid(id),
                  AgentJson.hash(input),
                  AgentJson.json(input),
                  Instant.ofEpochMilli(deadline).toString());
              store.update(
                  "INSERT INTO"
                      + " ontology_generations(run_id,business_id,kind,sandbox_id,source,owner_node)"
                      + " VALUES(?,?,?,?,?,?)",
                  uuid(run),
                  run,
                  "action",
                  sandbox,
                  null,
                  sessions.getNodeId());
              store.update(
                  "UPDATE ontology_action_creation_sessions SET latest_run_id=?,"
                      + " revision=revision+1 WHERE id=?",
                  uuid(run),
                  uuid(id));
              store.update(
                  "UPDATE ontology_agent_sessions SET title=CASE WHEN title='' THEN ? ELSE title"
                      + " END,updated_at=now() WHERE id=?",
                  message,
                  uuid(id));
              return false;
            });
    if (replayed) return true;

    try {
      operations.createSandbox(sandbox, owner.domainId());
      definitions.publishGeneration();
      var row =
          store.one(
              "SELECT r.*,g.sandbox_id FROM ontology_agent_runs r JOIN ontology_generations g ON"
                  + " g.run_id=r.id WHERE r.id=?",
              uuid(run));
      long remaining = deadline - System.currentTimeMillis();
      String generationToken =
          grants.issue(
              owner.userId(),
              owner.domainId(),
              "ontology-generation",
              run,
              deadline,
              List.of(),
              null);
      String queryToken =
          grants.issue(
              owner.userId(),
              owner.domainId(),
              "retrieval-exploration",
              run,
              deadline,
              List.of(),
              null);
      store.transaction(() -> store.gate(id, run, owner));
      String prompt =
          OntologyGenerationPrompts.getActionMakerUserMessage(
              message,
              "",
              knowledge,
              businessConfig,
              context.language(),
              langService,
              admin.getJSONRule(owner.domainId()),
              owner.domainId());
      runtime.json(
          owner.domainId(),
          run,
          "/v1/sessions/" + id + "/runs",
          "POST",
          JSONObject.of(
              "language",
              context.language(),
              "input",
              JSONObject.of(
                  "role",
                  "user",
                  "content",
                  message,
                  "timestamp",
                  Instant.parse(row.getString("created_at")).toEpochMilli()),
              "definition",
              definitions.actionCreation(prompt, context.language(), remaining),
              "environment",
              JSONObject.of(
                  "values",
                  JSONObject.of(
                      "ONTOMATO_ONTOLOGY_URL",
                      runtime.ontologyUrl(),
                      "ONTOMATO_GENERATION_ID",
                      run,
                      "ONTOMATO_GENERATION_KIND",
                      "action"),
                  "secrets",
                  JSONObject.of(
                      "ONTOMATO_GENERATION_TK",
                      generationToken,
                      "ONTOMATO_QUERY_TK",
                      queryToken))),
          run);
    } catch (Exception error) {
      cancel(id, run, owner);
      throw error;
    }
    return false;
  }

  public void settle(String run) {
    store.update("UPDATE ontology_agent_runs SET open=false WHERE id=?", uuid(run));
  }

  public void cancel(String id, String run, Owner owner) throws Exception {
    session(id, owner);
    store.closeRun(id, run, owner);
    dropSandbox(run, owner.domainId());
    grants.revoke(owner.domainId(), run);
    try {
      runtime.json(
          owner.domainId(),
          run,
          "/v1/sessions/" + id + "/run-intents/" + run + "/cancel",
          "POST",
          Map.of(),
          null);
    } catch (Exception ignored) {
      // The runtime may already have stopped the run; closing our side is enough.
    }
  }

  public void delete(String id, Owner owner) throws Exception {
    var row = session(id, owner);
    for (var run : store.rows("SELECT id FROM ontology_agent_runs WHERE session_id=?", uuid(id)))
      cancel(id, run.getString("id"), owner);
    if (row.getBooleanValue("runtime_owned"))
      runtime.json(owner.domainId(), id, "/v1/sessions/" + id, "DELETE", null, null);
    store.transaction(
        () -> {
          state(id, owner, true);
          store.update(
              "DELETE FROM ontology_generation_tests WHERE run_id IN (SELECT id FROM"
                  + " ontology_agent_runs WHERE session_id=?)",
              uuid(id));
          store.update(
              "DELETE FROM ontology_generations WHERE run_id IN (SELECT id FROM"
                  + " ontology_agent_runs WHERE session_id=?)",
              uuid(id));
          store.update("DELETE FROM ontology_action_creation_sessions WHERE id=?", uuid(id));
          store.update("DELETE FROM ontology_agent_runs WHERE session_id=?", uuid(id));
          store.update("DELETE FROM ontology_agent_sessions WHERE id=?", uuid(id));
          return null;
        });
  }

  /**
   * A run can stop without the user opening the draft. Close it and release its write sandbox;
   * the published files remain readable until the draft is created.
   */
  @Scheduled(fixedDelay = 60_000)
  public void recover() {
    for (var row :
        store.rows(
            "SELECT r.id,r.session_id,r.deadline,r.cancel_requested,s.user_id,s.domain_id"
                + " FROM ontology_agent_runs r JOIN ontology_agent_sessions s ON s.id=r.session_id"
                + " WHERE s.agent_id=? AND r.open=true",
            uuid(AGENT))) {
      String run = row.getString("id");
      try {
        boolean expired =
            Instant.parse(row.getString("deadline")).toEpochMilli() <= System.currentTimeMillis();
        boolean stopped = false;
        JSONObject snapshot = null;
        var owner = new Owner(row.getString("user_id"), row.getString("domain_id"));
        if (!expired) {
          snapshot = runtime.run(owner.domainId(), run);
          stopped = !"running".equals(snapshot.getJSONObject("run").getString("status"));
        }
        if (!expired && !stopped && looping(snapshot)) {
          log.warn(
              "Cancelling looping action-creation run {} ({} tool calls)",
              run,
              snapshot.getJSONArray("toolExecutions").size());
          cancel(row.getString("session_id"), run, owner);
          continue;
        }
        if (expired || stopped || row.getBooleanValue("cancel_requested"))
          settleAndRelease(run, row.getString("session_id"), owner);
      } catch (Exception error) {
        // The run row remains open; the next sweep retries.
      }
    }
  }

  /**
   * A runaway model can repeat exactly the same tool call indefinitely. The generation runtime has
   * no step limit, so the host closes such runs: more than 100 tool calls, or 12 identical calls.
   */
  private boolean looping(JSONObject snapshot) {
    if (snapshot == null) return false;
    JSONArray tools = snapshot.getJSONArray("toolExecutions");
    if (tools == null) return false;
    if (tools.size() > 100) return true;
    Map<String, Integer> counts = new HashMap<>();
    for (int i = 0; i < tools.size(); i++) {
      JSONObject tool = tools.getJSONObject(i);
      String key = tool.getString("toolName") + ":" + AgentJson.json(tool.get("args"));
      if (counts.merge(key, 1, Integer::sum) >= 12) return true;
    }
    return false;
  }

  private void settleAndRelease(String run, String session, Owner owner) {
    store.update("UPDATE ontology_agent_runs SET open=false WHERE id=?", uuid(run));
    dropSandbox(run, owner.domainId());
  }

  private void dropSandbox(String run, String domain) {
    try {
      var rows =
          store.rows("SELECT sandbox_id FROM ontology_generations WHERE run_id=?", uuid(run));
      if (rows.isEmpty()) return;
      String sandbox = rows.get(0).getString("sandbox_id");
      if (sandbox == null) return;
      operations.dropSandbox(sandbox, domain);
      store.update("UPDATE ontology_generations SET sandbox_id=NULL WHERE run_id=?", uuid(run));
    } catch (Exception error) {
      // Sandbox removal is best effort; the namespace is reclaimed by its owner later.
    }
  }

  private static AgentHttpException closed() {
    return new AgentHttpException(409, "ACTION_CREATION_RUN_CLOSED", "The run is closed");
  }

  private static AgentHttpException conflict(String message) {
    return new AgentHttpException(409, "CONFLICT", message);
  }
}
