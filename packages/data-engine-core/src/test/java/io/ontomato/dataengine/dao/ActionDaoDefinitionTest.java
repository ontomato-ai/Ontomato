package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.action.ActionTarget;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.OwnerFieldRefusal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/** The action definition rules name the form value that refused the save. */
class ActionDaoDefinitionTest {
  private final ActionDao actionDao = new ActionDao();
  private final AdminService admin = mock(AdminService.class);

  @BeforeEach
  void setup() {
    ReflectionTestUtils.setField(actionDao, "admin", admin);
    when(admin.getJSONRule("domain-a")).thenReturn(Map.of("classDef", List.of(
        JSONObject.of("className", "/Order", "attrs", List.of(JSONObject.of("name", "orderNo", "enable", true, "primaryKey", true))))));
  }

  @Test
  void namesTheApprovalModeField() {
    Action action = new Action();
    action.setApprovalMode("sometimes");

    OwnerFieldRefusal error = assertThrows(OwnerFieldRefusal.class, () -> actionDao.validateDefinition(action));

    assertEquals("ACTION_DEFINITION_INVALID", error.code());
    assertEquals("/approvalMode", error.errors().get(0).get("field").asText());
    assertEquals("invalid_option", error.errors().get(0).get("code").asText());
  }

  @Test
  void namesTheTargetField() {
    Function function = new Function();
    function.setParameters(List.of());
    Action action = new Action();
    action.setDomainId("domain-a");
    action.setFunction(function);
    action.setTarget(new ActionTarget("/Missing", "orderNo"));

    OwnerFieldRefusal error = assertThrows(OwnerFieldRefusal.class, () -> actionDao.validateDefinition(action));

    assertEquals("ACTION_DEFINITION_INVALID", error.code());
    assertEquals("/target", error.errors().get(0).get("field").asText());
    assertEquals("invalid_object", error.errors().get(0).get("code").asText());
  }
}
