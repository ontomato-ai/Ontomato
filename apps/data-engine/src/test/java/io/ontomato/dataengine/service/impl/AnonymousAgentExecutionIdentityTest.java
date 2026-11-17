package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import io.ontomato.dataengine.service.identity.*;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class AnonymousAgentExecutionIdentityTest {
  @Test void anonymousEditionHasOnlyTheExistingInitiatorAndNeverPreparesAKey() {
    var identity = new AnonymousAgentExecutionIdentity();
    var credentials=mock(UserCredentials.class);
    var settings=new AgentExecutionSettings(identity,credentials);
    var request=new MockHttpServletRequest();
    var options=settings.options(request,"",1,20);
    assertFalse(options.canSetExecutionUser()); assertTrue(options.users().isEmpty());
    var own=new AgentExecutionSettings.Setting("1","system",null,null);
    settings.validate(own,request); settings.prepare(own,request);
    var resolved=settings.resolve(new AgentExecutionSettings.Resolution("1","agent",null,"system"));
    assertEquals("system",resolved.executionUserId()); assertNull(resolved.apiKey());
    assertThrows(AgentHttpException.class,()->settings.prepare(new AgentExecutionSettings.Setting("1","system",null,"some-user"),request));
    assertThrows(AgentHttpException.class,()->settings.resolve(new AgentExecutionSettings.Resolution("1","agent","some-user","system")));
    verifyNoInteractions(credentials);
  }
}
