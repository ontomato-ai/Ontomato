package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.function.*;
import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.service.agent.GenerationOperations;
import io.ontomato.dataengine.service.sys.bean.permission.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

/** Cross-boundary package invariants without a database, runtime, model or network. */
class QueryPackageContractTest {
  private JSONObject bundle() throws Exception {
    try (var in = getClass().getResourceAsStream("/ontology-contracts/examples/query-packages.json")) {
      return JSON.parseObject(in.readAllBytes()).getJSONObject("pythonAggregate");
    }
  }
  private List<Map<String, Object>> definitions() {
    return List.of(JSONObject.of("className", "/Employee", "attrs", JSONArray.of(JSONObject.of("name", "salary", "type", "number"))));
  }
  private UserDataPermission permission() {
    var p = new UserDataPermission();
    var fields = new FieldPermission("/Employee");
    fields.getGroupableColumns().add("salary");
    p.addFieldPermission(fields);
    return p;
  }
  private QueryAccessService.Access access() {
    return new QueryAccessService.Access(new QueryAccessService.GrantUser("reader", "domain"), permission(), null, null, null, List.of("/Employee"));
  }

  @Test
  void pureDslDeliveryFreezesTheOneFilePackageWithoutRunningPython() throws Exception {
    var query = QueryPackage.query(bundle(), "employees");
    query.getJSONObject("answer").getJSONArray("steps").getJSONObject(0).getJSONObject("output").put("fields",
        JSONArray.of(JSONObject.of("variable", "e", "field", "*", "function", "COUNT", "as", "headcount")));
    var pkg = QueryPackage.fromDsl(query.toJSONString());
    var ontology = mock(OntologyQueryService.class);
    when(ontology.rule(any())).thenReturn(Map.of("classDef", definitions()));
    when(ontology.execute(any(), any())).thenReturn(Map.of("data",
        List.of(Map.of("answer", List.of(Map.of("headcount", 2))))));
    var python = mock(PythonExecuteService.class);
    var recipe = JSONObject.of("kind", "package", "package", pkg, "parameters", new JSONObject(),
        "columnLabels", JSONObject.of("headcount", "Employees"));
    var result = new QueryOutputService(python, null, ontology, null)
        .execute(UUID.randomUUID().toString(), recipe, null, access(), "en");
    assertEquals(2, result.getJSONArray("rows").getJSONObject(0).get("headcount"));
    assertEquals(pkg, result.getJSONObject("recipe").getJSONObject("package"));
    assertFalse(result.getJSONObject("recipe").getString("packageSha256").isEmpty());
    assertNotNull(result.getJSONObject("recipe").getString("executionInputSha256"));
    verifyNoInteractions(python);
  }

  @Test
  void modelNumericDefaultsAreNormalizedAtTheSameBoundaryAsLegacyParameters() throws Exception {
    var raw = bundle();
    var definitions = raw.getJSONObject("manifest").getJSONArray("parameterDefs");
    definitions.getJSONObject(0).put("value", "25");
    definitions.add(JSONObject.of("name", "codes", "type", "TYPE_STRING", "value", "025"));
    definitions.add(JSONObject.of("name", "amounts", "type", "TYPE_NUMBER_ARRAY", "value", JSONArray.of("2.5", "0")));
    var accepted = QueryPackage.accept(raw);
    var values = QueryPackage.parameters(accepted, null);
    assertInstanceOf(Number.class, values.get("threshold"));
    assertEquals(25, values.getIntValue("threshold"));
    assertEquals("025", values.getString("codes"));
    assertTrue(values.getJSONArray("amounts").stream().allMatch(Number.class::isInstance));
    var legacy = io.ontomato.dataengine.util.DBSchemaUtil.buildParameters(definitions.toList(Map.class), List.of());
    assertEquals(legacy.get(0).getValue(), QueryPackage.definitions(accepted).get(0).getValue());
    assertEquals(legacy.get(2).getValue(), QueryPackage.definitions(accepted).get(2).getValue());
    assertEquals("25", raw.getJSONObject("manifest").getJSONArray("parameterDefs").getJSONObject(0).get("value"));
    assertEquals(OntologyQueryService.digest(accepted), OntologyQueryService.digest(QueryPackage.accept(accepted)));
  }

  @Test
  void wholeBundleAndItsParameterTargetsAreClosed() throws Exception {
    var original = bundle();
    QueryPackage.validate(original);
    var changed = QueryPackage.copy(original);
    changed.getJSONArray("files").remove(0);
    assertThrows(IllegalArgumentException.class, () -> QueryPackage.validate(changed));
    var duplicate = QueryPackage.copy(original);
    duplicate.getJSONArray("files").add(duplicate.getJSONArray("files").get(0));
    assertThrows(IllegalArgumentException.class, () -> QueryPackage.validate(duplicate));
    for (String path : List.of("../outside.py", "/absolute.py", "a/../b", "a\\b", "a//b"))
      assertThrows(IllegalArgumentException.class, () -> QueryPackage.path(path));
    var structural = QueryPackage.copy(original);
    structural.getJSONObject("manifest").getJSONArray("parameterBindings").getJSONObject(0)
        .put("pointer", "/answer/steps/0/graph/patterns/0/objects/0/class");
    assertThrows(IllegalArgumentException.class, () -> QueryPackage.validate(structural));
    var first = QueryPackage.query(original, "employees", JSONObject.of("threshold", 25));
    var second = QueryPackage.query(original, "queries/employees.json", JSONObject.of("threshold", 30));
    String pointer = "$.answer.steps[0].graph.patterns[0].objects[0].conditions.properties.value";
    assertEquals(25, JSONPath.eval(first, pointer));
    assertEquals(30, JSONPath.eval(second, pointer));
    assertEquals(20, JSONPath.eval(QueryPackage.query(original, "employees"), pointer));
    assertThrows(IllegalArgumentException.class, () -> QueryPackage.query(original, "undeclared.json"));
    assertThrows(IllegalArgumentException.class, () -> QueryPackage.parameters(original, JSONObject.of("threshold", "25")));
  }

  @Test
  void derivedDslAndDeclaredPythonKeepStatisticsPermissionsAndStableTests() throws Exception {
    var pkg = bundle();
    var graph = QueryPackage.analysis(pkg, QueryPackage.parameters(pkg, null), JSONObject.of("total", "Total"), definitions());
    assertEquals(1, QueryPermissions.sources(graph).get("total").size());
    assertEquals(QueryPermissions.Use.AGGREGATE, QueryPermissions.sources(graph).get("total").iterator().next().use());
    assertEquals(120, QueryPermissions.mask(JSONArray.of(JSONObject.of("total", 120)), graph, permission()).getJSONObject(0).get("total"));
    var altered = QueryPackage.copy(pkg);
    altered.getJSONArray("files").getJSONObject(0).put("content", altered.getJSONArray("files").getJSONObject(0).getString("content").replace(">=", ">"));
    assertNotEquals(GenerationOperations.packageTestDigest("function", pkg), GenerationOperations.packageTestDigest("function", altered));
    var renamed = QueryPackage.copy(pkg);
    renamed.getJSONObject("manifest").getJSONArray("parameterDefs").getJSONObject(0).put("description", "A new description");
    assertEquals(GenerationOperations.packageTestDigest("function", pkg), GenerationOperations.packageTestDigest("function", renamed));
    altered = QueryPackage.copy(pkg);
    altered.getJSONObject("manifest").getJSONObject("computation").getJSONArray("operations").getJSONObject(0).put("operation", "project");
    assertNotEquals(GenerationOperations.packageTestDigest("function", pkg), GenerationOperations.packageTestDigest("function", altered));
  }

  @Test
  void runtimeGetsWholeFilesAndPackageAuthorityThenFinalColumnsAreMasked() throws Exception {
    var pkg = bundle();
    var ontology = mock(OntologyQueryService.class);
    when(ontology.rule(any())).thenReturn(Map.of("classDef", definitions()));
    var python = mock(PythonExecuteService.class);
    var output = new PythonExecuteResult(); output.setResult("{\"answer\":[{\"total\":120}]}");
    when(python.execute(anyString(), anyString(), anyInt(), anyString(), any(), any(), any())).thenAnswer(call -> {
      PythonAuthority authority = call.getArgument(4);
      assertEquals("package-read", authority.purpose());
      assertEquals(pkg, authority.packageInput().getJSONObject("package"));
      Map<String, String> files = call.getArgument(6);
      assertEquals(2, files.size());
      assertEquals(QueryPackage.files(pkg).get("queries/employees.json"), files.get("package/queries/employees.json"));
      return output;
    });
    var result = QueryPackageExecution.execute(UUID.randomUUID().toString(), pkg, null,
        JSONObject.of("total", "Total"), access(), "en", 1, ontology, python);
    assertEquals(120, result.rows().getJSONObject(0).get("total"));
    verify(python, times(1)).execute(anyString(), anyString(), anyInt(), anyString(), any(), any(), any());
    var detail = QueryPackage.copy(pkg);
    detail.getJSONObject("manifest").getJSONObject("computation").getJSONArray("operations").getJSONObject(0).put("operation", "project");
    var masked = QueryPackageExecution.execute(UUID.randomUUID().toString(), detail, null,
        JSONObject.of("total", "Total"), access(), "en", 1, ontology, mockPython());
    assertEquals("****", masked.rows().getJSONObject(0).get("total"));
  }
  private PythonExecuteService mockPython() throws Exception {
    var python = mock(PythonExecuteService.class);
    var output = new PythonExecuteResult(); output.setResult("{\"answer\":[{\"total\":120}]}");
    when(python.execute(anyString(), anyString(), anyInt(), anyString(), any(), any(), any())).thenReturn(output);
    return python;
  }

  @Test
  void executionReferencesUseFrozenQueriesAndRejectRawOrStructuralOverrides() throws Exception {
    var pkg = bundle();
    var admin = mock(AdminService.class);
    when(admin.getJSONRule("domain")).thenReturn(Map.of("classDef", definitions(), "relationship_rule", Map.of()));
    var dsl = mock(DslService.class);
    when(dsl.executeInternal(any(), any(), any())).thenAnswer(call -> {
      var query = (JSONObject) call.getArgument(0);
      assertEquals(35, JSONPath.eval(query, "$.answer.steps[0].graph.patterns[0].objects[0].conditions.properties.value"));
      return Map.of("data", List.of(Map.of("answer", List.of())));
    });
    var ontology = new OntologyQueryService(admin, dsl, mock(MetricViewService.class), mock(KnowledgeDao.class));
    var grants = mock(QueryGrantService.class);
    ReflectionTestUtils.setField(ontology, "grants", grants);
    var claim = JSONObject.of("purpose", "package-read", "runId", "execution");
    var restricted = new QueryAccessService.Access(access().user(), permission(), claim, "opaque", null, List.of("/Employee"));
    when(grants.packageInput(any())).thenAnswer(c -> JSONObject.of("package", QueryPackage.copy(pkg), "parameters", JSONObject.of("threshold", 20)));
    ontology.executePackage(JSONObject.of("path", "queries/employees.json", "parameters", JSONObject.of("threshold", 35)), restricted);
    assertThrows(ResponseStatusException.class, () -> ontology.execute(QueryPackage.query(pkg, "employees"), restricted));
    assertThrows(IllegalArgumentException.class, () -> ontology.executePackage(JSONObject.of("path", "queries/employees.json", "parameters", JSONObject.of("class", "/Secret")), restricted));
    assertThrows(IllegalArgumentException.class, () -> ontology.executePackage(JSONObject.of("path", "other.json"), restricted));
    verify(dsl, times(1)).executeInternal(any(), any(), any());
  }

  @Test
  void tamperedFrozenInputIsRejectedByGrantDigest() throws Exception {
    var input = JSONObject.of("package", bundle(), "parameters", JSONObject.of("threshold", 20));
    var claim = JSONObject.of("purpose", "package-read", "jti", "grant", "runId", "execution", "domainId", "domain", "packageInputSha256", OntologyQueryService.digest(input));
    var jdbc = mock(JdbcTemplate.class);
    when(jdbc.queryForObject(anyString(), eq(String.class), eq("grant"), eq("execution"), eq("domain"), anyLong()))
        .thenReturn(input.toJSONString());
    var grants = new QueryGrantService(jdbc, "fixture", mock(WorkbenchServiceAuthentication.class));
    assertEquals(input, grants.packageInput(claim));
    input.getJSONObject("package").getJSONArray("files").getJSONObject(1).put("content", "print('changed')");
    when(jdbc.queryForObject(anyString(), eq(String.class), eq("grant"), eq("execution"), eq("domain"), anyLong()))
        .thenReturn(input.toJSONString());
    assertThrows(ResponseStatusException.class, () -> grants.packageInput(claim));
  }

  @Test
  void functionHasOneDefinitionAndBindingsDoNotMutateIt() throws Exception {
    var function = new Function(); function.setOperation(Function.OPERATION_READ); function.setQueryPackage(bundle());
    var returns = new ReturnDef(); returns.setColumnLabels(JSONObject.of("total", "Total")); function.setReturnDef(returns);
    QueryPackage.prepareReadFunction(function, definitions());
    var before = OntologyQueryService.digest(function.getQueryPackage());
    var execution = MetricViewBindings.executionFunction(function, JSONObject.of("threshold", 40));
    assertEquals(40, execution.getParameters().get(0).getValue());
    assertEquals(20, function.getParameters().get(0).getValue());
    assertEquals(before, OntologyQueryService.digest(function.getQueryPackage()));
    var metric = new io.ontomato.dataengine.bean.metricView.MetricView(); metric.setFunction(function);
    String revision = OntologyQueryService.revision(metric);
    var file = function.getQueryPackage().getJSONArray("files").getJSONObject(0);
    file.put("content", file.getString("content") + " ");
    assertNotEquals(revision, OntologyQueryService.revision(metric));
    assertTrue(function.getReturnDef().getSourceAnalysis().toJSONString().contains("${threshold}"));
    function.setCode("a second definition");
    assertThrows(IllegalArgumentException.class, () -> QueryPackage.prepareReadFunction(function, definitions()));
  }
}
