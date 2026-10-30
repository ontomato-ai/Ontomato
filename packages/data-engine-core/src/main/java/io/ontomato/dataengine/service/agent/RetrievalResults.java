package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;
import com.alibaba.fastjson2.*;
import java.util.*;
import org.springframework.stereotype.Service;

/** Ordered references to accepted results. This is not another execution or usage ledger. */
@Service
public class RetrievalResults {
  private final OntologyAgentStore store;
  public RetrievalResults(OntologyAgentStore store) { this.store = store; }

  public void publish(String retrieval, String run, Owner owner, String source, String sourceId, JSONObject data) {
    store.transaction(() -> {
      store.run(retrieval, run, owner);
      // Serialize publication per retrieval: a cursor must never skip an uncommitted earlier result.
      store.one("SELECT id FROM ontology_agent_sessions WHERE id=? FOR UPDATE", uuid(retrieval));
      store.update("INSERT INTO ontology_retrieval_deliveries(run_id,source,source_id,data) VALUES(?,?,?,?::jsonb) ON CONFLICT(run_id,source,source_id) DO NOTHING",
          uuid(run), source, uuid(sourceId), AgentJson.json(data));
      return null;
    });
  }

  public long cursor(String retrieval, Owner owner) {
    store.retrieval(retrieval, owner);
    return store.one("SELECT coalesce(max(d.seq),0) AS cursor FROM ontology_retrieval_deliveries d JOIN ontology_agent_runs r ON r.id=d.run_id WHERE r.session_id=?", uuid(retrieval)).getLongValue("cursor");
  }

  public List<JSONObject> after(String retrieval, long cursor, Owner owner) {
    if (cursor < 0) throw AgentHttpException.invalid("Invalid result cursor");
    store.retrieval(retrieval, owner);
    return store.rows("SELECT d.seq AS cursor,d.run_id AS \"runId\",d.source,d.data FROM ontology_retrieval_deliveries d JOIN ontology_agent_runs r ON r.id=d.run_id WHERE r.session_id=? AND d.seq>? ORDER BY d.seq", uuid(retrieval), cursor);
  }

  public List<JSONObject> forRun(String retrieval, String run, Owner owner) {
    store.run(retrieval, run, owner);
    return store.rows("SELECT seq AS cursor,run_id AS \"runId\",source,data FROM ontology_retrieval_deliveries WHERE run_id=? ORDER BY seq", uuid(run));
  }

  public static String answer(JSONObject snapshot) {
    var messages = snapshot.getJSONArray("messages");
    for (int i = messages.size() - 1; i >= 0; i--) {
      var message = messages.getJSONObject(i).getJSONObject("message");
      if (!"assistant".equals(message.getString("role"))) continue;
      if (message.get("content") instanceof String text) return text;
      StringBuilder text = new StringBuilder();
      for (Object part : message.getJSONArray("content")) {
        var block = JSONObject.from(part);
        if ("text".equals(block.getString("type"))) text.append(block.getString("text"));
      }
      return text.toString();
    }
    return "";
  }
}
