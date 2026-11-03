package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.JSONObject;
import jakarta.annotation.PostConstruct;
import java.util.ArrayList;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Ontology owns the selection of its concrete agents; runtime owns the model library. */
@Service
public class OntologyAgentModelSettings {
  private final JdbcTemplate jdbc;
  private final AgentRuntimeClient runtime;

  public OntologyAgentModelSettings(JdbcTemplate jdbc, AgentRuntimeClient runtime) {
    this.jdbc = jdbc;
    this.runtime = runtime;
  }

  @PostConstruct
  public void initialize() {
    jdbc.execute("CREATE TABLE IF NOT EXISTS ontology_agent_settings (domain_id text NOT NULL, agent_id uuid NOT NULL, model_selection jsonb NOT NULL, PRIMARY KEY(domain_id,agent_id))");
  }

  public record Agent(String id, String kind, String name) {}

  public List<Agent> catalog() {
    var agents = new ArrayList<Agent>();
    agents.add(new Agent(OntologyAgentStore.RETRIEVER, "retrieval", "Data retrieval"));
    agents.add(new Agent(ActionCreationService.AGENT, "actionCreation", "Action creation conversation"));
    for (String kind : OntologyGenerationService.KINDS.stream().sorted().toList())
      agents.add(new Agent(OntologyGenerationService.agentId(kind), kind, "Generate " + kind));
    agents.add(new Agent(KnowledgeGovernanceService.AGENT, "knowledgeGovernance", "Knowledge governance"));
    return agents;
  }

  private Agent agent(String id) {
    return catalog().stream().filter(item -> item.id().equals(id)).findFirst().orElseThrow(AgentHttpException::missing);
  }

  public String modelId(String domain, String agent) {
    var rows = jdbc.queryForList("SELECT model_selection FROM ontology_agent_settings WHERE domain_id=? AND agent_id=?::uuid", domain, agent);
    return rows.isEmpty() ? null : JSONObject.parseObject(rows.getFirst().get("model_selection").toString()).getString("modelId");
  }

  private JSONObject view(String domain, Agent agent) {
    return JSONObject.of("id", agent.id(), "kind", agent.kind(), "name", agent.name(),
        "modelSelection", JSONObject.of("modelId", modelId(domain, agent.id())));
  }

  public JSONObject list(String domain) {
    return JSONObject.of("agents", catalog().stream().map(agent -> view(domain, agent)).toList());
  }

  public JSONObject save(String domain, String id, JSONObject input) throws Exception {
    var agent = agent(id);
    AgentJson.fields(input, "modelSelection");
    Object raw = input.get("modelSelection");
    if (!(raw instanceof java.util.Map<?, ?>)) throw AgentHttpException.invalid("modelSelection must be an object");
    // Spring may bind nested JSON objects as maps rather than JSONObject instances.
    JSONObject selection = input.getJSONObject("modelSelection");
    AgentJson.fields(selection, "modelId");
    Object value = selection.get("modelId");
    if (value != null && (!(value instanceof String) || ((String) value).isBlank()))
      throw AgentHttpException.invalid("modelId must be a nonempty string or null");
    String model = value == null ? null : ((String) value).trim();
    if (model != null) {
      var options = runtime.json(domain, "agent-model-selection", "/v1/models/options", "GET", null, null);
      boolean exists = options.getJSONArray("models").stream().anyMatch(item -> model.equals(((JSONObject) item).getString("name")));
      if (!exists) throw AgentHttpException.invalid("The selected model does not exist in this domain");
    }
    jdbc.update("INSERT INTO ontology_agent_settings(domain_id,agent_id,model_selection) VALUES(?,?::uuid,?::jsonb) ON CONFLICT(domain_id,agent_id) DO UPDATE SET model_selection=EXCLUDED.model_selection",
        domain, id, JSONObject.of("modelId", model).toJSONString(com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue));
    return view(domain, agent);
  }
}
