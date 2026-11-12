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
  private final KnowledgeGovernanceService governance=mock(KnowledgeGovernanceService.class);
  private final OntologyAgentStore store=mock(OntologyAgentStore.class);
  private org.springframework.test.web.servlet.MockMvc mvc() {
    return MockMvcBuilders.standaloneSetup(new AgentChannelController(callers,mock(AgentDirectory.class),governance,store,mock(AgentRuntimeClient.class),mock(WorkbenchServiceAuthentication.class)))
      .setControllerAdvice(new OntologyAgentErrors()).setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
  }
  private String input(String mode,String role) {
    return JSONObject.of("mode",mode,"language","en","agent",JSONObject.of("providerId","ontology","agentId",KnowledgeGovernanceService.AGENT),
      "actor",JSONObject.of("id",RUN,"domainId","a"),"sessionId",SESSION,"runId",RUN,
      "authority",JSONObject.of("classNames",java.util.List.of(),"executionKind","live"),
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
    var credentials=mock(io.ontomato.dataengine.schedules.TaskCredentials.class);
    var caller=new AgentCaller(jdbc,identities,credentials,mock(io.ontomato.dataengine.service.IdentityService.class));
    var failure=assertThrows(AgentHttpException.class,()->caller.restore(JSONObject.of("id",RUN,"domainId","b"),"a"));
    assertEquals("CROSS_DOMAIN",failure.code());
    verifyNoInteractions(jdbc,identities,credentials);
  }
}
