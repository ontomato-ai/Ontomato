package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import io.ontomato.dataengine.service.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class ProductOntologyControllerTest {
    @Test void graphRegistrationAndReadsRequireWorkbenchServiceAuthentication(){
        var ontology=mock(ProductOntologyService.class);var authentication=mock(WorkbenchServiceAuthentication.class);
        var controller=new ProductOntologyController(ontology,authentication);var request=new MockHttpServletRequest();
        doThrow(new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.FORBIDDEN,"Service required")).when(authentication).authenticate(request);
        assertThrows(Exception.class,()->controller.register(request,new ProductOntologyController.Registration("domain",List.of())));
        assertThrows(Exception.class,()->controller.graph(request,new ProductOntologyController.Subject("domain","human")));
        verifyNoInteractions(ontology);
    }
}
