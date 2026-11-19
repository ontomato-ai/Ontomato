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
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.FormFields;
import io.ontomato.dataengine.service.FunctionService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.PanelFormException;
import io.ontomato.dataengine.util.SpringBeanUtil;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** The function list's display names come from the owner in the request language. */
class FunctionPanelEndpointTest {
  private final FunctionService functionService = mock(FunctionService.class);
  private final LangService langService = mock(LangService.class);
  private final FunctionController controller = new FunctionController();

  @BeforeEach
  void setup() {
    User user = mock(User.class);
    when(user.getDomainId()).thenReturn("domain");
    IdentityService identityService = mock(IdentityService.class);
    when(identityService.getCurrentUser()).thenReturn(user);
    GenericApplicationContext context = new GenericApplicationContext();
    context.registerBean(IdentityService.class, () -> identityService);
    context.refresh();
    new SpringBeanUtil().setApplicationContext(context);
    ReflectionTestUtils.setField(controller, "functionService", functionService);
    ReflectionTestUtils.setField(controller, "langService", langService);
    ReflectionTestUtils.setField(controller, "objectMapper", new ObjectMapper());
    when(langService.get(anyString(), anyString())).thenAnswer(call -> call.getArgument(1));
  }

  @Test
  void theListCarriesTheOperationLabelAndKeepsTheFunctionFields() throws Exception {
    when(functionService.queryList(isNull(), isNull(), eq("domain"))).thenReturn(List.of(
        function("f1", "Revenue query", Function.OPERATION_READ),
        function("f2", "Write order", Function.OPERATION_WRITE),
        function("f3", "Product source", Function.OPERATION_PRODUCT)));

    JSONObject body = perform("/function/queryList", "{}");

    JSONArray data = body.getJSONArray("data");
    assertEquals("Revenue query", data.getJSONObject(0).getString("name"));
    assertEquals(Function.OPERATION_READ, data.getJSONObject(0).getString("operation"));
    assertEquals("PanelForm.operation.read", data.getJSONObject(0).getString("operationLabel"));
    assertEquals("PanelForm.operation.write", data.getJSONObject(1).getString("operationLabel"));
    assertEquals("PanelForm.operation.product", data.getJSONObject(2).getString("operationLabel"));
  }

  @Test
  void aSingleReadCarriesTheOperationLabel() throws Exception {
    when(functionService.queryById("f1")).thenReturn(function("f1", "Revenue query", Function.OPERATION_READ));

    JSONObject body = perform("/function/queryById", """
        {"id":"f1"}""");

    JSONObject data = body.getJSONObject("data");
    assertEquals(Function.OPERATION_READ, data.getString("operation"));
    assertEquals("PanelForm.operation.read", data.getString("operationLabel"));
  }

  @Test
  void aSaveReturnsTheOperationLabel() throws Exception {
    when(functionService.save(any(), eq("en"))).thenReturn(function("f1", "Revenue query", Function.OPERATION_READ));

    JSONObject body = perform("/function/save", """
        {"name":"Revenue query","operation":"OPERATION_READ"}""");

    JSONObject data = body.getJSONObject("data");
    assertEquals(Function.OPERATION_READ, data.getString("operation"));
    assertEquals("PanelForm.operation.read", data.getString("operationLabel"));
  }

  @Test
  void theFormEndpointReturnsStructuredFieldErrors() throws Exception {
    when(functionService.form(any(), eq("en"), eq("domain")))
        .thenThrow(new PanelFormException("Invalid Function draft",
            List.of(FormFields.error("/queryPackage", "required", "queryPackage is required"))));

    JSONObject body = perform("/function/form", """
        {"target":{"kind":"draft"},"changedField":null}""");

    assertFalse(body.getBooleanValue("success"));
    assertEquals("Invalid Function draft", body.getString("message"));
    JSONArray fields = body.getJSONArray("fields");
    assertEquals(1, fields.size());
    assertEquals("/queryPackage", fields.getJSONObject(0).getString("field"));
    assertEquals("required", fields.getJSONObject(0).getString("code"));
  }

  private Function function(String id, String name, String operation) {
    Function function = new Function();
    function.setId(id);
    function.setName(name);
    function.setOrigin(Function.ORIGIN_USER);
    function.setOperation(operation);
    function.setDomainId("domain");
    return function;
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
