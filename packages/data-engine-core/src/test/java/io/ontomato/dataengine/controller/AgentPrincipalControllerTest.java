package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import io.ontomato.dataengine.service.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class AgentPrincipalControllerTest {
    @Test void userScopedRegistrationRequiresServiceAuthentication(){
        var service=mock(AgentPrincipalService.class);var authentication=mock(WorkbenchServiceAuthentication.class);
        var controller=new AgentPrincipalController(service,authentication,mock(ProductGrantService.class));var request=new MockHttpServletRequest();
        var body=new AgentPrincipalController.UserScopedRegistration("domain","agent","Agent");
        doThrow(AgentPrincipalService.denied("Service denied")).when(authentication).authenticate(request);
        assertThrows(Exception.class,()->controller.registerUserScoped(request,body));verifyNoInteractions(service);
        reset(authentication);controller.registerUserScoped(request,body);
        verify(service).registerUserScoped("domain","agent","Agent");
    }
    @Test void issuanceRequiresBothServiceAuthenticationAndInitiatorUseGrant(){
        var service=mock(AgentPrincipalService.class);var authentication=mock(WorkbenchServiceAuthentication.class);var grants=mock(ProductGrantService.class);
        var controller=new AgentPrincipalController(service,authentication,grants);var request=new MockHttpServletRequest();
        var body=new AgentPrincipalController.DelegatedExecutionRequest("domain","agent","human",System.currentTimeMillis()+60_000);
        assertThrows(Exception.class,()->controller.execution(request,body));verifyNoInteractions(service);
        when(grants.allowedFor("domain","human","agent","use")).thenReturn(true);when(service.issue("domain","agent",body.expiresAt())).thenReturn("ap1.signed.credential");
        assertNotNull(controller.execution(request,body));verify(authentication,atLeastOnce()).authenticate(request);
        reset(service);doThrow(AgentPrincipalService.denied("Service denied")).when(authentication).authenticate(request);
        assertThrows(Exception.class,()->controller.execution(request,body));verifyNoInteractions(service);
    }
}
