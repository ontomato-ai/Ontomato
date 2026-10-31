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
  void checkedPythonErrorsKeepTheirPublicMessageAcrossOwnerExecution() {
    var error = assertThrows(IllegalStateException.class,
        () -> io.ontomato.dataengine.service.agent.OntologyGenerationService.asOwner(
            new QueryAccessService.GrantUser("user", "domain"), () -> { throw new Exception("KeyError at program.py line 2"); }));
    assertEquals("KeyError at program.py line 2", error.getMessage());
  }

  @Test
  void dslLabelsDescribeFiltersAndOperationsWithoutTechnicalAliases() {
    var metadata = definitions();
    var attrs = JSONObject.from(metadata.get(0)).getJSONArray("attrs");
    attrs.getJSONObject(1).put("attrDesc", "单位全称");
    attrs.add(JSONObject.of("name", "status", "attrDesc", "人员状态", "enable", true));
    var dsl = query("COUNT", "headcount"); dsl.remove("problem");
    var step = dsl.getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
    var condition = JSON.parseObject("""
        {"properties":{"and":[{"field":"status","operator":"=","value":"在职"},
        {"or":[{"field":"department","operator":"=","value":"文学院"},{"field":"department","operator":"=","value":"理学院"}]}]}}
        """);
    step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects").getJSONObject(0).put("conditions", condition);
    step.getJSONObject("output").put("group_by", JSONObject.of("fields", JSONArray.of(JSONObject.of("variable", "e", "field", "department"))));
    step.getJSONObject("output").getJSONArray("fields").add(JSONObject.of("variable", "e", "field", "department", "as", "college_name"));
    var graph = QuerySourceAnalysis.fromDsl(dsl, metadata);
    assertEquals("员工", graph.getJSONArray("queries").getJSONObject(0).getString("label"));
    var filter = graph.getJSONArray("filters").getJSONObject(0);
    assertEquals(condition.toJSONString(), filter.getString("expression"));
    assertEquals("(人员状态 = 在职 AND (单位全称 = 文学院 OR 单位全称 = 理学院))", filter.getString("label"));
    var labels = graph.getJSONArray("nodes").stream().map(JSONObject::from).filter(n -> "operation".equals(n.getString("kind")))
        .map(n -> n.getString("label")).toList();
    assertTrue(labels.contains("COUNT(*)")); assertTrue(labels.contains("GROUP BY 单位全称"));
    assertFalse(labels.contains("headcount")); assertFalse(labels.contains("college_name"));
  }

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
  void queryValidationAndPermissionErrorsRemainActionableInBothModes() {
    var admin = mock(AdminService.class);
    when(admin.getJSONRule("domain")).thenReturn(Map.of("classDef", definitions()));
    var config = mock(BusinessConfigService.class);
    when(config.get("domain")).thenReturn(new io.ontomato.dataengine.config.BusinessConfig());
    var adapters = mock(io.ontomato.dataengine.dataAdapter.DataAdapterRegistry.class);
    when(adapters.create(any(), any())).thenThrow(new IllegalArgumentException("private adapter value"));
    var engine = new io.ontomato.dataengine.service.impl.DslServiceImpl();
    org.springframework.test.util.ReflectionTestUtils.setField(engine, "adminService", admin);
    org.springframework.test.util.ReflectionTestUtils.setField(engine, "businessConfigService", config);
    org.springframework.test.util.ReflectionTestUtils.setField(engine, "dataAdapterRegistry", adapters);
    var grants = mock(QueryGrantService.class);
    var ontology = new OntologyQueryService(admin, engine, null, null);
    org.springframework.test.util.ReflectionTestUtils.setField(ontology, "grants", grants);
    for (String purpose : List.of("retrieval-exploration", "user-read")) {
      var permission = permission();
      var grant = JSONObject.of("jti", "grant", "runId", "execution", "domainId", "domain", "purpose", purpose);
      var access = new QueryAccessService.Access(new QueryAccessService.GrantUser("user", "domain"), permission, grant, null, null);
      var unknown = query("", "salary");
      unknown.getJSONObject("answer").getJSONArray("steps").getJSONObject(0).getJSONObject("output")
          .getJSONArray("fields").getJSONObject(0).put("field", "hj_dj");
      var validation = assertThrows(org.springframework.web.server.ResponseStatusException.class,
          () -> ontology.execute(unknown, access));
      assertEquals(422, validation.getStatusCode().value());
      assertTrue(validation.getReason().contains("Unknown source attribute: hj_dj"));
      verify(grants).recordQueryError(grant, validation.getReason());

      permission.getFieldPermissionByClassName("/Employee").getGroupableColumns().clear();
      var forbiddenAccess = new QueryAccessService.Access(access.user(), permission, grant, null, null);
      var forbidden = assertThrows(org.springframework.web.server.ResponseStatusException.class,
          () -> ontology.execute(query("", "salary"), forbiddenAccess));
      assertEquals(403, forbidden.getStatusCode().value());
      assertEquals("Field is outside the authorized scope", forbidden.getReason());
      verify(grants).recordQueryError(grant, forbidden.getReason());

      var execution = assertThrows(org.springframework.web.server.ResponseStatusException.class,
          () -> ontology.execute(query("", "salary"), access));
      assertEquals("Query execution failed", execution.getReason());
      verify(grants).recordQueryError(grant, execution.getReason());
    }
    verify(adapters, times(2)).create(any(), any());
  }

  @Test
  void explorationAndInternalQueriesRecordOnlyClassifiedErrors() {
    var admin = mock(AdminService.class);
    when(admin.getJSONRule("domain")).thenReturn(Map.of("classDef", definitions()));
    var engine = mock(DslService.class);
    var grants = mock(QueryGrantService.class);
    var ontology = new OntologyQueryService(admin, engine, null, null);
    org.springframework.test.util.ReflectionTestUtils.setField(ontology, "grants", grants);
    var dsl = query("", "salary");
    var failure = io.ontomato.dataengine.bean.DslExecutionResult.failure(new JSONObject(),
        new java.sql.SQLException("column t.hj_dj does not exist\n  Hint: secret_salary", "42703"));
    var graph = QuerySourceAnalysis.fromDsl(dsl, definitions());
    for (boolean internal : List.of(false, true)) {
      var filtered = QueryPermissions.response(failure.rawResponse(), graph, permission(), internal);
      when(engine.executeInternal(any(), any(), any())).thenReturn(filtered);
      when(engine.executeV1(any(), any(), any())).thenReturn(filtered);
      var grant = JSONObject.of("jti", "grant", "runId", "execution", "domainId", "domain",
          "purpose", internal ? "user-read" : "retrieval-exploration");
      var access = new QueryAccessService.Access(new QueryAccessService.GrantUser("user", "domain"), permission(), grant, null, null);
      var error = assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> ontology.execute(dsl, access));
      assertEquals("column t.hj_dj does not exist", error.getReason());
      verify(grants).recordQueryError(grant, "column t.hj_dj does not exist");
    }
  }

  @Test
  void literalDslOutputsHaveConstantSources() {
    for (String expression : List.of("'role_code'", "'e.salary'", "'it''s a role'", "42", "-1.5e2", "true", "null")) {
      var dsl = query("", "unused");
      dsl.getJSONObject("answer").getJSONArray("steps").getJSONObject(0).getJSONObject("output")
          .put("fields", JSONArray.of(JSONObject.of("as", "group_type", "expr", expression)));
      var graph = QuerySourceAnalysis.fromDsl(dsl, definitions());
      assertTrue(QueryPermissions.sources(graph).get("group_type").isEmpty());
      assertTrue(graph.getJSONArray("nodes").stream().map(JSONObject::from)
          .anyMatch(n -> "constant".equals(n.getString("operation"))));
      assertEquals("role_code", QueryPermissions.mask(JSONArray.of(JSONObject.of("group_type", "role_code")), graph, permission())
          .getJSONObject(0).getString("group_type"));
    }
  }

  private io.ontomato.dataengine.bean.metricView.MetricView storedMetric(String id, boolean complete) {
    var ref = new io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramOutKeyRef();
    ref.setKey("total"); ref.setClassName("/Employee"); ref.setAttrName("salary");
    if (complete) { ref.setAsGroupBy(false); ref.setStatCal(true); }
    var returns = new io.ontomato.dataengine.bean.function.ReturnDef();
    returns.setOutKeyRefs(List.of(ref));
    var function = new io.ontomato.dataengine.bean.function.Function();
    function.setDomainId("domain"); function.setOperation(io.ontomato.dataengine.bean.function.Function.OPERATION_READ);
    function.setCode("# ontomato-python:2\nprint('{}')");
    function.setParameters(new ArrayList<>()); function.setReturnDef(returns);
    var metric = new io.ontomato.dataengine.bean.metricView.MetricView();
    metric.setId(id); metric.setDomainId("domain");
    metric.setStatus(io.ontomato.dataengine.bean.metricView.MetricView.STATUS_PUBLISHED); metric.setFunction(function);
    return metric;
  }

  @Test
  void incompleteStoredMetricDoesNotBreakSearchButCannotExecute() {
    var broken = storedMetric("broken", false);
    var unknown = storedMetric("unknown", true);
    unknown.getFunction().getReturnDef().getOutKeyRefs().get(0).setAttrName("missing");
    var valid = storedMetric("valid", true);
    var metrics = mock(MetricViewService.class);
    when(metrics.queryForRetrieval(eq("domain"), eq(""), isNull(), isNull(), anyInt()))
        .thenReturn(List.of(broken, unknown, valid));
    when(metrics.queryById("broken", "domain")).thenReturn(broken);
    var admin = mock(AdminService.class);
    when(admin.getJSONRule("domain")).thenReturn(Map.of("classDef", definitions()));
    var ontology = new OntologyQueryService(admin, null, metrics, null);
    var permission = permission(); permission.setFullData(true);
    var access = new QueryAccessService.Access(new QueryAccessService.GrantUser("user", "domain"), permission, null, null, null);
    var found = JSONObject.from(ontology.metrics(JSONObject.of("limit", 10), access)).getJSONArray("items");
    assertEquals(List.of("valid"), found.stream().map(JSONObject::from).map(item -> item.getString("id")).toList());
    var python = mock(PythonExecuteService.class);
    var output = new QueryOutputService(python, null, ontology, null);
    var error = assertThrows(IllegalArgumentException.class, () -> output.execute("run", JSONObject.of(
        "kind", "metric", "metricId", "broken", "revision", OntologyQueryService.revision(broken), "parameters", new JSONObject()), null, access, "en"));
    assertEquals("Incomplete stored source declaration", error.getMessage());
    verifyNoInteractions(python);
  }

  @Test
  void incompleteStoredFunctionAndDashboardRejectBeforeExecution() {
    var function = storedMetric("broken", false).getFunction();
    var dashboard = new io.ontomato.dataengine.bean.abcHarness.ABCHarnessDashboard();
    dashboard.setOutKeyRefs(function.getReturnDef().getOutKeyRefs());
    var python = mock(PythonExecuteService.class);
    var programs = new io.ontomato.dataengine.service.impl.ABCProgramServiceImpl();
    org.springframework.test.util.ReflectionTestUtils.setField(programs, "pythonExecuteService", python);
    assertEquals("Incomplete stored source declaration", assertThrows(IllegalArgumentException.class,
        () -> programs.execute("run", function, "user", permission(), null, "en", 1, "domain")).getMessage());
    assertEquals("Incomplete stored source declaration", assertThrows(IllegalArgumentException.class,
        () -> programs.execute("run", dashboard, "user", permission(), "en", 1, "domain")).getMessage());
    verifyNoInteractions(python);
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
