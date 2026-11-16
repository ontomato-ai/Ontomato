package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import io.ontomato.dataengine.service.AgentPrincipalService;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import jakarta.servlet.FilterChain;

class AgentPrincipalFilterTest {
    @Test void administrativePathsRejectAgentCredentialsBeforeIdentityIsInstalled()throws Exception {
        var principals=mock(AgentPrincipalService.class);
        var filter=new AgentPrincipalFilter(principals);
        var request=new MockHttpServletRequest("POST","/admin/addClass");request.addHeader("tk","ap1.forged.token");
        var response=new MockHttpServletResponse();var chain=mock(FilterChain.class);
        filter.doFilter(request,response,chain);
        assertEquals(403,response.getStatus());verifyNoInteractions(principals,chain);
    }
    @Test void governedExecutionReceivesOnlyTheVerifiedAgentIdentity()throws Exception {
        var principals=mock(AgentPrincipalService.class);
        var execution=new AgentPrincipalService.Execution(new AgentPrincipalService.Principal("agent","domain","Agent",1),System.currentTimeMillis()+60_000);
        when(principals.verify("ap1.valid.token")).thenReturn(execution);
        var request=new MockHttpServletRequest("POST","/action/execute");request.addHeader("tk","ap1.valid.token");
        var response=new MockHttpServletResponse();var chain=mock(FilterChain.class);
        new AgentPrincipalFilter(principals).doFilter(request,response,chain);
        assertSame(execution,request.getAttribute(AgentPrincipalService.ATTRIBUTE));verify(chain).doFilter(request,response);
    }
    @Test void agentCredentialsCannotAdoptAHumanBuildTestContext()throws Exception {
        var principals=mock(AgentPrincipalService.class);var chain=mock(FilterChain.class);
        var request=new MockHttpServletRequest("POST","/action/execute");request.addHeader("tk","ap1.valid.token");request.addHeader(io.ontomato.dataengine.service.BuildTestContextService.HEADER,"forged");
        var response=new MockHttpServletResponse();new AgentPrincipalFilter(principals).doFilter(request,response,chain);
        assertEquals(403,response.getStatus());verifyNoInteractions(principals,chain);
    }
}
