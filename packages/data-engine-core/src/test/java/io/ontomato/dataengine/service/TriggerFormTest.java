package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.trigger.Trigger;
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.TriggerDao;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.identity.UserCredentials;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * Owner form, field validation, cadence summary and lifecycle refusals for Triggers.
 */
class TriggerFormTest {

  private final TriggerDao triggers = mock(TriggerDao.class);
  private final ActionService actions = mock(ActionService.class);
  private final WorkflowService workflows = mock(WorkflowService.class);
  private final UserCredentials credentials = mock(UserCredentials.class);
  private final LangService langService = mock(LangService.class);
  private final TriggerService service = new TriggerService();

  @BeforeEach
  void setUp() {
    ReflectionTestUtils.setField(service, "triggers", triggers);
    ReflectionTestUtils.setField(service, "actions", actions);
    ReflectionTestUtils.setField(service, "workflows", workflows);
    ReflectionTestUtils.setField(service, "credentials", credentials);
    ReflectionTestUtils.setField(service, "langService", langService);
    when(langService.get(anyString(), anyString())).thenAnswer(inv -> inv.getArgument(1));
  }

  private static User user(String id, String domainId) {
    User user = mock(User.class);
    when(user.getId()).thenReturn(id);
    when(user.getDomainId()).thenReturn(domainId);
    return user;
  }

  private static Action action(String id, String name) {
    Action action = new Action();
    action.setId(id);
    action.setName(name);
    return action;
  }

  private static Workflow workflow(String id, String name) {
    Workflow workflow = new Workflow();
    workflow.setId(id);
    workflow.setName(name);
    return workflow;
  }

  private static Trigger storedActionTrigger(String id, String domainId) {
    Trigger trigger = new Trigger();
    trigger.setId(id);
    trigger.setDomainId(domainId);
    trigger.setName("Nightly stock check");
    trigger.setDescription("Checks low inventory");
    trigger.setConditionKind(Trigger.CONDITION_TIME);
    trigger.setCondition(JSONObject.of(
        "frequency", JSONObject.of("kind", "daily", "time", "02:30"),
        "timeZone", "Asia/Shanghai"));
    trigger.setEffectKind(Trigger.EFFECT_ACTION);
    trigger.setEffect(JSONObject.of("actionId", "act-1", "parameters", JSONObject.of("warehouse", "east")));
    trigger.setExecutor("principal:ops-bot");
    trigger.setStatus(Trigger.STATUS_PUBLISHED);
    trigger.setEnabled(true);
    trigger.setCreatedBy("u1");
    return trigger;
  }

  @Test
  void formReadPreservesExecutorAndSwitchesEffectFields() {
    Trigger existing = storedActionTrigger("tr-1", "d1");
    when(triggers.queryById("tr-1")).thenReturn(existing);
    when(actions.queryList(null, null, null, "d1")).thenReturn(List.of(action("act-1", "Check stock")));
    when(workflows.queryList(null, "d1")).thenReturn(List.of(workflow("wf-1", "Restock flow")));

    JSONObject loaded = service.definitionForm(
        JSONObject.of("target", JSONObject.of("kind", "object", "objectType", "platform:Trigger", "primaryKey", "tr-1")),
        "en", "d1");
    assertEquals("principal:ops-bot", loaded.getJSONObject("values").getString("executor"));
    assertEquals("trigger.update", loaded.getJSONObject("save").getString("draftOperation"));
    assertTrue(fieldPaths(loaded).contains("/effect/actionId"));
    assertFalse(fieldPaths(loaded).contains("/effect/workflowId"));

    JSONObject draftValues = JSONObject.parseObject(loaded.getJSONObject("values").toJSONString());
    draftValues.put("effectKind", Trigger.EFFECT_WORKFLOW);
    JSONObject refreshed = service.definitionForm(
        JSONObject.of(
            "target", JSONObject.of("kind", "object", "objectType", "platform:Trigger", "primaryKey", "tr-1"),
            "values", draftValues,
            "changedField", "/effectKind"),
        "en", "d1");
    assertTrue(fieldPaths(refreshed).contains("/effect/workflowId"));
    assertFalse(fieldPaths(refreshed).contains("/effect/actionId"));
    assertEquals(0, refreshed.getJSONArray("errors").size());
  }

  @Test
  void formMarksMissingTargetAsDisabledOptionAndRefusesCrossDomainRead() {
    Trigger existing = storedActionTrigger("tr-1", "d1");
    existing.setEffect(JSONObject.of("actionId", "deleted-act", "parameters", new JSONObject()));
    when(triggers.queryById("tr-1")).thenReturn(existing);
    when(actions.queryList(null, null, null, "d1")).thenReturn(List.of(action("act-1", "Check stock")));
    when(workflows.queryList(null, "d1")).thenReturn(List.of());

    JSONObject loaded = service.definitionForm(
        JSONObject.of("target", JSONObject.of("kind", "object", "objectType", "platform:Trigger", "primaryKey", "tr-1")),
        "en", "d1");
    // Empty parameters object is normalized to null so the JSON editor renders cleanly empty.
    assertNull(loaded.getJSONObject("values").getJSONObject("effect").get("parameters"));
    JSONArray options = fieldByPath(loaded, "/effect/actionId").getJSONObject("control").getJSONArray("options");
    JSONObject missingOption = options.getJSONObject(1);
    assertEquals("deleted-act", missingOption.getString("value"));
    assertTrue(missingOption.getBooleanValue("disabled"));
    assertNotNull(missingOption.getString("disabledReason"));

    OwnerRefusal crossDomain = assertThrows(OwnerRefusal.class, () -> service.definitionForm(
        JSONObject.of("target", JSONObject.of("kind", "object", "objectType", "platform:Trigger", "primaryKey", "tr-1")),
        "en", "d2"));
    assertEquals("TRIGGER_NOT_FOUND", crossDomain.code());
  }

  @Test
  void fieldValidationCatchesInvalidFrequencyTimeZoneTargetAndPayloadTypes() {
    JSONObject bad = JSONObject.of(
        "name", "   ",
        "conditionKind", Trigger.CONDITION_TIME,
        "condition", JSONObject.of(
            "frequency", JSONObject.of("kind", "cron", "expression", "not-a-cron"),
            "timeZone", "Mars/Olympus"),
        "effectKind", Trigger.EFFECT_ACTION,
        "effect", JSONObject.of("actionId", "missing-act", "parameters", JSONArray.of(1, 2)),
        "status", "BOGUS");

    List<ObjectNode> errors = TriggerForm.fieldErrors(bad, Set.of("act-1"), Set.of("wf-1"), "en", langService);
    assertEquals(Set.of(
        "/name:required",
        "/condition/frequency:invalid_format",
        "/condition/timeZone:invalid_format",
        "/effect/actionId:target_unavailable",
        "/effect/parameters:invalid_object",
        "/status:invalid_option"),
        errorPairs(errors));
  }

  @Test
  void savePreservesExistingExecutorWithSubmittedFieldsAndPropagatesInteractiveLoginRefusal() {
    Trigger existing = storedActionTrigger("tr-1", "d1");
    existing.setEffectKind(Trigger.EFFECT_WORKFLOW);
    existing.setEffect(JSONObject.of("workflowId", "wf-1", "requester", "alice", "goalText", "Run nightly"));
    existing.setExecutor("principal:u1");
    when(triggers.queryById("tr-1")).thenReturn(existing);
    when(actions.queryList(null, null, null, "d1")).thenReturn(List.of());
    when(workflows.queryList(null, "d1")).thenReturn(List.of(workflow("wf-1", "Restock flow")));
    when(triggers.save(any(Trigger.class), eq("u1"), anyLong())).thenAnswer(inv -> inv.getArgument(0));

    Trigger saved = service.saveDefinition(
        JSONObject.of(
            "id", "tr-1",
            "name", "Renamed nightly flow",
            "submittedFields", JSONArray.of("/name")),
        user("u1", "d1"), "en");
    assertEquals("Renamed nightly flow", saved.getName());
    assertEquals("principal:u1", saved.getExecutor());
    assertEquals("alice", saved.getEffect().getString("requester"));
    assertEquals("Run nightly", saved.getEffect().getString("goalText"));

    doThrow(new AgentHttpException(428, "INTERACTIVE_LOGIN_REQUIRED", "Login required"))
        .when(credentials).prepareForSetup(any());
    OwnerRefusal loginRefusal = assertThrows(OwnerRefusal.class, () -> service.saveDefinition(
        JSONObject.of(
            "id", "tr-1",
            "name", "Renamed again",
            "submittedFields", JSONArray.of("/name")),
        user("u1", "d1"), "en"));
    assertEquals("INTERACTIVE_LOGIN_REQUIRED", loginRefusal.code());
  }

  @Test
  void changeStatusAndDeleteEnforceDomainAndStatusRules() {
    Trigger existing = storedActionTrigger("tr-1", "d1");
    when(triggers.queryById("tr-1")).thenReturn(existing);
    when(triggers.save(any(Trigger.class), eq("u1"), anyLong())).thenAnswer(inv -> inv.getArgument(0));

    Trigger retired = service.changeStatus("tr-1", Trigger.STATUS_UNUSED, true, user("u1", "d1"), "en");
    assertEquals(Trigger.STATUS_UNUSED, retired.getStatus());
    assertFalse(retired.getEnabled());

    OwnerRefusal invalidStatus = assertThrows(
        OwnerRefusal.class,
        () -> service.changeStatus("tr-1", "ACTIVE", null, user("u1", "d1"), "en"));
    assertEquals("TRIGGER_STATUS_INVALID", invalidStatus.code());

    OwnerRefusal deleteWrongDomain = assertThrows(
        OwnerRefusal.class,
        () -> service.deleteInDomain("tr-1", "d2", "en"));
    assertEquals("TRIGGER_NOT_FOUND", deleteWrongDomain.code());

    service.deleteInDomain("tr-1", "d1", "en");
    verify(triggers).delete("tr-1", "d1");
  }

  @Test
  void cadenceSummaryFormatsAllKindsIncludingCronExpression() {
    when(langService.get("en", "Trigger.cadence.interval")).thenReturn("Every {every} {unit}");
    when(langService.get("en", "Trigger.unit.minute")).thenReturn("min");
    when(langService.get("en", "Trigger.cadence.daily")).thenReturn("Daily at {time}");
    when(langService.get("en", "Trigger.cadence.weekly")).thenReturn("Every {weekday} at {time}");
    when(langService.get("en", "Trigger.weekday.3")).thenReturn("Wed");
    when(langService.get("en", "Trigger.cadence.monthly")).thenReturn("Monthly on day {day} at {time}");

    assertEquals("Every 15 min", TriggerForm.cadenceSummary(
        JSONObject.of("frequency", JSONObject.of("kind", "interval", "every", 15, "unit", "minute")), "en", langService));
    assertEquals("Daily at 08:00", TriggerForm.cadenceSummary(
        JSONObject.of("frequency", JSONObject.of("kind", "daily", "time", "08:00")), "en", langService));
    assertEquals("Every Wed at 09:30", TriggerForm.cadenceSummary(
        JSONObject.of("frequency", JSONObject.of("kind", "weekly", "weekday", 3, "time", "09:30")), "en", langService));
    assertEquals("Monthly on day 1 at 00:00", TriggerForm.cadenceSummary(
        JSONObject.of("frequency", JSONObject.of("kind", "monthly", "day", 1, "time", "00:00")), "en", langService));
    assertEquals("0 0 9 * * MON-FRI", TriggerForm.cadenceSummary(
        JSONObject.of("frequency", JSONObject.of("kind", "cron", "expression", "0 0 9 * * MON-FRI")), "en", langService));
  }

  private static List<String> fieldPaths(JSONObject form) {
    return form.getJSONArray("fields").stream()
        .map(item -> ((JSONObject) item).getString("path"))
        .toList();
  }

  private static JSONObject fieldByPath(JSONObject form, String path) {
    return form.getJSONArray("fields").stream()
        .map(item -> (JSONObject) item)
        .filter(field -> path.equals(field.getString("path")))
        .findFirst()
        .orElseThrow();
  }

  private static Set<String> errorPairs(List<ObjectNode> errors) {
    return errors.stream()
        .map(err -> err.path("field").asText() + ":" + err.path("code").asText())
        .collect(java.util.stream.Collectors.toSet());
  }
}
