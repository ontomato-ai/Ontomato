package io.ontomato.dataengine.controller;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.ontomato.dataengine.service.RuntimeCodeClient;
import io.ontomato.dataengine.service.agent.AgentRuntimeClient;
import io.ontomato.dataengine.service.agent.OntologyAgentAccess;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class OntologySkillControllerTest {
  @Test
  void packageEndpointPublishesTheRequestedOntologySkillForAServiceCaller() throws Exception {
    var code = mock(RuntimeCodeClient.class);
    var access = mock(OntologyAgentAccess.class);
    var version = new AgentRuntimeClient.SkillVersion(Map.of("name", "ontology-query"), "a".repeat(64));
    when(code.registerSkill("ontology-query")).thenReturn(version);
    var controller = new OntologySkillController(code, access);
    var http = MockMvcBuilders.standaloneSetup(controller)
        .setControllerAdvice(new OntologyAgentErrors((language, key) -> key))
        .setMessageConverters(new MappingJackson2HttpMessageConverter())
        .build();

    http.perform(post("/platform/ontology-skills/package")
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"name\":\"ontology-query\"}"))
        .andExpect(status().isOk());

    verify(access).service(any(HttpServletRequest.class));
    verify(code).registerSkill("ontology-query");
  }
}
