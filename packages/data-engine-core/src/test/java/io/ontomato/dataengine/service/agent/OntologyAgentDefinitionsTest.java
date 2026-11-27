package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import io.ontomato.dataengine.service.RuntimeCodeClient;
import io.ontomato.dataengine.service.agent.AgentRuntimeClient.SkillVersion;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class OntologyAgentDefinitionsTest {
  private final AgentRuntimeClient runtime = mock(AgentRuntimeClient.class);
  private final RuntimeCodeClient code = mock(RuntimeCodeClient.class);
  private final OntologyAgentDefinitions definitions =
      new OntologyAgentDefinitions(runtime, code, mock(OntologyAgentModelSettings.class));
  private final List<List<Map<String, String>>> publications = new ArrayList<>();

  @BeforeEach
  void setup() throws Exception {
    String digest = "a".repeat(64);
    when(code.registerSkill()).thenReturn(new SkillVersion(RuntimeCodeClient.SKILL, digest));
    when(runtime.publishSkill(anyString(), anyMap(), anyList()))
        .thenAnswer(
            call -> {
              publications.add(call.getArgument(2));
              return new SkillVersion(call.getArgument(1), digest);
            });
  }

  private static List<String> names(List<SkillVersion> skills) {
    return skills.stream().map(skill -> skill.skill().get("name").toString()).toList();
  }

  @Test
  void retrievalPublishesOntologyQueryAndDataRetrieval() throws Exception {
    var skills = definitions.publish();

    assertEquals(List.of("ontology-query", "data-retrieval"), names(skills));
    assertEquals(1, publications.size());
    var paths = publications.getFirst().stream().map(file -> file.get("path")).toList();
    assertEquals(
        List.of(
            "SKILL.md",
            "scripts/dataset.mjs",
            "references/dataset.md",
            "references/query-package.md"),
        paths);
  }

  @Test
  void generationAgentsUseOntologyQueryAndTheirGenerationSkill() throws Exception {
    assertEquals(
        List.of("ontology-query", "ontology-generation"), names(definitions.publishGeneration()));
    assertEquals(
        List.of("ontology-query", "metricview-generation"), names(definitions.publishMetricView()));
    assertEquals(
        List.of("ontology-query", "ontology-generation"), names(definitions.publishActionCreation()));
  }
}
