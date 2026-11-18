package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.workflow.RunContract;
import io.ontomato.dataengine.dao.WorkflowDao;
import io.ontomato.dataengine.util.DslPermissionUtil;
import io.ontomato.dataengine.bean.workflow.WorkflowStep;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

/** Resolve one generated metric against the caller and its frozen steps at execution time. */
@Service
public class WorkflowPendingQuery {
    private final WorkflowDao workflows;
    private final CapabilityGrantLookup grants;
    private final OntologyQueryService ontology;

    public WorkflowPendingQuery(WorkflowDao workflows, CapabilityGrantLookup grants, @Lazy OntologyQueryService ontology) {
        this.workflows = workflows;
        this.grants = grants;
        this.ontology = ontology;
    }

    public QueryPackageExecution.Result execute(String id, MetricView metric, JSONObject values,
                                                QueryAccessService.Access access, String lang) throws Exception {
        var source = metric.getWorkflowSource();
        var domain = access.user().getDomainId();
        var bundle = metric.getFunction().getQueryPackage();
        var revision = workflows.pendingRevision(domain, source.workflowId(), source.version());
        // Even a stale source must never dispatch a re-authored function or an independent read package.
        if (revision == null) throw new IllegalStateException("Workflow revision is no longer active; retrieve the published pending query again");
        RunContract contract = revision.contract();
        if (!WorkflowRunQueries.pendingPackage(contract).equals(bundle))
            throw new IllegalStateException("Pending query definition differs from its frozen workflow projection");
        if (revision.sharedClass() && contract.getWorkflowRefField() == null)
            throw new IllegalStateException("Shared run class " + contract.getClassName() + " requires runContract.workflowRefField containing the workflow ID");
        var steps = grants.stepAdmissions(access.user().getId(), domain, source.workflowId(), source.version());
        WorkflowStep.requireDistinctNames(revision.steps());
        var predicate = pendingPredicate(contract, source.workflowId(), revision.steps(), steps);
        return QueryPackageExecution.execute(id, bundle, values, QueryPackage.labels(metric.getFunction().getReturnDef().getSourceAnalysis()),
                access, lang, 1, ontology, null, predicate);
    }

    /**
     * The row predicate for one caller's pending items.
     *
     * <p>When the contract uses the same attribute for the current step and the status, that attribute
     * holds status codes, not step names. Anchoring on the step name would then match nothing; the
     * status filter and the caller's admissions are enough.</p>
     */
    static JSONObject pendingPredicate(RunContract contract, String workflowId,
                                       java.util.List<WorkflowStep> steps,
                                       java.util.Map<Integer, CapabilityGrantLookup.Admission> admissions) {
        boolean statusIsStep = java.util.Objects.equals(contract.getStepField(), contract.getStatusField());
        JSONArray alternatives = new JSONArray();
        boolean admitted = false;
        for (WorkflowStep step : steps) {
            var admission = admissions.get(step.getStepNo());
            if (admission == null || !admission.admitted()) continue;
            admitted = true;
            if (statusIsStep) {
                if (!admission.unrestricted()) {
                    JSONArray matches = new JSONArray();
                    for (var match : admission.matches())
                        if (contract.getClassName().equals(match.className()) && !match.values().isEmpty())
                            matches.add(JSONObject.of("field", match.field(), "operator", "in", "value", match.values()));
                    if (!matches.isEmpty()) alternatives.add(JSONObject.of("operator", "logic", "or", matches));
                }
            } else {
                alternatives.add(admission.restrict(contract.getClassName(), equal(contract.getStepField(), step.getName())));
            }
        }
        JSONArray conditions = JSONArray.of(JSONObject.of("field", contract.getStatusField(), "operator", "in", "value", contract.openStatuses()));
        if (contract.getWorkflowRefField() != null) conditions.add(equal(contract.getWorkflowRefField(), workflowId));
        if (!alternatives.isEmpty()) conditions.add(JSONObject.of("operator", "logic", "or", alternatives));
        else if (!admitted) conditions.add(DslPermissionUtil.alwaysFalse(contract.getIdField()));
        return JSONObject.of("operator", "logic", "and", conditions);
    }

    private static JSONObject equal(String field, String value) {
        return JSONObject.of("field", field, "operator", "=", "value", value);
    }
}
