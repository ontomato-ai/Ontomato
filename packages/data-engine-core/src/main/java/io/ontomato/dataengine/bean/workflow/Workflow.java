package io.ontomato.dataengine.bean.workflow;

import java.util.List;

import lombok.Data;

/**
 * A business process, published as one unit of authority rather than executed by a runtime.
 *
 * <p>There is no workflow engine, and deliberately so: a step may wait days for a person, and building
 * durable resumption for that is a different product. What a workflow does is activate its steps'
 * grants together — once it becomes effective, the roles named by its steps may run the actions those
 * steps name, and once it stops being effective they may not. The subject drives the process by doing
 * their own step; the action's preconditions are what make "not yet your turn" true.</p>
 *
 * <p>Effectiveness is appended as events, never rewritten: a published version is immutable, so the
 * record of what was in force at a given time survives later revisions.</p>
 */
@Data
public class Workflow {

    /** Draft: editable, granting nothing. */
    public static final String STATUS_DRAFT = "DRAFT";
    /** Active: its steps' grants are in force. */
    public static final String STATUS_ACTIVE = "ACTIVE";
    /** Inactive: kept for the record and for the instances already started, granting nothing new. */
    public static final String STATUS_INACTIVE = "INACTIVE";

    public static final String EVENT_ACTIVATED = "Activated";
    public static final String EVENT_DEACTIVATED = "Deactivated";

    private String id;
    private String name;
    private String description;
    private String domainId;

    /** Kept as a projection of the append-only events; the events remain the record. */
    private String status;

    /** Incremented on every published revision; grants name the version that activated them. */
    private Integer version;

    private List<WorkflowStep> steps;

    private Long createTimestamp;
    private Long modifyTimestamp;

    /** The object class a run of this process describes, when the process tracks one. */
    private String runClassName;

    /**
     * How this process's runs are read, declared rather than assumed.
     *
     * <p>Optional: a process without one still runs, but the generic read capabilities that need to know
     * where the lifecycle lives cannot be offered for it. When declared, activation verifies every name
     * in it against the class definition, so a typo fails there instead of silently matching nothing.</p>
     */
    private RunContract runContract;

    /**
     * The subject who created this workflow, taken from the authenticated request. Set once.
     *
     * <p>There is no {@code reviewedBy} column here on purpose: activation is this object's review
     * moment and {@code workflow_event} already records its principal for every Activated row, so the
     * last activation event is the reviewer. Storing it again would be a second copy that can drift.</p>
     */
    private String createdBy;

    /**
     * Warnings raised while generating this revision's read capabilities.
     *
     * <p>Response-only: the DAO never writes this column. It exists so an operator who activated a
     * process learns that its convenient queries were not produced, instead of discovering later that
     * "no pending items" was really "no query".</p>
     */
    private List<String> activationNotes;

    public static List<String> statuses() {
        return List.of(STATUS_DRAFT, STATUS_ACTIVE, STATUS_INACTIVE);
    }
}
