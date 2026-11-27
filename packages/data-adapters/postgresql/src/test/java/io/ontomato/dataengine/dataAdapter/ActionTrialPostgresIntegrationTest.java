package io.ontomato.dataengine.dataAdapter;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.alibaba.fastjson2.*;
import com.sun.net.httpserver.HttpServer;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.authorization.AuthorizationSubjects;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.RoleResolution;
import io.ontomato.dataengine.service.authorization.CapabilityDefinitions;
import io.ontomato.dataengine.service.authorization.ManagementOperations;
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

/**
 * Real runtime/Python/Java/PostgreSQL proof of the action-trial sandbox: writes land in the
 * sandbox, reads after writes see them there, and the live tables never change. Identity and
 * metadata fixtures are local test inputs. Vector ingestion is excluded because CI has no
 * embedding service.
 */
class ActionTrialPostgresIntegrationTest {
 @Test @Timeout(120)
 void trialWritesReadBackAndNeverTouchLive() throws Exception {
   String database=Objects.requireNonNull(System.getenv("RUNTIME_TEST_DATABASE_URL"));
   URI db=URI.create(database); String[] account=db.getUserInfo().split(":",2);
   String jdbcUrl="jdbc:postgresql://"+db.getHost()+":"+db.getPort()+db.getPath();
   var adminDb=new JdbcTemplate(new DriverManagerDataSource(jdbcUrl,account[0],account[1]));
   String schema="action_trial_"+UUID.randomUUID().toString().replace("-","");
   adminDb.execute("CREATE SCHEMA "+schema);
   Path root=Path.of("../../..").toRealPath(),scratch=Files.createTempDirectory("action-trial-runtime-"),log=scratch.resolve("runtime.log");
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
    // Persisted enterprise connections can include an unset optional field.
    connection.put("company",null);
    config.getDataAdapterConnections().put("postgresql",connection);
    var adapter=new PostgreAdapter(connection,rule);
    var queryConfig=new io.ontomato.dataengine.config.DataRagConfig();queryConfig.setDslMightTimeFormats(new String[0]);
    var registry=new DataAdapterRegistry(List.of(new PostgreAdapterProvider(),new GaussDBAdapterProvider()),queryConfig);
    var vectors=new VectorResourceDao();ReflectionTestUtils.setField(vectors,"jdbcTemplate",jdbc);
    var writes=new WriteFunctionOperationServiceImpl();
    ReflectionTestUtils.setField(writes,"dataRagConfig",queryConfig);
    ReflectionTestUtils.setField(writes,"jsonRuleDao",rules);ReflectionTestUtils.setField(writes,"dataAdapterRegistry",registry);ReflectionTestUtils.setField(writes,"businessConfigService",configs);ReflectionTestUtils.setField(writes,"vectorResourceDao",vectors);
    var grants=new QueryGrantService(jdbc,"fixture-signing",new WorkbenchServiceAuthentication("fixture-service"));grants.initialize();
    var runtimeProxy=mock(RuntimeCodeClient.class);
    var deployment=mock(SandboxDeployment.class);
    when(deployment.tag()).thenReturn("dep001");
    var locks=new java.util.concurrent.locks.ReentrantReadWriteLock();
    when(deployment.operationLock()).thenReturn(locks.readLock());
    when(deployment.scanLock()).thenReturn(locks.writeLock());
    jdbc.execute("CREATE TABLE business_config (id text PRIMARY KEY)");
    jdbc.update("INSERT INTO business_config VALUES ('contract')");
    var sandboxes=spy(new DataSandboxService(jdbc,identity,rules,configs,grants,runtimeProxy,deployment));
    ReflectionTestUtils.setField(sandboxes,"dataAdapterRegistry",registry);
    ReflectionTestUtils.setField(sandboxes,"vectorResourceDao",vectors);
    ReflectionTestUtils.setField(sandboxes,"writes",writes);
    sandboxes.initialize();
    ReflectionTestUtils.setField(grants,"contexts",sandboxes);
    ReflectionTestUtils.setField(writes,"dataSandboxes",sandboxes);
    var admin=mock(AdminService.class);when(admin.getJSONRule("contract")).thenAnswer(call->JSON.parseObject(rule.toJSONString()));
    var ontology=new OntologyQueryService(admin,null,null,null);ReflectionTestUtils.setField(ontology,"writes",writes);ReflectionTestUtils.setField(ontology,"grants",grants);
    var http=new WriteFunctionOperationController();ReflectionTestUtils.setField(http,"jsonRuleDao",rules);ReflectionTestUtils.setField(http,"writeFunctionOperationService",writes);
    ontologyHttp=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
    ontologyHttp.createContext("/",exchange->{
      try {
        var claims=grants.verifyRequest(exchange.getRequestHeaders().getFirst("tk"),exchange.getRequestHeaders().getFirst("X-Ontomato-Run-Id"),exchange.getRequestMethod(),exchange.getRequestURI().getPath());
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

      ReflectionTestUtils.setField(sandboxes,"runtime",new RuntimeCodeClient(new io.ontomato.dataengine.service.agent.AgentRuntimeClient(runtimeUrl,"fixture-host",ontologyUrl)));
      var programs=new ABCProgramServiceImpl();ReflectionTestUtils.setField(programs,"pythonExecuteService",python);ReflectionTestUtils.setField(programs,"ontology",ontology);
      var sample=JSON.parseObject(Files.readString(Path.of("../../data-engine-core/src/test/resources/agent-contracts/sample.json")));
      // The external embedding service is absent: prove the object/relationship subset explicitly.
      sample.put("vectorDatas",new JSONArray());
      adapter.createClass("",rule.getJSONArray("classDef").getJSONObject(0));
      jdbc.execute("INSERT INTO contract_person(id,name,age) VALUES('contract-person-1','real',7)");
      List<String> sampleClasses = sample.getJSONArray("objDatas").toJavaList(JSONObject.class).stream()
          .map(item -> item.getString("className")).distinct().toList();
      long expiresAt = System.currentTimeMillis() + 3_600_000;
      String id = openTrial(sandboxes, sample, sampleClasses, expiresAt);
      var target = sandboxes.requireActionTrial(id, "builder", "contract");
      var vectorTables = sandboxes.resolveTarget(id).vectorTables().values();
      assertTrue(vectorTables.stream().allMatch(name -> name.matches("ot_sb_[a-z0-9]{6}_[a-z0-9]{8}_v[0-9]{2,}")), vectorTables.toString());
      assertTrue(vectorTables.stream().allMatch(name -> name.length() <= 63), "Short internal sandbox names must avoid identifier truncation");
      assertEquals("contract-group-1",jdbc.queryForObject("SELECT group_id FROM "+sandboxes.resolveTarget(id).classTable("contract_person")+" WHERE id='contract-person-1'",String.class));
      var function=JSON.parseArray(Files.readString(Path.of("../../data-engine-core/src/test/resources/agent-contracts/actions.json"))).getJSONObject(0).getJSONObject("function").to(Function.class);function.setDomainId("contract");
      function.getParameters().get(0).setValue("contract-person-1");function.getParameters().get(1).setValue(99);
      var action=JSON.parseArray(Files.readString(Path.of("../../data-engine-core/src/test/resources/agent-contracts/actions.json"))).getJSONObject(0).to(io.ontomato.dataengine.bean.action.Action.class);
      action.setDomainId("contract");action.setFunction(function);
      action.setTarget(new io.ontomato.dataengine.bean.action.ActionTarget("contract_person", "id"));
      var actions=spy(new ActionServiceImpl());doReturn(action).when(actions).queryById(action.getId());
      ReflectionTestUtils.setField(actions,"abcProgramService",programs);
      var actionGrants = mock(io.ontomato.dataengine.service.authorization.ActionAuthorization.class);
      when(actionGrants.requireExecution(any(), any(), any(), any())).thenReturn(CapabilityGrantLookup.Admission.ALL);
      ReflectionTestUtils.setField(actions, "authorization", actionGrants);
      ReflectionTestUtils.setField(actions, "queries", ontology);
      ReflectionTestUtils.setField(actions, "preconditions", new ActionPreconditionService(mock(DslService.class), admin, ontology));
      ReflectionTestUtils.setField(actions, "identitySnapshots", (IdentitySnapshotLookup) (actor, domain) -> JSONObject.of("principalId", actor.getId()));
      ReflectionTestUtils.setField(actions, "workflowRuns", mock(WorkflowRunResolver.class));
      var result=actions.execute(action.getId(),JSONObject.of("id","contract-person-1","age",99),"en",owner,permission,1,target);
      assertNull(result.getError());
      assertEquals(99,jdbc.queryForObject("SELECT age FROM "+sandboxes.resolveTarget(id).classTable("contract_person")+" WHERE id='contract-person-1'",Integer.class));
      assertEquals(22,jdbc.queryForObject("SELECT age FROM "+sandboxes.resolveTarget(id).classTable("contract_person")+" WHERE id='contract-person-2'",Integer.class));
      assertEquals(7,jdbc.queryForObject("SELECT age FROM contract_person WHERE id='contract-person-1'",Integer.class));
      var query=JSON.parseObject("{\"answer\":{\"steps\":[{\"graph\":{\"patterns\":[{\"objects\":[{\"idx\":0,\"variable\":\"p\",\"class\":\"contract_person\"}]}]},\"output\":{\"to_user\":true,\"fields\":[{\"variable\":\"p\",\"field\":\"age\",\"as\":\"age\"}]}}]}}");
      var access=new QueryAccessService.Access(owner,permission,null,null,null).withTarget(target);
      var metrics=spy(new MetricViewServiceImpl());ReflectionTestUtils.setField(metrics,"abcProgramService",programs);ReflectionTestUtils.setField(metrics,"adminService",admin);
      ReflectionTestUtils.setField(metrics, "subjectValues", new SubjectValueResolver(mock(SubjectAttributeLookup.class)));
      var metricSubjects = mock(AuthorizationSubjects.class);
      when(metricSubjects.resolveRoles(owner.getDomainId(), owner.getId())).thenReturn(
          new RoleResolution(Set.of(), Set.of(), List.of(), Set.of(), Map.of(), false, false));
      var metricPolicies = mock(AuthorizationStore.class);
      when(metricPolicies.policies(owner.getDomainId(), Set.of())).thenReturn(List.of());
      var metricAuthorization = new AuthorizationService(metricSubjects, metricPolicies,
          new ManagementOperations(List.of()), mock(CapabilityGrantLookup.class), mock(DataPermissionLookup.class));
      ReflectionTestUtils.setField(metrics, "definitions", new CapabilityDefinitions(metricAuthorization, identity));
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
        metric.setCreatedBy(owner.getId());
        doReturn(metric).when(metrics).queryById("metric-test","contract");
        var values=QueryPackage.parameters(readPackage,null);
        assertNotNull(metrics.testExecute(metric,null,values,"en",owner,permission,1,target)[0]);
        assertNotNull(metrics.execute("metric-test",null,values,null,"en",owner,permission,1,target)[0]);
      }
      function.getReturnDef().setClassNames(List.of("contract_person","contract_group"));
      function.setCode("# ontomato-python:2\nfrom query_runtime import deleteEdge, createEdge\ndeleteEdge('person_group','contract_person','contract-person-1','contract_group','contract-group-1')\ncreateEdge('person_group','contract_person','contract-person-1','contract_group','contract-group-1')\n");
      result=actions.execute(action.getId(),JSONObject.of("id","contract-person-1","age",99),"en",owner,permission,1,target);assertNull(result.getError());
      assertEquals("contract-group-1",jdbc.queryForObject("SELECT group_id FROM "+sandboxes.resolveTarget(id).classTable("contract_person")+" WHERE id='contract-person-1'",String.class));
      function.setCode("# ontomato-python:2\nfrom query_runtime import delete\ndelete('contract_person',{'field':'id','operator':'=','value':'contract-person-1'})\n");
      result=actions.execute(action.getId(),JSONObject.of("id","contract-person-1","age",99),"en",owner,permission,1,target);assertNull(result.getError());
      assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM "+sandboxes.resolveTarget(id).classTable("contract_person")+"",Integer.class));
      var afterDelete=(JSONArray)metrics.execute("metric-test",null,JSONObject.of("threshold",20),null,"en",owner,permission,1,target)[0];
      assertEquals(45,afterDelete.getJSONObject(0).getIntValue("total"));
      assertEquals(7,jdbc.queryForObject("SELECT age FROM contract_person WHERE id='contract-person-1'",Integer.class));
      exerciseTrialLifecycle(sandboxes, config, jdbc, schema, sample, sampleClasses, id, target, grants, permission, programs, function);
      sandboxes.close(id, "contract");
      assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM information_schema.tables WHERE table_schema=? AND table_name LIKE ?",Integer.class,schema,sandboxes.resolveTarget(id).namespace()+"%"));
      String second = openTrial(sandboxes, sample, sampleClasses, expiresAt);
      var restored = sandboxes.requireActionTrial(second, "builder", "contract");
      assertEquals(21,jdbc.queryForObject("SELECT age FROM "+sandboxes.resolveTarget(second).classTable("contract_person")+" WHERE id='contract-person-1'",Integer.class));
      assertEquals(3,jdbc.queryForObject("SELECT count(*) FROM "+sandboxes.resolveTarget(second).classTable("contract_person")+"",Integer.class));
      assertEquals("contract-group-1",jdbc.queryForObject("SELECT group_id FROM "+sandboxes.resolveTarget(second).classTable("contract_person")+" WHERE id='contract-person-1'",String.class));
      sandboxes.close(second, "contract");
      assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM information_schema.tables WHERE table_schema=? AND table_name LIKE ?",Integer.class,schema,sandboxes.resolveTarget(restored.sandboxId()).namespace()+"%"));
      assertEquals(7,jdbc.queryForObject("SELECT age FROM contract_person WHERE id='contract-person-1'",Integer.class));
   } finally {
    if(ontologyHttp!=null)ontologyHttp.stop(0);
    if(runtimeProcess!=null){runtimeProcess.destroy();runtimeProcess.waitFor(5,java.util.concurrent.TimeUnit.SECONDS);if(runtimeProcess.isAlive())runtimeProcess.destroyForcibly();}
    adminDb.execute("DROP SCHEMA "+schema+" CASCADE");adminDb.execute("DROP SCHEMA IF EXISTS "+schema+"_runtime CASCADE");
   }
 }

 /** Opens and prepares a sandbox exactly the way ActionTrialService does for a trial run. */
 private static String openTrial(DataSandboxService sandboxes, JSONObject sample, List<String> sampleClasses, long expiresAt) {
   String id = sandboxes.open("contract", "builder", "action-trial:" + UUID.randomUUID(), expiresAt, sampleClasses);
   if (!sampleClasses.isEmpty()) {
     sandboxes.replaceClasses(id, sampleClasses, sample, "contract");
     sandboxes.reset(id, "contract");
   }
   return id;
 }

 private void exerciseTrialLifecycle(DataSandboxService sandboxes, BusinessConfig config,
     JdbcTemplate jdbc, String schema, JSONObject sample, List<String> sampleClasses, String id, ExecutionTarget target,
     QueryGrantService grants, UserDataPermission permission, ABCProgramServiceImpl programs, Function function) throws Exception {
   expectCode("SANDBOX_NOT_FOUND", () -> sandboxes.requireActionTrial(UUID.randomUUID().toString(), "builder", "contract"));
   expectCode("SANDBOX_FORBIDDEN", () -> sandboxes.requireActionTrial(id, "other", "contract"));
   expectCode("SANDBOX_FORBIDDEN", () -> sandboxes.requireActionTrial(id, "builder", "other-domain"));
   jdbc.update("UPDATE data_sandboxes SET state='PREPARING' WHERE id=?", id);
   expectCode("SANDBOX_NOT_READY", () -> sandboxes.requireActionTrial(id, "builder", "contract"));
   jdbc.update("UPDATE data_sandboxes SET state='READY' WHERE id=?", id);
   int grantsBefore = jdbc.queryForObject("SELECT count(*) FROM query_runtime_grants WHERE context_id=?", Integer.class, id);
   var invalid=JSON.parseObject(JSON.toJSONString(function),Function.class);
   invalid.getReturnDef().setClassNames(List.of("outside"));
   expectCode("SANDBOX_FORBIDDEN",()->programs.execute(UUID.randomUUID().toString(),invalid,"builder",permission,target.sandboxId(),"en",1,"contract",new ABCProgramService.ExecutionContext(null, null, target)));
   expectCode("SANDBOX_FORBIDDEN",()->grants.issueExecution(PythonAuthority.read("builder","contract").withTarget(target).withClasses(List.of("outside")),UUID.randomUUID().toString(),target.expiresAt()));
   assertEquals(grantsBefore,jdbc.queryForObject("SELECT count(*) FROM query_runtime_grants WHERE context_id=?",Integer.class,id));
   String grantRun=UUID.randomUUID().toString();
   String token=grants.issueExecution(PythonAuthority.read("builder","contract").withTarget(target),grantRun,target.expiresAt());
   var claims=JSON.parseObject(Base64.getUrlDecoder().decode(token.split("\\.")[1]));
   claims.put("classNames",new JSONArray());String emptyScope=signedClaims(claims);
   expectCode("This grant cannot call this operation",()->grants.verifyRequest(emptyScope, grantRun, "POST", "/ontology/query/execute-dsl"));
   claims.remove("contextId");String noContext=signedClaims(claims);
   expectCode("Invalid, expired or revoked query grant",()->grants.verifyRequest(noContext, grantRun, "POST", "/ontology/query/execute-dsl"));
   jdbc.update("UPDATE data_sandboxes SET expires_at=0 WHERE id=?",id);
   expectCode("SANDBOX_EXPIRED",()->sandboxes.requireActionTrial(id,"builder","contract"));
   expectCode("SANDBOX_EXPIRED",()->grants.verifyRequest(token, grantRun, "POST", "/ontology/query/execute-dsl"));
   // This protocol-only credential never started a runtime execution; remove its fixture row.
   jdbc.update("DELETE FROM query_runtime_grants WHERE run_id=? AND context_id=?",grantRun,id);
   jdbc.update("UPDATE data_sandboxes SET expires_at=?",System.currentTimeMillis()+3_600_000,id);
   System.out.println("ACTION_TRIAL_LIFECYCLE_PASS missing/forbidden-owner/forbidden-domain/not-ready/empty-scope/outside-scope/expired; rejected executions issued no grants; protocol-only grant fixture removed");
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
}
