package io.ontomato.dataengine.schedules;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.service.sys.bean.UserDetail;
import io.ontomato.dataengine.test.PostgresTestDatabase;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.support.TransactionTemplate;

class PlatformScheduleTest extends PostgresTestDatabase {
  private final ObjectMapper json = new ObjectMapper();
  private TaskStore store;
  private TransactionTemplate transactions;
  private final String function = "write-balances";

  @BeforeEach
  void tables() {
    wire(new FunctionDao()).initIndex();
    jdbc.update(
        "INSERT INTO function (id, domain_id, operation, parameters) VALUES(?,?,?,'[]')",
        function,
        "sales",
        Function.OPERATION_WRITE);
    store = new TaskStore(jdbc, json, dataSource);
    store.initialize();
    transactions = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
  }

  @Test
  void functionTargetsListOnlyRunnableFunctionsInTheCurrentDomainWithListPermission()
      throws Exception {
    jdbc.update(
        "UPDATE function SET name='Post balances', description='Nightly posting',"
            + " modify_timestamp=2 WHERE id=?",
        function);
    jdbc.update(
        """
INSERT INTO function (id,domain_id,operation,parameters,query_package,modify_timestamp) VALUES
('other-domain','another',?,'[]',null,1),
('read-only','sales',?,'[]',null,1),
('takes-arguments','sales',?,'[{}]',null,1),
('missing-parameters','sales',?,null,null,1),
('package-with-argument','sales',?,'[]','{"manifest":{"parameterDefs":[{}]}}',1),
('package-without-arguments','sales',?,null,'{"manifest":{"parameterDefs":[]}}',1)
""",
        Function.OPERATION_WRITE,
        Function.OPERATION_READ,
        Function.OPERATION_WRITE,
        Function.OPERATION_WRITE,
        Function.OPERATION_WRITE,
        Function.OPERATION_WRITE);
    var auth = mock(IdentityService.class);
    var user = new UserDetail();
    user.setId("alice");
    user.setDomainId("sales");
    when(auth.getCurrentUser()).thenReturn(user);
    var permissions = mock(ScheduleIdentity.class);
    var target = new FunctionTarget(wire(new FunctionDao()), null, null);
    var tasks =
        new PlatformTasks(
            store, auth, permissions, mock(TaskCredentials.class), target, mock(AgentHost.class));
    var http = MockMvcBuilders.standaloneSetup(new PlatformTaskController(tasks)).build();
    String path = "/platform/scheduled-tasks/function-targets";
    when(permissions.permits(user, ScheduleIdentity.FunctionOperation.SAVE)).thenReturn(true);
    http.perform(get(path)).andExpect(status().isForbidden());
    when(permissions.permits(user, ScheduleIdentity.FunctionOperation.LIST)).thenReturn(true);
    var response = http.perform(get(path)).andExpect(status().isOk()).andReturn().getResponse();
    assertEquals(
        json.readTree(
            """
[{"id":"write-balances","name":"Post balances","description":"Nightly posting"},
 {"id":"package-without-arguments","name":"package-without-arguments","description":null}]
"""),
        json.readTree(response.getContentAsByteArray()));
  }

  private TaskDefinition task(boolean agent) {
    var target =
        agent
            ? json.createObjectNode()
                .put("kind", "agent")
                .put("agentId", UUID.randomUUID().toString())
                .put("prompt", "check invoices")
            : json.createObjectNode().put("kind", "function").put("functionId", function);
    return new TaskDefinition(
        "Invoices",
        null,
        target,
        json.createObjectNode().put("kind", "interval").put("unit", "hour").put("every", 1),
        "Asia/Shanghai",
        null);
  }

  @Test
  void bothDueTargetsUseTheSameAdmissionAndOnlyTheScannerSettlesAnAgent() throws Exception {
    UUID a = UUID.randomUUID(), f = UUID.randomUUID();
    var agent = task(true);
    Instant due = Instant.now().minusSeconds(1);
    store.insert(a, "sales", "alice", agent, "en", due);
    store.insert(f, "sales", null, task(false), "en", due);
    var host = mock(AgentHost.class);
    var started = new AtomicReference<TaskStore.Run>();
    doAnswer(
            call -> {
              started.set(call.getArgument(1));
              return null;
            })
        .when(host)
        .start(any(), any(), eq("alice-key"));
    var functions = mock(FunctionTarget.class);
    var result = new PythonExecuteResult();
    result.setResult("3 updated");
    result.setSpendTime(56L);
    when(functions.timeout("sales")).thenReturn(1);
    when(functions.execute(any(), any(), eq(1))).thenReturn(result);
    var credentials = mock(TaskCredentials.class);
    when(credentials.forOwner("sales", "alice")).thenReturn("alice-key");
    var identity = mock(ScheduleIdentity.class);
    when(identity.hostOwner("alice")).thenReturn("alice");
    when(host.status(any(), any(), eq("alice")))
        .thenReturn(json.createObjectNode().put("status", "running"));
    var scheduler =
        new PlatformScheduler(
            store, transactions, host, functions, credentials, identity, mock(TaskMail.class));
    try {
      scheduler.tick();
      long until = System.nanoTime() + Duration.ofSeconds(5).toNanos();
      while (started.get() == null
          || !store.history(f, null, null, 1).getFirst().status().equals("completed")) {
        assertTrue(System.nanoTime() < until, "both due runs should be dispatched");
        Thread.sleep(20);
      }
      scheduler.tick();
      assertEquals("running", store.run(started.get().id()).status());
      assertEquals("schedule", started.get().trigger());
      assertEquals("3 updated", store.history(f, null, null, 1).getFirst().result());
      verify(functions, times(1)).execute(any(), any(), eq(1));
      when(host.status(any(), any(), eq("alice")))
          .thenReturn(json.createObjectNode().put("status", "completed").put("answer", "Done"));
      scheduler.settle(Instant.now());
      assertEquals("Done", store.run(started.get().id()).result());
      assertEquals(1, store.history(a, null, null, 10).size());
      assertTrue(store.references(function));
    } finally {
      scheduler.stop();
    }
  }

  @Test
  void listCombinesOnlyPermittedDomainTasksAndPrivateAgentTasks() {
    UUID a = UUID.randomUUID(), b = UUID.randomUUID(), f = UUID.randomUUID();
    var agent = task(true);
    store.insert(a, "sales", "alice", agent, "en", null);
    store.insert(b, "sales", "bob", task(true), "en", null);
    store.insert(f, "sales", null, task(false), "en", null);
    store.insert(UUID.randomUUID(), "another", "alice", task(true), "en", null);
    assertEquals(
        List.of(a),
        store.visible("sales", "alice", false, null, null).stream()
            .map(TaskStore.Task::id)
            .toList());
    assertEquals(2, store.visible("sales", "alice", true, null, null).size());
    assertEquals(f, store.visible("sales", "bob", true, "ontology", null).getFirst().id());
    assertEquals(
        a,
        store
            .visible(
                "sales",
                "alice",
                true,
                "agents",
                UUID.fromString(agent.target().get("agentId").asText()))
            .getFirst()
            .id());
    var auth = mock(IdentityService.class);
    var user = new UserDetail();
    user.setId("alice");
    user.setDomainId("sales");
    when(auth.getCurrentUser()).thenReturn(user);
    var permissions = mock(ScheduleIdentity.class);
    var service =
        new PlatformTasks(
            store,
            auth,
            permissions,
            mock(TaskCredentials.class),
            mock(FunctionTarget.class),
            mock(AgentHost.class));
    assertEquals(
        404,
        assertThrows(
                org.springframework.web.server.ResponseStatusException.class,
                () -> service.history(b, null, 20))
            .getStatusCode()
            .value());
    assertEquals(
        403,
        assertThrows(
                org.springframework.web.server.ResponseStatusException.class,
                () -> service.manual(f, UUID.randomUUID()))
            .getStatusCode()
            .value());
    when(permissions.permits(user, ScheduleIdentity.FunctionOperation.RUN)).thenReturn(true);
    UUID key = UUID.randomUUID();
    assertEquals(key, service.manual(f, key).id());
    assertEquals(key, service.manual(f, key).id());
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () -> service.manual(f, UUID.randomUUID()));
  }

  @Test
  void importedWorkbenchKeyResolvesOnlyForItsOriginalOwnerAndLoginRenewsAfterRejection() {
    var sealed = "stc1.BwcHBwcHBwcHBwcH_2uRKjV3Jn-h1oWwwXzofQQ7RyqdBlkVXpyD2l04Dg";
    jdbc.execute(
        "CREATE TABLE scheduled_task_credentials(domain_id text,owner_id text,sealed_key text,state"
            + " text)");
    jdbc.update("INSERT INTO scheduled_task_credentials VALUES('sales','alice',?,'valid')", sealed);
    var migration =
        new ScheduleMigration(
            jdbc,
            store,
            false,
            "UTC",
            "UTC",
            "",
            "old-runtime-test-token",
            "new-runtime-test-token");
    transactions.executeWithoutResult(tx -> migration.copy());
    var identity = mock(ScheduleIdentity.class);
    when(identity.accepts("member-test-key", "sales", "alice")).thenReturn(true, false);
    when(identity.accepts("replacement", "sales", "alice")).thenReturn(true);
    var credentials = new TaskCredentials(store, identity, "new-runtime-test-token");
    assertEquals("member-test-key", credentials.forOwner("sales", "alice"));
    assertThrows(TaskCredentials.Invalid.class, () -> credentials.forOwner("sales", "alice"));
    var task = UUID.randomUUID();
    store.insert(task, "sales", "alice", task(true), "en", null);
    jdbc.update("UPDATE platform_task SET paused_reason='credential_invalid' WHERE id=?", task);
    var user = new UserDetail();
    user.setId("alice");
    user.setDomainId("sales");
    when(identity.interactiveLogin()).thenReturn(true);
    when(identity.issueKey(user)).thenReturn("replacement");
    transactions.executeWithoutResult(tx -> credentials.prepare(user, true));
    assertEquals("replacement", credentials.forOwner("sales", "alice"));
    assertNull(store.get(task, false).pausedReason());
    assertNotNull(store.get(task, false).nextRunAt());
    assertThrows(
        TaskCredentials.Invalid.class, () -> credentials.forOwner("other-domain", "alice"));
  }

  @Test
  void functionDispatchRetainsTheLegacyExecutionIdentity() throws Exception {
    var dao = mock(io.ontomato.dataengine.dao.FunctionDao.class);
    var programs = mock(ABCProgramService.class);
    var asset = new Function();
    asset.setId(function);
    asset.setDomainId("sales");
    asset.setOperation(Function.OPERATION_WRITE);
    asset.setParameters(List.of());
    when(dao.queryById(function)).thenReturn(asset);
    UUID id = UUID.randomUUID();
    store.insert(id, "sales", null, task(false), "en", null);
    var t = store.get(id, false);
    var run = store.admit(t, UUID.randomUUID(), "manual");
    var result = new PythonExecuteResult();
    when(programs.execute(
            eq(id.toString()),
            same(asset),
            isNull(),
            eq(new io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission()),
            eq(io.ontomato.dataengine.config.ServiceConst.NOT_SANDBOX),
            eq("en"),
            eq(60),
            eq("sales")))
        .thenReturn(new Object[] {null, result});
    assertSame(result, new FunctionTarget(dao, programs, null).execute(t, run, 60));
  }

  @Test
  void endOfMonthAndIntervalSlotsRetainLocalTimeAndCadence() {
    var target = task(true).target();
    var month =
        new TaskDefinition(
            "Month",
            null,
            target,
            json.createObjectNode().put("kind", "monthly").put("day", 31).put("time", "09:00"),
            "Asia/Shanghai",
            null);
    var feb = Instant.parse("2028-02-02T00:00:00Z");
    assertEquals(Instant.parse("2028-02-29T01:00:00Z"), month.next(feb, feb));
    var hour = task(true);
    assertEquals(feb.plusSeconds(4 * 3600), hour.next(feb, feb.plusSeconds(3 * 3600 + 20)));
    var cron =
        new TaskDefinition(
            "Cron",
            null,
            target,
            json.createObjectNode().put("kind", "cron").put("expression", "5 0 9 L * ?"),
            "Asia/Shanghai",
            null);
    assertEquals(Instant.parse("2028-02-29T01:00:05Z"), cron.next(feb, feb));
  }

  @Test
  void offlineImportPreservesBothRuleTypesAndHistoriesWithoutAssigningFunctionOwners() {
    var agent = UUID.randomUUID();
    var fn = UUID.randomUUID();
    var agentId = UUID.randomUUID();
    var session = UUID.randomUUID();
    jdbc.execute(
        "CREATE TABLE scheduled_tasks(id uuid,domain_id text,owner_id text,agent_id uuid,prompt"
            + " text,frequency jsonb,notify_email text,locale text,enabled boolean,paused_reason"
            + " text,next_run_at timestamptz,created_at timestamptz,updated_at timestamptz)");
    jdbc.update(
        "INSERT INTO scheduled_tasks VALUES(?,'sales','alice',?,'weekly"
            + " invoices','{\"kind\":\"weekly\",\"weekday\":1,\"time\":\"09:00\"}',null,'en',true,null,now(),now(),now())",
        agent,
        agentId);
    jdbc.execute(
        "CREATE TABLE scheduled_task_runs(id uuid,task_id uuid,session_id uuid,trigger text,status"
            + " text,error_code text,error_message text,started_at timestamptz,finished_at"
            + " timestamptz)");
    jdbc.update(
        "INSERT INTO scheduled_task_runs"
            + " VALUES(?,?,?,'schedule','completed',null,null,now(),now())",
        UUID.randomUUID(),
        agent,
        session);
    jdbc.execute(
        "CREATE TABLE write_task(id text,domain_id text,service_id text,function_id text,name"
            + " text,description text,status text,cron text,create_timestamp"
            + " bigint,modify_timestamp bigint)");
    jdbc.update(
        "INSERT INTO write_task VALUES(?,'sales','svc',?,'End of month','post ledger','STOPPED','0"
            + " 0 12 L * ?',0,1000)",
        fn.toString(),
        function);
    jdbc.execute(
        "CREATE TABLE write_task_result(id text,write_task_id text,execute_timestamp bigint,result"
            + " text,error text,spend_time bigint)");
    jdbc.update(
        "INSERT INTO write_task_result VALUES(?,?,1000,'posted',null,25)",
        UUID.randomUUID().toString(),
        fn.toString());
    var migration =
        new ScheduleMigration(
            jdbc, store, false, "America/New_York", "Asia/Shanghai", "svc", "", "");
    transactions.executeWithoutResult(tx -> migration.copy());
    transactions.executeWithoutResult(tx -> migration.copy());
    assertEquals("alice", store.get(agent, false).owner());
    assertEquals("credential_invalid", store.get(agent, false).pausedReason());
    assertEquals("America/New_York", store.get(agent, false).definition().timeZone());
    assertEquals(session, store.history(agent, null, null, 1).getFirst().sessionId());
    assertNull(store.get(fn, false).owner());
    assertFalse(store.get(fn, false).enabled());
    assertEquals("posted", store.history(fn, null, null, 1).getFirst().result());
    assertEquals("unknown", store.history(fn, null, null, 1).getFirst().trigger());
    assertEquals(25L, store.history(fn, null, null, 1).getFirst().spendTime());
    migration.retire();
    assertNull(jdbc.queryForObject("SELECT to_regclass('write_task')::text", String.class));
    assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM platform_task_run", Integer.class));
  }
}
