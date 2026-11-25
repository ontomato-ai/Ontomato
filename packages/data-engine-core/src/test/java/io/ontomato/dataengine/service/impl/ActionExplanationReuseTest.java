package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.scheduling.OntologyScheduleReferences;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.OwnerFieldRefusal;
import io.ontomato.dataengine.service.agent.OntologyAgentStore.Owner;
import io.ontomato.dataengine.service.agent.OntologyGenerationService;
import io.ontomato.dataengine.service.agent.OntologyAgentStore;
import java.util.function.Supplier;
import io.ontomato.dataengine.util.CodeHashUtil;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * A save that names an explanation accepted for an unsaved draft reuses it only for exactly that code and the current
 * explanation version; the platform's authoring path relies on this instead of explaining the same code twice.
 */
class ActionExplanationReuseTest {
  private static final String CODE = "# ontomato-python:2\nprint('ok')";
  private final ActionDao actions = mock(ActionDao.class);
  private final OntologyGenerationService generation = mock(OntologyGenerationService.class);
  private final ThreadLocal<Boolean> inTransaction = ThreadLocal.withInitial(() -> false);
  private final ActionServiceImpl service = new ActionServiceImpl();
  private final Owner owner = new Owner("user-a", "domain-a");
  private final JSONArray segments = JSONArray.of(JSONObject.of("id", "s1"));

  @BeforeEach
  void setup() {
    OntologyAgentStore store = mock(OntologyAgentStore.class);
    when(store.transaction(any())).thenAnswer(call -> {
      inTransaction.set(true);
      try {
        return call.<Supplier<?>>getArgument(0).get();
      } finally {
        inTransaction.remove();
      }
    });
    ReflectionTestUtils.setField(service, "store", store);
    ReflectionTestUtils.setField(service, "actionDao", actions);
    ReflectionTestUtils.setField(service, "generationService", generation);
    ReflectionTestUtils.setField(service, "langService", mock(LangService.class));
  }

  private Action draft() {
    var function = new Function();
    function.setOperation(Function.OPERATION_WRITE);
    function.setDomainId("domain-a");
    function.setCode(CODE);
    var action = new Action();
    action.setDomainId("domain-a");
    action.setStatus(Action.STATUS_PENDING_REVIEW);
    action.setFunction(function);
    return action;
  }

  private JSONObject evidence(String sourceDigest, int explanationVersion) {
    return JSONObject.of(
        "sourceDigest", sourceDigest,
        "explanationVersion", explanationVersion,
        "acceptedResultRef", "run-1",
        "acceptedResult", JSONObject.of(
            "codeSegments", segments,
            "businessMeaning", JSONObject.of("operations", List.of("Approve the expense"), "negativeEffect", "")));
  }

  @Test
  void reusesTheExplanationAcceptedForThisCode() throws Exception {
    when(generation.explanationEvidence("run-1", owner))
        .thenReturn(evidence(CodeHashUtil.sha256(CODE), Action.EXPLANATION_VERSION));
    when(actions.saveDraft(any(), anyString())).thenAnswer(call -> call.getArgument(0));

    Action saved = service.save(draft(), "run-1", owner, "en");

    assertEquals(Action.STATUS_PENDING_REVIEW, saved.getStatus());
    assertEquals(segments, saved.getCodeSegments());
    assertEquals(List.of("Approve the expense"), saved.getBusinessMeaning().getOperations());
    assertEquals(CodeHashUtil.sha256(CODE), saved.getCodeHash());
    assertEquals(Action.EXPLANATION_VERSION, saved.getExplanationVersion());
    verify(generation, never()).generate(anyString(), anyString(), anyString(), anyString(), anyString(), anyString());
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void backgroundExplanationUsesATransactionAndWritesOnlyForMatchingCode(boolean changedAgain) throws Exception {
    Action previous = draft();
    previous.setId("a1");
    previous.getFunction().setId("f1");
    previous.setCodeSegments(segments);
    previous.setCodeHash(CodeHashUtil.sha256(CODE));
    previous.setExplanationVersion(Action.EXPLANATION_VERSION);
    var current = new AtomicReference<>(previous);
    var functions = mock(FunctionDao.class);
    ReflectionTestUtils.setField(service, "functionDao", functions);
    ReflectionTestUtils.setField(service, "scheduledReferences", mock(OntologyScheduleReferences.class));
    doAnswer(call -> {
      assertTrue(inTransaction.get());
      return null;
    }).when(actions).lock("a1", "domain-a");
    when(actions.queryById("a1")).thenAnswer(call -> {
      assertTrue(inTransaction.get());
      return new Object[] {current.get(), "f1"};
    });
    doAnswer(call -> {
      assertTrue(inTransaction.get());
      return null;
    }).when(actions).updateExplanation(any());
    when(functions.queryById("f1")).thenAnswer(call -> current.get().getFunction());
    when(actions.saveDraft(any(), anyString())).thenAnswer(call -> {
      Action saved = call.getArgument(0);
      current.set(saved);
      return saved;
    });

    var admin = mock(AdminService.class);
    var lang = mock(LangService.class);
    ReflectionTestUtils.setField(service, "adminService", admin);
    ReflectionTestUtils.setField(service, "langService", lang);
    Map<String, Object> rule = Map.of("datasetdesc", "fixture", "classDef", List.of(), "relationship_rule", Map.of());
    when(admin.getJSONRule("domain-a")).thenReturn(rule);
    when(generation.authorizedRule(rule, "domain-a")).thenReturn(rule);
    when(lang.get("en", "lang")).thenReturn("English");

    var delivery = mock(OntologyGenerationService.Generation.class);
    when(delivery.result()).thenReturn(JSONObject.of("segs", JSONArray.of(JSONObject.of(
        "id", "s1", "kind", "COMPUTE", "title", "Calculate", "codeRange", JSONObject.of("start", 1, "end", 2)))));
    var completed = new CompletableFuture<Boolean>();
    when(delivery.settle(any())).thenAnswer(call -> {
      try {
        boolean written = call.<OntologyGenerationService.Work<Boolean>>getArgument(0).run();
        completed.complete(written);
        return written;
      } catch (AssertionError error) {
        completed.completeExceptionally(error);
        throw error;
      }
    });
    var finish = new CountDownLatch(1);
    when(generation.generate(eq("explain"), anyString(), anyString(), eq("en"), eq("domain-a"), anyString()))
        .thenAnswer(call -> {
          assertTrue(finish.await(5, TimeUnit.SECONDS));
          return delivery;
        });

    Action edited = draft();
    edited.setId("a1");
    edited.getFunction().setId("f1");
    edited.getFunction().setCode("# ontomato-python:2\nprint('edited')");
    edited.setCodeSegments(segments);
    try {
      Action saved = service.save(edited, null, owner, "en");
      assertTrue(saved.isAdopted());
      assertNull(saved.getCodeSegments());
      assertNull(saved.getBusinessMeaning());
      assertNull(saved.getCodeHash());
      assertNull(saved.getExplanationVersion());
      if (changedAgain) {
        Action newer = draft();
        newer.getFunction().setCode("# ontomato-python:2\nprint('newer')");
        current.set(newer);
      }
    } finally {
      finish.countDown();
    }
    assertEquals(!changedAgain, completed.get(5, TimeUnit.SECONDS));
    if (changedAgain) verify(actions, never()).updateExplanation(any());
    else verify(actions).updateExplanation(argThat(item -> CodeHashUtil.sha256(
        item.getFunction().getCode()).equals(item.getCodeHash())));
  }

  @Test
  void refusesAnExplanationAcceptedForOtherCode() {
    when(generation.explanationEvidence("run-1", owner))
        .thenReturn(evidence(CodeHashUtil.sha256("# ontomato-python:2\nprint('other')"), Action.EXPLANATION_VERSION));

    assertThrows(OwnerFieldRefusal.class, () -> service.save(draft(), "run-1", owner, "en"));
    verify(actions, never()).saveDraft(any(), anyString());
  }

  @Test
  void refusesAnExplanationOfAnOlderVersion() {
    when(generation.explanationEvidence("run-1", owner))
        .thenReturn(evidence(CodeHashUtil.sha256(CODE), Action.EXPLANATION_VERSION - 1));

    assertThrows(OwnerFieldRefusal.class, () -> service.save(draft(), "run-1", owner, "en"));
    verify(actions, never()).saveDraft(any(), anyString());
  }
}
