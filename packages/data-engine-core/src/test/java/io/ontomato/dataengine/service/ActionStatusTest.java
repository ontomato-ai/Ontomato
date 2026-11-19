package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.action.BusinessMeaning;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.service.agent.OntologyGenerationService;
import io.ontomato.dataengine.service.impl.ActionServiceImpl;
import io.ontomato.dataengine.service.scheduling.OntologyScheduleReferences;
import io.ontomato.dataengine.util.CodeHashUtil;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

/** A batch status change keeps its business refusals apart from execution failures. */
class ActionStatusTest {
  private static final String CODE = "# ontomato-python:2\nprint('ok')";

  private final ActionServiceImpl service = new ActionServiceImpl();
  private final ActionDao actionDao = mock(ActionDao.class);
  private final FunctionDao functionDao = mock(FunctionDao.class);
  private final LangService langService = mock(LangService.class);
  private final OntologyGenerationService generationService = mock(OntologyGenerationService.class);
  private final OntologyScheduleReferences scheduledReferences = mock(OntologyScheduleReferences.class);
  private final Map<String, Action> actions = new LinkedHashMap<>();
  private final JSONArray segments = JSONArray.of(JSONObject.of("id", "s1"));

  @BeforeEach
  void setup() {
    ReflectionTestUtils.setField(service, "actionDao", actionDao);
    ReflectionTestUtils.setField(service, "functionDao", functionDao);
    ReflectionTestUtils.setField(service, "langService", langService);
    ReflectionTestUtils.setField(service, "generationService", generationService);
    ReflectionTestUtils.setField(service, "scheduledReferences", scheduledReferences);
    when(langService.get(anyString(), anyString())).thenAnswer(call -> call.getArgument(1));
    when(scheduledReferences.referencesAction(anyString())).thenReturn(false);
    when(actionDao.queryById(anyString())).thenAnswer(call -> {
      Action action = actions.get(call.getArgument(0));
      if (action == null) return null;
      return new Object[] {copy(action), action.getFunction().getId()};
    });
    when(functionDao.queryById(anyString())).thenAnswer(call -> {
      Action action = actions.values().stream()
          .filter(item -> item.getFunction().getId().equals(call.getArgument(0))).findFirst().orElse(null);
      return action == null ? null : copyFunction(action.getFunction());
    });
    when(actionDao.saveWithFunction(any(), anyString())).thenAnswer(call -> call.getArgument(0));
  }

  @Test
  void oneRefusalDoesNotStopTheOtherItems() {
    put(action("a1"));

    List<ActionService.StatusResult> results =
        service.setStatus("domain-a", "reviewer", List.of("missing", "a1"), Action.STATUS_PUBLISHED, "en");

    assertEquals(2, results.size());
    assertEquals("missing", results.get(0).id());
    assertNull(results.get(0).data());
    assertEquals("ACTION_NOT_FOUND", results.get(0).refusal().code());
    assertEquals("Action not found", results.get(0).refusal().getMessage());
    assertNull(results.get(0).error());
    assertEquals("a1", results.get(1).id());
    assertNull(results.get(1).refusal());
    assertNull(results.get(1).error());
    assertEquals(Action.STATUS_PUBLISHED, results.get(1).data().getStatus());
    assertEquals("Approve order", results.get(1).data().getName());
    ArgumentCaptor<Action> captured = ArgumentCaptor.forClass(Action.class);
    verify(actionDao).saveWithFunction(captured.capture(), anyString());
    assertEquals(Action.STATUS_PUBLISHED, captured.getValue().getStatus());
    assertEquals("reviewer", captured.getValue().getReviewedBy());
  }

  @Test
  void aSystemActionIsARejectionRatherThanAFailure() {
    Action system = action("system");
    system.setOrigin(Action.ORIGIN_SYSTEM);
    put(system);

    ActionService.StatusResult result =
        service.setStatus("domain-a", "reviewer", List.of("system"), Action.STATUS_UNUSED, "en").get(0);

    assertNull(result.data());
    assertEquals("ACTION_SYSTEM", result.refusal().code());
    assertEquals("Action.cannotModifySystem", result.refusal().getMessage());
    assertNull(result.error());
  }

  @Test
  void anExecutionFailureCarriesNoRefusalCode() {
    put(action("a1"));
    when(actionDao.saveWithFunction(any(), anyString())).thenThrow(new RuntimeException("database unavailable"));

    ActionService.StatusResult result =
        service.setStatus("domain-a", "reviewer", List.of("a1"), Action.STATUS_PUBLISHED, "en").get(0);

    assertNull(result.data());
    assertNull(result.refusal());
    assertEquals("database unavailable", result.error());
  }

  @Test
  void publishingRecordsTheReviewerAndReusesTheStoredExplanation() {
    put(action("a1"));

    ActionService.StatusResult result =
        service.setStatus("domain-a", "reviewer", List.of("a1"), Action.STATUS_PUBLISHED, "en").get(0);

    assertNull(result.refusal());
    assertNull(result.error());
    assertEquals("reviewer", result.data().getReviewedBy());
    assertEquals(segments, result.data().getCodeSegments());
    assertEquals(List.of("Approve the order"), result.data().getBusinessMeaning().getOperations());
    verifyNoInteractions(generationService);
  }

  @Test
  void handlesARepeatedIdOnce() {
    put(action("a1"));

    List<ActionService.StatusResult> results =
        service.setStatus("domain-a", "reviewer", List.of("a1", "a1"), Action.STATUS_UNUSED, "en");

    assertEquals(1, results.size());
    verify(actionDao, times(1)).saveWithFunction(any(), anyString());
  }

  @Test
  void rejectsAnEmptyIdListOrAnUnknownStatusBeforeAnyWork() {
    OwnerRefusal empty = assertThrows(OwnerRefusal.class,
        () -> service.setStatus("domain-a", "reviewer", List.of(), Action.STATUS_PUBLISHED, "en"));
    assertEquals("ACTION_STATUS_INVALID", empty.code());
    OwnerRefusal unknown = assertThrows(OwnerRefusal.class,
        () -> service.setStatus("domain-a", "reviewer", List.of("a1"), "DELETED", "en"));
    assertEquals("ACTION_STATUS_INVALID", unknown.code());
    OwnerRefusal missing = assertThrows(OwnerRefusal.class,
        () -> service.setStatus("domain-a", "reviewer", List.of("a1"), null, "en"));
    assertEquals("ACTION_STATUS_INVALID", missing.code());
    verifyNoInteractions(actionDao);
  }

  private void put(Action action) {
    actions.put(action.getId(), action);
  }

  private Action action(String id) {
    Function function = new Function();
    function.setId("f-" + id);
    function.setName("Write order");
    function.setOrigin(Function.ORIGIN_USER);
    function.setOperation(Function.OPERATION_WRITE);
    function.setDomainId("domain-a");
    function.setParameters(new ArrayList<>());
    ReturnDef returnDef = new ReturnDef();
    returnDef.setIsVoid(true);
    function.setReturnDef(returnDef);
    function.setCode(CODE);
    Action action = new Action();
    action.setId(id);
    action.setName("Approve order");
    action.setOrigin(Action.ORIGIN_USER);
    action.setStatus(Action.STATUS_PENDING_REVIEW);
    action.setDomainId("domain-a");
    action.setFunction(function);
    action.setCodeSegments(segments);
    BusinessMeaning meaning = new BusinessMeaning();
    meaning.setOperations(List.of("Approve the order"));
    meaning.setNegativeEffect("");
    action.setBusinessMeaning(meaning);
    action.setCodeHash(CodeHashUtil.sha256(CODE));
    action.setExplanationVersion(Action.EXPLANATION_VERSION);
    return action;
  }

  private static Action copy(Action action) {
    return JSON.parseObject(
        JSON.toJSONString(action, com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue), Action.class);
  }

  private static Function copyFunction(Function function) {
    return JSON.parseObject(
        JSON.toJSONString(function, com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue), Function.class);
  }
}
