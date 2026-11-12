package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import org.junit.jupiter.api.Test;

/** The ontology host reads the runtime's answer identity; it never picks an answer from message order. */
class RetrievalAnswerTest {
  private static JSONObject message(String id, String text) {
    return JSONObject.of("id", id, "message", JSONObject.of("role", "assistant",
        "content", JSONArray.of(JSONObject.of("type", "thinking", "thinking", "plan"), JSONObject.of("type", "text", "text", text))));
  }

  @Test
  void deliveryAnswerIsTheNamedMessageAndEmptyWithoutOne() {
    var messages = JSONArray.of(message("answer", "Total is 9"), message("later", "Progress note"));
    assertEquals("Total is 9", RetrievalResults.answer(JSONObject.of(
        "run", JSONObject.of("answerMessageId", "answer"), "messages", messages)));
    var none = new JSONObject();
    none.put("answerMessageId", null);
    assertEquals("", RetrievalResults.answer(JSONObject.of("run", none, "messages", messages)));
  }

  @Test
  void publicRunCarriesTheAnswerIdentity() {
    var run = JSONObject.of("id", "run", "status", "stopped", "stopReason", "stop", "answerMessageId", "answer");
    assertEquals("answer", OntologyAgentHost.publicRun(run).getString("answerMessageId"));
  }
}
