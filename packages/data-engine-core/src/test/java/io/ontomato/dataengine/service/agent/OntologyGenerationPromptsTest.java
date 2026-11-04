package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;

/** The checker compares against the user's own words, not the rewritten retrieval question. */
class OntologyGenerationPromptsTest {
  @Test
  void usesUserQuotesAndConfirmedDecisionsInsteadOfTheRewrittenQuestion() {
    String question =
        OntologyGenerationPrompts.userQuestion(
            "How many active employees?",
            List.of("How many staff do we have?", "Only active ones, aged 20 to 30."),
            List.of("Active means currently employed."));

    assertTrue(question.contains("How many staff do we have?"));
    assertTrue(question.contains("Only active ones, aged 20 to 30."));
    assertTrue(question.contains("Active means currently employed."));
    assertFalse(question.contains("How many active employees?"));
  }

  @Test
  void fallsBackToTheRetrievalQuestionWhenThereAreNoQuotes() {
    String question =
        OntologyGenerationPrompts.userQuestion(
            "How many active employees?", List.of(), List.of("Active means currently employed."));

    assertTrue(question.contains("How many active employees?"));
    assertTrue(question.contains("Active means currently employed."));
  }

  @Test
  void blankQuotesAlsoFallBackToTheRetrievalQuestion() {
    String question =
        OntologyGenerationPrompts.userQuestion(
            "How many active employees?", List.of("  "), null);

    assertEquals("How many active employees?", question);
  }
}
