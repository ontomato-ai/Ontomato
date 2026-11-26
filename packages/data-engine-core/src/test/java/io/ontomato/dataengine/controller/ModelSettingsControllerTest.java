package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.authorization.ManagementRequestAccess;
import io.ontomato.dataengine.service.sys.bean.UserDetail;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.alibaba.fastjson2.JSONObject;
import static io.ontomato.dataengine.service.authorization.AuthorizationService.*;
import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationPolicies;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.agent.*;
import io.ontomato.dataengine.service.identity.AgentExecutionSettings;
import io.ontomato.dataengine.service.identity.AgentExecutionIdentity;
import io.ontomato.dataengine.dao.VectorRebuildStateDao;
import io.ontomato.dataengine.service.ai.EmbeddingSelection;
import io.ontomato.dataengine.service.ai.EmbeddingService;
import io.ontomato.dataengine.service.vector.VectorRebuildService;
import io.ontomato.dataengine.service.vector.VectorRebuildTracker;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

class ModelSettingsControllerTest {
  private final AgentRuntimeClient runtime = mock(AgentRuntimeClient.class);
  private final OntologyAgentAccess access = mock(OntologyAgentAccess.class);
  private final OntologyAgentModelSettings agents = mock(OntologyAgentModelSettings.class);
  private final ManagementRequestAccess management = mock(ManagementRequestAccess.class);
  private final AuthorizationService authorization = mock(AuthorizationService.class);
  private final RetrieverAccess retrieverAccess = new RetrieverAccess(authorization);
  private final VerifiedIdentity viewer = new VerifiedIdentity("verified-domain", "user", CredentialLimit.UNRESTRICTED);
  private final SubjectContext subject = new SubjectContext(viewer, null, null, null, null);

  private void permit(Verb verb, boolean allowed) {
    when(authorization.resolveSubject(viewer)).thenReturn(subject);
    when(authorization.decide(subject, new ObjectAccess(
        new ObjectTarget("verified-domain", Kind.AGENT, OntologyAgentStore.RETRIEVER), verb,
        new OwnerFacts(null, DefinitionState.PUBLISHED))))
        .thenReturn(new Decision(allowed, "OBJECT_FORBIDDEN", "Agent permission is required"));
  }
  private final ModelSettingsController controller = new ModelSettingsController(runtime, access, agents, retrieverAccess, management);

  private void identity() {
    var user = new UserDetail();
    user.setId("user");
    user.setDomainId("verified-domain");
    when(management.require(anyString())).thenReturn(user);
    when(access.authenticated(any())).thenReturn(new OntologyAgentAccess.Context(
        new OntologyAgentStore.Owner("user", "verified-domain"), null, null, null, "en", null, null));
  }

  @Test void agentDefinitionFormsUseTheCurrentCreateViewEditAndExecutionIdentityFacts() {
    var roles = new RoleResolution(Set.of(), Set.of(), List.of(), Set.of(), Map.of(), true, false);
    var admin = new SubjectContext(viewer, roles, Map.of(), Set.of(), Set.of());
    var createGate = new Create(Kind.AGENT);
    var create = controller.agentDefinitionPanelCreateForm(authorization, mock(AgentExecutionSettings.class));
    when(authorization.decide(admin, createGate)).thenReturn(new Decision(true, null, null))
        .thenReturn(new Decision(false, "OBJECT_FORBIDDEN", "Creation revoked"));
    assertEquals(JSONObject.of("canSetExecutionUser", true), create.handler().read(admin, Map.of()));
    assertEquals("Creation revoked",
        assertThrows(AgentHttpException.class, () -> create.handler().read(admin, Map.of())).getMessage());

    var form = controller.agentDefinitionPanelForm(authorization, mock(AgentExecutionSettings.class));
    var target = new ObjectTarget("verified-domain", Kind.AGENT, "local");
    var owner = new OwnerFacts("author", DefinitionState.PUBLISHED);
    var params = Map.<String, Object>of("primaryKey", "local", "ownerId", "author");
    when(authorization.decide(admin, new ObjectAccess(target, Verb.VIEW, owner)))
        .thenReturn(new Decision(true, null, null), new Decision(false, "OBJECT_FORBIDDEN", "View revoked"));
    when(authorization.decide(admin, new ObjectAccess(target, Verb.EDIT, owner))).thenReturn(new Decision(false, null, null));
    assertEquals(JSONObject.of("editable", false, "canSetExecutionUser", true), form.handler().read(admin, params));
    assertEquals("View revoked",
        assertThrows(AgentHttpException.class, () -> form.handler().read(admin, params)).getMessage());
    verifyNoInteractions(agents, runtime);
  }

  @Test void agentDefinitionFormReadsRetrieverFactsWithItsOwnViewAndEditPolicy() {
    permit(Verb.VIEW, true);
    permit(Verb.EDIT, false);
    when(agents.read("verified-domain", OntologyAgentStore.RETRIEVER))
        .thenReturn(JSONObject.of("id", OntologyAgentStore.RETRIEVER, "modelSelection", JSONObject.of("modelId", "owner-model")));
    var form = controller.agentDefinitionPanelForm(authorization, mock(AgentExecutionSettings.class));
    var facts = (JSONObject) form.handler().read(subject, Map.of("primaryKey", OntologyAgentStore.RETRIEVER));
    assertFalse(facts.getJSONObject("retriever").getBooleanValue("editable"));
    assertEquals("owner-model", facts.getJSONObject("retriever").getJSONObject("modelSelection").getString("modelId"));
    permit(Verb.VIEW, false);
    assertThrows(AgentHttpException.class, () -> form.handler().read(subject, Map.of("primaryKey", OntologyAgentStore.RETRIEVER)));
    verify(agents).read("verified-domain", OntologyAgentStore.RETRIEVER);
  }

  @Test void agentFormValidationUsesTheSameIdentityAndModelOwnersInOrder() throws Exception {
    var roles = new RoleResolution(Set.of(), Set.of(), List.of(), Set.of(), Map.of(), true, false);
    var admin = new SubjectContext(viewer, roles, Map.of(), Set.of(), Set.of());
    var executions = mock(AgentExecutionIdentity.class);
    var settings = new AgentExecutionSettings(executions, null);
    when(authorization.decide(admin, new Create(Kind.AGENT))).thenReturn(new Decision(true, null, null));
    when(executions.requireTarget("verified-domain", "invalid"))
        .thenThrow(new AgentHttpException(403, "EXECUTION_USER_INVALID", "Member no longer active"));
    var read = controller.agentDefinitionPanelCreateForm(authorization, settings);
    Map<String, Object> invalid = Map.of("validation",
        JSONObject.of("oldExecutionUserId", null, "executionUserId", "invalid", "modelId", "owner-model"));
    assertEquals(JSONObject.of("canSetExecutionUser", true, "executionError", "Member no longer active"),
        read.handler().read(admin, invalid));
    verifyNoInteractions(runtime);

    var options = JSONObject.of("models", List.of(JSONObject.of("name", "owner-model", "type", "chat")));
    when(runtime.json("verified-domain", "model-options", "/v1/models/options", "GET", null, null)).thenReturn(options);
    Map<String, Object> valid = Map.of("validation",
        JSONObject.of("oldExecutionUserId", null, "executionUserId", "member", "modelId", "owner-model"));
    assertEquals(JSONObject.of("canSetExecutionUser", true, "modelOptions", options), read.handler().read(admin, valid));
    verify(executions).requireTarget("verified-domain", "member");
  }

  @Test void forwardsOnlyTheVerifiedDomainAndKeepsRuntimeErrors() throws Exception {
    identity();
    var vectorState = mock(VectorRebuildStateDao.class);
    var vectors = new VectorRebuildService();
    ReflectionTestUtils.setField(vectors, "stateDao", vectorState);
    ReflectionTestUtils.setField(vectors, "rebuildTracker", new VectorRebuildTracker());
    var embeddings = mock(EmbeddingService.class);
    when(embeddings.selection("verified-domain")).thenReturn(new EmbeddingSelection("old", 2));
    ReflectionTestUtils.setField(vectors, "embeddingService", embeddings);
    ReflectionTestUtils.setField(controller, "vectors", vectors);
    when(runtime.json(eq("verified-domain"), anyString(), eq("/v1/models/settings"), eq("PUT"), any(), isNull()))
        .thenThrow(new AgentHttpException(400, "INVALID_REQUEST", "Default references a missing model"));
    var mvc = MockMvcBuilders.standaloneSetup(controller).build();
    mvc.perform(post("/model-settings/save").header("X-Domain-Id", "attacker-domain")
        .contentType(MediaType.APPLICATION_JSON).content("{\"models\":{},\"connections\":{},\"defaultModel\":\"missing\"}"))
        .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    verify(runtime).json(eq("verified-domain"), anyString(), eq("/v1/models/settings"), eq("PUT"), any(), isNull());
    verify(vectorState, never()).save(anyString(), any());
  }

  @Test void optionsUseOnlyTheOwnersMinimalProjection() throws Exception {
    identity();
    when(runtime.json(eq("verified-domain"), anyString(), eq("/v1/models/options"), eq("GET"), isNull(), isNull()))
        .thenReturn(JSONObject.of("models", java.util.List.of(JSONObject.of("name", "qwen-main", "type", "chat")), "defaultModel", "qwen-main", "embeddingModel", null));
    MockMvcBuilders.standaloneSetup(controller).build().perform(get("/model-options"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.models[0].name").value("qwen-main"))
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

  @Test void asyncTestReturnsTheRuntimeResult() throws Exception {
    identity();
    when(runtime.testModel(eq("verified-domain"),any())).thenReturn(java.util.concurrent.CompletableFuture.completedFuture(
        JSONObject.of("type","chat","content","pong")));
    var mvc=MockMvcBuilders.standaloneSetup(controller).build();
    var result=mvc.perform(post("/model-settings/test").contentType(MediaType.APPLICATION_JSON).content("{\"model\":{}}"))
        .andExpect(request().asyncStarted()).andReturn();
    mvc.perform(asyncDispatch(result)).andExpect(status().isOk())
        .andExpect(jsonPath("$.success").value(true)).andExpect(jsonPath("$.data.content").value("pong"));
  }

  @Test void retrieverModelReadRequiresViewAndReportsEditability() throws Exception {
    identity();
    var mvc = MockMvcBuilders.standaloneSetup(controller).build();
    permit(Verb.VIEW, false);
    mvc.perform(get("/ontology/ai/agent-models/" + OntologyAgentStore.RETRIEVER))
        .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("OBJECT_FORBIDDEN"));
    verifyNoInteractions(agents);

    permit(Verb.VIEW, true);
    permit(Verb.EDIT, false);
    when(agents.read("verified-domain", OntologyAgentStore.RETRIEVER))
        .thenReturn(JSONObject.of("id", OntologyAgentStore.RETRIEVER, "kind", "retrieval"));
    mvc.perform(get("/ontology/ai/agent-models/" + OntologyAgentStore.RETRIEVER).header("X-Domain-Id", "untrusted-domain"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.id").value(OntologyAgentStore.RETRIEVER))
        .andExpect(jsonPath("$.data.editable").value(false));
    permit(Verb.EDIT, true);
    mvc.perform(get("/ontology/ai/agent-models/" + OntologyAgentStore.RETRIEVER))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.editable").value(true));
  }

  @Test void panelCountContributesOnlyTheVisibleRetrieverWithoutReadingItsModelSettings() {
    var read = controller.agentDefinitionPanelCount();
    permit(Verb.VIEW, false);
    assertEquals(0, read.handler().read(subject, java.util.Map.of()));
    permit(Verb.VIEW, true);
    assertEquals(1, read.handler().read(subject, java.util.Map.of()));
    verifyNoInteractions(agents, runtime);
  }

  @Test void panelListContributesTheRetrieverOnlyWhenTheBatchSubjectMayViewIt() {
    var read = controller.agentDefinitionPanelList();
    permit(Verb.VIEW, false);
    var denied = (JSONObject) read.handler().read(subject, java.util.Map.of());
    assertTrue(denied.containsKey("retriever"));
    assertNull(denied.get("retriever"));
    verifyNoInteractions(agents, access, management);

    permit(Verb.VIEW, true);
    permit(Verb.EDIT, false);
    when(agents.read("verified-domain", OntologyAgentStore.RETRIEVER))
        .thenReturn(JSONObject.of("id", OntologyAgentStore.RETRIEVER, "modelSelection", JSONObject.of("modelId", "retriever-model")));
    var model = ((JSONObject) read.handler().read(subject, java.util.Map.of())).getJSONObject("retriever");
    assertEquals("retriever-model", model.getJSONObject("modelSelection").getString("modelId"));
    assertFalse(model.getBooleanValue("editable"));
    verify(agents).read("verified-domain", OntologyAgentStore.RETRIEVER);
    verifyNoInteractions(access, management, runtime);
  }

  @Test void panelRecordRequiresViewAndReadsSharingOnlyForEditorsOfTheStoredTarget() {
    var policies = mock(AuthorizationPolicies.class);
    var read = controller.agentDefinitionPanelRecord(authorization, policies);
    var id = "11111111-1111-4111-8111-111111111111";
    var parameters = Map.<String, Object>of("primaryKey", id, "ownerId", "stored-author");
    var target = new ObjectTarget("verified-domain", Kind.AGENT, id);
    var facts = new OwnerFacts("stored-author", DefinitionState.PUBLISHED);
    var view = new ObjectAccess(target, Verb.VIEW, facts);
    var edit = new ObjectAccess(target, Verb.EDIT, facts);
    when(authorization.decide(subject, view)).thenReturn(new Decision(false, "OBJECT_FORBIDDEN", "View required"));

    var denied = assertThrows(AgentHttpException.class, () -> read.handler().read(subject, parameters));
    assertEquals("View required", denied.getMessage());
    verify(authorization, never()).decide(subject, edit);
    verifyNoInteractions(policies);

    when(authorization.decide(subject, view)).thenReturn(new Decision(true, null, null));
    when(authorization.decide(subject, edit)).thenReturn(new Decision(false, "OBJECT_FORBIDDEN", "Edit required"));
    var readOnly = (JSONObject) read.handler().read(subject, parameters);
    assertFalse(readOnly.getBooleanValue("editable"));
    assertFalse(readOnly.containsKey("shared"));
    verifyNoInteractions(policies);

    when(authorization.decide(subject, edit)).thenReturn(new Decision(true, null, null));
    when(policies.agentAccess(subject, target, facts)).thenReturn(new AuthorizationPolicies.AgentAccess(true, List.of()));
    var edited = (JSONObject) read.handler().read(subject, parameters);
    assertEquals(JSONObject.of("editable", true, "shared", true), edited);
    verify(policies).agentAccess(subject, target, facts);
    verifyNoInteractions(agents, access, management, runtime);
  }

  @Test void panelRetrieverRecordUsesTheVerifiedDomainAndKeepsSharingSeparateFromTheModel() {
    var policies = mock(AuthorizationPolicies.class);
    var read = controller.agentDefinitionPanelRecord(authorization, policies);
    var id = OntologyAgentStore.RETRIEVER;
    var parameters = Map.<String, Object>of("primaryKey", id);
    permit(Verb.VIEW, false);
    assertThrows(AgentHttpException.class, () -> read.handler().read(subject, parameters));
    verifyNoInteractions(agents, policies);

    permit(Verb.VIEW, true);
    permit(Verb.EDIT, true);
    when(agents.read("verified-domain", id))
        .thenReturn(JSONObject.of("id", id, "modelSelection", JSONObject.of("modelId", "retriever-model")));
    when(policies.agentAccess(subject, new ObjectTarget("verified-domain", Kind.AGENT, id),
        new OwnerFacts(null, DefinitionState.PUBLISHED))).thenReturn(new AuthorizationPolicies.AgentAccess(false, List.of()));
    var result = (JSONObject) read.handler().read(subject, parameters);
    assertEquals(false, result.getBoolean("shared"));
    assertTrue(result.getJSONObject("retriever").getBooleanValue("editable"));
    assertFalse(result.getJSONObject("retriever").containsKey("shared"));
    verify(agents).read("verified-domain", id);
    verifyNoInteractions(access, management, runtime);
  }

  @Test void agentDeletionAvailabilityUsesOnlyEditOnTheStoredAgentInTheVerifiedDomain() {
    var read = controller.agentDefinitionDeleteAvailability(authorization);
    var id = "11111111-1111-4111-8111-111111111111";
    var parameters = Map.<String, Object>of("primaryKey", id, "ownerId", "stored-author");
    var edit = new ObjectAccess(new ObjectTarget("verified-domain", Kind.AGENT, id), Verb.EDIT,
        new OwnerFacts("stored-author", DefinitionState.PUBLISHED));
    when(authorization.decide(subject, edit)).thenReturn(
        new Decision(false, "OBJECT_FORBIDDEN", "Edit required"), new Decision(true, null, null));

    assertEquals(false, read.handler().read(subject, parameters));
    assertEquals(true, read.handler().read(subject, parameters));
    var invalid = Map.<String, Object>of("primaryKey", id, "ownerId", " ");
    assertEquals(400, assertThrows(AgentHttpException.class, () -> read.handler().read(subject, invalid)).status());
    verify(authorization, times(2)).decide(subject, edit);
    verifyNoMoreInteractions(authorization);
    verifyNoInteractions(agents, access, management, runtime);
  }

  @Test void panelAgentGrantRowsKeepTheOwnerEditGateAndTheRetrieverViewPrerequisite() {
    var store = mock(AuthorizationStore.class);
    var policies = new AuthorizationPolicies(store, null, authorization, null, null);
    var read = controller.agentDefinitionPanelGrantRows(policies);
    var id = "11111111-1111-4111-8111-111111111111";
    var facts = new OwnerFacts("stored-author", DefinitionState.PUBLISHED);
    var target = new ObjectTarget("verified-domain", Kind.AGENT, id);
    var params = Map.<String, Object>of("primaryKey", id, "ownerId", "stored-author");
    var edit = new ObjectAccess(target, Verb.EDIT, facts);

    when(authorization.decide(subject, edit)).thenReturn(new Decision(false, "OBJECT_FORBIDDEN", "Edit required"));
    assertEquals(403, assertThrows(ResponseStatusException.class,
        () -> read.handler().read(subject, params)).getStatusCode().value());
    verifyNoInteractions(store);

    when(authorization.decide(subject, edit)).thenReturn(new Decision(true, null, null));
    when(store.domainPolicy("verified-domain")).thenReturn(new PolicyRef("member", "default", PolicyKind.OBJECT));
    var editor = new AgentPolicyGrant("team", "Team", Verb.EDIT);
    when(store.objectGrants(target, Verb.USE, Set.of("default")))
        .thenReturn(List.of(new ObjectGrant("default", target, Verb.USE, null)));
    when(store.agentPolicyGrants(target)).thenReturn(List.of(
        new AgentPolicyGrant("default", "Members", Verb.USE), editor));
    assertEquals(new AuthorizationPolicies.AgentAccess(true, List.of(editor)), read.handler().read(subject, params));
    verify(authorization, never()).decide(subject, new ObjectAccess(target, Verb.VIEW, facts));

    var retriever = new ObjectTarget("verified-domain", Kind.AGENT, OntologyAgentStore.RETRIEVER);
    var retrieverParams = Map.<String, Object>of("primaryKey", retriever.id());
    permit(Verb.VIEW, false);
    permit(Verb.EDIT, true);
    assertEquals(403, assertThrows(AgentHttpException.class, () -> read.handler().read(subject, retrieverParams)).status());
    verify(store, never()).agentPolicyGrants(retriever);

    permit(Verb.VIEW, true);
    when(store.agentPolicyGrants(retriever)).thenReturn(List.of(editor));
    assertEquals(new AuthorizationPolicies.AgentAccess(false, List.of(editor)), read.handler().read(subject, retrieverParams));
    verifyNoInteractions(agents, access, management, runtime);
  }

  @Test void modelingTasksRemainAvailableWithoutRetrieverView() throws Exception {
    identity();
    var mvc = MockMvcBuilders.standaloneSetup(controller).build();
    permit(Verb.VIEW, false);
    when(agents.list("verified-domain", false)).thenReturn(JSONObject.of("agents", java.util.List.of()));
    when(agents.save(eq("verified-domain"), eq(ActionCreationService.AGENT), any()))
        .thenReturn(JSONObject.of("id", ActionCreationService.AGENT));
    mvc.perform(get("/ontology/ai/agent-models")).andExpect(status().isOk());
    verify(agents).list("verified-domain", false);
    clearInvocations(authorization);
    mvc.perform(put("/ontology/ai/agent-models/" + ActionCreationService.AGENT)
        .contentType(MediaType.APPLICATION_JSON).content("{\"modelSelection\":{\"modelId\":null}}"))
        .andExpect(status().isOk());
    verifyNoInteractions(authorization);
  }

  @Test void retrieverModelWriteRequiresEditEvenWithView() throws Exception {
    identity();
    permit(Verb.VIEW, true);
    permit(Verb.EDIT, false);
    MockMvcBuilders.standaloneSetup(controller).build()
        .perform(put("/ontology/ai/agent-models/" + OntologyAgentStore.RETRIEVER)
            .contentType(MediaType.APPLICATION_JSON).content("{\"modelSelection\":{\"modelId\":null}}"))
        .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("OBJECT_FORBIDDEN"));
    verifyNoInteractions(agents);
  }

  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);

  private MockMvc selectionMvc(String storedSelection) throws Exception {
    identity();
    when(runtime.json(eq("verified-domain"), anyString(), eq("/v1/models/options"), eq("GET"), isNull(), isNull()))
        .thenReturn(JSONObject.parseObject("{\"models\":[{\"name\":\"alt1\",\"type\":\"chat\"}]}"));
    when(jdbc.queryForList(anyString(), eq("verified-domain"), eq(OntologyAgentStore.RETRIEVER)))
        .thenReturn(java.util.List.of(java.util.Map.of("model_selection", storedSelection)));
    permit(Verb.EDIT, true);
    // Exercise MVC deserialization and the real selection service, mocking only its dependencies.
    var service = new OntologyAgentModelSettings(jdbc, runtime);
    return MockMvcBuilders.standaloneSetup(new ModelSettingsController(runtime, access, service, retrieverAccess, management)).build();
  }

  @Test void mvcSavesAnExistingModelUsingTheVerifiedDomain() throws Exception {
    selectionMvc("{\"modelId\":\"alt1\"}")
        .perform(put("/ontology/ai/agent-models/" + OntologyAgentStore.RETRIEVER)
            .header("X-Domain-Id", "untrusted-domain")
            .contentType(MediaType.APPLICATION_JSON).content("{\"modelSelection\":{\"modelId\":\"alt1\"}}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.modelSelection.modelId").value("alt1"));
    var saved = ArgumentCaptor.forClass(String.class);
    verify(jdbc).update(anyString(), eq("verified-domain"), eq(OntologyAgentStore.RETRIEVER), saved.capture());
    assertEquals("alt1", JSONObject.parseObject(saved.getValue()).getString("modelId"));
  }

  @Test void mvcSavesNullAsTheDomainDefault() throws Exception {
    selectionMvc("{\"modelId\":null}")
        .perform(put("/ontology/ai/agent-models/" + OntologyAgentStore.RETRIEVER)
            .contentType(MediaType.APPLICATION_JSON).content("{\"modelSelection\":{\"modelId\":null}}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.modelSelection.modelId").value(org.hamcrest.Matchers.nullValue()));
    var saved = ArgumentCaptor.forClass(String.class);
    verify(jdbc).update(anyString(), eq("verified-domain"), eq(OntologyAgentStore.RETRIEVER), saved.capture());
    assertTrue(JSONObject.parseObject(saved.getValue()).containsKey("modelId"), saved.getValue());
    assertNull(JSONObject.parseObject(saved.getValue()).getString("modelId"), saved.getValue());
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
    var mvc = MockMvcBuilders.standaloneSetup(new ModelSettingsController(client, access, agents, retrieverAccess, management)).build();
    var result = mvc.perform(post("/model-settings/test").contentType(MediaType.APPLICATION_JSON)
        .content("{\"model\":{\"type\":\"chat\",\"timeoutSeconds\":25,\"maxRetries\":0}}"))
        .andExpect(request().asyncStarted()).andReturn();
    mvc.perform(asyncDispatch(result)).andExpect(status().isOk()).andExpect(jsonPath("$.data.content").value("connected"));
    var sent = org.mockito.ArgumentCaptor.forClass(java.net.http.HttpRequest.class);
    verify(transport).sendAsync(sent.capture(), org.mockito.ArgumentMatchers.<java.net.http.HttpResponse.BodyHandler<String>>any());
    assertEquals(java.time.Duration.ofSeconds(35), sent.getValue().timeout().orElseThrow());
  }
}
