package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.service.*;
import java.util.*;
import org.springframework.stereotype.Service;

/**
 * Tasks are read projections of existing facts, never stored: a retrieval task is a round, a quality task is the
 * check a reply scheduled for the round outputs it adopted. The status of each is interpreted here and nowhere else.
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

  /** The round settles with the retriever's delivery; checking it belongs to the reply that adopts its outputs. */
  public JSONObject read(String retrieval, String run, Owner owner) {
    var row = store.run(retrieval, run, owner);
    var deliveries = results.forRun(retrieval, run, owner);
    var round = round(row, deliveries);
    var view = JSONObject.of("settled", !"running".equals(round.getString("status")), "status", round.getString("status"),
        "retrieval", JSONObject.of("question", row.getJSONObject("request").getString("message"),
            "decisionRevision", row.getIntValue("decision_revision"), "datasets", datasets(deliveries)));
    view.put("error", round.get("error"));
    return view;
  }

  /**
   * The checks one reply scheduled, each with its conclusion once it completed. The reply stays unsettled while a
   * check or its candidate job still runs: the reply's run is the credential chain those jobs execute under.
   */
  public JSONObject reply(String caller, Owner owner) {
    store.caller(caller, owner, false);
    var subject = new QueryAccessService.GrantUser(owner.userId(), owner.domainId());
    var tasks = new JSONArray();
    var conclusions = new JSONArray();
    boolean settled = true;
    for (var row : store.rows("SELECT * FROM ontology_agent_runs WHERE quality_adoption->>'replyRunId'=? AND"
        + " qc_admitted ORDER BY created_at,id", caller)) {
      var job = jobs.get(row.getString("qc_id"), subject, "quality");
      var checked = new JSONArray();
      for (String output : row.getJSONObject("quality_adoption").getList("outputIds", String.class))
        checked.add(JSONObject.of("id", output, "title", store.one(
            "SELECT request->>'title' AS title FROM ontology_retrieval_outputs WHERE id=?", uuid(output)).getString("title")));
      tasks.add(qualityTask(job, row.getBooleanValue("external") ? null : row.getString("id"), checked));
      var result = qualityResult(job);
      if (result != null) conclusions.add(result);
      if ("running".equals(job.getString("status")) || jobs.candidateRunning(job.getString("id"), subject)) settled = false;
    }
    return JSONObject.of("quality", tasks, "qualityResults", conclusions, "settled", settled);
  }

  private static JSONArray datasets(List<JSONObject> deliveries) {
    var datasets = new JSONArray();
    for (var delivery : deliveries)
      for (Object item : delivery.getJSONObject("data").getJSONArray("datasets")) {
        var dataset = JSONObject.from(item);
        var view = JSONObject.of("id", dataset.getString("id"), "title", dataset.getString("title"),
            "rowCount", dataset.getIntValue("rowCount"));
        view.put("truncation", dataset.get("truncation"));
        datasets.add(view);
      }
    return datasets;
  }

  private static JSONObject state(String status, JSONObject error) {
    var state = JSONObject.of("status", status);
    state.put("error", error);
    return state;
  }

  private static JSONObject error(String code, String message) {
    var error = JSONObject.of("code", code);
    error.put("message", message);
    return error;
  }

  /** The round's outcome is its delivery: none yet is running; a stop reason or admission fact says how it ended. */
  static JSONObject round(JSONObject row, List<JSONObject> deliveries) {
    if (deliveries.isEmpty()) return state("running", null);
    var data = deliveries.getFirst().getJSONObject("data");
    var run = data.getJSONObject("run");
    if (run == null) {
      if (row.getString("admission_error") != null) return state("failed", error("ADMISSION_FAILED", data.getString("error")));
      if (row.getBooleanValue("runtime_admitted")) return state("failed", error("RUN_UNAVAILABLE", data.getString("error")));
      return state("cancelled", null);
    }
    return switch (run.getString("stopReason")) {
      case "stop" -> state("completed", null);
      case "aborted" -> state("cancelled", null);
      case "length" -> state("failed", error("LENGTH_LIMIT", run.getString("errorMessage")));
      default -> state("failed", error("RETRIEVER_FAILED", run.getString("errorMessage")));
    };
  }

  static String qualityStatus(String job) {
    return "interrupted".equals(job) ? "failed" : job;
  }

  /** A failed check carries its reason, never a score; jobs admitted before start times were kept have none. */
  static JSONObject qualityTask(JSONObject job, String parent, JSONArray datasets) {
    String status = qualityStatus(job.getString("status"));
    var task = JSONObject.of("kind", "quality", "id", job.getString("id"), "status", status,
        "process", JSONObject.of("mode", "none"), "checks", JSONObject.of("datasets", datasets));
    task.put("parentTaskId", parent);
    task.put("createdAt", job.getString("startedAt"));
    task.put("error", "running".equals(status) || "completed".equals(status) ? null : job.getJSONObject("error"));
    return task;
  }

  static JSONObject qualityResult(JSONObject job) {
    if (!"completed".equals(job.getString("status"))) return null;
    var check = job.getJSONObject("result");
    var result = JSONObject.of("taskId", job.getString("id"), "score", check.getDouble("score"),
        "conclusion", check.getString("conclusion"), "fittedQuestion", check.getString("fittedQuestion"));
    result.put("summary", check.getString("summary"));
    return result;
  }
}
