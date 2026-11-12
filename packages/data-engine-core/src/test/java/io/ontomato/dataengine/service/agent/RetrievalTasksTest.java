package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;

import com.alibaba.fastjson2.*;
import java.util.List;
import org.junit.jupiter.api.Test;

/** A task's status is interpreted once, from the round's branch facts and the quality job's own state. */
class RetrievalTasksTest {
  private static JSONObject round() {
    var row = JSONObject.of("id", "11111111-1111-4111-8111-111111111111", "session_id", "22222222-2222-4222-8222-222222222222",
        "created_at", "2026-11-12T02:00:00Z", "external", false, "runtime_admitted", true);
    row.put("admission_error", null);
    return row;
  }

  private static JSONObject delivery(String source, JSONObject run, int datasets) {
    var items = new JSONArray();
    for (int i = 0; i < datasets; i++)
      items.add(JSONObject.of("id", "d" + i, "title", "Sales", "rowCount", 3, "sha256", "x"));
    var data = JSONObject.of("answer", "", "datasets", items);
    data.put("run", run);
    return JSONObject.of("source", source, "data", data);
  }

  private static JSONObject stopped(String reason) {
    var run = JSONObject.of("status", "stopped", "stopReason", reason);
    run.put("errorMessage", null);
    return run;
  }

  @Test
  void aRoundRunsUntilEveryBranchEndsAndKeepsEachBranchsOutcome() {
    var row = round();
    var retriever = List.of(delivery("retriever", stopped("aborted"), 0), delivery("binding", null, 1));
    var running = new JSONArray(List.of(
        RetrievalTasks.bindingBranch(JSONObject.of("status", "running"), retriever),
        RetrievalTasks.retrieverBranch(row, retriever)));
    assertEquals("running", RetrievalTasks.retrievalTask(row, running).getString("status"));

    var ended = new JSONArray(List.of(
        RetrievalTasks.bindingBranch(JSONObject.of("status", "completed"), retriever),
        RetrievalTasks.retrieverBranch(row, retriever)));
    var task = RetrievalTasks.retrievalTask(row, ended);
    assertEquals("completed", task.getString("status"));
    assertEquals("cancelled", ended.getJSONObject(1).getString("status"));
    assertEquals("inline", task.getJSONObject("process").getString("mode"));
  }

  @Test
  void aRoundWithoutAnyDeliveryFailsWithItsBranchsReason() {
    var row = round();
    var deliveries = List.of(delivery("retriever", stopped("length"), 0));
    var task = RetrievalTasks.retrievalTask(row, new JSONArray(List.of(RetrievalTasks.retrieverBranch(row, deliveries))));
    assertEquals("failed", task.getString("status"));
    assertEquals("LENGTH_LIMIT", task.getJSONObject("error").getString("code"));
  }

  @Test
  void aFailedCheckHasItsReasonAndNoScoreAndAnOldJobHasNoStartTime() {
    var interrupted = JSONObject.of("id", "q", "status", "interrupted",
        "error", JSONObject.of("code", "JOB_INTERRUPTED", "message", "Ontology service restarted"));
    var task = RetrievalTasks.qualityTask(interrupted, "round", "binding", List.of("d0"));
    assertEquals("failed", task.getString("status"));
    assertEquals("JOB_INTERRUPTED", task.getJSONObject("error").getString("code"));
    assertNull(task.get("createdAt"));
    assertTrue(task.containsKey("createdAt"));
    assertNull(RetrievalTasks.qualityResult(interrupted));

    var completed = JSONObject.of("id", "q", "status", "completed", "startedAt", "2026-11-12T02:00:01Z",
        "result", JSONObject.of("score", 92.0, "conclusion", "Matches", "fittedQuestion", "Sales by region?"));
    assertEquals(92.0, RetrievalTasks.qualityResult(completed).getDoubleValue("score"));
    assertEquals("2026-11-12T02:00:01Z", RetrievalTasks.qualityTask(completed, "round", "retriever", List.of()).getString("createdAt"));
  }
}
