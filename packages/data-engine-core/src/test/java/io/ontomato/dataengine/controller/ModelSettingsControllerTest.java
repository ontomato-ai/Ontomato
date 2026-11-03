package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.agent.*;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class ModelSettingsControllerTest {
  private final AgentRuntimeClient runtime = mock(AgentRuntimeClient.class);
  private final OntologyAgentAccess access = mock(OntologyAgentAccess.class);
  private final OntologyAgentModelSettings agents = mock(OntologyAgentModelSettings.class);
  private final ModelSettingsController controller = new ModelSettingsController(runtime, access, agents);

  private void identity() {
    when(access.authenticated(any())).thenReturn(new OntologyAgentAccess.Context(
        new OntologyAgentStore.Owner("user", "verified-domain"), null, null, null, "en", null, null));
  }

  @Test void forwardsOnlyTheVerifiedDomainAndKeepsRuntimeErrors() throws Exception {
    identity();
    when(runtime.json(eq("verified-domain"), anyString(), eq("/v1/models/settings"), eq("PUT"), any(), isNull()))
        .thenThrow(new AgentHttpException(400, "INVALID_REQUEST", "Default references a missing model"));
    var mvc = MockMvcBuilders.standaloneSetup(controller).build();
    mvc.perform(post("/model-settings/save").header("X-Domain-Id", "attacker-domain")
        .contentType(MediaType.APPLICATION_JSON).content("{\"models\":[],\"defaultModelId\":\"missing\"}"))
        .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    verify(runtime).json(eq("verified-domain"), anyString(), eq("/v1/models/settings"), eq("PUT"), any(), isNull());
  }

  @Test void optionsUseOnlyTheOwnersMinimalProjection() throws Exception {
    identity();
    when(runtime.json(eq("verified-domain"), anyString(), eq("/v1/models/options"), eq("GET"), isNull(), isNull()))
        .thenReturn(JSONObject.of("models", java.util.List.of(JSONObject.of("name", "m", "displayName", "Model")), "defaultModelId", "m"));
    MockMvcBuilders.standaloneSetup(controller).build().perform(get("/model-options"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.models[0].name").value("m"))
        .andExpect(jsonPath("$.data.models[0].apiKeys").doesNotExist());
  }

  @Test void requiresCurrentIdentityBeforeReadingOptions() throws Exception {
    when(access.authenticated(any())).thenThrow(new AgentHttpException(401,"UNAUTHENTICATED","Current identity required"));
    MockMvcBuilders.standaloneSetup(controller).build().perform(get("/model-options"))
        .andExpect(status().isUnauthorized());
    verifyNoInteractions(runtime);
  }

  @Test void asyncTestKeepsTheSafeErrorCode() throws Exception {
    identity();
    when(runtime.testModel(eq("verified-domain"),any())).thenReturn(java.util.concurrent.CompletableFuture.failedFuture(
        new AgentHttpException(502,"MODEL_TEST_FAILED","Model test failed")));
    var mvc=MockMvcBuilders.standaloneSetup(controller).build();
    var result=mvc.perform(post("/model-settings/test").contentType(MediaType.APPLICATION_JSON).content("{\"model\":{}}"))
        .andExpect(request().asyncStarted()).andReturn();
    mvc.perform(asyncDispatch(result)).andExpect(status().isBadGateway()).andExpect(jsonPath("$.code").value("MODEL_TEST_FAILED"));
  }

  @Test void ontologySelectionUsesAuthenticatedDomain() throws Exception {
    identity();
    var body=JSONObject.of("modelSelection",JSONObject.of("modelId","m"));
    when(agents.save(eq("verified-domain"),eq("agent"),any())).thenReturn(body);
    MockMvcBuilders.standaloneSetup(controller).build().perform(put("/ontology/ai/agent-models/agent")
        .contentType(MediaType.APPLICATION_JSON).content(body.toJSONString()))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.modelSelection.modelId").value("m"));
  }
}
