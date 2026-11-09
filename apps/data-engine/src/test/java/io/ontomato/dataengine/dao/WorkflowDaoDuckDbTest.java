package io.ontomato.dataengine.dao;

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
}
