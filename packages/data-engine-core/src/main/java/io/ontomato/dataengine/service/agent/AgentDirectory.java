package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.service.IdentityService;
import org.springframework.stereotype.Service;

/** Definition owners authorize their own entries; the directory stores no definition or permission copy. */
@Service
public class AgentDirectory {
  private final AgentCaller callers;
  private final IdentityService identity;
  public AgentDirectory(AgentCaller callers,IdentityService identity) {
    this.callers=callers; this.identity=identity;
  }
  public JSONObject list(JSONObject actor,String domain) {
    var restored=callers.restore(actor,domain);
    var agents=new JSONArray();
    if (identity.hasKnowledgeGovernanceAccess(restored.user().getId(),domain)) agents.add(JSONObject.of(
      "ref",JSONObject.of("providerId","ontology","agentId",KnowledgeGovernanceService.AGENT),
      "name","Business knowledge governance","description","Review business knowledge and save governance recommendations"));
    // Retrieval joins the channel in A2, together with its needs-input and continuation contracts.
    return JSONObject.of("agents",agents);
  }
}
