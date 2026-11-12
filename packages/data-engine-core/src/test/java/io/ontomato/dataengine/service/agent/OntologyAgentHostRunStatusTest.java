package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import java.util.Set;
import org.junit.jupiter.api.Test;

class OntologyAgentHostRunStatusTest {
  @Test
  void sessionRunStatusCarriesOnlyTheFieldsTheSessionContractDeclares() {
    var run =
        JSONObject.of(
            "id", "11111111-1111-4111-8111-111111111111",
            "sessionId", "22222222-2222-4222-8222-222222222222",
            "status", "stopped",
            "stopReason", "stop",
            "errorMessage", null,
            "createdAt", "2026-11-02T01:00:00Z",
            "finishedAt", "2026-11-02T01:01:00Z",
            "resolvedSkills", new JSONArray());

    var status = OntologyAgentHost.publicRunStatus(run);

    assertTrue(status.keySet().containsAll(Set.of("id", "status", "stopReason")), status.toString());
    // The session's private run facts never reach the browser.
    assertFalse(status.containsKey("sessionId"), status.toString());
    assertFalse(status.containsKey("errorMessage"), status.toString());
    assertFalse(status.containsKey("resolvedSkills"), status.toString());
    assertEquals("stopped", status.getString("status"));
    assertEquals("stop", status.getString("stopReason"));
  }
}
