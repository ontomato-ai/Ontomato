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
    var registry=new DataAdapterRegistry(List.of(new PostgreAdapterProvider(),new GaussDBAdapterProvider()),queryConfig);
    var vectors=new VectorResourceDao();ReflectionTestUtils.setField(vectors,"jdbcTemplate",jdbc);
    var writes=new WriteFunctionOperationServiceImpl();
    ReflectionTestUtils.setField(writes,"dataRagConfig",queryConfig);
    ReflectionTestUtils.setField(writes,"jsonRuleDao",rules);ReflectionTestUtils.setField(writes,"dataAdapterRegistry",registry);ReflectionTestUtils.setField(writes,"businessConfigService",configs);ReflectionTestUtils.setField(writes,"vectorResourceDao",vectors);
    var sandbox=spy(new SandboxServiceImpl());
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
      exerciseWorkspaceConcurrency(contexts,sandbox,sample);
      exerciseFailures(contexts,sandbox,config,connection,jdbc,adminDb,schema,vectors,sample,identity,grants,programs,function,permission,writes);
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
 private void exerciseWorkspaceConcurrency(BuildTestContextService contexts,SandboxServiceImpl sandbox,JSONObject sample) throws Exception {
   var entered=new java.util.concurrent.CountDownLatch(1);var release=new java.util.concurrent.CountDownLatch(1);
   var first=new java.util.concurrent.atomic.AtomicBoolean(true);
   doAnswer(call->{
     if(first.compareAndSet(true,false)) { entered.countDown();assertTrue(release.await(20,java.util.concurrent.TimeUnit.SECONDS)); }
     return call.callRealMethod();
   }).when(sandbox).createSampleStructure(anyString(),any(),anyString(),any());
   try(var executor=java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
     try {
       var a=executor.submit(()->contexts.create("serial-workspace",sample,Map.of()));
       assertTrue(entered.await(10,java.util.concurrent.TimeUnit.SECONDS));
       var sameStarted=new java.util.concurrent.CountDownLatch(1);
       var same=executor.submit(()->{sameStarted.countDown();return contexts.create("serial-workspace",sample,Map.of());});
       assertTrue(sameStarted.await(10,java.util.concurrent.TimeUnit.SECONDS));
       var other=executor.submit(()->contexts.create("independent-workspace",sample,Map.of()));
       var b=other.get(10,java.util.concurrent.TimeUnit.SECONDS);assertEquals("READY",b.getString("status"));
       assertFalse(same.isDone(),"The same workspace must wait while another workspace proceeds");
       release.countDown();var original=a.get(10,java.util.concurrent.TimeUnit.SECONDS);var replacement=same.get(10,java.util.concurrent.TimeUnit.SECONDS);
       assertNotEquals(original.getString("contextId"),replacement.getString("contextId"));
       assertEquals("CLOSED",contexts.status(original.getString("contextId")).getString("status"));
       contexts.close(replacement.getString("contextId"));contexts.close(b.getString("contextId"));
       System.out.println("BUILD_TEST_CONCURRENCY_PASS independent workspace proceeds; same workspace serializes and replaces the old context");
     } finally { release.countDown(); }
   } finally { doCallRealMethod().when(sandbox).createSampleStructure(anyString(),any(),anyString(),any()); }
 }
 private static String signedClaims(JSONObject claims) throws Exception {
   String encoded=Base64.getUrlEncoder().withoutPadding().encodeToString(JSON.toJSONBytes(claims));
   var mac=javax.crypto.Mac.getInstance("HmacSHA256");mac.init(new javax.crypto.spec.SecretKeySpec("fixture-signing".getBytes(java.nio.charset.StandardCharsets.UTF_8),"HmacSHA256"));
   return "oq."+encoded+"."+Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(encoded.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
 }
 private static void expectCode(String code,org.junit.jupiter.api.function.Executable action) {
   var failure=assertThrows(org.springframework.web.server.ResponseStatusException.class,action);
   assertTrue(failure.getReason().contains(code),failure.toString());
 }
 private static long cleanups(SandboxService sandbox) {
   return mockingDetails(sandbox).getInvocations().stream().filter(call->call.getMethod().getName().equals("dropSampleStructure")).count();
 }
 private void exerciseFailures(BuildTestContextService contexts,SandboxServiceImpl sandbox,BusinessConfig config,
     DataAdapterConnection connection,JdbcTemplate jdbc,JdbcTemplate admin,String schema,VectorResourceDao vectors,
     JSONObject sample,IdentityService identity,QueryGrantService grants,ABCProgramServiceImpl programs,Function function,
     UserDataPermission permission,WriteFunctionOperationService writes) throws Exception {
   var mvc=org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(new io.ontomato.dataengine.controller.BuildTestController(contexts)).build();
   mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/ontology/build-tests/current").param("workspaceId","not-started"))
       .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
       .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.content().string("null"));
   var http=mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart("/ontology/build-tests")
       .file(new org.springframework.mock.web.MockMultipartFile("sample","sample.json","application/json",JSON.toJSONBytes(sample)))
       .param("workspaceId","multipart").param("sampleName","test-data/selected.json"))
       .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk()).andReturn();
   var received=JSON.parseObject(http.getResponse().getContentAsString());
   assertEquals("test-data/selected.json",received.getJSONObject("sampleSummary").getString("name"));contexts.close(received.getString("contextId"));
   var access=new QueryAccessService(identity,mock(DataPermissionLookup.class),grants);ReflectionTestUtils.setField(access,"contexts",contexts);
   var queryMvc=org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(new io.ontomato.dataengine.controller.OntologyQueryController(access,(OntologyQueryService)ReflectionTestUtils.getField(programs,"ontology"),null,null)).build();
   queryMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/ontology/query/execute-dsl")
       .contentType("application/json").content("{\"dsl\":{}}")
       .header(BuildTestContextService.HEADER,"{\"kind\":\"build-test\",\"contextId\":null}"))
       .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isBadRequest())
       .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.code").value("BUILD_TEST_CONTEXT_REQUIRED"));
   var missing=new MockHttpServletRequest();missing.addHeader(BuildTestContextService.HEADER,"{\"kind\":\"build-test\",\"contextId\":null}");
   expectCode("BUILD_TEST_CONTEXT_REQUIRED",()->contexts.resolve(missing));
   expectCode("BUILD_TEST_CONTEXT_NOT_FOUND",()->contexts.require(UUID.randomUUID().toString(),"builder","contract"));
   ReflectionTestUtils.setField(contexts,"ttlMinutes",2L);
   long before=System.currentTimeMillis();var configured=contexts.create("configured-ttl",sample,Map.of());long after=System.currentTimeMillis();
   assertTrue(configured.getLongValue("expiresAt")>=before+120000L && configured.getLongValue("expiresAt")<=after+120000L);
   contexts.close(configured.getString("contextId"));ReflectionTestUtils.setField(contexts,"ttlMinutes",60L);
   var context=contexts.create("failures",sample,Map.of());String id=context.getString("contextId");
   var target=contexts.require(id,"builder","contract");
   queryMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/ontology/query/distinct-values")
       .contentType("application/json").content("{\"className\":\"outside\",\"attribute\":\"id\"}")
       .header(BuildTestContextService.HEADER,JSONObject.of("kind","build-test","contextId",id).toJSONString()))
       .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isForbidden())
       .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.code").value("BUILD_TEST_FORBIDDEN"));

   expectCode("BUILD_TEST_FORBIDDEN",()->contexts.require(id,"other","contract"));
   expectCode("BUILD_TEST_FORBIDDEN",()->contexts.require(id,"builder","other-domain"));
   jdbc.update("UPDATE build_test_contexts SET state='PREPARING' WHERE id=?",id);
   expectCode("BUILD_TEST_CONTEXT_NOT_READY",()->contexts.require(id,"builder","contract"));
   jdbc.update("UPDATE build_test_contexts SET state='READY' WHERE id=?",id);
   var invalid=JSON.parseObject(JSON.toJSONString(function),Function.class);
   int resourceCount=jdbc.queryForObject("SELECT count(*) FROM information_schema.tables WHERE table_schema=? AND table_name LIKE ?",Integer.class,schema,"%"+target.sandboxId()+"%");
   assertTrue(assertThrows(IllegalArgumentException.class,()->writes.appendVector("contract_person","age","contract-person-1","text",null,"txt",target.sandboxId(),"contract")).getMessage().contains("attrName"));
   assertTrue(assertThrows(IllegalArgumentException.class,()->writes.deleteVector("contract_person","age","contract-person-1","file.txt",target.sandboxId(),"contract")).getMessage().contains("attrName"));
   assertEquals(resourceCount,jdbc.queryForObject("SELECT count(*) FROM information_schema.tables WHERE table_schema=? AND table_name LIKE ?",Integer.class,schema,"%"+target.sandboxId()+"%"));
   invalid.getReturnDef().setClassNames(List.of());
   expectCode("BUILD_TEST_FORBIDDEN",()->programs.execute(UUID.randomUUID().toString(),invalid,"builder",permission,target.sandboxId(),"en",1,"contract",null,target));
   invalid.getReturnDef().setClassNames(List.of("outside"));
   expectCode("BUILD_TEST_FORBIDDEN",()->programs.execute(UUID.randomUUID().toString(),invalid,"builder",permission,target.sandboxId(),"en",1,"contract",null,target));
   expectCode("BUILD_TEST_FORBIDDEN",()->grants.issueExecution(PythonAuthority.read("builder","contract").withTarget(target).withClasses(List.of()),UUID.randomUUID().toString(),target.expiresAt()));
   assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM query_runtime_grants WHERE context_id=?",Integer.class,id));
   doThrow(new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.FORBIDDEN,"query permission required"))
       .when(identity).requireQueryAccess();
   expectCode("query permission required",()->contexts.retryCleanup("not-a-record"));
   doNothing().when(identity).requireQueryAccess();
   String grantRun=UUID.randomUUID().toString();
   String token=grants.issueExecution(PythonAuthority.read("builder","contract").withTarget(target),grantRun,target.expiresAt());
   var claims=JSON.parseObject(Base64.getUrlDecoder().decode(token.split("\\.")[1]));
   claims.put("classNames",new JSONArray());String emptyScope=signedClaims(claims);
   expectCode("BUILD_TEST_FORBIDDEN",()->grants.verify(emptyScope,grantRun,"/ontology/query/execute-dsl"));
   claims.remove("contextId");String noContext=signedClaims(claims);
   expectCode("Invalid, expired or revoked query grant",()->grants.verify(noContext,grantRun,"/ontology/query/execute-dsl"));
   jdbc.update("UPDATE build_test_contexts SET expires_at=0 WHERE id=?",id);
   expectCode("BUILD_TEST_CONTEXT_EXPIRED",()->contexts.require(id,"builder","contract"));
   expectCode("BUILD_TEST_CONTEXT_EXPIRED",()->grants.verify(token,grantRun,"/ontology/query/execute-dsl"));
   // This protocol-only credential never started a runtime execution; remove its fixture row.
   jdbc.update("DELETE FROM query_runtime_grants WHERE run_id=? AND context_id=?",grantRun,id);
   contexts.expire();
   assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM information_schema.tables WHERE table_schema=? AND table_name LIKE ?",Integer.class,schema,"%"+target.sandboxId()+"%"));
   expectCode("BUILD_TEST_CONTEXT_EXPIRED",()->contexts.require(id,"builder","contract"));
   var closed=contexts.create("closed",sample,Map.of());contexts.close(closed.getString("contextId"));
   expectCode("BUILD_TEST_CONTEXT_CLOSED",()->contexts.require(closed.getString("contextId"),"builder","contract"));
   config.setDataAdapter("gaussdb");
   expectCode("BUILD_TEST_UNSUPPORTED",()->contexts.create("unsupported",sample,Map.of()));config.setDataAdapter("postgresql");
   assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM build_test_contexts WHERE workspace_id='unsupported'",Integer.class));
   var missingFile=JSON.parseObject(Files.readString(Path.of("../../data-engine-core/src/test/resources/agent-contracts/sample.json")));
   expectCode("BUILD_TEST_SAMPLE_INVALID",()->contexts.create("missing-file",missingFile,Map.of()));
   System.out.println("BUILD_TEST_FAILURE_CASES_PASS missing/not-ready/expired/closed/owner/domain/empty-scope/outside-scope/unsupported/missing-file/auth-before-lookup; rejected Actions issued no grants; protocol-only grant fixture removed; invalid vector attributes created no resources");

   String role="bt_role_"+UUID.randomUUID().toString().replace("-","");
   String originalUser=connection.getString("user"),originalPassword=connection.getString("password");
   admin.execute("CREATE ROLE "+role+" LOGIN PASSWORD 'fixture-only'");
   try {
     admin.execute("GRANT USAGE ON SCHEMA "+schema+" TO "+role);
     connection.put("user",role);connection.put("password","fixture-only");
     expectCode("BUILD_TEST_SCHEMA_FAILED",()->contexts.create("no-create",sample,Map.of()));
     var row=JSON.parseObject(jdbc.queryForObject("SELECT data::text FROM build_test_contexts WHERE workspace_id='no-create'",String.class));
     assertTrue(row.getString("prepareError").contains("permission denied"),row.toJSONString());
     verify(sandbox,times(1)).createSampleStructure(eq(row.getString("sandboxId")),any(),eq("contract"),any());
     long attempts=cleanups(sandbox);contexts.expire();assertEquals(attempts,cleanups(sandbox));
     assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM information_schema.tables WHERE table_schema=? AND table_name LIKE ?",Integer.class,schema,"%"+row.getString("sandboxId")+"%"));
     admin.execute("GRANT CREATE ON SCHEMA "+schema+" TO "+role);
     var cleanup=contexts.create("cleanup-denied",sample,Map.of());String cleanupId=cleanup.getString("contextId");
     var table=cleanup.getJSONArray("resources").toJavaList(JSONObject.class).stream().filter(resource->"table".equals(resource.getString("kind"))).findFirst().orElseThrow();
     admin.execute("ALTER TABLE "+schema+"."+table.getString("name")+" OWNER TO "+originalUser);
     expectCode("BUILD_TEST_CLEANUP_FAILED",()->contexts.close(cleanupId));
     String error=contexts.status(cleanupId).getString("cleanupError");
     assertTrue(error.contains("recorded sandbox table"),error);
     attempts=cleanups(sandbox);contexts.expire();assertEquals(attempts,cleanups(sandbox));
     assertEquals(error,contexts.status(cleanupId).getString("cleanupError"));
     admin.execute("ALTER TABLE "+schema+"."+table.getString("name")+" OWNER TO "+role);
     assertEquals("",contexts.retryCleanup(cleanupId).getString("cleanupError"));
     System.out.println("BUILD_TEST_FAILURE_CASES_PASS no-DDL-permission/cleanup-permission; one preparation, no automatic retry; explicit cleanup succeeds after privilege restoration");
   } finally {
     connection.put("user",originalUser);connection.put("password",originalPassword);
     admin.execute("DROP OWNED BY "+role);admin.execute("DROP ROLE "+role);
   }
   String folder="blocked_"+UUID.randomUUID();Path directory=Path.of("conf",folder);Files.createDirectories(directory);
   Files.setPosixFilePermissions(directory,java.nio.file.attribute.PosixFilePermissions.fromString("r-x------"));
   Object prior=ReflectionTestUtils.getField(vectors,"dirName");ReflectionTestUtils.setField(vectors,"dirName",folder);
   try {
     expectCode("BUILD_TEST_DATA_FAILED",()->contexts.create("directory-denied",sample,Map.of()));
     var row=JSON.parseObject(jdbc.queryForObject("SELECT data::text FROM build_test_contexts WHERE workspace_id='directory-denied'",String.class));
     assertTrue(row.getString("prepareError").contains("vector resource directory"),row.toJSONString());
     String cleanupError=jdbc.queryForObject("SELECT cleanup_error FROM build_test_contexts WHERE workspace_id='directory-denied'",String.class);
     assertTrue(cleanupError.contains("not confirmed"),cleanupError);
     verify(sandbox,times(1)).createSampleStructure(eq(row.getString("sandboxId")),any(),eq("contract"),any());
     long attempts=cleanups(sandbox);contexts.expire();assertEquals(attempts,cleanups(sandbox));
     assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM information_schema.tables WHERE table_schema=? AND table_name LIKE ?",Integer.class,schema,"%"+row.getString("sandboxId")+"%"));
     System.out.println("BUILD_TEST_FAILURE_CASES_PASS directory-unwritable; original preparation error retained, cleanup-unconfirmed retained, two recorded business tables remain; no automatic retry");
   } finally {
     ReflectionTestUtils.setField(vectors,"dirName",prior);
     Files.setPosixFilePermissions(directory,java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"));Files.delete(directory);
   }
   assertEquals(7,jdbc.queryForObject("SELECT age FROM contract_person WHERE id='contract-person-1'",Integer.class));
 }

}
