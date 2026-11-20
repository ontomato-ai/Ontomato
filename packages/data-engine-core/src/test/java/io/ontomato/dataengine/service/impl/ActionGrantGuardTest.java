package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.service.ABCProgramService;
import io.ontomato.dataengine.service.ActionPreconditionService;
import io.ontomato.dataengine.service.CapabilityGrantLookup;
import io.ontomato.dataengine.service.IdentitySnapshotLookup;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.service.impl.WorkflowRunResolver;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * The grant is the single answer to "who may run this action", so these cases state what a caller
 * must not be able to do: run a published action no role grants, reach the program or the
 * preconditions while unauthorized, or smuggle an unauthorized run through a draft action.
 *
 * <p>The refusal is checked to be the grant's own message rather than a generic failure: mistaking an
 * unreadable precondition or a failed program for "not granted" hides a real authorization bug, and
 * mistaking "not granted" for a precondition message sends the operator looking at the wrong layer.</p>
 */
class ActionGrantGuardTest {

  private static final String DOMAIN = "domain-1";
  private static final String ACTION_ID = "act_ship";
  private static final String FUNCTION_ID = "fun_ship";
  private static final String USER_ID = "user-1";
  private static final String LANG = "zh-CN";

  private ActionServiceImpl service;
  private ActionDao actionDao;
  private FunctionDao functionDao;
  private ABCProgramService programs;
  private ActionPreconditionService preconditions;
  private CapabilityGrantLookup grants;
  private IdentitySnapshotLookup identitySnapshots;
  private WorkflowRunResolver workflowRuns;
  private LangService lang;
  private UserDataPermission permission;
  private User alice;

  @BeforeEach
  void setUp() {
    service = new ActionServiceImpl();
    actionDao = mock(ActionDao.class);
    functionDao = mock(FunctionDao.class);
    programs = mock(ABCProgramService.class);
    preconditions = mock(ActionPreconditionService.class);
    grants = mock(CapabilityGrantLookup.class);
    identitySnapshots = mock(IdentitySnapshotLookup.class);
    workflowRuns = mock(WorkflowRunResolver.class);
    lang = mock(LangService.class);

    ReflectionTestUtils.setField(service, "actionDao", actionDao);
    ReflectionTestUtils.setField(service, "functionDao", functionDao);
    ReflectionTestUtils.setField(service, "abcProgramService", programs);
    ReflectionTestUtils.setField(service, "preconditions", preconditions);
    ReflectionTestUtils.setField(service, "capabilityGrants", grants);
    ReflectionTestUtils.setField(service, "identitySnapshots", identitySnapshots);
    ReflectionTestUtils.setField(service, "workflowRuns", workflowRuns);
    ReflectionTestUtils.setField(service, "langService", lang);

    when(lang.get(anyString(), eq("Action.targetOutsideScope"))).thenReturn("Target is outside scope");
    when(lang.get(anyString(), eq("Action.notGranted"))).thenReturn("No role grants this action");
    when(lang.get(anyString(), eq("Action.preconditionFailed"))).thenReturn("Preconditions are not met");
    when(identitySnapshots.snapshot(any(), any())).thenReturn(new JSONObject());

    permission = new UserDataPermission();
    permission.setFullData(true);

    alice = mock(User.class);
    when(alice.getId()).thenReturn(USER_ID);
    when(alice.getDomainId()).thenReturn(DOMAIN);
  }

  // ---------- fixtures ----------

  /** Registers a published action in this domain, reachable through {@code queryById}. */
  private Action publishedAction() {
    Function function = new Function();
    function.setId(FUNCTION_ID);
    function.setName("Ship order");
    function.setDomainId(DOMAIN);
    function.setOperation(Function.OPERATION_WRITE);
    Parameter orderId = new Parameter();
    orderId.setName("order_id");
    orderId.setType(Parameter.TYPE_STRING);
    function.setParameters(List.of(orderId));

    Action action = new Action();
    action.setId(ACTION_ID);
    action.setName("Ship order");
    action.setOrigin(Action.ORIGIN_USER);
    action.setStatus(Action.STATUS_PUBLISHED);
    action.setDomainId(DOMAIN);
    action.setFunction(function);
    when(actionDao.queryById(ACTION_ID)).thenReturn(new Object[] { action, FUNCTION_ID });
    when(functionDao.queryById(FUNCTION_ID)).thenReturn(function);
    return action;
  }

  private void grantAnswer(boolean allowed) {
    when(grants.admission(USER_ID, DOMAIN, CapabilityGrantLookup.ACTION, ACTION_ID)).thenReturn(allowed ? CapabilityGrantLookup.Admission.ALL : CapabilityGrantLookup.Admission.DENIED);
  }

  private JSONObject params() {
    return JSONObject.of("order_id", "O-1");
  }

  // ---------- the guard itself ----------

  @Test
  void anUngrantedRoleIsRefusedWithTheGrantsOwnMessage() {
    publishedAction();
    grantAnswer(false);

    OwnerRefusal error = assertThrows(OwnerRefusal.class,
        () -> service.execute(ACTION_ID, params(), LANG, alice, permission, 5));

    assertEquals("ACTION_NOT_GRANTED", error.code());
    assertEquals("No role grants this action", error.getMessage());
  }

  @Test
  void anUngrantedRunNeverReachesTheProgramOrThePreconditions() {
    publishedAction();
    grantAnswer(false);

    assertThrows(OwnerRefusal.class, () -> service.execute(ACTION_ID, params(), LANG, alice, permission, 5));

    // Either one running first would mean the program could already have written, or a subject
    // learned something about an object they were never allowed to execute against.
    verify(preconditions, never()).evaluate(any(), any(), any(), any(), any());
    verifyNoInteractions(programs);
  }

  @Test
  void theGrantIsAskedWithTheAuthenticatedSubjectNotTheParameters() throws Exception {
    publishedAction();
    grantAnswer(true);
    // The extra user_id is not an admitted parameter and cannot select the authorization subject.
    assertThrows(IllegalArgumentException.class, () -> service.execute(ACTION_ID,
        JSONObject.of("order_id", "O-1", "user_id", "someone-else"), LANG, alice, permission, 5));
    verifyNoInteractions(preconditions, programs);
    verify(grants).admission(USER_ID, DOMAIN, CapabilityGrantLookup.ACTION, ACTION_ID);
  }

  @Test
  void aGrantedRunProceedsPastTheGuardToThePreconditions() throws Exception {
    publishedAction();
    grantAnswer(true);
    when(preconditions.evaluate(any(), any(), any(), any(), any()))
        .thenReturn(new ActionPreconditionService.Verdict(false, List.of("still open")));

    OwnerRefusal error = assertThrows(OwnerRefusal.class,
        () -> service.execute(ACTION_ID, params(), LANG, alice, permission, 5));

    // Proving the refusal below is about the precondition, not about a grant that never resolved:
    // without this case a guard that always says no would pass every test above.
    assertEquals("ACTION_PRECONDITION_FAILED", error.code());
    assertEquals("Preconditions are not met: still open", error.getMessage());
    verify(preconditions).evaluate(any(), any(), any(), any(), any());
    verifyNoInteractions(programs);
  }

  // ---------- what the guard must not swallow ----------

  @Test
  void aDraftIsRefusedForNotBeingPublishedRatherThanForLackingAGrant() throws Exception {
    Action action = publishedAction();
    action.setStatus(Action.STATUS_PENDING_REVIEW);
    grantAnswer(true);
    when(lang.get(anyString(), eq("Action.notPublished"))).thenReturn("Action not published");

    OwnerRefusal thrown =
        assertThrows(OwnerRefusal.class,
            () -> service.execute(ACTION_ID, params(), LANG, alice, permission, 5));

    // A draft is not an authorization question; asking the grant here would report the wrong layer.
    assertEquals("ACTION_NOT_EXECUTABLE", thrown.code());
    assertEquals("Action not published", thrown.getMessage());
    verify(grants, never()).admission(anyString(), anyString(), anyString(), anyString());
  }

  @Test
  void anActionFromAnotherDomainIsRejectedBeforeAnyGrantCheck() throws Exception {
    Action action = publishedAction();
    action.setDomainId("domain-2");
    grantAnswer(true);

    OwnerRefusal thrown =
        assertThrows(OwnerRefusal.class,
            () -> service.execute(ACTION_ID, params(), LANG, alice, permission, 5));

    assertEquals("ACTION_NOT_FOUND", thrown.code());
    assertTrue(thrown.getMessage().contains("outside the current domain"), thrown.getMessage());
    verify(grants, never()).admission(anyString(), anyString(), anyString(), anyString());
  }

  @Test
  void anUnknownActionReportsNotFoundRatherThanNotGranted() throws Exception {
    when(actionDao.queryById(ACTION_ID)).thenReturn(null);
    when(lang.get(anyString(), eq("Action.notFound"))).thenReturn("Action not found");

    OwnerRefusal thrown =
        assertThrows(OwnerRefusal.class,
            () -> service.execute(ACTION_ID, params(), LANG, alice, permission, 5));

    assertEquals("ACTION_NOT_FOUND", thrown.code());
    assertEquals("Action not found", thrown.getMessage());
    verify(grants, never()).admission(anyString(), anyString(), anyString(), anyString());
  }

  @Test
  void aGrantedAndPermittedRunReachesTheProgram() throws Exception {
    Action action = publishedAction();
    action.setCodeSegments(com.alibaba.fastjson2.JSONArray.of(JSONObject.of("kind", "UPDATE_OBJECT", "class", "Order")));
    grantAnswer(true);
    when(preconditions.evaluate(any(), any(), any(), any(), any()))
        .thenReturn(new ActionPreconditionService.Verdict(true, List.of()));
    Object[] programResult = new Object[] { JSONObject.of("shipped", true), new PythonExecuteResult() };
    when(programs.execute(any(), any(Function.class), eq(USER_ID), eq(permission),
        eq(io.ontomato.dataengine.config.ServiceConst.NOT_SANDBOX), eq(LANG), anyInt(), eq(DOMAIN), any()))
        .thenReturn(programResult);

    PythonExecuteResult result = service.execute(ACTION_ID, params(), LANG, alice, permission, 5);

    // The positive path is what makes the refusals above meaningful: the same wiring, one grant away.
    assertNull(result.getError());
    assertEquals(List.of("Order"), result.getAffects());
    assertTrue(result.getResult().contains("shipped"), result.getResult());
    verify(programs).execute(any(), any(Function.class), eq(USER_ID), eq(permission),
        eq(io.ontomato.dataengine.config.ServiceConst.NOT_SANDBOX), eq(LANG), anyInt(), eq(DOMAIN), any());
  }

  @Test
  void aProgramWrittenJsonResultIsNotReplacedWithCompletedTrue() throws Exception {
    Action action = publishedAction();
    action.setCodeSegments(com.alibaba.fastjson2.JSONArray.of(JSONObject.of("kind", "UPDATE_OBJECT", "class", "Order")));
    grantAnswer(true);
    when(preconditions.evaluate(any(), any(), any(), any(), any()))
        .thenReturn(new ActionPreconditionService.Verdict(true, List.of()));
    PythonExecuteResult program = new PythonExecuteResult();
    program.setResult("{\"targetClass\":\"tech_gwdj_apply\",\"run_id\":\"tga-1\"}");
    when(programs.execute(any(), any(Function.class), eq(USER_ID), eq(permission),
        eq(io.ontomato.dataengine.config.ServiceConst.NOT_SANDBOX), eq(LANG), anyInt(), eq(DOMAIN), any()))
        .thenReturn(new Object[] { null, program });

    PythonExecuteResult result = service.execute(ACTION_ID, params(), LANG, alice, permission, 5);

    assertEquals("{\"targetClass\":\"tech_gwdj_apply\",\"run_id\":\"tga-1\"}", result.getResult());
  }

  @Test
  void theRefusalIsReportedBeforeThePreconditionMessageCanMaskIt() throws Exception {
    publishedAction();
    grantAnswer(false);
    // A precondition that would also fail: the grant answer is the one the operator must see first.
    when(preconditions.evaluate(any(), any(), any(), any(), any()))
        .thenReturn(new ActionPreconditionService.Verdict(false, List.of("would fail too")));

    OwnerRefusal error = assertThrows(OwnerRefusal.class,
        () -> service.execute(ACTION_ID, params(), LANG, alice, permission, 5));

    assertEquals("ACTION_NOT_GRANTED", error.code());
    assertEquals("No role grants this action", error.getMessage());
  }

  @Test
  void formRefusesAnUnpublishedActionAsNotExecutable() {
    Action action = publishedAction();
    action.setStatus(Action.STATUS_PENDING_REVIEW);
    when(lang.get(anyString(), eq("Action.notPublished"))).thenReturn("Action not published");

    OwnerRefusal error = assertThrows(OwnerRefusal.class,
        () -> service.form(ACTION_ID, new JSONObject(), null, List.of(), LANG, alice));

    assertEquals("ACTION_NOT_EXECUTABLE", error.code());
    assertEquals("Action not published", error.getMessage());
  }

  @Test
  void formRefusesAnotherDomainAsNotFound() {
    Action action = publishedAction();
    action.setDomainId("domain-2");

    OwnerRefusal error = assertThrows(OwnerRefusal.class,
        () -> service.form(ACTION_ID, new JSONObject(), null, List.of(), LANG, alice));

    assertEquals("ACTION_NOT_FOUND", error.code());
    assertTrue(error.getMessage().contains("outside the current domain"), error.getMessage());
  }

  @Test
  void formRefusesAnUngrantedActionAsNotGranted() {
    publishedAction();
    grantAnswer(false);

    OwnerRefusal error = assertThrows(OwnerRefusal.class,
        () -> service.form(ACTION_ID, new JSONObject(), null, List.of(), LANG, alice));

    assertEquals("ACTION_NOT_GRANTED", error.code());
    assertEquals("No role grants this action", error.getMessage());
  }

  @Test
  void scheduledRunsReturnTheRefusalMessageForTheGrantsThreeRefusals() throws Exception {
    Action action = publishedAction();
    grantAnswer(false);
    PythonExecuteResult unauth = service.executeScheduled(action, params(), LANG, alice, permission, 5, UUID.randomUUID());
    assertEquals("No role grants this action", unauth.getError());

    grantAnswer(true);
    when(preconditions.evaluate(any(), any(), any(), any(), any()))
        .thenReturn(new ActionPreconditionService.Verdict(false, List.of("still open")));
    PythonExecuteResult precondition = service.executeScheduled(action, params(), LANG, alice, permission, 5, UUID.randomUUID());
    assertEquals("Preconditions are not met: still open", precondition.getError());

    action.setTarget(new io.ontomato.dataengine.bean.action.ActionTarget("Order", "order_id"));
    var queries = mock(io.ontomato.dataengine.service.OntologyQueryService.class);
    ReflectionTestUtils.setField(service, "queries", queries);
    when(queries.actionTargetExists(any(), anyString(), any(), any())).thenReturn(false);
    PythonExecuteResult target = service.executeScheduled(action, params(), LANG, alice, permission, 5, UUID.randomUUID());
    assertEquals("Target is outside scope", target.getError());
  }

  @Test
  void scheduledRunsStillThrowForAnUnpublishedActionOrAnotherDomain() throws Exception {
    Action draft = publishedAction();
    draft.setStatus(Action.STATUS_PENDING_REVIEW);
    when(lang.get(anyString(), eq("Action.notPublished"))).thenReturn("Action not published");
    OwnerRefusal notPublished = assertThrows(OwnerRefusal.class,
        () -> service.executeScheduled(draft, params(), LANG, alice, permission, 5, UUID.randomUUID()));
    assertEquals("ACTION_NOT_EXECUTABLE", notPublished.code());

    Action foreign = publishedAction();
    foreign.setDomainId("domain-2");
    OwnerRefusal notFound = assertThrows(OwnerRefusal.class,
        () -> service.executeScheduled(foreign, params(), LANG, alice, permission, 5, UUID.randomUUID()));
    assertEquals("ACTION_NOT_FOUND", notFound.code());
  }

  @Test
  void evenAnUnrestrictedGrantRequiresAReadableDeclaredTargetBeforeStateOrProgram() throws Exception {
    var action = publishedAction();
    action.setTarget(new io.ontomato.dataengine.bean.action.ActionTarget("Order", "order_id"));
    var queries = mock(io.ontomato.dataengine.service.OntologyQueryService.class);
    ReflectionTestUtils.setField(service, "queries", queries);
    grantAnswer(true);
    OwnerRefusal error = assertThrows(OwnerRefusal.class,
        () -> service.execute(ACTION_ID, JSONObject.of("order_id", "00123"), LANG, alice, permission, 5));
    assertEquals("ACTION_TARGET_OUT_OF_SCOPE", error.code());
    assertEquals("Target is outside scope", error.getMessage());
    verify(queries).actionTargetExists(eq(action.getTarget()), eq("00123"), eq(CapabilityGrantLookup.Admission.ALL), any());
    org.mockito.Mockito.verifyNoInteractions(preconditions, programs);
  }
}
