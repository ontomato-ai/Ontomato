package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.*;
import jakarta.annotation.PostConstruct;
import java.time.Instant;
import java.util.*;
import java.util.function.Supplier;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Ontology-owned indexes and business gates. Runtime remains the execution fact owner. */
@Service
@DependsOn("jdbcInitDb")
public class OntologyAgentStore {
  public static final String RETRIEVER = "dd3b91b9-9214-4aa6-9937-fb07fd37b232";

  public record Owner(String userId, String domainId) {}

  private final JdbcTemplate jdbc;
  private final TransactionTemplate transactions;

  public OntologyAgentStore(JdbcTemplate jdbc, PlatformTransactionManager manager) {
    this.jdbc = jdbc;
    transactions = new TransactionTemplate(manager);
  }

  @PostConstruct
  public void initialize() {
    jdbc.execute(
        """
CREATE TABLE IF NOT EXISTS ontology_agent_sessions (
  id uuid PRIMARY KEY, user_id text NOT NULL, domain_id text NOT NULL, agent_id uuid NOT NULL,
  runtime_owned boolean NOT NULL DEFAULT true, title text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ontology_agent_sessions_owner ON ontology_agent_sessions(domain_id,user_id,updated_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS ontology_retrieval_callers (
  id uuid PRIMARY KEY, user_id text NOT NULL, domain_id text NOT NULL, input_hash text NOT NULL,
  input jsonb NOT NULL, closed boolean NOT NULL, deadline timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS ontology_agent_runs (
  id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES ontology_agent_sessions(id),
  input_hash text NOT NULL, request jsonb NOT NULL, open boolean NOT NULL, deadline timestamptz NOT NULL,
  caller_id uuid REFERENCES ontology_retrieval_callers(id), external boolean NOT NULL,
  dataset_ids jsonb NOT NULL DEFAULT '[]', observed_state jsonb, decision_revision integer NOT NULL,
  qc_id uuid, qc_admitted boolean NOT NULL DEFAULT false, cancel_requested boolean NOT NULL DEFAULT false, cancel_confirmed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE ontology_agent_runs ADD COLUMN IF NOT EXISTS runtime_admitted boolean NOT NULL DEFAULT true;
ALTER TABLE ontology_agent_runs ADD COLUMN IF NOT EXISTS admission_error text;
ALTER TABLE ontology_agent_runs ADD COLUMN IF NOT EXISTS result_after bigint NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS ontology_binding_runs (
  run_id uuid PRIMARY KEY REFERENCES ontology_agent_runs(id), status text NOT NULL,
  open boolean NOT NULL, deadline timestamptz, owner_node text NOT NULL, error text, qc_id uuid NOT NULL, qc_admitted boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS ontology_binding_outputs (
  id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES ontology_binding_runs(run_id),
  request jsonb NOT NULL, dataset text, sha256 text);
CREATE TABLE IF NOT EXISTS ontology_retrieval_deliveries (
  seq bigserial PRIMARY KEY, run_id uuid NOT NULL REFERENCES ontology_agent_runs(id),
  source text NOT NULL, source_id uuid NOT NULL, data jsonb NOT NULL,
  UNIQUE(run_id,source,source_id));
CREATE TABLE IF NOT EXISTS ontology_generations (
  run_id uuid PRIMARY KEY REFERENCES ontology_agent_runs(id), business_id text NOT NULL,
  kind text NOT NULL, owner_node text NOT NULL, sandbox_id text, source text, test_data jsonb, settled boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS ontology_generation_tests (
  run_id uuid NOT NULL REFERENCES ontology_agent_runs(id), digest text NOT NULL,
  execution_id uuid PRIMARY KEY, result jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS ontology_retrievals (
  id uuid PRIMARY KEY REFERENCES ontology_agent_sessions(id), input jsonb NOT NULL,
  current_run_id uuid NOT NULL, decisions jsonb NOT NULL DEFAULT '[]', revision integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS ontology_retrieval_outputs (
  id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES ontology_agent_runs(id),
  input_hash text NOT NULL, request jsonb NOT NULL, receipt_id uuid, dataset_digest text);
CREATE TABLE IF NOT EXISTS ontology_retrieval_artifacts (
  artifact_id uuid PRIMARY KEY, output_id uuid NOT NULL REFERENCES ontology_retrieval_outputs(id),
  run_id uuid NOT NULL REFERENCES ontology_agent_runs(id), path text NOT NULL);
""");
  }

  public <T> T transaction(Supplier<T> operation) {
    return transactions.execute(status -> operation.get());
  }

  public int update(String sql, Object... values) {
    return jdbc.update(sql, values);
  }

  public List<JSONObject> rows(String sql, Object... values) {
    return jdbc.query(
        "SELECT row_to_json(q)::text FROM (" + sql + ") q",
        (r, n) -> JSON.parseObject(r.getString(1)),
        values);
  }

  public JSONObject one(String sql, Object... values) {
    var rows = rows(sql, values);
    if (rows.isEmpty()) throw AgentHttpException.missing();
    return rows.get(0);
  }

  public static UUID uuid(String id) {
    return UUID.fromString(AgentJson.id(id));
  }

  public static Owner owner(JSONObject row) {
    return new Owner(row.getString("user_id"), row.getString("domain_id"));
  }

  public JSONObject session(String id, Owner owner) {
    return one(
        "SELECT * FROM ontology_agent_sessions WHERE id=? AND user_id=? AND domain_id=?",
        uuid(id),
        owner.userId(),
        owner.domainId());
  }

  public JSONObject run(String session, String id, Owner owner) {
    session(session, owner);
    return one(
        "SELECT * FROM ontology_agent_runs WHERE id=? AND session_id=?", uuid(id), uuid(session));
  }

  public JSONObject retrieval(String id, Owner owner) {
    session(id, owner);
    return one("SELECT * FROM ontology_retrievals WHERE id=?", uuid(id));
  }

  public boolean createSession(String id, Owner owner, String agent) {
    return createSession(id, owner, agent, true);
  }

  public boolean createSession(String id, Owner owner, String agent, boolean runtimeOwned) {
    AgentJson.id(agent);
    int n =
        update(
            "INSERT INTO ontology_agent_sessions(id,user_id,domain_id,agent_id,runtime_owned)"
                + " VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING",
            uuid(id),
            owner.userId(),
            owner.domainId(),
            uuid(agent),
            runtimeOwned);
    var existing = session(id, owner);
    if (!agent.equals(existing.getString("agent_id"))
        || existing.getBooleanValue("runtime_owned") != runtimeOwned)
      throw conflict("Session definition changed");
    return n == 0;
  }

  public JSONObject caller(String id, Owner owner, boolean lock) {
    return one(
        "SELECT * FROM ontology_retrieval_callers WHERE id=? AND user_id=? AND domain_id=?"
            + (lock ? " FOR UPDATE" : ""),
        uuid(id),
        owner.userId(),
        owner.domainId());
  }

  public JSONObject serviceCaller(String id, String domain) {
    return one(
        "SELECT * FROM ontology_retrieval_callers WHERE id=? AND domain_id=?", uuid(id), domain);
  }

  public JSONObject openCaller(String id, Owner owner, JSONObject input) {
    return transaction(
        () -> {
          for (String continuation : input.getList("continuationIds", String.class))
            retrieval(continuation, owner);
          update(
              "INSERT INTO ontology_retrieval_callers VALUES(?,?,?,?,?::jsonb,false,?::timestamptz)"
                  + " ON CONFLICT DO NOTHING",
              uuid(id),
              owner.userId(),
              owner.domainId(),
              AgentJson.hash(input),
              AgentJson.json(input),
              input.getString("deadlineAt"));
          var row = caller(id, owner, true);
          if (row.getBooleanValue("closed")) throw closed();
          if (!row.getString("input_hash").equals(AgentJson.hash(input)))
            throw conflict("Caller input changed");
          return JSONObject.of(
              "id", id, "expiresAt", Instant.parse(row.getString("deadline")).toString());
        });
  }

  public List<JSONObject> closeCaller(String id, Owner owner) {
    return transaction(
        () -> {
          update(
              "INSERT INTO ontology_retrieval_callers VALUES(?,?,?,'','{}',true,now()) ON CONFLICT"
                  + " DO NOTHING",
              uuid(id),
              owner.userId(),
              owner.domainId());
          caller(id, owner, true);
          update("UPDATE ontology_retrieval_callers SET closed=true WHERE id=?", uuid(id));
          var active =
              rows(
                  "SELECT * FROM ontology_agent_runs WHERE caller_id=? AND open=true FOR UPDATE",
                  uuid(id));
          update(
              "UPDATE ontology_agent_runs SET open=false,cancel_requested=true WHERE caller_id=?"
                  + " AND open=true",
              uuid(id));
          return active;
        });
  }

  public List<JSONObject> callerRuns(String id, Owner owner) {
    caller(id, owner, false);
    return rows(
        "SELECT session_id AS \"retrievalId\",id AS \"runId\" FROM ontology_agent_runs WHERE"
            + " caller_id=? AND input_hash<>'' ORDER BY created_at,id",
        uuid(id));
  }

  public void requireCallerResource(String caller, String session, String run) {
    var found =
        rows(
            "SELECT 1 AS ok FROM ontology_agent_runs WHERE caller_id=? AND session_id=? AND"
                + " (?::uuid IS NULL OR id=?::uuid)",
            uuid(caller),
            uuid(session),
            run,
            run);
    if (found.isEmpty()) throw AgentHttpException.missing();
  }

  public record Admission(JSONObject run, boolean replayed) {}

  public Admission admit(
      String sessionId,
      String id,
      Owner owner,
      JSONObject input,
      JSONObject request,
      String callerId,
      boolean external,
      int seconds,
      Long credentialExpiry,
      boolean continuation) {
    return transaction(
        () -> {
          JSONObject scope = callerId == null ? null : caller(callerId, owner, true);
          one(
              "SELECT id FROM ontology_agent_sessions WHERE id=? AND domain_id=? AND user_id=? FOR"
                  + " UPDATE",
              uuid(sessionId),
              owner.domainId(),
              owner.userId());
          var prior = rows("SELECT * FROM ontology_agent_runs WHERE id=?", uuid(id));
          if (!prior.isEmpty()) {
            var previous = prior.get(0);
            if (!sessionId.equals(previous.getString("session_id")))
              throw conflict("Run target changed");
            if (previous.getString("input_hash").isEmpty()) throw closed();
            if (!AgentJson.hash(request).equals(previous.getString("input_hash"))
                || !Objects.equals(callerId, previous.getString("caller_id")))
              throw conflict("Run input changed");
            return new Admission(previous, true);
          }
          long deadline = System.currentTimeMillis() + seconds * 1000L;
          if (credentialExpiry != null) deadline = Math.min(deadline, credentialExpiry);
          if (scope != null) {
            if (scope.getBooleanValue("closed")) throw closed();
            deadline =
                Math.min(deadline, Instant.parse(scope.getString("deadline")).toEpochMilli());
            if (continuation
                && rows(
                        "SELECT 1 AS ok FROM ontology_agent_runs WHERE session_id=? AND"
                            + " caller_id=?",
                        uuid(sessionId),
                        uuid(callerId))
                    .isEmpty()
                && !scope
                    .getJSONObject("input")
                    .getJSONArray("continuationIds")
                    .contains(sessionId)) throw AgentHttpException.missing();
          }
          if (deadline <= System.currentTimeMillis()) throw closed();
          var existing = rows("SELECT * FROM ontology_retrievals WHERE id=?", uuid(sessionId));
          JSONArray decisions = new JSONArray();
          int decisionRevision = 0;
          if (!existing.isEmpty()) {
            var r = existing.get(0);
            var old =
                one(
                    "SELECT * FROM ontology_agent_runs WHERE id=? FOR UPDATE",
                    uuid(r.getString("current_run_id")));
            if (old.getBooleanValue("open") && !external)
              throw new AgentHttpException(409, "SESSION_BUSY", "A retrieval run is active");
            if (!continuation) throw conflict("Retrieval already exists");
            if (external)
              update(
                  "UPDATE ontology_agent_runs SET open=false WHERE id=?",
                  uuid(old.getString("id")));
            if (external != old.getBooleanValue("external"))
              throw conflict("Execution owner changed");
            if (!external
                && (!old.getString("id").equals(request.getString("expectedRunId"))
                    || old.getIntValue("decision_revision")
                        != request.getIntValue("expectedDecisionRevision")))
              throw conflict("Retrieval round or decisions changed");
            decisions = r.getJSONArray("decisions");
            decisionRevision = old.getIntValue("decision_revision");
            if (!external) {
              decisions.add(
                  JSONObject.of(
                      "id",
                      UUID.randomUUID().toString(),
                      "runId",
                      old.getString("id"),
                      "text",
                      request.getString("message"),
                      "scope",
                      "task",
                      "source",
                      "user",
                      "supersedesId",
                      null));
              decisionRevision++;
            }
          }
          update(
              "INSERT INTO"
                  + " ontology_agent_runs(id,session_id,input_hash,request,open,deadline,caller_id,external,decision_revision,runtime_admitted)"
                  + " VALUES(?,?,?,?::jsonb,true,?::timestamptz,?,?,?,false)",
              uuid(id),
              uuid(sessionId),
              AgentJson.hash(request),
              AgentJson.json(request),
              Instant.ofEpochMilli(deadline).toString(),
              callerId == null ? null : uuid(callerId),
              external,
              decisionRevision);
          update("UPDATE ontology_agent_runs SET result_after=(SELECT coalesce(max(d.seq),0) FROM ontology_retrieval_deliveries d JOIN ontology_agent_runs r ON r.id=d.run_id WHERE r.session_id=?) WHERE id=?",uuid(sessionId),uuid(id));
          update(
              "INSERT INTO ontology_retrievals(id,input,current_run_id,decisions)"
                  + " VALUES(?,?::jsonb,?,?::jsonb) ON CONFLICT(id) DO UPDATE SET"
                  + " current_run_id=EXCLUDED.current_run_id,decisions=EXCLUDED.decisions,revision=ontology_retrievals.revision+1",
              uuid(sessionId),
              AgentJson.json(input),
              uuid(id),
              AgentJson.json(decisions));
          update(
              "UPDATE ontology_agent_sessions SET title=CASE WHEN title='' THEN ? ELSE title"
                  + " END,updated_at=now() WHERE id=?",
              request.containsKey("message")
                  ? request.getString("message")
                  : input.getString("question"),
              uuid(sessionId));
          return new Admission(run(sessionId, id, owner), false);
        });
  }

  public JSONObject gate(String sessionId, String runId, Owner owner) {
    var run = run(sessionId, runId, owner);
    one("SELECT id FROM ontology_agent_runs WHERE id=? FOR UPDATE", uuid(runId));
    run = run(sessionId, runId, owner);
    if (!run.getBooleanValue("open")
        || Instant.parse(run.getString("deadline")).toEpochMilli() <= System.currentTimeMillis()
        || (RETRIEVER.equals(session(sessionId, owner).getString("agent_id"))
            && !runId.equals(retrieval(sessionId, owner).getString("current_run_id"))))
      throw closed();
    return run;
  }

  public void closeRun(String sessionId, String id, Owner owner) {
    transaction(
        () -> {
          session(sessionId, owner);
          update(
              "INSERT INTO"
                  + " ontology_agent_runs(id,session_id,input_hash,request,open,deadline,external,decision_revision)"
                  + " VALUES(?,?,'','{}',false,now(),false,0) ON CONFLICT(id) DO NOTHING",
              uuid(id),
              uuid(sessionId));
          run(sessionId, id, owner);
          update(
              "UPDATE ontology_agent_runs SET open=false,cancel_requested=true WHERE id=?",
              uuid(id));
          return null;
        });
  }

  public static AgentHttpException closed() {
    return new AgentHttpException(
        409, "RETRIEVAL_RUN_CLOSED", "Retrieval admission or writes are closed");
  }

  public static AgentHttpException conflict(String message) {
    return new AgentHttpException(409, "IDEMPOTENCY_CONFLICT", message);
  }
}
