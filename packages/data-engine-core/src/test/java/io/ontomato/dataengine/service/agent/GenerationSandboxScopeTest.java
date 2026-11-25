package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.service.DataSandboxService;
import io.ontomato.dataengine.service.agent.OntologyAgentStore.Owner;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;

class GenerationSandboxScopeTest {
  private final Owner owner = new Owner("admin", "xingongV2");
  private final OntologyAgentStore store = mock(OntologyAgentStore.class);
  private final JSONRuleDao rules = mock(JSONRuleDao.class);
  private final DataSandboxService sandbox = mock(DataSandboxService.class);
  private final GenerationOperations operations =
      new GenerationOperations(store, rules, sandbox, null, null, null, null, null, null);

  @Test
  void onlyExplicitlyRequestedClassesGetTablesAtGateOpen() {
    stubDomainRule();
    List<String> authorized = List.of("workflow_run", "student", "unrelated");
    var classes = operations.sandboxClasses(owner.domainId(), List.of("/workflow_run"), authorized);

    operations.openSandbox("run", owner, 100L, classes);

    verify(sandbox).open(owner.domainId(), owner.userId(), "run", 100L, List.of("workflow_run"));
    assertEquals(403, assertThrows(AgentHttpException.class, () ->
        operations.sandboxClasses(owner.domainId(), List.of("unrelated"), List.of("workflow_run"))).status());
  }

  @Test
  void anEmptyGateWaitsForTheTargetAndSampleDeclarations() throws Exception {
    stubDomainRule();
    String runId = java.util.UUID.randomUUID().toString();
    when(store.transaction(any())).thenAnswer(call -> call.<Supplier<?>>getArgument(0).get());
    when(sandbox.open(owner.domainId(), owner.userId(), runId, 100L, List.of("student", "workflow_run")))
        .thenReturn("sb-1");
    when(sandbox.validateSample(any(), eq(Map.of()), eq(owner.domainId()))).thenAnswer(call -> call.getArgument(0));
    var row = JSONObject.of("kind", "action");
    var access = new io.ontomato.dataengine.service.QueryAccessService.Access(
        new io.ontomato.dataengine.service.QueryAccessService.GrantUser(owner.userId(), owner.domainId()),
        null, null, null, 100L, List.of());
    var window = new GenerationOperations.Window(runId, owner, "action", () -> row, access,
        () -> {}, null);
    var input = JSONObject.of("classNames", List.of("workflow_run"),
        "objDatas", JSONArray.of(JSONObject.of("className", "student", "rows", new JSONArray())),
        "relDatas", new JSONArray());

    operations.storeSamples(window, operations.authorSamples(owner.domainId(), input, List.of()));

    verify(sandbox).open(owner.domainId(), owner.userId(), runId, 100L, List.of("student", "workflow_run"));
    verify(store).update(eq("UPDATE ontology_generations SET sandbox_id=? WHERE run_id=?"), eq("sb-1"), eq(java.util.UUID.fromString(runId)));
    verify(sandbox).replaceClasses(eq("sb-1"), eq(List.of("student", "workflow_run")), any(), eq(owner.domainId()));
  }

  private void stubDomainRule() {
    when(rules.query(owner.domainId())).thenReturn(Map.of("classDef", List.of(
        Map.of("className", "workflow_run"), Map.of("className", "student"), Map.of("className", "unrelated"))));
  }

}
