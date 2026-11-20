package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.security.CaseExecutionGuard;
import io.ontomato.dataengine.service.ActionService;
import io.ontomato.dataengine.service.BuildTestContextService;
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
  private final ActionService actionService = mock(ActionService.class);
  private final LangService langService = mock(LangService.class);
  private final CaseExecutionGuard caseExecutionGuard = mock(CaseExecutionGuard.class);
  private final BusinessConfigService businessConfigService = mock(BusinessConfigService.class);
  private final BuildTestContextService buildTests = mock(BuildTestContextService.class);
  private final IdentityService identityService = mock(IdentityService.class);
  private final AgentExecutionScope agentExecutionScope = mock(AgentExecutionScope.class);
  private final ActionController controller = new ActionController(agentExecutionScope);

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
    when(buildTests.resolve(any())).thenReturn(ExecutionTarget.LIVE);
    when(agentExecutionScope.target(any(), any(), any(), any())).thenAnswer(call -> call.getArgument(3));
    GenericApplicationContext context = new GenericApplicationContext();
    context.registerBean(IdentityService.class, () -> identityService);
    context.refresh();
    new SpringBeanUtil().setApplicationContext(context);
    ReflectionTestUtils.setField(controller, "actionService", actionService);
    ReflectionTestUtils.setField(controller, "langService", langService);
    ReflectionTestUtils.setField(controller, "identityService", identityService);
    ReflectionTestUtils.setField(controller, "caseExecutionGuard", caseExecutionGuard);
    ReflectionTestUtils.setField(controller, "businessConfigService", businessConfigService);
    ReflectionTestUtils.setField(controller, "buildTests", buildTests);
    SubjectDirectory subjects = mock(SubjectDirectory.class);
    when(subjects.subjectsInDomain("domain")).thenReturn(List.of());
    ReflectionTestUtils.setField(controller, "subjectDirectory", subjects);
    ReflectionTestUtils.setField(controller, "objectMapper", new ObjectMapper());
    when(langService.get(anyString(), anyString())).thenAnswer(call -> call.getArgument(1));
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
    stored.setStatus(Action.STATUS_PENDING_REVIEW);
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
    assertEquals(Action.STATUS_PENDING_REVIEW, action.getStatus());
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
    when(actionService.definitionForm(any(), eq("en"), eq("domain"))).thenReturn(JSONObject.of(
        "fields", new JSONArray(), "values", JSONObject.of("name", ""),
        "errors", List.of(FormFields.error("/function/operation", "invalid_option", "expected OPERATION_WRITE")),
        "save", JSONObject.of("path", "/action/save")));

    JSONObject body = perform("/action/definitionForm", """
        {"target":{"kind":"draft"},"values":{"name":""},"changedField":null}""");

    assertTrue(body.getBooleanValue("success"));
    JSONArray errors = body.getJSONObject("data").getJSONArray("errors");
    assertEquals(1, errors.size());
    assertEquals("/function/operation", errors.getJSONObject(0).getString("field"));
    assertEquals("invalid_option", errors.getJSONObject(0).getString("code"));
    assertEquals("expected OPERATION_WRITE", errors.getJSONObject(0).getString("message"));
  }

  @Test
  void aReadActionNamesEachExplainedSegmentAndDerivedEffectByItsKind() throws Exception {
    Action action = new Action();
    action.setId("a1");
    action.setName("Approve");
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
    when(actionService.execute(eq("a1"), any(JSONObject.class), eq("en"), any(), any(), anyInt(), any()))
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
    when(actionService.execute(eq("a1"), any(JSONObject.class), eq("en"), any(), any(), anyInt(), any()))
        .thenReturn(result);

    JSONObject body = performExecute("a1", "{}");

    assertFalse(body.getBooleanValue("success"));
    assertFalse(body.containsKey("code"));
    assertEquals("program failed", body.getString("message"));
  }

  @Test
  void anUngrantedFormReturnsARefusalCode() throws Exception {
    when(actionService.form(any(), any(), any(), any(), eq("en"), any()))
        .thenThrow(new OwnerRefusal("ACTION_NOT_GRANTED", "No role grants this action"));

    JSONObject body = perform("/action/form", """
        {"id":"a1"}""");

    assertFalse(body.getBooleanValue("success"));
    assertEquals("ACTION_NOT_GRANTED", body.getString("code"));
    assertEquals("No role grants this action", body.getString("message"));
  }

  private JSONObject performExecute(String id, String param) throws Exception {
    var mvc = MockMvcBuilders.standaloneSetup(controller)
        .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    var response = mvc.perform(post("/action/execute")
            .header("Accept-Language", "en")
            .param("id", id)
            .param("param", param))
        .andExpect(status().isOk()).andReturn().getResponse();
    return JSON.parseObject(response.getContentAsString());
  }

  private JSONObject perform(String path, String body) throws Exception {
    var mvc = MockMvcBuilders.standaloneSetup(controller)
        .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    var response = mvc.perform(post(path)
            .header("Accept-Language", "en")
            .contentType(MediaType.APPLICATION_JSON)
            .content(body))
        .andExpect(status().isOk()).andReturn().getResponse();
    return JSON.parseObject(response.getContentAsString());
  }
}
