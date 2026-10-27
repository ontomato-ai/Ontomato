package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.sun.net.httpserver.HttpServer;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.service.impl.ABCProgramServiceImpl;
import io.ontomato.dataengine.service.impl.PythonExecuteServiceImpl;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * Real Java Function caller -> runtime HTTP -> Python/helper -> grant-validated HTTP data fixture.
 */
class RuntimeFunctionIntegrationTest {
  @Test
  @Timeout(60)
  void functionAndMetricReplayPreserveParametersNullsAndUserAuthority() throws Exception {
    String database = System.getenv("RUNTIME_TEST_DATABASE_URL");
    Assumptions.assumeTrue(database != null);
    URI db = URI.create(database);
    String[] account = db.getUserInfo().split(":", 2);
    String jdbcUrl = "jdbc:postgresql://" + db.getHost() + ":" + db.getPort() + db.getPath();
    String schema = "function_proof_" + UUID.randomUUID().toString().replace("-", "");
    Path root = Path.of("../..").toRealPath();
    Path scratch = Files.createTempDirectory("ontology-function-proof-");
    Path log = scratch.resolve("runtime.log");
    Process runtimeProcess = null;
    HttpServer ontologyHttp = null;
    try (var connection = DriverManager.getConnection(jdbcUrl, account[0], account[1])) {
      connection.createStatement().execute("CREATE SCHEMA " + schema);
      var jdbc =
          new JdbcTemplate(
              new DriverManagerDataSource(
                  jdbcUrl + "?currentSchema=" + schema, account[0], account[1]));
      var permission = new UserDataPermission();
      permission.setFullData(true);
      var lookup = mock(DataPermissionLookup.class);
      when(lookup.getDataPermission("reader", "domain-a")).thenReturn(permission);
      var grants =
          new QueryGrantService(
              jdbc, lookup, mock(IdentityService.class), "fixture-signing", "fixture-service");
      grants.initialize();
      var calls = new AtomicInteger();
      ontologyHttp = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      ontologyHttp.createContext(
          "/ontology/query/execute-dsl",
          exchange -> {
            try {
              var claims =
                  grants.verify(
                      exchange.getRequestHeaders().getFirst("Authorization").substring(7),
                      exchange.getRequestHeaders().getFirst("X-Ontomato-Run-Id"),
                      exchange.getRequestURI().getPath());
              if (!"reader".equals(claims.getString("userId"))
                  || !"domain-a".equals(claims.getString("domainId"))
                  || !"user-read".equals(claims.getString("purpose")))
                throw new IllegalStateException("Wrong execution authority");
              var request = JSON.parseObject(exchange.getRequestBody().readAllBytes());
              if (!request.keySet().equals(java.util.Set.of("dsl")))
                throw new IllegalStateException("Identity appeared in DSL body");
              calls.incrementAndGet();
              byte[] answer =
                  "{\"data\":[{\"answer\":[{\"count\":2,\"region\":null,\"valid\":false}]}]}"
                      .getBytes(java.nio.charset.StandardCharsets.UTF_8);
              exchange.getResponseHeaders().set("Content-Type", "application/json");
              exchange.sendResponseHeaders(200, answer.length);
              exchange.getResponseBody().write(answer);
            } catch (Exception error) {
              byte[] text = JSON.toJSONBytes(Map.of("error", error.getMessage()));
              exchange.sendResponseHeaders(403, text.length);
              exchange.getResponseBody().write(text);
            } finally {
              exchange.close();
            }
          });
      ontologyHttp.start();
      String ontologyUrl = "http://127.0.0.1:" + ontologyHttp.getAddress().getPort();
      int port;
      try (var socket = new ServerSocket(0)) {
        port = socket.getLocalPort();
      }
      String runtimeUrl = "http://127.0.0.1:" + port;
      var builder =
          new ProcessBuilder(
                  "node",
                  "--import",
                  root.resolve("packages/agent-runtime/node_modules/tsx/dist/loader.mjs")
                      .toString(),
                  root.resolve("apps/agent-runtime/src/index.ts").toString())
              .directory(root.toFile());
      var env = builder.environment();
      env.clear();
      for (String name : List.of("PATH", "SystemRoot", "WINDIR"))
        if (System.getenv(name) != null) env.put(name, System.getenv(name));
      Path emptyEnv = scratch.resolve("empty.env");
      Files.writeString(emptyEnv, "");
      env.putAll(
          Map.of(
              "NODE_ENV",
              "test",
              "DOTENV_CONFIG_PATH",
              emptyEnv.toString(),
              "AGENT_RUNTIME_PORT",
              String.valueOf(port),
              "AGENT_RUNTIME_ROOT",
              scratch.resolve("data").toString(),
              "AGENT_RUNTIME_MODEL_CONFIG_URL",
              ontologyUrl,
              "AGENT_RUNTIME_DATABASE",
              db.getPath().substring(1),
              "AGENT_RUNTIME_SCHEMA",
              schema + "_runtime"));
      env.putAll(
          Map.of(
              "POSTGRES_HOST",
              db.getHost(),
              "POSTGRES_PORT",
              String.valueOf(db.getPort()),
              "POSTGRES_USER",
              account[0],
              "POSTGRES_PASSWORD",
              account[1],
              "AGENT_RUNTIME_HOSTS",
              "[{\"id\":\"ontology\",\"token\":\"fixture-host\",\"providers\":[\"ontology\"],\"publishProviders\":[\"ontology\"]}]"));
      runtimeProcess = builder.redirectErrorStream(true).redirectOutput(log.toFile()).start();
      var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(1)).build();
      boolean ready = false;
      for (int i = 0; i < 100 && runtimeProcess.isAlive(); i++) {
        try {
          ready =
              client
                      .send(
                          HttpRequest.newBuilder(URI.create(runtimeUrl + "/health"))
                              .timeout(Duration.ofSeconds(1))
                              .build(),
                          HttpResponse.BodyHandlers.discarding())
                      .statusCode()
                  == 200;
        } catch (Exception ignored) {
        }
        if (ready) break;
        Thread.sleep(100);
      }
      assertTrue(
          ready,
          () -> {
            try {
              return Files.readString(log);
            } catch (Exception e) {
              return e.toString();
            }
          });
      var entrance = new BackendSessionEntrance();
      ReflectionTestUtils.setField(
          entrance, "sessionRegistryService", mock(SessionRegistryService.class));
      entrance.publishInstance();
      var python =
          new PythonExecuteServiceImpl(
              new RuntimeCodeClient(runtimeUrl, "fixture-host", ontologyUrl), grants);
      var programs = new ABCProgramServiceImpl();
      ReflectionTestUtils.setField(programs, "pythonExecuteService", python);
      var function =
          JSON.parseObject(
              """
{"id":"function-a","domainId":"domain-a","operation":"OPERATION_READ","description":null,"logic":null,
 "parameters":[{"name":"multiplier","type":"TYPE_NUMBER","value":3,"sample":null,"classNames":null}],
 "returnDef":{"isVoid":false,"classNames":["/sales"],"value":null,"outKeyRefs":[
 {"key":"count","className":"/sales","attrName":"count","asGroupBy":false,"statCal":true},
 {"key":"region","className":"/sales","attrName":"region","asGroupBy":true,"statCal":false},
 {"key":"valid","className":"/sales","attrName":"valid","asGroupBy":false,"statCal":false}]}}
""",
              Function.class);
      function.setCode(
          """
          # ontomato-python:2
          from __future__ import annotations
          import json
          from query_runtime import execute_dsl, parameters
          rows = execute_dsl({"problem":"fixture","answer":{"steps":[{}]}})
          for row in rows:
              row["count"] *= parameters["multiplier"]
          print(json.dumps({"answer":rows}))
          """);
      JSONArray rows =
          (JSONArray)
              programs
                  .execute("function", function, "reader", permission, null, "en", 1, "domain-a")[
                  0];
      assertEquals(6, rows.getJSONObject(0).getIntValue("count"));
      assertTrue(rows.getJSONObject(0).containsKey("region"));
      assertNull(rows.getJSONObject(0).get("region"));
      assertEquals(false, rows.getJSONObject(0).get("valid"));
      var metric = new MetricView();
      metric.setId("metric-a");
      metric.setType("GENERAL");
      metric.setFunction(function);
      var ontology = mock(OntologyQueryService.class);
      when(ontology.metric(eq("metric-a"), eq("revision-a"), any())).thenReturn(metric);
      when(ontology.rule(any()))
          .thenReturn(
              JSON.parseObject(
                  "{\"classDef\":[{\"className\":\"/sales\",\"attrs\":[{\"name\":\"count\",\"enable\":null},{\"name\":\"region\"},{\"name\":\"valid\"}]}]}"));
      var config = mock(BusinessConfigService.class);
      var settings = new BusinessConfig();
      settings.setDslCookerTimeout(60000L);
      when(config.get("domain-a")).thenReturn(settings);
      String originalFunctionCode = function.getCode();
      var output =
          new QueryOutputService(python, programs, ontology, config)
              .execute(
                  UUID.randomUUID().toString(),
                  JSONObject.of(
                      "kind",
                      "metric",
                      "metricId",
                      "metric-a",
                      "revision",
                      "revision-a",
                      "parameters",
                      JSONObject.of("multiplier", 4)),
                  new JSONArray(),
                  new QueryGrantService.Access(
                      new QueryGrantService.GrantUser("reader", "domain-a"),
                      permission,
                      null,
                      null),
                  "en");
      assertEquals(8, output.getJSONArray("rows").getJSONObject(0).getIntValue("count"));
      var saved = new ABCHarnessProgram();
      saved.setCode(output.getJSONObject("recipe").getString("executedCode"));
      saved.setOutKeyRefs(function.getReturnDef().getOutKeyRefs());
      rows =
          (JSONArray)
              programs.execute("saved", saved, "reader", permission, "en", 1, "domain-a")[0];
      assertEquals(8, rows.getJSONObject(0).getIntValue("count"));
      assertEquals(3, calls.get());
      assertEquals(originalFunctionCode, metric.getFunction().getCode());
      permission.setFullData(false);
      rows =
          (JSONArray)
              programs.execute("masked", saved, "reader", permission, "en", 1, "domain-a")[0];
      assertEquals("****", rows.getJSONObject(0).get("count"));
      function.setCode("print('retired protocol')");
      assertThrows(
          IllegalArgumentException.class,
          () ->
              new QueryOutputService(python, programs, ontology, config)
                  .execute(
                      UUID.randomUUID().toString(),
                      JSONObject.of(
                          "kind",
                          "metric",
                          "metricId",
                          "metric-a",
                          "revision",
                          "revision-a",
                          "parameters",
                          JSONObject.of("multiplier", 4)),
                      new JSONArray(),
                      new QueryGrantService.Access(
                          new QueryGrantService.GrantUser("reader", "domain-a"),
                          permission,
                          null,
                          null),
                      "en"));
      assertEquals(4, calls.get());
    } finally {
      if (runtimeProcess != null) {
        runtimeProcess.destroy();
        if (!runtimeProcess.waitFor(5, TimeUnit.SECONDS)) {
          runtimeProcess.destroyForcibly();
          runtimeProcess.waitFor();
        }
      }
      if (ontologyHttp != null) ontologyHttp.stop(0);
      try (var c = DriverManager.getConnection(jdbcUrl, account[0], account[1]);
          var s = c.createStatement()) {
        s.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        s.execute("DROP SCHEMA IF EXISTS " + schema + "_runtime CASCADE");
      }
      try (var paths = Files.walk(scratch)) {
        for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList())
          Files.deleteIfExists(path);
      }
    }
  }
}
