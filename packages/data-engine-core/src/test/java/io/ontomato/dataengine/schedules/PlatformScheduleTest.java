package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;
import static org.awaitility.Awaitility.await;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.HttpServer;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.service.agent.AgentRuntimeClient;
import io.ontomato.dataengine.service.impl.ABCProgramServiceImpl;
import io.ontomato.dataengine.service.impl.PythonExecuteServiceImpl;
import io.ontomato.dataengine.service.scheduling.*;
import io.ontomato.dataengine.service.sys.bean.UserDetail;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.test.PostgresTestDatabase;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.support.TransactionTemplate;

class PlatformScheduleTest extends PostgresTestDatabase {
  private TaskStore store;
  private TransactionTemplate transactions;
  private FunctionDao functions;
  private IdentityService identities;
  private ScheduleIdentity identity;
  private TaskCredentials credentials;
  private ScheduleApplications applications;
  private OntologyScheduleApplication ontology;
  private PlatformTasks tasks;
  private UserDetail user;
  private ActionService actions;
  private ABCProgramServiceImpl programs;
  private OntologyScheduleReferences references;
  private MockMvc http;

  @BeforeEach
  void setup() {
    functions = wire(new FunctionDao());
    functions.initIndex();
    jdbc.execute("CREATE TABLE action(id varchar(64) PRIMARY KEY)");
    store = new TaskStore(jdbc, JSON, dataSource);
    store.initialize();
    transactions = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
    references = new OntologyScheduleReferences(jdbc);
    ReflectionTestUtils.invokeMethod(references, "initialize");
    user = new UserDetail();
    user.setId("alice");
    user.setDomainId("sales");
    user.setEnable(true);
    identities = mock(IdentityService.class);
    when(identities.getCurrentUser()).thenReturn(user);
    identity = mock(ScheduleIdentity.class);
    when(identity.creator("sales", "alice")).thenReturn(user);
    var permission = new UserDataPermission();
    permission.setFullData(true);
    when(identity.dataPermission(anyString(), anyString())).thenReturn(permission);
    when(identity.interactiveLogin()).thenReturn(true);
    when(identity.issueKey(user)).thenReturn("test-key");
    when(identity.accepts("test-key", "sales", "alice")).thenReturn(true);
    credentials = new TaskCredentials(store, identity, "test-seal");
    actions = mock(ActionService.class);
    when(actions.queryList(anyString(), isNull(), isNull(), anyString())).thenReturn(List.of());
    programs = new ABCProgramServiceImpl();
    var configs = mock(BusinessConfigService.class);
    var config = new BusinessConfig();
    config.setReportCardPythonTimeout(1);
    when(configs.get("sales")).thenReturn(config);
    ontology =
        new OntologyScheduleApplication(
            functions, actions, programs, configs, identities, references);
    var remote = mock(WorkbenchScheduleApplications.class);
    when(remote.ids()).thenReturn(Set.of());
    applications = new ScheduleApplications(List.of(ontology), remote);
    tasks = new PlatformTasks(store, identities, identity, credentials, applications, transactions);
    ReflectionTestUtils.setField(tasks, "configuredZone", "Asia/Shanghai");
    http = MockMvcBuilders.standaloneSetup(new PlatformTaskController(tasks)).build();
    jdbc.update(
        "INSERT INTO function(id,name,domain_id,operation,parameters,code) VALUES('f','Post"
            + " balances','sales',?,'[]',?)",
        Function.OPERATION_WRITE,
        "# ontomato-python:2\nprint('done')");
  }

  private JsonNode definition(String execution) {
    Function function = functions.queryById("f");
    return object(
        "title",
        "Daily posting",
        "appId",
        "ontology",
        "content",
        object("execution", execution),
        "formRevision",
        OntologyScheduleApplication.formRevision(
            function, execution.startsWith("action:") ? "a" : null),
        "frequency",
        object("kind", "interval", "every", 1, "unit", "hour"),
        "timeZone",
        "Asia/Shanghai",
        "notifyEmail",
        null);
  }

  private void sample(String schema, JsonNode value) throws Exception {
    String output = System.getenv("SCHEDULE_CONTRACT_OUTPUT");
    if (output != null)
      Files.writeString(
          Path.of(output),
          object("schema", schema, "value", value).toString() + "\n",
          java.nio.file.StandardOpenOption.CREATE,
          java.nio.file.StandardOpenOption.APPEND);
  }

  @Test
  void privateOwnershipTypedHttpAndRevisionChecks() throws Exception {
    UUID id = UUID.randomUUID();
    var definition = definition("function:f");
    var created =
        http.perform(
                post("/platform/scheduled-tasks")
                    .header("Idempotency-Key", id)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(definition.toString()))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse();
    var task = parse(created.getContentAsString());
    sample("platformTaskSchema", task);
    assertEquals("alice", task.path("creatorId").asText());
    http.perform(
            post("/platform/scheduled-tasks")
                .header("Idempotency-Key", id)
                .contentType(MediaType.APPLICATION_JSON)
                .content(definition.toString()))
        .andExpect(status().isOk());
    user.setId("bob");
    assertEquals(0, tasks.list(null).path("tasks").size());
    http.perform(get("/platform/scheduled-tasks/" + id)).andExpect(status().isNotFound());
    user.setId("alice");
    var invalid =
        ((com.fasterxml.jackson.databind.node.ObjectNode) definition.deepCopy())
            .put("ownerId", "bob");
    http.perform(
            post("/platform/scheduled-tasks")
                .header("Idempotency-Key", UUID.randomUUID())
                .contentType(MediaType.APPLICATION_JSON)
                .content(invalid.toString()))
        .andExpect(status().isBadRequest());
    var update =
        ((com.fasterxml.jackson.databind.node.ObjectNode) definition.deepCopy()).put("revision", 2);
    http.perform(
            put("/platform/scheduled-tasks/" + id)
                .contentType(MediaType.APPLICATION_JSON)
                .content(update.toString()))
        .andExpect(status().isConflict());
    var switched = tasks.enabled(id, object("enabled", false, "revision", 1), "en");
    sample("platformTaskSchema", switched);
    assertNull(store.get(id, false).nextRunAt());
    sample("platformTaskListSchema", tasks.list(null));
    sample("platformScheduleApplicationsSchema", tasks.applications("zh-CN"));
  }

  @Test
  void governanceUsesThePersistedCreatorAndItsOwnWorkRecord() throws Exception {
    var agentStore =
        new io.ontomato.dataengine.service.agent.OntologyAgentStore(
            jdbc, transactions.getTransactionManager());
    agentStore.initialize();
    var grants =
        new QueryGrantService(
            jdbc, "governance-signing", new WorkbenchServiceAuthentication("service"));
    grants.initialize();
    var captured = new AtomicReference<com.alibaba.fastjson2.JSONObject>();
    var fixtureError = new AtomicReference<Throwable>();
    var fixture = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    fixture.createContext(
        "/v1",
        exchange -> {
          byte[] response;
          try {
            String path = exchange.getRequestURI().getPath();
            if (exchange.getRequestMethod().equals("POST") && path.endsWith("/runs")) {
              var request =
                  com.alibaba.fastjson2.JSON.parseObject(exchange.getRequestBody().readAllBytes());
              String run = exchange.getRequestHeaders().getFirst("Idempotency-Key");
              String token =
                  request
                      .getJSONObject("environment")
                      .getJSONObject("secrets")
                      .getString("ONTOMATO_GOVERNANCE_TK");
              captured.set(
                  grants.verify(
                      token,
                      run,
                      "/ontology/ai/knowledge-governance/session/runs/" + run + "/actions/read"));
              response = "{}".getBytes();
            } else if (path.endsWith("/status"))
              response = "{\"run\":{\"status\":\"stopped\",\"stopReason\":\"stop\"}}".getBytes();
            else if (path.endsWith("/final-reply"))
              response =
                  "{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"Review completed\"}]}"
                      .getBytes();
            else response = "{\"latestRun\":null}".getBytes();
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
          } catch (Throwable error) {
            fixtureError.set(error);
            response = error.toString().getBytes();
            exchange.sendResponseHeaders(500, response.length);
            exchange.getResponseBody().write(response);
          } finally {
            exchange.close();
          }
        });
    fixture.start();
    try {
      var runtime =
          new AgentRuntimeClient(
              "http://127.0.0.1:" + fixture.getAddress().getPort(), "host", "http://fixture");
      var definitions = mock(io.ontomato.dataengine.service.agent.OntologyAgentDefinitions.class);
      when(definitions.resource(anyString())).thenCallRealMethod();
      when(definitions.governance(anyString(), anyString(), anyLong()))
          .thenReturn(new com.alibaba.fastjson2.JSONObject());
      var governance =
          new io.ontomato.dataengine.service.agent.KnowledgeGovernanceService(
              agentStore,
              runtime,
              definitions,
              grants,
              mock(KnowledgeService.class),
              mock(AdminService.class));
      governance.initialize();
      when(identities.hasKnowledgeGovernanceAccess("alice", "sales")).thenReturn(true);
      var access =
          new io.ontomato.dataengine.service.agent.OntologyAgentAccess(
              mock(QueryAccessService.class), identities, grants, agentStore);
      var provider =
          new io.ontomato.dataengine.service.agent.scheduling.GovernanceScheduleApplication(
              governance, access, runtime, agentStore, identities);
      var registry = new ScheduleApplications(List.of(provider), mockWorkbench());
      var service =
          new PlatformTasks(store, identities, identity, credentials, registry, transactions);
      ReflectionTestUtils.setField(service, "configuredZone", "UTC");
      UUID task = UUID.randomUUID(), run = UUID.randomUUID();
      var input = fixtureDefinition("governance");
      ((com.fasterxml.jackson.databind.node.ObjectNode) input)
          .set("content", object("instruction", "Review knowledge"));
      ((com.fasterxml.jackson.databind.node.ObjectNode) input).put("formRevision", "governance-v1");
      service.create(task, input, "en", true);
      service.manual(task, run, "en");
      var scheduler =
          new PlatformScheduler(
              store, transactions, registry, credentials, identity, mock(TaskMail.class));
      try {
        scheduler.dispatch(run);
        assertNull(fixtureError.get(), String.valueOf(fixtureError.get()));
        assertEquals("alice", captured.get().getString("userId"));
        assertEquals("sales", captured.get().getString("domainId"));
        assertEquals("knowledge-governance", captured.get().getString("purpose"));
        jdbc.update(
            "UPDATE ontology_governance_work SET work=jsonb_set(work,'{summary}','\"Three"
                + " recommendations\"') WHERE run_id=?",
            run);
        scheduler.settle(Instant.now());
        assertEquals("completed", store.run(run).status());
        assertEquals("Three recommendations", store.run(run).resultSummary());
        assertEquals("Review completed", store.run(run).result());
        sample("platformTaskRunSchema", store.run(run).wire());
        assertEquals(
            0, jdbc.queryForObject("SELECT count(*) FROM platform_task_credential", Integer.class));
        when(identities.hasKnowledgeGovernanceAccess("alice", "sales")).thenReturn(false);
        assertEquals(
            "PERMISSION_DENIED",
            assertThrows(
                    ScheduleException.class, () -> service.manual(task, UUID.randomUUID(), "en"))
                .code);
      } finally {
        scheduler.stop();
      }
    } finally {
      fixture.stop(0);
    }
  }

  @Test
  void localApplicationDenialsUseTheRequestAndPersistedRunLanguageWithoutPermissionCodes()
      throws Exception {
    doThrow(
            new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.FORBIDDEN,
                "Operation permission is required: /action/execute"))
        .when(identities)
        .requireActionExecutionAccess("alice", "sales");
    var governance =
        new io.ontomato.dataengine.service.agent.scheduling.GovernanceScheduleApplication(
            mock(io.ontomato.dataengine.service.agent.KnowledgeGovernanceService.class),
            mock(io.ontomato.dataengine.service.agent.OntologyAgentAccess.class),
            mock(AgentRuntimeClient.class),
            mock(io.ontomato.dataengine.service.agent.OntologyAgentStore.class),
            identities);
    var registry = new ScheduleApplications(List.of(ontology, governance), mockWorkbench());
    var service =
        new PlatformTasks(store, identities, identity, credentials, registry, transactions);
    ReflectionTestUtils.setField(service, "configuredZone", "UTC");
    var mvc = MockMvcBuilders.standaloneSetup(new PlatformTaskController(service)).build();
    for (String locale : List.of("zh-CN", "en")) {
      var directoryResponse =
          mvc.perform(
                  get("/platform/scheduled-tasks/applications").header("Accept-Language", locale))
              .andExpect(status().isOk())
              .andReturn()
              .getResponse();
      var directory = parse(directoryResponse.getContentAsString());
      sample("platformScheduleApplicationsSchema", directory);
      for (String app : List.of("ontology", "governance")) {
        String expected =
            app.equals("ontology")
                ? (locale.equals("zh-CN")
                    ? "你没有执行动作或函数的权限"
                    : "You do not have permission to execute actions or functions")
                : (locale.equals("zh-CN")
                    ? "你没有治理业务知识的权限"
                    : "You do not have permission to govern business knowledge");
        var descriptor =
            java.util.stream.StreamSupport.stream(
                    directory.path("applications").spliterator(), false)
                .filter(value -> app.equals(value.path("id").asText()))
                .findFirst()
                .orElseThrow();
        assertFalse(descriptor.path("available").asBoolean());
        assertEquals(expected, descriptor.path("unavailableReason").asText());
        var input =
            (com.fasterxml.jackson.databind.node.ObjectNode)
                (app.equals("ontology") ? definition("function:f") : fixtureDefinition(app));
        if (app.equals("governance")) {
          input.set("content", object("instruction", "Review knowledge"));
          input.put("formRevision", "governance-v1");
        }
        UUID taskId = UUID.randomUUID();
        store.insert(
            taskId,
            "sales",
            "alice",
            TaskDefinition.input(input, "UTC", false),
            array(),
            locale,
            Instant.now(),
            true);
        for (var request :
            List.of(
                post("/platform/scheduled-tasks/applications/" + app + "/form")
                    .content(
                        object(
                                "values",
                                object(),
                                "changedField",
                                null,
                                "taskId",
                                null,
                                "timeZone",
                                "UTC")
                            .toString()),
                post("/platform/scheduled-tasks")
                    .header("Idempotency-Key", UUID.randomUUID())
                    .content(input.toString()),
                put("/platform/scheduled-tasks/" + taskId)
                    .content(
                        ((com.fasterxml.jackson.databind.node.ObjectNode) input.deepCopy())
                            .put("revision", 1)
                            .toString()),
                post("/platform/scheduled-tasks/" + taskId + "/runs")
                    .header("Idempotency-Key", UUID.randomUUID())
                    .content("{}"),
                put("/platform/scheduled-tasks/" + taskId + "/enabled")
                    .content(object("enabled", true, "revision", 1).toString()))) {
          var response =
              mvc.perform(
                      request
                          .header("Accept-Language", locale)
                          .contentType(MediaType.APPLICATION_JSON))
                  .andExpect(status().isForbidden())
                  .andReturn()
                  .getResponse();
          var body = parse(response.getContentAsString());
          assertEquals("PERMISSION_DENIED", body.path("error").path("code").asText());
          assertEquals(expected, body.path("error").path("message").asText());
          assertFalse(body.path("error").path("message").asText().contains("/action/execute"));
          sample("platformScheduleErrorSchema", body);
        }
        UUID runId = UUID.randomUUID();
        transactions.executeWithoutResult(
            tx -> store.admit(store.get(taskId, false), runId, "schedule", Instant.now()));
        var scheduler =
            new PlatformScheduler(
                store, transactions, registry, credentials, identity, mock(TaskMail.class));
        try {
          scheduler.dispatch(runId);
          assertEquals("permission_denied", store.run(runId).error().code());
          assertEquals(expected, store.run(runId).error().message());
          assertEquals(expected, store.get(taskId, false).pause().message());
          sample("platformTaskRunSchema", store.run(runId).wire());
        } finally {
          scheduler.stop();
        }
      }
    }
  }

  @Test
  void actionAuthorizationDependencyErrorsRemainDependencyErrors() {
    var unavailable =
        new org.springframework.web.server.ResponseStatusException(
            org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
            "Identity service unavailable");
    doThrow(unavailable).when(identities).requireActionExecutionAccess("alice", "sales");
    var actor =
        new ScheduleApplication.Actor(
            user, identity.dataPermission("sales", "alice"), null, null, "zh-CN");
    assertSame(
        unavailable,
        assertThrows(
            org.springframework.web.server.ResponseStatusException.class,
            () -> ontology.authorize(actor)));
  }

  @Test
  void emptyObjectPostBodiesFromTheWorkbenchAreAccepted() throws Exception {
    UUID taskId = UUID.randomUUID();
    tasks.create(taskId, definition("function:f"), "en", true);
    http.perform(
            post("/platform/scheduled-tasks/credential/renew")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
        .andExpect(status().isNoContent());
    var response =
        http.perform(
                post("/platform/scheduled-tasks/" + taskId + "/runs")
                    .header("Idempotency-Key", UUID.randomUUID())
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{}"))
            .andExpect(status().isAccepted())
            .andReturn()
            .getResponse();
    sample("platformTaskRunSchema", parse(response.getContentAsString()));
  }

  @Test
  void dynamicFormsClearParametersAndPreserveUnavailableTargets() throws Exception {
    var parameter = new Parameter();
    parameter.setName("departments");
    parameter.setType(Parameter.TYPE_STRING_ARRAY);
    jdbc.update(
        "UPDATE function SET parameters=? WHERE id='f'",
        com.alibaba.fastjson2.JSON.toJSONString(List.of(parameter)));
    var actor =
        new ScheduleApplication.Actor(
            user, identity.dataPermission("sales", "alice"), null, null, "en");
    var form =
        ontology.form(
            new ScheduleApplication.FormInput(
                object("execution", "function:f", "parameter:obsolete", "old"),
                "execution",
                null,
                "Asia/Shanghai"),
            actor);
    assertFalse(form.path("values").has("parameter:obsolete"));
    assertEquals("", form.path("values").path("parameter:departments").asText());
    sample("platformScheduleFormSchema", form);
    var removed =
        ontology.form(
            new ScheduleApplication.FormInput(
                object("execution", "function:missing"), null, UUID.randomUUID(), "Asia/Shanghai"),
            actor);
    assertFalse(removed.path("submittable").asBoolean());
    sample("platformScheduleFormSchema", removed);
  }

  @Test
  void retiredActionAndFunctionProtocolsAreDisabledAndPauseExistingTasksWithTheExecutorReason()
      throws Exception {
    var grants =
        new QueryGrantService(
            jdbc, "fixture-signing", new WorkbenchServiceAuthentication("service"));
    grants.initialize();
    var runtime = mock(RuntimeCodeClient.class);
    ReflectionTestUtils.setField(
        programs, "pythonExecuteService", new PythonExecuteServiceImpl(runtime, grants));
    var action = new Action();
    action.setId("a");
    action.setName("Legacy action");
    action.setDomainId("sales");
    action.setStatus(Action.STATUS_PUBLISHED);
    action.setFunction(functions.queryById("f"));
    when(actions.queryById("a")).thenReturn(action);
    when(actions.queryList(Action.STATUS_PUBLISHED, null, null, "sales"))
        .thenReturn(List.of(action));
    jdbc.update("INSERT INTO action VALUES('a')");
    var manual = spy(new io.ontomato.dataengine.service.impl.ActionServiceImpl());
    doReturn(action).when(manual).queryById("a");
    ReflectionTestUtils.setField(manual, "identity", identities);
    ReflectionTestUtils.setField(manual, "abcProgramService", programs);
    String current = "# ontomato-python:2\nprint('current')", legacy = "print('retired')";
    for (String locale : List.of("en", "zh-CN"))
      for (String target : List.of("action:a", "function:f")) {
        jdbc.update("UPDATE function SET code=? WHERE id='f'", current);
        action.getFunction().setCode(current);
        var input = definition(target);
        UUID task = UUID.randomUUID(), run = UUID.randomUUID();
        tasks.create(task, input, locale, true);
        tasks.manual(task, run, locale);
        jdbc.update("UPDATE function SET code=? WHERE id='f'", legacy);
        action.getFunction().setCode(legacy);
        var direct =
            assertThrows(
                ProgramExecutionException.class,
                () ->
                    manual.execute(
                        "a",
                        new com.alibaba.fastjson2.JSONObject(),
                        locale,
                        user,
                        identity.dataPermission("sales", "alice"),
                        1));
        var actor =
            new ScheduleApplication.Actor(
                user, identity.dataPermission("sales", "alice"), null, null, locale);
        var form =
            ontology.form(
                new ScheduleApplication.FormInput(
                    object("execution", target), null, task, "Asia/Shanghai"),
                actor);
        var option =
            java.util.stream.StreamSupport.stream(
                    form.path("fields").get(0).path("options").spliterator(), false)
                .filter(value -> target.equals(value.path("value").asText()))
                .findFirst()
                .orElseThrow();
        assertTrue(option.path("disabled").asBoolean());
        assertEquals(direct.getMessage(), option.path("disabledReason").asText());
        assertFalse(form.path("submittable").asBoolean());
        sample("platformScheduleFormSchema", form);
        var refused =
            assertThrows(
                ScheduleException.class,
                () -> tasks.create(UUID.randomUUID(), input, locale, true));
        assertEquals("TARGET_UNAVAILABLE", refused.code);
        assertEquals(direct.getMessage(), refused.getReason());
        var scheduler =
            new PlatformScheduler(
                store, transactions, applications, credentials, identity, mock(TaskMail.class));
        try {
          scheduler.dispatch(run);
        } finally {
          scheduler.stop();
        }
        var record = store.run(run);
        assertEquals("target_unavailable", record.error().code());
        assertEquals(direct.getMessage(), record.error().message());
        assertEquals("target_unavailable", store.get(task, false).pause().code());
        assertEquals(direct.getMessage(), store.get(task, false).pause().message());
        sample("platformTaskRunSchema", record.wire());
        assertEquals(
            "TARGET_UNAVAILABLE",
            assertThrows(
                    ScheduleException.class, () -> tasks.manual(task, UUID.randomUUID(), locale))
                .code);
        var update = (com.fasterxml.jackson.databind.node.ObjectNode) input.deepCopy();
        update.put("revision", store.get(task, false).revision());
        assertEquals(
            "TARGET_UNAVAILABLE",
            assertThrows(ScheduleException.class, () -> tasks.update(task, update, locale)).code);
      }
    verifyNoInteractions(runtime);
    assertEquals(
        0, jdbc.queryForObject("SELECT count(*) FROM query_runtime_grants", Integer.class));
  }

  @Test
  void actionAndFunctionTransportFailuresKeepTheSameSafeReasonAsManualExecution() throws Exception {
    var entrance = new BackendSessionEntrance();
    ReflectionTestUtils.setField(
        entrance, "sessionRegistryService", mock(SessionRegistryService.class));
    entrance.publishInstance();
    var grants =
        new QueryGrantService(
            jdbc, "fixture-signing", new WorkbenchServiceAuthentication("service"));
    grants.initialize();
    var runtime = mock(RuntimeCodeClient.class);
    when(runtime.pythonHelper()).thenReturn("# fixture helper");
    when(runtime.ontologyUrl()).thenReturn("http://fixture");
    var cause = new AtomicReference<Exception>();
    doAnswer(
            call -> {
              throw cause.get();
            })
        .when(runtime)
        .request(
            anyString(), anyString(), eq("/v1/code-executions"), eq("POST"), any(), anyString());
    ReflectionTestUtils.setField(
        programs, "pythonExecuteService", new PythonExecuteServiceImpl(runtime, grants));
    var action = new Action();
    action.setId("a");
    action.setDomainId("sales");
    action.setName("Action");
    action.setStatus(Action.STATUS_PUBLISHED);
    action.setFunction(functions.queryById("f"));
    when(actions.queryById("a")).thenReturn(action);
    when(actions.queryList(Action.STATUS_PUBLISHED, null, null, "sales"))
        .thenReturn(List.of(action));
    jdbc.update("INSERT INTO action VALUES('a')");
    var manual = spy(new io.ontomato.dataengine.service.impl.ActionServiceImpl());
    doReturn(action).when(manual).queryById("a");
    ReflectionTestUtils.setField(manual, "identity", identities);
    ReflectionTestUtils.setField(manual, "abcProgramService", programs);
    for (Exception failure :
        List.of(
            new java.io.IOException(
                "https://user:private-password@host Authorization: Bearer synthetic-secret\n"
                    + " at private.Client.call(Client.java:1)"),
            new java.net.http.HttpTimeoutException("X-API-Key: synthetic-secret"))) {
      cause.set(failure);
      for (String locale : List.of("en", "zh-CN"))
        for (String target : List.of("action:a", "function:f")) {
          UUID task = UUID.randomUUID(), run = UUID.randomUUID();
          tasks.create(task, definition(target), locale, true);
          tasks.manual(task, run, locale);
          var scheduler =
              new PlatformScheduler(
                  store, transactions, applications, credentials, identity, mock(TaskMail.class));
          try {
            scheduler.dispatch(run);
          } finally {
            scheduler.stop();
          }
          var direct =
              assertThrows(
                  ProgramExecutionException.class,
                  () ->
                      manual.execute(
                          "a",
                          new com.alibaba.fastjson2.JSONObject(),
                          locale,
                          user,
                          identity.dataPermission("sales", "alice"),
                          1));
          var record = store.run(run);
          assertEquals("run_failed", record.error().code());
          assertEquals(direct.getMessage(), record.error().message());
          assertEquals(
              failure instanceof java.net.http.HttpTimeoutException
                  ? (locale.equals("zh-CN") ? "程序执行超时" : "Python execution timed out")
                  : (locale.equals("zh-CN")
                      ? "暂时无法连接程序运行服务"
                      : "The program runtime could not be reached"),
              record.error().message());
          assertFalse(record.wire().toString().contains("synthetic-secret"));
          assertFalse(record.wire().toString().contains("private-password"));
          assertFalse(record.wire().toString().contains("Client.java"));
          assertNull(store.get(task, false).pause());
          sample("platformTaskRunSchema", record.wire());
        }
    }
  }

  @Test
  void scheduledActionsAndFunctionsReachRealGrantSigningAndVerification() throws Exception {
    jdbc.update(
        "UPDATE function SET parameters=? WHERE id='f'",
        """
        [{"name":"org_id","type":"TYPE_STRING"},{"name":"up","type":"TYPE_NUMBER"},
         {"name":"tags","type":"TYPE_STRING_ARRAY"},{"name":"amounts","type":"TYPE_NUMBER_ARRAY"},
         {"name":"dates","type":"TYPE_TIME_ARRAY"},{"name":"cutoff","type":"TYPE_TIME"}]
        """);
    var grants =
        new QueryGrantService(jdbc, "test-signing", new WorkbenchServiceAuthentication("service"));
    grants.initialize();
    var claims = new AtomicReference<com.alibaba.fastjson2.JSONObject>();
    var fixtureError = new AtomicReference<Throwable>();
    var failureStderr = new AtomicReference<String>();
    var fixture = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    fixture.createContext(
        "/v1/code-executions",
        exchange -> {
          byte[] output;
          try {
            if (exchange.getRequestMethod().equals("POST")) {
              var body =
                  com.alibaba.fastjson2.JSON.parseObject(exchange.getRequestBody().readAllBytes());
              var files = body.getJSONArray("files");
              var parameterFile =
                  files.stream()
                      .map(com.alibaba.fastjson2.JSONObject::from)
                      .filter(file -> "parameters.json".equals(file.getString("path")))
                      .findFirst()
                      .orElseThrow();
              var parameters =
                  com.alibaba.fastjson2.JSON.parseObject(parameterFile.getString("content"));
              assertTrue(parameters.containsKey("org_id"));
              assertNull(parameters.get("org_id"));
              assertTrue(parameters.containsKey("up"));
              assertNull(parameters.get("up"));
              for (String key : List.of("tags", "amounts", "dates"))
                assertTrue(parameters.getJSONArray(key).isEmpty());
              assertNotNull(Instant.parse(parameters.getString("cutoff")));
              String token =
                  body.getJSONObject("environment")
                      .getJSONObject("secrets")
                      .getString("ONTOMATO_TK");
              String run = exchange.getRequestHeaders().getFirst("Idempotency-Key");
              claims.set(grants.verify(token, run, "/writeFunctionOperation/update"));
              assertEquals("alice", claims.get().getString("userId"));
              assertEquals("sales", claims.get().getString("domainId"));
              assertEquals("sandbox-write", claims.get().getString("purpose"));
              var request = new MockHttpServletRequest();
              request.addHeader("tk", token);
              request.setAttribute(QueryGrantService.ATTRIBUTE, claims.get());
              var lookup = mock(DataPermissionLookup.class);
              var currentPermission = identity.dataPermission("sales", "alice");
              when(lookup.getDataPermission("alice", "sales")).thenReturn(currentPermission);
              assertEquals(
                  "alice",
                  new QueryAccessService(identities, lookup, grants)
                      .access(request)
                      .user()
                      .getId());
              output = "{}".getBytes();
            } else if (exchange.getRequestURI().getPath().endsWith("/outputs/stdout"))
              output = "done".getBytes();
            else if (exchange.getRequestURI().getPath().endsWith("/outputs/stderr"))
              output = failureStderr.get().getBytes();
            else if (failureStderr.get() != null)
              output =
                  "{\"status\":\"stopped\",\"exitCode\":1,\"outputs\":[{\"name\":\"stderr\"}]}"
                      .getBytes();
            else
              output =
                  "{\"status\":\"stopped\",\"exitCode\":0,\"outputs\":[{\"name\":\"stdout\"}]}"
                      .getBytes();
            exchange.sendResponseHeaders(200, output.length);
            exchange.getResponseBody().write(output);
          } catch (Throwable failure) {
            fixtureError.set(failure);
            output = failure.toString().getBytes();
            exchange.sendResponseHeaders(500, output.length);
            exchange.getResponseBody().write(output);
          } finally {
            exchange.close();
          }
        });
    fixture.start();
    try {
      var entrance = new BackendSessionEntrance();
      ReflectionTestUtils.setField(
          entrance, "sessionRegistryService", mock(SessionRegistryService.class));
      entrance.publishInstance();
      var runtime =
          new AgentRuntimeClient(
              "http://127.0.0.1:" + fixture.getAddress().getPort(), "host", "http://fixture");
      ReflectionTestUtils.setField(
          programs,
          "pythonExecuteService",
          new PythonExecuteServiceImpl(new RuntimeCodeClient(runtime), grants));
      var action = new Action();
      action.setId("a");
      action.setName("Action posting");
      action.setDomainId("sales");
      action.setStatus(Action.STATUS_PUBLISHED);
      action.setFunction(functions.queryById("f"));
      when(actions.queryById("a")).thenReturn(action);
      when(actions.queryList(Action.STATUS_PUBLISHED, null, null, "sales"))
          .thenReturn(List.of(action));
      jdbc.update("INSERT INTO action VALUES('a')");
      for (String target : List.of("function:f", "action:a")) {
        UUID id = UUID.randomUUID();
        var input = (com.fasterxml.jackson.databind.node.ObjectNode) definition(target);
        input.set(
            "content",
            object(
                "execution",
                target,
                "parameter:org_id",
                "",
                "parameter:up",
                "  ",
                "parameter:tags",
                "\n",
                "parameter:amounts",
                "",
                "parameter:dates",
                "",
                "parameter:cutoff",
                ""));
        var form =
            ontology.form(
                new ScheduleApplication.FormInput(
                    input.get("content"), null, null, "Asia/Shanghai"),
                new ScheduleApplication.Actor(
                    user, identity.dataPermission("sales", "alice"), null, null, "en"));
        for (var field : form.path("fields"))
          if (field.path("key").asText().startsWith("parameter:"))
            assertFalse(field.path("required").asBoolean());
        assertTrue(form.path("submittable").asBoolean());
        sample("platformScheduleFormSchema", form);
        tasks.create(id, input, "en", true);
        UUID runId = UUID.randomUUID();
        tasks.manual(id, runId, "en");
        var scheduler =
            new PlatformScheduler(
                store, transactions, applications, credentials, identity, mock(TaskMail.class));
        scheduler.dispatch(runId);
        scheduler.stop();
        var result = store.run(runId);
        assertNull(fixtureError.get(), String.valueOf(fixtureError.get()));
        assertEquals("completed", result.status(), String.valueOf(result.error()));
        assertEquals("done", result.result());
        assertNotNull(claims.get());
        sample("platformTaskRunSchema", result.wire());
        assertTrue(references.references("f"));
      }
      failureStderr.set(
          "Traceback (most recent call last):\n"
              + "  File \"/private/program.py\", line 7, in main\n"
              + "    raise ValueError('X-API-Key: synthetic-secret')\n"
              + "ValueError: private-password\n");
      var manual = spy(new io.ontomato.dataengine.service.impl.ActionServiceImpl());
      doReturn(action).when(manual).queryById("a");
      ReflectionTestUtils.setField(manual, "identity", identities);
      ReflectionTestUtils.setField(manual, "abcProgramService", programs);
      for (String locale : List.of("en", "zh-CN"))
        for (String target : List.of("action:a", "function:f")) {
          UUID task = UUID.randomUUID(), run = UUID.randomUUID();
          var input = (com.fasterxml.jackson.databind.node.ObjectNode) definition(target);
          input.set(
              "content",
              object(
                  "execution",
                  target,
                  "parameter:org_id",
                  "",
                  "parameter:up",
                  "",
                  "parameter:tags",
                  "",
                  "parameter:amounts",
                  "",
                  "parameter:dates",
                  "",
                  "parameter:cutoff",
                  ""));
          tasks.create(task, input, locale, true);
          tasks.manual(task, run, locale);
          var scheduler =
              new PlatformScheduler(
                  store, transactions, applications, credentials, identity, mock(TaskMail.class));
          try {
            scheduler.dispatch(run);
          } finally {
            scheduler.stop();
          }
          var record = store.run(run);
          assertEquals("failed", record.status());
          assertEquals("ValueError at program.py line 7", record.error().message());
          assertFalse(record.wire().toString().contains("synthetic-secret"));
          assertFalse(record.wire().toString().contains("private-password"));
          assertFalse(record.wire().toString().contains("Traceback"));
          sample("platformTaskRunSchema", record.wire());
          var parameters =
              ScheduleParameters.values(
                  action.getFunction(), input.path("content"), "Asia/Shanghai", Instant.now());
          var direct =
              manual.execute(
                  "a", parameters, locale, user, identity.dataPermission("sales", "alice"), 1);
          assertEquals(direct.getError(), record.error().message());
          assertNull(direct.getResult());
          assertNull(fixtureError.get(), String.valueOf(fixtureError.get()));
        }
      verify(identities, atLeastOnce()).requireActionExecutionAccess("alice", "sales");
      assertThrows(
          IllegalArgumentException.class,
          () ->
              grants.issue(
                  null,
                  "sales",
                  "sandbox-write",
                  UUID.randomUUID().toString(),
                  System.currentTimeMillis() + 60000,
                  List.of(),
                  "none"));
    } finally {
      fixture.stop(0);
    }
  }

  @Test
  void liveRunsPreventEditingAndManualReplayKeepsTheSnapshot() {
    UUID id = UUID.randomUUID();
    tasks.create(id, definition("function:f"), "en", true);
    UUID run = UUID.randomUUID();
    var first = tasks.manual(id, run, "en");
    assertEquals(first, tasks.manual(id, run, "en"));
    var update =
        ((com.fasterxml.jackson.databind.node.ObjectNode) definition("function:f"))
            .put("revision", 1);
    assertEquals(
        "TASK_RUNNING",
        assertThrows(ScheduleException.class, () -> tasks.update(id, update, "en")).code);
    assertEquals(
        "TASK_RUNNING",
        assertThrows(ScheduleException.class, () -> tasks.delete(id, "\"1\"")).code);
  }

  @Test
  void revokedExecutionPermissionPausesWithoutNullUserExecution() {
    UUID id = UUID.randomUUID();
    tasks.create(id, definition("function:f"), "en", true);
    UUID run = UUID.randomUUID();
    tasks.manual(id, run, "en");
    doThrow(
            new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.FORBIDDEN, "No execution permission"))
        .when(identities)
        .requireActionExecutionAccess("alice", "sales");
    var scheduler =
        new PlatformScheduler(
            store, transactions, applications, credentials, identity, mock(TaskMail.class));
    scheduler.dispatch(run);
    scheduler.stop();
    assertEquals("permission_denied", store.run(run).error().code());
    assertEquals("permission_denied", store.get(id, false).pause().code());
  }

  private ScheduleApplication fixtureApplication(
      String id, boolean remote, AtomicReference<Boolean> fail) {
    return new ScheduleApplication() {
      public String id() {
        return id;
      }

      public String description(String locale) {
        return "Test scheduling application";
      }

      public boolean remote() {
        return remote;
      }

      public void authorize(Actor actor) {
        if (fail.get()) throw new ScheduleException(403, "PERMISSION_DENIED", "Revoked");
      }

      public JsonNode form(FormInput input, Actor actor) {
        return ScheduleForms.form(id, "v1", array(), object());
      }

      public Validation validate(TaskDefinition definition, Actor actor) {
        return new Validation(definition.content(), "v1", definition.timeZone(), array(), null);
      }

      public JsonNode start(Execution execution, Actor actor) {
        var state = ScheduleForms.execution("running");
        state.set("handle", object("runId", execution.runId()));
        return state;
      }

      public JsonNode status(Execution execution, JsonNode handle) {
        return ScheduleForms.execution("completed");
      }
    };
  }

  private JsonNode fixtureDefinition(String app) {
    return object(
        "title",
        "Fixture",
        "appId",
        app,
        "content",
        object(),
        "formRevision",
        "v1",
        "frequency",
        object("kind", "interval", "every", 1, "unit", "hour"),
        "timeZone",
        "UTC",
        "notifyEmail",
        null);
  }

  @Test
  void dueSlotSkipsAnActiveRunAndScannerSettlesWithoutReadSideEffects() throws Exception {
    var provider = fixtureApplication("fixture", false, new AtomicReference<>(false));
    var registry = new ScheduleApplications(List.of(provider), mockWorkbench());
    var service =
        new PlatformTasks(store, identities, identity, credentials, registry, transactions);
    ReflectionTestUtils.setField(service, "configuredZone", "UTC");
    UUID task = UUID.randomUUID();
    service.create(task, fixtureDefinition("fixture"), "en", true);
    jdbc.update("UPDATE platform_task SET next_run_at=now()-interval '1 second' WHERE id=?", task);
    var scheduler =
        new PlatformScheduler(
            store, transactions, registry, credentials, identity, mock(TaskMail.class));
    ReflectionTestUtils.setField(scheduler, "nextSettlement", Instant.now().plusSeconds(3600));
    try {
      scheduler.tick();
      await()
          .atMost(java.time.Duration.ofSeconds(5))
          .until(
              () -> store.active(task) != null && store.run(store.active(task)).handle() != null);
      UUID run = store.active(task);
      assertEquals("running", service.detail(task, run).path("status").asText());
      jdbc.update(
          "UPDATE platform_task SET next_run_at=now()-interval '1 second' WHERE id=?", task);
      scheduler.tick();
      assertEquals(
          1,
          jdbc.queryForObject(
              "SELECT count(*) FROM platform_task_run WHERE task_id=? AND status='skipped'",
              Integer.class,
              task));
      scheduler.settle(Instant.now());
      assertEquals("completed", store.run(run).status());
      sample("platformTaskRunSchema", store.run(run).wire());
    } finally {
      scheduler.stop();
    }
  }

  private WorkbenchScheduleApplications mockWorkbench() {
    var workbench = mock(WorkbenchScheduleApplications.class);
    when(workbench.ids()).thenReturn(Set.of());
    return workbench;
  }

  @Test
  void credentialRenewalOnlyResumesEnabledTasksAfterRevalidation() {
    var failure = new AtomicReference<>(false);
    var provider = fixtureApplication("fixture", true, failure);
    var registry = new ScheduleApplications(List.of(provider), mockWorkbench());
    var service =
        new PlatformTasks(store, identities, identity, credentials, registry, transactions);
    ReflectionTestUtils.setField(service, "configuredZone", "UTC");
    UUID task = UUID.randomUUID();
    service.create(task, fixtureDefinition("fixture"), "en", true);
    UUID run = UUID.randomUUID();
    service.manual(task, run, "en");
    when(identity.accepts("test-key", "sales", "alice")).thenReturn(false);
    var scheduler =
        new PlatformScheduler(
            store, transactions, registry, credentials, identity, mock(TaskMail.class));
    scheduler.dispatch(run);
    scheduler.stop();
    assertEquals("credential_invalid", store.get(task, false).pause().code());
    when(identity.accepts("test-key", "sales", "alice")).thenReturn(true);
    failure.set(true);
    service.renewOnVisit("en");
    assertEquals("permission_denied", store.get(task, false).pause().code());
    assertNull(store.get(task, false).nextRunAt());
    failure.set(false);
    service.enabled(
        task, object("enabled", true, "revision", store.get(task, false).revision()), "en");
    assertNull(store.get(task, false).pause());
    assertNotNull(store.get(task, false).nextRunAt());
    long revision = store.get(task, false).revision();
    service.enabled(task, object("enabled", false, "revision", revision), "en");
    service.renewOnVisit("en");
    assertFalse(store.get(task, false).enabled());
    assertNull(store.get(task, false).nextRunAt());
  }

  @Test
  void aLateFailureCannotRepauseATaskTheCreatorAlreadyDisabled() {
    var failure = new AtomicReference<>(false);
    var provider = fixtureApplication("fixture", false, failure);
    var registry = new ScheduleApplications(List.of(provider), mockWorkbench());
    var service =
        new PlatformTasks(store, identities, identity, credentials, registry, transactions);
    ReflectionTestUtils.setField(service, "configuredZone", "UTC");
    UUID task = UUID.randomUUID(), run = UUID.randomUUID();
    service.create(task, fixtureDefinition("fixture"), "en", true);
    service.manual(task, run, "en");
    service.enabled(task, object("enabled", false, "revision", 1), "en");
    failure.set(true);
    var scheduler =
        new PlatformScheduler(
            store, transactions, registry, credentials, identity, mock(TaskMail.class));
    scheduler.dispatch(run);
    scheduler.stop();
    assertEquals("failed", store.run(run).status());
    assertNull(store.get(task, false).pause());
    assertFalse(store.get(task, false).enabled());
  }

  @Test
  void workbenchAuthenticationRejectionInvalidatesTheSealedCredentialAndPausesTheTask()
      throws Exception {
    var fixture = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    fixture.createContext(
        "/api/platform/schedule-applications/agents",
        exchange -> {
          assertEquals("test-key", exchange.getRequestHeaders().getFirst("X-API-Key"));
          byte[] body =
              "{\"success\":false,\"code\":\"AUTH_INVALID\",\"error\":\"Invalid credential\"}"
                  .getBytes();
          exchange.sendResponseHeaders(401, body.length);
          exchange.getResponseBody().write(body);
          exchange.close();
        });
    fixture.start();
    try {
      var remote =
          new WorkbenchScheduleApplications(
              "http://127.0.0.1:" + fixture.getAddress().getPort(), "service", identity);
      var registry =
          new ScheduleApplications(List.of(remote.application("agents")), mockWorkbench());
      credentials.prepareForSetup(user);
      UUID task = UUID.randomUUID();
      var definition = TaskDefinition.input(fixtureDefinition("agents"), "UTC", false);
      store.insert(task, "sales", "alice", definition, array(), "en", Instant.now(), true);
      UUID run = UUID.randomUUID();
      transactions.executeWithoutResult(
          tx -> store.admit(store.get(task, false), run, "schedule", Instant.now()));
      var scheduler =
          new PlatformScheduler(
              store, transactions, registry, credentials, identity, mock(TaskMail.class));
      scheduler.dispatch(run);
      scheduler.stop();
      assertEquals("credential_invalid", store.run(run).error().code());
      assertEquals("credential_invalid", store.get(task, false).pause().code());
      assertFalse(
          jdbc.queryForObject(
              "SELECT valid FROM platform_task_credential WHERE domain_id='sales' AND"
                  + " creator_id='alice'",
              Boolean.class));
    } finally {
      fixture.stop(0);
    }
  }

  @Test
  void migrationPreservesHistoryAndDeterministicallySelectsTheOldestBuiltInAdministrator()
      throws Exception {
    jdbc.execute(
        "DROP TABLE ontology_schedule_reference; DROP TABLE platform_task_run; DROP TABLE"
            + " platform_task; DROP TABLE platform_task_credential");
    jdbc.execute(
        """
CREATE TABLE sys_domain(id text PRIMARY KEY);
CREATE TABLE sys_user(id text PRIMARY KEY,active int,enable int);
CREATE TABLE sys_domain_membership(user_id text,domain_id text,is_admin int,create_time timestamptz);
INSERT INTO sys_domain VALUES('sales');
INSERT INTO sys_user VALUES('admin-z',1,1),('admin-a',1,1),('admin-new',1,1);
INSERT INTO sys_domain_membership VALUES('admin-z','sales',1,'2026-01-01Z'),('admin-a','sales',1,'2026-01-01Z'),('admin-new','sales',1,'2026-02-01Z');
CREATE TABLE platform_task(id uuid PRIMARY KEY,domain_id text,owner_id text,app_id text,name text,description text,target jsonb,
frequency jsonb,time_zone text,function_id text GENERATED ALWAYS AS(target->>'functionId') STORED REFERENCES function(id),enabled boolean,paused_reason text,next_run_at timestamptz,notify_email text,locale text,created_at timestamptz,updated_at timestamptz);
CREATE TABLE platform_task_run(id uuid PRIMARY KEY,task_id uuid REFERENCES platform_task(id),target jsonb,session_id uuid,trigger text,status text,dispatched_at timestamptz,deadline timestamptz,started_at timestamptz,finished_at timestamptz,result text,error_code text,error_message text,spend_time bigint);
CREATE TABLE platform_task_credential(domain_id text,owner_id text,sealed_key text,valid boolean,PRIMARY KEY(domain_id,owner_id));
""");
    UUID functionTask = UUID.randomUUID(),
        agentTask = UUID.randomUUID(),
        history = UUID.randomUUID(),
        session = UUID.randomUUID();
    var functionTarget = object("kind", "function", "functionId", "f");
    var agentTarget =
        object("kind", "agent", "agentId", UUID.randomUUID(), "prompt", "First line\nSecond line");
    for (UUID id : List.of(functionTask, agentTask))
      jdbc.update(
          "INSERT INTO platform_task VALUES(?, 'sales', ?, ?,"
              + " '',NULL,?::jsonb,?::jsonb,'Asia/Shanghai',DEFAULT,true,NULL,'2026-12-01Z',NULL,'en','2026-01-01Z','2026-01-02Z')",
          id,
          id.equals(agentTask) ? "alice" : null,
          id.equals(agentTask) ? "agents" : "ontology",
          id.equals(agentTask) ? agentTarget.toString() : functionTarget.toString(),
          object("kind", "daily", "time", "09:00").toString());
    jdbc.update(
        "INSERT INTO platform_task_run"
            + " VALUES(?,?,?::jsonb,?,'schedule','completed',NULL,NULL,'2026-01-03Z','2026-01-03Z','old"
            + " result',NULL,NULL,7)",
        history,
        functionTask,
        functionTarget.toString(),
        null);
    jdbc.update(
        "INSERT INTO platform_task_credential VALUES('sales','alice',?,true)",
        TaskCredentials.seal("test-key", "test-seal"));
    var migration = new ScheduleMigration(jdbc, store, false);
    migration.check();
    assertTrue(TaskStore.column(jdbc, "platform_task", "target"));
    transactions.executeWithoutResult(tx -> migration.upgrade());
    assertEquals("admin-a", store.get(functionTask, false).creator());
    assertEquals("First line", store.get(agentTask, false).definition().title());
    assertEquals("old result", store.run(history).result());
    assertEquals("unknown", store.run(history).executionDetails().path("legacyIdentity").asText());
    assertTrue(references.references("f"));
    assertFalse(TaskStore.column(jdbc, "platform_task", "target"));
    assertEquals(Instant.parse("2026-12-01T00:00:00Z"), store.get(functionTask, false).nextRunAt());
    transactions.executeWithoutResult(tx -> migration.upgrade());
    assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM platform_task", Integer.class));
    sample("platformTaskSchema", tasks.detail(agentTask));
    sample("platformTaskRunSchema", store.run(history).wire());
  }

  @Test
  void migrationWithNoBuiltInAdministratorStopsWithoutChangingTables() {
    jdbc.execute(
        "DROP TABLE ontology_schedule_reference; DROP TABLE platform_task_run; DROP TABLE"
            + " platform_task; DROP TABLE platform_task_credential");
    jdbc.execute(
        """
CREATE TABLE platform_task(id uuid PRIMARY KEY,domain_id text,owner_id text,target jsonb);
CREATE TABLE platform_task_run(status text,finished_at timestamptz);
CREATE TABLE sys_domain(id text); CREATE TABLE sys_user(id text,active int,enable int);
CREATE TABLE sys_domain_membership(user_id text,domain_id text,is_admin int,create_time timestamptz);
INSERT INTO platform_task VALUES('10000000-0000-4000-8000-000000000001','sales',NULL,'{"kind":"function","functionId":"f"}');
""");
    var migration = new ScheduleMigration(jdbc, store, false);
    assertThrows(IllegalStateException.class, migration::check);
    assertTrue(TaskStore.column(jdbc, "platform_task", "target"));
  }

  @Test
  void originalFunctionImportWritesOnlyTheNewShapeAndRetiresSeparately() throws Exception {
    jdbc.update("UPDATE function SET domain_id='1' WHERE id='f'");
    jdbc.execute(
        """
CREATE TABLE write_task(id text,name text,description text,function_id text,status text,cron text,service_id text,domain_id text,create_timestamp bigint,modify_timestamp bigint);
CREATE TABLE write_task_result(id text,write_task_id text,execute_timestamp bigint,spend_time bigint,result text,error text);
""");
    UUID task = UUID.randomUUID(), run = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO write_task VALUES(?,'Old function',NULL,'f','STOPPED','0 0 2 * *"
            + " *','','1',1000,2000)",
        task.toString());
    jdbc.update(
        "INSERT INTO write_task_result VALUES(?,?,3000,7,'original output',NULL)",
        run.toString(),
        task.toString());
    var migration = new ScheduleMigration(jdbc, store, true);
    transactions.executeWithoutResult(
        tx ->
            ReflectionTestUtils.invokeMethod(
                migration, "importOriginal", jdbc, "UTC", "Asia/Shanghai"));
    assertEquals("admin", store.get(task, false).creator());
    assertFalse(store.get(task, false).enabled());
    assertEquals("unknown", store.run(run).trigger());
    assertEquals("original output", store.run(run).result());
    assertFalse(TaskStore.column(jdbc, "platform_task", "target"));
    assertTrue(ScheduleMigration.exists(jdbc, "write_task"));
    transactions.executeWithoutResult(
        tx ->
            ReflectionTestUtils.invokeMethod(
                migration, "importOriginal", jdbc, "UTC", "Asia/Shanghai"));
    assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM platform_task", Integer.class));
    ReflectionTestUtils.invokeMethod(migration, "retire", jdbc);
    assertFalse(ScheduleMigration.exists(jdbc, "write_task"));
    sample("platformTaskRunSchema", store.run(run).wire());
  }

  @Test
  void unavailableFunctionPausesForTheTargetRatherThanAFormVersionChange() {
    UUID task = UUID.randomUUID(), run = UUID.randomUUID();
    tasks.create(task, definition("function:f"), "en", true);
    tasks.manual(task, run, "en");
    jdbc.update("UPDATE function SET operation=? WHERE id='f'", Function.OPERATION_READ);
    var scheduler =
        new PlatformScheduler(
            store, transactions, applications, credentials, identity, mock(TaskMail.class));
    try {
      scheduler.dispatch(run);
      assertEquals("target_unavailable", store.run(run).error().code());
      assertEquals("target_unavailable", store.get(task, false).pause().code());
    } finally {
      scheduler.stop();
    }
  }

  @Test
  void oneUnavailableApplicationDoesNotHideOtherApplicationsOrTheirTaskCounts() throws Exception {
    var unavailable = mock(ScheduleApplication.class);
    when(unavailable.id()).thenReturn("operations");
    when(unavailable.describe(any()))
        .thenThrow(
            new ScheduleException(503, "DEPENDENCY_UNAVAILABLE", "Permission lookup unavailable"));
    var agents = fixtureApplication("agents", false, new AtomicReference<>(false));
    var registry =
        new ScheduleApplications(List.of(ontology, agents, unavailable), mockWorkbench());
    var service =
        new PlatformTasks(store, identities, identity, credentials, registry, transactions);
    ReflectionTestUtils.setField(service, "configuredZone", "UTC");
    UUID id = UUID.randomUUID();
    store.insert(
        id,
        "sales",
        "alice",
        TaskDefinition.input(fixtureDefinition("operations"), "UTC", false),
        array(),
        "en",
        Instant.now(),
        true);
    var mvc = MockMvcBuilders.standaloneSetup(new PlatformTaskController(service)).build();
    var response =
        mvc.perform(
                get("/platform/scheduled-tasks/applications").header("Accept-Language", "zh-CN"))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse();
    var body = parse(response.getContentAsString());
    sample("platformScheduleApplicationsSchema", body);
    assertEquals(3, body.path("applications").size());
    assertEquals(1, body.path("totalCount").asInt());
    for (var application : body.path("applications")) {
      if (application.path("id").asText().equals("operations")) {
        assertFalse(application.path("available").asBoolean());
        assertEquals(1, application.path("taskCount").asInt());
        assertEquals("暂时无法确认你能否使用这个应用", application.path("unavailableReason").asText());
      } else assertTrue(application.path("available").asBoolean());
    }
  }

  @Test
  void missingInstalledApplicationDiscoveryStillFailsTheWholeList() throws Exception {
    var workbench = mockWorkbench();
    when(workbench.ids())
        .thenThrow(
            new ScheduleException(
                503, "DEPENDENCY_UNAVAILABLE", "Cannot discover installed applications"));
    var registry = new ScheduleApplications(List.of(ontology), workbench);
    var service =
        new PlatformTasks(store, identities, identity, credentials, registry, transactions);
    var mvc = MockMvcBuilders.standaloneSetup(new PlatformTaskController(service)).build();
    mvc.perform(get("/platform/scheduled-tasks/applications"))
        .andExpect(status().isServiceUnavailable());
  }

  @Test
  void intervalMonthlyAndLocalTimeParametersKeepTheirSemantics() {
    var monthly =
        new TaskDefinition(
            "Month end",
            "ontology",
            object(),
            "v1",
            object("kind", "monthly", "day", 31, "time", "09:00"),
            "Asia/Shanghai",
            null);
    Instant now = Instant.parse("2026-02-01T00:00:00Z");
    assertEquals(Instant.parse("2026-02-28T01:00:00Z"), monthly.next(now, now));
    var time = new Parameter();
    time.setName("cutoff");
    time.setType(Parameter.TYPE_TIME);
    var array = new Parameter();
    array.setName("times");
    array.setType(Parameter.TYPE_TIME_ARRAY);
    var numbers = new Parameter();
    numbers.setName("numbers");
    numbers.setType(Parameter.TYPE_NUMBER_ARRAY);
    var function = new Function();
    function.setParameters(List.of(time, array, numbers));
    var values =
        ScheduleParameters.values(
            function,
            object(
                "parameter:cutoff",
                "",
                "parameter:times",
                "2026-11-06\n\n2026-11-07 09:30\n2026-11-08T01:30:00Z",
                "parameter:numbers",
                "10\n\n20.5"),
            "Asia/Shanghai",
            now);
    assertEquals(now.toString(), values.getString("cutoff"));
    assertEquals("2026-11-05T16:00:00Z", values.getJSONArray("times").getString(0));
    assertEquals(2, values.getJSONArray("numbers").size());
    assertThrows(
        ScheduleException.class,
        () ->
            ScheduleParameters.values(
                function,
                object(
                    "parameter:cutoff",
                    "2026-02-30",
                    "parameter:times",
                    "2026-11-06",
                    "parameter:numbers",
                    "1"),
                "Asia/Shanghai",
                now));
  }
}
