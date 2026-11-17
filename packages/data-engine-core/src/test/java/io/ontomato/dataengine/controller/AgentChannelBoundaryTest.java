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
  private final OntologyAgentStore store=mock(OntologyAgentStore.class);
  private org.springframework.test.web.servlet.MockMvc mvc() {
    return MockMvcBuilders.standaloneSetup(new AgentChannelController(callers,directory,store,mock(AgentRuntimeClient.class),mock(WorkbenchServiceAuthentication.class),mock(OntologyRetrievalService.class),mock(RetrievalTasks.class),mock(ActionCreationService.class),mock(OntologyGenerationService.class),mock(OntologyAgentAccess.class),mock(io.ontomato.dataengine.service.LangService.class)))
      .addInterceptors(new BuildTestAccessInterceptor()).setControllerAdvice(new OntologyAgentErrors()).setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
  }
  private String input(String mode,String role) {
    return JSONObject.of("mode",mode,"language","en","agent",JSONObject.of("providerId","ontology","agentId",ActionCreationService.AGENT),
      "actor",JSONObject.of("id",RUN,"domainId","a"),"sessionId",SESSION,"runId",RUN,"inputId",RUN,
      "requestedBy",null,"root",JSONObject.of("session",JSONObject.of("providerId","ontology","sessionId",SESSION),"runId",RUN),"authority",JSONObject.of("classNames",java.util.List.of(),"executionKind","live"),
      "input",JSONObject.of("role",role,"kind","agent-answer","source",JSONObject.of("session",JSONObject.of("providerId","workbench","sessionId",SESSION),"runId",RUN),"replyTo",RUN,"content","Use the confirmed period","timestamp",1)).toJSONString();
  }
  @Test void jacksonMapsCarryTypedAnswersToTheSamePrepareEntrance() throws Exception {
    var owner=new OntologyAgentStore.Owner("user","a");
    when(callers.query(any(),eq("a"),eq("en"),any(),any(),any())).thenReturn(new OntologyAgentAccess.Context(owner,null,null,null,"en",1000L,RUN));
    mvc().perform(post("/platform/agent-channel/prepare").header("X-Domain-Id","a").contentType(MediaType.APPLICATION_JSON).content(input("steer","notification"))).andExpect(status().isOk());
    verify(store).run(SESSION,RUN,owner);
  }
  @Test void invalidModesAndRolesFailBeforeAnyBusinessAdmission() throws Exception {
    mvc().perform(post("/platform/agent-channel/prepare").header("X-Domain-Id","a").contentType(MediaType.APPLICATION_JSON).content(input("other","notification"))).andExpect(status().isBadRequest());
    mvc().perform(post("/platform/agent-channel/prepare").header("X-Domain-Id","a").contentType(MediaType.APPLICATION_JSON).content(input("run","assistant"))).andExpect(status().isBadRequest());
    mvc().perform(post("/platform/agent-channel/prepare").header("X-Domain-Id","a").contentType(MediaType.APPLICATION_JSON).content(input("run","notification").replace("Use the confirmed period","x".repeat(20001)))).andExpect(status().isBadRequest());
    verifyNoInteractions(callers,store);
  }
  @Test void crossDomainReferencesFailBeforeLookingUpIdentityOrCredentials() {
    var jdbc=mock(org.springframework.jdbc.core.JdbcTemplate.class);
    var identities=mock(io.ontomato.dataengine.schedules.ScheduleIdentity.class);
    var caller=new AgentCaller(jdbc,identities,mock(io.ontomato.dataengine.service.IdentityService.class));
    var failure=assertThrows(AgentHttpException.class,()->caller.restore(JSONObject.of("id",RUN,"domainId","b"),"a"));
    assertEquals("CROSS_DOMAIN",failure.code());
    verifyNoInteractions(jdbc,identities);
  }
  @Test void listUsesTheOntologyProviderProtocol() throws Exception {
    var actor=JSONObject.of("id",RUN,"domainId","a");
    when(directory.list(actor,"a","en")).thenReturn(JSONObject.of("agents",java.util.List.of()));
    mvc().perform(post("/platform/agent-channel/list").header("X-Domain-Id","a").contentType(MediaType.APPLICATION_JSON)
      .content(JSONObject.of("providerId","ontology","actor",actor,"language","en").toJSONString())).andExpect(status().isOk());
    verify(directory).list(actor,"a","en");
  }
  @Test void buildTestRequestsCannotReachChannelCommandsStreamsOrProviderCallbacks() throws Exception {
    var mvc=mvc();String header="{\"kind\":\"build-test\",\"contextId\":null}";
    for(String action:java.util.List.of("commands","list","prepare","settle","read","cancel","callers","restore"))
      mvc.perform(post("/platform/agent-channel/"+action).header("X-Ontomato-Execution-Context",header).contentType(MediaType.APPLICATION_JSON).content("{}"))
        .andExpect(status().isUnprocessableEntity());
    for(String path:java.util.List.of("/tasks/"+RUN+"/events","/tasks/"+RUN+"/files/"+SESSION))
      mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/platform/agent-channel"+path).header("X-Ontomato-Execution-Context",header)).andExpect(status().isUnprocessableEntity());
    verifyNoInteractions(callers,directory,store);
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

  @Test void retrievalReadSummarizesBothBranchesAndExportsOriginalDatasetBytes() throws Exception {
    var retrieval=mock(OntologyRetrievalService.class);var tasks=mock(RetrievalTasks.class);
    var labels=mock(io.ontomato.dataengine.service.LangService.class);
    var controller=new AgentChannelController(callers,directory,store,mock(AgentRuntimeClient.class),mock(WorkbenchServiceAuthentication.class),retrieval,tasks,mock(ActionCreationService.class),mock(OntologyGenerationService.class),mock(OntologyAgentAccess.class),labels);
    var actor=JSONObject.of("id",RUN,"domainId","a");
    var owner=new OntologyAgentStore.Owner("user","a");
    when(callers.restore(actor,"a",false)).thenReturn(new AgentCaller.Actor(RUN,new io.ontomato.dataengine.service.QueryAccessService.GrantUser("user","a"),1000L));
    when(store.session(SESSION,owner)).thenReturn(JSONObject.of("agent_id",OntologyAgentStore.RETRIEVER));
    when(store.run(SESSION,RUN,owner)).thenReturn(JSONObject.of("language","zh-CN","runtime_admitted",false));
    when(tasks.read(SESSION,RUN,owner)).thenReturn(JSONObject.of("status","completed","settled",true,"quality",java.util.List.of()));
    when(retrieval.deliveries(SESSION,RUN,owner)).thenReturn(java.util.List.of(
      JSONObject.of("source","binding","data",JSONObject.of("answer","","datasets",java.util.List.of(JSONObject.of("id",SESSION,"rowCount",5)))),
      JSONObject.of("source","retriever","data",JSONObject.of("answer","## Full answer\n|学院|人数|","datasets",java.util.List.of(JSONObject.of("id",RUN,"rowCount",5))))));
    when(labels.get("zh-CN","AgentChannel.retrieval.completed")).thenReturn("取数已完成，交付 {0} 个数据集、{1} 行，文件：{2}。");
    var input=JSONObject.of("actor",actor,"execution",JSONObject.of("session",JSONObject.of("providerId","ontology","sessionId",SESSION),"runId",RUN));
    var request=new org.springframework.mock.web.MockHttpServletRequest();request.addHeader("X-Domain-Id","a");
    var result=(JSONObject)controller.read(input,request);
    assertEquals("取数已完成，交付 2 个数据集、10 行，文件："+SESSION+".dataset.json, "+RUN+".dataset.json。",result.getString("summary"));
    var files=result.getJSONArray("files");assertEquals(SESSION+".dataset.json",files.getJSONObject(0).getString("name"));
    byte[] original="{\"execution\":{\"receiptId\":\"binding-receipt\"},\"rows\":[[0,false,null]]}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
    when(retrieval.datasetContent(SESSION,SESSION,owner)).thenReturn(original);
    input.put("fileId",SESSION);
    assertArrayEquals(original,(byte[])((org.springframework.http.ResponseEntity<?>)controller.read(input,request)).getBody());
  }

  @Test void removedOntologyGovernanceCannotBeReadThroughTheGenericProvider() throws Exception {
    var actor=JSONObject.of("id",RUN,"domainId","a");
    var owner=new OntologyAgentStore.Owner("user","a");
    when(callers.restore(actor,"a",false)).thenReturn(new AgentCaller.Actor(RUN,new io.ontomato.dataengine.service.QueryAccessService.GrantUser("user","a"),1000L));
    when(store.session(SESSION,owner)).thenReturn(JSONObject.of("agent_id","56a15178-ae22-4e6f-9974-ababeb42a676"));
    var input=JSONObject.of("actor",actor,"execution",JSONObject.of("session",JSONObject.of("providerId","ontology","sessionId",SESSION),"runId",RUN));
    mvc().perform(post("/platform/agent-channel/read").header("X-Domain-Id","a").contentType(MediaType.APPLICATION_JSON).content(input.toJSONString())).andExpect(status().isNotFound());
    verify(store,never()).run(anyString(),anyString(),any());
  }

  @Test void backgroundGenerationDoesNotConsultWebIdentity() {
    var identity=mock(io.ontomato.dataengine.service.IdentityService.class);
    when(identity.getCurrentUser()).thenThrow(new IllegalStateException("No web context on a quality worker"));
    var caller=new AgentCaller(mock(org.springframework.jdbc.core.JdbcTemplate.class),mock(io.ontomato.dataengine.schedules.ScheduleIdentity.class),identity);
    var access=new io.ontomato.dataengine.service.QueryAccessService.Access(new io.ontomato.dataengine.service.QueryAccessService.GrantUser("user","a"),null,null,null,1000L);
    var context=caller.ownerContext(new OntologyAgentStore.Owner("user","a"),access,"en",2000L);
    assertNull(context.token());assertNull(context.apiKey());assertEquals(1000L,context.expiresAt());
    verify(identity,never()).getCurrentUser();
  }

}
