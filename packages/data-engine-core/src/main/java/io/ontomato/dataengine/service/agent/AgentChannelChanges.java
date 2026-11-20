package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;
import com.alibaba.fastjson2.JSONObject;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

/** Business commit points signal references; status and results remain with their owners. */
@Service
public class AgentChannelChanges {
  private final OntologyAgentStore store;
  private final AgentRuntimeClient runtime;
  private final RestClient workbench;
  private static final org.slf4j.Logger LOG=org.slf4j.LoggerFactory.getLogger(AgentChannelChanges.class);
  public AgentChannelChanges(OntologyAgentStore store,AgentRuntimeClient runtime,
      @Value("${WORKBENCH_INTERNAL_URL:${AGENT_RUNTIME_CALLBACK_URL:http://127.0.0.1:3000}}") String url,
      @Value("${ONTOMATO_QUERY_SERVICE_TOKEN:}") String token) {
    this.store=store;this.runtime=runtime;
    var requests=new org.springframework.http.client.SimpleClientHttpRequestFactory();
    requests.setConnectTimeout(5000);requests.setReadTimeout(30000);
    workbench=RestClient.builder().requestFactory(requests).baseUrl(url).defaultHeader("X-Ontomato-Query-Service-Token",token).build();
  }
  public void run(String session,String run,Owner owner,String kind) {
    var row=store.run(session,run,owner);
    if(!row.getJSONObject("request").getBooleanValue("agentChannel")) return;
    try { runtime.json(owner.domainId(),run,"/v1/channel/runs/"+run+"/changed","POST",JSONObject.of("kind",kind),null); }
    catch(Exception failure) { LOG.error("Agent change delivery failed: domain={} run={}",owner.domainId(),run,failure);throw new IllegalStateException(failure); }
  }
  /** A check belongs to the reply that adopted the checked outputs, whichever round delivered them. */
  public void job(String job) {
    for(var row:store.rows("SELECT r.quality_adoption->>'replyRunId' AS reply,s.domain_id FROM ontology_agent_runs r JOIN ontology_agent_sessions s ON s.id=r.session_id WHERE r.qc_id=? AND r.quality_adoption IS NOT NULL",uuid(job)))
      reply(row.getString("domain_id"),row.getString("reply"));
  }
  /** The reply's run lives on the workbench host; only a reference crosses, the workbench signals its own run. */
  public void reply(String domain,String run) {
    workbench.post().uri("/internal/assistant/runs/{run}/quality-changed",run).header("X-Domain-Id",domain).retrieve().toBodilessEntity();
  }
}
