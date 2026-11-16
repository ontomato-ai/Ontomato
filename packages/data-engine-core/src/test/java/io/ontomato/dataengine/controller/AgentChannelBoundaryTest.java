package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.agent.*;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class AgentChannelBoundaryTest {
  private static final String SESSION="11111111-1111-4111-8111-111111111111", RUN="22222222-2222-4222-8222-222222222222";
  private final AgentCaller callers=mock(AgentCaller.class);
  private final AgentDirectory directory=mock(AgentDirectory.class);
  private final KnowledgeGovernanceService governance=mock(KnowledgeGovernanceService.class);
  private final OntologyAgentStore store=mock(OntologyAgentStore.class);
  private org.springframework.test.web.servlet.MockMvc mvc() {
    return MockMvcBuilders.standaloneSetup(new AgentChannelController(callers,directory,governance,store,mock(AgentRuntimeClient.class),mock(WorkbenchServiceAuthentication.class),mock(OntologyRetrievalService.class),mock(RetrievalTasks.class),mock(ActionCreationService.class),mock(OntologyGenerationService.class),mock(OntologyAgentAccess.class)))
      .addInterceptors(new BuildTestAccessInterceptor()).setControllerAdvice(new OntologyAgentErrors()).setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
  }
  private String input(String mode,String role) {
    return JSONObject.of("mode",mode,"language","en","agent",JSONObject.of("providerId","ontology","agentId",KnowledgeGovernanceService.AGENT),
      "actor",JSONObject.of("id",RUN,"domainId","a"),"sessionId",SESSION,"runId",RUN,
      "requestedBy",null,"root",JSONObject.of("session",JSONObject.of("providerId","ontology","sessionId",SESSION),"runId",RUN),"authority",JSONObject.of("classNames",java.util.List.of(),"executionKind","live"),
      "input",JSONObject.of("role",role,"kind","agent-answer","source",JSONObject.of("session",JSONObject.of("providerId","workbench","sessionId",SESSION),"runId",RUN),"replyTo",RUN,"content","Use the confirmed period","timestamp",1)).toJSONString();
  }
  @Test void jacksonMapsCarryTypedAnswersToTheSamePrepareEntrance() throws Exception {
    var owner=new OntologyAgentStore.Owner("user","a");
    when(callers.governance(any(),eq("a"),eq("en"))).thenReturn(new OntologyAgentAccess.Context(owner,null,null,null,"en",1000L,RUN));
    mvc().perform(post("/platform/agent-channel/prepare").header("X-Domain-Id","a").contentType(MediaType.APPLICATION_JSON).content(input("steer","notification"))).andExpect(status().isOk());
    verify(store).run(SESSION,RUN,owner);
    verifyNoInteractions(governance);
  }
  @Test void invalidModesAndRolesFailBeforeAnyBusinessAdmission() throws Exception {
    mvc().perform(post("/platform/agent-channel/prepare").header("X-Domain-Id","a").contentType(MediaType.APPLICATION_JSON).content(input("other","notification"))).andExpect(status().isBadRequest());
    mvc().perform(post("/platform/agent-channel/prepare").header("X-Domain-Id","a").contentType(MediaType.APPLICATION_JSON).content(input("run","assistant"))).andExpect(status().isBadRequest());
    mvc().perform(post("/platform/agent-channel/prepare").header("X-Domain-Id","a").contentType(MediaType.APPLICATION_JSON).content(input("run","notification").replace("Use the confirmed period","x".repeat(20001)))).andExpect(status().isBadRequest());
    verifyNoInteractions(callers,governance,store);
  }
  @Test void crossDomainReferencesFailBeforeLookingUpIdentityOrCredentials() {
    var jdbc=mock(org.springframework.jdbc.core.JdbcTemplate.class);
    var identities=mock(io.ontomato.dataengine.schedules.ScheduleIdentity.class);
    var caller=new AgentCaller(jdbc,identities,mock(io.ontomato.dataengine.service.IdentityService.class));
    var failure=assertThrows(AgentHttpException.class,()->caller.restore(JSONObject.of("id",RUN,"domainId","b"),"a"));
    assertEquals("CROSS_DOMAIN",failure.code());
    verifyNoInteractions(jdbc,identities);
  }
  @Test void callerAuthorizationDoesNotReuseTheBusinessRunId() throws Exception {
    var runtime=mock(AgentRuntimeClient.class);
    var context=new OntologyAgentAccess.Context(new OntologyAgentStore.Owner("user","a"),null,"login",null,"en",1000L,null);
    var host=new KnowledgeGovernanceService(store,runtime,mock(OntologyAgentDefinitions.class),mock(io.ontomato.dataengine.service.QueryGrantService.class),mock(io.ontomato.dataengine.service.KnowledgeService.class),mock(io.ontomato.dataengine.service.AdminService.class),callers);
    when(callers.open(anyString(),eq(context))).thenAnswer(call -> JSONObject.of("id",call.getArgument(0),"domainId","a"));
    host.start(SESSION,RUN,"Review knowledge",context);
    verify(callers).open(argThat(id -> !id.equals(RUN)),eq(context));
  }

  @Test void listUsesTheOntologyProviderProtocol() throws Exception {
    var actor=JSONObject.of("id",RUN,"domainId","a");
    when(directory.list(actor,"a")).thenReturn(JSONObject.of("agents",java.util.List.of()));
    mvc().perform(post("/platform/agent-channel/list").header("X-Domain-Id","a").contentType(MediaType.APPLICATION_JSON)
      .content(JSONObject.of("providerId","ontology","actor",actor).toJSONString())).andExpect(status().isOk());
    verify(directory).list(actor,"a");
  }
  @Test void ontologyDirectoryReturnsOnlyItsOwnAuthorizedDefinition() {
    var actor=JSONObject.of("id",RUN,"domainId","a");
    var identity=mock(io.ontomato.dataengine.service.IdentityService.class);
    when(callers.restore(actor,"a")).thenReturn(new AgentCaller.Actor(RUN,new io.ontomato.dataengine.service.QueryAccessService.GrantUser("user","a"),1000L));
    when(identity.hasKnowledgeGovernanceAccess("user","a")).thenReturn(true);
    var actions=mock(ActionCreationService.class);
    doThrow(new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.FORBIDDEN)).when(callers).requireQuery(any());
    when(governance.agents("a")).thenReturn(java.util.List.of(JSONObject.of("id",KnowledgeGovernanceService.AGENT,"name","Governance","description","")));
    var own=new AgentDirectory(callers,identity,actions,governance);
    var agents=own.list(actor,"a").getJSONArray("agents");
    assertEquals(1,agents.size());
    assertEquals("ontology",agents.getJSONObject(0).getJSONObject("ref").getString("providerId"));
    when(identity.hasKnowledgeGovernanceAccess("user","a")).thenReturn(false);
    assertTrue(own.list(actor,"a").getJSONArray("agents").isEmpty());
  }

  @Test void buildTestRequestsCannotReachChannelCommandsStreamsOrProviderCallbacks() throws Exception {
    var mvc=mvc();String header="{\"kind\":\"build-test\",\"contextId\":null}";
    for(String action:java.util.List.of("commands","list","prepare","settle","read","cancel","callers","restore"))
      mvc.perform(post("/platform/agent-channel/"+action).header("X-Ontomato-Execution-Context",header).contentType(MediaType.APPLICATION_JSON).content("{}"))
        .andExpect(status().isUnprocessableEntity());
    for(String path:java.util.List.of("/tasks/"+RUN+"/events","/tasks/"+RUN+"/files/"+SESSION))
      mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/platform/agent-channel"+path).header("X-Ontomato-Execution-Context",header)).andExpect(status().isUnprocessableEntity());
    verifyNoInteractions(callers,directory,governance,store);
  }

  @Test void executionRestoreRequiresTheOriginalCredentialInsteadOfRecoveringAnInternalKey() {
    var jdbc=mock(org.springframework.jdbc.core.JdbcTemplate.class);
    var identities=mock(io.ontomato.dataengine.schedules.ScheduleIdentity.class);
    var identity=mock(io.ontomato.dataengine.service.IdentityService.class);
    when(jdbc.queryForList(anyString(),any(Object[].class))).thenReturn(java.util.List.of(java.util.Map.of("user_id","user","domain_id","a","deadline",new java.sql.Timestamp(System.currentTimeMillis()+60000))));
    var caller=new AgentCaller(jdbc,identities,identity);var ref=JSONObject.of("id",RUN,"domainId","a");
    when(identity.getCurrentUser()).thenReturn(new io.ontomato.dataengine.service.QueryAccessService.GrantUser("user","a"));
    assertEquals("user",caller.restore(ref,"a").owner().userId());
    when(identity.getCurrentUser()).thenReturn(null);
    assertEquals("CALLER_CREDENTIAL_INVALID",assertThrows(AgentHttpException.class,()->caller.restore(ref,"a")).code());
    verifyNoInteractions(identities);
  }

}
