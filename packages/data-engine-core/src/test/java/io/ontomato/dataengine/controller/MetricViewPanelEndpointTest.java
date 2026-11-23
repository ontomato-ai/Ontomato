package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.FormFields;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.MetricViewForm;
import io.ontomato.dataengine.service.MetricViewService;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.service.OwnerFieldRefusal;
import io.ontomato.dataengine.service.SubjectDirectory;
import io.ontomato.dataengine.service.agent.AgentExecutionScope;
import io.ontomato.dataengine.util.SpringBeanUtil;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** The panel endpoints reach the owner with Jackson-bound bodies and return the panel's envelope. */
class MetricViewPanelEndpointTest {
  private final MetricViewService metricViewService = mock(MetricViewService.class);
  private final SubjectDirectory subjectDirectory = mock(SubjectDirectory.class);
  private final LangService langService = mock(LangService.class);
  private final MetricViewController controller =
      new MetricViewController(mock(AgentExecutionScope.class));

  @BeforeEach
  void setup() {
    User user = mock(User.class);
    when(user.getId()).thenReturn("reviewer");
    when(user.getDomainId()).thenReturn("domain");
    IdentityService identityService = mock(IdentityService.class);
    when(identityService.getCurrentUser()).thenReturn(user);
    GenericApplicationContext context = new GenericApplicationContext();
    context.registerBean(IdentityService.class, () -> identityService);
    context.refresh();
    new SpringBeanUtil().setApplicationContext(context);
    ReflectionTestUtils.setField(controller, "identityService", identityService);
    ReflectionTestUtils.setField(controller, "metricViewService", metricViewService);
    ReflectionTestUtils.setField(controller, "subjectDirectory", subjectDirectory);
    ReflectionTestUtils.setField(controller, "langService", langService);
    ReflectionTestUtils.setField(controller, "objectMapper", new ObjectMapper());
    when(langService.get(anyString(), anyString())).thenAnswer(call -> call.getArgument(1));
  }

  @Test
  void theListCarriesTheCreatorsAndReviewersDisplayNames() throws Exception {
    MetricView first = new MetricView();
    first.setId("m1");
    first.setName("Revenue");
    first.setStatus(MetricView.STATUS_PUBLISHED);
    first.setOrigin(MetricView.ORIGIN_USER);
    first.setCreatedBy("u1");
    first.setReviewedBy("u2");
    MetricView second = new MetricView();
    second.setId("m2");
    second.setName("Orders");
    second.setStatus(MetricView.STATUS_UNUSED);
    second.setOrigin(MetricView.ORIGIN_SYSTEM);
    second.setCreatedBy("u3");
    when(metricViewService.queryList(isNull(), isNull(), isNull(), eq("domain"))).thenReturn(List.of(first, second));
    when(subjectDirectory.subjectsInDomain("domain")).thenReturn(List.of(
        new SubjectDirectory.Subject("u1", "alice", "Alice", Set.of()),
        new SubjectDirectory.Subject("u2", "bob", null, Set.of())));

    JSONObject body = perform("/metricView/queryList", "{}");

    JSONArray data = body.getJSONArray("data");
    assertEquals("Alice", data.getJSONObject(0).getString("createdByName"));
    assertEquals("bob", data.getJSONObject(0).getString("reviewedByName"));
    assertEquals("Revenue", data.getJSONObject(0).getString("name"));
    assertEquals(MetricView.STATUS_PUBLISHED, data.getJSONObject(0).getString("status"));
    assertEquals(MetricView.ORIGIN_USER, data.getJSONObject(0).getString("origin"));
    assertEquals("PanelForm.status.published", data.getJSONObject(0).getString("statusLabel"));
    assertEquals("PanelForm.origin.user", data.getJSONObject(0).getString("originLabel"));
    assertEquals("PanelForm.status.unused", data.getJSONObject(1).getString("statusLabel"));
    assertEquals("PanelForm.origin.system", data.getJSONObject(1).getString("originLabel"));
    assertTrue(data.getJSONObject(1).containsKey("createdByName"));
    assertNull(data.getJSONObject(1).get("createdByName"));
    assertNull(data.getJSONObject(1).get("reviewedByName"));
    verify(subjectDirectory, times(1)).subjectsInDomain("domain");
  }

  @Test
  void theListFiltersByOriginWhenProvided() throws Exception {
    MetricView userMetric = new MetricView();
    userMetric.setId("m1");
    userMetric.setName("Revenue");
    userMetric.setStatus(MetricView.STATUS_PUBLISHED);
    userMetric.setOrigin(MetricView.ORIGIN_USER);
    MetricView systemMetric = new MetricView();
    systemMetric.setId("m2");
    systemMetric.setName("System metric");
    systemMetric.setStatus(MetricView.STATUS_PUBLISHED);
    systemMetric.setOrigin(MetricView.ORIGIN_SYSTEM);
    when(metricViewService.queryList(eq(MetricView.STATUS_PUBLISHED), isNull(), isNull(), eq("domain")))
        .thenReturn(List.of(userMetric, systemMetric));
    when(subjectDirectory.subjectsInDomain("domain")).thenReturn(List.of());

    JSONObject body = perform("/metricView/queryList", """
        {"status":"PUBLISHED","origin":"SYSTEM"}""");

    JSONArray data = body.getJSONArray("data");
    assertEquals(1, data.size());
    assertEquals("m2", data.getJSONObject(0).getString("id"));
  }

  @Test
  void aSingleReadCarriesTheCreatorsAndReviewersDisplayNames() throws Exception {
    when(metricViewService.queryById("m1", "domain")).thenReturn(displayMetric());
    stubSubjects();

    JSONObject body = perform("/metricView/queryById", """
        {"id":"m1"}""");

    JSONObject data = body.getJSONObject("data");
    assertEquals("Alice", data.getString("createdByName"));
    assertEquals("bob", data.getString("reviewedByName"));
    assertEquals("PanelForm.status.published", data.getString("statusLabel"));
    assertEquals("PanelForm.origin.user", data.getString("originLabel"));
  }

  @Test
  void aSaveReturnsTheCreatorsAndReviewersDisplayNames() throws Exception {
    when(metricViewService.save(any(), eq("en"))).thenReturn(displayMetric());
    stubSubjects();

    JSONObject body = perform("/metricView/save", """
        {"name":"Revenue","function":{"name":"calc","operation":"OPERATION_READ"}}""");

    JSONObject data = body.getJSONObject("data");
    assertEquals("Alice", data.getString("createdByName"));
    assertEquals("bob", data.getString("reviewedByName"));
    assertEquals("PanelForm.status.published", data.getString("statusLabel"));
    assertEquals("PanelForm.origin.user", data.getString("originLabel"));
  }

  @Test
  void aSaveThatNamesItsSubmittedFieldsKeepsEveryOtherSavedValue() throws Exception {
    MetricView stored = displayMetric();
    stored.setDescription("Monthly revenue");
    stored.setMatchQuestions(new java.util.HashSet<>(Set.of("revenue")));
    io.ontomato.dataengine.bean.function.Function function = new io.ontomato.dataengine.bean.function.Function();
    function.setId("f1");
    function.setName("revenue_query");
    function.setOperation(io.ontomato.dataengine.bean.function.Function.OPERATION_READ);
    function.setLogic("Sum the amounts");
    stored.setFunction(function);
    when(metricViewService.queryById("m1", "domain")).thenReturn(stored);
    when(metricViewService.save(any(), eq("en"))).thenReturn(displayMetric());
    stubSubjects();

    JSONObject body = perform("/metricView/save", """
        {"id":"m1","description":"Weekly revenue","submittedFields":["/description"]}""");

    assertTrue(body.getBooleanValue("success"), body.toJSONString());
    org.mockito.ArgumentCaptor<MetricView> saved = org.mockito.ArgumentCaptor.forClass(MetricView.class);
    verify(metricViewService).save(saved.capture(), eq("en"));
    assertEquals("m1", saved.getValue().getId());
    assertEquals("Revenue", saved.getValue().getName());
    assertEquals("Weekly revenue", saved.getValue().getDescription());
    assertEquals(Set.of("revenue"), saved.getValue().getMatchQuestions());
    assertEquals("revenue_query", saved.getValue().getFunction().getName());
    assertEquals("Sum the amounts", saved.getValue().getFunction().getLogic());

    when(metricViewService.queryById("gone", "domain")).thenReturn(null);
    JSONObject missing = perform("/metricView/save", """
        {"id":"gone","name":"x","submittedFields":["/name"]}""");
    assertEquals("METRIC_VIEW_NOT_FOUND", missing.getString("code"));
  }

  @Test
  void setStatusReportsEachItemAndRejectsAnEmptyListBeforeTheOwner() throws Exception {
    MetricView saved = new MetricView();
    saved.setId("m1");
    saved.setName("Revenue");
    saved.setStatus(MetricView.STATUS_PUBLISHED);
    when(metricViewService.setStatus(eq("domain"), anyList(), eq("PUBLISHED"), eq("en")))
        .thenReturn(List.of(
            new MetricViewService.StatusResult("m1", saved, null, null),
            new MetricViewService.StatusResult("m2", null, null, "MetricView read Function is missing or belongs to another domain"),
            new MetricViewService.StatusResult("m3", null,
                new OwnerRefusal("METRIC_VIEW_SYSTEM", "Cannot modify a system MetricView"), null)));

    JSONObject body = perform("/metricView/setStatus", """
        {"ids":["m1","m2","m3"],"status":"PUBLISHED"}""");

    assertTrue(body.getBooleanValue("success"));
    JSONArray items = body.getJSONObject("data").getJSONArray("items");
    assertEquals("success", items.getJSONObject(0).getString("outcome"));
    assertEquals("Revenue", items.getJSONObject(0).getJSONObject("data").getString("name"));
    assertEquals("failure", items.getJSONObject(1).getString("outcome"));
    assertFalse(items.getJSONObject(1).containsKey("code"));
    assertEquals("MetricView read Function is missing or belongs to another domain",
        items.getJSONObject(1).getJSONObject("error").getString("message"));
    assertEquals("refusal", items.getJSONObject(2).getString("outcome"));
    assertEquals("m3", items.getJSONObject(2).getString("id"));
    assertEquals("METRIC_VIEW_SYSTEM", items.getJSONObject(2).getString("code"));
    assertEquals("Cannot modify a system MetricView", items.getJSONObject(2).getJSONObject("error").getString("message"));
    verify(metricViewService).setStatus(eq("domain"), argThat(ids -> ids.equals(List.of("m1", "m2", "m3"))), eq("PUBLISHED"), eq("en"));

    clearInvocations(metricViewService);
    JSONObject rejected = perform("/metricView/setStatus", """
        {"ids":[],"status":"PUBLISHED"}""");
    assertFalse(rejected.getBooleanValue("success"));
    assertEquals("METRIC_VIEW_STATUS_INVALID", rejected.getString("code"));
    assertNotNull(rejected.getString("message"));
    verifyNoInteractions(metricViewService);
  }

  @Test
  void aRefusalIsAnEnvelopeCodeWhileAFailureKeepsAMessageOnly() throws Exception {
    when(metricViewService.save(any(), eq("en")))
        .thenThrow(new OwnerRefusal("METRIC_VIEW_SYSTEM", "Cannot modify a system MetricView"));
    JSONObject refused = perform("/metricView/save", """
        {"name":"Revenue","function":{"name":"calc","operation":"OPERATION_READ"}}""");
    assertFalse(refused.getBooleanValue("success"));
    assertEquals("METRIC_VIEW_SYSTEM", refused.getString("code"));
    assertEquals("Cannot modify a system MetricView", refused.getString("message"));

    when(metricViewService.save(any(), eq("en"))).thenThrow(new IllegalStateException("execution failed"));
    JSONObject failed = perform("/metricView/save", """
        {"name":"Revenue","function":{"name":"calc","operation":"OPERATION_READ"}}""");
    assertFalse(failed.getBooleanValue("success"));
    assertFalse(failed.containsKey("code"));
    assertEquals("execution failed", failed.getString("message"));
  }

  @Test
  void theSaveAndTestEndpointsRefuseARetiredTypeWithItsCode() throws Exception {
    JSONObject saved = perform("/metricView/save", """
        {"type":"STATIC","name":"Revenue","function":{"name":"calc","operation":"OPERATION_READ"}}""");
    assertFalse(saved.getBooleanValue("success"));
    assertEquals("METRIC_VIEW_TYPE_RETIRED", saved.getString("code"));

    JSONObject tested = perform("/metricView/test", """
        {"type":"STATIC","name":"Revenue","function":{"name":"calc","operation":"OPERATION_READ"}}""");
    assertFalse(tested.getBooleanValue("success"));
    assertEquals("METRIC_VIEW_TYPE_RETIRED", tested.getString("code"));
  }

  @Test
  void theSingleReadRefusesAMetricOutsideThisDomain() throws Exception {
    when(metricViewService.queryById("missing", "domain")).thenReturn(null);

    JSONObject body = perform("/metricView/queryById", """
        {"id":"missing"}""");

    assertFalse(body.getBooleanValue("success"));
    assertEquals("METRIC_VIEW_NOT_FOUND", body.getString("code"));
    assertEquals("MetricView.notFound", body.getString("message"));
  }

  @Test
  void theFormEndpointReportsAnOwnerRefusalWithItsCode() throws Exception {
    when(metricViewService.form(any(), eq("en"), eq("domain")))
        .thenThrow(new OwnerRefusal("METRIC_VIEW_NOT_FOUND", "MetricView not found"));

    JSONObject body = perform("/metricView/form", """
        {"target":{"kind":"object","objectType":"platform:MetricView","primaryKey":"missing"},"changedField":null}""");

    assertFalse(body.getBooleanValue("success"));
    assertEquals("METRIC_VIEW_NOT_FOUND", body.getString("code"));
    assertEquals("MetricView not found", body.getString("message"));
    assertFalse(body.containsKey("fields"));
  }

  @Test
  void aDraftsFieldErrorsAreASuccessfulFormRead() throws Exception {
    JSONObject values = MetricViewForm.defaults();
    JSONObject description = MetricViewForm.describe(values,
        List.of(FormFields.error("/name", "required", "name is required")), false, null, "en", langService);
    when(metricViewService.form(any(), eq("en"), eq("domain"))).thenReturn(description);

    JSONObject body = perform("/metricView/form", """
        {"target":{"kind":"draft"},"values":{"name":""},"changedField":null}""");

    assertTrue(body.getBooleanValue("success"));
    JSONArray errors = body.getJSONObject("data").getJSONArray("errors");
    assertEquals(1, errors.size());
    assertEquals("/name", errors.getJSONObject(0).getString("field"));
    assertEquals("required", errors.getJSONObject(0).getString("code"));
    assertEquals("name is required", errors.getJSONObject(0).getString("message"));
  }

  @Test
  void aSaveRefusedAtAFieldCarriesTheFieldError() throws Exception {
    when(metricViewService.save(any(), eq("en"))).thenThrow(new OwnerFieldRefusal(
        "METRIC_VIEW_BINDING_INVALID", "/bindings", "invalid_object", "Binding 'First': Missing parameter: amount"));

    JSONObject body = perform("/metricView/save", """
        {"name":"Revenue","function":{"name":"calc","operation":"OPERATION_READ"}}""");

    assertFalse(body.getBooleanValue("success"));
    assertEquals("METRIC_VIEW_BINDING_INVALID", body.getString("code"));
    JSONArray errors = body.getJSONArray("errors");
    assertEquals(1, errors.size());
    assertEquals("/bindings", errors.getJSONObject(0).getString("field"));
    assertEquals("invalid_object", errors.getJSONObject(0).getString("code"));
    assertEquals("Binding 'First': Missing parameter: amount", errors.getJSONObject(0).getString("message"));
  }

  @Test
  void theFormEndpointsAreDeclaredAsReadsAndSetStatusIsNot() throws Exception {
    assertEquals(BuildTestAccess.Access.NO_BUSINESS_DATA,
        MetricViewController.class.getMethod("form", String.class, JSONObject.class)
            .getAnnotation(BuildTestAccess.class).value());
    assertEquals(BuildTestAccess.Access.NO_BUSINESS_DATA,
        FunctionController.class.getMethod("form", String.class, JSONObject.class)
            .getAnnotation(BuildTestAccess.class).value());
    assertNull(MetricViewController.class.getMethod("setStatus", String.class, JSONObject.class)
        .getAnnotation(BuildTestAccess.class));
  }

  @Test
  void theFormEndpointReturnsTheOwnersDescription() throws Exception {
    when(metricViewService.form(any(), eq("en"), eq("domain"))).thenReturn(JSONObject.of(
        "values", JSONObject.of("name", "Revenue"), "fields", new JSONArray(), "save", JSONObject.of("path", "/metricView/save")));

    JSONObject body = perform("/metricView/form", """
        {"target":{"kind":"object","objectType":"platform:MetricView","primaryKey":"m1"},"changedField":null}""");

    assertTrue(body.getBooleanValue("success"));
    assertEquals("Revenue", body.getJSONObject("data").getJSONObject("values").getString("name"));
  }

  @Test
  void theDescriptionKeepsTheContractsNullOptionKeysThroughJackson() throws Exception {
    LangService langService = mock(LangService.class);
    when(langService.get(anyString(), anyString())).thenAnswer(call -> call.getArgument(1));
    JSONObject values = MetricViewForm.defaults();
    values.getJSONObject("function").put("queryPackage", JSONObject.of("manifest", JSONObject.of(
        "parameterDefs", JSONArray.of(JSONObject.of("name", "amount", "type", "TYPE_NUMBER")))));
    JSONObject description = MetricViewForm.describe(values, List.of(), false, null, "en", langService);
    when(metricViewService.form(any(), eq("en"), eq("domain"))).thenReturn(description);

    JSONObject body = perform("/metricView/form", """
        {"target":{"kind":"draft"},"changedField":null}""");

    JSONObject status = field(body.getJSONObject("data"), "/status");
    JSONObject option = status.getJSONObject("control").getJSONArray("options").getJSONObject(0);
    assertTrue(option.containsKey("description"));
    assertNull(option.get("description"));
    assertTrue(option.containsKey("disabledReason"));
    assertNull(option.get("disabledReason"));
    assertFalse(option.getBooleanValue("disabled"));
    JSONObject defaultItem = field(body.getJSONObject("data"), "/bindings")
        .getJSONObject("control").getJSONObject("defaultItem");
    assertTrue(defaultItem.getJSONObject("parameters").containsKey("amount"));
    assertNull(defaultItem.getJSONObject("parameters").get("amount"));
  }

  private MetricView displayMetric() {
    MetricView metric = new MetricView();
    metric.setId("m1");
    metric.setName("Revenue");
    metric.setStatus(MetricView.STATUS_PUBLISHED);
    metric.setOrigin(MetricView.ORIGIN_USER);
    metric.setCreatedBy("u1");
    metric.setReviewedBy("u2");
    return metric;
  }

  private void stubSubjects() {
    when(subjectDirectory.subjectsInDomain("domain")).thenReturn(List.of(
        new SubjectDirectory.Subject("u1", "alice", "Alice", Set.of()),
        new SubjectDirectory.Subject("u2", "bob", null, Set.of())));
  }

  private static JSONObject field(JSONObject form, String path) {
    for (Object item : form.getJSONArray("fields"))
      if (path.equals(((JSONObject) item).getString("path"))) return (JSONObject) item;
    throw new AssertionError("No field " + path);
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
