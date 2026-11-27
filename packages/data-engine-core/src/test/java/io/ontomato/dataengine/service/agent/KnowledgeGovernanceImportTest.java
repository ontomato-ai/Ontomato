package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONArray;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.KnowledgeEntity;
import io.ontomato.dataengine.schedules.ScheduleIdentity;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.authorization.AuthorizationSubjects;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;
import io.ontomato.dataengine.service.authorization.ManagementOperations;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class KnowledgeGovernanceImportTest {
  private static final String RECORD = "11111111-1111-4111-8111-111111111111";
  private static final String RUN = "22222222-2222-4222-8222-222222222222";
  private static final String IMPORT = "knowledge-governance.knowledge.import";
  private static final String READ_RECORD = "knowledge-governance.work-record.read";
  private final OntologyAgentStore.Owner owner = new OntologyAgentStore.Owner("user", "domain");
  private final OntologyAgentStore store = mock(OntologyAgentStore.class);
  private final KnowledgeService knowledge = mock(KnowledgeService.class);
  private final AuthorizationSubjects subjects = mock(AuthorizationSubjects.class);
  private final AuthorizationStore policies = mock(AuthorizationStore.class);
  private final AgentExecutionAccess executions = mock(AgentExecutionAccess.class);
  private final ScheduleIdentity identities = mock(ScheduleIdentity.class);
  private KnowledgeGovernanceService service;

  @BeforeEach void setup() {
    var definitions = mock(OntologyAgentDefinitions.class);
    when(definitions.resource(anyString())).thenCallRealMethod();
    var operations = new ManagementOperations(List.of(new KnowledgeGovernanceService.Operations()));
    var authorization = new AuthorizationService(subjects, policies, operations,
        mock(CapabilityGrantLookup.class), mock(DataPermissionLookup.class));
    service = new KnowledgeGovernanceService(store, mock(AgentRuntimeClient.class), mock(GovernanceRuntimeClient.class),
        definitions, mock(QueryGrantService.class), knowledge, new PendingKnowledgeService(knowledge, store), mock(AdminService.class), executions,
        identities, mock(LangService.class), authorization);
    service.initialize();
    when(store.transaction(any())).thenAnswer(call -> call.<Supplier<?>>getArgument(0).get());
    when(store.one(contains("ontology_governance_records"), any(), eq("user"), eq("domain")))
        .thenReturn(JSONObject.of("latest_run_id", RUN));
    when(store.one(contains("ontology_governance_windows"), any(), any())).thenReturn(
        JSONObject.of("external", true, "expires_at", java.time.Instant.now().plusSeconds(600).toString()));
    when(store.one(contains("SELECT work"), any())).thenReturn(
        JSONObject.of("work", JSONObject.of("sources", JSONArray.of(JSONObject.of("id", "source")))));
    when(knowledge.getBussinessKnowledge("domain")).thenReturn(Map.of());
    when(knowledge.addBussinessKnowledge(any(), any(), any(), anyInt(), anyList(), any()))
        .thenAnswer(call -> call.getArgument(0));
    when(identities.creator("domain", "user")).thenReturn(new QueryAccessService.GrantUser("user", "domain"));
    when(executions.require("domain", "executor")).thenReturn(new QueryAccessService.GrantUser("executor", "domain"));
  }

  private void permit(String user, String... operations) {
    when(subjects.resolveRoles("domain", user)).thenReturn(
        new RoleResolution(Set.of(user), Set.of(user), List.of(), Set.of(), Map.of(), false));
    when(policies.policies("domain", Set.of(user))).thenReturn(List.of(new PolicyRef(user, user, PolicyKind.MANAGEMENT)));
    when(policies.managementOperations("domain", Set.of(user))).thenReturn(Set.of(operations));
  }

  @Test void importsOnlyRegisteredSourcesWithCurrentOwnerPermissionAndPendingStatus() throws Exception {
    permit("user", IMPORT);
    var input=JSONObject.of("items",List.of(JSONObject.of("id","record","title","Source fact","text","A sourced statement","sourceIds",List.of("missing"))));
    assertThrows(AgentHttpException.class,()->service.action(RECORD,RUN,"import_knowledge",input,owner,"en"));
    verify(knowledge,never()).addBussinessKnowledge(anyString(),anyString(),anyString(),anyInt(),anyList(),any());
    input.getJSONArray("items").getJSONObject(0).put("sourceIds",List.of("source"));
    var approved = new KnowledgeEntity();
    approved.setKnowledgeTitle("Approved fact");
    approved.setKnowledgeText("Approved text");
    approved.setStatus(1);
    when(knowledge.getBussinessKnowledge("domain")).thenReturn(Map.of("approved", approved));
    var existingItem = JSONObject.of("id", "approved", "title", "Approved fact", "text", "Approved text",
        "sourceIds", List.of("source"));
    input.getJSONArray("items").add(existingItem);
    var receipt = (JSONObject) service.action(RECORD, RUN, "import_knowledge", input, owner, "en");
    assertEquals(List.of("record"), receipt.getList("imported", String.class));
    assertEquals(List.of("approved"), receipt.getList("skipped", String.class));
    assertEquals("pending", receipt.getString("status"));
    verify(knowledge).addBussinessKnowledge(eq("record"),eq("Source fact"),eq("A sourced statement"),eq(0),eq(List.of()),any(User.class));
    var replayReceipt = (JSONObject) service.action(RECORD, RUN, "import_knowledge",
        JSONObject.of("items", List.of(existingItem)), owner, "en");
    assertTrue(replayReceipt.getList("imported", String.class).isEmpty());
    assertEquals(List.of("approved"), replayReceipt.getList("skipped", String.class));
    assertFalse(replayReceipt.containsKey("status"));
    verify(knowledge, never()).addBussinessKnowledge(eq("approved"), anyString(), anyString(), anyInt(), anyList(), any());
    permit("user", READ_RECORD);
    var denied = assertThrows(AgentHttpException.class,
        () -> service.action(RECORD, RUN, "import_knowledge", input, owner, "en"));
    assertEquals("MANAGEMENT_FORBIDDEN", denied.code());
    var read = (JSONObject) service.action(RECORD, RUN, "read_work_record", new JSONObject(), owner, "en");
    assertFalse(read.getJSONArray("items").isEmpty());
  }

  @Test void importedKnowledgeUsesTheExecutorWhileEvidenceRemainsWithTheInitiator() throws Exception {
    permit("user", IMPORT, READ_RECORD);
    permit("executor", IMPORT);
    var grant = JSONObject.of("purpose", "knowledge-governance", "runId", RUN,
        "domainId", "domain", "initiatorUserId", "user", "userId", "executor", "executionUserId", "executor");
    var input=JSONObject.of("items",List.of(JSONObject.of("id","record","title","Fact","text","Text","sourceIds",List.of("source"))));
    service.delegatedAction(RECORD, RUN, "import_knowledge", input, grant, "en");
    verify(knowledge).addBussinessKnowledge(eq("record"),eq("Fact"),eq("Text"),eq(0),eq(List.of()),argThat(user->user.getId().equals("executor")));
    permit("executor");
    var denied = assertThrows(AgentHttpException.class,
        () -> service.delegatedAction(RECORD, RUN, "import_knowledge", input, grant, "en"));
    assertEquals("MANAGEMENT_FORBIDDEN", denied.code());
    when(executions.require("domain", "executor")).thenThrow(new io.ontomato.dataengine.service.identity.UserCredentials.Invalid());
    service.delegatedAction(RECORD, RUN, "read_work_record", new JSONObject(), grant, "en");
    assertThrows(io.ontomato.dataengine.service.identity.UserCredentials.Invalid.class,
        () -> service.delegatedAction(RECORD, RUN, "import_knowledge", input, grant, "en"));
    when(identities.creator("domain", "user")).thenReturn(null);
    assertEquals(403, assertThrows(AgentHttpException.class,
        () -> service.delegatedAction(RECORD, RUN, "read_work_record", new JSONObject(), grant, "en")).status());
  }
}
