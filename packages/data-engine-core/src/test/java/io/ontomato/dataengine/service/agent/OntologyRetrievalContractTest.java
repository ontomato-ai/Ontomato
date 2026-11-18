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
  RetrievalTasks tasks;
  RetrievalResults results;
  QueryJobService jobs;
  QueryQualityService quality;
  QueryGrantService grants;
  UserDataPermission permission;
  MockMvc http;
  HttpServer server;
  AgentRuntimeClient runtime;
  OntologyAgentAccess authorization;
  final OntologyAgentStore.Owner owner = new OntologyAgentStore.Owner("user-a", "domain-a");
  final Map<String, JSONObject> runs = new ConcurrentHashMap<>(),
      requests = new ConcurrentHashMap<>(),
      files = new ConcurrentHashMap<>();
  final Map<String,JSONArray> inputs=new ConcurrentHashMap<>();
  final Set<String> cancelled = ConcurrentHashMap.newKeySet();
  final String skillDigest = "a".repeat(64);

  static String id() {
    return UUID.randomUUID().toString();
  }

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
    grants = new QueryGrantService(jdbc, "fixture-signing-key", new io.ontomato.dataengine.service.WorkbenchServiceAuthentication("fixture-service"));
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
                      inputs.getOrDefault(session,new JSONArray()),
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
    runtime =
        new AgentRuntimeClient(
            "http://127.0.0.1:" + server.getAddress().getPort(),
            "fixture-host",
            "http://ontology.fixture");
    var identity = mock(IdentityService.class);
    var user = new QueryAccessService.GrantUser(owner.userId(), owner.domainId());
    when(identity.getCurrentCredentialExpiresAt()).thenReturn(null);
    when(identity.getCurrentUser()).thenReturn(user);
    permission = new UserDataPermission();
    var fields = new io.ontomato.dataengine.service.sys.bean.permission.FieldPermission("/sales");
    fields.getVisibleFields().addAll(List.of("value", "count"));
    permission.addFieldPermission(fields);
    when(identity.getCurrentUserDataPermission()).thenReturn(permission);
    var queries = new QueryAccessService(identity, mock(DataPermissionLookup.class), grants);
    authorization = new OntologyAgentAccess(queries, identity, grants, store);
    var ontology = mock(OntologyQueryService.class);
    when(ontology.overview(any())).thenReturn(Map.of("description", "", "classes", List.of()));
    when(ontology.metrics(any(), any())).thenReturn(Map.of("items", List.of()));
    when(ontology.knowledge(any(), any())).thenReturn(Map.of("items", List.of()));
    jobs = mock(QueryJobService.class);
    quality = mock(QueryQualityService.class);
    var definitions = new OntologyAgentDefinitions(runtime, new RuntimeCodeClient(runtime), org.mockito.Mockito.mock(OntologyAgentModelSettings.class));
    var bindings = mock(OntologyBindingRetrieval.class);
    when(bindings.snapshot(any(),any(),any())).thenReturn(JSONObject.of("status","completed","error",null,"datasets",new JSONArray()));
    results = new RetrievalResults(store,mock(AgentChannelChanges.class));
    tasks = new RetrievalTasks(store, jobs, results);
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
            authorization, bindings, results, tasks,mock(AgentChannelRuns.class),mock(AgentChannelChanges.class));
    var host =
        new OntologyAgentHost(
            store,
            runtime,
            retrieval,
            mock(OntologyGenerationService.class),
            mock(ActionCreationService.class),mock(OntologyAgentLabels.class));
    http =
        MockMvcBuilders.standaloneSetup(
                new OntologyAgentController(host, authorization, runtime, retrieval),
                new OntologyRetrievalController(retrieval, store, authorization, tasks))
            .setControllerAdvice(new OntologyAgentErrors())
            .addFilters(new QueryGrantFilter(grants))
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

  JSONObject postJson(String path,String key,Object body,String caller) throws Exception {
    if(path.equals("/ontology/retrievals/skill-runs")) {
      var request=post(path).header("tk","fixture-user").header("Idempotency-Key",key).contentType("application/json").content(AgentJson.json(body));
      if(caller!=null) request.header("X-Ontomato-Retrieval-Caller-Id",caller);
      var response=http.perform(request).andExpect(status().isCreated()).andReturn();
      return JSON.parseObject(response.getResponse().getContentAsString());
    }
    var value=JSONObject.from(body);
    boolean answer=path.endsWith("/answers");
    String session=answer?path.split("/")[3]:key;
    String run=key;
    var input=answer?JSONObject.of("role","notification","kind","agent-answer","source",JSONObject.of("kind","user"),"replyTo",id(),"content",value.getString("message"),"timestamp",1):JSONObject.of("role","user","content",value.getString("question"),"timestamp",1);
    var context=new OntologyAgentAccess.Context(owner,new QueryAccessService.Access(new QueryAccessService.GrantUser(owner.userId(),owner.domainId()),permission,null,null,null,List.of()),"fixture-user",null,"en",Instant.now().plusSeconds(60).toEpochMilli(),caller);
    var parameters=new JSONObject(value);parameters.remove("question");
    inputs.computeIfAbsent(session,ignored->new JSONArray()).add(JSONObject.of("id",run,"message",input));
    var prepared=retrieval.prepareRun(session,run,input,run,answer?null:parameters,caller==null?run:caller,context);
    runtime.json(owner.domainId(),run,"/v1/sessions/"+session+"/runs","POST",prepared,run);
    retrieval.recover();
    for(int attempt=0;attempt<200 && !store.run(session,run,owner).getBooleanValue("runtime_admitted");attempt++) Thread.sleep(10);
    assertTrue(store.run(session,run,owner).getBooleanValue("runtime_admitted"));
    retrieval.reconcile(session,run,owner,runtime.run(owner.domainId(),run));
    return retrieval.get(session,owner);
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
                .header("X-Domain-Id", owner.domainId())
                .header("X-Ontomato-Retrieval-Caller-Id", caller)
                .header("Idempotency-Key", caller)
                .contentType("application/json")
                .content(AgentJson.json(scope)))
        .andExpect(status().isCreated());
    String retrievalId = id();
    var first=postJson("/ontology/retrievals",retrievalId,Map.of("question","Sales?"),caller);
    String run = first.getString("runtimeRunId");
    assertEquals(first.getString("runtimeSessionId"), retrievalId);
    assertEquals(1, requests.size());
    var environment = requests.get(run).getJSONObject("environment");
    assertNotEquals("fixture-user", environment.getJSONObject("secrets").getString("ONTOMATO_TK"));
    assertFalse(environment.getJSONObject("values").containsKey("ONTOMATO_WORKBENCH_URL"));
    var claims =
        grants.verify(
            environment.getJSONObject("secrets").getString("ONTOMATO_TK"),
            run,
            "/ontology/query/overview");
    assertEquals("ontology", claims.getString("servicePrincipal"));
    assertEquals(owner.userId(), claims.getString("userId"));
    assertEquals(owner.domainId(), claims.getString("domainId"));
    assertEquals(List.of("/sales"), claims.getList("classNames", String.class));
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
    // Reading the run is only a read; the recovery pass that finishes the stopped run closes its write gate.
    http.perform(get("/ontology/ai/sessions/" + retrievalId + "/runs/" + run))
        .andExpect(status().isOk());
    assertTrue(store.run(retrievalId, run, owner).getBooleanValue("open"));
    retrieval.recover();
    for (int attempt = 0; attempt < 200 && store.run(retrievalId, run, owner).getBooleanValue("open"); attempt++)
      Thread.sleep(10);
    assertThrows(AgentHttpException.class,
        () -> store.transaction(() -> store.gate(retrievalId, run, owner)));
    http.perform(
            post("/ontology/retrieval-callers/" + caller + "/close-scope")
                .header("tk", "fixture-user")
                .header("X-Ontomato-Query-Service-Token", "fixture-service"))
        .andExpect(status().isOk());
    assertFalse(cancelled.contains(run));
    var closedCaller = http.perform(get("/ontology/retrieval-callers/" + caller)
            .header("X-Ontomato-Query-Service-Token", "fixture-service")
            .header("X-Domain-Id", owner.domainId())
            .header("X-Ontomato-Retrieval-Caller-Id", caller))
        .andExpect(status().isOk()).andReturn();
    assertTrue(JSON.parseObject(closedCaller.getResponse().getContentAsString()).getBooleanValue("closed"));
    assertThrows(AgentHttpException.class,()->postJson("/ontology/retrievals",id(),Map.of("question","Late"),caller));
    assertEquals(1, requests.size());
    assertThrows(
        AgentHttpException.class,
        () ->
            store.session(
                retrievalId, new OntologyAgentStore.Owner(owner.userId(), "other-domain")));
  }

  @Test
  void explicitCancellationIsObservedStoppedAndEndsTheBusinessProjection() throws Exception {
    String caller = id();
    store.openCaller(caller, owner, JSONObject.of("classNames", List.of(), "continuationIds", List.of(),
        "deadlineAt", Instant.now().plusSeconds(60).toString(), "recentUserMessages", List.of()));
    String retrievalId = id();
    String run = postJson("/ontology/retrievals", retrievalId, Map.of("question", "Sales?"), caller).getString("runtimeRunId");
    // Explicit host cancellation is distinct from the parent finishing naturally.
    retrieval.cancel(retrievalId,run,owner);
    assertTrue(store.run(retrievalId, run, owner).getBooleanValue("cancel_confirmed"));
    // The scheduled recovery pass is what observes it; it repeats until the stop is recorded.
    for (int attempt = 0; attempt < 200 && results.forRun(retrievalId, run, owner).isEmpty(); attempt++) {
      retrieval.recover();
      Thread.sleep(10);
    }
    var task = tasks.read(retrievalId,run,owner);
    assertEquals("cancelled", task.getJSONObject("retrieval").getJSONArray("branches").getJSONObject(0).getString("status"));
    assertEquals("cancelled", task.getString("status"));
    assertEquals("cancelled",task.getJSONObject("retrieval").getJSONArray("branches").getJSONObject(0).getString("status"));
  }

  @Test
  void closedIntentAndContinuationHaveOneDurableOwner() throws Exception {
    String closed = id();
    store.closeScope(closed, owner);
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
    // Runtime replay never invokes prepare twice; the Java admission still preserves its exact stored request.
    var stored=store.run(retrievalId,answerId,owner);
    var admittedInput=store.retrieval(retrievalId,owner).getJSONObject("input");
    var replay=store.admit(retrievalId,answerId,owner,admittedInput,stored.getJSONObject("request"),null,false,
        OntologyRetrievalService.timeout(admittedInput),null,true,"en");
    assertTrue(replay.replayed());assertEquals(answerId,replay.run().getString("id"));
    assertEquals(2, requests.size());
    assertThrows(AgentHttpException.class,()->postJson("/ontology/retrievals",id(),Map.of("question","x","timeoutSeconds",601),null));
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
    assertFalse(externalSnapshot.containsKey("messages"));
  }

  @Test
  void replyToAnswersRecordTheSameConfirmedDecisionInSteerAndRunModes() throws Exception {
    String session=id();var first=postJson("/ontology/retrievals",session,Map.of("question","Sales?"),null);String run=first.getString("runtimeRunId");
    var context=new OntologyAgentAccess.Context(owner,new QueryAccessService.Access(new QueryAccessService.GrantUser(owner.userId(),owner.domainId()),permission,null,null,null,List.of()),null,null,"en",Instant.now().plusSeconds(60).toEpochMilli(),null);
    int beforeRevision=store.retrieval(session,owner).getIntValue("revision");
    var input=JSONObject.of("role","notification","kind","agent-answer","source",JSONObject.of("kind","user"),"replyTo",id(),"content","Current year","timestamp",1);
    retrieval.prepareSteer(session,run,input,context);
    var record=store.retrieval(session,owner);var decision=record.getJSONArray("decisions").getJSONObject(0);
    assertEquals(beforeRevision+1,record.getIntValue("revision"));assertEquals(1,store.run(session,run,owner).getIntValue("decision_revision"));
    assertEquals(Set.of("id","runId","text","scope","source","supersedesId"),decision.keySet());
    assertEquals(run,decision.getString("runId"));assertEquals("Current year",decision.getString("text"));assertEquals("task",decision.getString("scope"));assertEquals("user",decision.getString("source"));assertNull(decision.get("supersedesId"));
    runs.get(run).getJSONObject("run").put("status","stopped");runs.get(run).getJSONObject("run").put("stopReason","stop");
    retrieval.reconcile(session,run,owner,runtime.run(owner.domainId(),run));
    String next=id();input.put("content","Active employees only");inputs.get(session).add(JSONObject.of("id",next,"message",input));retrieval.prepareRun(session,next,input,next,null,next,context);
    assertEquals(2,store.run(session,next,owner).getIntValue("decision_revision"));
    assertEquals("Active employees only",store.retrieval(session,owner).getJSONArray("decisions").getJSONObject(1).getString("text"));
  }

  @Test
  void datasetExampleIsCompleteAndInvalidSubmissionsIdentifyTheirField() throws Exception {
    String reference;
    try (var stream = getClass().getResourceAsStream("/ontology-skills/data-retrieval/references/dataset.md")) {
      reference = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
    }
    var example = JSON.parseObject(reference.split("```json\\R", 2)[1].split("```", 2)[0]);
    var labels = example.remove("columnLabels");
    example.put("recipe", JSONObject.of("kind", "package", "package", QueryPackage.fromDsl("{\"answer\":{\"steps\":[{}]}}"),
        "parameters", new JSONObject(), "columnLabels", labels));
    example.put("question", "Count?"); example.put("decisionIds", new JSONArray());
    example.getJSONObject("recipe").getJSONObject("package").getJSONObject("manifest").getJSONArray("parameterDefs")
        .add(JSONObject.of("name", "limit", "type", "TYPE_NUMBER", "value", "25"));
    DatasetFileContract.preparation(example);
    assertInstanceOf(Number.class, example.getJSONObject("recipe").getJSONObject("package")
        .getJSONObject("manifest").getJSONArray("parameterDefs").getJSONObject(0).get("value"));
    var wrongCheck = AgentJson.copy(example);
    wrongCheck.getJSONObject("selfCheck").put("filters", new JSONArray());
    var wrongSource = AgentJson.copy(example);
    wrongSource.put("sourceAnalysis", new JSONObject());
    for (var entry : Map.of("selfCheck", wrongCheck, "sourceAnalysis", wrongSource).entrySet()) {
      var gate = postJson("/ontology/retrievals/skill-runs", id(), Map.of("question", "Count?"), null);
      String session = gate.getString("id"), run = gate.getString("runId");
      var response = http.perform(post("/ontology/retrievals/" + session + "/runs/" + run + "/outputs")
              .header("tk", "fixture-user").header("X-Ontomato-Run-Id", run).header("Idempotency-Key", id())
              .contentType("application/json").content(AgentJson.json(entry.getValue())))
          .andExpect(status().isBadRequest()).andReturn();
      String message = JSON.parseObject(response.getResponse().getContentAsString()).getJSONObject("error").getString("message");
      assertTrue(message.contains(entry.getKey()), message);
      assertNotEquals("Invalid request", message);
      if (entry.getKey().equals("selfCheck")) assertTrue(message.contains("filters must be text"));
    }
    verifyNoInteractions(jobs);
  }

  @Test
  void datasetExecutionKeepsTheAdmittedClassRangeWithAUserCredential() throws Exception {
    var payroll = new io.ontomato.dataengine.service.sys.bean.permission.FieldPermission("/payroll");
    payroll.getVisibleFields().add("value");
    permission.addFieldPermission(payroll);
    String caller = id();
    store.openCaller(caller, owner, JSONObject.of("classNames", List.of("/sales"),
        "continuationIds", List.of(), "deadlineAt", Instant.now().plusSeconds(60).toString()));
    var run = postJson("/ontology/retrievals/skill-runs", id(), Map.of("question", "Sales?"), caller);
    var definitions = List.<Map<String, Object>>of(
        JSONObject.of("className", "/sales", "attrs", JSONArray.of(JSONObject.of("name", "value", "enable", true))),
        JSONObject.of("className", "/payroll", "attrs", JSONArray.of(JSONObject.of("name", "value", "enable", true))));
    var query = JSON.parseObject("""
        {"answer":{"steps":[{"graph":{"patterns":[{"objects":[{"idx":0,"variable":"p","class":"/payroll"}]}]},
        "output":{"to_user":true,"fields":[{"variable":"p","field":"value","as":"value"}]}}]}}
        """);
    var analysis = QuerySourceAnalysis.fromDsl(query, definitions);
    var admin = mock(AdminService.class);
    when(admin.getJSONRule(owner.domainId())).thenReturn(Map.of("classDef", definitions));
    var engine = mock(DslService.class);
    when(engine.executeV1(any(), any(), any())).thenReturn(JSONObject.of("sourceAnalysis", analysis,
        "data", JSONArray.of(JSONObject.of("answer", JSONArray.of(JSONObject.of("value", 9))))));
    var ontology = new OntologyQueryService(admin, engine, null, null);
    org.springframework.test.util.ReflectionTestUtils.setField(ontology, "grants", grants);
    org.springframework.test.util.ReflectionTestUtils.setField(retrieval, "outputs", new QueryOutputService(null, null, ontology, null, new io.ontomato.dataengine.service.SubjectValueResolver(org.mockito.Mockito.mock(io.ontomato.dataengine.service.SubjectAttributeLookup.class))));
    var preparation = JSONObject.of("title", "Sales", "question", "Sales?", "recipe", JSONObject.of("kind", "package",
        "package", QueryPackage.fromDsl(query.toJSONString()), "parameters", new JSONObject(), "columnLabels", JSONObject.of("value", "Value")),
        "assumptions", new JSONArray(), "decisionIds", new JSONArray(), "metricUses", new JSONArray(),
        "selfCheck", JSONObject.of("scope", "", "filters", "", "grain", "", "denominator", "", "nullGroups", "", "comparisons", new JSONArray()));
    String output = id();
    http.perform(post("/ontology/retrievals/" + run.getString("id") + "/runs/" + run.getString("runId") + "/outputs")
            .header("tk", "fixture-user").header("X-Ontomato-Run-Id", run.getString("runId"))
            .header("X-Ontomato-Retrieval-Caller-Id", caller).header("Idempotency-Key", output)
            .contentType("application/json").content(AgentJson.json(preparation)))
        .andExpect(status().isAccepted());
    var operation = org.mockito.ArgumentCaptor.forClass(QueryJobService.Operation.class);
    verify(jobs).start(eq(output), any(io.ontomato.dataengine.core.bean.User.class), eq("output"), any(), operation.capture());
    var rejected = assertThrows(io.ontomato.dataengine.dataAdapter.DslContractViolationException.class, () -> operation.getValue().execute(output));
    assertTrue(rejected.getMessage().contains("Unknown DSL class"));
    verifyNoInteractions(engine);
  }

  @Test
  void executorOutputKeepsInitiatorJobsQuotesAndConfirmedDecisions() throws Exception {
    var source = new DriverManagerDataSource(jdbcUrl + "?currentSchema=" + schema, username, password);
    var jdbc = new JdbcTemplate(source);
    var executor = new QueryAccessService.GrantUser("user-v", owner.domainId());
    var executorOwner = new OntologyAgentStore.Owner(executor.getId(), executor.getDomainId());
    var executorPermission = new UserDataPermission();
    var visible = new io.ontomato.dataengine.service.sys.bean.permission.FieldPermission("/sales");
    visible.getVisibleFields().add("value");
    executorPermission.addFieldPermission(visible);
    var lookup = mock(DataPermissionLookup.class);
    when(lookup.getDataPermission(executor.getId(), owner.domainId())).thenReturn(executorPermission);
    var identity = mock(IdentityService.class);
    when(identity.getCurrentUser()).thenReturn(executor);
    when(identity.getCurrentUserDataPermission()).thenReturn(executorPermission);
    var queries = new QueryAccessService(identity, lookup, grants);
    var authorization = new OntologyAgentAccess(queries, identity, grants, store);
    var executions = mock(AgentExecutionAccess.class);
    when(executions.require(owner.domainId(), executor.getId())).thenReturn(executor);
    var filter = new QueryGrantFilter(grants);
    org.springframework.test.util.ReflectionTestUtils.setField(filter, "executions", executions);
    http = MockMvcBuilders.standaloneSetup(new OntologyRetrievalController(retrieval, store, authorization, tasks))
        .setControllerAdvice(new OntologyAgentErrors())
        .setMessageConverters(new org.springframework.http.converter.json.MappingJackson2HttpMessageConverter())
        .addFilters(filter).build();

    var sessions = mock(SessionRegistryService.class);
    when(sessions.getNodeId()).thenReturn("fixture-node");
    jobs = new QueryJobService(jdbc, sessions, mock(RuntimeCodeClient.class),
        new DataSourceTransactionManager(source), mock(AgentChannelChanges.class));
    jobs.initialize();
    org.springframework.test.util.ReflectionTestUtils.setField(retrieval, "jobs", jobs);
    var engine = mock(OntologyQueryService.class);
    when(engine.rule(any())).thenReturn(Map.of("classDef", List.of(JSONObject.of("className", "/sales",
        "attrs", JSONArray.of(JSONObject.of("name", "value", "enable", true))))));
    jdbc.execute("CREATE TABLE fixture_sales(user_id text NOT NULL,value integer NOT NULL)");
    for (int value = 1; value <= 5; value++) {
      jdbc.update("INSERT INTO fixture_sales VALUES(?,?),(?,?)", owner.userId(), value, executor.getId(), value + 100);
    }
    var executed = new java.util.concurrent.atomic.AtomicReference<QueryAccessService.Access>();
    var inherited = new java.util.concurrent.atomic.AtomicReference<QueryAccessService.Access>();
    var bridge = mock(OntologyGenerationService.class, CALLS_REAL_METHODS);
    org.springframework.test.util.ReflectionTestUtils.setField(bridge, "permissions", lookup);
    // The query adapter reads a per-user fixture; HTTP, output packaging and job persistence remain real.
    when(engine.execute(any(), any())).thenAnswer(call -> {
      var access = call.getArgument(1, QueryAccessService.Access.class);
      executed.set(access);
      inherited.set(bridge.executionAccess(owner.domainId()));
      var rows = new JSONArray(jdbc.queryForList("SELECT value FROM fixture_sales WHERE user_id=? ORDER BY value", access.user().getId()));
      return Map.of("data", List.of(Map.of("answer", rows)));
    });
    org.springframework.test.util.ReflectionTestUtils.setField(retrieval, "outputs", new QueryOutputService(null, null, engine, null,
        new SubjectValueResolver(mock(SubjectAttributeLookup.class))));

    var vContext = new OntologyAgentAccess.Context(executorOwner,
        new QueryAccessService.Access(executor, executorPermission, null, null, null, List.of("/sales")),
        null, null, "en", null, null);
    String vRun = id();
    var vSession = retrieval.begin(vRun, JSONObject.of("question", "V private question", "userQuotes", JSONArray.of("V private words")), vContext);
    var vAnswer = JSONObject.of("role", "notification", "kind", "agent-answer", "source", JSONObject.of("kind", "user"),
        "replyTo", id(), "content", "V private decision", "timestamp", 1);
    store.confirmAnswer(vSession.getString("id"), vRun, executorOwner, vAnswer);
    String vDecision = store.retrieval(vSession.getString("id"), executorOwner).getJSONArray("decisions").getJSONObject(0).getString("id");

    String caller = id(), session = id(), run = id(), output = id();
    long deadline = Instant.now().plusSeconds(300).toEpochMilli();
    store.openCaller(caller, owner, JSONObject.of("executionUserId", executor.getId(), "classNames", List.of("/sales"),
        "continuationIds", List.of(), "recentUserMessages", JSONArray.of("U original words"), "deadlineAt", Instant.ofEpochMilli(deadline).toString()));
    var selected = new QueryAccessService.Access(executor, executorPermission, null, null, deadline, List.of("/sales"),
        ExecutionTarget.LIVE, executor.getId(), owner.userId());
    var context = new OntologyAgentAccess.Context(owner, selected, null, null, "en", deadline, caller, executor.getId());
    var message = JSONObject.of("role", "user", "content", "U delegated question", "timestamp", 1);
    var prepared = retrieval.prepareRun(session, run, message, id(), null, run, context);
    var originalContext = JSON.parseObject(prepared.getJSONObject("definition").getString("context"));
    assertEquals(List.of("U original words"), originalContext.getList("userQuotes", String.class));
    var answer = JSONObject.of("role", "notification", "kind", "agent-answer", "source", JSONObject.of("kind", "user"),
        "replyTo", id(), "content", "U confirmed decision", "timestamp", 2);
    var steered = JSON.parseObject(retrieval.prepareSteer(session, run, answer, context).getString("context"));
    assertEquals(List.of("U original words"), steered.getList("userQuotes", String.class));
    assertEquals(List.of("U confirmed decision"), OntologyRetrievalService.confirmedDecisions(steered.getJSONArray("decisions")));
    String decision = store.retrieval(session, owner).getJSONArray("decisions").getJSONObject(0).getString("id");
    String grant = prepared.getJSONObject("environment").getJSONObject("secrets").getString("ONTOMATO_TK");
    String route = "/ontology/retrievals/" + session + "/runs/" + run + "/outputs";
    var query = JSON.parseObject("{\"answer\":{\"steps\":[{\"graph\":{\"patterns\":[{\"objects\":[{\"idx\":0,\"variable\":\"s\",\"class\":\"/sales\"}]}]},\"output\":{\"to_user\":true,\"fields\":[{\"variable\":\"s\",\"field\":\"value\",\"as\":\"value\"}]}}]}}");
    var preparation = JSONObject.of("title", "Sales", "question", "V private question", "decisionIds", JSONArray.of(vDecision),
        "recipe", JSONObject.of("kind", "package", "package", QueryPackage.fromDsl(query.toJSONString()),
            "parameters", new JSONObject(), "columnLabels", JSONObject.of("value", "Value")),
        "assumptions", new JSONArray(), "metricUses", new JSONArray(), "selfCheck", JSONObject.of("scope", "", "filters", "", "grain", "", "denominator", "", "nullGroups", "", "comparisons", new JSONArray()));
    http.perform(post(route).header("tk", grant).header("X-Ontomato-Run-Id", run).header("X-Ontomato-Session-Id", session)
        .header("Idempotency-Key", output).contentType("application/json").content(AgentJson.json(preparation)))
        .andExpect(status().isAccepted());
    org.awaitility.Awaitility.await().atMost(5, TimeUnit.SECONDS).until(() ->
        !"running".equals(jdbc.queryForObject("SELECT state->>'status' FROM ontology_query_jobs WHERE id=?::uuid", String.class, output)));
    var delivered = JSON.parseObject(http.perform(get(route + "/" + output).header("tk", grant)
        .header("X-Ontomato-Run-Id", run).header("X-Ontomato-Session-Id", session))
        .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    assertNull(delivered.get("error"), delivered.toJSONString());
    assertEquals(List.of(101, 102, 103, 104, 105), delivered.getJSONObject("dataset").getJSONArray("rows").stream()
        .map(JSONObject::from).map(row -> row.getIntValue("value")).toList());
    assertEquals(owner.userId(), jdbc.queryForObject("SELECT user_id FROM ontology_query_jobs WHERE id=?::uuid", String.class, output));
    assertEquals(executor.getId(), executed.get().user().getId());
    assertEquals(executor.getId(), inherited.get().user().getId());
    assertEquals(List.of("/sales"), executed.get().classNames());
    assertEquals(executorPermission.getFieldPermissions(), executed.get().permission().getFieldPermissions());
    var request = store.run(session, run, owner).getJSONObject("request");
    assertEquals(List.of("U original words"), request.getList("userQuotes", String.class));
    assertEquals(List.of("U confirmed decision"), OntologyRetrievalService.confirmedDecisions(store.retrieval(session, owner).getJSONArray("decisions")));
    var accepted = store.one("SELECT request FROM ontology_retrieval_outputs WHERE id=?::uuid", output).getJSONObject("request");
    assertEquals("U delegated question", accepted.getString("question"));
    assertEquals(List.of(decision), accepted.getList("decisionIds", String.class));
    assertEquals(List.of("V private words"), store.run(vSession.getString("id"), vRun, executorOwner).getJSONObject("request").getList("userQuotes", String.class));
    assertEquals(List.of("V private decision"), OntologyRetrievalService.confirmedDecisions(store.retrieval(vSession.getString("id"), executorOwner).getJSONArray("decisions")));
    http.perform(get("/ontology/retrievals/" + session).header("tk", "v-login")).andExpect(status().isNotFound());
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
    retrieval.reconcile(retrievalId, run, owner, runs.get(run));
    var snapshot = retrieval.get(retrievalId, owner);
    assertEquals(List.of(repeat), snapshot.getList("datasetArtifactIds", String.class));
    assertEquals(dataset, retrieval.dataset(retrievalId, good, owner).getJSONObject("payload"));
    assertThrows(AgentHttpException.class, () -> retrieval.dataset(retrievalId, changed, owner));
    runs.get(run).getJSONObject("run").put("status", "stopped");
    runs.get(run).getJSONObject("run").put("stopReason", "stop");
    when(quality.start(any(), any(), any()))
        .thenThrow(new IllegalStateException("Lost admission response"))
        .thenReturn(Map.of());
    assertThrows(IllegalStateException.class, () -> retrieval.reconcile(retrievalId, run, owner, runs.get(run)));
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
    if (jobs != null) jobs.close();
    if (server != null) server.stop(0);
    if (schema != null)
      try (var c = DriverManager.getConnection(jdbcUrl, username, password);
          var sql = c.createStatement()) {
        sql.execute("DROP SCHEMA " + schema + " CASCADE");
      }
  }
}
