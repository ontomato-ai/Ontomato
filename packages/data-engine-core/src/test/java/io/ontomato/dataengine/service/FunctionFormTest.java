package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.dao.MetricViewDao;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.ontomato.dataengine.service.impl.FunctionServiceImpl;
import io.ontomato.dataengine.service.scheduling.OntologyScheduleReferences;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.springframework.test.util.ReflectionTestUtils;

/** The Function owner describes read and write forms, their controls, read-only rules and save shape. */
class FunctionFormTest {
  private final FunctionServiceImpl service = new FunctionServiceImpl();
  private final FunctionDao functionDao = mock(FunctionDao.class);
  private final MetricViewDao metricViewDao = mock(MetricViewDao.class);
  private final ActionDao actionDao = mock(ActionDao.class);
  private final OntologyScheduleReferences scheduledTasks = mock(OntologyScheduleReferences.class);
  private final LangService langService = mock(LangService.class);

  @BeforeEach
  void setup() {
    ReflectionTestUtils.setField(service, "functionDao", functionDao);
    ReflectionTestUtils.setField(service, "metricViewDao", metricViewDao);
    ReflectionTestUtils.setField(service, "actionDao", actionDao);
    ReflectionTestUtils.setField(service, "scheduledTasks", scheduledTasks);
    ReflectionTestUtils.setField(service, "langService", langService);
    when(langService.get(anyString(), anyString())).thenAnswer(call -> call.getArgument(1));
    when(metricViewDao.referencedFunctionIds()).thenReturn(Set.of());
    when(actionDao.queryList(any(), any(), any(), any())).thenReturn(List.of());
    when(scheduledTasks.references(anyString())).thenReturn(false);
  }

  @Test
  void anObjectTargetOutsideThisDomainIsRefusedAsNotFound() {
    OwnerRefusal refusal = assertThrows(OwnerRefusal.class, () -> form(objectTarget("missing")));

    assertEquals("FUNCTION_NOT_FOUND", refusal.code());
    assertEquals("Function not found", refusal.getMessage());
  }

  @Test
  void saveRefusesTheFunctionRulesWithTheirCodes() {
    Function existing = writeFunction();
    existing.setId("f1");
    when(functionDao.queryById("f1")).thenReturn(existing);

    Function missing = writeFunction();
    missing.setId("missing");
    assertRefusal("FUNCTION_NOT_FOUND", () -> service.save(missing, "en"));

    Function system = writeFunction();
    system.setId("f1");
    system.setOrigin(Function.ORIGIN_SYSTEM);
    assertRefusal("FUNCTION_SYSTEM", () -> service.save(system, "en"));

    Function otherDomain = writeFunction();
    otherDomain.setId("f1");
    otherDomain.setDomainId("domain-b");
    assertRefusal("FUNCTION_DOMAIN_MISMATCH", () -> service.save(otherDomain, "en"));

    Function replacement = writeFunction();
    replacement.setId("f1");
    existing.setOperation(Function.OPERATION_PRODUCT);
    assertRefusal("FUNCTION_PRODUCT_IMMUTABLE", () -> service.save(replacement, "en"));
    existing.setOperation(Function.OPERATION_WRITE);

    when(metricViewDao.referencedFunctionIds()).thenReturn(Set.of("f1"));
    OwnerRefusal referenced = assertThrows(OwnerRefusal.class, () -> service.save(replacement, "en"));
    assertEquals("FUNCTION_REFERENCED", referenced.code());
    assertEquals("Function.referencedByMetricView", referenced.getMessage());
  }

  @Test
  void deleteRefusesSystemProductAndReferencedFunctions() {
    Function system = readFunction();
    system.setOrigin(Function.ORIGIN_SYSTEM);
    when(functionDao.queryById("f1")).thenReturn(system);
    assertRefusal("FUNCTION_SYSTEM", () -> service.delete("f1", "en"));

    Function product = readFunction();
    product.setOperation(Function.OPERATION_PRODUCT);
    when(functionDao.queryById("f1")).thenReturn(product);
    assertRefusal("FUNCTION_PRODUCT_IMMUTABLE", () -> service.delete("f1", "en"));

    when(functionDao.queryById("f1")).thenReturn(readFunction());
    when(metricViewDao.referencedFunctionIds()).thenReturn(Set.of("f1"));
    assertRefusal("FUNCTION_REFERENCED", () -> service.delete("f1", "en"));
  }

  @Test
  void describesAReadFunctionAndKeepsASavedOperationReadOnly() {
    Function function = readFunction();
    when(functionDao.queryById("f1")).thenReturn(function);

    JSONObject form = form(objectTarget("f1"));

    assertEquals("Revenue query", form.getJSONObject("values").getString("name"));
    assertTrue(field(form, "/name").getBooleanValue("required"));
    JSONObject operation = field(form, "/operation");
    assertEquals("select", operation.getJSONObject("control").getString("kind"));
    assertTrue(operation.getBooleanValue("refreshOnChange"));
    assertTrue(operation.getBooleanValue("readOnly"));
    assertEquals("PanelForm.readOnly.operation", operation.getString("readOnlyReason"));
    JSONObject queryPackage = field(form, "/queryPackage");
    assertEquals("code", queryPackage.getJSONObject("control").getString("kind"));
    assertEquals("json", queryPackage.getJSONObject("control").getString("language"));
    assertTrue(queryPackage.getBooleanValue("required"));
    assertEquals("code", field(form, "/returnDef/columnLabels").getJSONObject("control").getString("kind"));
    assertNull(optionalField(form, "/parameters"));
    assertEquals("/function/save", form.getJSONObject("save").getString("path"));
    assertEquals("function.update", form.getJSONObject("save").getString("draftOperation"));
  }

  @Test
  void describesAWriteFunctionsParametersAndCode() {
    Function function = writeFunction();
    when(functionDao.queryById("w1")).thenReturn(function);

    JSONObject form = form(objectTarget("w1"));

    JSONObject parameters = field(form, "/parameters");
    JSONObject control = parameters.getJSONObject("control");
    assertEquals("object-array", control.getString("kind"));
    assertNull(control.getString("itemKeyPath"));
    assertEquals("", control.getJSONObject("defaultItem").getString("name"));
    assertEquals("TYPE_STRING", control.getJSONObject("defaultItem").getString("type"));
    assertEquals("", control.getJSONObject("defaultItem").getString("sample"));
    assertEquals("", control.getJSONObject("defaultItem").getString("value"));
    assertTrue(control.getJSONObject("defaultItem").getJSONArray("classNames").isEmpty());
    assertEquals("select", field(control.getJSONArray("itemFields"), "/type").getJSONObject("control").getString("kind"));
    assertEquals("string-array", field(control.getJSONArray("itemFields"), "/classNames").getJSONObject("control").getString("kind"));
    assertEquals("string-array", field(form, "/returnDef/classNames").getJSONObject("control").getString("kind"));
    JSONObject code = field(form, "/code");
    assertEquals("code", code.getJSONObject("control").getString("kind"));
    assertEquals("python", code.getJSONObject("control").getString("language"));
    assertFalse(code.getBooleanValue("readOnly"));
    assertNull(optionalField(form, "/queryPackage"));
  }

  @Test
  void aDraftGetsThePageDefaultsAndCreateOperation() {
    JSONObject form = form(JSONObject.of("target", JSONObject.of("kind", "draft")));

    JSONObject values = form.getJSONObject("values");
    assertEquals("OPERATION_READ", values.getString("operation"));
    assertEquals("USER", values.getString("origin"));
    assertEquals("function.create", form.getJSONObject("save").getString("draftOperation"));
    assertFalse(field(form, "/operation").getBooleanValue("readOnly"));
    assertEquals("code", field(form, "/queryPackage").getJSONObject("control").getString("kind"));
  }

  @Test
  void aReferencedFunctionIsReadOnlyEverywhere() {
    Function function = readFunction();
    when(functionDao.queryById("f1")).thenReturn(function);
    when(metricViewDao.referencedFunctionIds()).thenReturn(Set.of("f1"));

    JSONObject form = form(objectTarget("f1"));

    for (Object item : form.getJSONArray("fields"))
      assertTrue(((JSONObject) item).getBooleanValue("readOnly"), ((JSONObject) item).getString("path"));
    assertEquals("Function.referencedByMetricView", field(form, "/name").getString("readOnlyReason"));
  }

  @Test
  void aProductFunctionIsReadOnly() {
    Function function = readFunction();
    function.setOperation(Function.OPERATION_PRODUCT);
    when(functionDao.queryById("f1")).thenReturn(function);

    JSONObject form = form(objectTarget("f1"));

    assertEquals("PanelForm.readOnly.product", field(form, "/name").getString("readOnlyReason"));
  }

  @Test
  void refreshingTheOperationSwitchesTheFieldSet() {
    Function function = readFunction();
    when(functionDao.queryById("f1")).thenReturn(function);
    JSONObject values = asset(function);
    values.put("operation", Function.OPERATION_WRITE);
    values.put("parameters", JSONArray.of(JSONObject.of("name", "amount", "type", Parameter.TYPE_NUMBER)));
    JSONObject request = objectTarget("f1");
    request.put("values", values);
    request.put("changedField", "/operation");

    JSONObject form = service.form(request, "en", "domain-a");

    assertSame(values, form.getJSONObject("values"));
    assertEquals("object-array", field(form, "/parameters").getJSONObject("control").getString("kind"));
    assertEquals("string-array", field(form, "/returnDef/classNames").getJSONObject("control").getString("kind"));
    assertNull(optionalField(form, "/queryPackage"));
  }

  @Test
  void showsTheLegacyCodeForAReadFunctionWithoutAQueryPackage() {
    Function function = readFunction();
    function.setQueryPackage(null);
    function.setCode("# ontomato-python:2\nprint(1)");
    function.setParameters(new ArrayList<>());
    when(functionDao.queryById("f1")).thenReturn(function);

    JSONObject form = form(objectTarget("f1"));

    JSONObject code = field(form, "/code");
    assertEquals("python", code.getJSONObject("control").getString("language"));
    assertTrue(code.getBooleanValue("readOnly"));
  }

  @Test
  void anIncomingDraftIsCheckedWithoutSaving() {
    JSONObject values = FunctionForm.defaultValues();
    values.put("name", "New query");
    values.put("queryPackage", JSONObject.of("manifest", JSONObject.of("parameterDefs", new JSONArray())));
    JSONObject request = JSONObject.of("target", JSONObject.of("kind", "draft"));
    request.put("values", values);
    request.put("changedField", null);

    JSONObject form = service.form(request, "en", "domain-a");

    verify(functionDao, never()).save(any(), anyString());
    assertEquals("New query", form.getJSONObject("values").getString("name"));
  }

  @Test
  void rejectsADraftAtTheFieldThatFails() {
    JSONObject values = FunctionForm.defaultValues();
    values.put("name", "New query");
    assertError(draftErrors(values), "/queryPackage", "required");

    values = FunctionForm.defaultValues();
    values.put("name", "New query");
    values.put("queryPackage", JSONObject.of("manifest", JSONObject.of("parameterDefs", new JSONArray())));
    values.put("operation", "OPERATION_DELETE");
    assertError(draftErrors(values), "/operation", "invalid_option");

    values = FunctionForm.defaultValues();
    values.put("name", "");
    values.put("queryPackage", JSONObject.of("manifest", JSONObject.of("parameterDefs", new JSONArray())));
    assertError(draftErrors(values), "/name", "required");

    values = FunctionForm.defaultValues();
    values.put("name", "New write");
    values.put("operation", Function.OPERATION_WRITE);
    values.put("parameters", JSONArray.of(JSONObject.of("name", "amount", "type", "TYPE_BOOLEAN")));
    assertError(draftErrors(values), "/parameters/0/type", "invalid_option");

    values = FunctionForm.defaultValues();
    values.put("name", "New write");
    values.put("operation", Function.OPERATION_WRITE);
    values.getJSONObject("returnDef").put("classNames", "/Order");
    assertError(draftErrors(values), "/returnDef/classNames", "invalid_array");
  }

  @Test
  void collectsEveryDirectFieldError() {
    JSONObject values = FunctionForm.defaultValues();
    values.put("name", "");
    values.put("description", 42);
    values.put("returnDef", "not an object");

    List<ObjectNode> errors = draftErrors(values);

    assertEquals(4, errors.size());
    assertTrue(errors.stream().anyMatch(error -> "/name".equals(error.get("field").asText())));
    assertTrue(errors.stream().anyMatch(error -> "/description".equals(error.get("field").asText())));
    assertTrue(errors.stream().anyMatch(error -> "/returnDef".equals(error.get("field").asText())));
    assertTrue(errors.stream().anyMatch(error -> "/queryPackage".equals(error.get("field").asText())));
  }

  @Test
  void reportsValidatorErrorsOnTheFunctionContainer() {
    JSONObject values = FunctionForm.defaultValues();
    values.put("name", "New query");
    values.put("queryPackage", JSONObject.of("manifest", JSONObject.of("parameterDefs", new JSONArray())));
    values.put("sourceArtifact", new JSONObject());

    List<ObjectNode> errors = draftErrors(values);

    assertEquals(1, errors.size());
    assertEquals("/function", errors.get(0).get("field").asText());
    assertEquals("invalid_object", errors.get(0).get("code").asText());
    assertTrue(errors.get(0).get("message").asText().contains("registered by the publication service"));
  }

  private static void assertRefusal(String code, Executable action) {
    OwnerRefusal refusal = assertThrows(OwnerRefusal.class, action);
    assertEquals(code, refusal.code());
  }

  private List<ObjectNode> draftErrors(JSONObject values) {
    JSONObject request = JSONObject.of("target", JSONObject.of("kind", "draft"));
    request.put("values", values);
    request.put("changedField", null);
    PanelFormException error = assertThrows(PanelFormException.class, () -> service.form(request, "en", "domain-a"));
    assertEquals("Invalid Function draft", error.getMessage());
    return error.fields();
  }

  private static void assertError(List<ObjectNode> fields, String field, String code) {
    assertEquals(1, fields.size());
    ObjectNode error = fields.get(0);
    assertEquals(field, error.get("field").asText());
    assertEquals(code, error.get("code").asText());
    assertFalse(error.get("message").asText().isBlank());
  }

  private JSONObject form(JSONObject request) {
    return service.form(request, "en", "domain-a");
  }

  private JSONObject objectTarget(String id) {
    return JSONObject.of("target", JSONObject.of(
        "kind", "object", "objectType", "platform:Function", "primaryKey", id));
  }

  private Function readFunction() {
    Function function = new Function();
    function.setId("f1");
    function.setName("Revenue query");
    function.setDescription("Reads revenue");
    function.setOrigin(Function.ORIGIN_USER);
    function.setOperation(Function.OPERATION_READ);
    function.setDomainId("domain-a");
    function.setQueryPackage(JSONObject.of("manifest", JSONObject.of("parameterDefs", new JSONArray())));
    ReturnDef returnDef = new ReturnDef();
    returnDef.setColumnLabels(JSONObject.of("amount", "Amount"));
    function.setReturnDef(returnDef);
    function.setLogic("Sum the amounts");
    return function;
  }

  private Function writeFunction() {
    Function function = new Function();
    function.setId("w1");
    function.setName("Write order");
    function.setOrigin(Function.ORIGIN_USER);
    function.setOperation(Function.OPERATION_WRITE);
    function.setDomainId("domain-a");
    Parameter amount = new Parameter();
    amount.setName("amount");
    amount.setType(Parameter.TYPE_NUMBER);
    amount.setDescription("Amount");
    amount.setSample("10");
    amount.setClassNames(List.of("/Order"));
    function.setParameters(new ArrayList<>(List.of(amount)));
    ReturnDef returnDef = new ReturnDef();
    returnDef.setClassNames(List.of("/Order"));
    function.setReturnDef(returnDef);
    function.setLogic("Write the order");
    function.setCode("# ontomato-python:2\nprint(1)");
    return function;
  }

  private static JSONObject asset(Object value) {
    return JSON.parseObject(JSON.toJSONString(value, com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue));
  }

  private static JSONObject field(JSONObject form, String path) {
    return field(form.getJSONArray("fields"), path);
  }

  private static JSONObject optionalField(JSONObject form, String path) {
    try {
      return field(form, path);
    } catch (AssertionError missing) {
      return null;
    }
  }

  private static JSONObject field(JSONArray fields, String path) {
    for (Object item : fields)
      if (path.equals(((JSONObject) item).getString("path"))) return (JSONObject) item;
    throw new AssertionError("No field " + path);
  }
}
