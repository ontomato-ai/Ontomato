package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.service.*;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Service;

/**
 * Tasks are read projections of existing facts, never stored: a retrieval task is a round, a quality task is the
 * quality job a branch of that round scheduled. The status of each is interpreted here and nowhere else.
 */
@Service
public class RetrievalTasks {
  private final OntologyAgentStore store;
  private final QueryJobService jobs;
  private final RetrievalResults results;

  public RetrievalTasks(OntologyAgentStore store, QueryJobService jobs, RetrievalResults results) {
    this.store = store;
    this.jobs = jobs;
    this.results = results;
  }

  /**
   * The rounds the callers admitted and their quality checks, in admission order. Settled means nothing here will change
   * by itself: no task is running and no branch still owes its quality check.
   */
  public JSONObject forCallers(List<String> callers, String domain) {
    var tasks = new JSONArray();
    var qualityResults = new JSONArray();
    boolean settled = true;
    var ids = "{" + String.join(",", callers.stream().map(AgentJson::id).toList()) + "}";
    for (var row : store.rows("SELECT r.*,c.id AS caller,s.user_id,s.domain_id FROM ontology_agent_runs r"
        + " JOIN ontology_retrieval_callers c ON c.id=r.caller_id JOIN ontology_agent_sessions s ON s.id=r.session_id"
        + " WHERE c.id=ANY(?::uuid[]) AND c.domain_id=? AND r.input_hash<>'' ORDER BY r.created_at,r.id", ids, domain)) {
      var owner = owner(row);
      String retrieval = row.getString("session_id"), run = row.getString("id");
      var deliveries = results.forRun(retrieval, run, owner);
      var binding = bindingRun(run);
      var branches = new JSONArray();
      if (binding != null) branches.add(bindingBranch(binding, deliveries));
      branches.add(retrieverBranch(row, deliveries));
      var task = retrievalTask(row, branches);
      task.put("callerId", row.getString("caller"));
      tasks.add(task);
      if ("running".equals(task.getString("status"))) settled = false;
      for (var quality : qualityJobs(row, binding, owner)) {
        var check = qualityTask(quality.job(), run, quality.source(), quality.datasetIds());
        check.put("callerId", row.getString("caller"));
        tasks.add(check);
        if ("running".equals(check.getString("status"))) settled = false;
        var result = qualityResult(quality.job());
        if (result != null) qualityResults.add(result);
      }
      if (owesQuality(row, binding)) settled = false;
    }
    return JSONObject.of("tasks", tasks, "qualityResults", qualityResults, "settled", settled);
  }

  /** The quality tasks of one round as references, for the retrieval's own reads; the task read reports them. */
  public JSONArray qualityReferences(String retrieval, String run, Owner owner) {
    var references = new JSONArray();
    for (var quality : qualityJobs(store.run(retrieval, run, owner), bindingRun(run), owner))
      references.add(JSONObject.of("taskId", quality.job().getString("id"), "source", quality.source()));
    return references;
  }

  private JSONObject bindingRun(String run) {
    var rows = store.rows("SELECT * FROM ontology_binding_runs WHERE run_id=?", uuid(run));
    return rows.isEmpty() ? null : rows.get(0);
  }

  private record QualityJob(JSONObject job, String source, List<String> datasetIds) {}

  /** Each branch's quality job once the job exists; a scheduled ID without its job is not a task yet. */
  private List<QualityJob> qualityJobs(JSONObject row, JSONObject binding, Owner owner) {
    var found = new ArrayList<QualityJob>();
    var subject = new QueryAccessService.GrantUser(owner.userId(), owner.domainId());
    if (binding != null && binding.getBooleanValue("qc_admitted")) {
      var datasets = store.rows("SELECT id FROM ontology_binding_outputs WHERE run_id=? AND dataset IS NOT NULL ORDER BY id",
          uuid(row.getString("id"))).stream().map(output -> output.getString("id")).toList();
      found.add(new QualityJob(jobs.get(binding.getString("qc_id"), subject, "quality"), "binding", datasets));
    }
    if (row.getBooleanValue("qc_admitted"))
      found.add(new QualityJob(jobs.get(row.getString("qc_id"), subject, "quality"), "retriever",
          row.getList("dataset_ids", String.class)));
    return found;
  }

  /** A branch that ended normally with datasets schedules its check; until it is admitted the round still owes it. */
  static boolean owesQuality(JSONObject row, JSONObject binding) {
    var observed = row.getJSONObject("observed_state");
    boolean retriever = observed != null && "stopped".equals(observed.getString("status"))
        && "stop".equals(observed.getString("stopReason")) && !row.getJSONArray("dataset_ids").isEmpty()
        && !row.getBooleanValue("qc_admitted");
    return retriever || binding != null && "completed".equals(binding.getString("status")) && !binding.getBooleanValue("qc_admitted");
  }

  private static JSONArray datasets(List<JSONObject> deliveries, String source) {
    var datasets = new JSONArray();
    for (var delivery : deliveries) {
      if (!source.equals(delivery.getString("source"))) continue;
      for (Object item : delivery.getJSONObject("data").getJSONArray("datasets")) {
        var dataset = JSONObject.from(item);
        var view = JSONObject.of("id", dataset.getString("id"), "title", dataset.getString("title"),
            "rowCount", dataset.getIntValue("rowCount"));
        view.put("truncation", dataset.get("truncation"));
        datasets.add(view);
      }
    }
    return datasets;
  }

  private static JSONObject branch(String source, String status, JSONObject error, JSONArray datasets) {
    var branch = JSONObject.of("source", source, "status", status, "datasets", datasets);
    branch.put("error", error);
    return branch;
  }

  private static JSONObject error(String code, String message) {
    var error = JSONObject.of("code", code);
    error.put("message", message);
    return error;
  }

  static JSONObject bindingBranch(JSONObject binding, List<JSONObject> deliveries) {
    var datasets = datasets(deliveries, "binding");
    return switch (binding.getString("status")) {
      case "running" -> branch("binding", "running", null, datasets);
      case "completed" -> branch("binding", "completed", null, datasets);
      case "cancelled" -> branch("binding", "cancelled", null, datasets);
      default -> branch("binding", "failed", error("BINDING_INTERRUPTED", binding.getString("error")), datasets);
    };
  }

  /** The retriever's outcome is its delivery: none yet is running; a stop reason or admission fact says how it ended. */
  static JSONObject retrieverBranch(JSONObject row, List<JSONObject> deliveries) {
    var delivery = deliveries.stream().filter(d -> "retriever".equals(d.getString("source"))).findFirst().orElse(null);
    var datasets = datasets(deliveries, "retriever");
    if (delivery == null) return branch("retriever", "running", null, datasets);
    var data = delivery.getJSONObject("data");
    var run = data.getJSONObject("run");
    if (run == null) {
      if (row.getString("admission_error") != null)
        return branch("retriever", "failed", error("ADMISSION_FAILED", data.getString("error")), datasets);
      if (row.getBooleanValue("runtime_admitted"))
        return branch("retriever", "failed", error("RUN_UNAVAILABLE", data.getString("error")), datasets);
      return branch("retriever", "cancelled", null, datasets);
    }
    return switch (run.getString("stopReason")) {
      case "stop" -> branch("retriever", "completed", null, datasets);
      case "aborted" -> branch("retriever", "cancelled", null, datasets);
      case "length" -> branch("retriever", "failed", error("LENGTH_LIMIT", run.getString("errorMessage")), datasets);
      default -> branch("retriever", "failed", error("RETRIEVER_FAILED", run.getString("errorMessage")), datasets);
    };
  }

  /**
   * A round runs until every branch has ended. It completed when something was delivered (a dataset, or the retriever's
   * normal answer or question); otherwise it failed when a branch failed, and was cancelled when none did.
   */
  static JSONObject retrievalTask(JSONObject row, JSONArray branches) {
    var all = branches.stream().map(JSONObject::from).toList();
    String status;
    JSONObject error = null;
    if (all.stream().anyMatch(b -> "running".equals(b.getString("status")))) status = "running";
    else if (all.stream().anyMatch(b -> !b.getJSONArray("datasets").isEmpty()
        || "retriever".equals(b.getString("source")) && "completed".equals(b.getString("status")))) status = "completed";
    else {
      var failed = all.stream().filter(b -> "failed".equals(b.getString("status"))).findFirst();
      status = failed.isPresent() ? "failed" : "cancelled";
      error = failed.map(b -> b.getJSONObject("error")).orElse(null);
    }
    boolean inline = !row.getBooleanValue("external") && row.getBooleanValue("runtime_admitted");
    // A round's admitted request is its input: ask's question, or the message a reply resumes the retrieval with.
    var request = row.getJSONObject("request");
    var task = JSONObject.of("kind", "retrieval", "id", row.getString("id"), "status", status,
        "question", request.containsKey("question") ? request.getString("question") : request.getString("message"),
        "createdAt", Instant.parse(row.getString("created_at")).toString(),
        "process", inline
            ? JSONObject.of("mode", "inline", "runtimeSessionId", row.getString("session_id"), "runtimeRunId", row.getString("id"))
            : JSONObject.of("mode", "none"),
        "branches", branches);
    task.put("parentTaskId", null);
    task.put("error", error);
    return task;
  }

  static String qualityStatus(String job) {
    return "interrupted".equals(job) ? "failed" : job;
  }

  /** A failed check carries its reason, never a score; jobs admitted before start times were kept have none. */
  static JSONObject qualityTask(JSONObject job, String parent, String source, List<String> datasetIds) {
    String status = qualityStatus(job.getString("status"));
    var task = JSONObject.of("kind", "quality", "id", job.getString("id"), "parentTaskId", parent, "status", status,
        "process", JSONObject.of("mode", "none"), "checks", JSONObject.of("source", source, "datasetIds", datasetIds));
    task.put("createdAt", job.getString("startedAt"));
    task.put("error", "running".equals(status) || "completed".equals(status) ? null : job.getJSONObject("error"));
    return task;
  }

  static JSONObject qualityResult(JSONObject job) {
    if (!"completed".equals(job.getString("status"))) return null;
    var check = job.getJSONObject("result");
    return JSONObject.of("taskId", job.getString("id"), "score", check.getDouble("score"),
        "conclusion", check.getString("conclusion"), "fittedQuestion", check.getString("fittedQuestion"));
  }
}
