package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
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
  private final RetrievalResults results;
  private final AgentChannelRuns channel;
  private final AgentChannelChanges changes;
  private final Set<String> launching = ConcurrentHashMap.newKeySet();

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
      OntologyAgentAccess access, RetrievalResults results, AgentChannelRuns channel,AgentChannelChanges changes) {
    this.store = store;
    this.runtime = runtime;
    this.definitions = definitions;
    this.ontology = ontology;
    this.grants = grants;
    this.outputs = outputs;
    this.jobs = jobs;
    this.quality = quality;
    this.access = access;
    this.results = results;
    this.channel = channel;
    this.changes=changes;
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
    List<String> configured = List.of();
    if (context.callerId() != null) {
      var caller = store.caller(context.callerId(), context.owner(), false);
      if (caller.getBooleanValue("closed")) throw closed();
      var callerInput = caller.getJSONObject("input");
      configured = callerInput.getList("classNames", String.class);
      // The host owns the user's words; the model-supplied quotes never win in a caller scope.
      OntologyAgentStore.applyCallerUserQuotes(input, callerInput);
    }

    var parent = context.access().classNames();
    var permission = context.access().permission();
    var requested = input.getList("classNames", String.class);
    if (requested != null && !requested.isEmpty()) {
      if ((!configured.isEmpty() && !configured.containsAll(requested))
          || (!parent.isEmpty() && !parent.containsAll(requested)))
        throw new AgentHttpException(403, "FORBIDDEN", "Class scope cannot be widened");
      var unreadable = unreadableClasses(requested, permission);
      if (!unreadable.isEmpty())
        throw new AgentHttpException(403, "FORBIDDEN",
            "Execution user has no read permission for: " + String.join(", ", unreadable));
      return input;
    }

    List<String> ceiling = configured.isEmpty() ? parent : configured;
    if (!configured.isEmpty() && !parent.isEmpty()) {
      ceiling = configured.stream().filter(parent::contains).toList();
      if (ceiling.isEmpty())
        throw new AgentHttpException(403, "FORBIDDEN", "No authorized classes in the requested scope");
    }
    input.put("classNames", QueryAccessService.classScope(permission, ceiling));
    return input;
  }

  private static List<String> unreadableClasses(List<String> classes, UserDataPermission permission) {
    return classes.stream().filter(name -> !QueryPermissions.classAllowed(permission, name)).distinct().toList();
  }

  private static QueryAccessService.Access withClasses(QueryAccessService.Access access, List<String> classes) {
    return new QueryAccessService.Access(access.user(), access.permission(), access.grant(),
        access.credential(), access.expiresAt(), classes, access.target(), access.executionUserId(), access.initiatorUserId());
  }

  static JSONArray userQuotes(JSONArray messages,String inputId) {
    var quotes=new JSONArray();
    int through=java.util.stream.IntStream.range(0,messages.size()).filter(index -> inputId.equals(messages.getJSONObject(index).getString("id"))).findFirst().orElseThrow();
    for(int index=0;index<=through;index++) {
      var record=messages.getJSONObject(index);var message=record.getJSONObject("message");
      if("user".equals(message.getString("role")) || ("agent-answer".equals(message.getString("kind")) && "user".equals(message.getJSONObject("source").getString("kind")))) quotes.add(message.getString("content"));
    }
    return new JSONArray(quotes.subList(Math.max(0,quotes.size()-10),quotes.size()));
  }

  /** Confirmed answers, in the order they were recorded. */
  static List<String> confirmedDecisions(JSONArray decisions) {
    if (decisions == null) return List.of();
    List<String> texts = new ArrayList<>();
    for (Object item : decisions) {
      JSONObject decision = JSONObject.from(item);
      String text = decision.getString("text");
      String source = decision.getString("source");
      if (text != null
          && !text.isBlank()
          && (source == null || List.of("user","agent","external").contains(source)))
        texts.add(text);
    }
    return texts;
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

  public JSONObject send(String session,String run,String message,String replyTo,Integer selectedOption,OntologyAgentAccess.Context context) throws Exception {
    var input=JSONObject.of("role","user","content",message,"timestamp",System.currentTimeMillis());
    if(replyTo!=null) input=JSONObject.of("role","notification","kind","agent-answer","source",JSONObject.of("kind","user"),"replyTo",replyTo,"content",message,"timestamp",System.currentTimeMillis());
    if(selectedOption!=null) input.put("selectedOption",selectedOption);
    return channel.send(RETRIEVER,session,run,input,null,context,true);
  }

  /** One business admission owns the retriever's round. */
  public JSONObject prepareRun(String session,String run,JSONObject message,String inputId,JSONObject parameters,String rootRunId,OntologyAgentAccess.Context context) throws Exception {
    launching.add(run);
    boolean admitted = false;
    try {
      var records=store.rows("SELECT r.input FROM ontology_retrievals r JOIN ontology_agent_sessions s ON s.id=r.id WHERE r.id=? AND s.user_id=? AND s.domain_id=?",uuid(session),context.owner().userId(),context.owner().domainId());
      boolean continuation=!records.isEmpty();
      var inputBody=continuation?records.getFirst().getJSONObject("input"):JSONObject.of("question",AgentJson.text(message,"content"));
      if (!continuation && parameters!=null) {
        AgentJson.fields(parameters,"classNames","previousDatasetIds","timeoutSeconds","interaction");
        inputBody.putAll(parameters);
      }
      if(context.callerId()==null) {
        var messages=runtime.json(context.owner().domainId(),session,"/v1/sessions/"+session,"GET",null,null).getJSONArray("messages");
        inputBody.put("userQuotes",userQuotes(messages,inputId));
      }
      if (continuation && !context.access().classNames().isEmpty()) {
        var original=inputBody.getList("classNames",String.class);
        if(original==null || original.isEmpty() || !context.access().classNames().containsAll(original)) throw new AgentHttpException(403,"FORBIDDEN","The prior retrieval exceeds this caller scope");
      }
      var input=scopedInput(inputBody,context);
      for(String previous:input.getList("previousDatasetIds",String.class)) datasetForOwner(previous,context.owner());
      var request=JSONObject.of("message",message.getString("content"),"channelInput",message,"agentChannel",true,"rootRunId",rootRunId,"timeoutSeconds",timeout(input),
        "executionUserId",context.executionUserId(),"confirmAnswer","user".equals(message.getString("role")) || ("agent-answer".equals(message.getString("kind")) && message.containsKey("replyTo")));
      if(continuation) {
        var prior=store.retrieval(session,context.owner());
        var old=store.run(session,prior.getString("current_run_id"),context.owner());
        if(old.getBooleanValue("runtime_admitted") && old.getBooleanValue("open")) reconcile(session,old.getString("id"),context.owner(),runtime.run(context.owner().domainId(),old.getString("id")));
        request.put("expectedRunId",old.getString("id"));request.put("expectedDecisionRevision",old.getIntValue("decision_revision"));
      }
      store.createSession(session,context.owner(),RETRIEVER);
      store.admit(session,run,context.owner(),input,request,context.callerId(),false,timeout(input),context.expiresAt(),continuation,context.language());
      admitted = true;
      var effective = new OntologyAgentAccess.Context(context.owner(),
          withClasses(context.access(), input.getList("classNames", String.class)), context.token(), context.apiKey(),
          context.language(), context.expiresAt(), context.callerId(), context.executionUserId());
      return runtimeRequest(session,run,message,effective);
    } catch(Exception error) {
      if(admitted) {
        store.closeRun(session,run,context.owner());
        grants.revoke(context.owner().domainId(),run);
        admissionFailed(session,run,context.owner(),error.getMessage());
      }
      throw error;
    } finally { launching.remove(run); }
  }
  public JSONObject prepareSteer(String session,String run,JSONObject message,OntologyAgentAccess.Context context) throws Exception {
    store.run(session,run,context.owner());
    if("agent-answer".equals(message.getString("kind")) && message.containsKey("replyTo")) store.confirmAnswer(session,run,context.owner(),message);
    return JSONObject.of("accepted",true,"context",modelContext(session,run,context));
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
            context.callerId(),
            true,
            timeout(input),
            context.expiresAt(),
            existing != null,
            context.language());
    return JSONObject.of(
        "id", id, "sessionId", id, "runId", key, "expiresAt", a.run().getString("deadline"));
  }

  private void admissionFailed(String id,String run,Owner owner,String error) {
    String message=error==null ? "Retriever admission failed" : error;
    store.update("UPDATE ontology_agent_runs SET open=false,admission_error=? WHERE id=? AND runtime_admitted=false",message,uuid(run));
    results.publish(id,run,owner,JSONObject.of("answer","","run",null,"error",message,"datasets",new JSONArray()));
  }

  private String modelContext(String id,String runId,OntologyAgentAccess.Context context) throws Exception {
    var record=store.retrieval(id,context.owner());
    var input=record.getJSONObject("input");
    var row=store.run(id,runId,context.owner());
    String callerId = row.getString("caller_id");
    var unreadable = callerId == null ? List.<String>of() : unreadableClasses(
        store.caller(callerId, context.owner(), false).getJSONObject("input").getList("classNames", String.class),
        context.access().permission());
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
              row.getJSONObject("request").get("userQuotes"),
              "unreadableClassNames",
              unreadable,
              "overview",
              scopedOverview(context.access(), input.getList("classNames", String.class)),
              "knowledge",
              knowledge.get("items"),
              "previousDatasets",
              prior,
              "decisions",
              record.get("decisions"),
              "answer",
              row.getJSONObject("request").getString("message"));
    return AgentJson.json(user);
  }
  private JSONObject runtimeRequest(String id,String runId,JSONObject message,OntologyAgentAccess.Context context) throws Exception {
    var record=store.retrieval(id,context.owner());
    var input=record.getJSONObject("input");
    var row=store.run(id,runId,context.owner());
    long deadline=Instant.parse(row.getString("deadline")).toEpochMilli();
    var classes = input.getList("classNames", String.class);
    String grant=access.exploration(context,id,id,runId,deadline,classes);
    var skills = definitions.publish();
    var definition=definitions.definition(context.owner().domainId(),context.language(),deadline-System.currentTimeMillis(),skills);
    definition.put("context",modelContext(id,runId,context));
    store.transaction(() -> store.gate(id,runId,context.owner()));
    return JSONObject.of("language",context.language(),"input",message,"definition",definition,
      "authority", JSONObject.of("classNames", classes, "executionKind", "live"),
      "environment",JSONObject.of("values",JSONObject.of("ONTOMATO_SKILL_SCENARIO","platform","ONTOMATO_ONTOLOGY_URL",runtime.ontologyUrl(),"ONTOMATO_RETRIEVAL_ID",id),"secrets",JSONObject.of("ONTOMATO_TK",grant)));
  }

  private Object scopedOverview(QueryAccessService.Access access, List<String> classNames) {
    var value = JSONObject.from(ontology.overview(access));
    if (classNames != null && !classNames.isEmpty()) {
      value.put("classes", value.getJSONArray("classes").stream()
          .map(JSONObject::from).filter(c -> classNames.contains(c.getString("name"))).toList());
      var relationships = value.getJSONArray("relationships");
      if (relationships != null) value.put("relationships", relationships.stream().map(JSONObject::from)
          .filter(r -> classNames.contains(r.getString("from")) && classNames.contains(r.getString("to"))).toList());
    }
    return value;
  }

  public JSONObject get(String id, Owner owner) throws Exception {
    return get(id, store.retrieval(id, owner).getString("current_run_id"), owner);
  }

  /** A read only reads: a stopped run that still owes its delivery is finished by the recovery sweep. */
  public JSONObject get(String id, String runId, Owner owner) throws Exception {
    return snapshot(id, runId, owner);
  }

  public JSONObject snapshot(String id, String runId, Owner owner) throws Exception {
    var record = store.retrieval(id, owner);
    var row = store.run(id, runId, owner);
    var observed = row.getJSONObject("observed_state");
    JSONObject state = observed == null ? null : state(observed);
    var deliveries = results.forRun(id, runId, owner);
    var result =
        JSONObject.of(
            "id",
            id,
            "revision",
            record.getIntValue("revision"),
            "runtimeSessionId",
            row.getBooleanValue("external") || !row.getBooleanValue("runtime_admitted") ? null : id,
            "runtimeRunId",
            row.getBooleanValue("external") || !row.getBooleanValue("runtime_admitted") ? null : runId,
            "run",
            state,
            "cursor",
            deliveries.isEmpty() ? 0L : deliveries.get(deliveries.size() - 1).getLongValue("cursor"),
            "deliveries",
            deliveries,
            "datasetArtifactIds",
            row.getJSONArray("dataset_ids"),
            "decisionRevision",
            row.getIntValue("decision_revision"));
    result.put("createdAt",row.getString("created_at"));
    // Runtime termination and business delivery are separate: keep reading until publication.
    result.put("retrieverPending", !row.getBooleanValue("external") && deliveries.isEmpty());
    result.put("admissionError",row.getString("admission_error"));
    result.put("outputIds", store.rows("SELECT id FROM ontology_retrieval_outputs WHERE run_id=? AND dataset_digest IS NOT NULL ORDER BY id",
        uuid(runId)).stream().map(output -> output.getString("id")).toList());
    return result;
  }

  public JSONObject evidence(String id, String runId, Owner owner) throws Exception {
    return JSONObject.of(
        "input",
        store.retrieval(id, owner).get("input"),
        "snapshot",
        snapshot(id, runId, owner));
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
      store.update("UPDATE ontology_agent_runs SET open=false WHERE id=? AND open", uuid(runId));
    }
  }

  public void reconcile(String id, String runId, Owner owner, JSONObject snapshot)
      throws Exception {
    closeStoppedCallbacks(id, runId, owner, snapshot);
    var accepted = new LinkedHashMap<String, String>();
    var acceptedData = new HashMap<String, JSONObject>();
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
        acceptedData.put(file.getString("id"),JSONObject.of("id",file.getString("id"),"sha256",file.getString("sha256"),
            "title",value.getString("title"),"rowCount",value.getJSONArray("rows").size(),"truncation",value.get("truncation")));
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
      results.publish(id,runId,owner,JSONObject.of("answer",RetrievalResults.answer(snapshot),"run",current,
          "runtimeSessionId",id,"runtimeRunId",runId,"datasets",accepted.values().stream().map(acceptedData::get).toList()));
      grants.revoke(owner.domainId(), runId);
    }
  }

  public List<JSONObject> deliveries(String session,String run,Owner owner) { return results.forRun(session,run,owner); }
  public void cancelProvider(String session,String run,Owner owner) {
    store.closeRun(session,run,owner);
    grants.revoke(owner.domainId(),run);
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
        store.update("UPDATE ontology_agent_runs SET runtime_admitted=true WHERE id=?",uuid(runId));
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
    if(!row.getBooleanValue("external") && !store.run(id,runId,owner).getBooleanValue("runtime_admitted"))
      results.publish(id,runId,owner,JSONObject.of("answer","","run",null,"error","Retriever cancelled before admission","datasets",new JSONArray()));
  }

  private static QueryAccessService.GrantUser subject(Owner owner) {
    return new QueryAccessService.GrantUser(owner.userId(), owner.domainId());
  }


  public JSONObject prepareOutput(
      String id, String runId, String key, JSONObject body, OntologyAgentAccess.Context context) {
    var acceptedInput = store.retrieval(id, context.owner());
    body.put("question", acceptedInput.getJSONObject("input").getString("question"));
    body.put("decisionIds", decisionIds(acceptedInput));
    DatasetFileContract.preparation(body);
    body.put("schema", "workbench.dataset.v2");
    var recipe = body.getJSONObject("recipe");
    var executionAccess = store.transaction(
        () -> {
          store.gate(id, runId, context.owner());
          var accepted = store.retrieval(id, context.owner());
          // Reauthorize all admitted classes against current permissions before accepting output.
          var classes = scopedInput(accepted.getJSONObject("input"), context).getList("classNames", String.class);
          for (String decision : body.getList("decisionIds", String.class))
            if (!decisionIds(accepted).contains(decision))
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
          return withClasses(context.access(), classes);
        });
    var jobInput =
        JSONObject.of("submissionId", key, "recipe", recipe, "sourceAnalysis", body.get("sourceAnalysis"));
    jobs.start(
        key,
        subject(context.owner()),
        "output",
        jobInput,
        session ->
            OntologyGenerationService.asOwner(executionAccess, () ->
                outputs.execute(
                    session,
                    AgentJson.copy(recipe),
                    body.getJSONObject("sourceAnalysis"),
                    executionAccess,
                    context.language())));
    return JSONObject.of("id", key);
  }

  private static List<String> decisionIds(JSONObject accepted) {
    return accepted.getJSONArray("decisions").stream()
        .map(JSONObject::from)
        .map(decision -> decision.getString("id"))
        .toList();
  }

  /**
   * One metric delivery: the selector is the whole input. The published definition, the frozen source and the receipt
   * are the server's, so a recalled metric and a metric run from its raw id differ only in the question and values.
   */
  public JSONObject prepareMetricOutput(
      String id, String runId, String key, JSONObject body, OntologyAgentAccess.Context context) {
    AgentJson.fields(body, "id", "revision", "bindingId", "parameters");
    String metricId = AgentJson.id(AgentJson.text(body, "id")), revision = AgentJson.text(body, "revision");
    String bindingId = body.getString("bindingId");
    JSONObject supplied = body.getJSONObject("parameters");
    if (bindingId != null && supplied != null)
      throw AgentHttpException.invalid("A preset already carries its values; pass either bindingId or parameters");
    var executionAccess = store.transaction(
        () -> {
          store.gate(id, runId, context.owner());
          var accepted = store.retrieval(id, context.owner());
          var classes = scopedInput(accepted.getJSONObject("input"), context).getList("classNames", String.class);
          return withClasses(context.access(), classes);
        });
    // The recall path only offers published metrics; a direct id must not reach the creator's own candidate.
    var metric = ontology.metric(metricId, revision, executionAccess);
    if (!io.ontomato.dataengine.bean.metricView.MetricView.STATUS_PUBLISHED.equals(metric.getStatus()))
      throw AgentHttpException.missing();
    JSONObject values = bindingId != null
        ? new JSONObject() : MetricViewBindings.values(metric.getFunction());
    if (supplied != null) values.putAll(supplied);
    var recipe = JSONObject.of("kind", "metric", "metricId", metric.getId(),
        "revision", revision, "parameters", values);
    if (bindingId != null) recipe.put("bindingId", bindingId);
    var request = JSONObject.of("schema", "workbench.dataset.v2",
        "title", title(metric, bindingId),
        "question", store.retrieval(id, context.owner()).getJSONObject("input").getString("question"),
        "assumptions", assumptions(store.retrieval(id, context.owner()).getJSONArray("decisions")),
        "decisionIds", decisionIds(store.retrieval(id, context.owner())),
        "selfCheck", null, "recipe", recipe);
    store.transaction(
        () -> {
          store.gate(id, runId, context.owner());
          store.update(
              "INSERT INTO ontology_retrieval_outputs(id,run_id,input_hash,request)"
                  + " VALUES(?,?,?,?::jsonb) ON CONFLICT DO NOTHING",
              uuid(key),
              uuid(runId),
              AgentJson.hash(request),
              AgentJson.json(request));
          var previous = store.one("SELECT * FROM ontology_retrieval_outputs WHERE id=?", uuid(key));
          if (!runId.equals(previous.getString("run_id"))
              || !AgentJson.hash(request).equals(previous.getString("input_hash")))
            throw conflict("Output input changed");
          return null;
        });
    jobs.start(
        key,
        subject(context.owner()),
        "output",
        JSONObject.of("submissionId", key, "recipe", recipe),
        session ->
            OntologyGenerationService.asOwner(executionAccess, () ->
                outputs.execute(session, AgentJson.copy(recipe), null, executionAccess, context.language(),
                    executionAccess.classNames())));
    return JSONObject.of("id", key);
  }

  private static String title(io.ontomato.dataengine.bean.metricView.MetricView metric, String bindingId) {
    return bindingId == null ? metric.getName()
        : metric.getName() + " · " + MetricViewBindings.binding(metric, bindingId).getName();
  }

  /** Confirmed answers are the conditions this delivery stands on, in the order they were recorded. */
  private static List<String> assumptions(JSONArray decisions) {
    return confirmedDecisions(decisions);
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
    data.putIfAbsent("schema", "workbench.dataset.v1");
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
    if (data.getJSONObject("sourceAnalysis") != null)
      refs.addAll(QuerySourceAnalysis.outputKeys(QuerySubgraphContract.validate(data.getJSONObject("sourceAnalysis"))));
    else for (Object value : data.getJSONArray("outKeyRefs")) refs.add(JSONObject.from(value).getString("key"));
    if (!keys.equals(refs)) throw AgentHttpException.invalid("Dataset source keys differ");
    for (Object r : data.getJSONArray("rows"))
      if (!JSONObject.from(r).keySet().equals(keys))
        throw AgentHttpException.invalid("Dataset row keys differ");
  }

  public JSONObject dataset(String id, String artifact, Owner owner) throws Exception {
    return JSONObject.of("id", artifact, "payload", JSON.parseObject(new String(runtimeDatasetBytes(id, artifact, owner), StandardCharsets.UTF_8)));
  }

  private byte[] runtimeDatasetBytes(String id,String artifact,Owner owner) throws Exception {
    store.retrieval(id,owner);
    var row=store.one("SELECT o.dataset_digest FROM ontology_retrieval_artifacts a JOIN ontology_retrieval_outputs o ON o.id=a.output_id JOIN ontology_agent_runs r ON r.id=a.run_id WHERE r.session_id=? AND a.artifact_id=?",uuid(id),uuid(artifact));
    byte[] bytes=runtime.bytes(owner.domainId(),artifact,"/v1/artifacts/"+artifact+"/content");
    if(!AgentJson.hash(JSON.parseObject(new String(bytes,StandardCharsets.UTF_8))).equals(row.getString("dataset_digest")))
      throw new AgentHttpException(503,"DEPENDENCY_UNAVAILABLE","Dataset receipt differs from its file");
    return bytes;
  }

  public byte[] datasetContent(String id,String dataset,Owner owner) throws Exception {
    return runtimeDatasetBytes(id,dataset,owner);
  }

  /**
   * Which formal output a workspace file is. The receipt names a candidate; its bytes must reproduce the digest the
   * output was admitted with, so an edited copy of a file is not a source. A path or a file name proves nothing.
   */
  public JSONObject datasetSource(String id, JSONObject body, Owner owner) {
    AgentJson.fields(body, "receiptId", "dataset");
    store.retrieval(id, owner);
    String receipt = AgentJson.id(AgentJson.text(body, "receiptId"));
    String digest = AgentJson.hash(JSON.parseObject(AgentJson.text(body, "dataset")));
    var row =
        store.one(
            "SELECT o.id,o.run_id FROM ontology_retrieval_outputs o JOIN ontology_agent_runs r ON"
                + " r.id=o.run_id WHERE r.session_id=? AND o.receipt_id=? AND o.dataset_digest=?",
            uuid(id),
            uuid(receipt),
            digest);
    return JSONObject.of("runId", row.getString("run_id"), "outputId", row.getString("id"));
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

  /**
   * The reply that answered with outputs of this round asks for their check. The first adopting reply owns the round's
   * one check; a later reply citing the same round keeps that check. The question, user quotes, confirmed decisions and
   * class scope are the round's own and only the adopted outputs' frozen recipes are checked. The check and its
   * candidates run under the reply's run: that reply holds its credential chain until both have ended.
   */
  public void adoptQuality(String id, String runId, String replyRunId, List<String> outputIds, Owner owner) throws Exception {
    store.caller(replyRunId, owner, false);
    var row = store.run(id, runId, owner);
    var programs = new JSONArray();
    var recipes = new JSONArray();
    for (String outputId : outputIds) {
      store.one("SELECT id FROM ontology_retrieval_outputs WHERE id=? AND run_id=? AND dataset_digest IS NOT NULL",
          uuid(outputId), uuid(runId));
      var dataset = output(id, runId, outputId, owner).getJSONObject("dataset");
      programs.add(QuerySourceSnapshot.fromDataset(dataset));
      recipes.add(dataset.getJSONObject("recipe"));
    }
    String qc = UUID.randomUUID().toString();
    if (store.update("UPDATE ontology_agent_runs SET qc_id=?,quality_adoption=?::jsonb WHERE id=? AND qc_id IS NULL",
        uuid(qc), AgentJson.json(JSONObject.of("replyRunId", replyRunId, "outputIds", outputIds)), uuid(runId)) == 0) return;
    var record = store.retrieval(id, owner);
    var input = record.getJSONObject("input");
    // The check follows the request language that admitted this round.
    var language = row.getString("language");
    // A published metric is only checked: settling it again would append presets to a published definition.
    boolean candidates = recipes.stream().map(JSONObject::from).noneMatch(recipe -> "metric".equals(recipe.getString("kind")));
    quality.start(
        JSONObject.of(
            "id", qc,
            "sourceRunId", replyRunId,
            "question", input.getString("question"),
            "userQuotes", row.getJSONObject("request").get("userQuotes"),
            "confirmedDecisions", confirmedDecisions(record.getJSONArray("decisions")),
            "programs", programs,
            "recipes", recipes,
            "classNames", input.getOrDefault("classNames", List.of())),
        subject(owner),
        language == null ? "en" : language,
        candidates);
    store.update("UPDATE ontology_agent_runs SET qc_admitted=true WHERE id=?", uuid(runId));
    changes.reply(owner.domainId(), replyRunId);
  }

  @Scheduled(fixedDelay = 500)
  public void recover() {
    for(var failed:store.rows("SELECT r.id,r.session_id,r.admission_error,s.user_id,s.domain_id FROM ontology_agent_runs r JOIN ontology_agent_sessions s ON s.id=r.session_id WHERE r.admission_error IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ontology_retrieval_deliveries d WHERE d.run_id=r.id)"))
      admissionFailed(failed.getString("session_id"),failed.getString("id"),owner(failed),failed.getString("admission_error"));
    for (var row :
        store.rows(
            "SELECT r.*,s.user_id,s.domain_id FROM ontology_agent_runs r JOIN"
                + " ontology_agent_sessions s ON s.id=r.session_id WHERE s.agent_id='"
                + RETRIEVER
                + "'::uuid AND r.input_hash<>'' AND"
                + " r.admission_error IS NULL AND (r.open=true OR"
                // Not seen stopped and not delivered, cancelled or not: a confirmed cancel still owes its observed stop.
                + " (r.external=false AND (r.observed_state IS NULL OR r.observed_state->>'status'<>'stopped') AND NOT EXISTS"
                + " (SELECT 1 FROM ontology_retrieval_deliveries d WHERE d.run_id=r.id)) OR"
                + " (r.cancel_requested=true AND r.cancel_confirmed=false AND"
                + " (r.observed_state IS NULL OR r.observed_state->>'status'<>'stopped')) OR"
                // Stopped without its delivery: the projection still owes the retriever's result.
                + " (r.external=false AND r.observed_state->>'status'='stopped' AND NOT EXISTS"
                + " (SELECT 1 FROM ontology_retrieval_deliveries d WHERE d.run_id=r.id)))")) {
      String id = row.getString("id");
      if (launching.contains(id) || !observing.add(id)) continue;
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
              if (row.getBooleanValue("cancel_requested") && !row.getBooleanValue("cancel_confirmed")) cancelWork(session, id, owner);
              // Only the lifecycle view is read each pass; the full snapshot once the run has stopped.
              var view = runtime.status(owner.domainId(), id);
              if(!row.getBooleanValue("runtime_admitted")) {
                store.update("UPDATE ontology_agent_runs SET runtime_admitted=true WHERE id=?",uuid(id));
                changes.run(session,id,owner,"progress");
              }
              if ("running".equals(view.getString("status"))) {
                if (Instant.parse(row.getString("deadline")).toEpochMilli() <= System.currentTimeMillis()) {
                  store.closeRun(session, id, owner);
                  cancelWork(session, id, owner);
                }
                return;
              }
              var snapshot = runtime.run(owner.domainId(), id);
              io.ontomato.dataengine.logging.ServiceLogContext.put("correlationId", snapshot.getJSONObject("run").getString("correlationId"));
              reconcile(session, id, owner, snapshot);
            } catch (AgentHttpException error) {
              if (error.status() == 404) {
                try {
                  if(row.getJSONObject("request").getBooleanValue("agentChannel") && !row.getBooleanValue("runtime_admitted")) {
                    var intent=runtime.json(row.getString("domain_id"),id,"/v1/channel/sessions/"+row.getString("session_id")+"/intents/"+id,"GET",null,null);
                    if("starting".equals(intent.getString("status"))) return;
                  }
                  if(!row.getBooleanValue("runtime_admitted")) admissionFailed(row.getString("session_id"),id,owner(row),"Retriever admission was interrupted");
                  // An admitted run the runtime no longer has can never deliver: close the round with that failure.
                  else results.publish(row.getString("session_id"),id,owner(row),JSONObject.of("answer","","run",null,
                      "error","Retriever run is no longer available","datasets",new JSONArray()));
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
          store.update("DELETE FROM ontology_retrieval_deliveries WHERE run_id IN(SELECT id FROM ontology_agent_runs WHERE session_id=?)",uuid(id));
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
