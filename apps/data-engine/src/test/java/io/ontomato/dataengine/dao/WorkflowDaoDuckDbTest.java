package io.ontomato.dataengine.dao;

import io.ontomato.dataengine.dataAdapter.DuckDBAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterConnection;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.bean.action.ActionTarget;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.service.sys.bean.permission.FieldPermission;
import io.ontomato.dataengine.service.impl.DslServiceImpl;
import io.ontomato.dataengine.service.OntologyQueryService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.CapabilityGrantLookup;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;

import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.bean.workflow.WorkflowStep;

/**
 * The workflow tables against a real database rather than a mock.
 *
 * <p>Three things can only be proven here: the DDL actually parses on the adapter used during the
 * rebuild (DuckDB), {@code ON CONFLICT} behaves as an idempotent publish on a composite key, and the
 * event table keeps one row per activation instead of overwriting.</p>
 */
class WorkflowDaoDuckDbTest {

    @TempDir
    Path directory;

    private JdbcTemplate jdbc;
    private WorkflowDao dao;

    @BeforeEach
    void open() {
        var dataSource = new DriverManagerDataSource("jdbc:duckdb:" + directory.resolve("engine.db"));
        jdbc = new JdbcTemplate(dataSource);
        dao = new WorkflowDao();
        ReflectionTestUtils.setField(dao, "jdbcTemplate", jdbc);
    }

    @Test
    void theSchemaIsCreatedAndSurvivesASecondStart() {
        dao.initIndex();
        dao.initIndex();

        assertEquals(3, jdbc.queryForObject(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_name IN "
                        + "('workflow', 'workflow_version', 'workflow_event')", Integer.class));
    }

    @Test
    void aSavedWorkflowReadsBackWithItsStepsInOrder() {
        dao.initIndex();
        Workflow workflow = workflow("w1", step(1, "LEADER", "approve"), step(2, "FINANCE", "pay"));
        workflow.setStatus(Workflow.STATUS_DRAFT);

        dao.save(workflow);

        Workflow read = dao.queryById("w1");
        assertNotNull(read);
        assertEquals(Workflow.STATUS_DRAFT, read.getStatus());
        assertEquals("采购审批", read.getName());
        assertEquals(List.of(1, 2), read.getSteps().stream().map(WorkflowStep::getStepNo).toList());
        assertEquals("FINANCE", read.getSteps().get(1).getRoleCode());
        assertEquals(1, dao.queryList(null, "d1").size());
        assertEquals(0, dao.queryList(null, "d2").size());
    }

    @Test
    void savingTheSameWorkflowUpdatesInPlaceInsteadOfDuplicating() {
        dao.initIndex();
        Workflow workflow = workflow("w1", step(1, "LEADER", "approve"));
        dao.save(workflow);

        workflow.setName("采购审批（修订）");
        dao.save(workflow);

        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM workflow WHERE id = 'w1'", Integer.class));
        assertEquals("采购审批（修订）", dao.queryById("w1").getName());
    }

    @Test
    void eachPublicationFreezesANewRevisionNumberedFromTheFrozenRows() {
        dao.initIndex();
        Workflow workflow = workflow("w1", step(1, "LEADER", "approve"));

        assertEquals(1, dao.publishVersion(workflow));
        // Republishing the same object is a new revision, not a silent no-op: the number is allocated
        // from what is already frozen, so two activations can never share one frozen row.
        assertEquals(2, dao.publishVersion(workflow));

        assertEquals(1, jdbc.queryForObject(
                "SELECT COUNT(*) FROM workflow_version WHERE workflow_id = 'w1' AND version = 1",
                Integer.class));
        assertEquals(1, jdbc.queryForObject(
                "SELECT COUNT(*) FROM workflow_version WHERE workflow_id = 'w1' AND version = 2",
                Integer.class));
        assertEquals("LEADER", dao.versionSteps("w1", 1).get(0).getRoleCode());
        assertTrue(dao.versionSteps("w1", 3).isEmpty());
    }

    @Test
    void aDraftEditDoesNotResetThePublishedRevisionNumber() {
        // The defect this guards: save() copied the request's version (absent on a draft edit) over the
        // row, so the next activation computed 1 again, collided with the revision already frozen as 1,
        // and the new steps were dropped while the grants named the older revision.
        dao.initIndex();
        Workflow workflow = workflow("w1", step(1, "LEADER", "approve"));
        int published = dao.publishVersion(workflow);
        dao.save(workflow);

        // Someone edits the draft through the save path, which carries no version at all.
        Workflow draft = workflow("w1", step(1, "LEADER", "approve"), step(2, "FINANCE", "pay"));
        draft.setStatus(Workflow.STATUS_DRAFT);
        dao.save(draft);

        assertEquals(published, dao.queryById("w1").getVersion());
        assertEquals(2, dao.nextVersion("w1"));

        // The next activation therefore freezes its own revision instead of colliding with v1.
        int next = dao.publishVersion(draft);
        assertEquals(2, next);
        assertEquals(2, dao.versionSteps("w1", 2).size());
        assertEquals(1, dao.versionSteps("w1", 1).size());
    }

    @Test
    void aStaleCallerCannotDragTheVersionBackwards() {
        dao.initIndex();
        Workflow workflow = workflow("w1", step(1, "LEADER", "approve"));
        dao.save(workflow);
        dao.updateVersion("w1", 3);

        dao.updateVersion("w1", 1);

        assertEquals(3, dao.queryById("w1").getVersion());
    }

    @Test
    void aLaterRevisionKeepsTheEarlierOneReadable() {
        dao.initIndex();
        Workflow workflow = workflow("w1", step(1, "LEADER", "approve"));
        assertEquals(1, dao.publishVersion(workflow));

        workflow.setSteps(List.of(step(1, "LEADER", "approve"), step(2, "FINANCE", "pay")));
        assertEquals(2, dao.publishVersion(workflow));

        assertEquals(1, dao.versionSteps("w1", 1).size());
        assertEquals(2, dao.versionSteps("w1", 2).size());
    }

    @Test
    void activationAndDeactivationAreAppendedNotOverwritten() {
        dao.initIndex();
        Workflow workflow = workflow("w1", step(1, "LEADER", "approve"));
        workflow.setVersion(1);

        dao.appendEvent(workflow, Workflow.EVENT_ACTIVATED, "U1");
        dao.appendEvent(workflow, Workflow.EVENT_DEACTIVATED, "U2");

        List<String> events = jdbc.queryForList(
                "SELECT event FROM workflow_event WHERE workflow_id = 'w1' ORDER BY create_timestamp, event",
                String.class);
        assertEquals(List.of(Workflow.EVENT_ACTIVATED, Workflow.EVENT_DEACTIVATED), events);
        assertEquals(2, jdbc.queryForObject(
                "SELECT COUNT(*) FROM workflow_event WHERE domain_id = 'd1'", Integer.class));
    }

    @Test
    void deletingAWorkflowRemovesItsRevisionsAndEvents() {
        dao.initIndex();
        Workflow workflow = workflow("w1", step(1, "LEADER", "approve"));
        workflow.setVersion(1);
        dao.save(workflow);
        dao.publishVersion(workflow);
        dao.appendEvent(workflow, Workflow.EVENT_ACTIVATED, "U1");

        dao.delete("w1");
        dao.deleteVersionRows("w1");

        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM workflow", Integer.class));
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM workflow_version", Integer.class));
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM workflow_event", Integer.class));
    }

    @Test
    void theCreatorSurvivesLaterSavesWhileTheActivatorFollowsTheEvents() {
        dao.initIndex();
        Workflow workflow = workflow("w1", step(1, "LEADER", "approve"));
        workflow.setCreatedBy("U1");
        dao.save(workflow);

        // Someone else edits the draft afterwards. Authorship is who wrote it first, not who touched it
        // last, so the stored value must not move — this is the whole reason created_by is left out of
        // the upsert's SET list.
        workflow.setCreatedBy("U2");
        workflow.setName("采购审批（修订）");
        dao.save(workflow);

        assertEquals("U1", dao.queryById("w1").getCreatedBy());

        // There is no reviewed_by column: the reviewer is the principal on the newest Activated row, so
        // each activation names its own approver and the last one wins by reading the events back.
        workflow.setVersion(1);
        dao.appendEvent(workflow, Workflow.EVENT_ACTIVATED, "U3");
        dao.appendEvent(workflow, Workflow.EVENT_ACTIVATED, "U4");
        assertEquals("U4", dao.queryLastEventPrincipal("w1", Workflow.EVENT_ACTIVATED));
    }

    @Test
    void aWorkflowWithNoRecordedCreatorReadsBackAsAbsent() {
        dao.initIndex();
        // Rows written before provenance existed must stay readable; absence is not an error.
        dao.save(workflow("w1", step(1, "LEADER", "approve")));

        assertNull(dao.queryById("w1").getCreatedBy());
        assertNull(dao.queryLastEventPrincipal("w1", Workflow.EVENT_ACTIVATED));
    }

    private Workflow workflow(String id, WorkflowStep... steps) {
        Workflow workflow = new Workflow();
        workflow.setId(id);
        workflow.setName("采购审批");
        workflow.setDomainId("d1");
        workflow.setSteps(List.of(steps));
        return workflow;
    }

    private WorkflowStep step(int no, String role, String action) {
        WorkflowStep step = new WorkflowStep();
        step.setStepNo(no);
        step.setName("step " + no);
        step.setRoleCode(role);
        step.setActionId(action);
        return step;
    }

    @Test
    void migrationRewritesBothRepresentationsWithoutPublishing() {
        dao.initIndex();
        jdbc.execute("CREATE TABLE action (id TEXT, domain_id TEXT, submission_criteria TEXT)");
        jdbc.execute("CREATE TABLE action_drafts (id TEXT, domain_id TEXT, action JSON, consumed_at TIMESTAMP, expires_at TIMESTAMP)");
        var workflow = workflow("w1", step(1, "L", "approve"));
        dao.save(workflow);
        dao.publishVersion(workflow);
        String old = "[{\"stepNo\":1,\"roleCode\":\"L\",\"actionId\":\"approve\",\"assignRule\":\"dept_role\"}]";
        jdbc.update("UPDATE workflow SET steps=?", old);
        jdbc.update("UPDATE workflow_version SET steps=?", old);
        new io.ontomato.dataengine.migration.ActionTargetScopeMigration(jdbc).run();
        assertEquals(io.ontomato.dataengine.bean.workflow.GrantScope.Kind.self_organization, dao.queryById("w1").getSteps().get(0).getScope());
        assertEquals(dao.queryById("w1").getSteps(), dao.versionSteps("w1", 1));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM workflow_event", Integer.class));
    }

    @Test
    void liveActionScopeIntersectsRowsWithoutRequiringTheOrganizationOrKeyColumn() throws Exception {
        var definition = JSONObject.of("className", "target_documents", "attrs", JSONArray.of(
                JSONObject.of("name","id","type","varchar","primaryKey",true,"enable",true),
                JSONObject.of("name","name","type","varchar","enable",true),
                JSONObject.of("name","bio","type","varchar","enable",true),
                JSONObject.of("name","age","type","int","enable",true)));
        var rule = JSONObject.of("classDef", JSONArray.of(definition), "relationship_rule", new JSONObject());
        jdbc.execute("CREATE TABLE target_documents(id VARCHAR PRIMARY KEY, name VARCHAR, bio VARCHAR, age INTEGER)");
        jdbc.execute("INSERT INTO target_documents VALUES ('001','one','A',20),('002','two','B',20),('003','three','A',10)");
        var db = new DataAdapterConnection();
        db.put("url", "jdbc:duckdb:" + directory.resolve("engine.db"));
        var admin = mock(AdminService.class); when(admin.getJSONRule("domain")).thenReturn(rule);
        var config = new DataRagConfig(); config.setDslMightTimeFormats(new String[0]);
        var configs = mock(BusinessConfigService.class);
        var business = new BusinessConfig(); when(configs.get("domain")).thenReturn(business);
        var registry = mock(DataAdapterRegistry.class); when(registry.create(business, rule)).thenReturn(new DuckDBAdapter(db, rule));
        var dsl = new DslServiceImpl();
        ReflectionTestUtils.setField(dsl, "dataRagConfig", config);
        ReflectionTestUtils.setField(dsl, "dataAdapterRegistry", registry);
        ReflectionTestUtils.setField(dsl, "businessConfigService", configs);
        ReflectionTestUtils.setField(dsl, "adminService", admin);
        var query = new OntologyQueryService(admin, dsl, null, null);
        var perm = new UserDataPermission();
        var fields = new FieldPermission("target_documents"); fields.getVisibleFields().add("name"); perm.addFieldPermission(fields);
        perm.addRowPermission("auditor", "target_documents", "{\"operator\":\"logic\",\"and\":[{\"field\":\"age\",\"operator\":\">=\",\"value\":18}]}");
        var access = new QueryAccessService.Access(new QueryAccessService.GrantUser("u", "domain"), perm, null, null, null);
        var target = new ActionTarget("target_documents", "doc");
        var allowed = new CapabilityGrantLookup.Admission(false, List.of(new CapabilityGrantLookup.Match("target_documents", "bio", List.of("A"))));
        assertTrue(query.actionTargetExists(target, "001", allowed, access));
        assertFalse(query.actionTargetExists(target, "002", allowed, access));
        assertFalse(query.actionTargetExists(target, "003", CapabilityGrantLookup.Admission.ALL, access));
        assertFalse(query.actionTargetExists(target, "missing", CapabilityGrantLookup.Admission.ALL, access));
    }

    @Test
    void pendingReadsUseTheSameScopedRowsInManagerAndAgentWithoutAnAssigneeProjection() throws Exception {
        dao.initIndex();
        var contract = new io.ontomato.dataengine.bean.workflow.RunContract();
        contract.setClassName("docs"); contract.setIdField("id"); contract.setStepField("stage");
        contract.setStatusField("status"); contract.setStatusOpen(List.of("open"));
        contract.setAssigneeField("holder"); contract.setWorkflowRefField("flow");
        var lead = step(1, "leader", "approve"); lead.setName("review");
        var person = step(2, "clerk", "approve"); person.setName("correct");
        var wf = workflow("w1", lead, person); wf.setDomainId("domain"); wf.setRunClassName("docs");
        wf.setRunContract(contract); wf.setStatus(Workflow.STATUS_ACTIVE); dao.publishVersion(wf); dao.save(wf);

        var attrs = new JSONArray();
        for (var field : List.of("id","stage","status","department","holder","readable","flow"))
            attrs.add(JSONObject.of("name",field,"type","varchar","primaryKey","id".equals(field),"enable",true));
        var rule = JSONObject.of("classDef", JSONArray.of(JSONObject.of("className","docs","attrs",attrs)), "relationship_rule", new JSONObject());
        jdbc.execute("CREATE TABLE docs(id VARCHAR, stage VARCHAR, status VARCHAR, department VARCHAR, holder VARCHAR, readable VARCHAR, flow VARCHAR)");
        jdbc.execute("""
            INSERT INTO docs VALUES ('A','review','open','my-org',null,'yes','w1'),
              ('B','review','open','other','user','yes','w1'), ('C','correct','open','other','user','yes','w1'),
              ('D','correct','open','my-org','other','yes','w1'), ('E','review','closed','my-org',null,'yes','w1'),
              ('F','review','open','my-org',null,'no','w1'), ('G','review','open','my-org',null,'yes','w2')
            """);
        var admin = mock(AdminService.class); when(admin.getJSONRule("domain")).thenReturn(rule);
        var cfg = new DataRagConfig(); cfg.setDslMightTimeFormats(new String[0]);
        var bc = new BusinessConfig(); var configs = mock(BusinessConfigService.class); when(configs.get("domain")).thenReturn(bc);
        var db = new DataAdapterConnection(); db.put("url", "jdbc:duckdb:" + directory.resolve("engine.db"));
        var registry = mock(DataAdapterRegistry.class); when(registry.create(bc, rule)).thenReturn(new DuckDBAdapter(db, rule));
        var dsl = new DslServiceImpl();
        ReflectionTestUtils.setField(dsl,"dataRagConfig",cfg); ReflectionTestUtils.setField(dsl,"businessConfigService",configs);
        ReflectionTestUtils.setField(dsl,"dataAdapterRegistry",registry); ReflectionTestUtils.setField(dsl,"adminService",admin);
        var manager = spy(new io.ontomato.dataengine.service.impl.MetricViewServiceImpl());
        var ontology = new OntologyQueryService(admin, dsl, manager, null);
        var lookup = mock(CapabilityGrantLookup.class);
        when(lookup.stepAdmissions("user","domain","w1",1)).thenReturn(Map.of(
            1, new CapabilityGrantLookup.Admission(false,List.of(new CapabilityGrantLookup.Match("docs","department",List.of("my-org")))),
            2, new CapabilityGrantLookup.Admission(false,List.of(new CapabilityGrantLookup.Match("docs","holder",List.of("user"))))));
        var pending = new io.ontomato.dataengine.service.WorkflowPendingQuery(dao,lookup,ontology);
        var subjects = new io.ontomato.dataengine.service.SubjectValueResolver(mock(io.ontomato.dataengine.service.SubjectAttributeLookup.class));
        ReflectionTestUtils.setField(manager,"pending",pending); ReflectionTestUtils.setField(manager,"subjectValues",subjects);
        var metric = new io.ontomato.dataengine.bean.metricView.MetricView(); metric.setId("metric"); metric.setDomainId("domain");
        metric.setWorkflowSource(new io.ontomato.dataengine.bean.metricView.MetricView.WorkflowSource("w1",1,
            io.ontomato.dataengine.bean.metricView.MetricView.WorkflowSource.Purpose.pending));
        metric.setStatus("PUBLISHED"); metric.setBindings(List.of());
        var fn = new io.ontomato.dataengine.bean.function.Function(); fn.setOperation("OPERATION_READ"); fn.setDomainId("domain");
        fn.setQueryPackage(io.ontomato.dataengine.service.WorkflowRunQueries.pendingPackage(contract));
        var returns = new io.ontomato.dataengine.bean.function.ReturnDef(); returns.setColumnLabels(JSONObject.of("id","ID","stage","Step","status","State"));
        fn.setReturnDef(returns); metric.setFunction(fn);
        io.ontomato.dataengine.service.QueryPackage.prepareReadFunction(fn, List.of(rule.getJSONArray("classDef").getJSONObject(0)));
        doReturn(metric).when(manager).queryById("metric","domain");
        var accessUser = new QueryAccessService.GrantUser("user","domain");
        var permission = new UserDataPermission(); var fp = new FieldPermission("docs");
        fp.getVisibleFields().addAll(List.of("id","stage","status")); permission.addFieldPermission(fp);
        permission.addRowPermission("post","docs","{\"operator\":\"logic\",\"and\":[{\"field\":\"readable\",\"operator\":\"=\",\"value\":\"yes\"}]}");
        var access = new QueryAccessService.Access(accessUser,permission,null,null,null);
        var outputs = new io.ontomato.dataengine.service.QueryOutputService(null,null,ontology,null,subjects);
        ReflectionTestUtils.setField(outputs,"pending",pending);
        var recipe = JSONObject.of("kind","metric","metricId","metric","revision",OntologyQueryService.revision(metric),"parameters",new JSONObject());
        var rows = outputs.execute("agent", recipe, null, access,"en").getJSONArray("rows");
        assertEquals(List.of("A","C"), rows.stream().map(JSONObject::from).map(r -> r.getString("id")).sorted().toList());
        assertEquals(rows, manager.execute("metric",null,new JSONObject(),null,"en",accessUser,permission,1)[0]);
        assertFalse(recipe.getJSONObject("package").toJSONString().contains("my-org"));
        when(lookup.stepAdmissions("user","domain","w1",1)).thenReturn(Map.of());
        assertTrue(outputs.execute("none",recipe,null,access,"en").getJSONArray("rows").isEmpty());
        when(lookup.stepAdmissions("user","domain","w1",1)).thenThrow(new IllegalStateException("roles unavailable"));
        org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class, () -> outputs.execute("fail",recipe,null,access,"en"));
        wf.setStatus(Workflow.STATUS_INACTIVE); dao.save(wf);
        var stale = org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class, () -> outputs.execute("stale",recipe,null,access,"en"));
        assertTrue(stale.getMessage().contains("no longer active"));
    }
}
