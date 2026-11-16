package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.service.IdentityService;
import org.springframework.stereotype.Service;

/** Definition owners authorize their own entries; the directory stores no definition or permission copy. */
@Service
public class AgentDirectory {
  private final AgentCaller callers;
  private final OntologyAgentLabels labels;
  private final IdentityService identity;
  private final ActionCreationService actions;
  private final KnowledgeGovernanceService governance;
  public AgentDirectory(AgentCaller callers,IdentityService identity,ActionCreationService actions,KnowledgeGovernanceService governance,OntologyAgentLabels labels) {
    this.callers=callers; this.identity=identity;this.actions=actions;this.governance=governance;this.labels=labels;
  }
  public JSONObject list(JSONObject actor,String domain,String language) {
    var restored=callers.restore(actor,domain);
    var agents=new JSONArray();
    if (identity.hasKnowledgeGovernanceAccess(restored.user().getId(),domain)) for(var agent:governance.agents(domain)) agents.add(JSONObject.of(
      "ref",JSONObject.of("providerId","ontology","agentId",agent.getString("id")),
      "name",agent.getString("name"),"description",agent.getString("description")));
    try {
      callers.requireQuery(restored);
      agents.add(JSONObject.of("ref",JSONObject.of("providerId","ontology","agentId",OntologyAgentStore.RETRIEVER),"name","Data retrieval","description","Answer data questions with binding and retrieval results"));
      try { actions.authorize(restored.owner());agents.add(JSONObject.of("ref",JSONObject.of("providerId","ontology","agentId",ActionCreationService.AGENT),"name","Action creation","description","Draft and test an action")); }
      catch(org.springframework.web.server.ResponseStatusException denied) { if(denied.getStatusCode().value()!=403) throw denied; }
    } catch(org.springframework.web.server.ResponseStatusException denied) { if(denied.getStatusCode().value()!=403) throw denied; }
    for(int index=0;index<agents.size();index++) {
      var entry=agents.getJSONObject(index);
      agents.set(index,labels.localize(entry.getJSONObject("ref").getString("agentId"),entry,language));
    }
    return JSONObject.of("agents",agents);
  }
}
