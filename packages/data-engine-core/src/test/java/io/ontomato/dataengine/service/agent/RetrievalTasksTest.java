package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;

import com.alibaba.fastjson2.*;
import java.util.List;
import org.junit.jupiter.api.Test;

/** A task's status is interpreted once, from the round's delivery and the quality job's own state. */
class RetrievalTasksTest {
  private static JSONObject round() {
    var row = JSONObject.of("id", "11111111-1111-4111-8111-111111111111", "session_id", "22222222-2222-4222-8222-222222222222",
        "created_at", "2026-11-12T02:00:00Z", "external", false, "runtime_admitted", true);
    row.put("request", JSONObject.of("question", "Sales by region?"));
    row.put("admission_error", null);
    return row;
  }

  private static JSONObject delivery(JSONObject run, int datasets) {
    var items = new JSONArray();
    for (int i = 0; i < datasets; i++)
      items.add(JSONObject.of("id", "d" + i, "title", "Sales", "rowCount", 3, "sha256", "x"));
    var data = JSONObject.of("answer", "", "datasets", items);
    data.put("run", run);
    return JSONObject.of("data", data);
  }

  private static JSONObject stopped(String reason) {
    var run = JSONObject.of("status", "stopped", "stopReason", reason);
    run.put("errorMessage", null);
    return run;
  }

  @Test
  void aRoundRunsUntilTheRetrieverDeliversAndEndsAsItsRunStopped() {
    var row = round();
    assertEquals("running", RetrievalTasks.round(row, List.of()).getString("status"));
    var completed = RetrievalTasks.round(row, List.of(delivery(stopped("stop"), 1)));
    assertEquals("completed", completed.getString("status"));
    assertNull(completed.get("error"));
    assertEquals("cancelled", RetrievalTasks.round(row, List.of(delivery(stopped("aborted"), 0))).getString("status"));
  }

  @Test
  void aRoundThatFailedCarriesItsReason() {
    var row = round();
    var task = RetrievalTasks.round(row, List.of(delivery(stopped("length"), 0)));
    assertEquals("failed", task.getString("status"));
    assertEquals("LENGTH_LIMIT", task.getJSONObject("error").getString("code"));
    row.put("admission_error", "No authorized classes");
    var admission = JSONObject.of("answer", "", "datasets", new JSONArray(), "error", "No authorized classes");
    admission.put("run", null);
    assertEquals("ADMISSION_FAILED", RetrievalTasks.round(row, List.of(JSONObject.of("data", admission)))
        .getJSONObject("error").getString("code"));
  }

  @Test
  void aFailedCheckHasItsReasonAndNoScoreAndAnOldJobHasNoStartTime() {
    var interrupted = JSONObject.of("id", "q", "status", "interrupted",
        "error", JSONObject.of("code", "JOB_INTERRUPTED", "message", "Ontology service restarted"));
    var task = RetrievalTasks.qualityTask(interrupted, "round", new JSONArray(List.of(JSONObject.of("id", "d0", "title", "Sales"))));
    assertEquals("failed", task.getString("status"));
    assertEquals("JOB_INTERRUPTED", task.getJSONObject("error").getString("code"));
    assertNull(task.get("createdAt"));
    assertTrue(task.containsKey("createdAt"));
    assertEquals("round", task.getString("parentTaskId"));
    assertEquals("d0", task.getJSONObject("checks").getJSONArray("datasets").getJSONObject(0).getString("id"));
    assertNull(RetrievalTasks.qualityResult(interrupted));

    var completed = JSONObject.of("id", "q", "status", "completed", "startedAt", "2026-11-12T02:00:01Z",
        "result", JSONObject.of("score", 92.0, "summary", "Matches the question", "conclusion", "Matches",
            "fittedQuestion", "Sales by region?"));
    assertEquals(92.0, RetrievalTasks.qualityResult(completed).getDoubleValue("score"));
    assertEquals("Matches the question", RetrievalTasks.qualityResult(completed).getString("summary"));
    // A check settled before the summary was asked for still reads, with no summary.
    completed.getJSONObject("result").remove("summary");
    assertTrue(RetrievalTasks.qualityResult(completed).containsKey("summary"));
    assertNull(RetrievalTasks.qualityResult(completed).get("summary"));
    assertEquals("2026-11-12T02:00:01Z", RetrievalTasks.qualityTask(completed, null, new JSONArray()).getString("createdAt"));
    // A metric the assistant ran itself has no retriever task to hang under.
    var metric = RetrievalTasks.qualityTask(completed, null, new JSONArray());
    assertTrue(metric.containsKey("parentTaskId"));
    assertNull(metric.get("parentTaskId"));
  }
}
