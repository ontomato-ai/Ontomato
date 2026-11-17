package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.JSONObject;
import com.sun.net.httpserver.HttpServer;
import io.ontomato.dataengine.controller.KnowledgeGovernanceController;
import io.ontomato.dataengine.controller.OntologyAgentErrors;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.test.PostgresTestDatabase;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class GovernanceWindowTest extends PostgresTestDatabase {
  private final String record=UUID.randomUUID().toString(), session=UUID.randomUUID().toString(), run=UUID.randomUUID().toString();
  private final OntologyAgentStore.Owner owner=new OntologyAgentStore.Owner("user","domain");
  private final AtomicReference<String> runtimeState=new AtomicReference<>("running");
  private final AtomicReference<String> reason=new AtomicReference<>("stop");
  private final AtomicBoolean unavailable=new AtomicBoolean();
  private HttpServer server;
  private KnowledgeGovernanceService governance;
  private MockMvc http;
  private String token;

  @BeforeEach void setup() throws Exception {
    server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
    server.createContext("/", exchange -> {
      String path=exchange.getRequestURI().getPath();
      String body;
      int code=200;
      if(path.startsWith("/internal/assistant/")) {
        if(!"service".equals(exchange.getRequestHeaders().getFirst("X-Ontomato-Query-Service-Token"))
            || !owner.domainId().equals(exchange.getRequestHeaders().getFirst("X-Domain-Id"))) code=403;
        if(unavailable.get()) code=503;
        String[] parts=path.split("/");
        body=JSONObject.of("sessionId",parts[4],"runId",parts[6],"status",runtimeState.get(),"stopReason","running".equals(runtimeState.get())?null:reason.get()).toJSONString();
      } else body=JSONObject.of("question","Original user material","answer",null,"artifacts",List.of()).toJSONString();
      byte[] bytes=body.getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(code,bytes.length);
      exchange.getResponseBody().write(bytes);exchange.close();
    });
    server.start();
    String url="http://127.0.0.1:"+server.getAddress().getPort();
    var store=new OntologyAgentStore(jdbc,new DataSourceTransactionManager(dataSource));
    store.initialize();
    var grants=new QueryGrantService(jdbc,"test-signing",new WorkbenchServiceAuthentication("service"));
    grants.initialize();
    var definitions=mock(OntologyAgentDefinitions.class);
    when(definitions.resource(anyString())).thenCallRealMethod();
    var identity=mock(IdentityService.class);
    when(identity.getCurrentUser()).thenReturn(new QueryAccessService.GrantUser(owner.userId(),owner.domainId()));
    when(identity.hasKnowledgeGovernanceAccess()).thenReturn(true);
    when(identity.getCurrentCredentialExpiresAt()).thenReturn(System.currentTimeMillis()+1_200_000);
    governance=new KnowledgeGovernanceService(store,new AgentRuntimeClient(url,"ontology","http://ontology"),
      new GovernanceRuntimeClient(url,"service"),definitions,grants,mock(KnowledgeService.class),mock(AdminService.class),mock(io.ontomato.dataengine.schedules.ScheduleIdentity.class,CALLS_REAL_METHODS));
    ReflectionTestUtils.setField(governance,"identityService",identity);
    governance.initialize();
    var access=new OntologyAgentAccess(mock(QueryAccessService.class),identity,grants,store);
    http=MockMvcBuilders.standaloneSetup(new KnowledgeGovernanceController(governance,access))
      .setControllerAdvice(new OntologyAgentErrors()).setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
  }
  @AfterEach void stopFixture() {if(server!=null)server.stop(0);}
  private JSONObject binding(String id) {
    return JSONObject.of("recordId",record,"domainId",owner.domainId(),"ownerId",owner.userId(),"runtimeHostId","workbench","sessionId",session,"runId",id,"expiresAt",Instant.now().plusSeconds(900).toString());
  }
  private void open() throws Exception {
    var input=binding(run);
    var response=http.perform(post("/ontology/ai/knowledge-governance/platform-windows")
      .header("X-Ontomato-Query-Service-Token","service").contentType(MediaType.APPLICATION_JSON).content(input.toJSONString()))
      .andExpect(status().isOk()).andReturn().getResponse();
    var result=JSONObject.parseObject(response.getContentAsString());
    assertEquals(session,result.getString("sessionId"));
    assertEquals(Instant.parse(input.getString("expiresAt")).toEpochMilli(),Instant.parse(result.getString("expiresAt")).toEpochMilli());
    token=result.getString("token");
    assertNotNull(token);
  }
  private Object change(String summary) throws Exception {
    return governance.action(record,run,"update_work_record",JSONObject.of("summary",summary),owner);
  }
  private void unchangedAfterRejection() {
    String before=governance.work(record,owner).toJSONString();
    assertEquals("GOVERNANCE_RUN_CLOSED",assertThrows(AgentHttpException.class,()->change("late write")).code());
    assertEquals(before,governance.work(record,owner).toJSONString());
  }
  @Test void runningWindowAcceptsNestedJacksonInputAndRegistersOnlyReadSources() throws Exception {
    open();
    String input="{\"summary\":\"Reviewed\",\"issues\":[{\"id\":\"issue\",\"title\":\"Meaning\",\"problem\":\"Ambiguous\",\"before\":\"Old\",\"after\":\"Proposed\",\"basis\":\"Read text\",\"category\":\"knowledge\",\"status\":\"pending\",\"sourceIds\":[]}]}";
    http.perform(post("/ontology/ai/knowledge-governance/"+record+"/runs/"+run+"/actions/update_work_record")
      .header("X-Ontomato-Session-Id",session).header("X-Ontomato-Run-Id",run).contentType(MediaType.APPLICATION_JSON).content(input)).andExpect(status().isOk());
    assertEquals("Reviewed",governance.work(record,owner).getJSONObject("work").getString("summary"));
    String before=governance.work(record,owner).toJSONString();
    input=input.replace("\"sourceIds\":[]","\"sourceIds\":[\"unread\"]");
    http.perform(post("/ontology/ai/knowledge-governance/"+record+"/runs/"+run+"/actions/update_work_record")
      .header("X-Ontomato-Session-Id",session).header("X-Ontomato-Run-Id",run).contentType(MediaType.APPLICATION_JSON).content(input)).andExpect(status().isBadRequest());
    assertEquals(before,governance.work(record,owner).toJSONString());
    assertEquals(run,new QueryGrantService(jdbc,"test-signing",new WorkbenchServiceAuthentication("service"))
      .verify(token,run,"/ontology/ai/knowledge-governance/"+record+"/runs/"+run+"/actions/read_input").getString("runId"));
  }
  @Test void endedRuntimeRejectsWritesWithoutChangingTheRecord() throws Exception {open();change("saved");runtimeState.set("stopped");unchangedAfterRejection();}
  @Test void stoppedRuntimeRejectsWritesEvenBeforeCloseNotification() throws Exception {open();reason.set("aborted");runtimeState.set("stopped");unchangedAfterRejection();}
  @Test void explicitlyClosedWindowRejectsWritesWhileTheRuntimeStillRuns() throws Exception {open();governance.closePlatform(run,owner.domainId());unchangedAfterRejection();assertThrows(AgentHttpException.class,()->governance.registerPlatform(binding(run),context()));}
  @Test void expiredWindowRejectsWritesWithoutChangingTheRecord() throws Exception {open();jdbc.update("UPDATE ontology_governance_windows SET expires_at=now()-interval '1 second' WHERE run_id=?::uuid",run);unchangedAfterRejection();}
  @Test void unavailableRuntimeStatusRejectsWritesWithoutChangingTheRecord() throws Exception {open();unavailable.set(true);
    String before=governance.work(record,owner).toJSONString();
    assertThrows(org.springframework.web.client.RestClientResponseException.class,()->change("late write"));
    assertEquals(before,governance.work(record,owner).toJSONString());}
  @Test void successorWindowSupersedesThePreviousOne() throws Exception {open();governance.registerPlatform(binding(UUID.randomUUID().toString()),context());unchangedAfterRejection();}
  @Test void externalBeginAndCloseNeedNoRuntimeAndCannotCloseAPlatformWindow() throws Exception {
    unavailable.set(true);
    String external=UUID.randomUUID().toString();
    var window=governance.begin(external,JSONObject.of("message","External original"),context());
    governance.action(window.getString("id"),external,"update_work_record",JSONObject.of("summary","external saved"),owner);
    governance.closeExternal(window.getString("id"),external,owner);
    String before=governance.work(window.getString("id"),owner).toJSONString();
    assertThrows(AgentHttpException.class,()->governance.action(window.getString("id"),external,"update_work_record",JSONObject.of("summary","late"),owner));
    assertEquals(before,governance.work(window.getString("id"),owner).toJSONString());
    unavailable.set(false);open();
    assertThrows(AgentHttpException.class,()->governance.closeExternal(record,run,owner));
  }
  @Test void platformInputIsReadFromRuntimeHistoryAndStoredAsAReference() throws Exception {
    open();
    var input=(JSONObject)governance.action(record,run,"read_input",new JSONObject(),owner);
    assertEquals("Original user material",input.getString("text"));
    var work=governance.work(record,owner).getJSONObject("work");
    assertFalse(work.toJSONString().contains("Original user material"));
    assertEquals("history",work.getJSONArray("sources").getJSONObject(0).getString("kind"));
    assertTrue(governance.readSource(record,input.getString("sourceId"),0,owner).toString().contains("Original user material"));
  }
  @Test void userCannotRegisterAPlatformWindowAndServiceCannotChangeOwnership() throws Exception {
    http.perform(post("/ontology/ai/knowledge-governance/platform-windows").contentType(MediaType.APPLICATION_JSON).content(binding(run).toJSONString())).andExpect(status().isForbidden());
    var foreign=binding(run);foreign.put("ownerId","other");
    http.perform(post("/ontology/ai/knowledge-governance/platform-windows").header("X-Ontomato-Query-Service-Token","service").contentType(MediaType.APPLICATION_JSON).content(foreign.toJSONString())).andExpect(status().isNotFound());
    assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM ontology_governance_records",Integer.class));
  }
  private OntologyAgentAccess.Context context() {return new OntologyAgentAccess.Context(owner,null,"login",null,"en",System.currentTimeMillis()+600_000,null);}
}
