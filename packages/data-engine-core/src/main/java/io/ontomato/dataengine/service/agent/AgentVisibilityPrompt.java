package io.ontomato.dataengine.service.agent;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;

public final class AgentVisibilityPrompt {
  public enum Reader { USER, DELEGATED }

  @JsonIgnoreProperties(ignoreUnknown = true)
  private record Prompts(String user, String delegated) {}

  private static final Prompts PROMPTS = read();

  private AgentVisibilityPrompt() {}

  public static String forReader(Reader reader) {
    return switch (reader) {
      case USER -> PROMPTS.user();
      case DELEGATED -> PROMPTS.delegated();
    };
  }

  private static Prompts read() {
    try (var input = AgentVisibilityPrompt.class.getResourceAsStream(
        "/ontology-contracts/agent-visibility-prompt.json")) {
      return new ObjectMapper().readValue(input, Prompts.class);
    } catch (IOException error) {
      throw new UncheckedIOException(error);
    }
  }
}
