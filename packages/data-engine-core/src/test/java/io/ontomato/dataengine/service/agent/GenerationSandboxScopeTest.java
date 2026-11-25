package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.service.SandboxService;
import io.ontomato.dataengine.service.agent.OntologyAgentStore.Owner;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;

class GenerationSandboxScopeTest {
  private final Owner owner = new Owner("admin", "xingongV2");
  private final OntologyAgentStore store = mock(OntologyAgentStore.class);
  private final JSONRuleDao rules = mock(JSONRuleDao.class);
  private final SandboxService sandbox = mock(SandboxService.class);
  private final GenerationOperations operations =
      new GenerationOperations(store, rules, sandbox, null, null, null, null, null, null);

  @Test
  void onlyExplicitlyRequestedClassesGetTablesAtGateOpen() {
    stubDomainRule();
    List<String> authorized = List.of("workflow_run", "student", "unrelated");
    var classes = operations.sandboxClasses(owner.domainId(), List.of("/workflow_run"), authorized);

    operations.createSandbox("run", owner.domainId(), classes);

    assertTables(List.of("workflow_run"));
    assertEquals(403, assertThrows(AgentHttpException.class, () ->
        operations.sandboxClasses(owner.domainId(), List.of("unrelated"), List.of("workflow_run"))).status());
  }

  @Test
  void anEmptyGateWaitsForTheTargetAndSampleDeclarations() throws Exception {
    operations.createSandbox("run", owner.domainId(), List.of());
    verifyNoInteractions(sandbox);
    stubDomainRule();
    when(store.transaction(any())).thenAnswer(call -> call.<Supplier<?>>getArgument(0).get());
    when(sandbox.validateSample(any(), eq(Map.of()), eq(owner.domainId()))).thenAnswer(call -> call.getArgument(0));
    var row = JSONObject.of("kind", "action", "sandbox_id", "run");
    var window = new GenerationOperations.Window("run", owner, "action", () -> row, null,
        samples -> row.put("test_data", samples), () -> {}, null);
    var input = JSONObject.of("classNames", List.of("workflow_run"),
        "objDatas", JSONArray.of(JSONObject.of("className", "student", "rows", new JSONArray())),
        "relDatas", new JSONArray());

    operations.storeSamples(window, operations.authorSamples(owner.domainId(), input, List.of()));

    assertTables(List.of("student", "workflow_run"));
  }

  private void stubDomainRule() {
    when(rules.query(owner.domainId())).thenReturn(Map.of("classDef", List.of(
        Map.of("className", "workflow_run"), Map.of("className", "student"), Map.of("className", "unrelated"))));
  }

  private void assertTables(List<String> expected) {
    var structure = org.mockito.ArgumentCaptor.forClass(JSONObject.class);
    verify(sandbox).createSampleStructure(eq("run"), structure.capture(), eq(owner.domainId()));
    assertEquals(expected, structure.getValue().getJSONArray("objDatas").toJavaList(JSONObject.class).stream()
        .map(cls -> cls.getString("className")).toList());
  }
}
