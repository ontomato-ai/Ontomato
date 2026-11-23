package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.trigger.Trigger;
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.TriggerDao;
import io.ontomato.dataengine.service.ActionService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.OwnerFieldRefusal;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.service.SubjectDirectory;
import io.ontomato.dataengine.service.TriggerService;
import io.ontomato.dataengine.service.WorkflowService;
import io.ontomato.dataengine.util.SpringBeanUtil;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** HTTP boundary tests for Trigger owner endpoints: display fields, form, refusals and domain isolation. */
class TriggerPanelEndpointTest {

  private final TriggerDao triggers = mock(TriggerDao.class);
  private final TriggerService service = mock(TriggerService.class);
  private final ActionService actionService = mock(ActionService.class);
  private final WorkflowService workflowService = mock(WorkflowService.class);
  private final SubjectDirectory subjectDirectory = mock(SubjectDirectory.class);
  private final LangService langService = mock(LangService.class);
  private final IdentityService identityService = mock(IdentityService.class);
  private final TriggerController controller = new TriggerController();
  private MockMvc mvc;

  @BeforeEach
  void setup() {
    User user = mock(User.class);
    when(user.getId()).thenReturn("u1");
    when(user.getDomainId()).thenReturn("domain");
    when(identityService.getCurrentUser()).thenReturn(user);
    GenericApplicationContext context = new GenericApplicationContext();
    context.registerBean(IdentityService.class, () -> identityService);
    context.refresh();
    new SpringBeanUtil().setApplicationContext(context);

    ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
    ReflectionTestUtils.setField(controller, "triggers", triggers);
    ReflectionTestUtils.setField(controller, "service", service);
    ReflectionTestUtils.setField(controller, "actionService", actionService);
    ReflectionTestUtils.setField(controller, "workflowService", workflowService);
    ReflectionTestUtils.setField(controller, "subjectDirectory", subjectDirectory);
    ReflectionTestUtils.setField(controller, "langService", langService);
    ReflectionTestUtils.setField(controller, "objectMapper", mapper);

    when(langService.get(anyString(), anyString())).thenAnswer(inv -> inv.getArgument(1));
    when(langService.get("en", "PanelForm.status.published")).thenReturn("Published");
    when(langService.get("en", "Trigger.condition.time")).thenReturn("Schedule");
    when(langService.get("en", "Trigger.effect.action")).thenReturn("Action");
    when(langService.get("en", "Trigger.cadence.daily")).thenReturn("Daily at {time}");
    when(subjectDirectory.subjectsInDomain("domain"))
        .thenReturn(List.of(new SubjectDirectory.Subject("u1", "alice", "Alice", Set.of())));
    Action act = new Action();
    act.setId("act-1");
    act.setName("Check stock");
    when(actionService.queryList(null, null, null, "domain")).thenReturn(List.of(act));
    Workflow wf = new Workflow();
    wf.setId("wf-1");
    wf.setName("Restock flow");
    when(workflowService.queryList(null, "domain")).thenReturn(List.of(wf));

    mvc = MockMvcBuilders.standaloneSetup(controller)
        .setMessageConverters(new MappingJackson2HttpMessageConverter(mapper))
        .build();
  }

  @Test
  void queryListIncludesOwnerDisplayFieldsAndIsoTimestamps() throws Exception {
    Trigger trigger = new Trigger();
    trigger.setId("tr-1");
    trigger.setDomainId("domain");
    trigger.setName("Nightly check");
    trigger.setStatus(Trigger.STATUS_PUBLISHED);
    trigger.setEnabled(true);
    trigger.setConditionKind(Trigger.CONDITION_TIME);
    trigger.setCondition(JSONObject.of(
        "frequency", JSONObject.of("kind", "daily", "time", "09:00"),
        "timeZone", "Asia/Shanghai"));
    trigger.setEffectKind(Trigger.EFFECT_ACTION);
    trigger.setEffect(JSONObject.of("actionId", "act-1", "parameters", new JSONObject()));
    trigger.setCreatedBy("u1");
    trigger.setReviewedBy("u1");
    trigger.setNextRunAt(Instant.parse("2026-11-23T01:00:00Z"));
    trigger.setLastFiredAt(Instant.parse("2026-11-22T01:00:00Z"));
    when(triggers.queryList("domain", null)).thenReturn(List.of(trigger));
    when(service.executorOf(trigger)).thenReturn("u1");

    String body = mvc.perform(post("/trigger/queryList")
            .header("lang", "en")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{}"))
        .andExpect(status().isOk())
        .andReturn().getResponse().getContentAsString();
    JSONObject json = JSON.parseObject(body);
    assertTrue(json.getBooleanValue("success"));
    JSONObject row = json.getJSONArray("data").getJSONObject(0);
    assertEquals("Daily at 09:00", row.getString("cadenceSummary"));
    assertEquals("Action · Check stock", row.getString("effectLabel"));
    assertEquals("Check stock", row.getString("effectTargetName"));
    assertEquals("Published", row.getString("statusLabel"));
    assertEquals("Alice", row.getString("createdByName"));
    assertEquals("Alice", row.getString("executorName"));
    assertEquals("2026-11-23T01:00:00Z", row.getString("nextRunAt"));
    assertEquals("2026-11-22T01:00:00Z", row.getString("lastFiredAt"));
  }

  @Test
  void saveAndRunSerializeOwnerFieldRefusalsAndRefusalCodes() throws Exception {
    when(service.saveDefinition(any(), any(), eq("en")))
        .thenThrow(new OwnerFieldRefusal("TRIGGER_INVALID", "/name", "required", "name is required"));

    String saveBody = mvc.perform(post("/trigger/save")
            .header("lang", "en")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"\"}"))
        .andExpect(status().isOk())
        .andReturn().getResponse().getContentAsString();
    JSONObject saveJson = JSON.parseObject(saveBody);
    assertFalse(saveJson.getBooleanValue("success"));
    assertEquals("TRIGGER_INVALID", saveJson.getString("code"));
    assertEquals("/name", saveJson.getJSONArray("errors").getJSONObject(0).getString("field"));

    when(triggers.queryById("missing")).thenReturn(null);
    String missingBody = mvc.perform(post("/trigger/queryById")
            .header("lang", "en")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"id\":\"missing\"}"))
        .andExpect(status().isOk())
        .andReturn().getResponse().getContentAsString();
    JSONObject missingJson = JSON.parseObject(missingBody);
    assertFalse(missingJson.getBooleanValue("success"));
    assertEquals("TRIGGER_NOT_FOUND", missingJson.getString("code"));

    String runBody = mvc.perform(post("/trigger/run")
            .header("lang", "en")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"id\":\"missing\"}"))
        .andExpect(status().isOk())
        .andReturn().getResponse().getContentAsString();
    JSONObject runJson = JSON.parseObject(runBody);
    assertFalse(runJson.getBooleanValue("success"));
    assertEquals("TRIGGER_NOT_FOUND", runJson.getString("code"));

    when(service.changeStatus(eq("tr-1"), eq("PUBLISHED"), eq(true), any(), eq("en")))
        .thenThrow(new OwnerRefusal("INTERACTIVE_LOGIN_REQUIRED", "Sign in interactively first"));
    String statusBody = mvc.perform(post("/trigger/status")
            .header("lang", "en")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"id\":\"tr-1\",\"status\":\"PUBLISHED\",\"enabled\":true}"))
        .andExpect(status().isOk())
        .andReturn().getResponse().getContentAsString();
    JSONObject statusJson = JSON.parseObject(statusBody);
    assertFalse(statusJson.getBooleanValue("success"));
    assertEquals("INTERACTIVE_LOGIN_REQUIRED", statusJson.getString("code"));
    assertNull(statusJson.get("errors"));
  }
}
