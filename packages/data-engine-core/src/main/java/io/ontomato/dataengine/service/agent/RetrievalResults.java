package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;
import com.alibaba.fastjson2.*;
import java.util.*;
import org.springframework.stereotype.Service;

/** Ordered references to accepted results. This is not another execution or usage ledger. */
@Service
public class RetrievalResults {
  private final AgentChannelChanges changes;
  private final OntologyAgentStore store;
  public RetrievalResults(OntologyAgentStore store,AgentChannelChanges changes) { this.store=store;this.changes=changes; }

  public void publish(String retrieval, String run, Owner owner, String source, String sourceId, JSONObject data) {
    boolean inserted=store.transaction(() -> {
      store.run(retrieval, run, owner);
      // Serialize publication per retrieval: a cursor must never skip an uncommitted earlier result.
      store.one("SELECT id FROM ontology_agent_sessions WHERE id=? FOR UPDATE", uuid(retrieval));
      return store.update("INSERT INTO ontology_retrieval_deliveries(run_id,source,source_id,data) VALUES(?,?,?,?::jsonb) ON CONFLICT(run_id,source,source_id) DO NOTHING",
          uuid(run), source, uuid(sourceId), AgentJson.json(data))!=0;
    });
    if(inserted) changes.run(retrieval,run,owner,"delivery");
  }

  public List<JSONObject> forRun(String retrieval, String run, Owner owner) {
    store.run(retrieval, run, owner);
    return answered(store.rows("SELECT seq AS cursor,run_id AS \"runId\",source,data FROM ontology_retrieval_deliveries WHERE run_id=? ORDER BY seq", uuid(run)));
  }

  /** The text of the message the runtime named as the run's answer; empty when it named none. */
  public static String answer(JSONObject snapshot) {
    String id = snapshot.getJSONObject("run").getString("answerMessageId");
    if (id == null) return "";
    StringBuilder text = new StringBuilder();
    for (Object item : snapshot.getJSONArray("messages")) {
      var record = JSONObject.from(item);
      if (!id.equals(record.getString("id"))) continue;
      for (Object part : record.getJSONObject("message").getJSONArray("content")) {
        var block = JSONObject.from(part);
        if ("text".equals(block.getString("type"))) text.append(block.getString("text"));
      }
    }
    return text.toString();
  }

  /**
   * A delivery's answer is its run's answer message, which the runtime names only for a normal stop. Deliveries
   * published before the runtime named answers stored the run's last assistant text, which is that message on a
   * normal stop; after any other stop the run has no answer, so their stored text is read as none.
   */
  private static List<JSONObject> answered(List<JSONObject> deliveries) {
    for (var delivery : deliveries) {
      var data = delivery.getJSONObject("data");
      var run = data.getJSONObject("run");
      if (run != null && !"stop".equals(run.getString("stopReason"))) data.put("answer", "");
    }
    return deliveries;
  }
}
