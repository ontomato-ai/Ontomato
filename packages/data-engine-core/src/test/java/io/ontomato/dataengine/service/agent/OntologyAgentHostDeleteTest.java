package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.PreviewExecution;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

/**
 * A conversation's deletion closes it to new runs before judging what it holds, so a preview's deletion judges every run
 * the conversation will ever hold, and closes nothing when one is live.
 */
class OntologyAgentHostDeleteTest {
  private static final String SESSION = "11111111-1111-4111-8111-111111111111";
  private static final String RUN = "22222222-2222-4222-8222-222222222222";
  private static final String OTHER = "33333333-3333-4333-8333-333333333333";
  private final OntologyAgentStore.Owner owner = new OntologyAgentStore.Owner("U", "a");
  private OntologyAgentStore store;
  private AgentRuntimeClient runtime;
  private OntologyGenerationService generation;
  private OntologyAgentHost host;
  private final String identities = "/v1/channel/sessions/" + SESSION + "/run-identities";

  @BeforeEach
  void setUp() {
    store = mock(OntologyAgentStore.class);
    runtime = mock(AgentRuntimeClient.class);
    generation = mock(OntologyGenerationService.class);
    host = new OntologyAgentHost(store, runtime, mock(OntologyRetrievalService.class), generation,
        mock(ActionCreationService.class), mock(OntologyAgentLabels.class), mock(AuthorizationService.class));
    when(store.session(SESSION, owner)).thenReturn(JSONObject.of("agent_id", UUID.randomUUID().toString()));
    when(store.rows(anyString(), any())).thenReturn(List.of(JSONObject.of("id", RUN)));
  }

  private void runs(String... kinds) throws Exception {
    var listed = new com.alibaba.fastjson2.JSONArray();
    for (int index = 0; index < kinds.length; index++)
      listed.add(JSONObject.of("runId", index == 0 ? RUN : OTHER, "executionKind", kinds[index]));
    when(runtime.json("a", SESSION, identities, "GET", null, null)).thenReturn(JSONObject.of("runs", listed));
  }

  private void assertRefusedAndReopened() throws Exception {
    var refused = assertThrows(AgentHttpException.class, () -> host.delete(SESSION, owner, true));
    assertEquals(422, refused.status());
    assertEquals(PreviewExecution.WRITE_CODE, refused.code());
    InOrder order = inOrder(store, runtime);
    order.verify(store).beginClosing(SESSION, owner);
    order.verify(runtime).json("a", SESSION, identities, "GET", null, null);
    order.verify(store).endClosing(SESSION);
    verifyNoInteractions(generation);
    verify(runtime, never()).json(eq("a"), eq(SESSION), eq("/v1/sessions/" + SESSION), eq("DELETE"), any(), any());
  }

  @Test void aPreviewDeletionClosesAdmissionFirstAndClosesNothingWhenTheConversationHoldsALiveRun() throws Exception {
    runs("preview", "live");
    assertRefusedAndReopened();
  }

  @Test void aRunTheHostWouldCloseButTheRuntimeDoesNotNameAsThePreviewsIsAlsoRefused() throws Exception {
    runs();
    assertRefusedAndReopened();
  }

  @Test void aPreviewDeletesAConversationOfPreviewRunsOnlyAndALiveOwnerDeletesWithoutTheCheck() throws Exception {
    runs("preview");
    host.delete(SESSION, owner, true);
    verify(generation).close(SESSION, RUN, owner);
    verify(runtime).json("a", SESSION, "/v1/sessions/" + SESSION, "DELETE", null, null);
    verify(store, never()).endClosing(SESSION);
    reset(runtime);
    host.delete(SESSION, owner, false);
    verify(runtime, never()).json("a", SESSION, identities, "GET", null, null);
    verify(store, times(2)).beginClosing(SESSION, owner);
  }

  @Test void aSecondDeletionCannotTakeTheRightToCloseAndNeverReopensTheConversation() throws Exception {
    doThrow(new AgentHttpException(409, "SESSION_CLOSING", "The conversation is already being deleted"))
        .when(store).beginClosing(SESSION, owner);
    var refused = assertThrows(AgentHttpException.class, () -> host.delete(SESSION, owner, true));
    assertEquals("SESSION_CLOSING", refused.code());
    verify(store, never()).endClosing(any());
    verifyNoInteractions(runtime, generation);
  }

  @Test void theRightToCloseIsTakenAtomicallyByOneDeletionOnly() {
    var real = mock(OntologyAgentStore.class, CALLS_REAL_METHODS);
    doReturn(JSONObject.of("id", SESSION)).when(real).session(SESSION, owner);
    doReturn(1).when(real).update(eq("UPDATE ontology_agent_sessions SET closing=true WHERE id=? AND NOT closing"), any());
    real.beginClosing(SESSION, owner);
    // Already closing: the conditional update changes no row, and the second deletion is refused.
    doReturn(0).when(real).update(eq("UPDATE ontology_agent_sessions SET closing=true WHERE id=? AND NOT closing"), any());
    assertEquals("SESSION_CLOSING", assertThrows(AgentHttpException.class, () -> real.beginClosing(SESSION, owner)).code());
  }

  @Test void aDeletionThatFailsLeavesTheConversationAdmittingRunsAgain() throws Exception {
    doThrow(new AgentHttpException(409, "SESSION_BUSY", "busy")).when(generation).close(SESSION, RUN, owner);
    assertThrows(AgentHttpException.class, () -> host.delete(SESSION, owner, false));
    verify(store).endClosing(SESSION);
  }
}
