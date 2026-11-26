package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.util.ReflectionTestUtils.setField;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.trigger.Trigger;
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.AssetLookupPolicy;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.dao.TriggerDao;
import io.ontomato.dataengine.dao.WorkflowDao;
import io.ontomato.dataengine.service.ActionTrialStore;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.QueryAccessService.GrantUser;
import io.ontomato.dataengine.service.SubjectDirectory;
import io.ontomato.dataengine.service.TriggerService;
import io.ontomato.dataengine.service.agent.AgentExecutionScope;
import io.ontomato.dataengine.service.authorization.ActionAuthorization;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.authorization.AuthorizationSubjects;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.RoleResolution;
import io.ontomato.dataengine.service.authorization.CapabilityDefinitions;
import io.ontomato.dataengine.service.impl.ActionServiceImpl;
import io.ontomato.dataengine.service.impl.MetricViewServiceImpl;
import io.ontomato.dataengine.service.impl.WorkflowServiceImpl;
import io.ontomato.dataengine.util.SystemUtils;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentMatchers;
import org.mockito.invocation.Invocation;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementSetter;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** Runs the list endpoints through their real owners and counts reads at the storage seams. */
class OwnerListQueryBudgetTest {
  private static final String DOMAIN = "domain";
  private static final String AUTHOR = "author";
  private static final String METRIC_BINDING_TABLE = " FROM metric_view_binding ";

  private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final FunctionDao functions = spy(withJdbc(new FunctionDao()));
  private final SubjectDirectory directory = mock(SubjectDirectory.class);
  private final LangService messages = mock(LangService.class);
  private final AuthorizationSubjects subjects = mock(AuthorizationSubjects.class);
  private final AuthorizationStore policies = mock(AuthorizationStore.class);
  private final AuthorizationService authorization = new AuthorizationService(subjects, policies, null, null, null);

  @BeforeEach
  void allowPublishedDefinitions() {
    when(subjects.resolveRoles(DOMAIN, AUTHOR))
        .thenReturn(new RoleResolution(Set.of(), Set.of(), List.of(), Set.of(), Map.of(), false));
    when(subjects.objectEntitlement(eq(AUTHOR), any(), any())).thenReturn(true);
    when(policies.policies(DOMAIN, Set.of())).thenReturn(List.of());
  }

  @ParameterizedTest
  @ValueSource(ints = {1, 8})
  void actionsBatchFunctionsDisplayNamesAndTrialReads(int size) throws Exception {
    var controller = new ActionController(mock(AgentExecutionScope.class));
    setField(controller, "actionService", actionService(size));
    setField(controller, "authorization", new ActionAuthorization(authorization, null));
    setField(controller, "actionTrialStore", new ActionTrialStore(jdbc, withJdbc(new JSONRuleDao()), messages));
    when(jdbc.queryForObject(contains(" FROM json_rule "), eq(String.class), eq(DOMAIN)))
        .thenReturn("{\"classDef\":[]}");
    stubFunctions(size, Function.OPERATION_WRITE);
    var names = directoryNames(size, false);

    var rows = queryList(controller, "/action/queryList", size);

    assertOwnerNames(rows, names);
    assertHydratedFunctions(rows);
    assertBatchedFunctions(size);
    assertBoundaryReads(names);
    assertJdbcBudget(4, jdbcCalls()); // Action rows, Functions, trial schema and trial receipts.
  }

  @ParameterizedTest
  @ValueSource(ints = {1, 8})
  void metricsBatchFunctionsAndDisplayNames(int size) throws Exception {
    var dao = withJdbc(new MetricViewDao());
    setField(dao, "assetLookupPolicy", (AssetLookupPolicy) (db, table) -> true);
    stubList(" FROM metric_view ", indices(size).mapToObj(i -> {
      var metric = new MetricView();
      metric.setId("metric-" + i);
      metric.setDomainId(DOMAIN);
      metric.setStatus(MetricView.STATUS_PUBLISHED);
      metric.setCreatedBy(AUTHOR);
      metric.setReviewedBy("reviewer-" + i);
      return new Object[] {metric, "function-" + i};
    }).toList());
    stubList(METRIC_BINDING_TABLE, List.of());
    var service = new MetricViewServiceImpl();
    setField(service, "metricViewDao", dao);
    setField(service, "functionDao", functions);
    var controller = new MetricViewController(mock(AgentExecutionScope.class));
    setField(controller, "metricViewService", service);
    setField(controller, "definitions", new CapabilityDefinitions(authorization, null));
    stubFunctions(size, Function.OPERATION_READ);
    var names = directoryNames(size, false);

    var rows = queryList(controller, "/metricView/queryList", size);

    assertOwnerNames(rows, names);
    assertHydratedFunctions(rows);
    assertBatchedFunctions(size);
    assertBoundaryReads(names);
    // Known baseline: bindings still load once per metric. A batch read may lower this budget.
    var reads = jdbcCalls();
    var bindingReads = reads.stream().filter(OwnerListQueryBudgetTest::isMetricBindingRead).toList();
    assertJdbcBudget(size, bindingReads);
    assertJdbcBudget(2, reads.stream().filter(call -> !isMetricBindingRead(call)).toList());
  }

  @ParameterizedTest
  @ValueSource(ints = {1, 8})
  void triggersBatchDisplayNamesAndReuseTheTargetCatalogues(int size) throws Exception {
    var controller = new TriggerController();
    var definitions = new CapabilityDefinitions(authorization, null);
    setField(controller, "triggers", withJdbc(new TriggerDao()));
    setField(controller, "service", new TriggerService());
    setField(controller, "definitions", definitions);
    setField(controller, "actionService", actionService(size));
    setField(controller, "workflowService",
        new WorkflowServiceImpl(withJdbc(new WorkflowDao()), null, null, null, null, null, definitions));
    stubList(" FROM trigger_def ", indices(size).mapToObj(i -> {
      var trigger = new Trigger();
      trigger.setId("trigger-" + i);
      trigger.setDomainId(DOMAIN);
      trigger.setStatus(Trigger.STATUS_PUBLISHED);
      trigger.setCreatedBy(AUTHOR);
      trigger.setReviewedBy("reviewer-" + i);
      trigger.setExecutor("principal:executor-" + i);
      trigger.setEffectKind(i % 2 == 0 ? Trigger.EFFECT_ACTION : Trigger.EFFECT_WORKFLOW);
      trigger.setEffect(i % 2 == 0 ? JSONObject.of("actionId", "action-" + i)
          : JSONObject.of("workflowId", "workflow-" + i));
      return trigger;
    }).toList());
    stubList(" FROM workflow ", indices(size).mapToObj(i -> {
      var workflow = new Workflow();
      workflow.setId("workflow-" + i);
      workflow.setName("Workflow " + i);
      return workflow;
    }).toList());
    stubFunctions(size, Function.OPERATION_WRITE);
    var names = directoryNames(size, true);

    var rows = queryList(controller, "/trigger/queryList", size);

    assertOwnerNames(rows, names);
    for (int i = 0; i < size; i++) {
      assertEquals(names.get("executor-" + i), rows.get(i).path("executorName").asText());
      assertEquals((i % 2 == 0 ? "Action " : "Workflow ") + i, rows.get(i).path("effectTargetName").asText());
    }
    assertBoundaryReads(names);
    assertJdbcBudget(4, jdbcCalls()); // Trigger rows, Action catalogue and its Functions, Workflow catalogue.
  }

  private ActionServiceImpl actionService(int size) {
    var dao = withJdbc(new ActionDao());
    setField(dao, "assetLookupPolicy", (AssetLookupPolicy) (db, table) -> true);
    stubList(" FROM action ", indices(size).mapToObj(i -> {
      var action = new Action();
      action.setId("action-" + i);
      action.setDomainId(DOMAIN);
      action.setName("Action " + i);
      action.setStatus(Action.STATUS_PUBLISHED);
      action.setCreatedBy(AUTHOR);
      action.setReviewedBy("reviewer-" + i);
      return new Object[] {action, "function-" + i};
    }).toList());
    var service = new ActionServiceImpl();
    setField(service, "actionDao", dao);
    setField(service, "functionDao", functions);
    return service;
  }

  private <T> T withJdbc(T dao) {
    setField(dao, "jdbcTemplate", jdbc);
    return dao;
  }

  private <T> void stubList(String table, List<T> rows) {
    when(jdbc.query(contains(table), ArgumentMatchers.<RowMapper<T>>any(), any(Object[].class))).thenReturn(rows);
  }

  private void stubFunctions(int size, String operation) {
    var rows = indices(size).mapToObj(i -> {
      var function = new Function();
      function.setId("function-" + i);
      function.setDomainId(DOMAIN);
      function.setOperation(operation);
      return function;
    }).toList();
    when(jdbc.query(contains(" FROM function "), any(PreparedStatementSetter.class),
        ArgumentMatchers.<RowMapper<Function>>any())).thenReturn(rows);
  }

  private Map<String, String> directoryNames(int size, boolean executor) {
    var reviewers = indices(size).mapToObj(i -> "reviewer-" + i);
    var executors = executor ? indices(size).mapToObj(i -> "executor-" + i) : Stream.<String>empty();
    var names = Stream.concat(Stream.of(AUTHOR), Stream.concat(reviewers, executors))
        .collect(Collectors.toMap(id -> id, id -> "Name of " + id));
    when(directory.displayNamesInDomain(eq(DOMAIN), any())).thenAnswer(call -> {
      Set<String> requested = call.getArgument(1);
      return names.entrySet().stream().filter(entry -> requested.contains(entry.getKey()))
          .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
    });
    return names;
  }

  private JsonNode queryList(Object controller, String url, int size) throws Exception {
    setField(controller, "subjectDirectory", directory);
    setField(controller, "objectMapper", mapper);
    setField(controller, "langService", messages);
    var mvc = MockMvcBuilders.standaloneSetup(controller)
        .setMessageConverters(new MappingJackson2HttpMessageConverter(mapper)).build();
    try (var identity = mockStatic(SystemUtils.class)) {
      identity.when(SystemUtils::getCurUser).thenReturn(new GrantUser(AUTHOR, DOMAIN));
      var body = mvc.perform(post(url).contentType(MediaType.APPLICATION_JSON).content("{}"))
          .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
      var result = mapper.readTree(body);
      assertTrue(result.path("success").asBoolean(), body);
      var rows = result.path("data");
      assertEquals(size, rows.size());
      return rows;
    }
  }

  private static void assertOwnerNames(JsonNode rows, Map<String, String> names) {
    for (int i = 0; i < rows.size(); i++) {
      assertEquals(names.get(AUTHOR), rows.get(i).path("createdByName").asText());
      assertEquals(names.get("reviewer-" + i), rows.get(i).path("reviewedByName").asText());
    }
  }

  private static void assertHydratedFunctions(JsonNode rows) {
    for (int i = 0; i < rows.size(); i++) {
      assertEquals("function-" + i, rows.get(i).path("function").path("id").asText());
    }
  }

  private void assertBatchedFunctions(int size) {
    verify(functions).queryByIds(indices(size).mapToObj(i -> "function-" + i).collect(Collectors.toSet()));
    verifyNoMoreInteractions(functions);
  }

  private void assertBoundaryReads(Map<String, String> names) {
    verify(directory).displayNamesInDomain(DOMAIN, names.keySet());
    verifyNoMoreInteractions(directory); // In particular, no enumeration of all members and effective roles.
    verify(subjects).resolveRoles(DOMAIN, AUTHOR);
    verify(policies).policies(DOMAIN, Set.of());
    verifyNoMoreInteractions(policies);
  }

  private List<Invocation> jdbcCalls() {
    return List.copyOf(mockingDetails(jdbc).getInvocations());
  }

  private static boolean isMetricBindingRead(Invocation call) {
    return call.getMethod().getName().equals("query") && call.<String>getArgument(0).contains(METRIC_BINDING_TABLE);
  }

  private static void assertJdbcBudget(int max, List<Invocation> reads) {
    assertTrue(reads.size() <= max, () -> "JDBC budget " + max + " exceeded: " + reads);
  }

  private static IntStream indices(int size) {
    return IntStream.range(0, size);
  }
}
