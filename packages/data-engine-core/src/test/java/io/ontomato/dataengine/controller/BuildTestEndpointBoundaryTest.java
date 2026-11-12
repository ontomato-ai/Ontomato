package io.ontomato.dataengine.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BaseControllerAdvice;
import io.ontomato.dataengine.service.*;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class BuildTestEndpointBoundaryTest {
  private static final String HEADER = BuildTestContextService.HEADER;
  private static final String CONTEXT = "{\"kind\":\"build-test\",\"contextId\":\"context-a\"}";
  private static final String UNBOUND_CONTEXT = "{\"kind\":\"build-test\",\"contextId\":null}";

  @Test
  void refusesAnUndeclaredBusinessEntryBeforeItsServiceRuns() throws Exception {
    var dslService = mock(DslService.class);
    var controller = new DslController();
    ReflectionTestUtils.setField(controller, "dslService", dslService);
    ReflectionTestUtils.setField(controller, "identityService", mock(IdentityService.class));
    var mvc =
        MockMvcBuilders.standaloneSetup(controller)
            .addInterceptors(new BuildTestAccessInterceptor())
            .setControllerAdvice(new BaseControllerAdvice())
            .setMessageConverters(new MappingJackson2HttpMessageConverter())
            .build();

    mvc.perform(
            post("/dsl/executeV1")
                .header(HEADER, CONTEXT)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"dsl\":{}}"))
        .andExpect(status().isUnprocessableEntity())
        .andExpect(jsonPath("$.success").value(false))
        .andExpect(jsonPath("$.code").value(BuildTestAccessInterceptor.CODE))
        .andExpect(jsonPath("$.data").doesNotExist());
    verifyNoInteractions(dslService);
  }

  @Test
  void letsADeclaredTestDataEntryRunWithTheHeader() throws Exception {
    var authorization = mock(QueryAccessService.class);
    var access =
        new QueryAccessService.Access(
            new QueryAccessService.GrantUser("user-a", "domain-a"), null, null, null, null);
    when(authorization.access(any())).thenReturn(access);
    var ontology = mock(OntologyQueryService.class);
    when(ontology.execute(any(JSONObject.class), any(QueryAccessService.Access.class)))
        .thenReturn(Map.of("rows", List.of()));
    var controller =
        new OntologyQueryController(
            authorization, ontology, mock(QueryOutputService.class), mock(QueryJobService.class));
    var mvc =
        MockMvcBuilders.standaloneSetup(controller)
            .addInterceptors(new BuildTestAccessInterceptor())
            .setControllerAdvice(new BaseControllerAdvice())
            .setMessageConverters(new MappingJackson2HttpMessageConverter())
            .build();

    mvc.perform(
            post("/ontology/query/execute-dsl")
                .header(HEADER, CONTEXT)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"dsl\":{}}"))
        .andExpect(status().isOk());

    mvc.perform(
            post("/ontology/query/execute-dsl")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"dsl\":{}}"))
        .andExpect(status().isOk());
    verify(ontology, times(2)).execute(any(JSONObject.class), any(QueryAccessService.Access.class));
  }

  @Test
  void letsADeclaredMetadataEntryReadDefinitionsWithTheHeader() throws Exception {
    var authorization = mock(QueryAccessService.class);
    when(authorization.access(any()))
        .thenReturn(
            new QueryAccessService.Access(
                new QueryAccessService.GrantUser("user-a", "domain-a"), null, null, null, null));
    var ontology = mock(OntologyQueryService.class);
    when(ontology.overview(any(QueryAccessService.Access.class))).thenReturn(Map.of("classes", List.of()));
    var controller =
        new OntologyQueryController(
            authorization, ontology, mock(QueryOutputService.class), mock(QueryJobService.class));
    var mvc =
        MockMvcBuilders.standaloneSetup(controller)
            .addInterceptors(new BuildTestAccessInterceptor())
            .setControllerAdvice(new BaseControllerAdvice())
            .setMessageConverters(new MappingJackson2HttpMessageConverter())
            .build();

    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/ontology/query/overview")
            .header(HEADER, UNBOUND_CONTEXT))
        .andExpect(status().isOk());
    verify(ontology).overview(any(QueryAccessService.Access.class));
  }

  @Test
  void refusesATestDataEntryThatAlsoCarriesAGrantContext() throws Exception {
    var ontology = mock(OntologyQueryService.class);
    var controller =
        new OntologyQueryController(
            mock(QueryAccessService.class),
            ontology,
            mock(QueryOutputService.class),
            mock(QueryJobService.class));
    var mvc =
        MockMvcBuilders.standaloneSetup(controller)
            .addInterceptors(new BuildTestAccessInterceptor())
            .setControllerAdvice(new BaseControllerAdvice())
            .setMessageConverters(new MappingJackson2HttpMessageConverter())
            .build();

    mvc.perform(
            post("/ontology/query/execute-dsl")
                .header(HEADER, CONTEXT)
                .requestAttr(QueryGrantService.ATTRIBUTE, JSONObject.of("contextId", "grant-context"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"dsl\":{}}"))
        .andExpect(status().isUnprocessableEntity())
        .andExpect(jsonPath("$.code").value(BuildTestAccessInterceptor.CODE));
    verifyNoInteractions(ontology);
  }
}
