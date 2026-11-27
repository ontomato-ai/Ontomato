package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import org.springframework.stereotype.Service;

/** Definition owners authorize their own entries; the directory stores no definition or permission copy. */
@Service
public class AgentDirectory {
  private final AgentCaller callers;
  private final OntologyAgentLabels labels;
  private final ActionCreationService actions;
  private final RetrieverAccess retrieverAccess;
  public AgentDirectory(AgentCaller callers,ActionCreationService actions,OntologyAgentLabels labels,RetrieverAccess retrieverAccess) {
    this.callers=callers; this.actions=actions;this.labels=labels;this.retrieverAccess=retrieverAccess;
  }
  public JSONObject list(JSONObject actor,String domain,String language) { return list(actor,domain,language,null); }
  public JSONObject list(JSONObject actor,String domain,String language,JSONObject executionActor) {
    var restored=callers.restore(actor,domain);
    var executor=callers.executionUser(restored,executionActor);
    var executionOwner=new OntologyAgentStore.Owner(executor.getId(),domain);
    var agents=new JSONArray();
    if (retrieverAccess.decide(retrieverAccess.subject(executionOwner), Verb.USE).allowed()) {
      agents.add(JSONObject.of(
          "ref", OntologyAgentStore.retrieverRef(),
          "name", "Data retrieval",
          "description", "Answer data questions with retrieval results"
      ));
    }
    try {
      callers.requireQueryUser(executor);
      actions.authorize(executionOwner);
      agents.add(JSONObject.of("ref",JSONObject.of("providerId","ontology","agentId",ActionCreationService.AGENT),"name","Action creation","description","Draft and test an action"));
    } catch(org.springframework.web.server.ResponseStatusException denied) { if(denied.getStatusCode().value()!=403) throw denied; }
    for(int index=0;index<agents.size();index++) {
      var entry=agents.getJSONObject(index);
      agents.set(index,labels.localize(entry.getJSONObject("ref").getString("agentId"),entry,language));
    }
    return JSONObject.of("agents",agents);
  }
}
