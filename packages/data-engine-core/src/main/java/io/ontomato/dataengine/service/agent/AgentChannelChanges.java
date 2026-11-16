package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;
import com.alibaba.fastjson2.JSONObject;
import org.springframework.stereotype.Service;

/** Business commit points signal references; status and results remain with their owners. */
@Service
public class AgentChannelChanges {
  private final OntologyAgentStore store;
  private final AgentRuntimeClient runtime;
  private static final org.slf4j.Logger LOG=org.slf4j.LoggerFactory.getLogger(AgentChannelChanges.class);
  public AgentChannelChanges(OntologyAgentStore store,AgentRuntimeClient runtime) { this.store=store;this.runtime=runtime; }
  public void run(String session,String run,Owner owner,String kind) {
    publish(store.run(session,run,owner),owner.domainId(),kind);
  }
  private void publish(JSONObject row,String domain,String kind) {
    if(!row.getJSONObject("request").getBooleanValue("agentChannel")) return;
    String run=row.getString("id");
    try { runtime.json(domain,run,"/v1/channel/runs/"+run+"/changed","POST",JSONObject.of("kind",kind),null); }
    catch(Exception failure) { LOG.error("Agent change delivery failed: domain={} run={}",domain,run,failure);throw new IllegalStateException(failure); }
  }
  public void job(String job) {
    for(var row:store.rows("SELECT r.*,s.domain_id FROM ontology_agent_runs r JOIN ontology_agent_sessions s ON s.id=r.session_id WHERE r.qc_id=? UNION SELECT r.*,s.domain_id FROM ontology_binding_runs b JOIN ontology_agent_runs r ON r.id=b.run_id JOIN ontology_agent_sessions s ON s.id=r.session_id WHERE b.qc_id=?",uuid(job),uuid(job))) publish(row,row.getString("domain_id"),"quality");
  }
  public void execution(String run) {
    var row=store.one("SELECT r.*,s.domain_id FROM ontology_agent_runs r JOIN ontology_agent_sessions s ON s.id=r.session_id WHERE r.id=?",uuid(run));
    publish(row,row.getString("domain_id"),"quality");
  }
}
