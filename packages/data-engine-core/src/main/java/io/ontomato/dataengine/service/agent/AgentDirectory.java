package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.service.IdentityService;
import org.springframework.stereotype.Service;

/** Definition owners authorize their own entries; the directory stores no definition or permission copy. */
@Service
public class AgentDirectory {
  private final AgentCaller callers;
  private final IdentityService identity;
  private final org.springframework.web.client.RestClient workbench;
  public AgentDirectory(AgentCaller callers,IdentityService identity,
      @org.springframework.beans.factory.annotation.Value("${ONTOMATO_WORKBENCH_URL:http://127.0.0.1:3000}") String url,
      @org.springframework.beans.factory.annotation.Value("${ONTOMATO_QUERY_SERVICE_TOKEN:}") String token) {
    this.callers=callers; this.identity=identity;
    this.workbench=org.springframework.web.client.RestClient.builder().baseUrl(url).defaultHeader("X-Ontomato-Query-Service-Token",token).build();
  }
  public JSONObject list(JSONObject actor,String domain) {
    var result=ontology(actor,domain);
    String response=workbench.post().uri("/internal/agent-channel/list").header("X-Domain-Id",domain)
      .contentType(org.springframework.http.MediaType.APPLICATION_JSON).body(JSONObject.of("actor",actor).toJSONString()).retrieve().body(String.class);
    result.getJSONArray("agents").addAll(JSON.parseObject(response).getJSONArray("agents"));
    return result;
  }
  public JSONObject ontology(JSONObject actor,String domain) {
    var restored=callers.restore(actor,domain);
    var agents=new JSONArray();
    if (identity.hasKnowledgeGovernanceAccess(restored.user().getId(),domain)) agents.add(JSONObject.of(
      "ref",JSONObject.of("providerId","ontology","agentId",KnowledgeGovernanceService.AGENT),
      "name","Business knowledge governance","description","Review business knowledge and save governance recommendations"));
    // Retrieval joins the channel in A2, together with its needs-input and continuation contracts.
    return JSONObject.of("agents",agents);
  }
}
