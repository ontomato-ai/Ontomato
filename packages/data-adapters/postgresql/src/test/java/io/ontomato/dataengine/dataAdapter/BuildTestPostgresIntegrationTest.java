package io.ontomato.dataengine.dataAdapter;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.alibaba.fastjson2.*;
import com.sun.net.httpserver.HttpServer;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.service.impl.*;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dao.*;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.controller.WriteFunctionOperationController;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.*;

/** Real runtime/Python/Java/PostgreSQL proof. Identity and metadata fixtures are local test inputs.
 * Vector ingestion is excluded here because CI has no embedding service.
 */
class BuildTestPostgresIntegrationTest {
 @Test @Timeout(120)
 void rebuildAndExecuteOnOneTestTarget() throws Exception {
   String database=Objects.requireNonNull(System.getenv("RUNTIME_TEST_DATABASE_URL"));
   URI db=URI.create(database); String[] account=db.getUserInfo().split(":",2);
   String jdbcUrl="jdbc:postgresql://"+db.getHost()+":"+db.getPort()+db.getPath();
   var adminDb=new JdbcTemplate(new DriverManagerDataSource(jdbcUrl,account[0],account[1]));
   String schema="build_test_"+UUID.randomUUID().toString().replace("-","");
   adminDb.execute("CREATE SCHEMA "+schema);
   Path root=Path.of("../../..").toRealPath(),scratch=Files.createTempDirectory("build-test-runtime-"),log=scratch.resolve("runtime.log");
   Process runtimeProcess=null;HttpServer ontologyHttp=null;
   try {
    var jdbc=new JdbcTemplate(new DriverManagerDataSource(jdbcUrl+"?currentSchema="+schema+",public",account[0],account[1]));
    jdbc.execute("CREATE EXTENSION IF NOT EXISTS vector");
    var permission=new UserDataPermission();permission.setFullData(true);
    var owner=new QueryAccessService.GrantUser("builder","contract");
    var identity=mock(IdentityService.class);
    when(identity.getCurrentCredentialExpiresAt()).thenReturn(null);
    when(identity.getCurrentUser()).thenReturn(owner);when(identity.getCurrentUserDataPermission()).thenReturn(permission);
    var config=new BusinessConfig();config.setDataAdapter("postgresql");
    var configs=mock(BusinessConfigService.class);when(configs.get("contract")).thenReturn(config);
    var rule=JSON.parseObject(Files.readString(Path.of("../../data-engine-core/src/test/resources/agent-contracts/ontology.json")));
    var rules=mock(JSONRuleDao.class);when(rules.query("contract")).thenAnswer(call->JSON.parseObject(rule.toJSONString()));
    var connection=new DataAdapterConnection();connection.put("url",jdbcUrl+"?currentSchema="+schema+",public");connection.put("user",account[0]);connection.put("password",account[1]);
    config.getDataAdapterConnections().put("postgresql",connection);
    var adapter=new PostgreAdapter(connection,rule);
    var queryConfig=new io.ontomato.dataengine.config.DataRagConfig();queryConfig.setDslMightTimeFormats(new String[0]);
    var registry=new DataAdapterRegistry(List.of(new PostgreAdapterProvider()),queryConfig);
    var vectors=new VectorResourceDao();ReflectionTestUtils.setField(vectors,"jdbcTemplate",jdbc);
    var writes=new WriteFunctionOperationServiceImpl();
    ReflectionTestUtils.setField(writes,"dataRagConfig",queryConfig);
    ReflectionTestUtils.setField(writes,"jsonRuleDao",rules);ReflectionTestUtils.setField(writes,"dataAdapterRegistry",registry);ReflectionTestUtils.setField(writes,"businessConfigService",configs);ReflectionTestUtils.setField(writes,"vectorResourceDao",vectors);
    var sandbox=new SandboxServiceImpl();
    ReflectionTestUtils.setField(sandbox,"jsonRuleDao",rules);ReflectionTestUtils.setField(sandbox,"dataAdapterRegistry",registry);ReflectionTestUtils.setField(sandbox,"businessConfigService",configs);ReflectionTestUtils.setField(sandbox,"vectorResourceDao",vectors);ReflectionTestUtils.setField(sandbox,"writes",writes);
    var grants=new QueryGrantService(jdbc,"fixture-signing",new WorkbenchServiceAuthentication("fixture-service"));grants.initialize();
    var runtimeProxy=mock(RuntimeCodeClient.class);
    var contexts=new BuildTestContextService(jdbc,identity,sandbox,rules,configs,grants,runtimeProxy);contexts.initialize();ReflectionTestUtils.setField(grants,"contexts",contexts);
    var admin=mock(AdminService.class);when(admin.getJSONRule("contract")).thenAnswer(call->JSON.parseObject(rule.toJSONString()));
    var ontology=new OntologyQueryService(admin,null,null,null);ReflectionTestUtils.setField(ontology,"writes",writes);ReflectionTestUtils.setField(ontology,"grants",grants);
    var http=new WriteFunctionOperationController();ReflectionTestUtils.setField(http,"jsonRuleDao",rules);ReflectionTestUtils.setField(http,"writeFunctionOperationService",writes);
    ontologyHttp=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
    ontologyHttp.createContext("/",exchange->{
      try {
        var claims=grants.verify(exchange.getRequestHeaders().getFirst("tk"),exchange.getRequestHeaders().getFirst("X-Ontomato-Run-Id"),exchange.getRequestURI().getPath());
        var request=new MockHttpServletRequest();request.setAttribute(QueryGrantService.ATTRIBUTE,claims);RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        var body=JSON.parseObject(exchange.getRequestBody().readAllBytes());
        Object result=switch(exchange.getRequestURI().getPath()) {
          case "/writeFunctionOperation/update"->http.update(body);
          case "/writeFunctionOperation/delete"->http.delete(body);
          case "/writeFunctionOperation/createEdge"->http.createEdge(body);
          case "/writeFunctionOperation/deleteEdge"->http.deleteEdge(body);
          case "/ontology/query/execute-dsl"->body.containsKey("queryRef") ? ontology.executePackage(body.getJSONObject("queryRef"),new QueryAccessService.Access(owner,permission,claims,exchange.getRequestHeaders().getFirst("tk"),claims.getLong("expiresAt"))) : ontology.execute(body.getJSONObject("dsl"),new QueryAccessService.Access(owner,permission,claims,exchange.getRequestHeaders().getFirst("tk"),claims.getLong("expiresAt")));
          default->throw new IllegalArgumentException("Unexpected endpoint");
        };
        byte[] bytes=JSON.toJSONBytes(result);exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);
      } catch(Exception failure) {byte[] bytes=JSON.toJSONBytes(JSONObject.of("error",failure.toString()));exchange.sendResponseHeaders(422,bytes.length);exchange.getResponseBody().write(bytes);}
      finally{RequestContextHolder.resetRequestAttributes();exchange.close();}
    });ontologyHttp.start();
    String ontologyUrl="http://127.0.0.1:"+ontologyHttp.getAddress().getPort();
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
      env.put("ONTOMATO_MODEL_RUNTIME_TOKEN", "fixture-runtime-token");
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
              new RuntimeCodeClient(
                  new io.ontomato.dataengine.service.agent.AgentRuntimeClient(
                      runtimeUrl, "fixture-host", ontologyUrl)),
              grants);

      ReflectionTestUtils.setField(contexts,"runtime",new RuntimeCodeClient(new io.ontomato.dataengine.service.agent.AgentRuntimeClient(runtimeUrl,"fixture-host",ontologyUrl)));
      var programs=new ABCProgramServiceImpl();ReflectionTestUtils.setField(programs,"pythonExecuteService",python);ReflectionTestUtils.setField(programs,"ontology",ontology);
      var sample=JSON.parseObject(Files.readString(Path.of("../../data-engine-core/src/test/resources/agent-contracts/sample.json")));
      // The external embedding service is absent: prove the object/relationship subset explicitly.
      sample.put("vectorDatas",new JSONArray());
      adapter.createClass("",rule.getJSONArray("classDef").getJSONObject(0));
      jdbc.execute("INSERT INTO contract_person(id,name,age) VALUES('contract-person-1','real',7)");
      var created=contexts.create("workspace",sample,Map.of());
      String id=created.getString("contextId");
      var boundary=new MockHttpServletRequest();boundary.addHeader(BuildTestContextService.HEADER,JSONObject.of("kind","build-test","contextId",id).toJSONString());
      var target=contexts.resolve(boundary);
      var vector=created.getJSONArray("resources").toJavaList(JSONObject.class).stream().filter(resource->"vector".equals(resource.getString("kind"))).findFirst().orElseThrow();
      assertNotEquals(vector.getString("logicalName"),vector.getString("name"),"The fixture must exercise server-truncated names");
      assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM information_schema.tables WHERE table_schema=? AND table_name=?",Integer.class,vector.getString("schema"),vector.getString("name")));
      Path vectorDirectory=Path.of(vector.getString("directory"));
      // Exercise file deletion without claiming vector ingestion through an absent embedding service.
      Files.copy(Path.of("../../data-engine-core/src/test/resources/agent-contracts/files/example-1.txt"),vectorDirectory.resolve("cleanup-fixture.txt"));
      assertEquals("contract-group-1",jdbc.queryForObject("SELECT group_id FROM "+target.sandboxId()+"contract_person WHERE id='contract-person-1'",String.class));
      var function=JSON.parseArray(Files.readString(Path.of("../../data-engine-core/src/test/resources/agent-contracts/actions.json"))).getJSONObject(0).getJSONObject("function").to(Function.class);function.setDomainId("contract");
      function.getParameters().get(0).setValue("contract-person-1");function.getParameters().get(1).setValue(99);
      var action=JSON.parseArray(Files.readString(Path.of("../../data-engine-core/src/test/resources/agent-contracts/actions.json"))).getJSONObject(0).to(io.ontomato.dataengine.bean.action.Action.class);
      action.setDomainId("contract");action.setFunction(function);
      var actions=spy(new ActionServiceImpl());doReturn(action).when(actions).queryById(action.getId());
      ReflectionTestUtils.setField(actions,"identity",identity);ReflectionTestUtils.setField(actions,"abcProgramService",programs);
      var result=actions.execute(action.getId(),JSONObject.of("id","contract-person-1","age",99),"en",owner,permission,1,target);
      assertNull(result.getError());
      assertEquals(99,jdbc.queryForObject("SELECT age FROM "+target.sandboxId()+"contract_person WHERE id='contract-person-1'",Integer.class));
      assertEquals(22,jdbc.queryForObject("SELECT age FROM "+target.sandboxId()+"contract_person WHERE id='contract-person-2'",Integer.class));
      assertEquals(7,jdbc.queryForObject("SELECT age FROM contract_person WHERE id='contract-person-1'",Integer.class));
      var query=JSON.parseObject("{\"answer\":{\"steps\":[{\"graph\":{\"patterns\":[{\"objects\":[{\"idx\":0,\"variable\":\"p\",\"class\":\"contract_person\"}]}]},\"output\":{\"to_user\":true,\"fields\":[{\"variable\":\"p\",\"field\":\"age\",\"as\":\"age\"}]}}]}}");
      var access=new QueryAccessService.Access(owner,permission,null,null,null).withTarget(target);
      var metrics=spy(new MetricViewServiceImpl());ReflectionTestUtils.setField(metrics,"abcProgramService",programs);ReflectionTestUtils.setField(metrics,"adminService",admin);
      var dsl=QueryPackage.fromDsl(query.toJSONString());
      var read=QueryPackageExecution.execute(UUID.randomUUID().toString(),dsl,new JSONObject(),JSONObject.of("age","Age"),access,"en",1,ontology,python);
      assertTrue(read.rows().stream().anyMatch(value->JSONObject.from(value).getIntValue("age")==99));
      var pkg=JSON.parseObject(Files.readString(root.resolve("packages/contracts/examples/query-packages.json"))).getJSONObject("pythonAggregate");
      pkg.getJSONArray("files").getJSONObject(0).put("content",query.toJSONString());
      pkg.getJSONObject("manifest").put("parameterBindings",new JSONArray());
      pkg.getJSONObject("manifest").getJSONObject("computation").getJSONArray("operations").getJSONObject(0).put("expression","SUM(employees.age)");
      pkg.getJSONObject("manifest").getJSONObject("computation").getJSONArray("operations").getJSONObject(0).getJSONArray("inputs").getJSONObject(0).put("key","age");
      pkg.getJSONArray("files").getJSONObject(1).put("content","# ontomato-python:2\nimport json\nfrom query_runtime import execute_dsl_file\nrows=execute_dsl_file('queries/employees.json')\nprint(json.dumps({'answer':[{'total':sum(row['age'] for row in rows)}]}))\n");
      read=QueryPackageExecution.execute(UUID.randomUUID().toString(),pkg,JSONObject.of("threshold",20),JSONObject.of("total","Total"),access,"en",1,ontology,python);
      assertEquals(144,read.rows().getJSONObject(0).getIntValue("total"));
      for(var readPackage:List.of(dsl,pkg)) {
        var readFunction=new Function();readFunction.setDomainId("contract");readFunction.setOperation(Function.OPERATION_READ);readFunction.setQueryPackage(readPackage);
        readFunction.setParameters(QueryPackage.definitions(readPackage));
        var returns=new io.ontomato.dataengine.bean.function.ReturnDef();returns.setColumnLabels(readPackage==dsl?JSONObject.of("age","Age"):JSONObject.of("total","Total"));readFunction.setReturnDef(returns);
        var metric=new io.ontomato.dataengine.bean.metricView.MetricView();metric.setId("metric-test");metric.setDomainId("contract");metric.setStatus(io.ontomato.dataengine.bean.metricView.MetricView.STATUS_PUBLISHED);metric.setFunction(readFunction);metric.setBindings(new ArrayList<>());
        doReturn(metric).when(metrics).queryById("metric-test","contract");
        var values=QueryPackage.parameters(readPackage,null);
        assertNotNull(metrics.testExecute(metric,null,values,"en",owner,permission,1,target)[0]);
        assertNotNull(metrics.execute("metric-test",null,values,null,"en",owner,permission,1,target)[0]);
      }
      function.getReturnDef().setClassNames(List.of("contract_person","contract_group"));
      function.setCode("# ontomato-python:2\nfrom query_runtime import deleteEdge, createEdge\ndeleteEdge('person_group','contract_person','contract-person-1','contract_group','contract-group-1')\ncreateEdge('person_group','contract_person','contract-person-1','contract_group','contract-group-1')\n");
      result=actions.execute(action.getId(),JSONObject.of("id","contract-person-1","age",99),"en",owner,permission,1,target);assertNull(result.getError());
      assertEquals("contract-group-1",jdbc.queryForObject("SELECT group_id FROM "+target.sandboxId()+"contract_person WHERE id='contract-person-1'",String.class));
      function.setCode("# ontomato-python:2\nfrom query_runtime import delete\ndelete('contract_person',{'field':'id','operator':'=','value':'contract-person-1'})\n");
      result=actions.execute(action.getId(),JSONObject.of("id","contract-person-1","age",99),"en",owner,permission,1,target);assertNull(result.getError());
      assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM "+target.sandboxId()+"contract_person",Integer.class));
      var afterDelete=(JSONArray)metrics.execute("metric-test",null,JSONObject.of("threshold",20),null,"en",owner,permission,1,target)[0];
      assertEquals(45,afterDelete.getJSONObject(0).getIntValue("total"));
      assertEquals(7,jdbc.queryForObject("SELECT age FROM contract_person WHERE id='contract-person-1'",Integer.class));
      contexts.close(id);assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM information_schema.tables WHERE table_schema=? AND table_name LIKE ?",Integer.class,schema,"%"+target.sandboxId()+"%"));
      assertFalse(Files.exists(vectorDirectory),"Delete the recorded directory, not the truncated table-name directory");
      assertTrue(contexts.status(id).getJSONArray("resources").toJavaList(JSONObject.class).stream().allMatch(resource->"DELETED".equals(resource.getString("cleanupStatus"))));
      var next=contexts.create("workspace",sample,Map.of());var restored=contexts.require(next.getString("contextId"),"builder","contract");
      assertEquals(21,jdbc.queryForObject("SELECT age FROM "+restored.sandboxId()+"contract_person WHERE id='contract-person-1'",Integer.class));
      assertEquals(3,jdbc.queryForObject("SELECT count(*) FROM "+restored.sandboxId()+"contract_person",Integer.class));
      assertEquals("contract-group-1",jdbc.queryForObject("SELECT group_id FROM "+restored.sandboxId()+"contract_person WHERE id='contract-person-1'",String.class));
      contexts.close(next.getString("contextId"));
      assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM information_schema.tables WHERE table_schema=? AND table_name LIKE ?",Integer.class,schema,"%"+restored.sandboxId()+"%"));
      rule.getJSONArray("classDef").getJSONObject(0).getJSONArray("attrs").add(JSONObject.of("name","attachment_extra","type","vector"));
      var collision=assertThrows(org.springframework.web.server.ResponseStatusException.class,()->contexts.create("collision",sample,Map.of()));
      assertTrue(collision.getReason().startsWith("BUILD_TEST_SCHEMA_FAILED"),collision.getReason());
      assertTrue(collision.getReason().contains("attachment-contract") && collision.getReason().contains("attachment_extra-contract"),collision.getReason());
      String collisionSandbox=jdbc.queryForObject("SELECT data->>'sandboxId' FROM build_test_contexts WHERE workspace_id='collision'",String.class);
      assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM information_schema.tables WHERE table_schema=? AND table_name LIKE ?",Integer.class,schema,"%"+collisionSandbox+"%"));
   } finally {
    if(ontologyHttp!=null)ontologyHttp.stop(0);
    if(runtimeProcess!=null){runtimeProcess.destroy();runtimeProcess.waitFor(5,java.util.concurrent.TimeUnit.SECONDS);if(runtimeProcess.isAlive())runtimeProcess.destroyForcibly();}
    adminDb.execute("DROP SCHEMA "+schema+" CASCADE");adminDb.execute("DROP SCHEMA IF EXISTS "+schema+"_runtime CASCADE");
   }
 }
}
