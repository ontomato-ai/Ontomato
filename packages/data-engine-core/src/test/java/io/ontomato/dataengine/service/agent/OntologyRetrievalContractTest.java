package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.*;
import com.sun.net.httpserver.HttpServer;
import io.ontomato.dataengine.controller.*;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.sql.DriverManager;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** PostgreSQL gates and real Java HTTP transport, without model or product-stack execution. */
class OntologyRetrievalContractTest {
  String schema, jdbcUrl, username, password;
  OntologyAgentStore store;
  OntologyRetrievalService retrieval;
  QueryJobService jobs;
  QueryQualityService quality;
  QueryGrantService grants;
  MockMvc http;
  HttpServer server;
  final OntologyAgentStore.Owner owner = new OntologyAgentStore.Owner("user-a", "domain-a");
  final Map<String, JSONObject> runs = new ConcurrentHashMap<>(),
      requests = new ConcurrentHashMap<>(),
      files = new ConcurrentHashMap<>();
  final Set<String> cancelled = ConcurrentHashMap.newKeySet();
  final String skillDigest = "a".repeat(64);

  static String id() {
    return UUID.randomUUID().toString();
  }

  @BeforeEach
  void setup() throws Exception {
    String database = System.getenv("RUNTIME_TEST_DATABASE_URL");
    Assumptions.assumeTrue(database != null);
    URI url = URI.create(database);
    String[] account = url.getUserInfo().split(":", 2);
    username = account[0];
    password = account[1];
    jdbcUrl = "jdbc:postgresql://" + url.getHost() + ":" + url.getPort() + url.getPath();
    schema = "ontology_agent_" + id().replace("-", "");
    try (var c = DriverManager.getConnection(jdbcUrl, username, password);
        var sql = c.createStatement()) {
      sql.execute("CREATE SCHEMA " + schema);
    }
    var source =
        new DriverManagerDataSource(jdbcUrl + "?currentSchema=" + schema, username, password);
    var jdbc = new JdbcTemplate(source);
    store = new OntologyAgentStore(jdbc, new DataSourceTransactionManager(source));
    store.initialize();
    grants = new QueryGrantService(jdbc, "fixture-signing-key", "fixture-service");
    grants.initialize();
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        exchange -> {
          try {
            String path = exchange.getRequestURI().getPath(), method = exchange.getRequestMethod();
            String raw =
                new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            var body = raw.isBlank() ? new JSONObject() : JSON.parseObject(raw);
            String key = exchange.getRequestHeaders().getFirst("Idempotency-Key");
            Object value = new JSONObject();
            int status = 200;
            if (path.equals("/v1/skills")) status = 201;
            else if (path.equals("/v1/sessions") && method.equals("POST")) status = 201;
            else if (path.matches("/v1/sessions/[^/]+/runs") && method.equals("POST")) {
              if (cancelled.contains(key)) {
                status = 410;
                value =
                    JSONObject.of("error", Map.of("code", "RUN_CLOSED", "message", "Cancelled"));
              } else {
                String session = path.split("/")[3];
                requests.putIfAbsent(key, body);
                runs.putIfAbsent(key, snapshot(session, key));
                status = 202;
                value = JSONObject.of("run", runs.get(key).get("run"), "replayed", false);
              }
            } else if (path.contains("/run-intents/") && path.endsWith("/cancel")) {
              String run = path.split("/")[5];
              cancelled.add(run);
              if (runs.containsKey(run)) {
                var r = runs.get(run).getJSONObject("run");
                r.put("status", "stopped");
                r.put("stopReason", "aborted");
                r.put("errorMessage", "Cancelled");
                r.put("finishedAt", Instant.now().toString());
              }
              status = 204;
            } else if (path.startsWith("/v1/runs/")) {
              String run = path.split("/")[3];
              if (!runs.containsKey(run)) {
                status = 404;
                value = JSONObject.of("error", Map.of("code", "NOT_FOUND", "message", "Missing"));
              } else value = runs.get(run);
            } else if (path.startsWith("/v1/artifacts/")) {
              String artifact = path.split("/")[3];
              value = files.get(artifact);
            } else if (path.startsWith("/v1/sessions/")) {
              String session = path.split("/")[3];
              var latest =
                  runs.values().stream()
                      .filter(s -> session.equals(s.getJSONObject("run").getString("sessionId")))
                      .reduce((a, b) -> b)
                      .orElse(null);
              value =
                  JSONObject.of(
                      "session",
                      Map.of("id", session),
                      "messages",
                      new JSONArray(),
                      "latestRun",
                      latest);
              if (method.equals("DELETE")) status = 204;
            }
            byte[] bytes = AgentJson.json(value).getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, status == 204 ? -1 : bytes.length);
            if (status != 204) exchange.getResponseBody().write(bytes);
          } catch (Exception failure) {
            exchange.sendResponseHeaders(500, -1);
          } finally {
            exchange.close();
          }
        });
    server.start();
    var runtime =
        new AgentRuntimeClient(
            "http://127.0.0.1:" + server.getAddress().getPort(),
            "fixture-host",
            "http://ontology.fixture");
    var identity = mock(IdentityService.class);
    var user = new QueryAccessService.GrantUser(owner.userId(), owner.domainId());
    when(identity.getCurrentCredentialExpiresAt()).thenReturn(null);
    when(identity.getCurrentUser()).thenReturn(user);
    when(identity.getCurrentUserDataPermission()).thenReturn(new UserDataPermission());
    var queries = new QueryAccessService(identity, mock(DataPermissionLookup.class), grants);
    var authorization = new OntologyAgentAccess(queries, identity, grants, store);
    var ontology = mock(OntologyQueryService.class);
    when(ontology.overview(any())).thenReturn(Map.of("description", "", "classes", List.of()));
    when(ontology.metrics(any(), any())).thenReturn(Map.of("items", List.of()));
    when(ontology.knowledge(any(), any())).thenReturn(Map.of("items", List.of()));
    jobs = mock(QueryJobService.class);
    quality = mock(QueryQualityService.class);
    var definitions = new OntologyAgentDefinitions(runtime, new RuntimeCodeClient(runtime));
    var bindings = mock(OntologyBindingRetrieval.class);
    when(bindings.snapshot(any(),any(),any())).thenReturn(JSONObject.of("status","completed","error",null,"datasets",new JSONArray()));
    retrieval =
        new OntologyRetrievalService(
            store,
            runtime,
            definitions,
            ontology,
            grants,
            mock(QueryOutputService.class),
            jobs,
            quality,
            authorization, bindings, new RetrievalResults(store));
    var host =
        new OntologyAgentHost(store, runtime, retrieval, mock(OntologyGenerationService.class), mock(KnowledgeGovernanceService.class));
    http =
        MockMvcBuilders.standaloneSetup(
                new OntologyAgentController(host, authorization, runtime, retrieval),
                new OntologyRetrievalController(retrieval, store, authorization))
            .setControllerAdvice(new OntologyAgentErrors())
            .build();
  }

  JSONObject snapshot(String session, String run) {
    return JSONObject.of(
        "run",
        JSONObject.of(
            "id",
            run,
            "sessionId",
            session,
            "status",
            "running",
            "stopReason",
            null,
            "errorMessage",
            null,
            "createdAt",
            Instant.now().toString(),
            "finishedAt",
            null,
            "resolvedSkills",
            List.of(
                JSONObject.of(
                    "skill",
                    Map.of(
                        "namespace",
                        Map.of("kind", "provider", "provider", "ontology"),
                        "name",
                        "ontomato-analyst"),
                    "digest",
                    skillDigest,
                    "description",
                    "Ontology queries"))),
        "messages",
        new JSONArray(),
        "pendingMessages",
        new JSONArray(),
        "toolExecutions",
        new JSONArray(),
        "artifacts",
        new JSONArray(),
        "cursor",
        JSONObject.of("runId", run, "seq", 1, "streamId", id()));
  }

  JSONObject postJson(String path, String key, Object body, String caller) throws Exception {
    var request =
        post(path)
            .header("tk", "fixture-user")
            .header("Idempotency-Key", key)
            .contentType("application/json")
            .content(AgentJson.json(body));
    if (caller != null) request.header("X-Ontomato-Retrieval-Caller-Id", caller);
    var result = http.perform(request).andReturn();
    assertTrue(result.getResponse().getStatus() < 300, result.getResponse().getContentAsString());
    var response = JSON.parseObject(result.getResponse().getContentAsString());
    if (response.containsKey("roundId")) {
      String run = response.getString("roundId");
      for (int attempt=0;attempt<200 && !store.run(response.getString("id"),run,owner).getBooleanValue("runtime_admitted");attempt++) Thread.sleep(10);
      return retrieval.get(response.getString("id"),owner);
    }
    return response;
  }

  @Test
  void directAdmissionSharesTheHostWireAndClosedCallerRejectsLateWork() throws Exception {
    String caller = id();
    var scope =
        JSONObject.of(
            "classNames",
            List.of("/sales"),
            "continuationIds",
            List.of(),
            "deadlineAt",
            Instant.now().plusSeconds(60).toString());
    http.perform(
            post("/ontology/retrieval-callers")
                .header("tk", "fixture-user")
                .header("X-Ontomato-Query-Service-Token", "fixture-service")
                .header("Idempotency-Key", caller)
                .contentType("application/json")
                .content(AgentJson.json(scope)))
        .andExpect(status().isCreated());
    String retrievalId = id();
    JSONObject first;
    try (var concurrent = Executors.newFixedThreadPool(2)) {
      var start = new CountDownLatch(1);
      Callable<JSONObject> request =
          () -> {
            start.await();
            return postJson(
                "/ontology/retrievals", retrievalId, Map.of("question", "Sales?"), caller);
          };
      var one = concurrent.submit(request);
      var two = concurrent.submit(request);
      start.countDown();
      first = one.get(20, TimeUnit.SECONDS);
      assertEquals(
          first.getString("runtimeRunId"), two.get(20, TimeUnit.SECONDS).getString("runtimeRunId"));
    }
    String run = first.getString("runtimeRunId");
    assertEquals(first.getString("runtimeSessionId"), retrievalId);
    assertEquals(1, requests.size());
    var environment = requests.get(run).getJSONObject("environment");
    assertEquals("fixture-user", environment.getJSONObject("secrets").getString("ONTOMATO_TK"));
    assertFalse(environment.getJSONObject("values").containsKey("ONTOMATO_WORKBENCH_URL"));
    var claims =
        grants.verify(
            environment.getJSONObject("secrets").getString("ONTOMATO_QUERY_TK"),
            run,
            "/ontology/query/overview");
    assertEquals("ontology", claims.getString("servicePrincipal"));
    assertEquals(retrievalId, claims.getString("retrievalId"));
    String wire =
        http.perform(get("/ontology/ai/sessions/" + retrievalId + "/runs/" + run))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    var projected = JSON.parseObject(wire);
    assertEquals(
        skillDigest,
        projected
            .getJSONObject("run")
            .getJSONArray("resolvedSkills")
            .getJSONObject(0)
            .getString("digest"));
    assertFalse(projected.getJSONObject("run").containsKey("definition"));
    String fixture = System.getenv("ONTOLOGY_HOST_CONTRACT_OUTPUT");
    if (fixture != null) Files.writeString(Path.of(fixture), wire);
    runs.get(run).getJSONObject("run").put("status", "stopped");
    runs.get(run).getJSONObject("run").put("stopReason", "error");
    http.perform(get("/ontology/ai/sessions/" + retrievalId + "/runs/" + run))
        .andExpect(status().isOk());
    assertThrows(AgentHttpException.class,
        () -> store.transaction(() -> store.gate(retrievalId, run, owner)));
    http.perform(
            post("/ontology/retrieval-callers/" + caller + "/close")
                .header("tk", "fixture-user")
                .header("X-Ontomato-Query-Service-Token", "fixture-service"))
        .andExpect(status().isOk());
    assertTrue(cancelled.contains(run));
    http.perform(
            post("/ontology/retrievals")
                .header("tk", "fixture-user")
                .header("X-Ontomato-Retrieval-Caller-Id", caller)
                .header("Idempotency-Key", id())
                .contentType("application/json")
                .content("{\"question\":\"Late\"}"))
        .andExpect(status().isConflict());
    assertEquals(1, requests.size());
    assertThrows(
        AgentHttpException.class,
        () ->
            store.session(
                retrievalId, new OntologyAgentStore.Owner(owner.userId(), "other-domain")));
  }

  @Test
  void closedIntentAndContinuationHaveOneDurableOwner() throws Exception {
    String closed = id();
    store.closeCaller(closed, owner);
    assertThrows(
        AgentHttpException.class,
        () ->
            store.openCaller(
                closed,
                owner,
                JSONObject.of(
                    "classNames",
                    List.of(),
                    "continuationIds",
                    List.of(),
                    "deadlineAt",
                    Instant.now().plusSeconds(60).toString())));
    String retrievalId = id();
    var first = postJson("/ontology/retrievals", retrievalId, Map.of("question", "Sales?"), null);
    String run = first.getString("runtimeRunId");
    var stopped = runs.get(run).getJSONObject("run");
    stopped.put("status", "stopped");
    stopped.put("stopReason", "stop");
    stopped.put("finishedAt", Instant.now().toString());
    http.perform(get("/ontology/retrievals/" + retrievalId)).andExpect(status().isOk());
    String answerId = id();
    var answer =
        Map.of("expectedRunId", run, "expectedDecisionRevision", 0, "message", "Current year");
    var next = postJson("/ontology/retrievals/" + retrievalId + "/answers", answerId, answer, null);
    assertEquals(1, next.getIntValue("decisionRevision"));
    assertEquals(
        answerId,
        postJson("/ontology/retrievals/" + retrievalId + "/answers", answerId, answer, null)
            .getString("runtimeRunId"));
    assertEquals(2, requests.size());
    http.perform(
            post("/ontology/retrievals")
                .header("Idempotency-Key", id())
                .contentType("application/json")
                .content("{\"question\":\"x\",\"timeoutSeconds\":601}"))
        .andExpect(status().isBadRequest());
    var external =
        postJson("/ontology/retrievals/skill-runs", id(), Map.of("question", "External"), null);
    assertEquals(2, requests.size());
    var externalSnapshot =
        JSON.parseObject(
            http.perform(get("/ontology/retrievals/" + external.getString("id")))
                .andReturn()
                .getResponse()
                .getContentAsString());
    assertNull(externalSnapshot.get("runtimeRunId"));
    assertTrue(externalSnapshot.getJSONArray("messages").isEmpty());
  }

  @Test
  void onlyOwnedUnchangedReceiptsBecomeDatasetsAndHistoricalFilesStayReadable() throws Exception {
    String retrievalId = id();
    var initial = postJson("/ontology/retrievals", retrievalId, Map.of("question", "Sales?"), null);
    String run = initial.getString("runtimeRunId"), output = id();
    var dataset =
        JSON.parseObject(
            """
{"schema":"workbench.dataset.v1","title":"Sales","question":"Sales?","recipe":{"kind":"python","code":"print(0)","sha256":"source"},"columns":[{"key":"value","label":"Value","type":null}],"rows":[{"value":null},{"value":0},{"value":false}],"outKeyRefs":[{"key":"value","className":"/sales","attrName":"value","asGroupBy":false,"statCal":false}],"truncation":null,"assumptions":[],"decisionIds":[],"metricUses":[],"selfCheck":{"scope":"","filters":"","grain":"","denominator":"","nullGroups":"","comparisons":[]}}
""");
    dataset.put(
        "execution", JSONObject.of("receiptId", output, "executedAt", Instant.now().toString()));
    store.update(
        "INSERT INTO"
            + " ontology_retrieval_outputs(id,run_id,input_hash,request,receipt_id,dataset_digest)"
            + " VALUES(?,?,'fixture','{}',?,?)",
        OntologyAgentStore.uuid(output),
        OntologyAgentStore.uuid(run),
        OntologyAgentStore.uuid(output),
        AgentJson.hash(dataset));
    String good = id(), changed = id(), repeat = id();
    files.put(good, dataset);
    var altered = AgentJson.copy(dataset);
    altered.getJSONArray("rows").getJSONObject(1).put("value", 99);
    files.put(changed, altered);
    files.put(repeat, dataset);
    var artifacts = runs.get(run).getJSONArray("artifacts");
    for (String artifact : List.of(good, changed, repeat))
      artifacts.add(
          JSONObject.of(
              "id",
              artifact,
              "runId",
              run,
              "sessionId",
              retrievalId,
              "path",
              "outputs/result.dataset.json", "sha256", QueryOutputService.hash(AgentJson.json(files.get(artifact)))));
    var snapshot = retrieval.get(retrievalId, owner);
    assertEquals(List.of(repeat), snapshot.getList("datasetArtifactIds", String.class));
    assertEquals(dataset, retrieval.dataset(retrievalId, good, owner).getJSONObject("payload"));
    assertThrows(AgentHttpException.class, () -> retrieval.dataset(retrievalId, changed, owner));
    runs.get(run).getJSONObject("run").put("status", "stopped");
    runs.get(run).getJSONObject("run").put("stopReason", "stop");
    when(quality.start(any(), any(), any()))
        .thenThrow(new IllegalStateException("Lost admission response"))
        .thenReturn(Map.of());
    assertThrows(IllegalStateException.class, () -> retrieval.get(retrievalId, owner));
    String qcId = store.run(retrievalId, run, owner).getString("qc_id");
    assertNotNull(qcId);
    retrieval.recover();
    verify(quality, timeout(5000).times(2))
        .start(argThat(body -> qcId.equals(body.getString("id"))), any(), any());
    for (int attempt = 0;
        attempt < 100 && !store.run(retrievalId, run, owner).getBooleanValue("qc_admitted");
        attempt++) Thread.sleep(10);
    assertTrue(store.run(retrievalId, run, owner).getBooleanValue("qc_admitted"));
    assertThrows(
        AgentHttpException.class,
        () -> store.transaction(() -> store.gate(retrievalId, run, owner)));
  }

  @AfterEach
  void cleanup() throws Exception {
    if (retrieval != null) retrieval.shutdown();
    if (server != null) server.stop(0);
    if (schema != null)
      try (var c = DriverManager.getConnection(jdbcUrl, username, password);
          var sql = c.createStatement()) {
        sql.execute("DROP SCHEMA " + schema + " CASCADE");
      }
  }
}
