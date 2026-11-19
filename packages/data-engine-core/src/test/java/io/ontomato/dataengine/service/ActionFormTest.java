package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.service.impl.ActionServiceImpl;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/** The Action owner describes the target, the write Function, publication status and their read-only rules. */
class ActionFormTest {
  private final ActionServiceImpl service = new ActionServiceImpl();
  private final ActionDao actionDao = mock(ActionDao.class);
  private final FunctionDao functionDao = mock(FunctionDao.class);
  private final AdminService adminService = mock(AdminService.class);
  private final LangService langService = mock(LangService.class);

  @BeforeEach
  void setup() {
    ReflectionTestUtils.setField(service, "actionDao", actionDao);
    ReflectionTestUtils.setField(service, "functionDao", functionDao);
    ReflectionTestUtils.setField(service, "adminService", adminService);
    ReflectionTestUtils.setField(service, "langService", langService);
    when(langService.get(anyString(), anyString())).thenAnswer(call -> call.getArgument(1));
    when(adminService.getJSONRule("domain-a")).thenReturn(Map.of("classDef", List.of(
        JSONObject.of("className", "/Order", "showName", "Order"),
        JSONObject.of("className", "/Customer"))));
  }

  @Test
  void aSystemActionIsReadOnlyEverywhere() {
    put(action("a1", Action.ORIGIN_SYSTEM, Action.STATUS_PENDING_REVIEW));

    JSONObject form = form(objectTarget("a1"));

    for (Object item : form.getJSONArray("fields")) {
      JSONObject field = (JSONObject) item;
      assertTrue(field.getBooleanValue("readOnly"), field.getString("path"));
      assertEquals("Action.cannotModifySystem", field.getString("readOnlyReason"));
    }
    JSONObject target = field(form, "/target").getJSONObject("control");
    for (Object item : target.getJSONArray("fields")) {
      JSONObject child = (JSONObject) item;
      assertTrue(child.getBooleanValue("readOnly"), child.getString("path"));
      assertEquals("Action.cannotModifySystem", child.getString("readOnlyReason"));
    }
  }

  @Test
  void aPublishedActionOnlyFreezesItsCode() {
    put(action("a1", Action.ORIGIN_USER, Action.STATUS_PUBLISHED));

    JSONObject form = form(objectTarget("a1"));

    JSONObject code = field(form, "/function/code");
    assertTrue(code.getBooleanValue("readOnly"));
    assertEquals("Action.publishedIsFrozen", code.getString("readOnlyReason"));
    for (Object item : form.getJSONArray("fields")) {
      JSONObject field = (JSONObject) item;
      if ("/function/code".equals(field.getString("path"))) continue;
      assertFalse(field.getBooleanValue("readOnly"), field.getString("path"));
    }
  }

  @Test
  void describesTheTargetClassesAndOnlyStringKeyParameters() {
    put(action("a1", Action.ORIGIN_USER, Action.STATUS_PENDING_REVIEW));

    JSONObject form = form(objectTarget("a1"));

    JSONObject target = field(form, "/target");
    assertEquals("PanelForm.action.target", target.getString("label"));
    assertEquals("PanelForm.action.targetHelp", target.getString("help"));
    JSONObject control = target.getJSONObject("control");
    assertEquals("object", control.getString("kind"));
    assertEquals("", control.getJSONObject("defaultObject").getString("className"));
    assertEquals("", control.getJSONObject("defaultObject").getString("keyParameter"));
    JSONArray fields = control.getJSONArray("fields");
    JSONObject className = field(fields, "/className");
    assertEquals("PanelForm.action.targetClass", className.getString("label"));
    assertEquals("select", className.getJSONObject("control").getString("kind"));
    JSONArray classOptions = className.getJSONObject("control").getJSONArray("options");
    assertEquals(2, classOptions.size());
    assertEquals("/Order", classOptions.getJSONObject(0).getString("value"));
    assertEquals("Order", classOptions.getJSONObject(0).getString("label"));
    assertEquals("/Customer", classOptions.getJSONObject(1).getString("value"));
    assertEquals("/Customer", classOptions.getJSONObject(1).getString("label"));
    JSONObject keyParameter = field(fields, "/keyParameter");
    assertEquals("PanelForm.action.targetKey", keyParameter.getString("label"));
    JSONArray keyOptions = keyParameter.getJSONObject("control").getJSONArray("options");
    assertEquals(2, keyOptions.size());
    assertEquals("orderNo", keyOptions.getJSONObject(0).getString("value"));
    assertEquals("code", keyOptions.getJSONObject(1).getString("value"));
  }

  @Test
  void parametersRefreshTheTargetKeyOptions() {
    Action action = action("a1", Action.ORIGIN_USER, Action.STATUS_PENDING_REVIEW);
    put(action);
    JSONObject values = PanelFormFields.asset(action);
    JSONArray parameters = values.getJSONObject("function").getJSONArray("parameters");
    parameters.add(JSONObject.of("name", "customerNo", "type", Parameter.TYPE_STRING));
    JSONObject request = objectTarget("a1");
    request.put("values", values);
    request.put("changedField", "/function/parameters");

    JSONObject form = service.definitionForm(request, "en", "domain-a");

    assertSame(values, form.getJSONObject("values"));
    JSONArray keyOptions = field(field(form, "/target").getJSONObject("control").getJSONArray("fields"), "/keyParameter")
        .getJSONObject("control").getJSONArray("options");
    assertEquals(3, keyOptions.size());
    assertEquals("customerNo", keyOptions.getJSONObject(2).getString("value"));
    assertTrue(field(form, "/function/parameters").getBooleanValue("refreshOnChange"));
  }

  @Test
  void aDraftReturnsParameterAndOperationErrorsWithTheForm() {
    JSONObject values = ActionForm.defaultValues();
    values.put("name", "New action");
    values.getJSONObject("function").put(
        "parameters", JSONArray.of(JSONObject.of("name", "amount", "type", "TYPE_BOOLEAN")));
    assertError(draftErrors(values), "/function/parameters/0/type", "invalid_option");

    values = ActionForm.defaultValues();
    values.put("name", "New action");
    values.getJSONObject("function").put("operation", Function.OPERATION_READ);
    assertError(draftErrors(values), "/function/operation", "invalid_option");
  }

  @Test
  void aDraftGetsThePageDefaultsAndCreateOperation() {
    JSONObject form = form(JSONObject.of("target", JSONObject.of("kind", "draft")));

    JSONObject values = form.getJSONObject("values");
    assertEquals("USER", values.getString("origin"));
    assertEquals(Action.STATUS_PENDING_REVIEW, values.getString("status"));
    assertNull(values.get("target"));
    assertEquals(Function.OPERATION_WRITE, values.getJSONObject("function").getString("operation"));
    assertEquals("action.create", form.getJSONObject("save").getString("draftOperation"));
    assertEquals("/action/save", form.getJSONObject("save").getString("path"));
    assertEquals(List.of(), form.get("errors"));
  }

  @SuppressWarnings("unchecked")
  private List<ObjectNode> draftErrors(JSONObject values) {
    JSONObject request = JSONObject.of("target", JSONObject.of("kind", "draft"));
    request.put("values", values);
    request.put("changedField", null);
    JSONObject form = service.definitionForm(request, "en", "domain-a");
    return (List<ObjectNode>) form.get("errors");
  }

  private static void assertError(List<ObjectNode> fields, String field, String code) {
    assertEquals(1, fields.size());
    ObjectNode error = fields.get(0);
    assertEquals(field, error.get("field").asText());
    assertEquals(code, error.get("code").asText());
    assertFalse(error.get("message").asText().isBlank());
  }

  private JSONObject form(JSONObject request) {
    return service.definitionForm(request, "en", "domain-a");
  }

  private JSONObject objectTarget(String id) {
    return JSONObject.of("target", JSONObject.of(
        "kind", "object", "objectType", "platform:Action", "primaryKey", id));
  }

  private void put(Action action) {
    when(actionDao.queryById(action.getId())).thenReturn(new Object[] {action, "f1"});
    when(functionDao.queryById("f1")).thenReturn(action.getFunction());
  }

  private Action action(String id, String origin, String status) {
    Function function = new Function();
    function.setId("f1");
    function.setName("Write order");
    function.setOrigin(Function.ORIGIN_USER);
    function.setOperation(Function.OPERATION_WRITE);
    function.setDomainId("domain-a");
    Parameter orderNo = new Parameter();
    orderNo.setName("orderNo");
    orderNo.setType(Parameter.TYPE_STRING);
    Parameter amount = new Parameter();
    amount.setName("amount");
    amount.setType(Parameter.TYPE_NUMBER);
    Parameter code = new Parameter();
    code.setName("code");
    code.setType(Parameter.TYPE_STRING);
    function.setParameters(new ArrayList<>(List.of(orderNo, amount, code)));
    ReturnDef returnDef = new ReturnDef();
    returnDef.setIsVoid(true);
    returnDef.setClassNames(List.of("/Order"));
    function.setReturnDef(returnDef);
    function.setLogic("Write the order");
    function.setCode("# ontomato-python:2\nprint(1)");
    Action action = new Action();
    action.setId(id);
    action.setName("Approve order");
    action.setDescription("Approves an order");
    action.setOrigin(origin);
    action.setStatus(status);
    action.setDomainId("domain-a");
    action.setFunction(function);
    return action;
  }

  private static JSONObject field(JSONObject form, String path) {
    return field(form.getJSONArray("fields"), path);
  }

  private static JSONObject field(JSONArray fields, String path) {
    for (Object item : fields)
      if (path.equals(((JSONObject) item).getString("path"))) return (JSONObject) item;
    throw new AssertionError("No field " + path);
  }
}
