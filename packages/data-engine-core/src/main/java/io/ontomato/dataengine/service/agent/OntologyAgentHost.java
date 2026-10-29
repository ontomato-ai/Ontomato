package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;

import com.alibaba.fastjson2.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Service;

/** The common agent-host projection; business actions remain in retrieval. */
@Service
public class OntologyAgentHost {
  private final OntologyAgentStore store;
  private final AgentRuntimeClient runtime;
  private final OntologyRetrievalService retrieval;
  private final OntologyGenerationService generation;

  public OntologyAgentHost(
      OntologyAgentStore store,
      AgentRuntimeClient runtime,
      OntologyRetrievalService retrieval,
      OntologyGenerationService generation) {
    this.store = store;
    this.runtime = runtime;
    this.retrieval = retrieval;
    this.generation = generation;
  }

  private boolean isRetrieval(String session, Owner owner) {
    return RETRIEVER.equals(store.session(session, owner).getString("agent_id"));
  }

  private void closeStoppedCallbacks(String session, String run, Owner owner, JSONObject snapshot)
      throws Exception {
    if (isRetrieval(session, owner)) retrieval.closeStoppedCallbacks(session, run, owner, snapshot);
    else if (!"running".equals(snapshot.getJSONObject("run").getString("status")))
      store.update(
          "UPDATE ontology_agent_runs SET open=false,observed_state=?::jsonb WHERE id=?",
          AgentJson.json(snapshot.getJSONObject("run")),
          uuid(run));
  }

  public void delete(String session, Owner owner) throws Exception {
    if (isRetrieval(session, owner)) {
      retrieval.delete(session, owner);
      return;
    }
    for (var row :
        store.rows("SELECT id FROM ontology_agent_runs WHERE session_id=?", uuid(session)))
      generation.close(session, row.getString("id"), owner);
    runtime.json(owner.domainId(), session, "/v1/sessions/" + session, "DELETE", null, null);
    store.transaction(
        () -> {
          store.update(
              "DELETE FROM ontology_generation_tests WHERE run_id IN (SELECT id FROM"
                  + " ontology_agent_runs WHERE session_id=?)",
              uuid(session));
          store.update(
              "DELETE FROM ontology_generations WHERE run_id IN (SELECT id FROM ontology_agent_runs"
                  + " WHERE session_id=?)",
              uuid(session));
          store.update("DELETE FROM ontology_agent_runs WHERE session_id=?", uuid(session));
          store.update("DELETE FROM ontology_agent_sessions WHERE id=?", uuid(session));
          return null;
        });
  }

  public JSONObject agents() {
    return JSONObject.of(
        "agents",
        List.of(
            JSONObject.of(
                "id",
                RETRIEVER,
                "name",
                "Data retrieval",
                "description",
                "Answer a data question using the ontology",
                "icon",
                null,
                "enabled",
                true)));
  }

  public static JSONObject publicRun(JSONObject run) {
    var result = new JSONObject();
    for (String name :
        List.of(
            "id",
            "sessionId",
            "status",
            "stopReason",
            "errorMessage",
            "createdAt",
            "finishedAt",
            "resolvedSkills")) result.put(name, run.get(name));
    return result;
  }

  public static JSONObject publicSnapshot(JSONObject snapshot) {
    var result = new JSONObject();
    for (String name :
        List.of("cursor", "messages", "pendingMessages", "toolExecutions", "artifacts"))
      result.put(name, snapshot.get(name));
    result.put("run", publicRun(snapshot.getJSONObject("run")));
    return result;
  }

  private JSONObject sessionView(JSONObject row, JSONObject run) {
    return JSONObject.of(
        "id",
        row.getString("id"),
        "agentId",
        row.getString("agent_id"),
        "title",
        row.getString("title"),
        "createdAt",
        Instant.parse(row.getString("created_at")).toString(),
        "updatedAt",
        Instant.parse(row.getString("updated_at")).toString(),
        "latestRun",
        run == null ? null : publicRun(run));
  }

  public JSONObject create(String id, String agent, Owner owner) throws Exception {
    if (!RETRIEVER.equals(agent)) throw AgentHttpException.missing();
    boolean replayed = retrieval.createSession(id, owner);
    return JSONObject.of("session", snapshot(id, owner).get("session"), "replayed", replayed);
  }

  public JSONObject snapshot(String id, Owner owner) throws Exception {
    var row = store.session(id, owner);
    if (!row.getBooleanValue("runtime_owned")) throw AgentHttpException.missing();
    var session = runtime.json(owner.domainId(), id, "/v1/sessions/" + id, "GET", null, null);
    var latest = session.getJSONObject("latestRun");
    if (latest != null)
      closeStoppedCallbacks(id, latest.getJSONObject("run").getString("id"), owner, latest);
    return JSONObject.of(
        "session",
        sessionView(row, latest == null ? null : latest.getJSONObject("run")),
        "messages",
        session.get("messages"),
        "latestRun",
        latest == null ? null : publicSnapshot(latest));
  }

  public JSONObject run(String session, String run, Owner owner) throws Exception {
    store.run(session, run, owner);
    var snapshot = runtime.run(owner.domainId(), run);
    closeStoppedCallbacks(session, run, owner, snapshot);
    return publicSnapshot(snapshot);
  }

  public JSONObject start(
      String session, String key, String message, OntologyAgentAccess.Context context)
      throws Exception {
    if (message == null || message.isBlank())
      throw AgentHttpException.invalid("Message is required");
    boolean replayed = retrieval.message(session, key, message, context);
    return JSONObject.of("snapshot", run(session, key, context.owner()), "replayed", replayed);
  }

  public JSONObject cancel(String session, String run, Owner owner) throws Exception {
    store.closeRun(session, run, owner);
    if (!isRetrieval(session, owner)) {
      generation.cancel(session, run, owner);
      return JSONObject.of(
          "run", publicRun(runtime.run(owner.domainId(), run).getJSONObject("run")));
    }
    retrieval.cancelWork(session, run, owner);
    try {
      var snapshot = runtime.run(owner.domainId(), run);
      retrieval.reconcile(session, run, owner, snapshot);
      return JSONObject.of("run", publicRun(snapshot.getJSONObject("run")));
    } catch (AgentHttpException error) {
      if (error.status() != 404) throw error;
      return JSONObject.of("run", null);
    }
  }

  public JSONObject list(String agent, int limit, String cursor, Owner owner) throws Exception {
    if (!RETRIEVER.equals(agent)) throw AgentHttpException.missing();
    if (limit < 1 || limit > 100) throw AgentHttpException.invalid("Limit must be from 1 to 100");
    JSONObject after = null;
    if (cursor != null) {
      try {
        after =
            JSON.parseObject(
                new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8));
        AgentJson.id(after.getString("id"));
        Instant.parse(after.getString("updatedAt"));
        if (!agent.equals(after.getString("agentId"))) throw new IllegalArgumentException();
      } catch (RuntimeException e) {
        throw AgentHttpException.invalid("Invalid session cursor");
      }
    }
    var rows =
        store.rows(
            "SELECT * FROM ontology_agent_sessions WHERE runtime_owned=true AND user_id=? AND"
                + " domain_id=? AND agent_id=? AND (?::timestamptz IS NULL OR"
                + " (updated_at,id)<(?::timestamptz,?::uuid)) ORDER BY updated_at DESC,id DESC"
                + " LIMIT ?",
            owner.userId(),
            owner.domainId(),
            uuid(agent),
            after == null ? null : after.getString("updatedAt"),
            after == null ? null : after.getString("updatedAt"),
            after == null ? null : after.getString("id"),
            limit + 1);
    var result = new JSONArray();
    var selected = rows.subList(0, Math.min(limit, rows.size()));
    for (var row : selected) result.add(snapshot(row.getString("id"), owner).get("session"));
    String next = null;
    if (rows.size() > limit) {
      var last = selected.get(selected.size() - 1);
      next =
          Base64.getUrlEncoder()
              .withoutPadding()
              .encodeToString(
                  AgentJson.json(
                          JSONObject.of(
                              "id",
                              last.getString("id"),
                              "updatedAt",
                              last.getString("updated_at"),
                              "agentId",
                              agent))
                      .getBytes(StandardCharsets.UTF_8));
    }
    return JSONObject.of("sessions", result, "nextCursor", next);
  }

  public JSONObject artifact(String session, String artifact, Owner owner) throws Exception {
    store.session(session, owner);
    var value =
        runtime.json(owner.domainId(), artifact, "/v1/artifacts/" + artifact, "GET", null, null);
    if (!session.equals(value.getString("sessionId"))) throw AgentHttpException.missing();
    return value;
  }

  public JSONObject resolve(String session, String run, String path, Owner owner) throws Exception {
    store.run(session, run, owner);
    var values =
        runtime
            .json(
                owner.domainId(),
                run,
                "/v1/runs/"
                    + run
                    + "/artifacts?path="
                    + java.net.URLEncoder.encode(path, StandardCharsets.UTF_8),
                "GET",
                null,
                null)
            .getJSONArray("artifacts");
    return JSONObject.of("artifact", values.isEmpty() ? null : values.get(values.size() - 1));
  }
}
