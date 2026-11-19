package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.ActionService;
import io.ontomato.dataengine.service.FormFields;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.OwnerFieldRefusal;
import io.ontomato.dataengine.service.agent.AgentExecutionScope;
import io.ontomato.dataengine.util.SpringBeanUtil;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
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
  private final ActionController controller = new ActionController(mock(AgentExecutionScope.class));

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
    ReflectionTestUtils.setField(controller, "actionService", actionService);
    ReflectionTestUtils.setField(controller, "langService", langService);
    when(langService.get(anyString(), anyString())).thenAnswer(call -> call.getArgument(1));
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
