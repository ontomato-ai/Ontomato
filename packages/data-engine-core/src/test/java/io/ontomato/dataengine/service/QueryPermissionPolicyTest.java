package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.service.sys.bean.permission.*;
import io.ontomato.dataengine.util.DslPermissionUtil;
import java.util.*;
import org.junit.jupiter.api.Test;

/** Permission and delivery examples, with no database, runtime or model calls. */
class QueryPermissionPolicyTest {
  @Test
  void invalidFunctionModeCannotBecomeWriteAuthority() {
    var function = new io.ontomato.dataengine.bean.function.Function();
    function.setDomainId("domain"); function.setOperation("invalid");
    function.setCode("# ontomato-python:2\nprint('{}')");
    var python = mock(PythonExecuteService.class);
    var programs = new io.ontomato.dataengine.service.impl.ABCProgramServiceImpl();
    org.springframework.test.util.ReflectionTestUtils.setField(programs, "pythonExecuteService", python);
    assertThrows(IllegalArgumentException.class, () -> programs.execute("run", function, "user", permission(), null, "en", 1, "domain"));
    verifyNoInteractions(python);
  }

  private List<Map<String, Object>> definitions() {
    return List.of(JSONObject.of("className", "/Employee", "classDesc", "员工", "attrs", JSONArray.of(
        JSONObject.of("name", "salary", "attrDesc", "工资", "enable", true),
        JSONObject.of("name", "department", "attrDesc", "部门", "enable", true))));
  }

  private JSONObject query(String function, String key) {
    JSONObject field = JSONObject.of("variable", "e", "field", function.equals("COUNT") ? "*" : "salary", "as", key);
    if (!function.isEmpty()) field.put("function", function);
    return JSONObject.of("problem", "工资", "answer", JSONObject.of("steps", JSONArray.of(JSONObject.of(
        "graph", JSONObject.of("patterns", JSONArray.of(JSONObject.of("objects", JSONArray.of(
            JSONObject.of("idx", 0, "variable", "e", "class", "/Employee"))))),
        "output", JSONObject.of("to_user", true, "fields", JSONArray.of(field))))));
  }

  @Test
  void savedMultiQueryGraphSurvivesMetricExecution() throws Exception {
    JSONObject graph;
    try (var input = getClass().getResourceAsStream("/ontology-contracts/examples/query-subgraphs.json")) {
      graph = JSON.parseObject(input.readAllBytes()).getJSONObject("pythonMerge");
    }
    var definition = new io.ontomato.dataengine.bean.function.Function();
    definition.setCode("# ontomato-python:2\nprint('{}')");
    definition.setParameters(new ArrayList<>());
    var returns = new io.ontomato.dataengine.bean.function.ReturnDef();
    returns.setSourceAnalysis(graph); definition.setReturnDef(returns);
    var metric = new io.ontomato.dataengine.bean.metricView.MetricView(); metric.setFunction(definition);
    var ontology = mock(OntologyQueryService.class);
    when(ontology.metric(any(), any(), any())).thenReturn(metric);
    var metadata = new ArrayList<>(definitions());
    metadata.add(JSONObject.of("className", "/DepartmentBudget", "attrs", JSONArray.of(
        JSONObject.of("name", "department"), JSONObject.of("name", "amount"), JSONObject.of("name", "year"))));
    when(ontology.rule(any())).thenReturn(Map.of("classDef", metadata));
    var python = mock(PythonExecuteService.class);
    var execution = new io.ontomato.dataengine.bean.PythonExecuteResult();
    execution.setResult("{\"answer\":[{\"department\":\"Operations\",\"payrollBudgetPercent\":60}]}");
    when(python.execute(anyString(), anyString(), anyInt(), anyString(), any(), any(), any())).thenReturn(execution);
    var config = mock(BusinessConfigService.class);
    var settings = new io.ontomato.dataengine.config.BusinessConfig(); settings.setDslCookerTimeout(60000L);
    when(config.get("domain")).thenReturn(settings);
    var permission = permission(); permission.setFullData(true);
    var access = new QueryAccessService.Access(new QueryAccessService.GrantUser("user", "domain"), permission, null, null, null);
    var result = new QueryOutputService(python, new io.ontomato.dataengine.service.impl.ABCProgramServiceImpl(), ontology, config)
        .execute(UUID.randomUUID().toString(), JSONObject.of("kind", "metric", "metricId", "metric", "revision", "r1", "parameters", new JSONObject()), null, access, "en");
    assertEquals(graph, QuerySubgraphContract.validate(result.getJSONObject("sourceAnalysis")));
    assertEquals("Payroll / budget (%)", result.getJSONArray("columns").getJSONObject(1).getString("label"));
  }

  private UserDataPermission permission() {
    var permission = new UserDataPermission();
    var employee = new FieldPermission("/Employee");
    employee.getVisibleFields().add("department"); employee.getGroupableColumns().add("salary");
    permission.addFieldPermission(employee);
    return permission;
  }

  @Test
  void salaryCanBeAggregatedButNotReturnedAsDetail() {
    var permission = permission();
    var detail = QuerySourceAnalysis.fromDsl(query("", "salary"), definitions());
    assertEquals("****", QueryPermissions.mask(JSONArray.of(JSONObject.of("salary", 120)), detail, permission).getJSONObject(0).get("salary"));
    var aggregate = QuerySourceAnalysis.fromDsl(query("SUM", "total"), definitions());
    assertEquals(120, QueryPermissions.mask(JSONArray.of(JSONObject.of("total", 120)), aggregate, permission).getJSONObject(0).get("total"));
    assertTrue(QueryPermissions.classAllowed(permission, "/Employee"));
    assertFalse(QueryPermissions.classAllowed(permission, "/Secret"));
    assertThrows(org.springframework.web.server.ResponseStatusException.class,
        () -> QueryAccessService.classScope(permission, List.of("/Secret")));
  }

  @Test
  void combinedPythonOutputRequiresEveryDeclaredValueSource() throws Exception {
    JSONObject graph;
    try (var input = getClass().getResourceAsStream("/ontology-contracts/examples/query-subgraphs.json")) {
      graph = JSON.parseObject(input.readAllBytes()).getJSONObject("pythonMerge");
    }
    var permission = permission();
    var budget = new FieldPermission("/DepartmentBudget");
    budget.getVisibleFields().add("department"); permission.addFieldPermission(budget);
    var rows = JSONArray.of(JSONObject.of("department", "Operations", "payrollBudgetPercent", 60));
    assertEquals("****", QueryPermissions.mask(rows, graph, permission).getJSONObject(0).get("payrollBudgetPercent"));
    budget.getGroupableColumns().add("amount");
    assertEquals(60, QueryPermissions.mask(rows, graph, permission).getJSONObject(0).get("payrollBudgetPercent"));
    assertEquals(60, rows.getJSONObject(0).get("payrollBudgetPercent"));
  }

  @Test
  void rowRulesReachEveryPatternAndEveryBaseTableStep() {
    var permission = mock(UserDataPermission.class);
    var rule = JSONObject.of("field", "department", "operator", "=", "value", "my department");
    when(permission.getRowPermissionMQLByClassName("/Employee")).thenReturn(rule);
    var first = JSONObject.of("class", "/Employee", "conditions", JSONObject.of("properties", JSONObject.of("field", "active", "operator", "=", "value", true)));
    var second = JSONObject.of("class", "/Employee");
    var third = JSONObject.of("class", "/Employee");
    var temporary = JSONObject.of("class", "temp");
    var dsl = JSONObject.of("answer", JSONObject.of("steps", JSONArray.of(
        JSONObject.of("graph", JSONObject.of("patterns", JSONArray.of(
            JSONObject.of("objects", JSONArray.of(first)), JSONObject.of("objects", JSONArray.of(second)))), "output", JSONObject.of("save_table", "temp")),
        JSONObject.of("graph", JSONObject.of("patterns", JSONArray.of(JSONObject.of("objects", JSONArray.of(third, temporary)))), "output", new JSONObject()))));
    var result = (JSONObject) DslPermissionUtil.addRowPermission("[" + dsl.toJSONString() + "]", definitions(), permission)[0];
    var steps = result.getJSONObject("answer").getJSONArray("steps");
    var patterns = steps.getJSONObject(0).getJSONObject("graph").getJSONArray("patterns");
    assertEquals(2, patterns.getJSONObject(0).getJSONArray("objects").getJSONObject(0).getJSONObject("conditions").getJSONObject("properties").getJSONArray("and").size());
    assertEquals(rule, patterns.getJSONObject(1).getJSONArray("objects").getJSONObject(0).getJSONObject("conditions").getJSONObject("properties"));
    var objects = steps.getJSONObject(1).getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects");
    assertEquals(rule, objects.getJSONObject(0).getJSONObject("conditions").getJSONObject("properties"));
    assertNull(objects.getJSONObject(1).get("conditions"));
  }

  @Test
  void datasetHeadersComeFromTheOutputNodes() throws Exception {
    var dsl = query("COUNT", "active_staff_total");
    var actual = QuerySourceAnalysis.fromDsl(dsl, definitions());
    var declared = JSON.parseObject(actual.toJSONString());
    declared.getJSONArray("nodes").stream().map(JSONObject::from).filter(n -> "output".equals(n.getString("kind")))
        .forEach(n -> n.put("label", "在职员工总数"));
    var permission = permission();
    var access = new QueryAccessService.Access(new QueryAccessService.GrantUser("user", "domain"), permission, null, null, null);
    var ontology = mock(OntologyQueryService.class);
    when(ontology.execute(dsl, access)).thenReturn(JSONObject.of("sourceAnalysis", actual,
        "data", JSONArray.of(JSONObject.of("answer", JSONArray.of(JSONObject.of("active_staff_total", 3))))));
    var output = new QueryOutputService(null, null, ontology, null).execute(UUID.randomUUID().toString(), JSONObject.of("kind", "dsl", "dsl", dsl), declared, access, "zh-CN");
    assertEquals("在职员工总数", output.getJSONArray("columns").getJSONObject(0).getString("label"));
    assertEquals("active_staff_total", output.getJSONArray("columns").getJSONObject(0).getString("key"));
  }
}
