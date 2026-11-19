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
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewBinding;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.dao.MetricViewDao;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.ontomato.dataengine.service.impl.MetricViewServiceImpl;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/** The MetricView owner describes the panel's fields, values, controls, read-only rules and save shape. */
class MetricViewFormTest {
  private final MetricViewServiceImpl service = new MetricViewServiceImpl();
  private final MetricViewDao metricViewDao = mock(MetricViewDao.class);
  private final FunctionDao functionDao = mock(FunctionDao.class);
  private final LangService langService = mock(LangService.class);

  @BeforeEach
  void setup() {
    ReflectionTestUtils.setField(service, "metricViewDao", metricViewDao);
    ReflectionTestUtils.setField(service, "functionDao", functionDao);
    ReflectionTestUtils.setField(service, "langService", langService);
    when(langService.get(anyString(), anyString())).thenAnswer(call -> call.getArgument(1));
  }

  @Test
  void describesAnExistingMetricWithItsControlsAndSaveShape() {
    MetricView metric = metric();
    stubMetric(metric);

    JSONObject form = form(objectTarget("m1"));

    assertEquals("Revenue", form.getJSONObject("values").getString("name"));
    JSONObject name = field(form, "/name");
    assertEquals("text", name.getJSONObject("control").getString("kind"));
    assertTrue(name.getBooleanValue("required"));
    assertFalse(name.getBooleanValue("readOnly"));
    JSONObject status = field(form, "/status");
    assertEquals("select", status.getJSONObject("control").getString("kind"));
    assertEquals(List.of("PENDING_REVIEW", "PUBLISHED", "UNUSED"),
        status.getJSONObject("control").getJSONArray("options").stream().map(option -> ((JSONObject) option).getString("value")).toList());
    assertEquals("string-array", field(form, "/matchQuestions").getJSONObject("control").getString("kind"));
    JSONObject queryPackage = field(form, "/function/queryPackage");
    assertEquals("code", queryPackage.getJSONObject("control").getString("kind"));
    assertEquals("json", queryPackage.getJSONObject("control").getString("language"));
    assertTrue(queryPackage.getBooleanValue("required"));
    assertTrue(queryPackage.getBooleanValue("refreshOnChange"));
    assertEquals("code", field(form, "/function/returnDef/columnLabels").getJSONObject("control").getString("kind"));

    JSONObject bindings = field(form, "/bindings");
    JSONObject control = bindings.getJSONObject("control");
    assertEquals("object-array", control.getString("kind"));
    assertEquals("/id", control.getString("itemKeyPath"));
    assertEquals("hidden", field(control.getJSONArray("itemFields"), "/id").getJSONObject("control").getString("kind"));
    assertEquals("string-array", field(control.getJSONArray("itemFields"), "/matchQuestions").getJSONObject("control").getString("kind"));
    JSONObject amount = field(control.getJSONArray("itemFields"), "/parameters/amount");
    assertEquals("code", amount.getJSONObject("control").getString("kind"));
    assertEquals("json", amount.getJSONObject("control").getString("language"));
    assertEquals(List.of("number", "null"), amount.getJSONObject("valueSchema").getJSONArray("type").toJavaList(String.class));
    JSONObject labels = field(control.getJSONArray("itemFields"), "/parameters/labels");
    assertEquals(List.of("array", "null"), labels.getJSONObject("valueSchema").getJSONArray("type").toJavaList(String.class));
    assertEquals("string", labels.getJSONObject("valueSchema").getJSONObject("items").getString("type"));
    JSONObject defaultItem = control.getJSONObject("defaultItem");
    assertEquals("", defaultItem.getString("name"));
    assertTrue(defaultItem.getJSONArray("matchQuestions").isEmpty());
    assertTrue(defaultItem.getJSONObject("parameters").containsKey("amount"));
    assertNull(defaultItem.getJSONObject("parameters").get("amount"));

    JSONObject save = form.getJSONObject("save");
    assertEquals("POST", save.getString("method"));
    assertEquals("/metricView/save", save.getString("path"));
    assertEquals("metric-view.update", save.getString("draftOperation"));
    assertEquals("object", save.getJSONObject("bodySchema").getString("type"));
    assertFalse(form.containsKey("revision"));
  }

  @Test
  void aSystemMetricIsReadOnlyEverywhere() {
    MetricView metric = metric();
    metric.setOrigin(MetricView.ORIGIN_SYSTEM);
    stubMetric(metric);

    JSONObject form = form(objectTarget("m1"));

    for (Object item : form.getJSONArray("fields"))
      assertTrue(((JSONObject) item).getBooleanValue("readOnly"), ((JSONObject) item).getString("path"));
    assertEquals("MetricView.cannotModifySystem", field(form, "/name").getString("readOnlyReason"));
  }

  @Test
  void aWorkflowPendingMetricSaysToEditTheWorkflow() {
    MetricView metric = metric();
    metric.setWorkflowSource(new MetricView.WorkflowSource("w1", 1, MetricView.WorkflowSource.Purpose.pending));
    stubMetric(metric);

    JSONObject form = form(objectTarget("m1"));

    assertEquals("PanelForm.readOnly.workflowPending", field(form, "/bindings").getString("readOnlyReason"));
  }

  @Test
  void refreshingTheQueryPackageRebuildsTheBindingParameterFields() {
    MetricView metric = metric();
    stubMetric(metric);
    JSONObject values = asset(metric);
    JSONObject function = values.getJSONObject("function");
    JSONArray defs = function.getJSONObject("queryPackage").getJSONObject("manifest").getJSONArray("parameterDefs");
    defs.add(JSONObject.of("name", "region", "type", Parameter.TYPE_STRING, "description", "Region area"));
    JSONObject request = objectTarget("m1");
    request.put("values", values);
    request.put("changedField", "/function/queryPackage");

    JSONObject form = service.form(request, "en", "domain-a");

    assertSame(values, form.getJSONObject("values"));
    JSONObject bindings = field(form, "/bindings").getJSONObject("control");
    JSONObject region = field(bindings.getJSONArray("itemFields"), "/parameters/region");
    assertEquals("Region area", region.getString("help"));
    assertEquals(List.of("string", "null"), region.getJSONObject("valueSchema").getJSONArray("type").toJavaList(String.class));
    assertTrue(bindings.getJSONObject("defaultItem").getJSONObject("parameters").containsKey("region"));
  }

  @Test
  void showsTheLegacyCodeAndItsHintWhenTheMetricHasNoQueryPackage() {
    MetricView metric = metric();
    metric.getFunction().setQueryPackage(null);
    metric.getFunction().setCode("# ontomato-python:2\nprint(1)");
    metric.getFunction().setParameters(new ArrayList<>());
    stubMetric(metric);

    JSONObject form = form(objectTarget("m1"));

    JSONObject code = field(form, "/function/code");
    assertEquals("code", code.getJSONObject("control").getString("kind"));
    assertEquals("python", code.getJSONObject("control").getString("language"));
    assertTrue(code.getBooleanValue("readOnly"));
    assertEquals("PanelForm.queryPackageLegacyHelp", field(form, "/function/queryPackage").getString("help"));
  }

  @Test
  void aDraftGetsThePageDefaultsAndCreateOperation() {
    JSONObject form = form(JSONObject.of("target", JSONObject.of("kind", "draft")));

    JSONObject values = form.getJSONObject("values");
    assertEquals("PENDING_REVIEW", values.getString("status"));
    assertEquals("USER", values.getString("origin"));
    assertEquals("OPERATION_READ", values.getJSONObject("function").getString("operation"));
    assertTrue(values.getJSONArray("bindings").isEmpty());
    assertEquals("metric-view.create", form.getJSONObject("save").getString("draftOperation"));
    assertEquals("string-array", field(form, "/matchQuestions").getJSONObject("control").getString("kind"));
    assertEquals("object-array", field(form, "/bindings").getJSONObject("control").getString("kind"));
  }

  @Test
  void anIncomingDraftIsCheckedWithoutSaving() {
    JSONObject values = MetricViewForm.defaults();
    values.put("name", "New metric");
    values.getJSONObject("function").put("queryPackage", JSONObject.of("manifest", JSONObject.of("parameterDefs", new JSONArray())));
    JSONObject request = JSONObject.of("target", JSONObject.of("kind", "draft"));
    request.put("values", values);
    request.put("changedField", null);

    JSONObject form = service.form(request, "en", "domain-a");

    verify(metricViewDao, never()).save(any());
    assertEquals("New metric", form.getJSONObject("values").getString("name"));
  }

  @Test
  void rejectsADraftAtTheFieldThatFails() {
    JSONObject values = MetricViewForm.defaults();
    values.put("name", "New metric");
    values.getJSONObject("function").put("queryPackage", JSONObject.of("manifest", JSONObject.of("parameterDefs", new JSONArray())));
    values.getJSONObject("function").getJSONObject("returnDef").put("columnLabels", "not an object");
    assertError(draftErrors(values), "/function/returnDef/columnLabels", "invalid_object");

    values = MetricViewForm.defaults();
    values.put("name", "New metric");
    assertError(draftErrors(values), "/function/queryPackage", "required");

    values = MetricViewForm.defaults();
    values.put("name", "New metric");
    values.getJSONObject("function").put("queryPackage", JSONObject.of("manifest", JSONObject.of("parameterDefs", new JSONArray())));
    values.put("matchQuestions", "one question");
    assertError(draftErrors(values), "/matchQuestions", "invalid_array");

    values = MetricViewForm.defaults();
    values.put("name", "");
    values.getJSONObject("function").put("queryPackage", JSONObject.of("manifest", JSONObject.of("parameterDefs", new JSONArray())));
    assertError(draftErrors(values), "/name", "required");

    values = MetricViewForm.defaults();
    values.put("name", "New metric");
    values.put("status", "DELETED");
    values.getJSONObject("function").put("queryPackage", JSONObject.of("manifest", JSONObject.of("parameterDefs", new JSONArray())));
    assertError(draftErrors(values), "/status", "invalid_option");
  }

  @Test
  void collectsEveryDirectFieldError() {
    JSONObject values = MetricViewForm.defaults();
    values.put("name", "");
    values.put("matchQuestions", "one question");

    List<ObjectNode> errors = draftErrors(values);

    assertEquals(3, errors.size());
    assertTrue(errors.stream().anyMatch(error -> "/name".equals(error.get("field").asText())));
    assertTrue(errors.stream().anyMatch(error -> "/matchQuestions".equals(error.get("field").asText())));
    assertTrue(errors.stream().anyMatch(error -> "/function/queryPackage".equals(error.get("field").asText())));
  }

  @Test
  void reportsValidatorErrorsOnTheContainerTheyValidate() {
    JSONObject values = MetricViewForm.defaults();
    values.put("name", "New metric");
    values.getJSONObject("function").put("queryPackage", JSONObject.of("manifest", JSONObject.of("parameterDefs",
        JSONArray.of(JSONObject.of("name", "amount", "type", Parameter.TYPE_NUMBER)))));
    JSONObject binding = JSONObject.of("name", "First", "description", "", "matchQuestions", new JSONArray(),
        "parameters", new JSONObject());
    values.put("bindings", JSONArray.of(binding));

    List<ObjectNode> missing = draftErrors(values);
    assertError(missing, "/bindings", "invalid_object");
    assertTrue(missing.get(0).get("message").asText().contains("Missing parameter: amount"));

    binding.put("parameters", JSONObject.of("amount", "not a number"));
    List<ObjectNode> wrongType = draftErrors(values);
    assertError(wrongType, "/bindings", "invalid_object");
    assertTrue(wrongType.get(0).get("message").asText().contains("Parameter 'amount' requires TYPE_NUMBER"));
  }

  private List<ObjectNode> draftErrors(JSONObject values) {
    JSONObject request = JSONObject.of("target", JSONObject.of("kind", "draft"));
    request.put("values", values);
    request.put("changedField", null);
    PanelFormException error = assertThrows(PanelFormException.class, () -> service.form(request, "en", "domain-a"));
    assertEquals("Invalid MetricView draft", error.getMessage());
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
        "kind", "object", "objectType", "platform:MetricView", "primaryKey", id));
  }

  private void stubMetric(MetricView metric) {
    when(metricViewDao.queryById("m1", "domain-a")).thenReturn(new Object[]{copyMetric(metric), metric.getFunction().getId()});
    when(functionDao.queryById(metric.getFunction().getId())).thenAnswer(call -> copyFunction(metric.getFunction()));
  }

  private MetricView metric() {
    Function function = new Function();
    function.setId("f1");
    function.setName("Revenue function");
    function.setOrigin(Function.ORIGIN_USER);
    function.setOperation(Function.OPERATION_READ);
    function.setDomainId("domain-a");
    function.setQueryPackage(JSONObject.of("manifest", JSONObject.of("parameterDefs", JSONArray.of(
        JSONObject.of("name", "amount", "type", Parameter.TYPE_NUMBER),
        JSONObject.of("name", "labels", "type", Parameter.TYPE_STRING_ARRAY)))));
    ReturnDef returnDef = new ReturnDef();
    returnDef.setColumnLabels(JSONObject.of("amount", "Amount"));
    function.setReturnDef(returnDef);
    function.setLogic("Sum the amounts");
    MetricView metric = new MetricView();
    metric.setId("m1");
    metric.setName("Revenue");
    metric.setDescription("Revenue by amount");
    metric.setOrigin(MetricView.ORIGIN_USER);
    metric.setStatus(MetricView.STATUS_PUBLISHED);
    metric.setDomainId("domain-a");
    metric.setMatchQuestions(new HashSet<>(Set.of("revenue")));
    metric.setBindings(new ArrayList<>(List.of(binding())));
    metric.setFunction(function);
    metric.setCreatedBy("u1");
    return metric;
  }

  private MetricViewBinding binding() {
    MetricViewBinding binding = new MetricViewBinding();
    binding.setId("b1");
    binding.setName("First");
    binding.setDescription("");
    binding.setMatchQuestions(new HashSet<>());
    binding.setParameters(JSONObject.of("amount", 10, "labels", List.of("a")));
    return binding;
  }

  private static MetricView copyMetric(MetricView metric) {
    return JSON.parseObject(
        JSON.toJSONString(metric, com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue), MetricView.class);
  }

  private static Function copyFunction(Function function) {
    return JSON.parseObject(
        JSON.toJSONString(function, com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue), Function.class);
  }

  private static JSONObject asset(Object value) {
    return JSON.parseObject(JSON.toJSONString(value, com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue));
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
