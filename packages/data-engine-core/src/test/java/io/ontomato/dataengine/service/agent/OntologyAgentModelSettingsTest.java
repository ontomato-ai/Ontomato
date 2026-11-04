package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.alibaba.fastjson2.JSONObject;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class OntologyAgentModelSettingsTest {
  private final JdbcTemplate jdbc=mock(JdbcTemplate.class);
  private final AgentRuntimeClient runtime=mock(AgentRuntimeClient.class);
  private final OntologyAgentModelSettings models=new OntologyAgentModelSettings(jdbc,runtime);

  @Test void catalogCoversConcreteAgentsAndUnknownIdsCannotBeConfigured() {
    assertEquals(13,models.catalog().size());
    assertEquals(13,models.catalog().stream().map(OntologyAgentModelSettings.Agent::id).distinct().count());
    assertThrows(AgentHttpException.class,()->models.save("d","unknown",new JSONObject()));
    verifyNoInteractions(runtime,jdbc);
  }

  @Test void aMissingModelIsRejectedBeforeWriting() throws Exception {
    when(runtime.json(eq("d"),anyString(),eq("/v1/models/options"),eq("GET"),isNull(),isNull()))
        .thenReturn(JSONObject.of("models",new com.alibaba.fastjson2.JSONArray()));
    var failure=assertThrows(AgentHttpException.class,()->models.save("d",OntologyAgentStore.RETRIEVER,
        JSONObject.of("modelSelection",JSONObject.of("modelId","legacy/missing"))));
    assertEquals(400,failure.status()); verifyNoInteractions(jdbc);
  }

  @Test void defaultNeedsNoModelReadAndStoredMissingIdsStayVisible() throws Exception {
    when(jdbc.queryForList(anyString(),eq("d"),eq(OntologyAgentStore.RETRIEVER)))
        .thenReturn(List.of(java.util.Map.of("model_selection","{\"modelId\":\"legacy/deleted\"}")));
    assertEquals("legacy/deleted",models.modelId("d",OntologyAgentStore.RETRIEVER));
    models.save("d",OntologyAgentStore.RETRIEVER,JSONObject.of("modelSelection",new JSONObject()));
    verify(jdbc).update(anyString(),eq("d"),eq(OntologyAgentStore.RETRIEVER),eq("{\"modelId\":null}"));
    verifyNoInteractions(runtime);
  }
  @Test void definitionsUseTheirOwnSelectionInTheSameDomain() {
    var selections=mock(OntologyAgentModelSettings.class);
    when(selections.modelId(eq("d"),anyString())).thenAnswer(call -> call.getArgument(1));
    var definitions=new OntologyAgentDefinitions(runtime, mock(io.ontomato.dataengine.service.RuntimeCodeClient.class), selections) {
      @Override public String resource(String path) { return path.endsWith(".json") ? "\"contract\"" : "prompt"; }
    };
    assertEquals(OntologyAgentStore.RETRIEVER,definitions.definition("d","en",1000).getString("modelId"));
    assertEquals(ActionCreationService.AGENT,definitions.actionCreation("d","prompt","en",1000).getString("modelId"));
    assertEquals(KnowledgeGovernanceService.AGENT,definitions.governance("d","en",1000).getString("modelId"));
    assertEquals(OntologyAgentDefinitions.METRICVIEW_AGENT,definitions.metricView("d","prompt","en",1000).getString("modelId"));
    for(String kind:OntologyGenerationService.KINDS)
      assertEquals(OntologyGenerationService.agentId(kind),definitions.generation("d",kind,"prompt","en",1000).getString("modelId"));
  }

}
