package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.service.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.sql.DriverManager;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;

/** Real PostgreSQL gates and receipts, with runtime and Python calls isolated from models/data. */
class OntologyGenerationContractTest {
  private static JSONObject sourceAnalysis() {
    return JSONObject.of("schema", "ontomato.query-subgraph.v1", "queries", new JSONArray(),
        "nodes", new JSONArray(), "edges", new JSONArray(), "filters", new JSONArray());
  }
  String schema, jdbcUrl, username, password, session, run;
  OntologyAgentStore store;
  QueryGrantService grants;
  GenerationOperations operations;
  OntologyGenerationService generation;
  AgentRuntimeClient runtime;
  RuntimeCodeClient code;
  SessionRegistryService sessions;
  String stop = "stop", source = "# ontomato-python:2\nprint('ok')\n";
  boolean inherited = false, failedTest = false;
  final Owner owner = new Owner("fixture-user", "fixture-domain");
  final QueryAccessService.GrantUser user =
      new QueryAccessService.GrantUser(owner.userId(), owner.domainId());
  final Map<String, String> files = new HashMap<>();

  @BeforeEach
  void setup() throws Exception {
    String database = System.getenv("RUNTIME_TEST_DATABASE_URL");
    if (database == null)
      throw new IllegalStateException(
          "Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");
    URI url = URI.create(database);
    String[] account = url.getUserInfo().split(":", 2);
    username = account[0];
    password = account[1];
    jdbcUrl = "jdbc:postgresql://" + url.getHost() + ":" + url.getPort() + url.getPath();
    schema = "generation_" + UUID.randomUUID().toString().replace("-", "");
    try (var connection = DriverManager.getConnection(jdbcUrl, username, password);
        var statement = connection.createStatement()) {
      statement.execute("CREATE SCHEMA " + schema);
    }
    var dataSource =
        new DriverManagerDataSource(jdbcUrl + "?currentSchema=" + schema, username, password);
    var jdbc = new JdbcTemplate(dataSource);
    store = new OntologyAgentStore(jdbc, new DataSourceTransactionManager(dataSource));
    store.initialize();
    grants = new QueryGrantService(jdbc, "fixture-signing-key", "fixture-service");
    grants.initialize();
    var admin = mock(io.ontomato.dataengine.dao.JSONRuleDao.class);
    when(admin.query(owner.domainId()))
        .thenReturn(Map.of("classDef", List.of(), "relationship_rule", Map.of()));
    var python = mock(PythonExecuteService.class);
    when(python.execute(anyString(), anyString(), anyInt(), anyString(), any(), any(), any()))
        .thenAnswer(
            call -> {
              var result = new PythonExecuteResult();
              result.setResult("{\"answer\":[]}");
              if (failedTest) result.setError("fixture failure");
              return result;
            });
    var permissionLookup = mock(DataPermissionLookup.class);
    var permission = new io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission();
    permission.setFullData(true);
    when(permissionLookup.getDataPermission(anyString(), anyString())).thenReturn(permission);
    operations =
        new GenerationOperations(
            store,
            admin,
            mock(SandboxService.class),
            mock(WriteFunctionOperationService.class),
            python,
            grants, permissionLookup, new io.ontomato.dataengine.service.impl.ABCProgramServiceImpl());
    runtime = mock(AgentRuntimeClient.class);
    when(runtime.ontologyUrl()).thenReturn("http://ontology.invalid");
    code = mock(RuntimeCodeClient.class);
    sessions = mock(SessionRegistryService.class);
    when(sessions.getNodeId()).thenReturn("fixture-node");
    generation =
        new OntologyGenerationService(
            store,
            runtime,
            new OntologyAgentDefinitions(runtime, code),
            grants,
            sessions,
            operations,
            code, permissionLookup);
    when(runtime.json(any(), anyString(), anyString(), anyString(), any(), any()))
        .thenAnswer(
            call -> {
              String path = call.getArgument(2);
              if (path.matches("/v1/sessions/[^/]+/runs")) {
                session = path.split("/")[3];
                run = call.getArgument(5);
                JSONObject request = call.getArgument(4);
                String token = request.getJSONObject("environment").getJSONObject("secrets").getString("ONTOMATO_TK");
                assertEquals(
                    owner.domainId(),
                    grants
                        .verify(token, run, "/ontology/ai/generation/" + run + "/context")
                        .getString("domainId"));
                operations.test(
                    run, owner, JSONObject.of("code", source, "parameterDefs", new JSONArray(), "sourceAnalysis", sourceAnalysis()));
              }
              if (path.contains("/artifacts?")) {
                String name =
                    java.net.URLDecoder.decode(
                        path.substring(path.indexOf("path=") + 5), StandardCharsets.UTF_8);
                String id = UUID.randomUUID().toString();
                files.put(
                    id,
                    name.equals("outputs/result.json")
                        ? "{\"sourcePath\":\"outputs/program.py\",\"parameterDefs\":[],\"name\":\"fixture\",\"logic\":\"fixture\"}"
                        : source);
                return JSONObject.of(
                    "artifacts",
                    List.of(
                        JSONObject.of(
                            "id",
                            id,
                            "runId",
                            inherited ? UUID.randomUUID().toString() : run,
                            "sessionId",
                            session,
                            "path",
                            name)));
              }
              return new JSONObject();
            });
    when(runtime.run(anyString(), anyString()))
        .thenAnswer(
            call ->
                JSONObject.of(
                    "run",
                    JSONObject.of(
                        "id", run, "sessionId", session, "status", "stopped", "stopReason", stop)));
    when(runtime.bytes(anyString(), anyString(), anyString()))
        .thenAnswer(
            call ->
                files
                    .get(((String) call.getArgument(2)).split("/")[3])
                    .getBytes(StandardCharsets.UTF_8));
  }

  @AfterEach
  void cleanup() throws Exception {
    if (schema != null)
      try (var connection = DriverManager.getConnection(jdbcUrl, username, password);
          var statement = connection.createStatement()) {
        statement.execute("DROP SCHEMA " + schema + " CASCADE");
      }
  }

  OntologyGenerationService.Generation generate() {
    return OntologyGenerationService.asOwner(
        user,
        () ->
            generation.generate(
                "function", UUID.randomUUID().toString(), "Fixture task", "en", owner.domainId()));
  }

  @Test
  void consumesOnlyTheTestedImmutableSourceAndSettlesOnce() {
    try (var result = generate()) {
      assertEquals(source, result.result().getString("code"));
      var writes = new AtomicInteger();
      assertEquals(1, result.settle(writes::incrementAndGet));
      assertThrows(AgentHttpException.class, () -> result.settle(writes::incrementAndGet));
      assertEquals(1, writes.get());
    }
  }

  @Test
  void cancellationBetweenRuntimeCompletionAndSaveRejectsSettlement() {
    try (var result = generate()) {
      store.closeRun(session, run, owner);
      var writes = new AtomicInteger();
      assertThrows(AgentHttpException.class, () -> result.settle(writes::incrementAndGet));
      assertEquals(0, writes.get());
    }
  }

  @Test
  void rejectsInheritedFilesAndUnsuccessfulBusinessTests() {
    inherited = true;
    assertThrows(IllegalStateException.class, this::generate);
    inherited = false;
    failedTest = true;
    assertThrows(AgentHttpException.class, this::generate);
  }

  @Test
  void abortedAndErroredRunsCannotDeliverFiles() throws Exception {
    for (String reason : List.of("aborted", "error", "cancelled")) {
      stop = reason;
      assertThrows(IllegalStateException.class, this::generate);
    }
    verify(runtime, never()).bytes(anyString(), anyString(), anyString());
  }

  @Test
  void receiptBindsCodeParametersAndOperation() throws Exception {
    var ids = generation.open("function", UUID.randomUUID().toString(), null, owner, true);
    String run = ids.getString("runId");
    operations.test(run, owner, JSONObject.of("code", source, "parameterDefs", new JSONArray(), "sourceAnalysis", sourceAnalysis()));
    assertDoesNotThrow(() -> operations.requireTest(run, "function", source, new JSONArray()));
    assertThrows(
        AgentHttpException.class,
        () -> operations.requireTest(run, "function", source + "# changed", new JSONArray()));
    assertThrows(
        AgentHttpException.class,
        () ->
            operations.requireTest(
                run, "function", source, JSONArray.of(JSONObject.of("name", "different"))));
    assertThrows(
        AgentHttpException.class,
        () -> operations.requireTest(run, "action", source, new JSONArray()));
    assertThrows(
        AgentHttpException.class,
        () ->
            operations.prepare(
                run,
                owner,
                JSONObject.of("objDatas", new JSONArray(), "relDatas", new JSONArray())));
    assertThrows(
        AgentHttpException.class,
        () -> operations.source(run, new Owner("other", owner.domainId())));
    generation.close(ids.getString("sessionId"), run, owner);
    assertThrows(
        AgentHttpException.class,
        () ->
            operations.test(
                run, owner, JSONObject.of("code", source, "parameterDefs", new JSONArray(), "sourceAnalysis", sourceAnalysis())));
    verify(code).closeIntent(eq(owner.domainId()), anyString());
  }

  @Test
  void descriptionChangesDoNotInvalidateTheBusinessTestReceipt() throws Exception {
    var ids = generation.open("function", UUID.randomUUID().toString(), null, owner, true);
    String run = ids.getString("runId");
    operations.test(
        run,
        owner,
        JSONObject.of(
            "sourceAnalysis", sourceAnalysis(),
            "code",
            source,
            "parameterDefs",
            JSONArray.of(
                JSONObject.of(
                    "name", "limit", "type", "TYPE_NUMBER", "value", 10, "description", "size"))));
    var described =
        JSONObject.of(
            "name", "limit", "type", "TYPE_NUMBER", "value", 10, "description", "maximum size");
    assertDoesNotThrow(
        () -> operations.requireTest(run, "function", source, JSONArray.of(described)));
    var changedValue =
        JSONObject.of(
            "name", "limit", "type", "TYPE_NUMBER", "value", 20, "description", "size");
    assertThrows(
        AgentHttpException.class,
        () -> operations.requireTest(run, "function", source, JSONArray.of(changedValue)));
    var changedType =
        JSONObject.of(
            "name", "limit", "type", "TYPE_STRING", "value", 10, "description", "size");
    assertThrows(
        AgentHttpException.class,
        () -> operations.requireTest(run, "function", source, JSONArray.of(changedType)));
    var missing =
        assertThrows(
            AgentHttpException.class,
            () ->
                operations.requireTest(
                    run, "function", source + "# untested", JSONArray.of(described)));
    assertEquals(400, missing.status());
    assertTrue(missing.getMessage().contains("business test"));
    generation.close(ids.getString("sessionId"), run, owner);
  }

  @Test
  void generationCredentialAllowsOwnerQueriesButCannotBecomeUserOrWriteAuthorization() {
    String run = UUID.randomUUID().toString();
    String token =
        grants.issue(
            owner.userId(),
            owner.domainId(),
            "ontology-generation",
            run,
            System.currentTimeMillis() + 60000,
            List.of(),
            null);
    assertDoesNotThrow(() -> grants.verify(token, run, "/ontology/ai/generation/" + run + "/context"));
    assertDoesNotThrow(
        () -> grants.verify(token, run, "/ontology/ai/generation/" + run + "/source"));
    var readClaims = grants.verify(token, run, "/ontology/query/overview");
    assertEquals(owner.userId(), readClaims.getString("userId"));
    assertEquals(owner.domainId(), readClaims.getString("domainId"));
    for (String path :
        List.of(
            "/businessConfig/saveModelSettings",
            "/action/save",
            "/writeFunctionOperation/createObject",
            "/ontology/ai/generation/" + UUID.randomUUID() + "/source"))
      assertThrows(
          org.springframework.web.server.ResponseStatusException.class,
          () -> grants.verify(token, run, path));
    grants.revoke(owner.domainId(), run);
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () -> grants.verify(token, run, "/ontology/ai/generation/" + run + "/context"));
  }
}
