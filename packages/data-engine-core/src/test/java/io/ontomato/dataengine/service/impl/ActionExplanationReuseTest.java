package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.agent.OntologyAgentStore.Owner;
import io.ontomato.dataengine.service.agent.OntologyGenerationService;
import io.ontomato.dataengine.util.CodeHashUtil;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * A save that names an explanation accepted for an unsaved draft reuses it only for exactly that code and the current
 * explanation version; the platform's authoring path relies on this instead of explaining the same code twice.
 */
class ActionExplanationReuseTest {
  private static final String CODE = "# ontomato-python:2\nprint('ok')";
  private final ActionDao actions = mock(ActionDao.class);
  private final OntologyGenerationService generation = mock(OntologyGenerationService.class);
  private final ActionServiceImpl service = new ActionServiceImpl();
  private final Owner owner = new Owner("user-a", "domain-a");
  private final JSONArray segments = JSONArray.of(JSONObject.of("id", "s1"));

  @BeforeEach
  void setup() {
    ReflectionTestUtils.setField(service, "actionDao", actions);
    ReflectionTestUtils.setField(service, "generationService", generation);
    ReflectionTestUtils.setField(service, "langService", mock(LangService.class));
  }

  private Action draft() {
    var function = new Function();
    function.setOperation(Function.OPERATION_WRITE);
    function.setDomainId("domain-a");
    function.setCode(CODE);
    var action = new Action();
    action.setDomainId("domain-a");
    action.setStatus(Action.STATUS_PENDING_REVIEW);
    action.setFunction(function);
    return action;
  }

  private JSONObject evidence(String sourceDigest, int explanationVersion) {
    return JSONObject.of(
        "sourceDigest", sourceDigest,
        "explanationVersion", explanationVersion,
        "acceptedResultRef", "run-1",
        "acceptedResult", JSONObject.of(
            "codeSegments", segments,
            "businessMeaning", JSONObject.of("operations", List.of("Approve the expense"), "negativeEffect", "")));
  }

  @Test
  void reusesTheExplanationAcceptedForThisCode() throws Exception {
    when(generation.explanationEvidence("run-1", owner))
        .thenReturn(evidence(CodeHashUtil.sha256(CODE), Action.EXPLANATION_VERSION));
    when(actions.saveWithFunction(any(), anyString())).thenAnswer(call -> call.getArgument(0));

    Action saved = service.save(draft(), "run-1", owner, "en");

    assertEquals(segments, saved.getCodeSegments());
    assertEquals(List.of("Approve the expense"), saved.getBusinessMeaning().getOperations());
    assertEquals(CodeHashUtil.sha256(CODE), saved.getCodeHash());
    assertEquals(Action.EXPLANATION_VERSION, saved.getExplanationVersion());
    verify(generation, never()).generate(anyString(), anyString(), anyString(), anyString(), anyString(), anyString());
  }

  @Test
  void refusesAnExplanationAcceptedForOtherCode() {
    when(generation.explanationEvidence("run-1", owner))
        .thenReturn(evidence(CodeHashUtil.sha256("# ontomato-python:2\nprint('other')"), Action.EXPLANATION_VERSION));

    assertThrows(IllegalArgumentException.class, () -> service.save(draft(), "run-1", owner, "en"));
    verify(actions, never()).saveWithFunction(any(), anyString());
  }

  @Test
  void refusesAnExplanationOfAnOlderVersion() {
    when(generation.explanationEvidence("run-1", owner))
        .thenReturn(evidence(CodeHashUtil.sha256(CODE), Action.EXPLANATION_VERSION - 1));

    assertThrows(IllegalArgumentException.class, () -> service.save(draft(), "run-1", owner, "en"));
    verify(actions, never()).saveWithFunction(any(), anyString());
  }
}
