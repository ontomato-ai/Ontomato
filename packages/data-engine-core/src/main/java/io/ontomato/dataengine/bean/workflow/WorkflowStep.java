package io.ontomato.dataengine.bean.workflow;

import java.util.List;

import lombok.Data;

/**
 * One step of a workflow: the role that owns it and the action it runs.
 *
 * <p>A workflow does not execute anything. It is the published unit that says "in this business
 * process, this role may run this action at this point", so a step is a grant, not a node a runtime
 * moves through. Whoever is next finds their pending item and calls the action themselves; the action's
 * grant scope and the action's state conditions decide whether they may.</p>
 */
@Data
public class WorkflowStep {

    /** Position in the process, starting at 1; the order the business reads it in. */
    private Integer stepNo;

    /** Step name in business language, for example 领导审批. */
    private String name;

    /** Role code that owns this step, resolved to a role id when the workflow is activated. */
    private String roleCode;

    /** The action this step runs. */
    private String actionId;

    /** approve or execute; kept for display and for the pending-item wording. */
    private String actionType;

    /** The scope this step grants to its role. */
    private GrantScope.Kind scope;

    /** Business description of what this step decides. */
    private String description;

    public static final String ACTION_TYPE_APPROVE = "approve";
    public static final String ACTION_TYPE_EXECUTE = "execute";

    public static void requireDistinctNames(List<WorkflowStep> steps) {
        var names = new java.util.HashSet<String>();
        for (var step : steps)
            if (step.getName() == null || step.getName().isBlank() || !names.add(step.getName()))
                throw new IllegalArgumentException("Workflow run steps must have distinct, nonblank names; check step " + step.getStepNo());
    }

    public static List<String> actionTypes() {
        return List.of(ACTION_TYPE_APPROVE, ACTION_TYPE_EXECUTE);
    }

}
