package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.util.DslUtil;
import io.ontomato.dataengine.bean.workflow.GrantScope;
import io.ontomato.dataengine.bean.action.Action;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import org.springframework.stereotype.Service;

import lombok.extern.slf4j.Slf4j;

import io.ontomato.dataengine.bean.workflow.RunContract;
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.bean.workflow.WorkflowStep;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.WorkflowDao;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.CapabilityGrantLookup;
import io.ontomato.dataengine.service.WorkflowGrantSink;
import io.ontomato.dataengine.service.WorkflowService;

/**
 * Publishes workflows as units of authority.
 *
 * <p>Activation freezes the current steps as a numbered revision, writes the grants those steps name,
 * and appends an event. Nothing here runs a process: a step's owner does their own step, and the
 * action's preconditions decide whether it is their turn. Deactivation withdraws only what this
 * version granted, so an earlier revision still in force is not silently removed.</p>
 */
@Slf4j
@Service
public class WorkflowServiceImpl implements WorkflowService {

    private final WorkflowDao workflows;
    private final ActionDao actions;
    private final WorkflowGrantSink grants;
    private final AdminService admin;
    private final WorkflowMetricGenerator metricGenerator;

    public WorkflowServiceImpl(
            WorkflowDao workflows,
            ActionDao actions,
            WorkflowGrantSink grants,
            AdminService admin,
            WorkflowMetricGenerator metricGenerator) {
        this.workflows = workflows;
        this.actions = actions;
        this.grants = grants;
        this.admin = admin;
        this.metricGenerator = metricGenerator;
    }

    @Override
    public Workflow save(Workflow workflow) {
        requireIdentity(workflow);
        if (workflow.getStatus() == null) workflow.setStatus(Workflow.STATUS_DRAFT);
        if (Workflow.STATUS_ACTIVE.equals(workflow.getStatus())) {
            throw new IllegalArgumentException("Activating a workflow is its own operation");
        }
        validate(workflow, workflow.getDomainId());
        return workflows.save(workflow);
    }

    @Override
    public Workflow queryById(String id, String domainId) {
        Workflow workflow = workflows.queryById(id);
        return workflow == null || !Objects.equals(domainId, workflow.getDomainId()) ? null : workflow;
    }

    @Override
    public List<Workflow> queryList(String status, String domainId) {
        return workflows.queryList(status, domainId);
    }

    @Override
    public Workflow activate(String id, String domainId, String principalId) {
        Workflow workflow = require(id, domainId);
        validate(workflow, domainId);

        // The revision number is allocated by the DAO from the frozen rows, not from the row's version
        // column: a draft edit carries no version, so the projection can lag behind what is published.
        // The number is carried back onto the object here rather than relying on the DAO mutating it, so
        // the grants, the event and the stored projection all name the same revision.
        workflow.setStatus(Workflow.STATUS_ACTIVE);
        int version = workflows.publishVersion(workflow);
        workflow.setVersion(version);
        workflows.save(workflow);

        for (WorkflowStep step : workflow.getSteps()) {
            grants.grant(domainId, workflow.getId(), step.getRoleCode(), CapabilityGrantLookup.ACTION,
                    step.getActionId(), version, step.getStepNo(), GrantScope.freeze(step.getScope(), workflow.getRunContract()));
        }
        workflows.appendEvent(workflow, Workflow.EVENT_ACTIVATED, principalId);
        grants.activated(workflow, principalId);
        generateReadCapabilities(workflow);
        return workflow;
    }

    /**
     * Produce the revision's read capabilities, without letting them decide whether it activates.
     *
     * <p>Authority is already in force at this point. A failure here must not roll it back — a process
     * that can act but has no convenient query is usable, while one that was refused activation because
     * a label could not be read is not. The warnings travel back on the response instead.</p>
     */
    private void generateReadCapabilities(Workflow workflow) {
        try {
            WorkflowMetricGenerator.Generated generated = metricGenerator.generate(workflow);
            if (!generated.warnings().isEmpty()) {
                workflow.setActivationNotes(List.copyOf(generated.warnings()));
            }
        } catch (RuntimeException error) {
            log.warn("Read capability generation failed for workflow {}", workflow.getId(), error);
            workflow.setActivationNotes(List.of("查询能力生成失败: " + error.getMessage()));
        }
    }

    @Override
    public Workflow deactivate(String id, String domainId, String principalId) {
        Workflow workflow = require(id, domainId);
        if (!Workflow.STATUS_ACTIVE.equals(workflow.getStatus())) {
            throw new IllegalArgumentException("Only an active workflow can be deactivated");
        }
        workflow.setStatus(Workflow.STATUS_INACTIVE);
        workflows.save(workflow);
        grants.revokeActivatedBy(domainId, workflow.getId(), workflow.getVersion() == null ? 0 : workflow.getVersion());
        workflows.appendEvent(workflow, Workflow.EVENT_DEACTIVATED, principalId);
        grants.deactivated(workflow, principalId);
        return workflow;
    }

    @Override
    public void delete(String id, String domainId) {
        Workflow workflow = require(id, domainId);
        if (Workflow.STATUS_ACTIVE.equals(workflow.getStatus())) {
            // Deleting an active workflow would remove authority without a record of doing so.
            throw new IllegalArgumentException("Deactivate a workflow before deleting it");
        }
        workflows.delete(id);
        workflows.deleteVersionRows(id);
    }

    private Workflow require(String id, String domainId) {
        Workflow workflow = queryById(id, domainId);
        if (workflow == null) throw new IllegalArgumentException("Workflow not found");
        return workflow;
    }

    private void requireIdentity(Workflow workflow) {
        if (workflow.getDomainId() == null || workflow.getDomainId().isBlank()) {
            throw new IllegalArgumentException("A workflow requires its domain");
        }
        if (workflow.getName() == null || workflow.getName().isBlank()) {
            throw new IllegalArgumentException("A workflow requires its name");
        }
    }

    /** A step must name a role and an action that exists in this domain, or activation grants nothing. */
    private void validate(Workflow workflow, String domainId) {
        List<String> problems = new ArrayList<>();
        List<WorkflowStep> steps = workflow.getSteps();
        Set<Integer> numbers = new LinkedHashSet<>();
        if (workflow.getRunContract() != null) workflow.getRunContract().normalized();
        if (steps != null) {
            if (workflow.getRunContract() != null) WorkflowStep.requireDistinctNames(steps);
            for (WorkflowStep step : steps) {
                String where = "step " + step.getStepNo();
                if (step.getStepNo() == null || step.getStepNo() < 1 || !numbers.add(step.getStepNo()))
                    problems.add(where + " requires a unique positive stepNo");
                if (step.getScope() == null) problems.add(where + " must declare its scope");
                if (step.getRoleCode() == null || step.getRoleCode().isBlank()) {
                    problems.add(where + " names no role");
                }
                if (step.getActionId() == null || step.getActionId().isBlank()) {
                    problems.add(where + " names no action");
                } else {
                    var row = actions.queryById(step.getActionId());
                    if (row == null || !domainId.equals(((Action) row[0]).getDomainId()))
                        problems.add(where + " names an unknown action: " + step.getActionId());
                    else validateTarget(step, (Action) row[0], workflow, problems);
                }
                if (step.getActionType() != null && !WorkflowStep.actionTypes().contains(step.getActionType())) {
                    problems.add(where + " has an unknown action type: " + step.getActionType());
                }

            }
        }
        validateRunContract(workflow, domainId, problems);
        if (!problems.isEmpty()) throw new IllegalArgumentException(String.join("; ", problems));
    }

    private void validateTarget(WorkflowStep step, Action action, Workflow workflow, List<String> problems) {
        if (step.getScope() == null) return;
        var target = action.getTarget();
        var contract = workflow.getRunContract();
        try {
            var scope = GrantScope.freeze(step.getScope(), contract);
            if (scope.kind() != GrantScope.Kind.all) scope.requireTarget(target, admin.getJSONRule(workflow.getDomainId()));
            if (target != null && workflow.getRunClassName() != null && !target.className().equals(workflow.getRunClassName()))
                throw new IllegalArgumentException("Action target does not match runClassName");
            if (target != null && contract != null) {
                if (!target.className().equals(contract.getClassName()))
                    throw new IllegalArgumentException("Action target does not match runContract.className");
                var definition = target.definition(admin.getJSONRule(workflow.getDomainId()));
                if (!DslUtil.getPrimaryKey(definition).equals(contract.getIdField()))
                    throw new IllegalArgumentException("runContract.idField must be the Action target primary key");
            }
        } catch (IllegalArgumentException error) {
            problems.add("step " + step.getStepNo() + ": " + error.getMessage());
        }
    }

    /**
     * Verify a declared run contract against the class it names.
     *
     * <p>A contract is the platform's only way to ask where a process's runs keep their identity, step,
     * state and owner. A misspelt field would make every generic read silently match nothing — the exact
     * failure a contract is meant to prevent — so every name is checked here, at the moment the process
     * becomes effective, and the process is refused rather than activated with a contract that cannot be
     * read. A process that declares none is left alone: it simply is not offered those capabilities.</p>
     */
    private void validateRunContract(Workflow workflow, String domainId, List<String> problems) {
        RunContract contract = workflow.getRunContract();
        if (contract == null) return;
        contract.normalized();

        String className = contract.getClassName();
        if (className == null) {
            problems.add("runContract names no class");
            return;
        }
        // Both describe the same object; letting them disagree makes one of them a lie.
        if (workflow.getRunClassName() == null || workflow.getRunClassName().isBlank()) {
            workflow.setRunClassName(className);
        } else if (!workflow.getRunClassName().equals(className)) {
            problems.add("runClassName (" + workflow.getRunClassName()
                    + ") and runContract.className (" + className + ") name different classes");
        }

        if (contract.getStepField() == null) problems.add("runContract names no step field");
        if (contract.getStatusField() == null) problems.add("runContract names no status field");
        if (contract.getStatusOpen() == null || contract.getStatusOpen().isEmpty()) {
            problems.add("runContract declares no open status values");
        }

        Map<String, Object> classDef = classDef(domainId, className);
        if (classDef == null) {
            problems.add("runContract names a class that does not exist in this domain: " + className);
            return;
        }
        Set<String> attributes = attributeNames(classDef);
        for (String field : namedFields(contract)) {
            if (!attributes.contains(field)) {
                problems.add("runContract names an attribute " + className + " does not have: " + field);
            }
        }

        // A value in two groups would make a run both open and finished; no reader could decide.
        Set<String> seen = new LinkedHashSet<>();
        for (String value : allStatuses(contract)) {
            if (!seen.add(value)) {
                problems.add("runContract status value appears in more than one state group: " + value);
            }
        }
    }

    /** The field names a contract points at, in the order they are checked. */
    private List<String> namedFields(RunContract contract) {
        List<String> fields = new ArrayList<>();
        // Added one by one rather than List.of(...): the optional fields are null by design, and a fixed
        // list would reject them before the contract ever reaches its own validation.
        addIfNamed(fields, contract.getIdField());
        addIfNamed(fields, contract.getStepField());
        addIfNamed(fields, contract.getStatusField());
        addIfNamed(fields, contract.getOrgField());
        addIfNamed(fields, contract.getInitiatorField());
        addIfNamed(fields, contract.getAssigneeField());
        addIfNamed(fields, contract.getCandidateField());
        addIfNamed(fields, contract.getWorkflowRefField());
        return fields;
    }

    private void addIfNamed(List<String> fields, String field) {
        if (field != null) fields.add(field);
    }

    private List<String> allStatuses(RunContract contract) {
        List<String> all = new ArrayList<>();
        all.addAll(contract.getStatusOpen() == null ? List.of() : contract.getStatusOpen());
        all.addAll(contract.getStatusDone() == null ? List.of() : contract.getStatusDone());
        all.addAll(contract.getStatusRejected() == null ? List.of() : contract.getStatusRejected());
        return all;
    }

    /** The class definition of one class in this domain, or null when the domain does not define it. */
    private Map<String, Object> classDef(String domainId, String className) {
        Map<String, Object> rule = admin.getJSONRule(domainId);
        if (rule == null) return null;
        Object raw = rule.get("classDef");
        if (!(raw instanceof List<?> defs)) return null;
        for (Object def : defs) {
            if (!(def instanceof Map<?, ?> candidate)) continue;
            if (className.equals(candidate.get("className"))) {
                @SuppressWarnings("unchecked")
                Map<String, Object> typed = (Map<String, Object>) candidate;
                return typed;
            }
        }
        return null;
    }

    /** The attribute names a class definition declares. */
    private Set<String> attributeNames(Map<String, Object> classDef) {
        Set<String> names = new LinkedHashSet<>();
        Object raw = classDef.get("attrs");
        if (!(raw instanceof List<?> attrs)) return names;
        for (Object attr : attrs) {
            if (attr instanceof Map<?, ?> field && !Boolean.FALSE.equals(field.get("enable")) && field.get("name") != null) {
                names.add(String.valueOf(field.get("name")));
            }
        }
        return names;
    }
}
