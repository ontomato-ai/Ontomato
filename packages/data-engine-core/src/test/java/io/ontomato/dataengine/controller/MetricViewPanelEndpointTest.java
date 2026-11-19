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
import io.ontomato.dataengine.service.PanelFormException;
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
  void setStatusReportsEachItemAndRejectsAnEmptyListBeforeTheOwner() throws Exception {
    MetricView saved = new MetricView();
    saved.setId("m1");
    saved.setName("Revenue");
    saved.setStatus(MetricView.STATUS_PUBLISHED);
    when(metricViewService.setStatus(eq("domain"), anyList(), eq("PUBLISHED"), eq("en")))
        .thenReturn(List.of(
            new MetricViewService.StatusResult("m1", saved, null),
            new MetricViewService.StatusResult("m2", null, "MetricView not found")));

    JSONObject body = perform("/metricView/setStatus", """
        {"ids":["m1","m2"],"status":"PUBLISHED"}""");

    assertTrue(body.getBooleanValue("success"));
    JSONArray items = body.getJSONObject("data").getJSONArray("items");
    assertEquals("success", items.getJSONObject(0).getString("outcome"));
    assertEquals("Revenue", items.getJSONObject(0).getJSONObject("data").getString("name"));
    assertEquals("failure", items.getJSONObject(1).getString("outcome"));
    assertEquals("MetricView not found", items.getJSONObject(1).getJSONObject("error").getString("message"));
    verify(metricViewService).setStatus(eq("domain"), argThat(ids -> ids.equals(List.of("m1", "m2"))), eq("PUBLISHED"), eq("en"));

    clearInvocations(metricViewService);
    JSONObject rejected = perform("/metricView/setStatus", """
        {"ids":[],"status":"PUBLISHED"}""");
    assertFalse(rejected.getBooleanValue("success"));
    assertNotNull(rejected.getString("message"));
    verifyNoInteractions(metricViewService);
  }

  @Test
  void theFormEndpointReturnsStructuredFieldErrors() throws Exception {
    when(metricViewService.form(any(), eq("en"), eq("domain")))
        .thenThrow(new PanelFormException("Invalid MetricView draft",
            List.of(FormFields.error("/name", "required", "name is required"))));

    JSONObject body = perform("/metricView/form", """
        {"target":{"kind":"draft"},"changedField":null}""");

    assertFalse(body.getBooleanValue("success"));
    assertEquals("Invalid MetricView draft", body.getString("message"));
    JSONArray fields = body.getJSONArray("fields");
    assertEquals(1, fields.size());
    assertEquals("/name", fields.getJSONObject(0).getString("field"));
    assertEquals("required", fields.getJSONObject(0).getString("code"));
    assertEquals("name is required", fields.getJSONObject(0).getString("message"));
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
    JSONObject description = MetricViewForm.describe(values, false, null, "en", langService);
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
