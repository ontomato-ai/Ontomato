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
  void retrievalPublishesOnlyDataRetrievalWithItsQueryScripts() throws Exception {
    var skills = definitions.publish();

    assertEquals(List.of("data-retrieval"), names(skills));
    assertEquals(1, publications.size());
    var files = publications.getFirst();
    var byPath = new java.util.HashMap<String, String>();
    for (var file : files) byPath.put(file.get("path"), file.get("content"));
    assertEquals(
        definitions.resource("ontology-skills/ontomato-analyst/ontomato.mjs"),
        byPath.get("scripts/ontomato.mjs"));
    assertEquals(
        definitions.resource("ontology-skills/ontomato-analyst/client.mjs"),
        byPath.get("scripts/client.mjs"));
  }

  @Test
  void generationAgentsKeepTheAnalystSkill() throws Exception {
    for (var skills :
        List.of(
            definitions.publishGeneration(),
            definitions.publishMetricView(),
            definitions.publishActionCreation()))
      assertTrue(names(skills).contains("ontomato-analyst"));
  }

  @Test
  void agentDefinitionsMarkOnlyTheirOwnPreloadSkills() {
    var retrieval = definitions.definition("d", "en", 1000, List.of(new SkillVersion(OntologyAgentDefinitions.DATASET_SKILL, "a".repeat(64))));
    var retrievalSkills = retrieval.getList("skills", SkillVersion.class);
    assertTrue(retrievalSkills.getFirst().preload());
    assertEquals(OntologyAgentDefinitions.RETRIEVAL_OPENING_KNOWLEDGE_LIMIT,
        retrieval.getIntValue(OntologyAgentDefinitions.OPENING_KNOWLEDGE_LIMIT));

    var generationSkills = List.of(
        new SkillVersion(OntologyAgentDefinitions.DATASET_SKILL, "a".repeat(64)),
        new SkillVersion(OntologyAgentDefinitions.GENERATION_SKILL, "b".repeat(64)));
    var generation = definitions.generation("d", "action", "prompt", "en", 1000, generationSkills)
        .getList("skills", SkillVersion.class);
    assertFalse(generation.get(0).preload());
    assertTrue(generation.get(1).preload());

    var metric = definitions.metricView("d", "prompt", "en", 1000,
        List.of(new SkillVersion(OntologyAgentDefinitions.METRICVIEW_SKILL, "c".repeat(64))))
        .getList("skills", SkillVersion.class);
    assertTrue(metric.getFirst().preload());
    assertFalse(definitions.generation("d", "action", "prompt", "en", 1000, generationSkills)
        .getString("systemPrompt").contains("name: ontology-generation"));
  }

}
