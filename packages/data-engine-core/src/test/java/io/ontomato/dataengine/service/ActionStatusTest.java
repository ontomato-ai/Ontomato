package io.ontomato.dataengine.service;

import io.ontomato.dataengine.service.authorization.ActionAuthorization;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.action.ActionTarget;
import io.ontomato.dataengine.bean.action.BusinessMeaning;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.dao.JSONRuleDao;
import java.time.Instant;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import io.ontomato.dataengine.service.agent.OntologyGenerationService;
import io.ontomato.dataengine.service.agent.OntologyAgentStore;
import java.util.function.Supplier;
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
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private ActionTrialStore trials;
  private final Map<String, Action> actions = new LinkedHashMap<>();
  private final JSONArray segments = JSONArray.of(JSONObject.of("id", "s1"));

  @BeforeEach
  void setup() {
    OntologyAgentStore store = mock(OntologyAgentStore.class);
    when(store.transaction(any())).thenAnswer(call -> call.<Supplier<?>>getArgument(0).get());
    var schemas = mock(JSONRuleDao.class);
    when(schemas.query("domain-a")).thenReturn(Map.of("classDef",
        List.of(Map.of("className", "Order"), Map.of("className", "Invoice"))));
    trials = new ActionTrialStore(jdbc, schemas, langService);
    ReflectionTestUtils.setField(service, "actionTrials", trials);
    ReflectionTestUtils.setField(service, "store", store);
    ReflectionTestUtils.setField(service, "authorization", mock(ActionAuthorization.class));
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
    when(actionDao.updateStatus(any())).thenAnswer(call -> call.getArgument(0));
  }

  @Test
  void oneRefusalDoesNotStopTheOtherItems() {
    put(action("a1"));
    seedTrial(actions.get("a1"), "PASSED");

    List<ActionService.StatusResult> results =
        service.setStatus("domain-a", "reviewer", List.of("missing", "a1"), Action.STATUS_PUBLISHED, "en");

    assertEquals(2, results.size());
    assertEquals("missing", results.get(0).id());
    assertNull(results.get(0).data());
    assertEquals("ACTION_NOT_FOUND", results.get(0).refusal().code());
    assertNull(results.get(0).error());
    assertEquals("a1", results.get(1).id());
    assertNull(results.get(1).refusal());
    assertNull(results.get(1).error());
    assertEquals(Action.STATUS_PUBLISHED, results.get(1).data().getStatus());
    assertEquals("Approve order", results.get(1).data().getName());
    ArgumentCaptor<Action> captured = ArgumentCaptor.forClass(Action.class);
    verify(actionDao).updateStatus(captured.capture());
    assertEquals(Action.STATUS_PUBLISHED, captured.getValue().getStatus());
    assertEquals("reviewer", captured.getValue().getReviewedBy());
  }

  @Test
  void publicationRequiresTheLatestTrialToPass() {
    Action action = action("a1");
    put(action);
    assertEquals("ACTION_TRIAL_REQUIRED", publish(action).refusal().code());
    seedTrial(action, "FAILED");
    assertEquals("ACTION_TRIAL_FAILED", publish(action).refusal().code());
    verify(actionDao, never()).updateStatus(any());

    seedTrial(action, "PASSED");
    assertEquals(Action.STATUS_PUBLISHED, publish(action).data().getStatus());
  }

  @Test
  void changingCodeOrTargetRequiresAnotherTrial() {
    Action action = action("a1");
    action.setTarget(new ActionTarget("Order", "orderId"));
    put(action);
    seedTrial(action, "PASSED");
    assertNotNull(publish(action).data());

    action.setTarget(new ActionTarget("Invoice", "orderId"));
    assertEquals("ACTION_TRIAL_REQUIRED", publish(action).refusal().code());
    action.setTarget(new ActionTarget("Order", "orderId"));

    action.getFunction().setCode(CODE + "\nprint('changed')");
    action.setCodeHash(CodeHashUtil.sha256(action.getFunction().getCode()));
    assertEquals("ACTION_TRIAL_REQUIRED", publish(action).refusal().code());
  }

  private ActionService.StatusResult publish(Action action) {
    return service.setStatus("domain-a", "reviewer", List.of(action.getId()), Action.STATUS_PUBLISHED, "en").getFirst();
  }

  private void seedTrial(Action action, String status) {
    var function = action.getFunction();
    String digest = trials.digest(action.getDomainId(), function.getCode(), action.getTarget(), function.getParameters());
    var trial = new ActionTrialStore.TrialSummary("trial", status, null, null, 2L, Instant.EPOCH);
    doReturn(List.of(trial)).when(jdbc).query(anyString(), any(RowMapper.class),
        eq(action.getDomainId()), eq(digest), eq(action.getId()));
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
    seedTrial(actions.get("a1"), "PASSED");
    when(actionDao.updateStatus(any())).thenThrow(new RuntimeException("database unavailable"));

    ActionService.StatusResult result =
        service.setStatus("domain-a", "reviewer", List.of("a1"), Action.STATUS_PUBLISHED, "en").get(0);

    assertNull(result.data());
    assertNull(result.refusal());
    assertEquals("database unavailable", result.error());
  }

  @Test
  void publishingRecordsTheReviewerAndReusesTheStoredExplanation() {
    put(action("a1"));
    seedTrial(actions.get("a1"), "PASSED");

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
  void publicationRefusesMissingOrStaleExplanationsWithoutChangingStatus() {
    Action missing = action("missing-explanation");
    missing.setCodeSegments(null);
    put(missing);
    Action stale = action("stale-explanation");
    stale.setCodeHash(CodeHashUtil.sha256("old code"));
    put(stale);
    Action oldVersion = action("old-version");
    oldVersion.setExplanationVersion(Action.EXPLANATION_VERSION - 1);
    put(oldVersion);

    var results = service.setStatus("domain-a", "reviewer",
        List.of(missing.getId(), stale.getId(), oldVersion.getId()), Action.STATUS_PUBLISHED, "en");

    for (var result : results) assertEquals("ACTION_EXPLANATION_REQUIRED", result.refusal().code());
    verify(actionDao, never()).updateStatus(any());
    verifyNoInteractions(generationService);
  }

  @Test
  void handlesARepeatedIdOnce() {
    put(action("a1"));

    List<ActionService.StatusResult> results =
        service.setStatus("domain-a", "reviewer", List.of("a1", "a1"), Action.STATUS_UNUSED, "en");

    assertEquals(1, results.size());
    verify(actionDao, times(1)).updateStatus(any());
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
