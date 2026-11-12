package io.ontomato.dataengine.service.impl;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.service.ABCProgramService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.SystemUtils;
import io.ontomato.dataengine.util.ZipBundleUtil;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

class ActionFunctionAdmissionTest {
  // Every entry point refuses with the same language entry; the wording itself belongs to the language file.
  private String message;
  private final FunctionDao functions = mock(FunctionDao.class);
  private final ActionDao actions = mock(ActionDao.class);
  private final ABCProgramService programs = mock(ABCProgramService.class);
  private final ActionServiceImpl service = spy(new ActionServiceImpl());
  private final QueryAccessService.GrantUser user = new QueryAccessService.GrantUser("user-a", "domain-a");

  @BeforeEach
  void setup() throws Exception {
    var messages = new LangServiceImpl();
    var english = JSON.parseArray(Files.readString(Path.of("conf-defaults/lang/en.json")));
    for (int i = 0; i < english.size(); i++)
      if ("Action.unsupportedFunction".equals(english.getJSONObject(i).getString("key")))
        message = english.getJSONObject(i).getString("value");
    ReflectionTestUtils.setField(messages, "langMap", Map.of("en", english));
    ReflectionTestUtils.setField(service, "langService", messages);
    ReflectionTestUtils.setField(service, "functionDao", functions);
    ReflectionTestUtils.setField(service, "actionDao", actions);
    ReflectionTestUtils.setField(service, "abcProgramService", programs);
  }

  private Action action(String operation) {
    var function = new Function();
    function.setOperation(operation);
    function.setDomainId("domain-a");
    function.setCode(null);
    function.setQueryPackage(JSONObject.of("manifest", JSONObject.of("parameterDefs", new JSONArray())));
    var action = new Action();
    action.setDomainId("domain-a");
    action.setStatus(Action.STATUS_PUBLISHED);
    action.setFunction(function);
    return action;
  }

  @Test
  void publishedImportsCannotBypassExplanationReadiness() throws Exception {
    var action = action(Function.OPERATION_WRITE);
    action.getFunction().setQueryPackage(null);
    action.getFunction().setId("function-a");
    action.getFunction().setCode("# ontomato-python:2\nprint('ok')");
    byte[] data = ZipBundleUtil.zip("actions.json", JSON.toJSONBytes(List.of(action)));
    try (var current = mockStatic(SystemUtils.class)) {
      current.when(SystemUtils::getCurUser).thenReturn(user);
      var result = service.importActions(data, "en", true);
      assertFalse(result.getBooleanValue("success"));
      assertEquals(1, result.getIntValue("failureCount"));
    }
    verifyNoInteractions(functions, actions);
  }

  @ParameterizedTest
  @ValueSource(strings = {Function.OPERATION_READ, Function.OPERATION_WRITE})
  void saveRejectsQueryPackagesBeforePersistingOrCheckingPython(String operation) {
    var error = assertThrows(IllegalArgumentException.class, () -> service.save(action(operation), "en"));
    assertTrue(error.getMessage().endsWith(message));
    verifyNoInteractions(functions, actions);
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void existingIdIsJudgedByTheSubmittedOperation(boolean packagePresent) {
    var submitted = action(Function.OPERATION_READ);
    if (!packagePresent) submitted.getFunction().setQueryPackage(null);
    submitted.getFunction().setId("function-a");
    var stored = new Function();
    stored.setOperation(Function.OPERATION_WRITE);
    stored.setCode("# ontomato-python:2\nprint('ok')");
    when(functions.queryById("function-a")).thenReturn(stored);
    var error = assertThrows(IllegalArgumentException.class, () -> service.save(submitted, "en"));
    assertTrue(error.getMessage().endsWith(message));
    verify(functions, never()).save(any(), anyString());
    verifyNoInteractions(actions);
  }

  @ParameterizedTest
  @ValueSource(strings = {Function.OPERATION_READ, Function.OPERATION_WRITE})
  void formAndExecutionRejectStoredInvalidAssetsWithTheSameMessage(String operation) throws Exception {
    doReturn(action(operation)).when(service).queryById("action-a");
    var formError = assertThrows(IllegalArgumentException.class,
        () -> service.form("action-a", new JSONObject(), null, List.of(), "en", user));
    var executionError = assertThrows(IllegalArgumentException.class,
        () -> service.execute("action-a", new JSONObject(), "en", user, new UserDataPermission(), 1));
    assertTrue(formError.getMessage().endsWith(message));
    assertTrue(executionError.getMessage().endsWith(message));
    verifyNoInteractions(programs);
  }

  @ParameterizedTest
  @ValueSource(strings = {Function.OPERATION_READ, Function.OPERATION_WRITE})
  void importRejectsInvalidFunctionsBeforeSavingEvenWhenExplanationsAreOptional(String operation) throws Exception {
    var action = action(operation);
    action.getFunction().setId("function-a");
    byte[] bundle = ZipBundleUtil.zip("actions.json",
        JSON.toJSONBytes(List.of(action), Feature.WriteMapNullValue));
    try (var system = mockStatic(SystemUtils.class)) {
      system.when(SystemUtils::getCurUser).thenReturn(user);
      var result = service.importActions(bundle, "en", true);
      assertFalse(result.getBooleanValue("success"));
      assertEquals(0, result.getIntValue("successCount"));
      assertTrue(result.getJSONArray("failures").getJSONObject(0).getString("message").endsWith(message));
    }
    verifyNoInteractions(functions, actions);
  }
}
