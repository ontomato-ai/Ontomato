package io.ontomato.dataengine.controller;

import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.assertThrows;
import io.ontomato.dataengine.applications.ApplicationCatalog;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.ProductGrantService;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Collections;
import java.util.List;
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
    private static ProductGrantController controller(ProductGrantService grants, WorkbenchServiceAuthentication authentication) {
        return new ProductGrantController(grants, authentication, mock(ApplicationCatalog.class), mock(IdentityService.class));
    }

    @Test void legacyGrantWritesRespectTheRegisteredApplicationOwner() throws Exception {
        var grants = mock(ProductGrantService.class);
        var applications = mock(ApplicationCatalog.class);
        var identity = mock(IdentityService.class);
        var user = new QueryAccessService.GrantUser("legacy-editor", "domain");
        when(identity.getCurrentUser()).thenReturn(user);
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(applications)
            .requireLegacyGrantChange("app-example", user);
        var mvc = MockMvcBuilders.standaloneSetup(
            new ProductGrantController(grants, mock(WorkbenchServiceAuthentication.class), applications, identity)).build();
        for (var request : Map.of(
                "share", """
                    {"id":"app-example","shared":true}
                    """,
                "grant", """
                    {"id":"app-example","principalKind":"role","principalId":"role","verb":"use","remove":false}
                    """,
                "grant-set", """
                    {"id":"app-example","principalKind":"role","principalId":"role","verbs":["use"]}
                    """).entrySet()) {
            mvc.perform(post("/product-governance/" + request.getKey()).contentType(MediaType.APPLICATION_JSON)
                .content(request.getValue())).andExpect(status().isForbidden());
        }
        verifyNoInteractions(grants);
    }

    @Test void legacyChecksCannotAuthorizeAnObjectFromSubmittedOwnerFacts() throws Exception {
        var grants = mock(ProductGrantService.class);
        var mvc = MockMvcBuilders.standaloneSetup(controller(grants, new WorkbenchServiceAuthentication("fixture")))
            .setControllerAdvice(new BaseControllerAdvice())
            .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
        var body = """
            {"target":{"domainId":"domain","kind":"PANEL","id":"panel"},"ownerFacts":{"ownerId":"author","state":"PUBLISHED"}}
            """;
        mvc.perform(post("/product-governance/check").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/product-governance/check").header(WorkbenchServiceAuthentication.HEADER, "fixture")
            .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest());
        verifyNoInteractions(grants);
    }

    @Test void batchCheckBindsJacksonListsAndReturnsTheJavaDecisions() throws Exception {
        var grants = mock(ProductGrantService.class);
        when(grants.allowedBatch(List.of("builtin-product-frame", "projection"), "use"))
            .thenReturn(Map.of("builtin-product-frame", true, "projection", false));
        var mvc = MockMvcBuilders.standaloneSetup(controller(grants, mock(WorkbenchServiceAuthentication.class)))
            .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
        mvc.perform(post("/product-governance/check-batch").contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"ids":["builtin-product-frame","projection"],"verb":"use"}
                """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.allowed['builtin-product-frame']").value(true))
            .andExpect(jsonPath("$.allowed.projection").value(false));
    }

    @Test void invalidBatchBodiesNeverReachAuthorization() throws Exception {
        var grants = mock(ProductGrantService.class);
        var mvc = MockMvcBuilders.standaloneSetup(controller(grants, mock(WorkbenchServiceAuthentication.class)))
            .setControllerAdvice(new BaseControllerAdvice())
            .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
        for (String body : List.of(
            "{\"verb\":\"use\"}",
            "{\"ids\":\"p\",\"verb\":\"use\"}",
            "{\"ids\":[],\"verb\":\"use\"}",
            "{\"ids\":[\"p\",42],\"verb\":\"use\"}",
            "{\"ids\":[\" \"],\"verb\":\"use\"}",
            "{\"ids\":[\"p\"]}",
            "{\"ids\":[" + String.join(",", Collections.nCopies(201, "\"p\"")) + "],\"verb\":\"use\"}"
        )) {
            mvc.perform(post("/product-governance/check-batch").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(jsonPath("$.success").value(false));
        }
        verifyNoInteractions(grants);
    }

    @Test void registrationBindsTheRealJacksonBodyAndKeepsServiceAuthentication() throws Exception {
        var grants=mock(ProductGrantService.class);
        var authentication=mock(WorkbenchServiceAuthentication.class);
        var mvc=MockMvcBuilders.standaloneSetup(controller(grants,authentication)).setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
        mvc.perform(post(ProductGrantController.REGISTER_PATH).contentType(MediaType.APPLICATION_JSON).content("{\"domainId\":\"domain\",\"ownerId\":\"author\",\"id\":\"profile\",\"shared\":true}")).andExpect(status().isOk());
        verify(authentication).authenticate(any());
        verify(grants).register("domain", "profile", "author", true, List.of());
    }
    @Test void expandedRegistrationAndGrantSetUseJacksonLists() throws Exception {
        var grants = mock(ProductGrantService.class);
        var authentication = mock(WorkbenchServiceAuthentication.class);
        var mvc = MockMvcBuilders.standaloneSetup(controller(grants, authentication))
            .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
        mvc.perform(post(ProductGrantController.REGISTER_PATH).contentType(MediaType.APPLICATION_JSON).content("""
            {"domainId":"domain","id":"profile","shared":true,"verbs":["use","view","edit"]}
            """)).andExpect(status().isOk());
        verify(authentication).authenticate(any());
        verify(grants).register("domain", "profile", null, true, List.of("use", "view", "edit"));
        mvc.perform(post("/product-governance/grant-set").contentType(MediaType.APPLICATION_JSON).content("""
            {"id":"profile","principalKind":"role","principalId":"reviewers","verbs":[]}
            """)).andExpect(status().isOk()).andExpect(jsonPath("$.success").value(true));
        verify(grants).setGrants("profile", "role", "reviewers", List.of());
    }

    @Test void domainGrantsAcceptAnAbsentBodyAndOmitUnresolvedNames() throws Exception {
        var grants = mock(ProductGrantService.class);
        when(grants.domainGrants(null, null)).thenReturn(List.of(
            new ProductGrantService.DomainGrantView("retriever", "domain", "*", null, "use")));
        var mvc = MockMvcBuilders.standaloneSetup(controller(grants, mock(WorkbenchServiceAuthentication.class)))
            .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
        mvc.perform(post("/product-governance/domain-grants")).andExpect(status().isOk())
            .andExpect(jsonPath("$.grants[0].resourceId").value("retriever"))
            .andExpect(jsonPath("$.grants[0].principalName").doesNotHaveJsonPath());
        mvc.perform(post("/product-governance/domain-grants").contentType(MediaType.APPLICATION_JSON)
            .content("{\"principalKind\":\"role\",\"principalId\":\"reviewers\"}")).andExpect(status().isOk());
        verify(grants).domainGrants("role", "reviewers");
    }

    @Test void refusedGrantReadKeepsTheJavaStatusAndReason() throws Exception {
        var grants=mock(ProductGrantService.class);
        when(grants.grantViews("profile")).thenThrow(new ResponseStatusException(HttpStatus.FORBIDDEN,"Product edit Grant required"));
        var mvc=MockMvcBuilders.standaloneSetup(controller(grants,mock(WorkbenchServiceAuthentication.class)))
            .setControllerAdvice(new BaseControllerAdvice())
            .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
        mvc.perform(post("/product-governance/grants").contentType(MediaType.APPLICATION_JSON).content("{\"id\":\"profile\"}"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.success").value(false))
            .andExpect(jsonPath("$.code").value(403))
            .andExpect(jsonPath("$.message").value("Product edit Grant required"));
    }
    @Test void registrationCannotReachTheStoreWithoutServiceAuthentication() {
        var grants=mock(ProductGrantService.class);
        var authentication=mock(WorkbenchServiceAuthentication.class);
        var request=mock(HttpServletRequest.class);
        when(authentication.authenticate(request)).thenThrow(new ResponseStatusException(HttpStatus.FORBIDDEN));
        var controller=controller(grants,authentication);
        assertThrows(ResponseStatusException.class,()->controller.register(request,Map.of("domainId","domain","ownerId","victim","id","profile","shared",true)));
        verifyNoInteractions(grants);
    }

    @Test void unregisterRequiresServiceAuthenticationAndBindsTheDomainAndResource() throws Exception {
        var grants = mock(ProductGrantService.class);
        var mvc = MockMvcBuilders.standaloneSetup(controller(grants, new WorkbenchServiceAuthentication("fixture")))
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
