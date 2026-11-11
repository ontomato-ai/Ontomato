package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.alibaba.fastjson2.*;
import com.sun.net.httpserver.HttpServer;
import io.ontomato.dataengine.controller.WriteFunctionOperationController;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.*;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.service.ai.EmbeddingService;
import io.ontomato.dataengine.service.impl.*;
import io.ontomato.dataengine.service.vector.VectorRetrievalGate;
import io.ontomato.dataengine.util.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.http.MockHttpInputMessage;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.*;

/** Real Python helper, HTTP controller, write service, PostgreSQL adapter and asset storage.
 * Identity, embeddings and adapter selection are explicit test doubles; no model or runtime service is needed.
 */
class AgentWritePostgresContractTest {
  @TempDir Path work;
  private static final Path FIXTURES = Path.of("../../data-engine-core/src/test/resources/agent-contracts");
  private static String fixture(String name) throws Exception { return Files.readString(FIXTURES.resolve(name)); }

  @Test void savedLegalActionExecutesThroughPythonAndMalformedInputsHaveNoEffects() throws Exception {
    String url = Objects.requireNonNull(System.getenv("ONTOMATO_TEST_POSTGRES_URL"), "ONTOMATO_TEST_POSTGRES_URL is required; database tests must not skip");
    String user = System.getenv("ONTOMATO_TEST_POSTGRES_USER"), password = System.getenv("ONTOMATO_TEST_POSTGRES_PASSWORD");
    var admin = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
    String schema = "agent_contract_" + UUID.randomUUID().toString().replace("-", "");
    admin.execute("CREATE SCHEMA " + schema);
    HttpServer server = null;
    try {
      String scoped = url + (url.contains("?") ? "&" : "?") + "currentSchema=" + schema + ",public";
      var jdbc = new JdbcTemplate(new DriverManagerDataSource(scoped, user, password));
      jdbc.execute("CREATE EXTENSION IF NOT EXISTS vector");
      jdbc.execute("CREATE TABLE contract_person(id varchar PRIMARY KEY, name varchar, age int)");
      var functions = new FunctionDao();
      ReflectionTestUtils.setField(functions, "jdbcTemplate", jdbc);
      functions.initIndex();
      var actions = new ActionDao();
      ReflectionTestUtils.setField(actions, "jdbcTemplate", jdbc);
      ReflectionTestUtils.setField(actions, "functions", functions);
      var embedding = mock(EmbeddingService.class);
      when(embedding.embedding(anyString(), any())).thenReturn(new float[] {0, 1});
      ReflectionTestUtils.setField(actions, "embeddingService", embedding);
      var gate = mock(VectorRetrievalGate.class);
      when(gate.write(any(), any())).thenAnswer(call -> ((Supplier<?>) call.getArgument(1)).get());
      ReflectionTestUtils.setField(actions, "retrievalGate", gate);
      actions.initIndex();
      var assets = new ActionServiceImpl();
      ReflectionTestUtils.setField(assets, "actionDao", actions);
      ReflectionTestUtils.setField(assets, "langService", mock(LangService.class));
      var assetInput = new MockHttpInputMessage(JSON.toJSONBytes(JSON.parseArray(fixture("actions.json")).getJSONObject(0)));
      assetInput.getHeaders().setContentType(MediaType.APPLICATION_JSON);
      var asset = (JSONObject) new MappingJackson2HttpMessageConverter().read(JSONObject.class, assetInput);
      FunctionDao.requireSupported(Function.fromAsset(asset), "en");
      byte[] bundle = ZipBundleUtil.zip("actions.json", fixture("actions.json").getBytes(StandardCharsets.UTF_8));
      try (var identity = mockStatic(SystemUtils.class)) {
        identity.when(SystemUtils::getCurUser).thenReturn(new QueryAccessService.GrantUser("test", "contract"));
        assertTrue(assets.importActions(bundle, "en", false).getBooleanValue("success"));
        var bad = JSON.parseArray(fixture("actions.json"));
        bad.getJSONObject(0).put("id", "invalid-action");
        bad.getJSONObject(0).remove("codeHash");
        var rejected = assets.importActions(ZipBundleUtil.zip("actions.json", bad.toJSONString().getBytes(StandardCharsets.UTF_8)), "en", true);
        assertFalse(rejected.getBooleanValue("success"));
        assertEquals(1, rejected.getIntValue("failureCount"));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM action", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM function", Integer.class));
      }
      var rule = JSON.parseObject("{\"classDef\":[{\"className\":\"contract_person\",\"attrs\":[{\"name\":\"id\",\"type\":\"varchar\",\"primaryKey\":true},{\"name\":\"name\",\"type\":\"varchar\"},{\"name\":\"age\",\"type\":\"int\"}]}],\"relationship_rule\":{}}");
      var connection = new DataAdapterConnection();
      connection.put("url", scoped); connection.put("user", user); connection.put("password", password);
      var adapter = new PostgreAdapter(connection, rule);
      var registry = mock(DataAdapterRegistry.class);
      when(registry.create(any(), any())).thenReturn(adapter);
      var rules = mock(JSONRuleDao.class);
      when(rules.query("contract")).thenReturn(rule);
      var writes = new WriteFunctionOperationServiceImpl();
      ReflectionTestUtils.setField(writes, "jsonRuleDao", rules);
      ReflectionTestUtils.setField(writes, "dataRagConfig", new DataRagConfig());
      ReflectionTestUtils.setField(writes, "dataAdapterRegistry", registry);
      ReflectionTestUtils.setField(writes, "businessConfigService", mock(BusinessConfigService.class));
      var http = new WriteFunctionOperationController();
      ReflectionTestUtils.setField(http, "jsonRuleDao", rules);
      ReflectionTestUtils.setField(http, "writeFunctionOperationService", writes);
      var queryService = mock(OntologyQueryService.class);
      when(queryService.execute(any(), any())).thenAnswer(call ->
          writes.query(call.getArgument(0), null, "contract"));
      ReflectionTestUtils.setField(http, "queries", queryService);
      ReflectionTestUtils.setField(http, "accessService", mock(QueryAccessService.class));
      ReflectionTestUtils.setField(http, "request", new MockHttpServletRequest());
      server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      server.createContext("/writeFunctionOperation/", exchange -> {
        var request = new MockHttpServletRequest();
        request.setAttribute(QueryGrantService.ATTRIBUTE, JSONObject.of("domainId", "contract"));
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        JSONObject result;
        try {
          var input = new MockHttpInputMessage(exchange.getRequestBody().readAllBytes());
          input.getHeaders().setContentType(MediaType.APPLICATION_JSON);
          var body = (JSONObject) new MappingJackson2HttpMessageConverter().read(JSONObject.class, input);
          result = switch (exchange.getRequestURI().getPath()) {
            case "/writeFunctionOperation/insert" -> http.insert(body);
            case "/writeFunctionOperation/update" -> http.update(body);
            case "/writeFunctionOperation/delete" -> http.delete(body);
            case "/writeFunctionOperation/query" -> JSONObject.from(http.query(body));
            default -> throw new IllegalArgumentException("Unexpected test endpoint");
          };
        } catch (Exception error) { result = JSONObject.of("success", false, "message", error.getMessage()); }
        finally { RequestContextHolder.resetRequestAttributes(); }
        byte[] bytes = result.toJSONString().getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(200, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
      });
      server.start();
      Files.copy(Path.of("../../data-engine-core/src/main/resources/python/query_runtime.py"), work.resolve("query_runtime.py"));
      Files.writeString(work.resolve("parameters.json"), "{\"id\":\"contract-person-1\",\"age\":99}");
      String endpoint = "http://127.0.0.1:" + server.getAddress().getPort();
      python(endpoint, "from query_runtime import insert\ninsert('contract_person', " + JSON.parseObject(fixture("sample.json")).getJSONArray("objDatas").getJSONObject(0).getJSONArray("rows").toJSONString() + ")");
      python(endpoint, "from query_runtime import query\nrows=query({'answer':{'steps':[{'graph':{'patterns':[{'objects':[{'idx':0,'variable':'p','class':'contract_person'}]}]},'output':{'fields':[{'variable':'p','field':'id','as':'id'}]}}]}})\nassert len(rows)==3, rows");
      for (String operation : List.of("update", "delete")) {
        python(endpoint, "from query_runtime import " + operation + "\ntry:\n    " + operation + "('contract_person', " + (operation.equals("update") ? "{'age':99}, " : "") + fixture("invalid-where.json").strip() + ")\nexcept RuntimeError as e:\n    assert 'where' in str(e), str(e)\nelse:\n    raise AssertionError('invalid where succeeded')");
        assertEquals(3, jdbc.queryForObject("SELECT count(*) FROM contract_person", Integer.class));
        assertEquals(21, jdbc.queryForObject("SELECT age FROM contract_person WHERE id='contract-person-1'", Integer.class));
      }
      python(endpoint, functions.queryById("contract-update-person-function").getCode());
      assertEquals(99, jdbc.queryForObject("SELECT age FROM contract_person WHERE id='contract-person-1'", Integer.class));
      python(endpoint, "from query_runtime import delete\ndelete('contract_person', " + fixture("valid-where.json") + ")");
      assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM contract_person", Integer.class));
      python(endpoint, "from query_runtime import insert\ninsert('contract_person', [" + JSON.parseArray(JSON.parseObject(fixture("sample.json")).getJSONArray("objDatas").getJSONObject(0).getJSONArray("rows").toJSONString()).getJSONObject(0) + "])");
      assertEquals(3, jdbc.queryForObject("SELECT count(*) FROM contract_person", Integer.class));
      assertEquals(21, jdbc.queryForObject("SELECT age FROM contract_person WHERE id='contract-person-1'", Integer.class));
    } finally {
      if (server != null) server.stop(0);
      admin.execute("DROP SCHEMA " + schema + " CASCADE");
    }
  }

  private void python(String endpoint, String code) throws Exception {
    var process = new ProcessBuilder("python3", "-c", code).directory(work.toFile()).redirectErrorStream(true);
    process.environment().put("ONTOMATO_ONTOLOGY_URL", endpoint);
    process.environment().put("ONTOMATO_TK", "test-only");
    var running = process.start();
    String output = new String(running.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    assertEquals(0, running.waitFor(), output);
  }
}
