package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.authorization.AuthorizationService.Decision;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import java.util.List;
import io.ontomato.dataengine.service.agent.*;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class AgentChannelBoundaryTest {
  private static final String SESSION="11111111-1111-4111-8111-111111111111", RUN="22222222-2222-4222-8222-222222222222";
  private final RetrieverAccess retrieverAccess = mock(RetrieverAccess.class);
  private final AgentCaller callers=mock(AgentCaller.class);
  private final AgentDirectory directory=mock(AgentDirectory.class);
  private final OntologyAgentStore store=mock(OntologyAgentStore.class);
  private org.springframework.test.web.servlet.MockMvc mvc() {
    return MockMvcBuilders.standaloneSetup(new AgentChannelController(callers,directory,store,mock(AgentRuntimeClient.class),mock(WorkbenchServiceAuthentication.class),mock(OntologyRetrievalService.class),mock(RetrievalTasks.class),mock(ActionCreationService.class),mock(OntologyGenerationService.class),mock(OntologyAgentAccess.class),mock(io.ontomato.dataengine.service.LangService.class),mock(io.ontomato.dataengine.service.RuntimeCodeClient.class)))
      .setControllerAdvice(new OntologyAgentErrors((language, key) -> key)).setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
  }
  private String input(String mode,String role) {
    return JSONObject.of("mode",mode,"language","en","agent",JSONObject.of("providerId","ontology","agentId",ActionCreationService.AGENT),
      "actor",JSONObject.of("id",RUN,"domainId","a"),"sessionId",SESSION,"runId",RUN,"inputId",RUN,
      "requestedBy",null,"root",JSONObject.of("session",JSONObject.of("providerId","ontology","sessionId",SESSION),"runId",RUN),"authority",JSONObject.of("classNames",java.util.List.of(),"executionKind","live"),
      "input",JSONObject.of("role",role,"kind","agent-answer","source",JSONObject.of("session",JSONObject.of("providerId","workbench","sessionId",SESSION),"runId",RUN),"replyTo",RUN,"content","Use the confirmed period","timestamp",1)).toJSONString();
  }
  @Test void sessionActorReadRequiresServiceAuthenticationAndUsesTheExistingGateway() throws Exception {
    var runtime=mock(AgentRuntimeClient.class);
    var actor=JSONObject.of("id",RUN,"domainId","a");
    when(runtime.json(eq("a"),eq(SESSION),eq("/v1/channel/providers/workbench/sessions/"+SESSION+"/actor"),eq("GET"),isNull(),isNull())).thenReturn(JSONObject.of("actor",actor));
    var controller=new AgentChannelController(callers,directory,store,runtime,new WorkbenchServiceAuthentication("service-secret"),mock(OntologyRetrievalService.class),mock(RetrievalTasks.class),mock(ActionCreationService.class),mock(OntologyGenerationService.class),mock(OntologyAgentAccess.class),mock(io.ontomato.dataengine.service.LangService.class),mock(io.ontomato.dataengine.service.RuntimeCodeClient.class));
    var http=MockMvcBuilders.standaloneSetup(controller).setControllerAdvice(new OntologyAgentErrors((language, key) -> key)).setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    String request=JSONObject.of("providerId","workbench","sessionId",SESSION).toJSONString();
    http.perform(post("/platform/agent-channel/session-actor").header("X-Domain-Id","a").contentType(MediaType.APPLICATION_JSON).content(request)).andExpect(status().isForbidden());
    verifyNoInteractions(runtime);
    var result=http.perform(post("/platform/agent-channel/session-actor").header("X-Domain-Id","a").header(WorkbenchServiceAuthentication.HEADER,"service-secret").contentType(MediaType.APPLICATION_JSON).content(request)).andExpect(status().isOk()).andReturn();
    assertEquals(actor,JSONObject.parseObject(result.getResponse().getContentAsString()));
    verify(runtime).json(eq("a"),eq(SESSION),eq("/v1/channel/providers/workbench/sessions/"+SESSION+"/actor"),eq("GET"),isNull(),isNull());
    http.perform(post("/platform/agent-channel/session-actor").header(WorkbenchServiceAuthentication.HEADER,"service-secret").contentType(MediaType.APPLICATION_JSON).content(request)).andExpect(status().isBadRequest());
    http.perform(post("/platform/agent-channel/session-actor").header("X-Domain-Id","a").header(WorkbenchServiceAuthentication.HEADER,"service-secret").contentType(MediaType.APPLICATION_JSON).content("{\"providerId\":\"workbench\",\"sessionId\":\"invalid\"}")).andExpect(status().isBadRequest());
    verifyNoMoreInteractions(runtime);
  }
  @Test void jacksonMapsCarryTypedAnswersToTheSamePrepareEntrance() throws Exception {
    var owner=new OntologyAgentStore.Owner("user","a");
    when(callers.query(any(),eq("a"),eq("en"),any(),any(),any(),isNull())).thenReturn(new OntologyAgentAccess.Context(owner,null,null,null,"en",1000L,RUN));
    mvc().perform(post("/platform/agent-channel/prepare").header("X-Domain-Id","a").contentType(MediaType.APPLICATION_JSON).content(input("steer","notification"))).andExpect(status().isOk());
    verify(store).run(SESSION,RUN,owner);
  }
  @Test void trustedHumanRecipientAndSelectedOptionSurviveTheRealJacksonPrepareBoundary() throws Exception {
    var owner=new OntologyAgentStore.Owner("user","a");
    when(callers.query(any(),eq("a"),eq("en"),any(),any(),any(),isNull())).thenReturn(new OntologyAgentAccess.Context(owner,null,null,null,"en",1000L,RUN));
    var body=JSONObject.parseObject(input("steer","notification"));
    body.put("userRecipient",JSONObject.of("session",JSONObject.of("providerId","workbench","sessionId",SESSION),"actor",JSONObject.of("id",RUN,"domainId","a")));
    body.getJSONObject("input").put("selectedOption",1);
    body.getJSONObject("input").put("respondent",JSONObject.of("id",RUN,"domainId","a"));
    mvc().perform(post("/platform/agent-channel/prepare").header("X-Domain-Id","a").contentType(MediaType.APPLICATION_JSON).content(body.toJSONString())).andExpect(status().isOk());
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
    var caller=new AgentCaller(jdbc,identities,mock(io.ontomato.dataengine.service.IdentityService.class),retrieverAccess);
    var failure=assertThrows(AgentHttpException.class,()->caller.restore(JSONObject.of("id",RUN,"domainId","b"),"a"));
    assertEquals("CROSS_DOMAIN",failure.code());
    verifyNoInteractions(jdbc,identities);
  }
  @Test void listUsesTheOntologyProviderProtocol() throws Exception {
    var actor=JSONObject.of("id",RUN,"domainId","a");
    when(directory.list(actor,"a","en",null)).thenReturn(JSONObject.of("agents",java.util.List.of()));
    mvc().perform(post("/platform/agent-channel/list").header("X-Domain-Id","a").contentType(MediaType.APPLICATION_JSON)
      .content(JSONObject.of("providerId","ontology","actor",actor,"language","en").toJSONString())).andExpect(status().isOk());
    verify(directory).list(actor,"a","en",null);
  }

  @Test void executionRestoreRequiresTheOriginalCredentialInsteadOfRecoveringAnInternalKey() {
    var jdbc=mock(org.springframework.jdbc.core.JdbcTemplate.class);
    var identities=mock(io.ontomato.dataengine.schedules.ScheduleIdentity.class);
    var identity=mock(io.ontomato.dataengine.service.IdentityService.class);
    when(jdbc.queryForList(anyString(),any(Object[].class))).thenReturn(java.util.List.of(java.util.Map.of("user_id","user","domain_id","a","deadline",new java.sql.Timestamp(System.currentTimeMillis()+60000))));
    var caller=new AgentCaller(jdbc,identities,identity,retrieverAccess);var ref=JSONObject.of("id",RUN,"domainId","a");
    when(identity.getCurrentUser()).thenReturn(new io.ontomato.dataengine.service.QueryAccessService.GrantUser("user","a"));
    assertEquals("user",caller.restore(ref,"a").owner().userId());
    when(identity.getCurrentUser()).thenReturn(null);
    assertEquals("CALLER_CREDENTIAL_INVALID",assertThrows(AgentHttpException.class,()->caller.restore(ref,"a")).code());
    verifyNoInteractions(identities);
  }

  @Test void retrievalReadSummarizesTheDeliveryAndExportsOriginalDatasetBytes() throws Exception {
    var retrieval=mock(OntologyRetrievalService.class);var tasks=mock(RetrievalTasks.class);
    var labels=mock(io.ontomato.dataengine.service.LangService.class);
    var controller=new AgentChannelController(callers,directory,store,mock(AgentRuntimeClient.class),mock(WorkbenchServiceAuthentication.class),retrieval,tasks,mock(ActionCreationService.class),mock(OntologyGenerationService.class),mock(OntologyAgentAccess.class),labels,mock(io.ontomato.dataengine.service.RuntimeCodeClient.class));
    var actor=JSONObject.of("id",RUN,"domainId","a");
    var owner=new OntologyAgentStore.Owner("user","a");
    when(callers.restore(actor,"a",false)).thenReturn(new AgentCaller.Actor(RUN,new io.ontomato.dataengine.service.QueryAccessService.GrantUser("user","a"),1000L));
    when(store.session(SESSION,owner)).thenReturn(JSONObject.of("agent_id",OntologyAgentStore.RETRIEVER));
    when(store.run(SESSION,RUN,owner)).thenReturn(JSONObject.of("language","zh-CN","runtime_admitted",false));
    when(tasks.read(SESSION,RUN,owner)).thenReturn(JSONObject.of("status","completed","settled",true));
    when(retrieval.deliveries(SESSION,RUN,owner)).thenReturn(java.util.List.of(
      JSONObject.of("data",JSONObject.of("answer","## Full answer\n|学院|人数|","datasets",java.util.List.of(JSONObject.of("id",SESSION,"rowCount",5),JSONObject.of("id",RUN,"rowCount",5))))));
    when(labels.get("zh-CN","AgentChannel.retrieval.completed")).thenReturn("取数已完成：{0} 个数据集、{1} 行。此通知表示结果已交付，不表示文件已在用户界面展示。");
    var input=JSONObject.of("actor",actor,"execution",JSONObject.of("session",JSONObject.of("providerId","ontology","sessionId",SESSION),"runId",RUN));
    var request=new org.springframework.mock.web.MockHttpServletRequest();request.addHeader("X-Domain-Id","a");
    var result=(JSONObject)controller.read(input,request);
    // The requester reads counts, never bare file names it could mistake for something already shown; the files stay in files[].
    assertEquals("取数已完成：2 个数据集、10 行。此通知表示结果已交付，不表示文件已在用户界面展示。",result.getString("summary"));
    var files=result.getJSONArray("files");assertEquals(SESSION+".dataset.json",files.getJSONObject(0).getString("name"));
    byte[] original="{\"execution\":{\"receiptId\":\"retriever-receipt\"},\"rows\":[[0,false,null]]}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
    when(retrieval.datasetContent(SESSION,SESSION,owner)).thenReturn(original);
    verify(retrieval).requireUse(owner);
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
    var caller=new AgentCaller(mock(org.springframework.jdbc.core.JdbcTemplate.class),mock(io.ontomato.dataengine.schedules.ScheduleIdentity.class),identity,retrieverAccess);
    var access=new io.ontomato.dataengine.service.QueryAccessService.Access(new io.ontomato.dataengine.service.QueryAccessService.GrantUser("user","a"),null,null,null,1000L);
    var context=caller.ownerContext(new OntologyAgentStore.Owner("user","a"),access,"en",2000L);
    assertNull(context.token());assertNull(context.apiKey());assertEquals(1000L,context.expiresAt());
    verify(identity,never()).getCurrentUser();
  }


  @Test void jacksonBoundaryKeepsInitiatorOwnershipAndExecutorDataIdentity() throws Exception {
    var executorRef=JSONObject.of("userId","V","domainId","a");
    var owner=new OntologyAgentStore.Owner("U","a");
    var permission=new io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission();permission.setFullData(true);
    var dataAccess=new io.ontomato.dataengine.service.QueryAccessService.Access(new io.ontomato.dataengine.service.QueryAccessService.GrantUser("V","a"),permission,null,null,null).withExecution("V","U");
    var admitted=new OntologyAgentAccess.Context(owner,dataAccess,null,null,"en",null,null,"V");
    when(callers.retrieval(any(),eq("a"),eq("en"),any(),isNull(),any(),eq(executorRef))).thenReturn(admitted);
    var retrieval=mock(OntologyRetrievalService.class);
    when(retrieval.prepareRun(eq(SESSION),eq(RUN),any(),eq(RUN),isNull(),eq(RUN),eq(admitted),eq("live"))).thenReturn(JSONObject.of("input",JSONObject.of("role","user","content","Question")));
    var controller=new AgentChannelController(callers,directory,store,mock(AgentRuntimeClient.class),mock(WorkbenchServiceAuthentication.class),retrieval,mock(RetrievalTasks.class),mock(ActionCreationService.class),mock(OntologyGenerationService.class),mock(OntologyAgentAccess.class),mock(io.ontomato.dataengine.service.LangService.class),mock(io.ontomato.dataengine.service.RuntimeCodeClient.class));
    var mvc=MockMvcBuilders.standaloneSetup(controller).setControllerAdvice(new OntologyAgentErrors((language, key) -> key)).setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    var body=JSONObject.parseObject(input("run","user"));body.getJSONObject("agent").put("agentId",OntologyAgentStore.RETRIEVER);body.put("executionActor",executorRef);
    var response=mvc.perform(post("/platform/agent-channel/prepare").header("X-Domain-Id","a").contentType(MediaType.APPLICATION_JSON).content(body.toJSONString())).andExpect(status().isOk()).andReturn().getResponse();
    assertEquals("V",JSONObject.parseObject(response.getContentAsString()).getJSONObject("executionActor").getString("userId"));
    verify(retrieval).prepareRun(eq(SESSION),eq(RUN),any(),eq(RUN),isNull(),eq(RUN),argThat(context->context.owner().userId().equals("U")&&context.access().user().getId().equals("V")),eq("live"));
  }

  @Test void aRetrieverAPreviewRunDelegatesToIsAdmittedAndRunsAsThatPreview() throws Exception {
    var owner=new OntologyAgentStore.Owner("U","a");
    var permission=new io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission();permission.setFullData(true);
    var admitted=new OntologyAgentAccess.Context(owner,new io.ontomato.dataengine.service.QueryAccessService.Access(
        new io.ontomato.dataengine.service.QueryAccessService.GrantUser("U","a"),permission,null,null,null),null,null,"en",null,null);
    when(callers.retrieval(any(),eq("a"),eq("en"),any(),any(),any(),isNull())).thenReturn(admitted);
    var retrieval=mock(OntologyRetrievalService.class);
    when(retrieval.prepareRun(eq(SESSION),eq(RUN),any(),eq(RUN),isNull(),eq(RUN),eq(admitted),eq("preview")))
        .thenReturn(JSONObject.of("definition",JSONObject.of("systemPrompt","Retrieve"),
            "authority",JSONObject.of("classNames",List.of(),"executionKind","preview")));
    var controller=new AgentChannelController(callers,directory,store,mock(AgentRuntimeClient.class),mock(WorkbenchServiceAuthentication.class),retrieval,mock(RetrievalTasks.class),mock(ActionCreationService.class),mock(OntologyGenerationService.class),mock(OntologyAgentAccess.class),mock(io.ontomato.dataengine.service.LangService.class),mock(io.ontomato.dataengine.service.RuntimeCodeClient.class));
    var mvc=MockMvcBuilders.standaloneSetup(controller).setControllerAdvice(new OntologyAgentErrors((language, key) -> key)).setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    var body=JSONObject.parseObject(input("run","user"));body.getJSONObject("agent").put("agentId",OntologyAgentStore.RETRIEVER);
    body.put("authority",JSONObject.of("classNames",List.of(),"executionKind","preview"));
    body.put("requestedBy",JSONObject.of("session",JSONObject.of("providerId","workbench","sessionId",SESSION),"runId",RUN));
    var response=mvc.perform(post("/platform/agent-channel/prepare").header("X-Domain-Id","a").contentType(MediaType.APPLICATION_JSON).content(body.toJSONString())).andExpect(status().isOk()).andReturn().getResponse();
    assertEquals("preview",JSONObject.parseObject(response.getContentAsString()).getJSONObject("authority").getString("executionKind"));
  }

  @Test void anAgentAPreviewStartsThroughTheChannelRunsAsThePreview() throws Exception {
    var runtime=mock(AgentRuntimeClient.class);
    var access=mock(OntologyAgentAccess.class);
    var owner=new OntologyAgentStore.Owner("U","a");
    when(access.authenticated(any())).thenReturn(new OntologyAgentAccess.Context(owner,null,"tk",null,"en",null,null));
    when(callers.open(anyString(),any(OntologyAgentAccess.Context.class))).thenReturn(JSONObject.of("id",RUN,"domainId","a"));
    var controller=new AgentChannelController(callers,directory,store,runtime,mock(WorkbenchServiceAuthentication.class),mock(OntologyRetrievalService.class),mock(RetrievalTasks.class),mock(ActionCreationService.class),mock(OntologyGenerationService.class),access,mock(io.ontomato.dataengine.service.LangService.class),mock(io.ontomato.dataengine.service.RuntimeCodeClient.class));
    var mvc=MockMvcBuilders.standaloneSetup(controller).setControllerAdvice(new OntologyAgentErrors((language, key) -> key)).setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    String start=JSONObject.of("op","start","agent",JSONObject.of("providerId","workbench","agentId","analyst"),"message","How many orders?").toJSONString();
    mvc.perform(post("/platform/agent-channel/commands").header(io.ontomato.dataengine.service.PreviewExecution.HEADER,"{\"kind\":\"preview\"}")
        .contentType(MediaType.APPLICATION_JSON).content(start)).andExpect(status().isOk());
    mvc.perform(post("/platform/agent-channel/commands").contentType(MediaType.APPLICATION_JSON).content(start)).andExpect(status().isOk());
    var sent=org.mockito.ArgumentCaptor.forClass(JSONObject.class);
    verify(runtime,times(2)).json(eq("a"),eq(RUN),eq("/v1/channel/commands"),eq("POST"),sent.capture(),isNull());
    assertEquals(List.of("preview","live"),sent.getAllValues().stream().map(request->request.getJSONObject("authority").getString("executionKind")).toList());
  }

  @Test void aRunsCallbackCannotUseTheExternalEntryNorOpenATopLevelConversation() throws Exception {
    var runtime=mock(AgentRuntimeClient.class);
    var access=mock(OntologyAgentAccess.class);
    var owner=new OntologyAgentStore.Owner("U","a");
    when(access.authenticated(any())).thenReturn(new OntologyAgentAccess.Context(owner,null,"tk",null,"en",null,null));
    when(access.forAgentUse(any(),anyString())).thenReturn(new OntologyAgentAccess.Context(owner,null,"tk",null,"en",null,null));
    when(callers.open(anyString(),any(OntologyAgentAccess.Context.class))).thenReturn(JSONObject.of("id",RUN,"domainId","a"));
    var controller=new AgentChannelController(callers,directory,store,runtime,mock(WorkbenchServiceAuthentication.class),mock(OntologyRetrievalService.class),mock(RetrievalTasks.class),mock(ActionCreationService.class),mock(OntologyGenerationService.class),access,mock(io.ontomato.dataengine.service.LangService.class),mock(io.ontomato.dataengine.service.RuntimeCodeClient.class));
    var host=mock(OntologyAgentHost.class);
    var mvc=MockMvcBuilders.standaloneSetup(controller,new OntologyAgentController(host,access,runtime,mock(OntologyRetrievalService.class)))
        .setControllerAdvice(new OntologyAgentErrors((language, key) -> key)).setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    String start=JSONObject.of("op","start","agent",JSONObject.of("providerId","workbench","agentId","analyst"),"message","How many orders?").toJSONString();
    // Node's callback proxy always adds the header to a run's request; the run cannot drop it.
    for (String command : List.of(start,JSONObject.of("op","list").toJSONString(),JSONObject.of("op","cancel","taskId",RUN).toJSONString()))
      mvc.perform(post("/platform/agent-channel/commands").header(OntologyAgentAccess.AGENT_EXECUTION_HEADER,RUN)
          .contentType(MediaType.APPLICATION_JSON).content(command)).andExpect(status().isForbidden());
    String create=JSONObject.of("agentId",OntologyAgentStore.RETRIEVER).toJSONString();
    mvc.perform(post("/ontology/ai/sessions").header(OntologyAgentAccess.AGENT_EXECUTION_HEADER,RUN).header("Idempotency-Key",SESSION)
        .contentType(MediaType.APPLICATION_JSON).content(create)).andExpect(status().isForbidden());
    String send=JSONObject.of("message","Count the orders").toJSONString();
    mvc.perform(post("/ontology/ai/sessions/"+SESSION+"/runs").header(OntologyAgentAccess.AGENT_EXECUTION_HEADER,RUN).header("Idempotency-Key",RUN)
        .contentType(MediaType.APPLICATION_JSON).content(send)).andExpect(status().isForbidden());
    verify(callers,never()).open(anyString(),any(OntologyAgentAccess.Context.class));
    verify(runtime,never()).json(anyString(),anyString(),anyString(),anyString(),any(),any());
    verify(host,never()).create(any(),any(),any());
    verify(host,never()).send(any(),any(),any(),any(),any(),any(),anyBoolean());
    // A person outside the product, without it, starts an agent and opens a conversation as before.
    mvc.perform(post("/platform/agent-channel/commands").contentType(MediaType.APPLICATION_JSON).content(start)).andExpect(status().isOk());
    mvc.perform(post("/ontology/ai/sessions").header("Idempotency-Key",SESSION).contentType(MediaType.APPLICATION_JSON).content(create))
        .andExpect(status().isCreated());
    verify(runtime).json(eq("a"),eq(RUN),eq("/v1/channel/commands"),eq("POST"),any(),isNull());
    verify(host).create(SESSION,OntologyAgentStore.RETRIEVER,owner);
    when(access.forSessionUse(any(),eq(SESSION))).thenReturn(new OntologyAgentAccess.Context(owner,null,"tk",null,"en",null,null));
    mvc.perform(post("/ontology/ai/sessions/"+SESSION+"/runs").header("Idempotency-Key",RUN).contentType(MediaType.APPLICATION_JSON).content(send))
        .andExpect(status().isAccepted());
    verify(host).send(eq(SESSION),eq(RUN),eq("Count the orders"),isNull(),isNull(),any(),eq(false));
  }

  @Test void aPreviewStopsARunAndDeletesAConversationAsAnyoneMay() throws Exception {
    var runtime=mock(AgentRuntimeClient.class);
    var access=mock(OntologyAgentAccess.class);
    var host=mock(OntologyAgentHost.class);
    var owner=new OntologyAgentStore.Owner("U","a");
    when(access.forSession(any(),eq(SESSION))).thenReturn(new OntologyAgentAccess.Context(owner,null,"tk",null,"en",null,null));
    when(access.reader(any(),eq(SESSION),isNull())).thenReturn(owner);
    var mvc=MockMvcBuilders.standaloneSetup(new OntologyAgentController(host,access,runtime,mock(OntologyRetrievalService.class)))
        .setControllerAdvice(new OntologyAgentErrors((language, key) -> key)).setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    String preview="{\"kind\":\"preview\"}";
    // Stopping and deleting are not business writes: the preview identity is no part of them.
    mvc.perform(post("/ontology/ai/sessions/"+SESSION+"/runs/"+RUN+"/cancel").header(io.ontomato.dataengine.service.PreviewExecution.HEADER,preview))
        .andExpect(status().isOk());
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/ontology/ai/sessions/"+SESSION)
        .header(io.ontomato.dataengine.service.PreviewExecution.HEADER,preview)).andExpect(status().isNoContent());
    verify(host).cancel(SESSION,RUN,owner);
    verify(host).delete(SESSION,owner);
    verifyNoInteractions(runtime);
  }

  @Test void callerRestorationUsesTheExecutorPermissionWithoutReplacingTheInitiator() {
    var jdbc=mock(org.springframework.jdbc.core.JdbcTemplate.class);
    when(jdbc.queryForList(anyString(),any(Object[].class))).thenReturn(java.util.List.of(java.util.Map.of("user_id","U","domain_id","a","deadline",new java.sql.Timestamp(System.currentTimeMillis()+60000))));
    var identity=mock(io.ontomato.dataengine.service.IdentityService.class);
    var initiator=new io.ontomato.dataengine.service.QueryAccessService.GrantUser("U","a");
    var executor=new io.ontomato.dataengine.service.QueryAccessService.GrantUser("V","a");
    when(identity.getCurrentUser()).thenReturn(initiator);
    var identities=mock(io.ontomato.dataengine.schedules.ScheduleIdentity.class);
    var permission=new io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission();permission.setFullData(true);
    when(identities.dataPermission("a","V")).thenReturn(permission);
    var execution=mock(AgentExecutionAccess.class);when(execution.require("a","V")).thenReturn(executor);
    var caller=new AgentCaller(jdbc,identities,identity,retrieverAccess);org.springframework.test.util.ReflectionTestUtils.setField(caller,"executions",execution);
    var restored=caller.query(JSONObject.of("id",RUN,"domainId","a"),"a","en",JSONObject.of("classNames",java.util.List.of("Orders"),"executionKind","live"),null,JSONObject.of("runId",RUN),JSONObject.of("userId","V","domainId","a"));
    assertEquals("U",restored.owner().userId());assertEquals("V",restored.access().user().getId());assertEquals(java.util.List.of("Orders"),restored.access().classNames());
    verify(identity).requireQueryAccess("V","a");verify(execution).require("a","V");
    assertThrows(AgentHttpException.class,()->caller.query(JSONObject.of("id",RUN,"domainId","a"),"a","en",JSONObject.of("classNames",java.util.List.of(),"executionKind","live"),null,JSONObject.of("runId",RUN),JSONObject.of("userId","V","domainId","other")));

    var ref = JSONObject.of("id", RUN, "domainId", "a");
    var authority = JSONObject.of("classNames", List.of("Orders"), "executionKind", "live");
    var root = JSONObject.of("runId", RUN);
    var executorRef = JSONObject.of("userId", "V", "domainId", "a");
    var executorIdentity = new OntologyAgentStore.Owner("V", "a");
    var subject = mock(io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext.class);
    when(retrieverAccess.subject(executorIdentity)).thenReturn(subject);
    doThrow(new AgentHttpException(403, "OBJECT_FORBIDDEN", "Denied"))
        .when(retrieverAccess).require(subject, Verb.USE);
    assertEquals(403, assertThrows(AgentHttpException.class,
        () -> caller.retrieval(ref, "a", "en", authority, null, root, executorRef)).status());
    doNothing().when(retrieverAccess).require(subject, Verb.USE);
    doThrow(new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.FORBIDDEN))
        .when(identity).requireQueryAccess("V", "a");
    assertEquals("V", caller.retrieval(ref, "a", "en", authority, null, root, executorRef).access().user().getId());
  }

  @Test void directoryUsesRetrieverUseAndKeepsActionCreationQueryPermission() {
    var user = new io.ontomato.dataengine.service.QueryAccessService.GrantUser("U", "a");
    var actor = JSONObject.of("id", RUN, "domainId", "a");
    var restored = new AgentCaller.Actor(RUN, user, System.currentTimeMillis() + 60000);
    when(callers.restore(actor, "a")).thenReturn(restored);
    when(callers.executionUser(restored, null)).thenReturn(user);
    var labels = mock(OntologyAgentLabels.class);
    when(labels.localize(anyString(), any(), anyString())).thenAnswer(inv -> inv.getArgument(1));
    var agents = new AgentDirectory(callers, mock(ActionCreationService.class), labels, retrieverAccess);

    when(retrieverAccess.decide(null, Verb.USE)).thenReturn(new Decision(false, "OBJECT_FORBIDDEN", "Denied"));
    var withoutUse = agents.list(actor, "a", "en").getJSONArray("agents");
    assertEquals(1, withoutUse.size());
    assertEquals(ActionCreationService.AGENT, withoutUse.getJSONObject(0).getJSONObject("ref").getString("agentId"));

    when(retrieverAccess.decide(null, Verb.USE)).thenReturn(new Decision(true, null, null));
    var withUse = agents.list(actor, "a", "en").getJSONArray("agents");
    assertEquals(2, withUse.size());
    assertEquals(OntologyAgentStore.retrieverRef(), withUse.getJSONObject(0).getJSONObject("ref"));

    doThrow(new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.FORBIDDEN))
        .when(callers).requireQueryUser(user);
    var withoutQuery = agents.list(actor, "a", "en").getJSONArray("agents");
    assertEquals(1, withoutQuery.size());
    assertEquals(OntologyAgentStore.retrieverRef(), withoutQuery.getJSONObject(0).getJSONObject("ref"));
  }

  @Test void assistantSkillPublicationSharesDirectoryRetrieverRef() throws Exception {
    var runtime = mock(AgentRuntimeClient.class);
    var captured = new java.util.concurrent.atomic.AtomicReference<java.util.List<java.util.Map<String, String>>>();
    when(runtime.publishSkill(eq("ontology-assistant-skill-registration"), eq(io.ontomato.dataengine.service.RuntimeCodeClient.ASSISTANT_SKILL), any()))
      .thenAnswer(inv -> {
        captured.set(inv.getArgument(2));
        return new AgentRuntimeClient.SkillVersion(io.ontomato.dataengine.service.RuntimeCodeClient.ASSISTANT_SKILL, "a".repeat(64));
      });
    new io.ontomato.dataengine.service.RuntimeCodeClient(runtime).registerAssistantSkill();
    var files = captured.get().stream().collect(java.util.stream.Collectors.toMap(f -> f.get("path"), f -> f.get("content")));
    assertEquals(java.util.Set.of("SKILL.md", "ontomato.mjs", "client.mjs", "application.yml", "retriever-ref.json"), files.keySet());
    assertTrue(files.get("ontomato.mjs").contains("start-retrieval"));

    var agentCallers = mock(AgentCaller.class);
    var labels = mock(OntologyAgentLabels.class);
    when(labels.localize(anyString(), any(), anyString())).thenAnswer(inv -> inv.getArgument(1));
    var actor = JSONObject.of("id", RUN, "domainId", "a");
    var user = new io.ontomato.dataengine.service.QueryAccessService.GrantUser("U", "a");
    when(agentCallers.restore(actor, "a")).thenReturn(new AgentCaller.Actor(RUN, user, System.currentTimeMillis() + 60000));
    when(agentCallers.executionUser(any(), isNull())).thenReturn(user);
    var actions = mock(ActionCreationService.class);
    doThrow(new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.FORBIDDEN)).when(actions).authorize(any());
    when(retrieverAccess.decide(null, Verb.USE)).thenReturn(new Decision(true, null, null));
    var listed = new AgentDirectory(agentCallers, actions, labels, retrieverAccess).list(actor, "a", "en");
    var entry = listed.getJSONArray("agents").getJSONObject(0);
    var descriptor = JSONObject.parseObject(files.get("retriever-ref.json"));
    assertEquals(entry.getJSONObject("ref"), descriptor);
  }
}
