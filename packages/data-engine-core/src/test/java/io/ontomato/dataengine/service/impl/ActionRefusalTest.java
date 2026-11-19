package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.service.agent.OntologyGenerationService;
import io.ontomato.dataengine.service.scheduling.OntologyScheduleReferences;
import java.util.ArrayList;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/** The action owner names its own business refusals; execution failures keep no code. */
class ActionRefusalTest {
  private static final String CODE = "# ontomato-python:2\nprint('ok')";

  private final ActionServiceImpl service = new ActionServiceImpl();
  private final ActionDao actionDao = mock(ActionDao.class);
  private final FunctionDao functionDao = mock(FunctionDao.class);
  private final LangService langService = mock(LangService.class);
  private final OntologyGenerationService generationService = mock(OntologyGenerationService.class);
  private final OntologyScheduleReferences scheduledReferences = mock(OntologyScheduleReferences.class);

  @BeforeEach
  void setup() {
    ReflectionTestUtils.setField(service, "actionDao", actionDao);
    ReflectionTestUtils.setField(service, "functionDao", functionDao);
    ReflectionTestUtils.setField(service, "langService", langService);
    ReflectionTestUtils.setField(service, "generationService", generationService);
    ReflectionTestUtils.setField(service, "scheduledReferences", scheduledReferences);
    when(langService.get(anyString(), anyString())).thenAnswer(call -> call.getArgument(1));
    when(scheduledReferences.referencesAction(anyString())).thenReturn(false);
  }

  @Test
  void refusesToModifyASystemAction() {
    Action stored = action("a1", Action.ORIGIN_SYSTEM, Action.STATUS_PENDING_REVIEW);
    when(actionDao.queryById("a1")).thenReturn(new Object[] {stored, "f-a1"});

    OwnerRefusal error = assertThrows(OwnerRefusal.class,
        () -> service.save(action("a1", Action.ORIGIN_USER, Action.STATUS_PENDING_REVIEW), null, null, "en"));

    assertEquals("ACTION_SYSTEM", error.code());
    assertEquals("Action.cannotModifySystem", error.getMessage());
  }

  @Test
  void refusesToChangeTheCodeOfAPublishedAction() {
    Action stored = action("a1", Action.ORIGIN_USER, Action.STATUS_PUBLISHED);
    stored.getFunction().setCode("# ontomato-python:2\nprint('old')");
    when(actionDao.queryById("a1")).thenReturn(new Object[] {stored, "f-a1"});
    when(functionDao.queryById("f-a1")).thenReturn(stored.getFunction());
    Action submitted = action("a1", Action.ORIGIN_USER, Action.STATUS_PUBLISHED);
    submitted.getFunction().setCode("# ontomato-python:2\nprint('new')");

    OwnerRefusal error = assertThrows(OwnerRefusal.class,
        () -> service.save(submitted, null, null, "en"));

    assertEquals("ACTION_PUBLISHED_FROZEN", error.code());
    assertEquals("Action.publishedIsFrozen", error.getMessage());
  }

  @Test
  void refusesToDeleteAnActionReferencedByAScheduledTask() {
    when(scheduledReferences.referencesAction("a1")).thenReturn(true);

    OwnerRefusal error = assertThrows(OwnerRefusal.class, () -> service.delete("a1", "en"));

    assertEquals("ACTION_REFERENCED", error.code());
    assertEquals("Action is referenced by a scheduled task", error.getMessage());
    verifyNoInteractions(actionDao, functionDao);
  }

  @Test
  void refusesToDeleteASystemAction() {
    Action stored = action("a1", Action.ORIGIN_SYSTEM, Action.STATUS_PENDING_REVIEW);
    when(actionDao.queryById("a1")).thenReturn(new Object[] {stored, "f-a1"});

    OwnerRefusal error = assertThrows(OwnerRefusal.class, () -> service.delete("a1", "en"));

    assertEquals("ACTION_SYSTEM", error.code());
    assertEquals("Action.cannotDeleteSystem", error.getMessage());
  }

  @Test
  void refusesAnInvalidDefinitionBeforeExplaining() {
    Action draft = action("new", Action.ORIGIN_USER, Action.STATUS_PENDING_REVIEW);
    draft.setId(null);
    draft.getFunction().setId(null);
    doThrow(new IllegalArgumentException("Action.target.className requires one primary key: /Order"))
        .when(actionDao).validateDefinition(any());

    OwnerRefusal error = assertThrows(OwnerRefusal.class,
        () -> service.save(draft, null, null, "en"));

    assertEquals("ACTION_DEFINITION_INVALID", error.code());
    assertEquals("Action.target.className requires one primary key: /Order", error.getMessage());
    verifyNoInteractions(generationService);
    verify(actionDao, never()).saveWithFunction(any(), anyString());
  }

  private static Action action(String id, String origin, String status) {
    Function function = new Function();
    function.setId("f-" + id);
    function.setName("Write order");
    function.setOrigin(Function.ORIGIN_USER);
    function.setOperation(Function.OPERATION_WRITE);
    function.setDomainId("domain-a");
    function.setCode(CODE);
    function.setParameters(new ArrayList<>());
    ReturnDef returnDef = new ReturnDef();
    returnDef.setIsVoid(true);
    function.setReturnDef(returnDef);
    Action action = new Action();
    action.setId(id);
    action.setName("Approve order");
    action.setOrigin(origin);
    action.setStatus(status);
    action.setDomainId("domain-a");
    action.setFunction(function);
    return action;
  }
}
