package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.service.*;
import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/** Retrieval orchestration lives with the ontology query and permission owners. */
@Service
public class OntologyRetrievalService {
  private final OntologyAgentStore store;
  private final AgentRuntimeClient runtime;
  private final OntologyAgentDefinitions definitions;
  private final OntologyQueryService ontology;
  private final QueryGrantService grants;
  private final QueryOutputService outputs;
  private final QueryJobService jobs;
  private final QueryQualityService quality;
  private final OntologyAgentAccess access;

  private record AdmissionFlight(Owner owner, String hash, CompletableFuture<JSONObject> result) {}

  private final ConcurrentMap<String, AdmissionFlight> preparing = new ConcurrentHashMap<>();
  private final Set<String> observing = ConcurrentHashMap.newKeySet();
  private final ExecutorService workers = Executors.newCachedThreadPool();
  private static final org.slf4j.Logger LOG =
      org.slf4j.LoggerFactory.getLogger(OntologyRetrievalService.class);

  public OntologyRetrievalService(
      OntologyAgentStore store,
      AgentRuntimeClient runtime,
      OntologyAgentDefinitions definitions,
      OntologyQueryService ontology,
      QueryGrantService grants,
      QueryOutputService outputs,
      QueryJobService jobs,
      QueryQualityService quality,
      OntologyAgentAccess access) {
    this.store = store;
    this.runtime = runtime;
    this.definitions = definitions;
    this.ontology = ontology;
    this.grants = grants;
    this.outputs = outputs;
    this.jobs = jobs;
    this.quality = quality;
    this.access = access;
  }

  private JSONObject admitOnce(
      String runId,
      String sessionId,
      Object request,
      OntologyAgentAccess.Context context,
      Callable<JSONObject> operation)
      throws Exception {
    return admitOnce(
        runId,
        sessionId,
        request,
        context,
        new java.util.concurrent.atomic.AtomicBoolean(),
        operation);
  }

  private JSONObject admitOnce(
      String runId,
      String sessionId,
      Object request,
      OntologyAgentAccess.Context context,
      java.util.concurrent.atomic.AtomicBoolean replayed,
      Callable<JSONObject> operation)
      throws Exception {
    String hash =
        AgentJson.hash(
            JSONObject.of(
                "sessionId", sessionId, "request", request, "callerId", context.callerId()));
    var flight = new AdmissionFlight(context.owner(), hash, new CompletableFuture<>());
    var old = preparing.putIfAbsent(runId, flight);
    if (old != null) {
      replayed.set(true);
      if (!old.owner().equals(context.owner())) throw AgentHttpException.missing();
      if (!old.hash().equals(hash)) throw conflict("Admission input changed");
      try {
        return old.result().get();
      } catch (ExecutionException error) {
        if (error.getCause() instanceof Exception cause) throw cause;
        throw error;
      }
    }
    try {
      var result = operation.call();
      flight.result().complete(result);
      return result;
    } catch (Exception error) {
      flight.result().completeExceptionally(error);
      throw error;
    } finally {
      preparing.remove(runId, flight);
    }
  }

  public static int timeout(JSONObject body) {
    Object value = body.getOrDefault("timeoutSeconds", 600);
    if (!(value instanceof Number n)
        || n.doubleValue() != n.intValue()
        || n.intValue() < 1
        || n.intValue() > 600)
      throw AgentHttpException.invalid("timeoutSeconds must be an integer from 1 to 600");
    return ((Number) value).intValue();
  }

  public static JSONObject input(JSONObject body) {
    AgentJson.fields(
        body,
        "question",
        "userQuotes",
        "classNames",
        "previousDatasetIds",
        "interaction",
        "timeoutSeconds");
    var result = AgentJson.copy(body);
    result.put("question", AgentJson.text(body, "question").trim());
    for (String key : List.of("userQuotes", "previousDatasetIds"))
      result.putIfAbsent(key, new JSONArray());
    result.putIfAbsent("interaction", "resumable");
    if (!List.of("resumable", "non_interactive").contains(result.getString("interaction")))
      throw AgentHttpException.invalid("Invalid interaction");
    for (String key : List.of("userQuotes", "previousDatasetIds", "classNames")) {
      if (!result.containsKey(key)) continue;
      if (!(result.get(key) instanceof java.util.List<?> list)
          || list.stream().anyMatch(v -> !(v instanceof String)))
        throw AgentHttpException.invalid(key + " must be a string array");
    }
    for (String id : result.getList("previousDatasetIds", String.class)) AgentJson.id(id);
    result.put("timeoutSeconds", timeout(body));
    return result;
  }

  private JSONObject scopedInput(JSONObject body, OntologyAgentAccess.Context context) {
    var input = input(body);
    if (context.callerId() != null) {
      var caller = store.caller(context.callerId(), context.owner(), false);
      if (caller.getBooleanValue("closed")) throw closed();
      var allowed = caller.getJSONObject("input").getList("classNames", String.class);
      if (!allowed.isEmpty()) {
        var requested = input.getList("classNames", String.class);
        if (requested != null && !allowed.containsAll(requested))
          throw new AgentHttpException(403, "FORBIDDEN", "Class scope cannot be widened");
        input.put("classNames", requested == null || requested.isEmpty() ? allowed : requested);
      }
    }
    return input;
  }

  public boolean createSession(String id, Owner owner) throws Exception {
    boolean replayed = store.createSession(id, owner, RETRIEVER);
    try {
      runtime.json(owner.domainId(), id, "/v1/sessions", "POST", Map.of(), id);
    } catch (AgentHttpException error) {
      if (error.status() != 410) throw error;
      store.update(
          "DELETE FROM ontology_agent_sessions s WHERE id=? AND NOT EXISTS(SELECT 1 FROM"
              + " ontology_agent_runs r WHERE r.session_id=s.id)",
          uuid(id));
      throw AgentHttpException.missing();
    }
    return replayed;
  }

  public JSONObject start(String id, JSONObject body, OntologyAgentAccess.Context context)
      throws Exception {
    var input = scopedInput(body, context);
    for (String previous : input.getList("previousDatasetIds", String.class))
      datasetForOwner(previous, context.owner());
    String runId =
        UUID.nameUUIDFromBytes(("ontology-retrieval:" + id).getBytes(StandardCharsets.UTF_8))
            .toString();
    return admitOnce(
        runId,
        id,
        input,
        context,
        () -> {
          createSession(id, context.owner());
          var admission =
              store.admit(
                  id,
                  runId,
                  context.owner(),
                  input,
                  input,
                  context.callerId(),
                  false,
                  timeout(input),
                  context.expiresAt(),
                  false);
          if (!admission.replayed()) prepare(id, runId, context);
          return snapshot(id, runId, context.owner());
        });
  }

  public JSONObject answer(
      String id, String key, JSONObject body, OntologyAgentAccess.Context context)
      throws Exception {
    return admitOnce(key, id, body, context, () -> answerWork(id, key, body, context));
  }

  private JSONObject answerWork(
      String id, String key, JSONObject body, OntologyAgentAccess.Context context)
      throws Exception {
    AgentJson.fields(
        body, "expectedRunId", "expectedDecisionRevision", "message", "timeoutSeconds");
    AgentJson.id(body.getString("expectedRunId"));
    AgentJson.text(body, "message");
    if (!(body.get("expectedDecisionRevision") instanceof Number revision)
        || revision.intValue() < 0
        || revision.doubleValue() != revision.intValue())
      throw AgentHttpException.invalid("Invalid decision revision");
    var request = AgentJson.copy(body);
    request.put("timeoutSeconds", timeout(body));
    if (store
        .rows("SELECT id FROM ontology_agent_runs WHERE id=? AND session_id=?", uuid(key), uuid(id))
        .isEmpty()) {
      var previous = get(id, context.owner());
      if (previous.getJSONObject("run") == null
          || !"stopped".equals(previous.getJSONObject("run").getString("status")))
        throw new AgentHttpException(409, "SESSION_BUSY", "A retrieval run is active");
    }
    var original = store.retrieval(id, context.owner()).getJSONObject("input");
    if (context.callerId() != null) {
      var allowed =
          store
              .caller(context.callerId(), context.owner(), false)
              .getJSONObject("input")
              .getList("classNames", String.class);
      var originalClasses = original.getList("classNames", String.class);
      if (!allowed.isEmpty()
          && (originalClasses == null
              || originalClasses.isEmpty()
              || !allowed.containsAll(originalClasses)))
        throw new AgentHttpException(
            403, "FORBIDDEN", "The prior retrieval exceeds this caller scope");
    }

    var accepted =
        store.admit(
            id,
            key,
            context.owner(),
            original,
            request,
            context.callerId(),
            false,
            timeout(request),
            context.expiresAt(),
            true);
    if (!accepted.replayed()) prepare(id, key, context);
    return snapshot(id, key, context.owner());
  }

  public boolean message(
      String session, String key, String message, OntologyAgentAccess.Context context)
      throws Exception {
    var replayed = new java.util.concurrent.atomic.AtomicBoolean();
    admitOnce(
        key,
        session,
        JSONObject.of("message", message),
        context,
        replayed,
        () -> {
          store.session(session, context.owner());
          var existing =
              store.rows(
                  "SELECT * FROM ontology_agent_runs WHERE id=? AND session_id=?",
                  uuid(key),
                  uuid(session));
          if (!existing.isEmpty()) {
            replayed.set(true);
            if (existing.get(0).getString("input_hash").isEmpty()) throw closed();
            if (!message.equals(existing.get(0).getJSONObject("request").getString("message"))
                || !Objects.equals(context.callerId(), existing.get(0).getString("caller_id")))
              throw conflict("Message input changed");
            return snapshot(session, key, context.owner());
          }
          var records = store.rows("SELECT * FROM ontology_retrievals WHERE id=?", uuid(session));
          if (!records.isEmpty()) {
            var latest = get(session, context.owner());
            return answerWork(
                session,
                key,
                JSONObject.of(
                    "expectedRunId",
                    latest.getString("runtimeRunId"),
                    "expectedDecisionRevision",
                    latest.getIntValue("decisionRevision"),
                    "message",
                    message),
                context);
          }
          var input = scopedInput(JSONObject.of("question", message), context);

          store.admit(
              session,
              key,
              context.owner(),
              input,
              JSONObject.of("message", message, "timeoutSeconds", 600),
              context.callerId(),
              false,
              600,
              context.expiresAt(),
              false);
          prepare(session, key, context);
          return snapshot(session, key, context.owner());
        });
    return replayed.get();
  }

  public JSONObject begin(String key, JSONObject body, OntologyAgentAccess.Context context) {
    String existing = body.getString("retrievalId");
    var copy = AgentJson.copy(body);
    copy.remove("retrievalId");
    var input = scopedInput(copy, context);
    String id = existing == null ? key : AgentJson.id(existing);
    store.createSession(id, context.owner(), RETRIEVER, false);
    var a =
        store.admit(
            id,
            key,
            context.owner(),
            input,
            input,
            null,
            true,
            timeout(input),
            context.expiresAt(),
            existing != null);
    return JSONObject.of(
        "id", id, "sessionId", id, "runId", key, "expiresAt", a.run().getString("deadline"));
  }

  private void prepare(String id, String runId, OntologyAgentAccess.Context context)
      throws Exception {
    try {
      var record = store.retrieval(id, context.owner());
      var input = record.getJSONObject("input");
      var row = store.run(id, runId, context.owner());
      long deadline = Instant.parse(row.getString("deadline")).toEpochMilli();
      String grant =
          access.exploration(
              context, id, id, runId, deadline, input.getList("classNames", String.class));
      var prior = new JSONArray();
      var ids = new LinkedHashSet<>(input.getList("previousDatasetIds", String.class));
      for (var old :
          store.rows(
              "SELECT dataset_ids FROM ontology_agent_runs WHERE session_id=? AND id<>? ORDER BY"
                  + " created_at",
              uuid(id),
              uuid(runId))) ids.addAll(old.getList("dataset_ids", String.class));
      for (String artifact : ids) {
        var data = datasetForOwner(artifact, context.owner()).getJSONObject("payload");
        prior.add(
            JSONObject.of(
                "id",
                artifact,
                "title",
                data.getString("title"),
                "recipe",
                data.get("recipe"),
                "assumptions",
                data.get("assumptions")));
      }
      var metrics =
          JSONObject.from(
              ontology.metrics(
                  JSONObject.of(
                      "query",
                      input.getString("question"),
                      "limit",
                      10,
                      "cursor",
                      null,
                      "classNames",
                      input.getOrDefault("classNames", new JSONArray())),
                  context.access()));
      var knowledge =
          JSONObject.from(
              ontology.knowledge(
                  JSONObject.of("query", input.getString("question"), "limit", 10),
                  context.access()));
      var user =
          JSONObject.of(
              "question",
              input.getString("question"),
              "userQuotes",
              input.get("userQuotes"),
              "overview",
              ontology.overview(context.access()),
              "knowledge",
              knowledge.get("items"),
              "metrics",
              metrics.get("items"),
              "moreMetrics",
              metrics.get("nextCursor"),
              "previousDatasets",
              prior,
              "decisions",
              record.get("decisions"),
              "answer",
              row.getJSONObject("request").getString("message"));
      definitions.publish();
      var values =
          JSONObject.of(
              "ONTOMATO_ONTOLOGY_URL", runtime.ontologyUrl(), "ONTOMATO_RETRIEVAL_ID", id);
      var secrets =
          JSONObject.of(
              "ONTOMATO_QUERY_TK",
              grant,
              "ONTOMATO_TK",
              context.token() == null ? "" : context.token());
      if (context.apiKey() != null) secrets.put("ONTOMATO_API_KEY", context.apiKey());
      store.transaction(() -> store.gate(id, runId, context.owner()));
      runtime.json(
          context.owner().domainId(),
          runId,
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
                  AgentJson.json(user),
                  "timestamp",
                  Instant.parse(row.getString("created_at")).toEpochMilli()),
              "definition",
              definitions.definition(context.language(), deadline - System.currentTimeMillis()),
              "environment",
              JSONObject.of("values", values, "secrets", secrets),
              "modelCredential",
              context.modelCredential()),
          runId);
    } catch (Exception failure) {
      try {
        runtime.run(context.owner().domainId(), runId);
      } catch (AgentHttpException absent) {
        if (absent.status() == 404) {
          store.closeRun(id, runId, context.owner());
          runtime.json(
              context.owner().domainId(),
              runId,
              "/v1/sessions/" + id + "/run-intents/" + runId + "/cancel",
              "POST",
              Map.of(),
              null);
          grants.revoke(context.owner().domainId(), runId);
        }
      } catch (Exception unavailable) {
        failure.addSuppressed(unavailable);
      }
      throw failure;
    }
  }

  public JSONObject get(String id, Owner owner) throws Exception {
    return snapshot(id, store.retrieval(id, owner).getString("current_run_id"), owner);
  }

  public JSONObject snapshot(String id, String runId, Owner owner) throws Exception {
    return snapshot(id, runId, owner, true);
  }

  private JSONObject snapshot(String id, String runId, Owner owner, boolean observe)
      throws Exception {
    var record = store.retrieval(id, owner);
    var row = store.run(id, runId, owner);
    JSONObject state = null;
    JSONArray messages = new JSONArray();
    if (!row.getBooleanValue("external")) {
      var snapshot = runtime.run(owner.domainId(), runId);
      if (observe) reconcile(id, runId, owner, snapshot);
      state = state(snapshot.getJSONObject("run"));
      messages = snapshot.getJSONArray("messages");
      row = store.run(id, runId, owner);
    }
    var result =
        JSONObject.of(
            "id",
            id,
            "revision",
            record.getIntValue("revision"),
            "runtimeSessionId",
            row.getBooleanValue("external") ? null : id,
            "runtimeRunId",
            row.getBooleanValue("external") ? null : runId,
            "run",
            state,
            "messages",
            messages,
            "datasetArtifactIds",
            row.getJSONArray("dataset_ids"),
            "decisionRevision",
            row.getIntValue("decision_revision"));
    if (row.getString("qc_id") != null) {
      try {
        result.put("qualityCheck", jobs.get(row.getString("qc_id"), subject(owner), "quality"));
      } catch (org.springframework.web.server.ResponseStatusException absent) {
        if (absent.getStatusCode().value() != 404) throw absent;
      }
    }
    return result;
  }

  public JSONObject evidence(String id, String runId, Owner owner) throws Exception {
    return JSONObject.of(
        "input",
        store.retrieval(id, owner).get("input"),
        "snapshot",
        snapshot(id, runId, owner, false));
  }

  private static JSONObject state(JSONObject run) {
    return JSONObject.of(
        "status",
        run.get("status"),
        "stopReason",
        run.get("stopReason"),
        "errorMessage",
        run.get("errorMessage"));
  }

  public void closeStoppedCallbacks(String id, String runId, Owner owner, JSONObject snapshot) {
    if ("stopped".equals(snapshot.getJSONObject("run").getString("status"))) {
      store.run(id, runId, owner);
      store.update("UPDATE ontology_agent_runs SET open=false WHERE id=?", uuid(runId));
    }
  }

  public void reconcile(String id, String runId, Owner owner, JSONObject snapshot)
      throws Exception {
    closeStoppedCallbacks(id, runId, owner, snapshot);
    var accepted = new LinkedHashMap<String, String>();
    for (Object item : snapshot.getJSONArray("artifacts")) {
      var file = JSONObject.from(item);
      if (!runId.equals(file.getString("runId"))
          || !file.getString("path").endsWith(".dataset.json")) continue;
      JSONObject value;
      try {
        value =
            JSON.parseObject(
                new String(
                    runtime.bytes(
                        owner.domainId(),
                        runId,
                        "/v1/artifacts/" + file.getString("id") + "/content"),
                    StandardCharsets.UTF_8));
      } catch (JSONException invalid) {
        continue;
      }
      if (value == null || value.getJSONObject("execution") == null) continue;
      var receipts =
          store.rows(
              "SELECT id FROM ontology_retrieval_outputs WHERE run_id=? AND receipt_id::text=? AND"
                  + " dataset_digest=?",
              uuid(runId),
              value.getJSONObject("execution").getString("receiptId"),
              AgentJson.hash(value));
      if (!receipts.isEmpty()) {
        store.update(
            "INSERT INTO ontology_retrieval_artifacts(artifact_id,output_id,run_id,path)"
                + " VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
            uuid(file.getString("id")),
            uuid(receipts.get(0).getString("id")),
            uuid(runId),
            file.getString("path"));
        accepted.put(file.getString("path"), file.getString("id"));
      }
    }
    var current = state(snapshot.getJSONObject("run"));
    boolean stopped = "stopped".equals(current.getString("status"));
    store.transaction(
        () -> {
          var row = store.run(id, runId, owner);
          if (!Objects.equals(
                  AgentJson.json(row.get("dataset_ids")), AgentJson.json(accepted.values()))
              || !Objects.equals(
                  AgentJson.json(row.get("observed_state")), AgentJson.json(current))) {
            store.update(
                "UPDATE ontology_agent_runs SET"
                    + " dataset_ids=?::jsonb,observed_state=?::jsonb,open=CASE WHEN ? THEN false"
                    + " ELSE open END WHERE id=?",
                AgentJson.json(accepted.values()),
                AgentJson.json(current),
                stopped,
                uuid(runId));
            store.update(
                "UPDATE ontology_retrievals SET revision=revision+1 WHERE id=? AND"
                    + " current_run_id=?",
                uuid(id),
                uuid(runId));
          }
          return null;
        });
    if (stopped) {
      grants.revoke(owner.domainId(), runId);
      if ("stop".equals(current.getString("stopReason")) && !accepted.isEmpty())
        scheduleQuality(id, runId, owner);
    }
  }

  public JSONObject cancel(String id, String runId, Owner owner) throws Exception {
    store.closeRun(id, runId, owner);
    cancelWork(id, runId, owner);
    return get(id, owner);
  }

  public void cancelWork(String id, String runId, Owner owner) throws Exception {
    var row = store.run(id, runId, owner);
    if (!row.getBooleanValue("external")) {
      try {
        var existing = runtime.run(owner.domainId(), runId);
        if ("stopped".equals(existing.getJSONObject("run").getString("status"))
            && "stop".equals(existing.getJSONObject("run").getString("stopReason"))) {
          reconcile(id, runId, owner, existing);
          store.update(
              "UPDATE ontology_agent_runs SET cancel_confirmed=true WHERE id=?", uuid(runId));
          return;
        }
      } catch (Exception unavailable) {
        LOG.debug("Cancel reconciles the original runtime intent: {}", runId, unavailable);
      }
    }
    var failures = new ArrayList<Exception>();
    if (!row.getBooleanValue("external"))
      try {
        runtime.json(
            owner.domainId(),
            runId,
            "/v1/sessions/" + id + "/run-intents/" + runId + "/cancel",
            "POST",
            Map.of(),
            null);
      } catch (Exception error) {
        failures.add(error);
      }
    try {
      grants.revoke(owner.domainId(), runId);
    } catch (Exception error) {
      failures.add(error);
    }
    var user = subject(owner);
    for (var output :
        store.rows("SELECT id FROM ontology_retrieval_outputs WHERE run_id=?", uuid(runId)))
      try {
        jobs.cancel(output.getString("id"), user, "output");
      } catch (Exception error) {
        failures.add(error);
      }
    if (row.getString("qc_id") != null)
      try {
        jobs.cancel(row.getString("qc_id"), user, "quality");
      } catch (Exception error) {
        failures.add(error);
      }
    if (!failures.isEmpty()) {
      Exception first = failures.remove(0);
      failures.forEach(first::addSuppressed);
      throw first;
    }
    store.update("UPDATE ontology_agent_runs SET cancel_confirmed=true WHERE id=?", uuid(runId));
  }

  private static QueryAccessService.GrantUser subject(Owner owner) {
    return new QueryAccessService.GrantUser(owner.userId(), owner.domainId());
  }

  public void closeCaller(String id, Owner owner) throws Exception {
    store.closeCaller(id, owner);
    // Retry unfinished cancellation even when the scope was already closed.
    for (var link : store.callerRuns(id, owner)) {
      String session = link.getString("retrievalId"), run = link.getString("runId");
      if (run.equals(store.retrieval(session, owner).getString("current_run_id")))
        cancelWork(session, run, owner);
    }
  }

  public JSONObject prepareOutput(
      String id, String runId, String key, JSONObject body, OntologyAgentAccess.Context context) {
    DatasetFileContract.preparation(body);
    var recipe = body.getJSONObject("recipe");
    if ("python".equals(recipe.getString("kind"))
        && !QueryOutputService.hash(AgentJson.text(recipe, "code"))
            .equals(recipe.getString("sha256")))
      throw AgentHttpException.invalid("Recipe digest mismatch");
    store.transaction(
        () -> {
          store.gate(id, runId, context.owner());
          var decisions = store.retrieval(id, context.owner()).getJSONArray("decisions");
          for (String decision : body.getList("decisionIds", String.class))
            if (decisions.stream()
                .map(JSONObject::from)
                .noneMatch(d -> decision.equals(d.getString("id"))))
              throw AgentHttpException.invalid("Unknown decision");
          store.update(
              "INSERT INTO ontology_retrieval_outputs(id,run_id,input_hash,request)"
                  + " VALUES(?,?,?,?::jsonb) ON CONFLICT DO NOTHING",
              uuid(key),
              uuid(runId),
              AgentJson.hash(body),
              AgentJson.json(body));
          var previous =
              store.one("SELECT * FROM ontology_retrieval_outputs WHERE id=?", uuid(key));
          if (!runId.equals(previous.getString("run_id"))
              || !AgentJson.hash(body).equals(previous.getString("input_hash")))
            throw conflict("Output input changed");
          return null;
        });
    var jobInput =
        JSONObject.of("submissionId", key, "recipe", recipe, "outKeyRefs", body.get("outKeyRefs"));
    jobs.start(
        key,
        context.access().user(),
        "output",
        jobInput,
        session ->
            outputs.execute(
                session,
                AgentJson.copy(recipe),
                body.getJSONArray("outKeyRefs"),
                context.access(),
                context.language()));
    return JSONObject.of("id", key);
  }

  public JSONObject output(String id, String runId, String key, Owner owner) {
    store.run(id, runId, owner);
    var row =
        store.one(
            "SELECT * FROM ontology_retrieval_outputs WHERE id=? AND run_id=?",
            uuid(key),
            uuid(runId));
    var job = jobs.get(key, subject(owner), "output");
    if ("running".equals(job.getString("status")))
      return JSONObject.of("id", key, "running", true, "dataset", null, "error", null);
    if (!"completed".equals(job.getString("status")))
      return JSONObject.of("id", key, "running", false, "dataset", null, "error", job.get("error"));
    var data = AgentJson.copy(row.getJSONObject("request"));
    var result = AgentJson.copy(job.getJSONObject("result"));
    var execution =
        JSONObject.of(
            "receiptId", result.remove("receiptId"), "executedAt", result.remove("executedAt"));
    data.putAll(result);
    data.put("schema", "workbench.dataset.v1");
    data.put("execution", execution);
    validateDataset(data);
    store.transaction(
        () -> {
          if (row.getString("dataset_digest") == null) store.gate(id, runId, owner);
          store.update(
              "UPDATE ontology_retrieval_outputs SET dataset_digest=?,receipt_id=? WHERE id=?",
              AgentJson.hash(data),
              uuid(execution.getString("receiptId")),
              uuid(key));
          return null;
        });
    return JSONObject.of("id", key, "running", false, "dataset", data, "error", null);
  }

  static void validateDataset(JSONObject data) {
    var keys = new HashSet<String>();
    for (Object c : data.getJSONArray("columns"))
      if (!keys.add(JSONObject.from(c).getString("key")))
        throw AgentHttpException.invalid("Duplicate dataset column");
    var refs = new HashSet<String>();
    for (Object r : data.getJSONArray("outKeyRefs")) refs.add(JSONObject.from(r).getString("key"));
    if (!keys.equals(refs)) throw AgentHttpException.invalid("Dataset source keys differ");
    for (Object r : data.getJSONArray("rows"))
      if (!JSONObject.from(r).keySet().equals(keys))
        throw AgentHttpException.invalid("Dataset row keys differ");
  }

  public JSONObject dataset(String id, String artifact, Owner owner) throws Exception {
    store.retrieval(id, owner);
    var row =
        store.one(
            "SELECT o.dataset_digest FROM ontology_retrieval_artifacts a JOIN"
                + " ontology_retrieval_outputs o ON o.id=a.output_id JOIN ontology_agent_runs r ON"
                + " r.id=a.run_id WHERE r.session_id=? AND a.artifact_id=?",
            uuid(id),
            uuid(artifact));
    var data =
        JSON.parseObject(
            new String(
                runtime.bytes(owner.domainId(), artifact, "/v1/artifacts/" + artifact + "/content"),
                StandardCharsets.UTF_8));
    if (!AgentJson.hash(data).equals(row.getString("dataset_digest")))
      throw new AgentHttpException(
          503, "DEPENDENCY_UNAVAILABLE", "Dataset receipt differs from its file");
    return JSONObject.of("id", artifact, "payload", data);
  }

  private JSONObject datasetForOwner(String artifact, Owner owner) throws Exception {
    var row =
        store.one(
            "SELECT r.session_id FROM ontology_retrieval_artifacts a JOIN"
                + " ontology_retrieval_outputs o ON o.id=a.output_id JOIN ontology_agent_runs r ON"
                + " r.id=a.run_id JOIN ontology_agent_sessions s ON s.id=r.session_id WHERE"
                + " a.artifact_id=? AND s.user_id=? AND s.domain_id=?",
            uuid(artifact),
            owner.userId(),
            owner.domainId());
    return dataset(row.getString("session_id"), artifact, owner);
  }

  private void scheduleQuality(String id, String runId, Owner owner) throws Exception {
    var row = store.run(id, runId, owner);
    String qc = row.getString("qc_id");
    if (qc == null) {
      store.update(
          "UPDATE ontology_agent_runs SET qc_id=? WHERE id=? AND qc_id IS NULL",
          UUID.randomUUID(),
          uuid(runId));
      qc = store.run(id, runId, owner).getString("qc_id");
    }
    var programs = new JSONArray();
    var recipes = new JSONArray();
    for (String artifact : row.getList("dataset_ids", String.class)) {
      var d = dataset(id, artifact, owner).getJSONObject("payload");
      var recipe = d.getJSONObject("recipe");
      programs.add(
          JSONObject.of(
              "question",
              d.getString("question"),
              "code",
              "python".equals(recipe.getString("kind"))
                  ? recipe.getString("code")
                  : recipe.getString("executedCode"),
              "outKeyRefs",
              d.get("outKeyRefs")));
      recipes.add(recipe);
    }
    var input = store.retrieval(id, owner).getJSONObject("input");
    quality.start(
        JSONObject.of(
            "id",
            qc,
            "question",
            input.getString("question"),
            "programs",
            programs,
            "recipes",
            recipes,
            "classNames",
            input.getOrDefault("classNames", List.of())),
        subject(owner),
        "en");
    store.update("UPDATE ontology_agent_runs SET qc_admitted=true WHERE id=?", uuid(runId));
  }

  @Scheduled(fixedDelay = 500)
  public void recover() {
    for (var row :
        store.rows(
            "SELECT r.*,s.user_id,s.domain_id FROM ontology_agent_runs r JOIN"
                + " ontology_agent_sessions s ON s.id=r.session_id WHERE s.agent_id='"
                + RETRIEVER
                + "'::uuid AND r.input_hash<>'' AND"
                + " (r.open=true OR (r.external=false AND r.cancel_requested=false AND"
                + " (r.observed_state IS NULL OR r.observed_state->>'status'<>'stopped')) OR"
                + " (r.cancel_requested=true AND r.cancel_confirmed=false AND"
                + " (r.observed_state IS NULL OR r.observed_state->>'status'<>'stopped')) OR"
                + " (r.observed_state->>'status'='stopped' AND"
                + " r.observed_state->>'stopReason'='stop' AND jsonb_array_length(r.dataset_ids)>0"
                + " AND r.qc_admitted=false))")) {
      String id = row.getString("id");
      if (preparing.containsKey(id) || !observing.add(id)) continue;
      workers.submit(
          () -> {
            try (var ignored = io.ontomato.dataengine.logging.ServiceLogContext.open(java.util.Map.of(
                "userId", row.getString("user_id"), "domainId", row.getString("domain_id"),
                "runId", id, "sessionId", row.getString("session_id"),
                "correlationId", io.ontomato.dataengine.logging.ServiceLogContext.correlation(
                    row.getJSONObject("observed_state") == null ? null : row.getJSONObject("observed_state").getString("correlationId"))))) {
              var owner = owner(row);
              String session = row.getString("session_id");
              if (row.getBooleanValue("external")) {
                if (row.getBooleanValue("cancel_requested")
                    || Instant.parse(row.getString("deadline")).toEpochMilli()
                        < System.currentTimeMillis()) {
                  store.closeRun(session, id, owner);
                  cancelWork(session, id, owner);
                }
                return;
              }
              if (row.getBooleanValue("cancel_requested")) cancelWork(session, id, owner);
              var snapshot = runtime.run(owner.domainId(), id);
              io.ontomato.dataengine.logging.ServiceLogContext.put("correlationId", snapshot.getJSONObject("run").getString("correlationId"));
              reconcile(session, id, owner, snapshot);
              if ("running".equals(snapshot.getJSONObject("run").getString("status"))
                  && Instant.parse(row.getString("deadline")).toEpochMilli()
                      <= System.currentTimeMillis()) {
                store.closeRun(session, id, owner);
                cancelWork(session, id, owner);
              }
            } catch (AgentHttpException error) {
              if (error.status() == 404) {
                try {
                  store.closeRun(row.getString("session_id"), id, owner(row));
                  cancelWork(row.getString("session_id"), id, owner(row));
                } catch (Exception failure) {
                  LOG.warn("Retrieval cancellation awaits reconciliation: {}", id, failure);
                }
              } else LOG.warn("Retrieval observation awaits reconciliation: {}", id, error);
            } catch (Exception error) {
              LOG.warn("Retrieval observation awaits reconciliation: {}", id, error);
            } finally {
              observing.remove(id);
            }
          });
    }
  }

  public void delete(String id, Owner owner) throws Exception {
    store.session(id, owner);
    if (!store
        .rows("SELECT id FROM ontology_agent_runs WHERE session_id=? AND open=true", uuid(id))
        .isEmpty()) throw new AgentHttpException(409, "SESSION_BUSY", "A run is active");
    try {
      if (store.session(id, owner).getBooleanValue("runtime_owned"))
        runtime.text(owner.domainId(), id, "/v1/sessions/" + id, "DELETE", null, null);
    } catch (AgentHttpException error) {
      if (error.status() != 404 && error.status() != 410) throw error;
    }
    store.transaction(
        () -> {
          store.update(
              "DELETE FROM ontology_retrieval_artifacts WHERE run_id IN(SELECT id FROM"
                  + " ontology_agent_runs WHERE session_id=?)",
              uuid(id));
          store.update(
              "DELETE FROM ontology_retrieval_outputs WHERE run_id IN(SELECT id FROM"
                  + " ontology_agent_runs WHERE session_id=?)",
              uuid(id));
          store.update("DELETE FROM ontology_retrievals WHERE id=?", uuid(id));
          store.update("DELETE FROM ontology_agent_runs WHERE session_id=?", uuid(id));
          store.update("DELETE FROM ontology_agent_sessions WHERE id=?", uuid(id));
          return null;
        });
  }

  @PreDestroy
  public void shutdown() {
    workers.shutdownNow();
  }
}
