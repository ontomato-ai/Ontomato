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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
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

  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);

  private MockMvc selectionMvc(String storedSelection) throws Exception {
    identity();
    when(runtime.json(eq("verified-domain"), anyString(), eq("/v1/models/options"), eq("GET"), isNull(), isNull()))
        .thenReturn(JSONObject.parseObject("{\"models\":[{\"name\":\"alt1\",\"displayName\":\"Alternative\"}]}"));
    when(jdbc.queryForList(anyString(), eq("verified-domain"), eq(OntologyAgentStore.RETRIEVER)))
        .thenReturn(java.util.List.of(java.util.Map.of("model_selection", storedSelection)));
    // Exercise MVC deserialization and the real selection service, mocking only its dependencies.
    var service = new OntologyAgentModelSettings(jdbc, runtime);
    return MockMvcBuilders.standaloneSetup(new ModelSettingsController(runtime, access, service)).build();
  }

  @Test void mvcSavesAnExistingModelUsingTheVerifiedDomain() throws Exception {
    selectionMvc("{\"modelId\":\"alt1\"}")
        .perform(put("/ontology/ai/agent-models/" + OntologyAgentStore.RETRIEVER)
            .header("X-Domain-Id", "untrusted-domain")
            .contentType(MediaType.APPLICATION_JSON).content("{\"modelSelection\":{\"modelId\":\"alt1\"}}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.modelSelection.modelId").value("alt1"));
    verify(jdbc).update(anyString(), eq("verified-domain"), eq(OntologyAgentStore.RETRIEVER), eq("{\"modelId\":\"alt1\"}"));
  }

  @Test void mvcSavesNullAsTheDomainDefault() throws Exception {
    selectionMvc("{\"modelId\":null}")
        .perform(put("/ontology/ai/agent-models/" + OntologyAgentStore.RETRIEVER)
            .contentType(MediaType.APPLICATION_JSON).content("{\"modelSelection\":{\"modelId\":null}}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.modelSelection.modelId").value(org.hamcrest.Matchers.nullValue()));
    verify(jdbc).update(anyString(), eq("verified-domain"), eq(OntologyAgentStore.RETRIEVER), eq("{\"modelId\":null}"));
    verifyNoInteractions(runtime);
  }

  @Test void mvcRejectsAMissingModelBeforeWriting() throws Exception {
    selectionMvc("{\"modelId\":null}")
        .perform(put("/ontology/ai/agent-models/" + OntologyAgentStore.RETRIEVER)
            .contentType(MediaType.APPLICATION_JSON).content("{\"modelSelection\":{\"modelId\":\"missing\"}}"))
        .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    verifyNoInteractions(jdbc);
  }

  @Test void mvcRejectsAnUnknownAgentBeforeReadingModels() throws Exception {
    selectionMvc("{\"modelId\":null}")
        .perform(put("/ontology/ai/agent-models/00000000-0000-4000-8000-000000000000")
            .contentType(MediaType.APPLICATION_JSON).content("{\"modelSelection\":{\"modelId\":\"alt1\"}}"))
        .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NOT_FOUND"));
    verifyNoInteractions(jdbc, runtime);
  }

  @Test void mvcModelTestPreservesTheDraftTimeoutThroughDeserialization() throws Exception {
    identity();
    var transport = mock(java.net.http.HttpClient.class);
    @SuppressWarnings("unchecked")
    var response = (java.net.http.HttpResponse<String>) mock(java.net.http.HttpResponse.class);
    when(response.statusCode()).thenReturn(200);
    when(response.body()).thenReturn("{\"content\":\"connected\"}");
    when(transport.sendAsync(any(java.net.http.HttpRequest.class), org.mockito.ArgumentMatchers.<java.net.http.HttpResponse.BodyHandler<String>>any()))
        .thenReturn(java.util.concurrent.CompletableFuture.completedFuture(response));
    var client = new AgentRuntimeClient("http://runtime.invalid", "fixture-host-token", "http://ontology.invalid");
    ReflectionTestUtils.setField(client, "http", transport);
    var mvc = MockMvcBuilders.standaloneSetup(new ModelSettingsController(client, access, agents)).build();
    var result = mvc.perform(post("/model-settings/test").contentType(MediaType.APPLICATION_JSON)
        .content("{\"model\":{\"timeout\":\"PT25S\"}}"))
        .andExpect(request().asyncStarted()).andReturn();
    mvc.perform(asyncDispatch(result)).andExpect(status().isOk()).andExpect(jsonPath("$.data.content").value("connected"));
    var sent = org.mockito.ArgumentCaptor.forClass(java.net.http.HttpRequest.class);
    verify(transport).sendAsync(sent.capture(), org.mockito.ArgumentMatchers.<java.net.http.HttpResponse.BodyHandler<String>>any());
    assertEquals(java.time.Duration.ofSeconds(35), sent.getValue().timeout().orElseThrow());
  }
}
