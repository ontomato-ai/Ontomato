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
  private SubjectAttributeLookup subjects;
  private ActionPreconditionService service;
  private User alice;
  private UserDataPermission permission;

  @BeforeEach
  void setUp() {
    queries = mock(DslService.class);
    subjects = mock(SubjectAttributeLookup.class);
    AdminService admin = mock(AdminService.class);
    when(admin.getJSONRule(DOMAIN)).thenReturn(classRule());
    service = new ActionPreconditionService(queries, admin, subjects);

    alice = user("U1");
    permission = new UserDataPermission();
    permission.setFullData(true);

    when(subjects.attribute(any(), eq(SubjectAttributeLookup.ACCOUNT), eq("id")))
        .thenAnswer(invocation -> ((User) invocation.getArgument(0)).getId());
  }

  @Test
  void anActionWithoutCriteriaAlwaysRuns() {
    Action action = action(null);

    var verdict = service.evaluate(action, JSONObject.of("report_id", "R1"), alice, permission);

    assertTrue(verdict.satisfied());
    assertTrue(verdict.violations().isEmpty());
  }

  @Test
  void aSubjectReferenceRejectsAnotherPersonsObject() {
    Action action =
        action(
            criteria(
                condition(
                    "submitter",
                    "=",
                    "{{account.id}}",
                    "Only the submitter may withdraw this report")));
    state("R1", "submitter", "U2");

    var verdict = service.evaluate(action, JSONObject.of("report_id", "R1"), alice, permission);

    assertFalse(verdict.satisfied());
    assertEquals(List.of("Only the submitter may withdraw this report"), verdict.violations());
  }

  @Test
  void aSubjectReferenceAdmitsTheOwnersObject() {
    Action action = action(criteria(condition("submitter", "=", "{{account.id}}", "mine")));
    state("R1", "submitter", "U1");

    var verdict = service.evaluate(action, JSONObject.of("report_id", "R1"), alice, permission);

    assertTrue(verdict.satisfied());
  }

  @Test
  void aWrongObjectStateIsRejectedWithTheAuthorsMessage() {
    Action action =
        action(
            criteria(
                condition("status", "=", "待打款", "Only a report awaiting payment can be paid")));
    state("R1", "status", "已打款");

    var verdict = service.evaluate(action, JSONObject.of("report_id", "R1"), alice, permission);

    assertFalse(verdict.satisfied());
    assertEquals(List.of("Only a report awaiting payment can be paid"), verdict.violations());
  }

  @Test
  void aMissingObjectIsRejectedRatherThanTreatedAsSatisfied() {
    Action action = action(criteria(condition("status", "=", "待打款", "must exist")));
    when(queries.executeInternal(any(), any(), any()))
        .thenReturn(Map.of("data", new JSONArray()));

    var verdict = service.evaluate(action, JSONObject.of("report_id", "R1"), alice, permission);

    assertFalse(verdict.satisfied());
  }

  @Test
  void aMissingSubjectValueNeverMatches() {
    Action action = action(criteria(condition("submitter", "=", "{{principal.employeeId}}", "mine")));
    when(subjects.attribute(any(), eq(SubjectAttributeLookup.PRINCIPAL), eq("employeeId")))
        .thenReturn(null);
    state("R1", "submitter", "U1");

    var verdict = service.evaluate(action, JSONObject.of("report_id", "R1"), alice, permission);

    assertFalse(verdict.satisfied(), "an unresolved subject reference must not match");
  }

  @Test
  void everyFailedConditionIsReportedAtOnce() {
    Action action =
        action(
            criteria(
                condition("submitter", "=", "{{account.id}}", "not mine"),
                condition("status", "=", "待打款", "wrong state")));
    when(queries.executeInternal(any(), any(), any()))
        .thenReturn(
            Map.of(
                "data",
                JSONArray.of(
                    JSONObject.of(
                        "answer",
                        JSONArray.of(JSONObject.of("submitter", "U2", "status", "已打款"))))));

    var verdict = service.evaluate(action, JSONObject.of("report_id", "R1"), alice, permission);

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

    var verdict = service.evaluate(action, JSONObject.of("report_id", "R1"), alice, permission);

    assertTrue(verdict.satisfied(), "1500 compares above 1000 even as text");
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
