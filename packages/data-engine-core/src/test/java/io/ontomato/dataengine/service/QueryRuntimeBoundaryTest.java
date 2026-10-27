package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.controller.*;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import java.net.URI;
import java.sql.DriverManager;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

/** Real PostgreSQL grant state and HTTP guards; identity and data adapter are explicit doubles. */
class QueryRuntimeBoundaryTest {
  static String schema, jdbcUrl, username, password;
  QueryGrantService grants;
  IdentityService identity;
  DataPermissionLookup lookup;
  DslService dsl;
  OntologyQueryService ontology;
  MockMvc http;
  final User user = new QueryGrantService.GrantUser("user-a", "domain-a");
  final UserDataPermission permission = new UserDataPermission();

  @BeforeAll
  static void database() throws Exception {
    String value = System.getenv("RUNTIME_TEST_DATABASE_URL");
    Assumptions.assumeTrue(value != null);
    URI url = URI.create(value);
    String[] account = url.getUserInfo().split(":", 2);
    username = account[0];
    password = account.length > 1 ? account[1] : "";
    jdbcUrl = "jdbc:postgresql://" + url.getHost() + ":" + url.getPort() + url.getPath();
    schema = "query_boundary_" + UUID.randomUUID().toString().replace("-", "");
    try (var c = DriverManager.getConnection(jdbcUrl, username, password);
        var s = c.createStatement()) {
      s.execute("CREATE SCHEMA " + schema);
    }
  }

  @AfterAll
  static void cleanup() throws Exception {
    if (schema != null)
      try (var c = DriverManager.getConnection(jdbcUrl, username, password);
          var s = c.createStatement()) {
        s.execute("DROP SCHEMA " + schema + " CASCADE");
      }
  }

  @BeforeEach
  void setup() {
    identity = mock(IdentityService.class);
    lookup = mock(DataPermissionLookup.class);
    dsl = mock(DslService.class);
    when(identity.getCurrentUser()).thenReturn(user);
    when(identity.getCurrentUserDataPermission()).thenReturn(permission);
    when(lookup.getDataPermission("user-a", "domain-a")).thenReturn(permission);
    grants =
        new QueryGrantService(
            new JdbcTemplate(
                new DriverManagerDataSource(
                    jdbcUrl + "?currentSchema=" + schema, username, password)),
            lookup,
            identity,
            "fixture-signing-key",
            "fixture-workbench-secret");
    grants.initialize();
    AdminService admin = mock(AdminService.class);
    // Real configuration shape includes null descriptions and optional attribute flags.
    when(admin.getJSONRule("domain-a"))
        .thenReturn(
            JSONObject.parseObject(
                """
{"datasetdesc":null,"classDef":[
  {"className":"/sales","classDesc":"Sales facts","attrs":[{"name":"count","type":"number","enable":null,"primaryKey":null,"attrDesc":null,"indicators":null},{"name":"hidden","type":"varchar","enable":false}]},
  {"className":"/payroll","classDesc":null,"attrs":[{"name":"count","type":"number","enable":true}]}],"relationship_rule":{}}
"""));
    ontology =
        new OntologyQueryService(
            admin, dsl, mock(MetricViewService.class), mock(KnowledgeDao.class));
    when(dsl.executeV1(any(), any(), any()))
        .thenReturn(Map.of("data", List.of(Map.of("answer", List.of()))));
    var controller =
        new OntologyQueryController(
            grants,
            ontology,
            mock(QueryOutputService.class),
            mock(QueryJobService.class),
            mock(CheckServiceV2.class),
            mock(RuntimeCodeClient.class));
    http =
        MockMvcBuilders.standaloneSetup(controller, new DslController())
            .setControllerAdvice(new OntologyQueryErrors())
            .addFilters(new QueryGrantFilter(grants))
            .build();
  }

  private String grant(String run, String purpose) {
    return grants.issue(
        "user-a",
        "domain-a",
        purpose,
        run,
        System.currentTimeMillis() + 60000,
        List.of("/sales"),
        null);
  }

  private String query(String clazz) {
    return "{\"dsl\":{\"problem\":\"test\",\"answer\":{\"steps\":[{\"graph\":{\"patterns\":[{\"objects\":[{\"class\":\""
        + clazz
        + "\",\"idx\":0,\"variable\":\"s\"}]}]},\"output\":{\"to_user\":true,\"fields\":[]}}]}}}";
  }

  @Test
  void grantCannotChangeRunDomainPurposeOrScopeAndRevocationIsImmediate() throws Exception {
    String run = UUID.randomUUID().toString(), token = grant(run, "retrieval-exploration");
    var claims = grants.verify(token, run, "/ontology/query/execute-dsl");
    assertEquals("domain-a", claims.getString("domainId"));
    http.perform(
            post("/ontology/query/execute-dsl")
                .header("Authorization", "Bearer " + token)
                .header("X-Ontomato-Run-Id", run)
                .header("X-Domain-Id", "domain-b")
                .contentType("application/json")
                .content(query("/sales")))
        .andExpect(status().isOk());
    verify(dsl).executeV1(any(), any(), argThat(u -> "domain-a".equals(u.getDomainId())));
    http.perform(
            post("/ontology/query/execute-dsl")
                .header("Authorization", "Bearer " + token)
                .header("X-Ontomato-Run-Id", run)
                .contentType("application/json")
                .content(query("/payroll")))
        .andExpect(status().isForbidden());
    assertThrows(
        ResponseStatusException.class,
        () -> grants.verify(token, UUID.randomUUID().toString(), "/ontology/query/execute-dsl"));
    assertThrows(
        ResponseStatusException.class,
        () -> grants.verify(token, run, "/writeFunctionOperation/insert"));
    assertThrows(
        ResponseStatusException.class, () -> grants.verify(token, run, "/ontology/query/outputs"));
    grants.revoke("domain-a", run);
    assertThrows(
        ResponseStatusException.class,
        () -> grants.verify(token, run, "/ontology/query/execute-dsl"));
  }

  @Test
  void ordinaryCredentialCannotIssueExplorationAndBodyIdentityCannotOverrideUser()
      throws Exception {
    assertThrows(
        ResponseStatusException.class, () -> grants.requireWorkbench(new MockHttpServletRequest()));
    http.perform(
            post("/ontology/query/execute-dsl")
                .contentType("application/json")
                .content(
                    query("/sales")
                        .replace(
                            "{\"dsl\":",
                            "{\"userId\":\"admin\",\"domainId\":\"domain-b\",\"dsl\":")))
        .andExpect(status().isBadRequest());
    verifyNoInteractions(dsl);
    http.perform(post("/dsl/execute").contentType("application/json").content(query("/sales")))
        .andExpect(status().isNotFound());
    http.perform(
            post("/writeFunctionOperation/insert")
                .contentType("application/json")
                .content("{\"domainId\":\"domain-a\"}"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void userReadDelegationResolvesCurrentPermissionsAndCannotWrite() {
    String run = UUID.randomUUID().toString(), token = grant(run, "user-read");
    var request = new MockHttpServletRequest();
    request.addHeader("Authorization", "Bearer " + token);
    request.setAttribute(
        QueryGrantService.ATTRIBUTE, grants.verify(token, run, "/ontology/query/execute-dsl"));
    assertSame(permission, grants.access(request).permission());
    verify(lookup).getDataPermission("user-a", "domain-a");
    assertThrows(
        ResponseStatusException.class,
        () -> grants.verify(token, run, "/writeFunctionOperation/query"));
  }

  @Test
  void expirationTamperingAndObjectOrderHaveExplicitBehavior() {
    String run = UUID.randomUUID().toString(), token = grant(run, "retrieval-exploration");
    assertThrows(
        ResponseStatusException.class,
        () -> grants.verify(token + "changed", run, "/ontology/query/execute-dsl"));
    assertThrows(
        IllegalArgumentException.class,
        () ->
            grants.issue(
                "a",
                "d",
                "retrieval-exploration",
                run,
                System.currentTimeMillis() - 1,
                List.of(),
                null));
    assertEquals(
        OntologyQueryService.digest(
            JSONObject.parseObject("{\"a\":null,\"b\":{\"x\":0,\"y\":false}}")),
        OntologyQueryService.digest(
            JSONObject.parseObject("{\"b\":{\"y\":false,\"x\":0},\"a\":null}")));
  }

  @Test
  void issuerBindsRetrievalSessionAndOriginalCredentialDeadline() {
    long expiry = System.currentTimeMillis() + 30000;
    when(identity.getCurrentCredentialExpiresAt()).thenReturn(expiry);
    var body =
        JSONObject.of(
            "retrievalId",
            UUID.randomUUID().toString(),
            "runtimeSessionId",
            UUID.randomUUID().toString(),
            "runtimeRunId",
            UUID.randomUUID().toString(),
            "expiresAt",
            java.time.Instant.now().plusSeconds(600).toString(),
            "classNames",
            List.of("/sales"));
    String token =
        grants.issueExploration(new QueryGrantService.Access(user, permission, null, null), body);
    var claims = grants.verify(token, body.getString("runtimeRunId"), "/ontology/query/overview");
    assertEquals(expiry, claims.getLongValue("expiresAt"));
    assertEquals(body.getString("retrievalId"), claims.getString("retrievalId"));
    assertEquals(body.getString("runtimeSessionId"), claims.getString("sessionId"));
    assertEquals("workbench", claims.getString("servicePrincipal"));
  }

  @Test
  void jobsAreScopedIdempotentAndCancellationClosesLostAdmission() throws Exception {
    var jdbc =
        new JdbcTemplate(
            new DriverManagerDataSource(jdbcUrl + "?currentSchema=" + schema, username, password));
    var sessions = mock(SessionRegistryService.class);
    when(sessions.getNodeId()).thenReturn("fixture-node");
    var runtime = mock(RuntimeCodeClient.class);
    var jobs = new QueryJobService(jdbc, sessions, runtime);
    jobs.initialize();
    String id = UUID.randomUUID().toString();
    var count = new java.util.concurrent.atomic.AtomicInteger();
    var entered = new java.util.concurrent.CountDownLatch(1);
    var release = new java.util.concurrent.CountDownLatch(1);
    try {
      String closedId = UUID.randomUUID().toString();
      jobs.cancel(closedId, user, "output");
      assertEquals(
          "cancelled",
          jobs.start(
                  closedId,
                  user,
                  "output",
                  Map.of(),
                  sid -> {
                    throw new AssertionError("Closed intent executed");
                  })
              .getString("status"));
      QueryJobService.Operation operation =
          sid -> {
            count.incrementAndGet();
            entered.countDown();
            release.await();
            return Map.of("value", 0);
          };
      jobs.start(id, user, "output", Map.of("a", 0), operation);
      assertTrue(entered.await(5, java.util.concurrent.TimeUnit.SECONDS));
      jobs.start(id, user, "output", Map.of("a", 0), operation);
      assertEquals(1, count.get());
      assertThrows(
          ResponseStatusException.class,
          () -> jobs.start(id, user, "quality", Map.of("a", 0), operation));
      assertThrows(
          ResponseStatusException.class,
          () -> jobs.start(id, user, "output", Map.of("a", 1), operation));
      User other = new QueryGrantService.GrantUser("user-b", "domain-b");
      assertThrows(ResponseStatusException.class, () -> jobs.get(id, other, "output"));
      jobs.start(id, other, "output", Map.of("a", 0), sid -> Map.of("value", 1));
      assertEquals("cancelled", jobs.cancel(id, user, "output").getString("status"));
      verify(runtime).closeIntent(eq("domain-a"), anyString());
      assertNotEquals("cancelled", jobs.get(id, other, "output").getString("status"));
    } finally {
      release.countDown();
      jobs.close();
    }
  }

  @Test
  void metricCatalogueIsBoundedReadOnlyDomainScopedAndDoesNotHideDatabaseFailure() {
    var jdbc =
        new JdbcTemplate(
            new DriverManagerDataSource(jdbcUrl + "?currentSchema=" + schema, username, password));
    jdbc.execute("CREATE TABLE function(id text,domain_id text,operation text)");
    jdbc.execute(
        "CREATE TABLE metric_view(id text,name text,origin text,type text,function_id"
            + " text,description text,status text,match_questions text,class_names text,domain_id"
            + " text,create_timestamp bigint,modify_timestamp bigint,origin_check_result"
            + " text,origin_question text)");
    var dao = new io.ontomato.dataengine.dao.MetricViewDao();
    org.springframework.test.util.ReflectionTestUtils.setField(dao, "jdbcTemplate", jdbc);
    org.springframework.test.util.ReflectionTestUtils.setField(
        dao,
        "assetLookupPolicy",
        (io.ontomato.dataengine.dao.AssetLookupPolicy) (db, table) -> true);
    for (int i = 0; i < 4; i++) {
      jdbc.update(
          "INSERT INTO function VALUES(?,?,?)",
          "f" + i,
          i == 3 ? "domain-b" : "domain-a",
          i == 2 ? "OPERATION_WRITE" : "OPERATION_READ");
      jdbc.update(
          "INSERT INTO metric_view(id,name,type,function_id,status,class_names,domain_id)"
              + " VALUES(?,?,?,?,?,?,?)",
          "m" + i,
          "Sales_" + i,
          "GENERAL",
          "f" + i,
          io.ontomato.dataengine.bean.metricView.MetricView.STATUS_PUBLISHED,
          ",/sales,",
          i == 3 ? "domain-b" : "domain-a");
    }
    var page = dao.queryForRetrieval("domain-a", "Sales_", null, List.of("/sales"), 1);
    assertEquals(1, page.size());
    assertNull(
        ((io.ontomato.dataengine.bean.metricView.MetricView) page.get(0)[0]).getDescription());
    assertEquals(
        1, dao.queryForRetrieval("domain-a", "Sales_", "m0", List.of("/sales"), 20).size());
    assertTrue(dao.queryForRetrieval("domain-a", "%", null, List.of(), 20).isEmpty());
    jdbc.execute("DROP TABLE metric_view");
    assertThrows(
        org.springframework.dao.DataAccessException.class,
        () -> dao.queryForRetrieval("domain-a", "", null, List.of(), 20));
  }

  @Test
  void schemaUsesRealNullableOntologyShapeAndEnabledFieldSemantics() throws Exception {
    var access = new QueryGrantService.Access(user, permission, null, null);
    JSONObject overview = JSONObject.from(ontology.overview(access));
    assertEquals(
        "Sales facts", overview.getJSONArray("classes").getJSONObject(0).getString("description"));
    JSONObject schema =
        JSONObject.parseObject(
            http.perform(
                    post("/ontology/query/schema")
                        .contentType("application/json")
                        .content("{\"classNames\":[\"/sales\"]}"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString());
    var fields = schema.getJSONArray("classes").getJSONObject(0).getJSONArray("attrs");
    assertEquals(1, fields.size());
    assertTrue(fields.getJSONObject(0).containsKey("attrDesc"));
    assertNull(fields.getJSONObject(0).get("attrDesc"));
    assertThrows(IllegalArgumentException.class, () -> ontology.metric("id", null, access));
  }
}
