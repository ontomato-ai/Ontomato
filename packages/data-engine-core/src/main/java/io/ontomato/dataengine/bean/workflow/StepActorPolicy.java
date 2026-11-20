package io.ontomato.dataengine.bean.workflow;

import java.util.Map;

import lombok.Data;

/**
 * How a workflow step chooses its concrete actor.
 *
 * <p>This is routing policy, not execution authority. Whatever a rule or Agent returns is still
 * checked against the step role and the platform's subject directory before it becomes an
 * assignment.</p>
 */
@Data
public class StepActorPolicy {
    public static final String MODE_NONE = "none";
    public static final String MODE_RULE = "rule";
    public static final String MODE_AGENT = "agent";

    /** none, rule or agent. */
    private String mode;

    /** Published MetricView used by a deterministic rule. */
    private String metricViewId;
    private String metricRevision;
    private String principalField;
    private Map<String, Object> parameters;
    /**
     * MetricView parameter name to frozen Run/Step/business context expression.
     *
     * <p>Supported expressions are {@code $run.id}, {@code $run.templateRef},
     * {@code $run.requester}, {@code $step.id}, {@code $step.ref},
     * {@code $step.roleCode}, {@code $business.className}, {@code $business.id}, and
     * {@code $business.<field>}. Bound values override static parameters.</p>
     */
    private Map<String, String> parameterBindings;
    /** Optional mapping from the MetricView value to a principal candidate. */
    private Map<String, String> valueMap;

    /**
     * Subject used to evaluate the policy.
     *
     * <p>This is the caller identity for the MetricView or Agent request, not the actor selected for
     * the workflow step. Empty means the Praxis system principal configured for the deployment.</p>
     */
    private String executionPrincipalId;

    /** Ontomato Agent used to choose the actor. */
    private String agentId;
    /** Natural-language assignment policy passed to the Agent as untrusted task data. */
    private String instruction;
}
