package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The preconditions decide whether an action starts at all, so each case here states one thing a
 * caller must not be able to do: run on another person's object, run on a wrong state, or run when the
 * subject value it compares against is missing.
 */
class ActionPreconditionServiceTest {

  private static final String DOMAIN = "d1";
  private static final String REPORT = "/report";

  private DslService queries;
  private OntologyQueryService scopedQueries;
  private ActionPreconditionService service;
  private User alice;
  private UserDataPermission permission;

  @BeforeEach
  void setUp() {
    queries = mock(DslService.class);
    AdminService admin = mock(AdminService.class);
    when(admin.getJSONRule(DOMAIN)).thenReturn(classRule());
    scopedQueries = mock(OntologyQueryService.class);
    service = new ActionPreconditionService(queries, admin, scopedQueries);

    alice = user("U1");
    permission = new UserDataPermission();
    permission.setFullData(true);

  }

  @Test
  void anActionWithoutCriteriaAlwaysRuns() {
    Action action = action(null);

    var verdict = service.evaluate(action, JSONObject.of("report_id", "R1"), alice, permission, ExecutionTarget.LIVE);

    assertTrue(verdict.satisfied());
    assertTrue(verdict.violations().isEmpty());
  }

  @Test
  void subjectComparisonsMustMoveToGrantsBeforeSaving() {
    for (Object ref : List.of("{{account.id}}", "{{principal.employeeId}}", List.of("{{org.self}}"))) {
      var error = org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class, () ->
          ActionPreconditionService.requireBusinessConditions(criteria(condition("submitter", "=", ref, "mine"))));
      assertTrue(error.getMessage().contains("conditions[0].value (submitter)"));
    }
  }

  @Test
  void aWrongObjectStateIsRejectedWithTheAuthorsMessage() {
    Action action =
        action(
            criteria(
                condition("status", "=", "待打款", "Only a report awaiting payment can be paid")));
    state("R1", "status", "已打款");

    var verdict = service.evaluate(action, JSONObject.of("report_id", "R1"), alice, permission, ExecutionTarget.LIVE);

    assertFalse(verdict.satisfied());
    assertEquals(List.of("Only a report awaiting payment can be paid"), verdict.violations());
  }

  @Test
  void aMissingObjectIsRejectedRatherThanTreatedAsSatisfied() {
    Action action = action(criteria(condition("status", "=", "待打款", "must exist")));
    when(queries.executeInternal(any(), any(), any()))
        .thenReturn(Map.of("data", new JSONArray()));

    var verdict = service.evaluate(action, JSONObject.of("report_id", "R1"), alice, permission, ExecutionTarget.LIVE);

    assertFalse(verdict.satisfied());
  }

  @Test
  void everyFailedConditionIsReportedAtOnce() {
    Action action =
        action(
            criteria(
                condition("submitter", "=", "U1", "wrong submitter"),
                condition("status", "=", "待打款", "wrong state")));
    when(queries.executeInternal(any(), any(), any()))
        .thenReturn(
            Map.of(
                "data",
                JSONArray.of(
                    JSONObject.of(
                        "answer",
                        JSONArray.of(JSONObject.of("submitter", "U2", "status", "已打款"))))));

    var verdict = service.evaluate(action, JSONObject.of("report_id", "R1"), alice, permission, ExecutionTarget.LIVE);

    assertFalse(verdict.satisfied());
    assertEquals(2, verdict.violations().size());
  }

  @Test
  void anNumericComparisonUsesNumericOrder() {
    Action action = action(criteria(condition("amount", ">", 1000, "amount too small")));
    when(queries.executeInternal(any(), any(), any()))
        .thenReturn(
            Map.of("data", JSONArray.of(JSONObject.of("answer", JSONArray.of(
                JSONObject.of("amount", "1500.00"))))));

    var verdict = service.evaluate(action, JSONObject.of("report_id", "R1"), alice, permission, ExecutionTarget.LIVE);

    assertTrue(verdict.satisfied(), "1500 compares above 1000 even as text");
  }

  @Test
  void previewChecksTheObjectInTheSameSandboxAsTheWrite() {
    var target = new ExecutionTarget("context", "sandbox", List.of(REPORT), 1L);
    var action = action(criteria(condition("status", "=", "open", "must be open")));
    when(scopedQueries.execute(any(), org.mockito.ArgumentMatchers.argThat(access ->
        access.target().equals(target) && access.user().getId().equals(alice.getId())
            && access.user().getDomainId().equals(DOMAIN) && access.permission().isFullData())))
        .thenReturn(Map.of("data", JSONArray.of(JSONObject.of("answer", JSONArray.of(JSONObject.of("status", "open"))))));
    assertTrue(service.evaluate(action, JSONObject.of("report_id", "R1"), alice, permission, target).satisfied());
    org.mockito.Mockito.verifyNoInteractions(queries);
  }

  private void state(String reportId, String field, Object value) {
    when(queries.executeInternal(any(), any(), any()))
        .thenReturn(
            Map.of(
                "data",
                JSONArray.of(
                    JSONObject.of("answer", JSONArray.of(JSONObject.of(field, value))))));
  }

  private static User user(String id) {
    return new User() {
      public String getId() {
        return id;
      }

      public String getLoginCode() {
        return "alice";
      }

      public String getUserName() {
        return "Alice";
      }

      public boolean isEnable() {
        return true;
      }

      public String getDomainId() {
        return DOMAIN;
      }
    };
  }

  private static Action action(JSONObject criteria) {
    Action action = new Action();
    action.setId("withdraw");
    action.setStatus(Action.STATUS_PUBLISHED);
    action.setDomainId(DOMAIN);
    action.setSubmissionCriteria(criteria);
    return action;
  }

  private static JSONObject criteria(JSONObject... conditions) {
    return JSONObject.of("operator", "AND", "conditions", JSONArray.of((Object[]) conditions));
  }

  private static JSONObject condition(
      String field, String operator, Object value, String message) {
    return JSONObject.of(
        "kind",
        "PROPERTY",
        "objectParameter",
        "report_id",
        "className",
        REPORT,
        "field",
        field,
        "operator",
        operator,
        "value",
        value,
        "message",
        message);
  }

  private static Map<String, Object> classRule() {
    return Map.of(
        "classDef",
        List.of(
            Map.of(
                "className",
                REPORT,
                "attrs",
                List.of(
                    Map.of("name", "id", "type", "varchar", "primaryKey", true),
                    Map.of("name", "submitter", "type", "varchar"),
                    Map.of("name", "status", "type", "varchar"),
                    Map.of("name", "amount", "type", "number")))));
  }
}
