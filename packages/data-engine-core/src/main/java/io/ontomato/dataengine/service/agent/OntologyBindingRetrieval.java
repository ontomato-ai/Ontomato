package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;
import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.service.*;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/** The host executes bindings independently of the retriever's runtime and write gate. */
@Service
public class OntologyBindingRetrieval {
  private final OntologyAgentStore store;
  private final MetricViewDao metrics;
  private final MetricViewService metricService;
  private final QueryOutputService outputs;
  private final QueryJobService jobs;
  private final QueryQualityService quality;
  private final RetrievalResults results;
  private final SessionRegistryService sessions;
  private final ExecutorService workers = Executors.newCachedThreadPool();
  private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(OntologyBindingRetrieval.class);

  public OntologyBindingRetrieval(OntologyAgentStore store, MetricViewDao metrics, MetricViewService metricService,
      QueryOutputService outputs, QueryJobService jobs, QueryQualityService quality, RetrievalResults results, SessionRegistryService sessions) {
    this.store=store; this.metrics=metrics; this.metricService=metricService; this.outputs=outputs;
    this.jobs=jobs; this.quality=quality; this.results=results; this.sessions=sessions;
  }

  @PostConstruct
  public void recoverInterrupted() {
    store.update("UPDATE ontology_binding_runs SET open=false,status='interrupted',error='Binding execution was interrupted' WHERE open=true AND owner_node=?", sessions.getNodeId());
  }

  public void start(String retrieval, String run, JSONObject input, OntologyAgentAccess.Context context) {
    Long deadline = context.expiresAt();
    if (context.callerId() != null) {
      long parent = Instant.parse(store.caller(context.callerId(), context.owner(), false).getString("deadline")).toEpochMilli();
      deadline = deadline == null ? parent : Math.min(deadline, parent);
    }
    store.update("INSERT INTO ontology_binding_runs(run_id,status,open,deadline,owner_node,qc_id) VALUES(?,'running',true,?::timestamptz,?,?) ON CONFLICT DO NOTHING",
        uuid(run), deadline == null ? null : Instant.ofEpochMilli(deadline).toString(), sessions.getNodeId(), UUID.randomUUID());
    workers.submit(() -> execute(retrieval, run, AgentJson.copy(input), context));
  }

  private void gate(String retrieval, String run, Owner owner) {
    var intent = store.run(retrieval, run, owner);
    if (intent.getString("caller_id") != null) {
      var caller = store.caller(intent.getString("caller_id"), owner, true);
      if (caller.getBooleanValue("closed")) throw closed();
    }
    var branch = store.one("SELECT * FROM ontology_binding_runs WHERE run_id=? FOR UPDATE", uuid(run));
    if (!branch.getBooleanValue("open") || (branch.getString("deadline") != null
        && Instant.parse(branch.getString("deadline")).toEpochMilli() <= System.currentTimeMillis())) throw closed();
  }

  private void execute(String retrieval, String run, JSONObject input, OntologyAgentAccess.Context context) {
    Owner owner = context.owner();
    try {
      store.transaction(() -> { gate(retrieval,run,owner); return null; });
      for (var match : metrics.findBindings(input.getString("question"), 10, 0, owner.domainId())) {
        try {
          store.transaction(() -> { gate(retrieval,run,owner); return null; });
          var metric = metricService.queryById(match.metricId(), owner.domainId());
          if (metric == null) continue;
          var binding = MetricViewBindings.binding(metric, match.binding().getId());
          var scope = input.getList("classNames", String.class);
          var involved = new HashSet<String>();
          if (metric.getFunction().getReturnDef().getClassNames() != null) involved.addAll(metric.getFunction().getReturnDef().getClassNames());
          if (metric.getFunction().getParameters() != null) for (var parameter : metric.getFunction().getParameters())
            if (parameter.getClassNames() != null) involved.addAll(parameter.getClassNames());
          if (scope != null && !scope.isEmpty() && !scope.containsAll(involved)) continue;
          String id = UUID.nameUUIDFromBytes((run+":"+metric.getId()+":"+match.binding().getId()).getBytes(StandardCharsets.UTF_8)).toString();
          var recipe = JSONObject.of("kind","metric","metricId",metric.getId(),"bindingId",match.binding().getId(),
              "revision",OntologyQueryService.digest(metric),"parameters",new JSONObject());
          var request = JSONObject.of("title",binding.getName(),"question",input.getString("question"),"recipe",recipe,
              "classNames",scope == null ? List.of() : scope,"language",context.language(),
              "binding",JSONObject.of("metricId",metric.getId(),"bindingId",match.binding().getId(),"name",binding.getName(),
                  "logic",metric.getFunction().getLogic(),"parameters",binding.getParameters(),
                  "originQuestion",metric.getOriginQuestion(),"originCheckResult",metric.getOriginCheckResult()));
          store.transaction(() -> {
            gate(retrieval,run,owner);
            store.update("INSERT INTO ontology_binding_outputs(id,run_id,request) VALUES(?,?,?::jsonb) ON CONFLICT DO NOTHING",
                uuid(id), uuid(run), AgentJson.json(request));
            return null;
          });
          jobs.start(id, context.access().user(), "output", JSONObject.of("recipe",recipe,"classNames",request.get("classNames")),
              execution -> outputs.execute(execution, AgentJson.copy(recipe), null, context.access(), context.language(), scope));
          JSONObject job;
          do {
            store.transaction(() -> { gate(retrieval,run,owner); return null; });
            job = jobs.get(id, subject(owner), "output");
            if ("running".equals(job.getString("status"))) Thread.sleep(150);
          } while ("running".equals(job.getString("status")));
          if (!"completed".equals(job.getString("status"))) continue;
          var dataset = datasetPayload(request, job.getJSONObject("result"));
          OntologyRetrievalService.validateDataset(dataset);
          String content = AgentJson.json(dataset), sha = QueryOutputService.hash(content);
          store.transaction(() -> {
            gate(retrieval,run,owner);
            store.update("UPDATE ontology_binding_outputs SET dataset=?,sha256=? WHERE id=? AND dataset IS NULL", content, sha, uuid(id));
            return null;
          });
          publish(retrieval, run, id, owner);
        } catch (AgentHttpException error) {
          if ("RETRIEVAL_RUN_CLOSED".equals(error.code())) throw error;
          LOG.warn("Binding candidate failed for {}: {}", run, error.getMessage());
        } catch (InterruptedException interrupted) {
          Thread.currentThread().interrupt(); throw interrupted;
        } catch (Exception failure) {
          LOG.warn("Binding candidate failed for {}: {}", run, failure.getMessage());
        }
      }
      store.update("UPDATE ontology_binding_runs SET open=false,status='completed' WHERE run_id=? AND open=true", uuid(run));
      settleQuality(run,owner);
    } catch (Exception failure) {
      cancel(retrieval, run, owner);
      LOG.debug("Binding execution stopped for {}", run, failure);
    }
  }

  static JSONObject datasetPayload(JSONObject request, JSONObject result) {
    var data = AgentJson.copy(result);
    var execution = JSONObject.of("receiptId",data.remove("receiptId"),"executedAt",data.remove("executedAt"));
    data.put("schema","workbench.dataset.v1"); data.put("execution",execution);
    data.put("title",request.getString("title")); data.put("question",request.getString("question"));
    data.put("assumptions",new JSONArray()); data.put("decisionIds",new JSONArray());
    data.put("metricUses",new JSONArray()); data.put("selfCheck",null);
    return data;
  }

  public boolean ownsDataset(String retrieval, String id, Owner owner) {
    store.retrieval(retrieval,owner);
    return !store.rows("SELECT o.id FROM ontology_binding_outputs o JOIN ontology_agent_runs r ON r.id=o.run_id WHERE o.id=? AND r.session_id=? AND o.dataset IS NOT NULL", uuid(id),uuid(retrieval)).isEmpty();
  }

  private JSONObject row(String retrieval, String id, Owner owner) {
    store.retrieval(retrieval,owner);
    var row = store.one("SELECT o.*,b.qc_id,b.qc_admitted FROM ontology_binding_outputs o JOIN ontology_binding_runs b ON b.run_id=o.run_id JOIN ontology_agent_runs r ON r.id=o.run_id WHERE o.id=? AND r.session_id=? AND o.dataset IS NOT NULL",uuid(id),uuid(retrieval));
    if (!QueryOutputService.hash(row.getString("dataset")).equals(row.getString("sha256")))
      throw new AgentHttpException(503,"DEPENDENCY_UNAVAILABLE","Binding receipt differs from its dataset");
    return row;
  }

  public String content(String retrieval, String id, Owner owner) { return row(retrieval,id,owner).getString("dataset"); }

  public JSONObject dataset(String retrieval, String id, Owner owner) {
    var row = row(retrieval,id,owner);
    var result = JSONObject.of("id",id,"payload",JSON.parseObject(row.getString("dataset")),"source","binding","sha256",row.getString("sha256"));
    if (row.getBooleanValue("qc_admitted")) result.put("qualityCheck",jobs.get(row.getString("qc_id"),subject(owner),"quality"));
    return result;
  }

  public JSONObject snapshot(String retrieval, String run, Owner owner) {
    store.run(retrieval,run,owner);
    var branches=store.rows("SELECT status,error FROM ontology_binding_runs WHERE run_id=?",uuid(run));
    var branch=branches.isEmpty()?JSONObject.of("status","completed","error",null):branches.get(0);
    var datasets=new JSONArray();
    for(var output:store.rows("SELECT id FROM ontology_binding_outputs WHERE run_id=? AND dataset IS NOT NULL ORDER BY id",uuid(run))) {
      var d=dataset(retrieval,output.getString("id"),owner);
      var meta=JSONObject.of("id",d.getString("id"),"sha256",d.getString("sha256"),"title",d.getJSONObject("payload").getString("title"));
      if(d.containsKey("qualityCheck")) meta.put("qualityCheck",d.get("qualityCheck"));
      datasets.add(meta);
    }
    branch.put("datasets",datasets); return branch;
  }

  public boolean pending(String retrieval, Owner owner) {
    store.retrieval(retrieval,owner);
    return !store.rows("SELECT b.run_id FROM ontology_binding_runs b JOIN ontology_agent_runs r ON r.id=b.run_id WHERE r.session_id=? AND b.open=true",uuid(retrieval)).isEmpty();
  }

  public void cancel(String retrieval, String run, Owner owner) {
    store.run(retrieval,run,owner);
    store.transaction(() -> {
      store.update("UPDATE ontology_binding_runs SET open=false,status='cancelled' WHERE run_id=? AND open=true",uuid(run));
      return null;
    });
    settleQuality(run,owner);
    for(var output:store.rows("SELECT id FROM ontology_binding_outputs WHERE run_id=? AND dataset IS NULL",uuid(run)))
      try { jobs.cancel(output.getString("id"),subject(owner),"output"); }
      catch (Exception error) { throw new IllegalStateException("Binding cancellation failed",error); }
  }

  private void publish(String retrieval,String run,String output,Owner owner) {
    var row=row(retrieval,output,owner); var dataset=JSON.parseObject(row.getString("dataset"));
    results.publish(retrieval,run,owner,"binding",output,JSONObject.of("answer","","run",null,
        "datasets",JSONArray.of(JSONObject.of("id",output,"sha256",row.getString("sha256"),"title",dataset.getString("title"),
            "rowCount",dataset.getJSONArray("rows").size(),"truncation",dataset.get("truncation"),"binding",row.getJSONObject("request").get("binding")))));
  }

  private void settleQuality(String run,Owner owner) {
    try { scheduleQuality(run,owner); }
    catch(Exception error) { LOG.warn("Binding quality check awaits reconciliation: {}",run,error); }
  }

  private void scheduleQuality(String run,Owner owner) {
    var branches=store.rows("SELECT * FROM ontology_binding_runs WHERE run_id=?",uuid(run));
    if(branches.isEmpty()) return;
    var branch=branches.get(0);
    if(branch.getBooleanValue("open") || branch.getBooleanValue("qc_admitted")) return;
    var accepted=store.rows("SELECT request,dataset FROM ontology_binding_outputs WHERE run_id=? AND dataset IS NOT NULL ORDER BY id",uuid(run));
    if(accepted.isEmpty()) return;
    var programs=new JSONArray(); var recipes=new JSONArray();
    for(var output:accepted) {
      var data=JSON.parseObject(output.getString("dataset")); var recipe=data.getJSONObject("recipe");
      programs.add(JSONObject.of("question",data.getString("question"),"code",recipe.getString("executedCode"),"sourceAnalysis",data.get("sourceAnalysis")));
      recipes.add(recipe);
    }
    var request=accepted.get(0).getJSONObject("request");
    quality.start(JSONObject.of("id",branch.getString("qc_id"),"question",request.getString("question"),
        "programs",programs,"recipes",recipes,"classNames",request.get("classNames")),subject(owner),request.getString("language"));
    store.update("UPDATE ontology_binding_runs SET qc_admitted=true WHERE run_id=?",uuid(run));
  }

  @Scheduled(fixedDelay=1000)
  public void recoverResults() {
    for(var row:store.rows("SELECT o.id,o.run_id,r.session_id,s.user_id,s.domain_id FROM ontology_binding_outputs o JOIN ontology_binding_runs b ON b.run_id=o.run_id JOIN ontology_agent_runs r ON r.id=o.run_id JOIN ontology_agent_sessions s ON s.id=r.session_id WHERE o.dataset IS NOT NULL AND b.owner_node=? AND ((b.open=false AND b.qc_admitted=false) OR NOT EXISTS(SELECT 1 FROM ontology_retrieval_deliveries d WHERE d.source='binding' AND d.source_id=o.id))",sessions.getNodeId())) {
      try { var owner=owner(row); publish(row.getString("session_id"),row.getString("run_id"),row.getString("id"),owner); scheduleQuality(row.getString("run_id"),owner); }
      catch(Exception failure) { LOG.warn("Binding result reconciliation failed: {}",row.getString("id"),failure); }
    }
  }

  private static QueryAccessService.GrantUser subject(Owner owner) { return new QueryAccessService.GrantUser(owner.userId(),owner.domainId()); }
  @PreDestroy public void close() { workers.shutdownNow(); }
}
