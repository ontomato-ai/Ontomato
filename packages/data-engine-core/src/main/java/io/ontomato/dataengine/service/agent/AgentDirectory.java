package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.service.IdentityService;
import org.springframework.stereotype.Service;

/** Definition owners authorize their own entries; the directory stores no definition or permission copy. */
@Service
public class AgentDirectory {
  private final AgentCaller callers;
  private final IdentityService identity;
  private final ActionCreationService actions;
  public AgentDirectory(AgentCaller callers,IdentityService identity,ActionCreationService actions) {
    this.callers=callers; this.identity=identity;this.actions=actions;
  }
  public JSONObject list(JSONObject actor,String domain) {
    var restored=callers.restore(actor,domain);
    var agents=new JSONArray();
    if (identity.hasKnowledgeGovernanceAccess(restored.user().getId(),domain)) agents.add(JSONObject.of(
      "ref",JSONObject.of("providerId","ontology","agentId",KnowledgeGovernanceService.AGENT),
      "name","Business knowledge governance","description","Review business knowledge and save governance recommendations"));
    try {
      callers.requireQuery(restored);
      agents.add(JSONObject.of("ref",JSONObject.of("providerId","ontology","agentId",OntologyAgentStore.RETRIEVER),"name","Data retrieval","description","Answer data questions with binding and retrieval results"));
      try { actions.authorize(restored.owner());agents.add(JSONObject.of("ref",JSONObject.of("providerId","ontology","agentId",ActionCreationService.AGENT),"name","Action creation","description","Draft and test an action")); }
      catch(org.springframework.web.server.ResponseStatusException denied) { if(denied.getStatusCode().value()!=403) throw denied; }
    } catch(org.springframework.web.server.ResponseStatusException denied) { if(denied.getStatusCode().value()!=403) throw denied; }
    return JSONObject.of("agents",agents);
  }
}
