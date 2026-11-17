package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.LangService;
import java.util.Map;
import org.springframework.stereotype.Service;

/** The ontology provider's shipped labels; names authored in the domain are retained. */
@Service
public class OntologyAgentLabels {
  private static final Map<String,String> BUILTINS=Map.of(OntologyAgentStore.RETRIEVER,"OntologyAgent.retrieval",
      KnowledgeGovernanceService.AGENT,"OntologyAgent.governance",ActionCreationService.AGENT,"OntologyAgent.action");
  private final LangService language;
  public OntologyAgentLabels(LangService language) { this.language=language; }
  public JSONObject localize(String agentId,JSONObject agent,String locale) {
    String prefix=BUILTINS.get(agentId);
    if(prefix==null) return agent;
    var result=new JSONObject(agent);
    result.put("name",language.get(locale,prefix+".name"));
    result.put("description",language.get(locale,prefix+".description"));
    return result;
  }
}
