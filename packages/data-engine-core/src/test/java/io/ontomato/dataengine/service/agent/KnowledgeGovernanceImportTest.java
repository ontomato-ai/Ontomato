package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.*;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class KnowledgeGovernanceImportTest {
  @Test void importsOnlyRegisteredSourcesWithCurrentOwnerPermissionAndPendingStatus() {
    var store=mock(OntologyAgentStore.class);
    var knowledge=mock(KnowledgeService.class);
    var identity=mock(IdentityService.class);
    var service=new KnowledgeGovernanceService(store,mock(AgentRuntimeClient.class),mock(GovernanceRuntimeClient.class),mock(OntologyAgentDefinitions.class),mock(QueryGrantService.class),knowledge,mock(AdminService.class),mock(AgentExecutionAccess.class));
    ReflectionTestUtils.setField(service,"identityService",identity);
    var owner=new OntologyAgentStore.Owner("user","domain");
    var work=JSONObject.of("sources",List.of(JSONObject.of("id","source")));
    when(identity.hasKnowledgeGovernanceAccess("user","domain")).thenReturn(true);
    when(store.one(contains("ontology_governance_records"),any(),any(),any())).thenReturn(JSONObject.of("latest_run_id","11111111-1111-4111-8111-111111111111"));
    when(store.one(contains("SELECT work"),any())).thenReturn(JSONObject.of("work",work));
    when(knowledge.getBussinessKnowledge("domain")).thenReturn(Map.of());
    var input=JSONObject.of("items",List.of(JSONObject.of("id","record","title","Source fact","text","A sourced statement","sourceIds",List.of("missing"))));
    assertThrows(AgentHttpException.class,()->ReflectionTestUtils.invokeMethod(service,"importKnowledge","11111111-1111-4111-8111-111111111111","run",input,owner,owner));
    verify(knowledge,never()).addBussinessKnowledge(anyString(),anyString(),anyString(),anyInt(),anyList(),any());
    input.getJSONArray("items").getJSONObject(0).put("sourceIds",List.of("source"));
    ReflectionTestUtils.invokeMethod(service,"importKnowledge","11111111-1111-4111-8111-111111111111","run",input,owner,owner);
    verify(knowledge).addBussinessKnowledge(eq("record"),eq("Source fact"),eq("A sourced statement"),eq(0),eq(List.of()),any(User.class));
    when(identity.hasKnowledgeGovernanceAccess("user","domain")).thenReturn(false);
    assertThrows(AgentHttpException.class,()->ReflectionTestUtils.invokeMethod(service,"importKnowledge","11111111-1111-4111-8111-111111111111","run",input,owner,owner));
  }

  @Test void importedKnowledgeUsesTheExecutorWhileEvidenceRemainsWithTheInitiator() {
    var store=mock(OntologyAgentStore.class);var knowledge=mock(KnowledgeService.class);var identity=mock(IdentityService.class);
    var service=new KnowledgeGovernanceService(store,mock(AgentRuntimeClient.class),mock(GovernanceRuntimeClient.class),mock(OntologyAgentDefinitions.class),mock(QueryGrantService.class),knowledge,mock(AdminService.class),mock(AgentExecutionAccess.class));
    ReflectionTestUtils.setField(service,"identityService",identity);
    var owner=new OntologyAgentStore.Owner("initiator","domain");
    var executor=new OntologyAgentStore.Owner("executor","domain");
    when(identity.hasKnowledgeGovernanceAccess("executor","domain")).thenReturn(true);
    when(store.one(contains("ontology_governance_records"),any(),eq("initiator"),eq("domain"))).thenReturn(JSONObject.of("latest_run_id","11111111-1111-4111-8111-111111111111"));
    when(store.one(contains("SELECT work"),any())).thenReturn(JSONObject.of("work",JSONObject.of("sources",List.of(JSONObject.of("id","source")))));
    when(knowledge.getBussinessKnowledge("domain")).thenReturn(Map.of());
    var input=JSONObject.of("items",List.of(JSONObject.of("id","record","title","Fact","text","Text","sourceIds",List.of("source"))));
    ReflectionTestUtils.invokeMethod(service,"importKnowledge","11111111-1111-4111-8111-111111111111","run",input,owner,executor);
    verify(knowledge).addBussinessKnowledge(eq("record"),eq("Fact"),eq("Text"),eq(0),eq(List.of()),argThat(user->user.getId().equals("executor")));
    when(identity.hasKnowledgeGovernanceAccess("executor","domain")).thenReturn(false);
    assertThrows(AgentHttpException.class,()->ReflectionTestUtils.invokeMethod(service,"importKnowledge","11111111-1111-4111-8111-111111111111","run",input,owner,executor));
  }
}
