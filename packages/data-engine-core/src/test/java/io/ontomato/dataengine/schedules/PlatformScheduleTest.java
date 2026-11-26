package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.ActionService;
import io.ontomato.dataengine.service.CapabilityGrantLookup;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.authorization.*;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;
import io.ontomato.dataengine.service.identity.UserCredentials;
import io.ontomato.dataengine.service.scheduling.OntologyScheduleReferences;
import io.ontomato.dataengine.service.sys.bean.UserDetail;
import io.ontomato.dataengine.test.PostgresTestDatabase;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.support.TransactionTemplate;

class PlatformScheduleTest extends PostgresTestDatabase {
  private TaskStore store;
  private TransactionTemplate transactions;
  private final IdentityService identities = mock(IdentityService.class);
  private final ScheduleIdentity identity = mock(ScheduleIdentity.class);
  private final ScheduleApplications applications = mock(ScheduleApplications.class);
  private final ScheduleApplication provider = mock(ScheduleApplication.class);
  private final AuthorizationSubjects subjects = mock(AuthorizationSubjects.class);
  private final AuthorizationStore policy = mock(AuthorizationStore.class);
  private final ActionService actions = mock(ActionService.class);
  private final UserDetail alice = user("alice", "sales");
  private final UserDetail bob = user("bob", "sales");
  private UserCredentials credentials;
  private PlatformTasks tasks;
  private PlatformScheduler scheduler;
  private MockMvc http;

  @BeforeEach
  void setup() {
    store = new TaskStore(jdbc, dataSource);
    store.initialize();
    transactions = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
    credentials = new UserCredentials(jdbc, identity, "test-seal");
    var definitions = new CapabilityDefinitions(new AuthorizationService(subjects, policy,
        new ManagementOperations(List.of(new PlatformTasks.Operations())), null, null), identities);
    var actionAccess = mock(ActionAuthorization.class);
    when(actionAccess.standalone(any(), any(), any())).thenReturn(CapabilityGrantLookup.Admission.ALL);
    var capabilities = new TriggerCapabilities(actions, actionAccess, mock(io.ontomato.dataengine.service.WorkflowService.class), definitions, "http://unused");
    var action = new Action();
    action.setId("a");
    action.setName("Posting");
    action.setDomainId("sales");
    action.setStatus(Action.STATUS_PUBLISHED);
    var date = new Parameter();
    date.setName("at");
    date.setType(Parameter.TYPE_TIME);
    var function = new Function();
    function.setParameters(List.of(date));
    action.setFunction(function);
    when(actions.queryById("a")).thenReturn(action);
    when(actions.queryList(isNull(), isNull(), isNull(), eq("sales"))).thenReturn(List.of(action));
    for (var member : List.of(alice, bob, user("alice", "another-domain"))) {
      when(identity.creator(member.getDomainId(), member.getId())).thenReturn(member);
      when(subjects.resolveRoles(member.getDomainId(), member.getId())).thenAnswer(call ->
          new RoleResolution(Set.of(), Set.of(), List.of(), Set.of(), Map.of(), false));
    }
    when(subjects.objectEntitlement(anyString(), any(), eq(Verb.CREATE))).thenReturn(true);
    when(identity.interactiveLogin()).thenReturn(true);
    when(identity.issueKey(alice)).thenReturn("alice-key");
    when(identity.issueKey(bob)).thenReturn("bob-key");
    when(identity.accepts("alice-key", "sales", "alice")).thenReturn(true);
    when(identity.accepts("bob-key", "sales", "bob")).thenReturn(true);
    when(applications.require("agents", "sales")).thenReturn(provider);
    when(applications.canEnter(eq("agents"), any())).thenReturn(true);
    when(provider.remote()).thenReturn(true);
    when(provider.asynchronous()).thenReturn(true);
    when(provider.validate(any(), any())).thenAnswer(call -> {
      TaskDefinition def = call.getArgument(0);
      return new ScheduleApplication.Validation(def.content(), def.formRevision(), def.timeZone(), array(), null);
    });
    auth(alice);
    tasks = new PlatformTasks(store, identities, identity, credentials, applications, capabilities, definitions, transactions);
    ReflectionTestUtils.setField(tasks, "configuredZone", "Asia/Shanghai");
    scheduler = new PlatformScheduler(store, transactions, applications, capabilities, credentials, identity, mock(TaskMail.class));
    http = MockMvcBuilders.standaloneSetup(new PlatformTaskController(tasks)).build();
  }

  @AfterEach void stop() { scheduler.stop(); }

  private static UserDetail user(String id, String domain) {
    var user = new UserDetail();
    user.setId(id);
    user.setLoginCode(id + "-login");
    user.setDomainId(domain);
    user.setEnable(true);
    return user;
  }

  private void auth(User user) { when(identities.getCurrentUser()).thenReturn(user); }

  private static ObjectNode actionInput() {
    return object("title", "Post balances", "targetKind", "action", "targetId", "a",
        "content", object("parameters", object("id", 17), "runStartParameters", List.of("at")),
        "frequency", object("kind", "interval", "every", 1, "unit", "hour"), "notifyEmail", null);
  }

  private static ObjectNode appInput() {
    return object("title", "Ask the agent", "targetKind", "application", "appId", "agents", "formRevision", "v1",
        "content", object("question", "Find anomalies"),
        "frequency", object("kind", "interval", "every", 1, "unit", "hour"), "notifyEmail", null);
  }

  @Test
  void textIdOwnerAndCoauthorsShareOneDefinitionButNotPrivateResults() throws Exception {
    var def = TaskDefinition.input(actionInput(), "Asia/Shanghai", false);
    String id = "trigger-post-balances";
    store.insert(id, "sales", "alice", "alice", List.of("bob"), def, array(), "en", "PUBLISHED", null, null, false);
    var runId = UUID.randomUUID();
    var privateResult = "Alice's private result";
    transactions.executeWithoutResult(tx -> store.admit(store.get(id, true), "alice", runId, "manual", null));
    jdbc.update("UPDATE trigger_run SET status='completed',finished_at=now(),result=?,result_summary=?,result_link=?::jsonb WHERE id=?",
        privateResult, privateResult, object("appId", "agents", "path", "/private").toString(), runId);
    http.perform(get("/platform/triggers/{id}/runs/{run}", id, runId)).andExpect(status().isOk())
        .andExpect(jsonPath("$.result").value(privateResult)).andExpect(jsonPath("$.snapshot.executorId").value("alice"));
    auth(bob);
    http.perform(get("/platform/triggers/{id}", id)).andExpect(status().isOk())
        .andExpect(jsonPath("$.targetName").value("Posting"))
        .andExpect(jsonPath("$.lastRun.status").value("completed"))
        .andExpect(jsonPath("$.lastRun.resultSummary").value(org.hamcrest.Matchers.nullValue()))
        .andExpect(jsonPath("$.lastRun.resultLink").value(org.hamcrest.Matchers.nullValue()))
        .andExpect(jsonPath("$.latestResult").value(org.hamcrest.Matchers.nullValue()));
    http.perform(get("/platform/triggers/{id}/runs/{run}", id, runId)).andExpect(status().isNotFound());
    http.perform(get("/platform/triggers/{id}/runs", id)).andExpect(jsonPath("$.runs.length()").value(0));
    http.perform(get("/platform/triggers").param("countOnly", "true")).andExpect(jsonPath("$.total").value(1));
    http.perform(put("/platform/triggers/{id}", id).contentType(MediaType.APPLICATION_JSON)
        .content(actionInput().put("revision", 1).toString())).andExpect(status().isForbidden());
    auth(user("alice", "another-domain"));
    http.perform(get("/platform/triggers/{id}", id)).andExpect(status().isNotFound());
    http.perform(get("/platform/triggers").param("countOnly", "true")).andExpect(jsonPath("$.total").value(0));
  }

  @Test
  void altersTargetAndRetainsSnapshotWhileManualDispatchUsesClicker() throws Exception {
    var body = appInput().put("executorId", "bob");
    var key = UUID.randomUUID();
    when(subjects.managementEntitlement(PlatformTasks.CHANGE)).thenReturn(true);
    var created = tasks.create(key, body, "en", false).task();
    assertEquals("PENDING_REVIEW", created.path("status").asText());
    String id = key.toString();
    var runId = UUID.randomUUID();
    var response = tasks.manual(id, runId, "en");
    assertEquals("alice", response.at("/snapshot/executorId").asText());
    assertEquals(response, tasks.manual(id, runId, "en"));
    var revision = actionInput().put("revision", 1);
    assertEquals("TASK_RUNNING", assertThrows(ScheduleException.class, () -> tasks.update(id, revision, "en")).code);
    when(provider.start(any(), any())).thenReturn(ScheduleForms.execution("completed").put("result", "done"));
    scheduler.dispatch(runId);
    verify(provider).start(argThat(exec -> "alice".equals(exec.executorId())), argThat(actor -> "alice-key".equals(actor.apiKey())));
    assertEquals("action", tasks.update(id, revision, "en").path("targetKind").asText());
    assertEquals("agents", tasks.detail(id, runId).at("/snapshot/appId").asText());
    assertEquals("done", tasks.detail(id, runId).path("result").asText());
    assertEquals("REVISION_CONFLICT", assertThrows(ScheduleException.class, () -> tasks.update(id, revision, "en")).code);
  }

  @Test
  void coauthorMayEditDraftButDelegationRequiresManagementAndExecutorRenewal() {
    var key = UUID.randomUUID();
    var draft = appInput().put("executorId", "bob");
    draft.set("coauthorIds", JSON.valueToTree(List.of("bob")));
    tasks.create(key, draft, "en", false);
    String id = key.toString();
    var publish = object("revision", 1, "status", "PUBLISHED");
    assertThrows(CapabilityDefinitions.Denied.class, () -> tasks.status(id, publish, "en"));
    when(subjects.managementEntitlement(PlatformTasks.CHANGE)).thenReturn(true);
    var published = tasks.status(id, publish, "en");
    assertEquals("alice", published.path("reviewedBy").asText());
    assertEquals("credential_invalid", published.at("/pause/code").asText());
    assertTrue(published.path("nextRunAt").isNull());
    auth(bob);
    assertEquals("renewal-required", tasks.list(null, "workflow", null, true, false).path("credentialStatus").asText());
    tasks.renewOnVisit("en");
    assertEquals("valid", tasks.list(null, null, null, true, false).path("credentialStatus").asText());
    assertFalse(tasks.detail(id).path("nextRunAt").isNull());
    when(identity.interactiveLogin()).thenReturn(false);
    assertEquals("INTERACTIVE_LOGIN_REQUIRED", assertThrows(ScheduleException.class, () -> tasks.renewOnVisit("en")).code);
  }

  @Test
  void dueSlotAdvancesAndRecordsSkipWhenManualRunIsActive() {
    String id = UUID.randomUUID().toString();
    tasks.create(UUID.fromString(id), appInput(), "en", true);
    var manual = UUID.randomUUID();
    tasks.manual(id, manual, "en");
    jdbc.update("UPDATE trigger_run SET dispatched_at=now(),deadline=now()+interval '1 hour' WHERE id=?", manual);
    var slot = Instant.now().minusSeconds(120).truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
    jdbc.update("UPDATE trigger_def SET next_run_at=? WHERE id=?", TaskStore.timestamp(slot), id);
    when(provider.status(any(), any())).thenReturn(ScheduleForms.execution("running"));
    scheduler.tick();
    assertEquals(slot, store.get(id, false).lastFiredAt());
    assertTrue(store.get(id, false).nextRunAt().isAfter(Instant.now()));
    var last = tasks.history(id, null, 20).path("runs").get(0);
    assertEquals("skipped", last.path("status").asText());
    assertEquals("prior_run_active", last.at("/error/code").asText());
  }

  @Test
  void applicationRejectionInvalidatesOnlyActualExecutorCredentialAndDoesNotPauseTheirAuthorsDefinition() {
    credentials.prepareForSetup(bob);
    var id = UUID.randomUUID();
    when(subjects.managementEntitlement(PlatformTasks.CHANGE)).thenReturn(true);
    tasks.create(id, appInput().put("executorId", "bob"), "en", true);
    var runId = UUID.randomUUID();
    tasks.manual(id.toString(), runId, "en");
    when(provider.start(any(), any())).thenThrow(new ScheduleException(401, "UNAUTHENTICATED", "Key rejected"));
    scheduler.dispatch(runId);
    assertEquals("credential_invalid", tasks.detail(id.toString(), runId).at("/error/code").asText());
    assertTrue(tasks.detail(id.toString()).path("pause").isNull());
    assertTrue(credentials.hasValidKey("sales", "bob"));
    assertFalse(credentials.hasValidKey("sales", "alice"));
  }

  @Test
  void deletingTargetsSeesReferencesThroughTheActualActionFunctionBinding() {
    jdbc.execute("CREATE TABLE action(id text PRIMARY KEY,domain_id text,function_id text)");
    jdbc.execute("INSERT INTO action VALUES('a','sales','f')");
    var id = UUID.randomUUID();
    tasks.create(id, actionInput(), "en", false);
    var references = new OntologyScheduleReferences(jdbc);
    assertTrue(references.referencesAction("a"));
    assertTrue(references.references("f"));
    assertEquals(List.of("f"), references.referencedFunctions());
    tasks.delete(id.toString(), "\"1\"");
    assertFalse(references.referencesAction("a"));
    assertFalse(references.references("f"));
  }
}
