package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.agent.AgentRuntimeClient;
import io.ontomato.dataengine.service.agent.OntologyAgentStore;
import io.ontomato.dataengine.util.CodeHashUtil;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** A draft is the generation-time snapshot: saving it must never ask the explain agent again. */
class ActionDraftServiceTest {
  OntologyAgentStore store;
  AgentRuntimeClient runtime;
  AdminService admin;
  ActionServiceImpl actions;
  LangService lang;
  IdentityService identity;
  FunctionDao functions;
  ActionDao actionDao;
  ActionDraftService service;
  final String code = "# ontomato-python:2\nprint('ok')\n";

  @BeforeEach
  void setup() {
    store = mock(OntologyAgentStore.class);
    runtime = mock(AgentRuntimeClient.class);
    admin = mock(AdminService.class);
    actions = mock(ActionServiceImpl.class);
    lang = mock(LangService.class);
    identity = mock(IdentityService.class);
    functions = mock(FunctionDao.class);
    actionDao = mock(ActionDao.class);
    service =
        new ActionDraftService(store, runtime, admin, actions, lang, identity, functions, actionDao);
    User user = mock(User.class);
    when(user.getId()).thenReturn("fixture-user");
    when(user.getDomainId()).thenReturn("fixture-domain");
    when(identity.getCurrentUser()).thenReturn(user);
  }

  private Action actionWith(String source) {
    Function function = new Function();
    function.setName("ship order");
    function.setOperation(Function.OPERATION_WRITE);
    function.setCode(source);
    Action action = new Action();
    action.setName("ship order");
    action.setOrigin(Action.ORIGIN_USER);
    action.setDomainId("fixture-domain");
    action.setFunction(function);
    action.setCodeHash(CodeHashUtil.sha256(source));
    action.setExplanationVersion(Action.EXPLANATION_VERSION);
    return action;
  }

  private JSONObject row(Action action, String program, String expiresAt, String consumedAt) {
    return JSONObject.of(
        "id", UUID.randomUUID().toString(),
        "action", action,
        "program", program,
        "code_hash", CodeHashUtil.sha256(program),
        "expires_at", expiresAt,
        "consumed_at", consumedAt);
  }

  @Test
  void saveUsesTheStoredSnapshotWithoutExplainingAgain() throws Exception {
    Action action = actionWith(code);
    JSONObject row = row(action, code, Instant.now().plusSeconds(3600).toString(), null);
    when(store.one(anyString(), any(), any(), any())).thenReturn(row);
    when(functions.save(any())).thenAnswer(call -> call.getArgument(0));
    when(actionDao.save(any())).thenAnswer(call -> call.getArgument(0));

    Action saved = service.save(UUID.randomUUID().toString(), "en");

    assertNotNull(saved);
    verify(actions, never()).explainForDraft(any(), any());
    verify(functions).save(any());
    verify(actionDao).save(any());
  }

  @Test
  void saveRejectsAConsumedDraft() {
    Action action = actionWith(code);
    JSONObject row =
        row(action, code, Instant.now().plusSeconds(3600).toString(), Instant.now().toString());
    when(store.one(anyString(), any(), any(), any())).thenReturn(row);

    AgentHttpException error =
        assertThrows(AgentHttpException.class, () -> service.save(UUID.randomUUID().toString(), "en"));
    assertEquals("DRAFT_CONSUMED", error.code());
  }

  @Test
  void saveRejectsAnExpiredDraft() {
    Action action = actionWith(code);
    JSONObject row = row(action, code, Instant.now().minusSeconds(1).toString(), null);
    when(store.one(anyString(), any(), any(), any())).thenReturn(row);

    AgentHttpException error =
        assertThrows(AgentHttpException.class, () -> service.save(UUID.randomUUID().toString(), "en"));
    assertEquals("DRAFT_EXPIRED", error.code());
  }

  @Test
  void saveRejectsAProgramThatNoLongerMatchesTheDraftCode() throws Exception {
    Action action = actionWith(code);
    JSONObject row =
        row(action, code + "# changed\n", Instant.now().plusSeconds(3600).toString(), null);
    when(store.one(anyString(), any(), any(), any())).thenReturn(row);

    AgentHttpException error =
        assertThrows(AgentHttpException.class, () -> service.save(UUID.randomUUID().toString(), "en"));
    assertEquals("DRAFT_CHANGED", error.code());
    verify(actions, never()).explainForDraft(any(), any());
  }

  @Test
  void createReturnsNoDraftWhenTheTurnDidNotWriteAResult() throws Exception {
    when(store.run(anyString(), anyString(), any())).thenReturn(JSONObject.of("id", "run"));
    when(store.one(anyString(), any())).thenReturn(JSONObject.of("run_id", "run"));
    when(runtime.run(anyString(), anyString()))
        .thenReturn(JSONObject.of("run", JSONObject.of("status", "stopped", "stopReason", "stop")));
    when(runtime.json(any(), anyString(), anyString(), anyString(), any(), any()))
        .thenReturn(JSONObject.of("artifacts", List.of()));

    JSONObject result =
        service.create(UUID.randomUUID().toString(), UUID.randomUUID().toString(), "en");

    assertTrue(result.getBooleanValue("noDraft"));
    assertNull(result.get("draftId"));
    verify(actions, never()).explainForDraft(any(), any());
  }
}
