package io.ontomato.dataengine.service.identity;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.ontomato.dataengine.controller.AgentExecutionController;
import io.ontomato.dataengine.controller.OntologyAgentErrors;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.sys.bean.UserDetail;
import io.ontomato.dataengine.test.PostgresTestDatabase;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class AgentExecutionSettingsTest extends PostgresTestDatabase {
  private AgentExecutionIdentity identity;
  private UserCredentialIdentity keys;
  private UserCredentials credentials;
  private AgentExecutionSettings settings;
  private AgentExecutionIdentity.Actor operator;
  private UserDetail target;
  private MockMvc http;

  @BeforeEach void setup() {
    jdbc.execute("CREATE TABLE platform_task_credential(domain_id text,creator_id text,sealed_key text,valid boolean,PRIMARY KEY(domain_id,creator_id))");
    identity = mock(AgentExecutionIdentity.class);
    keys = mock(UserCredentialIdentity.class);
    var proxy = new org.springframework.aop.framework.ProxyFactory(new UserCredentials(jdbc, keys, "test-seal"));
    proxy.addAdvice(new org.springframework.transaction.interceptor.TransactionInterceptor(
      new org.springframework.jdbc.datasource.DataSourceTransactionManager(dataSource),
      new org.springframework.transaction.annotation.AnnotationTransactionAttributeSource()));
    credentials = (UserCredentials)proxy.getProxy();
    settings = new AgentExecutionSettings(identity, credentials);
    operator = new AgentExecutionIdentity.Actor("operator", "domain");
    when(identity.operator(any())).thenReturn(operator);
    target = new UserDetail(); target.setId("target"); target.setDomainId("domain"); target.setEnable(true);
    when(identity.requireTarget("domain", "target")).thenReturn(target);
    when(keys.issueKey(target)).thenReturn("shared-key");
    when(keys.accepts("shared-key", "domain", "target")).thenReturn(true);
    http = MockMvcBuilders.standaloneSetup(new AgentExecutionController(new WorkbenchServiceAuthentication("service"), settings))
      .setControllerAdvice(new OntologyAgentErrors()).setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
  }
  private int count() { return jdbc.queryForObject("SELECT count(*) FROM platform_task_credential", Integer.class); }
  private String setting(String old, String next) {
    return "{\"domainId\":\"domain\",\"operatorId\":\"operator\",\"oldExecutionUserId\":"+old+",\"executionUserId\":"+next+"}";
  }
  @Test void nonAdministratorCannotAddRemoveOrReplaceAReferenceAndLeavesKeysUntouched() throws Exception {
    for (String[] change : new String[][] {{"null", "\"target\""}, {"\"target\"", "null"}, {"\"target\"", "\"other\""}}) {
      for (String path : new String[] {"validate-setting", "prepare-setting"})
        http.perform(post("/internal/agent-execution/"+path).header(WorkbenchServiceAuthentication.HEADER,"service")
          .header("tk","original").contentType(MediaType.APPLICATION_JSON).content(setting(change[0],change[1])))
          .andExpect(status().isForbidden());
    }
    assertEquals(0,count()); verifyNoInteractions(keys);
    // An unchanged reference is allowed but never prepares a key for a non-administrator.
    http.perform(post("/internal/agent-execution/prepare-setting").header(WorkbenchServiceAuthentication.HEADER,"service")
      .contentType(MediaType.APPLICATION_JSON).content(setting("\"target\"","\"target\""))).andExpect(status().isNoContent());
    assertEquals(0,count()); verifyNoInteractions(keys);
  }
  @Test void unchangedInvalidTargetAllowsNonAdministratorEditsWithoutChangingCredentials() throws Exception {
    credentials.prepareForExecutionSetting(target);
    var before = jdbc.queryForMap("SELECT * FROM platform_task_credential");
    clearInvocations(keys);
    when(identity.requireTarget("domain", "target"))
      .thenThrow(new AgentHttpException(403, "EXECUTION_USER_INVALID", "Invalid member"));
    for (String path : new String[] {"validate-setting", "prepare-setting"})
      http.perform(post("/internal/agent-execution/"+path).header(WorkbenchServiceAuthentication.HEADER,"service")
        .header("tk","original").contentType(MediaType.APPLICATION_JSON).content(setting("\"target\"","\"target\"")))
        .andExpect(status().isNoContent());
    assertEquals(before, jdbc.queryForMap("SELECT * FROM platform_task_credential"));
    verifyNoInteractions(keys);
    // An administrator's explicit save still validates the unchanged target before preparing it.
    when(identity.administrator(operator)).thenReturn(true);
    http.perform(post("/internal/agent-execution/prepare-setting").header(WorkbenchServiceAuthentication.HEADER,"service")
      .contentType(MediaType.APPLICATION_JSON).content(setting("\"target\"","\"target\"")))
      .andExpect(status().isForbidden());
    assertEquals(before, jdbc.queryForMap("SELECT * FROM platform_task_credential"));
    verifyNoInteractions(keys);
  }
  @Test void administratorSaveReplacesARejectedKeyInOnePreparation() throws Exception {
    credentials.prepareForExecutionSetting(target);
    clearInvocations(keys);
    when(identity.administrator(operator)).thenReturn(true);
    when(keys.accepts("shared-key", "domain", "target")).thenReturn(false);
    when(keys.issueKey(target)).thenReturn("replacement-key");
    when(keys.accepts("replacement-key", "domain", "target")).thenReturn(true);
    http.perform(post("/internal/agent-execution/prepare-setting").header(WorkbenchServiceAuthentication.HEADER,"service")
      .contentType(MediaType.APPLICATION_JSON).content(setting("\"target\"","\"target\"")))
      .andExpect(status().isNoContent());
    assertEquals("replacement-key", credentials.forOwner("domain", "target"));
    assertEquals(1, count());
    verify(keys, times(1)).issueKey(target);
  }
  @Test void validationHasNoKeySideEffectsAndEveryInternalEntryRequiresTheServiceCredential() throws Exception {
    when(identity.administrator(operator)).thenReturn(true);
    http.perform(post("/internal/agent-execution/validate-setting").header(WorkbenchServiceAuthentication.HEADER,"service")
      .contentType(MediaType.APPLICATION_JSON).content(setting("null","\"target\""))).andExpect(status().isNoContent());
    assertEquals(0,count()); verifyNoInteractions(keys);
    for (String path : new String[] {"validate-setting", "prepare-setting", "resolve"}) {
      String body = path.equals("resolve") ? "{\"domainId\":\"domain\",\"agentId\":\"agent\",\"executionUserId\":\"target\",\"initiatorId\":\"operator\"}" : setting("null","\"target\"");
      http.perform(post("/internal/agent-execution/"+path).contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isForbidden());
    }
    assertEquals(0,count()); verifyNoInteractions(keys);
  }
  @Test void twoAgentsReuseTheScheduledAndTriggerKeyInsteadOfRotatingIt() throws Exception {
    when(keys.interactiveLogin()).thenReturn(true);
    // The scheduler's existing preparation prepares the one row that Trigger.forOwner also reads.
    credentials.prepareForSetup(target);
    String before = jdbc.queryForObject("SELECT sealed_key FROM platform_task_credential", String.class);
    when(identity.administrator(operator)).thenReturn(true);
    var selected = new AgentExecutionSettings.Setting("domain","operator",null,"target");
    settings.prepare(selected,new MockHttpServletRequest());
    settings.prepare(selected,new MockHttpServletRequest());
    for (String agent : new String[] {"agent-one", "agent-two"}) {
      var result = settings.resolve(new AgentExecutionSettings.Resolution("domain",agent,"target","operator"));
      assertEquals("shared-key",result.apiKey());
      assertEquals("target",result.executionUserId());
    }
    var trigger = new io.ontomato.dataengine.bean.trigger.Trigger();
    trigger.setId("trigger"); trigger.setDomainId("domain"); trigger.setCreatedBy("target");
    trigger.setEffectKind(io.ontomato.dataengine.bean.trigger.Trigger.EFFECT_WORKFLOW);
    trigger.setEffect(com.alibaba.fastjson2.JSONObject.of("workflowId","workflow","requester","target"));
    var triggers = new io.ontomato.dataengine.service.TriggerService();
    org.springframework.test.util.ReflectionTestUtils.setField(triggers,"credentials",credentials);
    var transport = mock(java.net.http.HttpClient.class);
    @SuppressWarnings("unchecked") var response = (java.net.http.HttpResponse<String>)mock(java.net.http.HttpResponse.class);
    when(response.statusCode()).thenReturn(200); when(response.body()).thenReturn("{\"id\":\"run\"}");
    when(transport.send(any(java.net.http.HttpRequest.class),org.mockito.ArgumentMatchers.<java.net.http.HttpResponse.BodyHandler<String>>any())).thenReturn(response);
    org.springframework.test.util.ReflectionTestUtils.setField(triggers,"http",transport);
    triggers.prepareCredential(trigger,target);
    assertEquals("succeeded",triggers.fire(trigger,java.time.Instant.now(),"en").getString("status"));
    var sent = org.mockito.ArgumentCaptor.forClass(java.net.http.HttpRequest.class);
    verify(transport).send(sent.capture(),org.mockito.ArgumentMatchers.<java.net.http.HttpResponse.BodyHandler<String>>any());
    assertEquals("Bearer shared-key",sent.getValue().headers().firstValue("authorization").orElseThrow());
    assertEquals("shared-key",credentials.forOwner("domain","target"));
    assertEquals(before,jdbc.queryForObject("SELECT sealed_key FROM platform_task_credential",String.class));
    assertEquals(1,count()); verify(keys,times(1)).issueKey(target);
  }
  @Test void invalidKeyOrUnreadableCipherFailsWithoutRetryOrFallback() {
    credentials.prepareForExecutionSetting(target);
    clearInvocations(keys);
    when(keys.accepts("shared-key","domain","target")).thenReturn(false);
    assertThrows(UserCredentials.Invalid.class,()->settings.resolve(new AgentExecutionSettings.Resolution("domain","agent","target","operator")));
    verify(keys,never()).issueKey(any());
    jdbc.update("UPDATE platform_task_credential SET valid=true,sealed_key='not-a-cipher'");
    when(identity.administrator(operator)).thenReturn(true);
    assertThrows(UserCredentials.Invalid.class,()->settings.prepare(new AgentExecutionSettings.Setting("domain","operator","target","target"),new MockHttpServletRequest()));
    verify(keys,never()).issueKey(any());
    assertFalse(jdbc.queryForObject("SELECT valid FROM platform_task_credential",Boolean.class));
  }
  @Test void invalidMemberAndInvalidInitiatorNeverObtainAKey() {
    when(identity.administrator(operator)).thenReturn(true);
    when(identity.requireTarget("domain","target")).thenThrow(new AgentHttpException(403,"EXECUTION_USER_INVALID","Invalid member"));
    assertThrows(AgentHttpException.class,()->settings.prepare(new AgentExecutionSettings.Setting("domain","operator",null,"target"),new MockHttpServletRequest()));
    assertThrows(AgentHttpException.class,()->settings.resolve(new AgentExecutionSettings.Resolution("domain","agent","target","operator")));
    doThrow(new AgentHttpException(403,"FORBIDDEN","Invalid initiator")).when(identity).requireInitiator(operator);
    assertThrows(AgentHttpException.class,()->settings.resolve(new AgentExecutionSettings.Resolution("domain","agent",null,"operator")));
    assertEquals(0,count()); verifyNoInteractions(keys);
  }
}
