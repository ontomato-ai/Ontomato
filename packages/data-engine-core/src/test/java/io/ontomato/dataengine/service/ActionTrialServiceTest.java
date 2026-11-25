package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.action.ActionTarget;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.impl.ABCProgramServiceImpl;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.CodeHashUtil;
import java.sql.ResultSet;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

class ActionTrialServiceTest {
  private static final String CODE = "# ontomato-python:2\nprint('ok')";
  private static final String DOMAIN = "domain";
  private static final String USER = "author";
  private static final String ACTION = "action";
  private static final String SANDBOX = "sandbox";
  private static final QueryAccessService.GrantUser CALLER = new QueryAccessService.GrantUser(USER, DOMAIN);

  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final JSONRuleDao schemas = mock(JSONRuleDao.class);
  private final LangService messages = mock(LangService.class);
  private final ActionService actions = mock(ActionService.class);
  private final IdentityService identity = mock(IdentityService.class);
  private final DataSandboxService sandboxes = mock(DataSandboxService.class);
  private final ActionPreconditionService preconditions = mock(ActionPreconditionService.class);
  private final IdentitySnapshotLookup snapshots = mock(IdentitySnapshotLookup.class);
  private final ABCProgramService programs = mock(ABCProgramService.class);
  private final UserDataPermission permission = new UserDataPermission();
  private final ActionTrialStore store = new ActionTrialStore(jdbc, schemas, messages);
  private final ActionTrialService trials =
      new ActionTrialService(store, messages, actions, identity, sandboxes, preconditions, snapshots, programs);

  @BeforeEach
  void setup() {
    when(schemas.query(DOMAIN)).thenReturn(Map.of("classDef",
        List.of(Map.of("className", "Order"), Map.of("className", "/Invoice"))));
    when(messages.get(eq("en"), anyString())).thenAnswer(call -> call.getArgument(1));
    when(sandboxes.validateSample(any(), eq(Map.of()), eq(DOMAIN))).thenAnswer(call -> call.getArgument(0));
    when(sandboxes.open(eq(DOMAIN), eq(USER), startsWith("action-trial:"), anyLong(), anyList())).thenReturn(SANDBOX);
    when(preconditions.evaluate(any(), any(), eq(CALLER), eq(permission), any()))
        .thenReturn(ActionPreconditionService.Verdict.pass());
    when(snapshots.snapshot(CALLER, DOMAIN)).thenReturn(JSONObject.of("userId", USER));
    permission.setFullData(true);
  }

  @Test
  void digestBindsTheDefinitionAndNormalizesClassNamesWithoutParameterValues() {
    var order = new ActionTarget("Order", "id");
    var id = parameter("id", Parameter.TYPE_STRING, List.of("Invoice", "/Order"), "first");
    String digest = store.digest(DOMAIN, CODE, order, List.of(id));

    assertEquals(digest, store.digest(DOMAIN, CODE, new ActionTarget("/Order", "id"),
        List.of(parameter("id", Parameter.TYPE_STRING, List.of("Order", "/Invoice"), "second"))));
    assertNotEquals(digest, store.digest(DOMAIN, CODE, new ActionTarget("Invoice", "id"), List.of(id)));
    assertNotEquals(digest, store.digest(DOMAIN, CODE, new ActionTarget("Order", "otherId"), List.of(id)));
    assertNotEquals(digest, store.digest(DOMAIN, CODE, null, List.of(id)));
    assertNotEquals(digest, store.digest(DOMAIN, CODE + "\nprint(2)", order, List.of(id)));
    assertNotEquals(digest, store.digest(DOMAIN, CODE, order,
        List.of(parameter("otherId", id.getType(), id.getClassNames(), id.getValue()))));
    assertNotEquals(digest, store.digest(DOMAIN, CODE, order,
        List.of(parameter("id", Parameter.TYPE_NUMBER, id.getClassNames(), 1))));
    assertNotEquals(digest, store.digest(DOMAIN, CODE, order,
        List.of(parameter("id", id.getType(), List.of("Order"), id.getValue()))));
  }

  @Test
  void trialBindsParametersLoadsSamplesAndRecordsItsAnswerBeforeClosing() throws Exception {
    Action action = action(Action.STATUS_PENDING_REVIEW, parameter("id", Parameter.TYPE_STRING, List.of("Order"), "saved"));
    action.setTarget(new ActionTarget("Order", "id"));
    when(actions.queryById(ACTION)).thenReturn(action);
    var result = new PythonExecuteResult();
    result.setSpendTime(12L);
    when(programs.execute(anyString(), any(Function.class), eq(USER), eq(permission), eq(SANDBOX),
        eq("en"), eq(1), eq(DOMAIN), any())).thenAnswer(call -> {
          Function bound = call.getArgument(1);
          assertEquals("trial-id", bound.getParameters().getFirst().getValue());
          var context = call.<ABCProgramService.ExecutionContext>getArgument(8);
          assertNull(context.executionId());
          assertEquals(JSONObject.of("userId", USER), context.identity());
          assertEquals(List.of("Order"), context.target().classNames());
          assertEquals(SANDBOX, context.target().sandboxId());
          assertTrue(context.target().actionTrial());
          return new Object[]{List.of("ok"), result};
        });
    var sample = sample("Order");

    var receipt = trial(sample, JSONObject.of("id", "trial-id"));

    assertEquals("saved", action.getFunction().getParameters().getFirst().getValue());
    assertEquals("PASSED", receipt.getString("status"));
    assertEquals("passed", receipt.getString("trialStatus"));
    assertEquals("Action.sandboxTrial.passed", receipt.getString("trialStatusLabel"));
    assertTrue(receipt.getBooleanValue("passed"));
    assertEquals("{\"answer\":[\"ok\"]}", receipt.getString("result"));
    assertNull(receipt.get("error"));
    assertEquals(12L, receipt.getLong("spendTime"));
    Instant.parse(receipt.getString("testedAt"));
    var order = inOrder(sandboxes, programs, jdbc);
    order.verify(sandboxes).open(eq(DOMAIN), eq(USER), eq("action-trial:" + receipt.getString("trialId")),
        anyLong(), eq(List.of("Order")));
    order.verify(sandboxes).replaceClasses(SANDBOX, List.of("Order"), sample, DOMAIN);
    order.verify(sandboxes).reset(SANDBOX, DOMAIN);
    order.verify(programs).execute(eq(receipt.getString("trialId")), any(Function.class), eq(USER), eq(permission),
        eq(SANDBOX), eq("en"), eq(1), eq(DOMAIN), any());
    order.verify(jdbc).update(contains("INSERT INTO action_trials"), eq(receipt.getString("trialId")),
        eq(DOMAIN), eq(ACTION), eq(receipt.getString("digest")), eq("PASSED"), eq(receipt.getString("result")),
        isNull(), eq(12L), eq(USER), any(OffsetDateTime.class));
    order.verify(sandboxes).close(SANDBOX, DOMAIN);
  }

  @Test
  void failedPythonResultIsRecordedEvenWhenTheSandboxCloseFails() throws Exception {
    when(actions.queryById(ACTION)).thenReturn(action(Action.STATUS_UNUSED));
    var result = new PythonExecuteResult();
    result.setError("invalid order");
    result.setResult("incomplete output");
    result.setSpendTime(27L);
    when(programs.execute(anyString(), any(Function.class), eq(USER), eq(permission), eq(SANDBOX),
        eq("en"), eq(1), eq(DOMAIN), any())).thenReturn(new Object[]{null, result});
    doThrow(new IllegalStateException("drop failed")).when(sandboxes).close(SANDBOX, DOMAIN);

    var receipt = trial(null, null);

    assertEquals("FAILED", receipt.getString("status"));
    assertFalse(receipt.getBooleanValue("passed"));
    assertEquals("invalid order", receipt.getString("error"));
    assertNull(receipt.get("result"));
    verify(jdbc).update(contains("INSERT INTO action_trials"), eq(receipt.getString("trialId")),
        eq(DOMAIN), eq(ACTION), eq(receipt.getString("digest")), eq("FAILED"), isNull(),
        eq("invalid order"), eq(27L), eq(USER), any(OffsetDateTime.class));
    verify(sandboxes).close(SANDBOX, DOMAIN);
  }

  @Test
  void closesTheSandboxIfExecutionThrowsAnUnexpectedException() throws Exception {
    when(actions.queryById(ACTION)).thenReturn(action(Action.STATUS_PUBLISHED));
    when(programs.execute(anyString(), any(Function.class), eq(USER), eq(permission), eq(SANDBOX),
        eq("en"), eq(1), eq(DOMAIN), any())).thenThrow(new InterruptedException("request interrupted"));

    assertThrows(InterruptedException.class, () -> trial(null, null));

    verify(sandboxes).close(SANDBOX, DOMAIN);
    verifyNoInteractions(jdbc);
  }

  @Test
  void emptySampleRunsInAnActionTrialGrantThatRefusesEveryDataCall() throws Exception {
    when(actions.queryById(ACTION)).thenReturn(action(Action.STATUS_PUBLISHED));
    var runtimeJdbc = mock(JdbcTemplate.class);
    when(runtimeJdbc.queryForObject(contains("SELECT count(*)"), eq(Integer.class),
        anyString(), anyString(), eq(DOMAIN), anyLong())).thenReturn(1);
    var grants = new QueryGrantService(runtimeJdbc, "trial-key", mock(WorkbenchServiceAuthentication.class));
    ReflectionTestUtils.setField(grants, "contexts", sandboxes);
    when(sandboxes.requireActionTrial(SANDBOX, USER, DOMAIN))
        .thenAnswer(call -> ExecutionTarget.actionTrial(SANDBOX, List.of(), System.currentTimeMillis() + 60_000));
    var abc = new ABCProgramServiceImpl();
    var python = mock(PythonExecuteService.class);
    ReflectionTestUtils.setField(abc, "pythonExecuteService", python);
    when(programs.execute(anyString(), any(Function.class), eq(USER), eq(permission), eq(SANDBOX),
        eq("en"), eq(1), eq(DOMAIN), any())).thenAnswer(call -> abc.execute(call.getArgument(0), call.getArgument(1),
            USER, permission, SANDBOX, "en", 1, DOMAIN, call.getArgument(8)));
    when(python.execute(anyString(), eq(CODE), eq(1), eq("en"), any(), any(), eq(Map.of())))
        .thenAnswer(call -> {
          String run = call.getArgument(0);
          var authority = call.<PythonAuthority>getArgument(4);
          assertTrue(authority.target().testing());
          assertEquals(SANDBOX, authority.sandboxId());
          assertTrue(authority.classNames().isEmpty());
          var token = grants.issueExecution(authority, run, System.currentTimeMillis() + 60_000);
          for (String path : List.of("/ontology/query/execute-dsl", "/writeFunctionOperation/insert")) {
            var error = assertThrows(BuildTestException.class, () -> grants.verify(token, run, path));
            assertEquals(HttpStatus.FORBIDDEN, error.getStatusCode());
          }
          return new PythonExecuteResult();
        });

    var receipt = trial(null, null);

    assertEquals("PASSED", receipt.getString("status"));
    assertEquals("{\"completed\":true}", receipt.getString("result"));
    verify(sandboxes).open(eq(DOMAIN), eq(USER), anyString(), anyLong(), eq(List.of()));
    verify(sandboxes, never()).replaceClasses(any(), any(), any(), any());
    verify(sandboxes, never()).reset(any(), any());
    verify(sandboxes).close(SANDBOX, DOMAIN);
  }

  @Test
  void partialSampleGrantsStayScopedAndCannotStartLiveMetricExecution() {
    var runtimeJdbc = mock(JdbcTemplate.class);
    when(runtimeJdbc.queryForObject(contains("SELECT count(*)"), eq(Integer.class),
        anyString(), anyString(), eq(DOMAIN), anyLong())).thenReturn(1);
    var grants = new QueryGrantService(runtimeJdbc, "trial-key", mock(WorkbenchServiceAuthentication.class));
    ReflectionTestUtils.setField(grants, "contexts", sandboxes);
    long expires = System.currentTimeMillis() + 60_000;
    var target = ExecutionTarget.actionTrial(SANDBOX, List.of("Order"), expires);
    when(sandboxes.requireActionTrial(SANDBOX, USER, DOMAIN)).thenReturn(target);
    var authority = PythonAuthority.write(USER, DOMAIN, SANDBOX).withTarget(target);
    String token = grants.issueExecution(authority, "trial-run", expires);

    for (String path : List.of("/ontology/query/execute-dsl", "/writeFunctionOperation/insert")) {
      var claims = grants.verify(token, "trial-run", path);
      assertEquals(SANDBOX, claims.getString("contextId"));
      assertEquals(SANDBOX, claims.getString("sandboxId"));
      assertEquals(List.of("Order"), claims.getList("classNames", String.class));
    }
    var error = assertThrows(ResponseStatusException.class,
        () -> grants.verify(token, "trial-run", "/ontology/query/metrics/execute"));
    assertEquals(HttpStatus.FORBIDDEN, error.getStatusCode());
  }

  @Test
  void aMissingTargetKeyOrAnUnsatisfiedPreconditionRecordsFailure() throws Exception {
    Action action = action(Action.STATUS_PENDING_REVIEW, parameter("id", Parameter.TYPE_STRING, List.of("Order"), null));
    action.setTarget(new ActionTarget("Order", "id"));
    when(actions.queryById(ACTION)).thenReturn(action);
    assertTrue(trial(sample("Order"), null).getString("error").contains("explicit string value for id"));

    when(preconditions.evaluate(eq(action), eq(JSONObject.of("id", "123")), eq(CALLER), eq(permission),
        argThat(target -> target.actionTrial() && SANDBOX.equals(target.sandboxId()))))
        .thenReturn(new ActionPreconditionService.Verdict(false, List.of("order must be open")));
    assertEquals("Action.preconditionFailed: order must be open",
        trial(sample("Order"), JSONObject.of("id", "123")).getString("error"));

    verifyNoInteractions(programs);
    verify(sandboxes, times(2)).close(SANDBOX, DOMAIN);
  }

  @Test
  void sandboxProvisioningRefusalDoesNotRecordACodeFailure() {
    when(actions.queryById(ACTION)).thenReturn(action(Action.STATUS_PENDING_REVIEW));
    when(sandboxes.open(eq(DOMAIN), eq(USER), anyString(), anyLong(), eq(List.of())))
        .thenThrow(new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "BUILD_TEST_UNSUPPORTED"));
    var unsupported = assertThrows(OwnerRefusal.class, () -> trial(null, null));
    assertEquals("ACTION_TRIAL_SANDBOX_UNAVAILABLE", unsupported.code());
    assertTrue(unsupported.getMessage().contains("BUILD_TEST_UNSUPPORTED"));

    doThrow(new BuildTestException(HttpStatus.UNPROCESSABLE_ENTITY, "BUILD_TEST_SCHEMA_FAILED: permission denied for schema"))
        .when(sandboxes).reset(SANDBOX, DOMAIN);
    var denied = assertThrows(OwnerRefusal.class, () -> trial(sample("Order"), null));
    assertEquals("ACTION_TRIAL_SANDBOX_UNAVAILABLE", denied.code());
    assertTrue(denied.getMessage().contains("permission denied for schema"));

    verify(sandboxes).close(SANDBOX, DOMAIN);
    verifyNoInteractions(programs, jdbc);
  }

  @Test
  void rejectsForeignActionsDeniedCallersAndInvalidOrOutOfScopeInputBeforeOpening() {
    when(actions.queryById(ACTION)).thenReturn(action(Action.STATUS_PENDING_REVIEW));
    var foreign = action(Action.STATUS_PUBLISHED);
    foreign.setDomainId("another-domain");
    when(actions.queryById("foreign")).thenReturn(foreign);
    assertEquals("ACTION_NOT_FOUND", assertThrows(OwnerRefusal.class,
        () -> trials.trialSavedAction("foreign", null, null, "en", CALLER, permission, 1)).code());

    doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN, "Denied")).when(identity).requireActionExecutionAccess(USER, DOMAIN);
    assertEquals("ACTION_TRIAL_FORBIDDEN", assertThrows(OwnerRefusal.class, () -> trial(null, null)).code());
    doNothing().when(identity).requireActionExecutionAccess(USER, DOMAIN);

    when(sandboxes.validateSample(eq(JSONObject.of("objDatas", "bad")), eq(Map.of()), eq(DOMAIN)))
        .thenThrow(AgentHttpException.invalid("objDatas: expected an array"));
    assertEquals("ACTION_TRIAL_INVALID", assertThrows(OwnerRefusal.class,
        () -> trial(JSONObject.of("objDatas", "bad"), null)).code());
    assertEquals("ACTION_TRIAL_INVALID", assertThrows(OwnerRefusal.class,
        () -> trial(null, JSONObject.of("unknown", 1))).code());
    permission.setFullData(false);
    assertEquals("ACTION_TRIAL_FORBIDDEN", assertThrows(OwnerRefusal.class, () -> trial(sample("Order"), null)).code());

    verify(sandboxes, never()).open(any(), any(), any(), anyLong(), anyList());
    verifyNoInteractions(programs, jdbc);
  }

  @Test
  void displayBlockChecksExplanationThenLatestTrialAndSkipsPublishedActions() {
    Action action = action(Action.STATUS_PENDING_REVIEW);
    var failed = new ActionTrialStore.TrialSummary("failed", "FAILED", null, "bad", 12L, Instant.EPOCH);
    var passed = new ActionTrialStore.TrialSummary("passed", "PASSED", null, null, 12L, Instant.EPOCH);
    assertEquals("ACTION_EXPLANATION_REQUIRED", store.publishBlock(action, failed, "en").code());
    action.setCodeSegments(JSONArray.of(JSONObject.of("kind", "COMPUTE")));
    action.setCodeHash(CodeHashUtil.sha256(CODE));
    action.setExplanationVersion(Action.EXPLANATION_VERSION);
    assertEquals("ACTION_TRIAL_REQUIRED", store.publishBlock(action, null, "en").code());
    assertEquals("ACTION_TRIAL_FAILED", store.publishBlock(action, failed, "en").code());
    assertNull(store.publishBlock(action, passed, "en"));
    action.setStatus(Action.STATUS_PUBLISHED);
    assertNull(store.publishBlock(action, failed, "en"));
  }

  @Test
  void batchUsesOneSchemaReadAndOneLatestTrialQueryForSharedDigests() throws Exception {
    Action first = action(Action.STATUS_PENDING_REVIEW);
    Action second = action(Action.STATUS_PENDING_REVIEW);
    second.setId("other");
    var missingFunction = new Action();
    missingFunction.setId("missing");
    String digest = store.digest(DOMAIN, CODE, null, List.of());
    clearInvocations(schemas);
    doAnswer(call -> {
      String sql = call.getArgument(0);
      assertTrue(sql.contains("action_id=candidate.action_id OR action_id IS NULL"));
      assertTrue(sql.contains("ORDER BY created_at DESC, id DESC LIMIT 1"));
      var candidates = JSON.parseArray(call.<String>getArgument(2));
      assertEquals(List.of(
          JSONObject.of("action_id", ACTION, "digest", digest),
          JSONObject.of("action_id", "other", "digest", digest)), candidates);
      var rows = call.<RowCallbackHandler>getArgument(1);
      rows.processRow(trialRow(ACTION, "saved-trial", "FAILED"));
      rows.processRow(trialRow("other", "authoring-trial", "PASSED"));
      return null;
    }).when(jdbc).query(anyString(), any(RowCallbackHandler.class), anyString(), eq(DOMAIN));

    var results = store.latestByActions(DOMAIN, List.of(first, second, missingFunction));

    assertEquals("saved-trial", results.get(ACTION).id());
    assertEquals("failed", store.statusCode(results.get(ACTION)));
    assertEquals("authoring-trial", results.get("other").id());
    assertEquals("passed", store.statusCode(results.get("other")));
    assertNull(results.get("missing"));
    verify(schemas).query(DOMAIN);
    verify(jdbc).query(anyString(), any(RowCallbackHandler.class), anyString(), eq(DOMAIN));
  }

  @Test
  void authoringReceiptIsStoredWithoutASavedActionId() {
    var result = new PythonExecuteResult();
    result.setResult("{\"completed\":true}");
    result.setSpendTime(18L);
    store.recordAuthoringTrial(DOMAIN, "definition-digest", result, USER);

    verify(jdbc).update(contains("INSERT INTO action_trials"), anyString(), eq(DOMAIN), isNull(),
        eq("definition-digest"), eq("PASSED"), eq(result.getResult()), isNull(), eq(18L), eq(USER), any(OffsetDateTime.class));
  }

  @Test
  void actionTrialGrantsProvisionedSampleClassesEvenWhenWriteScopeIsEmpty() throws Exception {
    var python = mock(PythonExecuteService.class);
    var executed = new PythonExecuteResult();
    executed.setResult("{\"completed\":true}");
    when(python.execute(anyString(), eq(CODE), eq(1), eq("en"), any(PythonAuthority.class), any(), anyMap()))
        .thenReturn(executed);
    var abc = new io.ontomato.dataengine.service.impl.ABCProgramServiceImpl();
    org.springframework.test.util.ReflectionTestUtils.setField(abc, "pythonExecuteService", python);

    var function = action(Action.STATUS_PENDING_REVIEW, parameter("id", Parameter.TYPE_STRING, null, "t1")).getFunction();
    var withSample = ExecutionTarget.actionTrial(SANDBOX, List.of("Order", "Customer"), System.currentTimeMillis() + 60_000L);
    abc.execute("t-sample", function, USER, permission, SANDBOX, "en", 1, DOMAIN,
        new ABCProgramService.ExecutionContext(null, JSONObject.of(), withSample));
    verify(python).execute(eq("t-sample"), eq(CODE), eq(1), eq("en"),
        argThat(authority -> List.of("Order", "Customer").equals(authority.classNames())), any(), anyMap());

    var emptySample = ExecutionTarget.actionTrial(SANDBOX, List.of(), System.currentTimeMillis() + 60_000L);
    abc.execute("t-empty", function, USER, permission, SANDBOX, "en", 1, DOMAIN,
        new ABCProgramService.ExecutionContext(null, JSONObject.of(), emptySample));
    verify(python).execute(eq("t-empty"), eq(CODE), eq(1), eq("en"),
        argThat(authority -> authority.classNames().isEmpty()), any(), anyMap());
  }

  private static ResultSet trialRow(String actionId, String id, String status) throws Exception {
    var row = mock(ResultSet.class);
    when(row.getString("action_id")).thenReturn(actionId);
    when(row.getString("id")).thenReturn(id);
    when(row.getString("status")).thenReturn(status);
    when(row.getObject("created_at", OffsetDateTime.class)).thenReturn(OffsetDateTime.parse("2026-11-25T00:00:00Z"));
    return row;
  }

  private JSONObject trial(JSONObject sample, JSONObject parameters) throws Exception {
    return trials.trialSavedAction(ACTION, sample, parameters, "en", CALLER, permission, 1);
  }

  private static Action action(String status, Parameter... parameters) {
    var action = new Action();
    action.setId(ACTION);
    action.setDomainId(DOMAIN);
    action.setStatus(status);
    var function = new Function();
    function.setDomainId(DOMAIN);
    function.setOperation(Function.OPERATION_WRITE);
    function.setParameters(List.of(parameters));
    function.setCode(CODE);
    action.setFunction(function);
    return action;
  }

  private static Parameter parameter(String name, String type, List<String> classes, Object value) {
    var parameter = new Parameter();
    parameter.setName(name);
    parameter.setType(type);
    parameter.setClassNames(classes);
    parameter.setValue(value);
    return parameter;
  }

  private static JSONObject sample(String className) {
    return JSONObject.of("objDatas", List.of(JSONObject.of("className", className, "rows", List.of())),
        "relDatas", List.of(), "vectorDatas", List.of());
  }
}
