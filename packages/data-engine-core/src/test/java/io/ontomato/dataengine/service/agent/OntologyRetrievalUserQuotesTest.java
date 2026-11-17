package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import java.util.List;
import org.junit.jupiter.api.Test;

/** A caller scope owns the user's words; external calls keep their own quotes. */
class OntologyRetrievalUserQuotesTest {
  @Test
  void callerQuotesReplaceModelSuppliedQuotes() {
    JSONObject input = JSONObject.of("question", "How many?", "userQuotes", JSONArray.of("model rewrite"));
    JSONObject callerInput =
        JSONObject.of("recentUserMessages", JSONArray.of("first user message", "current user message"));

    OntologyAgentStore.applyCallerUserQuotes(input, callerInput);

    assertEquals(
        List.of("first user message", "current user message"),
        input.getList("userQuotes", String.class));
  }

  @Test
  void externalCallWithoutACallerKeepsItsOwnQuotes() {
    JSONObject input = JSONObject.of("question", "How many?", "userQuotes", JSONArray.of("external quote"));

    OntologyAgentStore.applyCallerUserQuotes(input, null);

    assertEquals(List.of("external quote"), input.getList("userQuotes", String.class));
  }

  @Test
  void callerWithoutMessagesDoesNotFallBackToModelQuotes() {
    JSONObject input = JSONObject.of("question", "How many?", "userQuotes", JSONArray.of("model rewrite"));

    OntologyAgentStore.applyCallerUserQuotes(input, new JSONObject());

    assertEquals(List.of(), input.getList("userQuotes", String.class));
  }

  @Test
  void confirmedDecisionsIncludeAgentAnswersWithoutTreatingThemAsUserQuotes() {
    JSONArray decisions =
        JSONArray.of(
            JSONObject.of("text", "Only active employees", "source", "user"),
            JSONObject.of("text", "Use last month", "source", "agent"),
            JSONObject.of("text", "  ", "source", "user"),
            JSONObject.of("text", "Exclude contractors", "source", "user"));

    assertEquals(
        List.of("Only active employees", "Use last month", "Exclude contractors"),
        OntologyRetrievalService.confirmedDecisions(decisions));
    assertEquals(List.of(), OntologyRetrievalService.confirmedDecisions(null));
  }
}
