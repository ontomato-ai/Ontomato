package io.ontomato.dataengine.controller;

import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.assertThrows;
import io.ontomato.dataengine.service.ProductGrantService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.http.MediaType;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import io.ontomato.dataengine.config.BaseControllerAdvice;

class ProductGrantControllerTest {
    @Test void registrationBindsTheRealJacksonBodyAndKeepsServiceAuthentication() throws Exception {
        var grants=mock(ProductGrantService.class);
        var authentication=mock(WorkbenchServiceAuthentication.class);
        var mvc=MockMvcBuilders.standaloneSetup(new ProductGrantController(grants,authentication)).setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
        mvc.perform(post(ProductGrantController.REGISTER_PATH).contentType(MediaType.APPLICATION_JSON).content("{\"domainId\":\"domain\",\"ownerId\":\"author\",\"id\":\"profile\",\"shared\":true}")).andExpect(status().isOk());
        verify(authentication).authenticate(any());
        verify(grants).register("domain","profile","author",true);
    }
    @Test void refusedGrantReadKeepsTheJavaStatusAndReason() throws Exception {
        var grants=mock(ProductGrantService.class);
        when(grants.grantViews("profile")).thenThrow(new ResponseStatusException(HttpStatus.FORBIDDEN,"Product edit Grant required"));
        var mvc=MockMvcBuilders.standaloneSetup(new ProductGrantController(grants,mock(WorkbenchServiceAuthentication.class)))
            .setControllerAdvice(new BaseControllerAdvice())
            .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
        mvc.perform(post("/product-governance/grants").contentType(MediaType.APPLICATION_JSON).content("{\"id\":\"profile\"}"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.success").value(false))
            .andExpect(jsonPath("$.code").value(403))
            .andExpect(jsonPath("$.message").value("Product edit Grant required"));
    }
    @Test void principalsEndpointDelegatesKindKeywordAndLimit() throws Exception {
        var grants = mock(ProductGrantService.class);
        when(grants.searchPrincipals("role", "admin", 25))
            .thenReturn(java.util.List.of(new io.ontomato.dataengine.service.ProductPrincipalLookup.PrincipalOption("r-1", "Administrator")));
        var mvc = MockMvcBuilders.standaloneSetup(new ProductGrantController(grants, mock(WorkbenchServiceAuthentication.class)))
            .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
        mvc.perform(post("/product-governance/principals").contentType(MediaType.APPLICATION_JSON)
            .content("{\"kind\":\"role\",\"keyword\":\"admin\",\"limit\":25}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.options[0].id").value("r-1"))
            .andExpect(jsonPath("$.options[0].name").value("Administrator"));
    }
    @Test void registrationCannotReachTheStoreWithoutServiceAuthentication() {
        var grants=mock(ProductGrantService.class);
        var authentication=mock(WorkbenchServiceAuthentication.class);
        var request=mock(HttpServletRequest.class);
        when(authentication.authenticate(request)).thenThrow(new ResponseStatusException(HttpStatus.FORBIDDEN));
        var controller=new ProductGrantController(grants,authentication);
        assertThrows(ResponseStatusException.class,()->controller.register(request,Map.of("domainId","domain","ownerId","victim","id","profile","shared",true)));
        verifyNoInteractions(grants);
    }

    @Test void unregisterRequiresServiceAuthenticationAndBindsTheDomainAndResource() throws Exception {
        var grants = mock(ProductGrantService.class);
        var mvc = MockMvcBuilders.standaloneSetup(new ProductGrantController(grants, new WorkbenchServiceAuthentication("fixture")))
            .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
        var body = """
            {"domainId":"domain","id":"projection"}
            """;
        mvc.perform(post(ProductGrantController.UNREGISTER_PATH).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isForbidden());
        verifyNoInteractions(grants);
        mvc.perform(post(ProductGrantController.UNREGISTER_PATH).header(WorkbenchServiceAuthentication.HEADER, "fixture")
            .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk()).andExpect(jsonPath("$.success").value(true));
        verify(grants).unregister("domain", "projection");
    }
}
