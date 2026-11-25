package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.bean.workflow.GrantScope;
import io.ontomato.dataengine.dao.WorkflowDao;
import io.ontomato.dataengine.service.CapabilityGrantLookup;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/** The anonymous edition resolves the frozen scope without a role directory. */
@Component
public class AnonymousCapabilityGrantLookup implements CapabilityGrantLookup {
    private final WorkflowDao workflows;

    public AnonymousCapabilityGrantLookup(WorkflowDao workflows) {
        this.workflows = workflows;
    }

    @Override
    public Map<Integer, Admission> stepAdmissions(String userId, String domainId, String workflowId, int version) {
        var workflow = workflows.queryActiveById(workflowId, domainId);
        if (workflow == null || workflow.getVersion() != version) return Map.of();
        var admissions = new LinkedHashMap<Integer, Admission>();
        for (var step : workflow.getSteps()) {
            if (step.getScope() == null) continue;
            var scope = GrantScope.freeze(step.getScope(), workflow.getRunContract());
            var admission = switch (scope.kind()) {
                case all -> Admission.ALL;
                case initiated_by_self, assigned_to_self ->
                        new Admission(false, List.of(new Match(scope.className(), scope.field(), List.of(userId))));
                case self_organization, self_subtree, self_descendants -> Admission.DENIED;
            };
            if (admission.admitted()) admissions.put(step.getStepNo(), admission);
        }
        return admissions;
    }
}
