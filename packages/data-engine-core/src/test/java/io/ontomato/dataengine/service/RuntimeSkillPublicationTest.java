package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.agent.AgentRuntimeClient;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class RuntimeSkillPublicationTest {
  private final AgentRuntimeClient runtime = mock(AgentRuntimeClient.class);
  private final RuntimeCodeClient code = new RuntimeCodeClient(runtime);

  @Test
  void ontologyProviderSkillsComeFromOneNamedInventory() throws Exception {
    String digest = "a".repeat(64);
    var publications = new ArrayList<Map<String, Object>>();
    var files = new ArrayList<List<Map<String, String>>>();
    when(runtime.publishSkill(anyString(), anyMap(), anyList()))
        .thenAnswer(
            call -> {
              publications.add(call.getArgument(1));
              files.add(call.getArgument(2));
              return new AgentRuntimeClient.SkillVersion(call.getArgument(1), digest);
            });

    for (String name : List.of("ontology-query", "ontomato-analyst-assistant", "knowledge-governance"))
      assertEquals(digest, code.registerSkill(name).digest());

    assertEquals(
        List.of("ontology-query", "ontomato-analyst-assistant", "knowledge-governance"),
        publications.stream().map(skill -> skill.get("name")).toList());
    assertEquals(
        List.of("SKILL.md", "scripts/ontomato.mjs", "application.yml", "references/dsl.md"),
        files.get(0).stream().map(file -> file.get("path")).toList());
    assertEquals(List.of("SKILL.md"), files.get(1).stream().map(file -> file.get("path")).toList());
    assertEquals(
        List.of("SKILL.md", "scripts/governance.mjs", "references/commands.md", "references/extraction.md"),
        files.get(2).stream().map(file -> file.get("path")).toList());
    assertThrows(AgentHttpException.class, () -> code.registerSkill("unknown-skill"));
  }
}
