package io.ontomato.dataengine.controller;

import static io.ontomato.dataengine.service.authorization.CapabilityDefinitionTestSupport.subject;

import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.ActionAuthorization;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ControllerConst;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.security.CaseExecutionGuard;
import io.ontomato.dataengine.service.ActionService;
import io.ontomato.dataengine.service.ActionPreconditionService.DescriptionScopeDenied;
import io.ontomato.dataengine.service.DataSandboxService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.ExecutionTarget;
import io.ontomato.dataengine.service.FormFields;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.OwnerFieldRefusal;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.service.SubjectDirectory;
import io.ontomato.dataengine.bean.action.Action;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.ontomato.dataengine.service.agent.AgentExecutionScope;
import io.ontomato.dataengine.service.ActionTrialService;
import io.ontomato.dataengine.service.ActionTrialStore;
import io.ontomato.dataengine.service.ActionTrialStore.PublishBlock;
import io.ontomato.dataengine.service.ActionTrialStore.TrialSummary;
import java.time.Instant;
import java.util.Map;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.SpringBeanUtil;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.mockito.ArgumentCaptor;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** An Action save refused at a field keeps its field errors, and a draft's errors are a successful form read. */
class ActionPanelEndpointTest {
  private final ActionTrialService actionTrials = mock(ActionTrialService.class);
  private final ActionTrialStore actionTrialStore = mock(ActionTrialStore.class);
  private final ActionService actionService = mock(ActionService.class);
  private final LangService langService = mock(LangService.class);
  private final CaseExecutionGuard caseExecutionGuard = new CaseExecutionGuard("");
  private final ActionAuthorization authorization = mock(ActionAuthorization.class);
  private final BusinessConfigService businessConfigService = mock(BusinessConfigService.class);
  private final io.ontomato.dataengine.service.SandboxPermissionService sandboxPermissions =
      mock(io.ontomato.dataengine.service.SandboxPermissionService.class);
  private final IdentityService identityService = mock(IdentityService.class);
  private final AgentExecutionScope agentExecutionScope = mock(AgentExecutionScope.class);
  private final ActionController controller = new ActionController(agentExecutionScope);

  @Test
  void groupedScopedDescriptionsKeepAllowedButtonsAndSeparateOwnerRefusals() {
    var executor = subject("domain", "executor");
    var scope = new ExecutionTarget(null, null, List.of("Order"), Long.MAX_VALUE);
    var allowed = executionAction("allowed");
    var denied = executionAction("denied");
    var field = new io.ontomato.dataengine.bean.function.Parameter();
    field.setName("order_id");
    field.setType("TYPE_STRING");
    field.setDescription("Order key");
    field.setSample("Private sample");
    field.setValue("Private value");
    var function = new Function();
    function.setParameters(List.of(field));
    denied.setFunction(function);
    denied.setSubmissionCriteria(JSONObject.of("conditions", JSONArray.of(JSONObject.of("className", "Hidden"))));
    var hidden = executionAction("hidden");
    var precondition = executionAction("precondition");
    when(actionService.queryById("allowed")).thenReturn(allowed);
    when(actionService.queryById("denied")).thenReturn(denied);
    when(actionService.queryById("hidden")).thenReturn(hidden);
    when(actionService.queryById("precondition")).thenReturn(precondition);
    var grant = io.ontomato.dataengine.service.CapabilityGrantLookup.Admission.ALL;
    when(authorization.requireExecution(same(executor), any(), any(), same(scope))).thenReturn(grant);
    doThrow(new DescriptionScopeDenied())
        .when(actionService).requireExecutionForm(same(denied), any(), any(), anyString(), same(executor), same(grant), same(scope));
    doThrow(new ActionAuthorization.Denied("ACTION_TARGET_OUT_OF_SCOPE", "Outside action permission"))
        .when(actionService).requireExecutionForm(same(hidden), any(), any(), anyString(), same(executor), same(grant), same(scope));
    doThrow(new OwnerRefusal("ACTION_PRECONDITION_FAILED", "Order is closed"))
        .when(actionService).requireExecutionForm(same(precondition), any(), any(), anyString(), same(executor), same(grant), same(scope));

    var owner = controller.actionPanelExecutionDefinitions();
    var handler = (io.ontomato.dataengine.panelreads.WorkbenchPanelRead.CallerScopedHandler) owner.handler();
    var target = Map.of("className", "Order", "primaryKey", "O1");
    var results = (List<?>) handler.read(executor, Map.of("actions", List.of(
        Map.of("primaryKey", "allowed", "object", target), Map.of("primaryKey", "denied", "object", target),
        Map.of("primaryKey", "hidden", "object", target), Map.of("primaryKey", "precondition", "object", target))), scope);
    assertEquals("allowed", ((JSONObject) results.get(0)).getJSONObject("payload").getString("id"));
    var description = JSONObject.of("id", "denied", "name", "denied", "target", denied.getTarget(),
        "function", JSONObject.of("parameters", List.of(JSONObject.of("name", "order_id", "type", "TYPE_STRING", "description", "Order key"))));
    assertEquals(JSONObject.of("status", "forbidden", "code", "ACTION_TARGET_OUT_OF_SCOPE",
        "error", "超出本轮数据范围", "payload", description), results.get(1));
    assertEquals(JSONObject.of("status", "forbidden", "code", "ACTION_TARGET_OUT_OF_SCOPE",
        "error", "Outside action permission"), results.get(2));
    assertEquals(JSONObject.of("status", "error", "code", "ACTION_PRECONDITION_FAILED", "error", "Order is closed"), results.get(3));
    verify(actionService).requireExecutionForm(same(allowed), eq(JSONObject.of("order_id", "O1")),
        eq(List.of("order_id")), anyString(), same(executor), same(grant), same(scope));
  }

  private static Action executionAction(String id) {
    var action = new Action();
    action.setId(id);
    action.setName(id);
    action.setDomainId("domain");
    action.setStatus(Action.STATUS_PUBLISHED);
    action.setTarget(new io.ontomato.dataengine.bean.action.ActionTarget("Order", "order_id"));
    action.setDefinition(new JSONObject());
    return action;
  }

  @BeforeEach
  void setup() {
    User user = mock(User.class);
    when(user.getId()).thenReturn("user-1");
    when(user.getDomainId()).thenReturn("domain");
    when(identityService.getCurrentUser()).thenReturn(user);
    when(identityService.getCurrentUserDataPermission()).thenReturn(new UserDataPermission());
    BusinessConfig config = new BusinessConfig();
    config.setDslCookerTimeout(60000L);
    when(businessConfigService.get("domain")).thenReturn(config);
    when(agentExecutionScope.target(any(), any(), any(), any())).thenAnswer(call -> call.getArgument(3));
    GenericApplicationContext context = new GenericApplicationContext();
    context.registerBean(IdentityService.class, () -> identityService);
    context.refresh();
    new SpringBeanUtil().setApplicationContext(context);
    ReflectionTestUtils.setField(controller, "actionService", actionService);
    ReflectionTestUtils.setField(controller, "langService", langService);
    ReflectionTestUtils.setField(controller, "identityService", identityService);
    ReflectionTestUtils.setField(controller, "caseExecutionGuard", caseExecutionGuard);
    ReflectionTestUtils.setField(controller, "authorization", authorization);
    when(authorization.subject(user)).thenReturn(subject("domain", "user-1"));
    ReflectionTestUtils.setField(controller, "businessConfigService", businessConfigService);
    ReflectionTestUtils.setField(controller, "sandboxPermissions", sandboxPermissions);
    when(sandboxPermissions.read("domain")).thenReturn(JSONObject.of("status", "unchecked"));
    SubjectDirectory subjects = mock(SubjectDirectory.class);
    ReflectionTestUtils.setField(controller, "subjectDirectory", subjects);
    ReflectionTestUtils.setField(controller, "objectMapper", new ObjectMapper());
    ReflectionTestUtils.setField(controller, "actionTrials", actionTrials);
    ReflectionTestUtils.setField(controller, "actionTrialStore", actionTrialStore);
    when(actionTrialStore.statusCode(isNull())).thenReturn("notRun");
    when(langService.get(anyString(), anyString())).thenAnswer(call -> call.getArgument(1));
  }

  @Test
  void executeRefusesPreviewRequestsBeforeTheActionStarts() throws Exception {
    var mvc = MockMvcBuilders.standaloneSetup(controller)
        .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    var response = mvc.perform(post("/action/execute")
            .header("X-Ontomato-Execution-Context", "{\"kind\":\"preview\"}")
            .header(ControllerConst.LANG_HEADER_KEY, "en")
            .param("id", "a1").param("param", "{}"))
        .andExpect(status().isUnprocessableEntity()).andReturn().getResponse();
    var body = JSON.parseObject(response.getContentAsString());
    assertFalse(body.getBooleanValue("success"));
    assertEquals("PREVIEW_WRITE_FORBIDDEN", body.getString("code"));
    assertEquals("预览里不执行写操作，动作的对错用动作试跑验", body.getString("message"));
    verifyNoInteractions(actionService);
  }

  @Test
  void executeWithoutThePreviewHeaderKeepsTheOrdinaryPath() throws Exception {
    when(actionService.execute(eq("a1"), any(), eq("en"), any(), any(), anyInt(), any(), any(), any()))
        .thenReturn(new PythonExecuteResult());
    var mvc = MockMvcBuilders.standaloneSetup(controller)
        .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    var response = mvc.perform(post("/action/execute")
            .header(ControllerConst.LANG_HEADER_KEY, "en")
            .param("id", "a1").param("param", "{}"))
        .andReturn().getResponse();
    var body = JSON.parseObject(response.getContentAsString());
    assertTrue(body.getBooleanValue("success"));
    verify(actionService).execute(eq("a1"), any(), eq("en"), any(), any(), anyInt(), any(), any(), any());
  }

  @Test
  void countsThroughTheSameListUrlWithoutReadingTheList() throws Exception {
    when(actionService.count(eq("PUBLISHED"), isNull(), eq("Device"), eq("domain"), any())).thenReturn(3L);

    JSONObject body = perform("/action/queryList", """
        {"countOnly":true,"status":"PUBLISHED","className":"Device"}""");

    assertTrue(body.getBooleanValue("success"));
    assertEquals(3, body.getJSONObject("data").getIntValue("total"));
    verify(actionService).count(eq("PUBLISHED"), isNull(), eq("Device"), eq("domain"), any());
    verify(actionService, never()).queryList(any(), any(), any(), any());
  }

  @Test
  void publishedStatusInASaveRequestIsRefusedAtTheHttpBoundary() throws Exception {
    JSONObject body = perform("/action/save", """
        {"status":"PUBLISHED","submittedFields":["/name"],"name":"Approve"}""");

    assertEquals("ACTION_STATUS_INVALID", body.getString("code"));
    assertEquals("/status", body.getJSONArray("errors").getJSONObject(0).getString("field"));
    verifyNoInteractions(actionService);
  }

  @Test
  void aSaveNamingItsSubmittedFieldsChangesOnlyThoseAndKeepsTheRestOfTheAction() throws Exception {
    Function function = new Function();
    function.setId("f1");
    function.setName("Write order");
    function.setOperation(Function.OPERATION_WRITE);
    function.setParameters(List.of());
    function.setCode("# ontomato-python:2\nprint(1)");
    function.setLogic("Approves the order");
    function.setDomainId("domain");
    Action stored = new Action();
    stored.setId("a1");
    stored.setName("Approve order");
    stored.setDescription("Approve a pending order");
    stored.setOrigin(Action.ORIGIN_USER);
    stored.setStatus(Action.STATUS_PUBLISHED);
    stored.setDomainId("domain");
    stored.setSubmissionCriteria(JSONObject.parseObject("""
        {"conditions":[{"objectParameter":"order_id","className":"Order","field":"status","operator":"=","value":"open"}]}"""));
    stored.setCreateTimestamp(1_700_000_000_000L);
    stored.setFunction(function);
    when(actionService.queryById("a1")).thenReturn(stored);
    ArgumentCaptor<Action> saved = ArgumentCaptor.forClass(Action.class);
    when(actionService.save(saved.capture(), isNull(), any(), eq("en"))).thenAnswer(call -> call.getArgument(0));

    // An agent's save sends only the field it wrote.
    JSONObject body = perform("/action/save", """
        {"id":"a1","name":"Approve open order","submittedFields":["/name"]}""");

    assertTrue(body.getBooleanValue("success"), body.toJSONString());
    Action action = saved.getValue();
    assertEquals("Approve open order", action.getName());
    assertEquals("Approve a pending order", action.getDescription());
    assertEquals(Action.ORIGIN_USER, action.getOrigin());
    assertNull(action.getStatus());
    assertEquals("open", action.getSubmissionCriteria().getJSONArray("conditions").getJSONObject(0).getString("value"));
    assertEquals(1_700_000_000_000L, action.getCreateTimestamp());
    assertEquals("f1", action.getFunction().getId());
    assertEquals("# ontomato-python:2\nprint(1)", action.getFunction().getCode());
  }

  @Test
  void aSaveRefusedAtAFieldCarriesTheFieldError() throws Exception {
    String message = "Action.publishedIsFrozen";
    when(actionService.save(any(), isNull(), any(), eq("en"))).thenThrow(new OwnerFieldRefusal(
        "ACTION_PUBLISHED_FROZEN", "/function/code", "invalid_object", message));

    JSONObject body = perform("/action/save", """
        {"name":"Approve order","function":{"name":"Write order","operation":"OPERATION_WRITE","parameters":[],"returnDef":{"isVoid":true,"classNames":[]},"code":"# ontomato-python:2\\nprint(1)","logic":""}}""");

    assertFalse(body.getBooleanValue("success"));
    assertEquals("ACTION_PUBLISHED_FROZEN", body.getString("code"));
    assertEquals(message, body.getString("message"));
    JSONArray errors = body.getJSONArray("errors");
    assertEquals(1, errors.size());
    assertEquals("/function/code", errors.getJSONObject(0).getString("field"));
    assertEquals("invalid_object", errors.getJSONObject(0).getString("code"));
    assertEquals(message, errors.getJSONObject(0).getString("message"));
  }

  @Test
  void aDraftsFieldErrorsAreASuccessfulFormRead() throws Exception {
    when(actionService.definitionForm(any(), eq("en"), any(SubjectContext.class))).thenReturn(JSONObject.of(
        "fields", new JSONArray(), "values", JSONObject.of("name", ""),
        "errors", List.of(FormFields.error("/function/operation", "invalid_option", "expected OPERATION_WRITE")),
        "save", JSONObject.of("path", "/action/save")));

    JSONObject body = perform("/action/definitionForm", """
        {"target":{"kind":"draft"},"values":{"name":""},"changedField":null}""");

    assertFalse(body.getJSONObject("data").containsKey("sandboxCapability"));
    verifyNoInteractions(sandboxPermissions);
    assertTrue(body.getBooleanValue("success"));
    JSONArray errors = body.getJSONObject("data").getJSONArray("errors");
    assertEquals(1, errors.size());
    assertEquals("/function/operation", errors.getJSONObject(0).getString("field"));
    assertEquals("invalid_option", errors.getJSONObject(0).getString("code"));
    assertEquals("expected OPERATION_WRITE", errors.getJSONObject(0).getString("message"));
  }

  @Test
  void sandboxCapabilityHasItsOwnReadEndpoint() throws Exception {
    var mvc = MockMvcBuilders.standaloneSetup(controller)
        .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    var response = mvc.perform(get("/action/sandboxCapability"))
        .andExpect(status().isOk()).andReturn().getResponse();
    var body = JSON.parseObject(response.getContentAsString());
    assertTrue(body.getBooleanValue("success"));
    assertEquals("unchecked", body.getJSONObject("data").getString("status"));
    verify(sandboxPermissions).read("domain");
    verifyNoMoreInteractions(sandboxPermissions);
  }

  @Test
  void aReadActionNamesEachExplainedSegmentAndDerivedEffectByItsKind() throws Exception {
    Action action = new Action();
    action.setId("a1");
    action.setName("Approve");
    action.setDomainId("domain");
    action.setCodeSegments(JSONArray.parseArray("""
        [{"kind":"TRY_CATCH","trySegs":[{"kind":"UPDATE_OBJECT"}],
          "catchs":[{"error":"any","segs":[{"kind":"ERROR_HANDLING"}]}]},
         {"kind":"BRANCH","branchArms":[{"condition":"open","segs":[{"kind":"LOOP","segs":[{"kind":"QUERY"}]}]}]}]"""));
    action.setDefinition(JSONObject.parseObject("""
        {"effects":[{"kind":"UPDATE_OBJECT","className":"Order"}]}"""));
    when(actionService.queryById("a1")).thenReturn(action);

    JSONObject data = perform("/action/queryById", """
        {"id":"a1"}""").getJSONObject("data");

    JSONArray segments = data.getJSONArray("codeSegments");
    assertEquals("ActionSegment.kind.TRY_CATCH", segments.getJSONObject(0).getString("kindLabel"));
    assertEquals("ActionSegment.kind.UPDATE_OBJECT",
        segments.getJSONObject(0).getJSONArray("trySegs").getJSONObject(0).getString("kindLabel"));
    assertEquals("ActionSegment.kind.ERROR_HANDLING", segments.getJSONObject(0).getJSONArray("catchs").getJSONObject(0)
        .getJSONArray("segs").getJSONObject(0).getString("kindLabel"));
    JSONObject loop = segments.getJSONObject(1).getJSONArray("branchArms").getJSONObject(0).getJSONArray("segs").getJSONObject(0);
    assertEquals("ActionSegment.kind.LOOP", loop.getString("kindLabel"));
    assertEquals("ActionSegment.kind.QUERY", loop.getJSONArray("segs").getJSONObject(0).getString("kindLabel"));
    assertEquals("ActionSegment.kind.UPDATE_OBJECT",
        data.getJSONObject("definition").getJSONArray("effects").getJSONObject(0).getString("kindLabel"));
  }

  @Test
  void anUngrantedExecuteReturnsARefusalCode() throws Exception {
    when(actionService.execute(eq("a1"), any(JSONObject.class), eq("en"), any(), any(), anyInt(), any(), any(), any()))
        .thenThrow(new OwnerRefusal("ACTION_NOT_GRANTED", "No role grants this action"));

    JSONObject body = performExecute("a1", "{}");

    assertFalse(body.getBooleanValue("success"));
    assertEquals("ACTION_NOT_GRANTED", body.getString("code"));
    assertEquals("No role grants this action", body.getString("message"));
  }

  @Test
  void aPythonExecutionErrorStaysAnUncodedFailure() throws Exception {
    PythonExecuteResult result = new PythonExecuteResult();
    result.setError("program failed");
    when(actionService.execute(eq("a1"), any(JSONObject.class), eq("en"), any(), any(), anyInt(), any(), any(), any()))
        .thenReturn(result);

    JSONObject body = performExecute("a1", "{}");

    assertFalse(body.getBooleanValue("success"));
    assertFalse(body.containsKey("code"));
    assertEquals("program failed", body.getString("message"));
  }

  @Test
  void passesTheSignedInTokenToTheRuntimeOutsideBusinessParameters() throws Exception {
    PythonExecuteResult result = new PythonExecuteResult();
    result.setResult("{}");
    when(actionService.execute(eq("a1"), any(JSONObject.class), eq("en"), any(), any(), anyInt(), any(), any(),
        eq("caller-token"))).thenReturn(result);

    JSONObject body = performExecute("a1", "{}", "caller-token");

    assertTrue(body.getBooleanValue("success"));
    ArgumentCaptor<JSONObject> parameters = ArgumentCaptor.forClass(JSONObject.class);
    verify(actionService).execute(eq("a1"), parameters.capture(), eq("en"), any(), any(), anyInt(), any(), any(),
        eq("caller-token"));
    assertFalse(parameters.getValue().containsKey("callerToken"));
  }

  @Test
  void anUngrantedFormReturnsARefusalCode() throws Exception {
    when(actionService.form(any(), any(), any(), any(), eq("en"), any(), any(), any()))
        .thenThrow(new OwnerRefusal("ACTION_NOT_GRANTED", "No role grants this action"));

    JSONObject body = perform("/action/form", """
        {"id":"a1"}""");

    assertFalse(body.getBooleanValue("success"));
    assertEquals("ACTION_NOT_GRANTED", body.getString("code"));
    assertEquals("No role grants this action", body.getString("message"));
  }

  @Test
  void trialEndpointReturnsTheReceiptAndPreservesOwnerRefusals() throws Exception {
    var receipt = JSONObject.of("trialId", "t1", "actionId", "a1", "digest", "digest",
        "status", "FAILED", "passed", false, "result", null, "error", "invalid order", "spendTime", 32,
        "testedAt", Instant.EPOCH.toString(), "trialStatus", "failed", "trialStatusLabel", "Trial failed");
    when(actionTrials.trialSavedAction(eq("a1"), eq(JSONObject.of("objDatas", List.of(), "relDatas", List.of())),
        eq(JSONObject.of("orderId", "123")), eq("en"), any(), any(), eq(1), any()))
        .thenReturn(receipt).thenThrow(new OwnerRefusal("ACTION_TRIAL_FORBIDDEN", "Action execution permission is required"));
    String request = """
        {"id":"a1","sample":{"objDatas":[],"relDatas":[]},"parameters":{"orderId":"123"}}""";

    var response = perform("/action/trial", request);
    assertTrue(response.getBooleanValue("success"));
    assertEquals(receipt, response.getJSONObject("data"));
    var refused = perform("/action/trial", request);
    assertFalse(refused.getBooleanValue("success"));
    assertEquals("ACTION_TRIAL_FORBIDDEN", refused.getString("code"));
  }

  @Test
  void trialEndpointPassesTheSignedInTokenToTheTrialRuntime() throws Exception {
    var receipt = JSONObject.of("trialId", "t1", "actionId", "a1", "digest", "digest",
        "status", "PASSED", "passed", true, "result", "{}", "error", null, "spendTime", 1,
        "testedAt", Instant.EPOCH.toString(), "trialStatus", "passed", "trialStatusLabel", "Trial passed");
    when(actionTrials.trialSavedAction(eq("a1"), any(), any(), eq("en"), any(), any(), eq(1),
        eq("trial-caller-token"))).thenReturn(receipt);

    JSONObject body = perform("/action/trial", """
        {"id":"a1","sample":{"objDatas":[],"relDatas":[],"vectorDatas":[]}}""",
        "trial-caller-token");

    assertTrue(body.getBooleanValue("success"));
    verify(actionTrials).trialSavedAction(eq("a1"), any(), any(), eq("en"), any(), any(), eq(1),
        eq("trial-caller-token"));
  }

  @Test
  void trialEndpointRejectsMalformedRequestFieldsBeforeExecution() throws Exception {
    for (String body : List.of("{\"id\":7}", "{\"id\":\" \"}", "{\"id\":\"a1\",\"sample\":[]}",
        "{\"id\":\"a1\",\"parameters\":\"{}\"}")) {
      assertEquals("ACTION_TRIAL_INVALID", perform("/action/trial", body).getString("code"));
    }
    verifyNoInteractions(actionTrials);
  }

  @Test
  void actionDetailAndListIncludeTrialAndPublicationFields() throws Exception {
    Action failed = new Action();
    failed.setId("a1");
    failed.setDomainId("domain");
    Action untested = new Action();
    untested.setId("a2");
    untested.setDomainId("domain");
    var trial = new TrialSummary("t1", "FAILED", null, "invalid order", 32L, Instant.EPOCH);
    when(actionService.queryById("a1")).thenReturn(failed);
    when(actionService.listVisibleDefinitions(any(SubjectContext.class), isNull(), isNull()))
        .thenReturn(List.of(failed, untested));
    when(actionTrialStore.latest(failed)).thenReturn(trial);
    when(actionTrialStore.latestByActions("domain", List.of(failed, untested))).thenReturn(Map.of("a1", trial));
    when(actionTrialStore.statusCode(trial)).thenReturn("failed");
    when(actionTrialStore.publishBlock(failed, trial, "en")).thenReturn(new PublishBlock("ACTION_TRIAL_FAILED", "Try again"));

    var detail = perform("/action/queryById", """
        {"id":"a1","purpose":"publication-review"}""").getJSONObject("data");
    assertTrialDisplay(detail);
    assertEquals(detail.getString("trialStatusLabel"), detail.getString("sandboxTrialLabel"));
    assertEquals("Action.explanationMissing", detail.getString("explanationMissingLabel"));

    var list = perform("/action/queryList", "{}").getJSONArray("data");
    assertTrialDisplay(list.getJSONObject(0));
    var noTrial = list.getJSONObject(1);
    assertEquals("notRun", noTrial.getString("trialStatus"));
    assertNull(noTrial.getString("lastTrialAt"));
    assertNull(noTrial.getString("lastTrialError"));
    verify(actionTrialStore).latest(failed);
    verify(actionTrialStore, never()).latest(untested);
    verify(actionTrialStore).latestByActions("domain", List.of(failed, untested));
  }

  private void assertTrialDisplay(JSONObject item) {
    assertEquals("failed", item.getString("trialStatus"));
    assertEquals("Action.sandboxTrial.failed", item.getString("trialStatusLabel"));
    assertEquals(Instant.EPOCH.toString(), item.getString("lastTrialAt"));
    assertEquals("invalid order", item.getString("lastTrialError"));
    assertEquals("ACTION_TRIAL_FAILED", item.getString("publishBlockedCode"));
    assertEquals("Try again", item.getString("publishBlockedReason"));
  }

  private JSONObject performExecute(String id, String param) throws Exception {
    return performExecute(id, param, null);
  }

  private JSONObject performExecute(String id, String param, String token) throws Exception {
    var mvc = MockMvcBuilders.standaloneSetup(controller)
        .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    var request = post("/action/execute")
            .header("Accept-Language", "en")
            .param("id", id)
            .param("param", param);
    if (token != null) request.header("tk", token);
    var response = mvc.perform(request)
        .andExpect(status().isOk()).andReturn().getResponse();
    return JSON.parseObject(response.getContentAsString());
  }

  private JSONObject perform(String path, String body) throws Exception {
    return perform(path, body, null);
  }

  private JSONObject perform(String path, String body, String token) throws Exception {
    var mvc = MockMvcBuilders.standaloneSetup(controller)
        .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    var request = post(path)
            .header("Accept-Language", "en")
            .contentType(MediaType.APPLICATION_JSON)
            .content(body);
    if (token != null) request.header("tk", token);
    var response = mvc.perform(request)
        .andExpect(status().isOk()).andReturn().getResponse();
    return JSON.parseObject(response.getContentAsString());
  }
}
