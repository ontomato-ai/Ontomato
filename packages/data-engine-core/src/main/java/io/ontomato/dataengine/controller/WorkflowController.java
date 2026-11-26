package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.authorization.ManagementEndpoint;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.bean.workflow.RunContract;
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.bean.workflow.WorkflowStep;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.WorkflowDao;
import io.ontomato.dataengine.panelreads.OntologyNeighborScope;
import io.ontomato.dataengine.panelreads.WorkbenchPanelRead;
import io.ontomato.dataengine.service.AssignmentAuthority;
import io.ontomato.dataengine.service.CapabilityGrantQuery;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.service.PlatformAccessQuery;
import io.ontomato.dataengine.service.SubjectDirectory;
import io.ontomato.dataengine.service.WorkflowService;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationService.Management;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.ManagementOperations;
import io.ontomato.dataengine.service.authorization.ManagementOperations.Operation;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess;
import io.ontomato.dataengine.util.SystemUtils;

import lombok.extern.slf4j.Slf4j;

/**
 * Publishing workflows as units of authority.
 *
 * <p>Activation is a separate call from saving a draft on purpose: it is the moment a business process
 * becomes able to convey authority, so it is the moment worth auditing. Every response reports the
 * domain's own workflows only.</p>
 */
@Slf4j
@RestController
@Owned
public class WorkflowController {

    private static final String CHANGE = "workflow.lifecycle.change";
    static final String READ = "workflow.grants.read";
    private static final String ONTOLOGY = "platform:OntologyType";
    private static final String ROLE = "platform:Role";
    private static final String WORKFLOW = "platform:Workflow";
    private static final String ACTION = "platform:Action";

    @Component
    public static final class Operations implements ManagementOperations.Contributor {
        @Override
        public List<Operation> managementOperations() {
            return List.of(new Operation(CHANGE, "Activate or deactivate workflows", ManagementOperations.Access.CHANGE),
                    new Operation(READ, "Read workflow grants", ManagementOperations.Access.READ));
        }
    }

    @Autowired
    private ManagementRequestAccess management;

    @Autowired
    private AuthorizationService authorization;

    @Autowired
    private WorkflowService workflowService;

    @Autowired
    private io.ontomato.dataengine.service.ActionService actions;

    @Autowired
    private WorkflowDao workflowDao;

    @Autowired
    private CapabilityGrantQuery grants;

    @Autowired
    private PlatformAccessQuery platformAccess;

    @Autowired
    private SubjectDirectory subjects;

    @Autowired
    private AssignmentAuthority assignmentAuthority;

    /**
     * May one subject assign work to another?
     *
     * <p>Asked by the execution plane before it pins a step, so the answer comes from the same organization model the
     * platform enforces everywhere else, instead of the caller re-deriving it.</p>
     */
    @PostMapping("/workflow/can-assign")
    @ResponseBody
    public JSONObject canAssign(@RequestBody JSONObject param) {
        JSONObject ret = new JSONObject();
        try {
            User user = SystemUtils.getCurUser();
            String domainId = user.getDomainId();
            // The caller may name a subject by id or by login code: the execution plane knows login codes, the platform
            // stores ids. Resolving here keeps one vocabulary per side instead of making every caller learn the other.
            String from = subjectId(domainId, param.getString("from"));
            String to = subjectId(domainId, param.getString("to"));
            JSONObject data = new JSONObject();
            if (from == null || to == null) {
                data.put("allowed", false);
                data.put("reason", from == null
                        ? "the assigner is not a subject of this domain"
                        : "the assignee is not a subject of this domain");
            } else {
                var decision = assignmentAuthority.canAssign(domainId, from, to);
                data.put("allowed", decision.allowed());
                data.put("reason", decision.reason());
            }
            ret.put("data", data);
            ret.put("success", true);
        } catch (Exception e) {
            log.error(e.getMessage(), e);
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }

    /** A subject id from either its id or its login code; null when this domain publishes no such subject. */
    private String subjectId(String domainId, String name) {
        if (name == null || name.isBlank()) return null;
        for (SubjectDirectory.Subject subject : subjects.subjectsInDomain(domainId)) {
            if (name.equals(subject.id()) || name.equalsIgnoreCase(subject.loginCode())) return subject.id();
        }
        return null;
    }

    @PostMapping("/workflow/save")
    @ResponseBody
    public JSONObject save(@RequestBody JSONObject param) {
        JSONObject ret = new JSONObject();
        try {
            User user = SystemUtils.getCurUser();
            Workflow workflow = parse(param);
            workflow.setDomainId(user.getDomainId());
            // The author comes from the request context, not the body. The DAO keeps the first value, so
            // editing a draft later does not reassign authorship.
            workflow.setCreatedBy(user.getId());
            Workflow saved = workflowService.save(workflow);
            ret.put("success", true);
            ret.put("data", render(saved));
        } catch (IllegalArgumentException e) {
            log.error(e.getMessage(), e);
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }

    @PostMapping("/workflow/activate")
    @ResponseBody
    public JSONObject activate(@RequestBody JSONObject param) {
        User user = management.require(CHANGE);
        JSONObject ret = new JSONObject();
        try {
            Workflow workflow =
                    workflowService.activate(param.getString("id"), user.getDomainId(), user.getId());
            ret.put("success", true);
            ret.put("data", render(workflow));
        } catch (Exception e) {
            log.error(e.getMessage(), e);
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }

    @PostMapping("/workflow/deactivate")
    @ResponseBody
    public JSONObject deactivate(@RequestBody JSONObject param) {
        User user = management.require(CHANGE);
        JSONObject ret = new JSONObject();
        try {
            Workflow workflow =
                    workflowService.deactivate(param.getString("id"), user.getDomainId(), user.getId());
            ret.put("success", true);
            ret.put("data", render(workflow));
        } catch (Exception e) {
            log.error(e.getMessage(), e);
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }

    @PostMapping("/workflow/delete")
    @ResponseBody
    public JSONObject delete(@RequestBody JSONObject param) {
        JSONObject ret = new JSONObject();
        try {
            workflowService.delete(param.getString("id"), SystemUtils.getCurUser().getDomainId());
            ret.put("success", true);
        } catch (IllegalArgumentException e) {
            log.error(e.getMessage(), e);
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }

    /**
     * Who can act in this domain, with the roles each subject effectively holds.
     *
     * <p>Provenance columns store a subject id; this is how a reader turns one into a name without the
     * stored value carrying a copy of it. Roles are folded in through the same resolution authorization
     * uses, so a graph drawn from this cannot claim authority the executor would refuse.</p>
     */
    @ManagementEndpoint(GovernanceDirectoryController.MEMBERS_READ)
    @PostMapping("/workflow/subjects")
    @ResponseBody
    public JSONObject subjects(@RequestBody(required = false) JSONObject param) {
        if (countOnly(param)) {
            return countResult(JSONObject.of("total", subjects.countInDomain(SystemUtils.getCurUser().getDomainId())));
        }
        JSONObject ret = new JSONObject();
        try {
            User user = SystemUtils.getCurUser();
            ret.put("success", true);
            ret.put("data", subjectRows(user.getDomainId(), true));
        } catch (Exception e) {
            log.error(e.getMessage(), e);
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }

    private JSONArray subjectRows(String domain, boolean includeRoles) {
        JSONArray data = new JSONArray();
        for (SubjectDirectory.Subject subject : subjects.subjectsInDomain(domain)) {
            var item = JSONObject.of("id", subject.id(), "loginCode", subject.loginCode(), "displayName", subject.displayName());
            if (includeRoles) item.put("roleIds", JSONArray.of(subject.roleIds().toArray()));
            data.add(item);
        }
        return data;
    }

    @Bean
    WorkbenchPanelRead ontologyStartMemberName() {
        return new WorkbenchPanelRead("platform:OntologyType", "start", (subject, parameters) -> {
            management.require(subject, GovernanceDirectoryController.MEMBERS_READ);
            var viewer = subject.identity();
            return subjects.displayNamesInDomain(viewer.domainId(), Set.of(viewer.userId())).get(viewer.userId());
        });
    }

    @Bean
    WorkbenchPanelRead userInstanceDirectory() {
        return new WorkbenchPanelRead("platform:User", "instanceDirectory", (subject, parameters) -> {
            management.require(subject, GovernanceDirectoryController.MEMBERS_READ);
            return subjects.memberIdentitiesInDomain(subject.identity().domainId());
        });
    }

    @Bean
    WorkbenchPanelRead ontologySubjectsCount() {
        return new WorkbenchPanelRead("platform:OntologyType", "subjectsCount", (subject, parameters) -> {
            management.require(subject, GovernanceDirectoryController.MEMBERS_READ);
            return Map.of("total", subjects.countInDomain(subject.identity().domainId()));
        });
    }

    @Bean
    WorkbenchPanelRead ontologyRoleDirectoryCount() {
        return new WorkbenchPanelRead("platform:OntologyType", "roleDirectoryCount", (subject, parameters) -> {
            management.require(subject, GovernanceDirectoryController.ROLES_READ);
            return Map.of("total", platformAccess.countRolesInDomain(subject.identity().domainId()));
        });
    }

    @Bean
    WorkbenchPanelRead ontologyGrantRoleCounts() {
        return new WorkbenchPanelRead("platform:OntologyType", "grantRoleCounts", (subject, parameters) -> {
            management.require(subject, READ);
            return grants.countRolesInDomain(subject.identity().domainId());
        });
    }

    record RoleDirectoryEntry(String roleId, String roleCode) {}

    @Bean
    WorkbenchPanelRead roleInstanceDirectory() {
        return new WorkbenchPanelRead("platform:Role", "instanceDirectory", (subject, parameters) -> {
            management.require(subject, GovernanceDirectoryController.ROLES_READ);
            return platformAccess.rolesInDomain(subject.identity().domainId()).stream()
                    .map(role -> new RoleDirectoryEntry(role.roleId(), role.roleCode())).toList();
        });
    }

    @Bean
    WorkbenchPanelRead roleInstanceGrantRoles() {
        return new WorkbenchPanelRead("platform:Role", "instanceGrantRoles", (subject, parameters) -> {
            management.require(subject, READ);
            return grants.grantsInDomain(subject.identity().domainId()).stream()
                    .map(grant -> new RoleDirectoryEntry(grant.roleId(), grant.roleCode())).distinct().toList();
        });
    }

    /** Role directory and platform grants for workflow administration. */
    @ManagementEndpoint(GovernanceDirectoryController.ROLES_READ)
    @PostMapping("/workflow/platform-access")
    @ResponseBody
    public JSONObject platformAccess(@RequestBody(required = false) JSONObject param) {
        if (countOnly(param)) {
            return countResult(JSONObject.of("total", platformAccess.countRolesInDomain(SystemUtils.getCurUser().getDomainId())));
        }
        JSONObject ret = new JSONObject();
        try {
            User user = SystemUtils.getCurUser();
            JSONArray data = new JSONArray();
            for (PlatformAccessQuery.RoleAccess role : platformAccess.rolesInDomain(user.getDomainId())) {
                JSONObject item = new JSONObject();
                item.put("roleId", role.roleId());
                item.put("roleCode", role.roleCode());
                item.put("managementOperations", JSONArray.of(role.managementOperations().toArray()));
                item.put("canCreateWorkflow", role.canCreateWorkflow());
                item.put("managementRole", role.managementRole());
                data.add(item);
            }
            ret.put("success", true);
            ret.put("data", data);
        } catch (Exception e) {
            log.error(e.getMessage(), e);
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }

    /**
     * What this domain's roles are actually allowed to run.
     *
     * <p>The executor only asks "may this subject run this action", so the stored grants are otherwise
     * write-only from the product's side. An operator asking what a published revision approved needs
     * this view; it is also what lets the cross-layer graph draw role-to-capability edges.</p>
     */
    @PostMapping("/workflow/grants")
    @ResponseBody
    public JSONObject grants(@RequestBody(required = false) JSONObject param) {
        User user = management.require(READ);
        if (countOnly(param)) {
            var counts = grants.countRolesInDomain(user.getDomainId());
            return countResult(JSONObject.of("total", counts.total(), "outsideDirectory", counts.outsideDirectory()));
        }
        JSONObject ret = new JSONObject();
        try {
            ret.put("success", true);
            ret.put("data", grantRows(user.getDomainId()));
        } catch (Exception e) {
            log.error(e.getMessage(), e);
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }

    @Bean
    WorkbenchPanelRead workflowPanelCount() {
        return new WorkbenchPanelRead("platform:Workflow", "count", (subject, parameters) ->
                Map.of("rows", List.of(), "total", workflowService.count(null, null, subject.identity().domainId())));
    }

    @PostMapping("/workflow/query")
    @ResponseBody
    public JSONObject query(@RequestBody JSONObject param) {
        if (countOnly(param)) {
            User user = SystemUtils.getCurUser();
            return countResult(JSONObject.of("total", workflowService.count(param.getString("id"),
                    queryStatus(param), user.getDomainId())));
        }
        JSONObject ret = new JSONObject();
        try {
            User user = SystemUtils.getCurUser();
            String id = param.getString("id");
            String status = queryStatus(param);
            if (id != null) {
                Workflow workflow = readWorkflow(id, status, user.getDomainId());
                ret.put("success", true);
                var definition = workflow == null ? null : render(workflow);
                if (workflow != null && Workflow.STATUS_ACTIVE.equals(status) && "execution".equals(param.getString("purpose"))) {
                    var descriptors = new JSONObject();
                    for (String actionId : workflow.getSteps().stream().map(WorkflowStep::getActionId).distinct().toList()) {
                        var action = actions.queryById(actionId);
                        if (action == null || !user.getDomainId().equals(action.getDomainId())
                                || !io.ontomato.dataengine.bean.action.Action.STATUS_PUBLISHED.equals(action.getStatus()))
                            throw new IllegalStateException("Workflow action is unavailable: " + actionId);
                        descriptors.put(actionId, ActionController.executionDefinition(action));
                    }
                    definition.put("executionActions", descriptors);
                }
                ret.put("data", definition);
            } else {
                JSONArray data = renderWorkflows(workflowService.queryList(status, user.getDomainId()));
                ret.put("success", true);
                ret.put("data", data);
            }
        } catch (Exception e) {
            log.error(e.getMessage(), e);
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }

    @Bean
    WorkbenchPanelRead ontologyWorkflowStepLinks() {
        return new WorkbenchPanelRead(ONTOLOGY, "role.owns-workflow-step", (subject, parameters) -> {
            var scope = OntologyNeighborScope.parse(parameters, ROLE, WORKFLOW);
            management.require(subject, READ);
            return grants.workflowStepLinks(subject.identity().domainId(), scope.centerId(), scope.outgoing());
        });
    }

    @Bean
    WorkbenchPanelRead ontologyWorkflowCenter() {
        return new WorkbenchPanelRead(ONTOLOGY, "workflowCenter", (subject, parameters) -> {
            if (!(parameters.get("primaryKey") instanceof String id) || id.isBlank())
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A workflow ID is required");
            return workflowService.directoryEntries(subject.identity().domainId(), Set.of(id));
        });
    }

    @Bean
    WorkbenchPanelRead ontologyWorkflowStepActions() {
        return new WorkbenchPanelRead(ONTOLOGY, "workflow.step-references-action", (subject, parameters) -> {
            var scope = OntologyNeighborScope.parse(parameters, WORKFLOW, ACTION);
            return workflowDao.stepActionLinks(subject.identity().domainId(), scope.centerId(), scope.outgoing());
        });
    }

    @Bean
    WorkbenchPanelRead workflowInstanceDirectory() {
        return new WorkbenchPanelRead("platform:Workflow", "instanceDirectory", (subject, parameters) ->
                workflowService.queryList(null, subject.identity().domainId()).stream()
                        .map(WorkflowController::renderDirectoryEntry).toList());
    }

    record WorkflowProvenance(String name, String createdBy, String reviewedBy) {}

    @Bean
    WorkbenchPanelRead workflowInstanceProvenance() {
        return new WorkbenchPanelRead("platform:Workflow", "instanceProvenance", (subject, parameters) ->
                workflowService.queryList(null, subject.identity().domainId()).stream()
                        .map(workflow -> {
                            String name = workflow.getName();
                            return new WorkflowProvenance(name == null || name.isBlank() ? workflow.getId() : name,
                                    workflow.getCreatedBy(), workflowReviewer(workflow));
                        }).toList());
    }

    @Bean
    WorkbenchPanelRead workflowPanelList() {
        return workflowPanelCatalogue("list");
    }

    @Bean
    WorkbenchPanelRead workflowPanelQuery() {
        return workflowPanelCatalogue("query");
    }

    private WorkbenchPanelRead workflowPanelCatalogue(String name) {
        return new WorkbenchPanelRead("platform:Workflow", name, (subject, parameters) -> {
            var workflows = workflowService.queryList(null, subject.identity().domainId());
            var ids = workflows.stream().map(Workflow::getId).collect(java.util.stream.Collectors.toSet());
            var facts = workflowRecordFacts(subject, ids);
            facts.put("workflows", renderWorkflows(workflows));
            return facts;
        });
    }

    @Bean
    WorkbenchPanelRead workflowPanelRecord() {
        return new WorkbenchPanelRead("platform:Workflow", "record", (subject, parameters) -> {
            var workflow = requirePanelWorkflow(subject, (String) parameters.get("primaryKey"));
            var facts = workflowRecordFacts(subject, Set.of(workflow.getId()));
            facts.put("workflow", render(workflow));
            return facts;
        });
    }

    @Bean
    WorkbenchPanelRead workflowPanelForm() {
        return new WorkbenchPanelRead("platform:Workflow", "form", (subject, parameters) -> {
            var workflow = requirePanelWorkflow(subject, (String) parameters.get("primaryKey"));
            var facts = workflowFormFacts(subject);
            facts.put("workflow", render(workflow));
            return facts;
        });
    }

    @Bean
    WorkbenchPanelRead workflowPanelCreateForm() {
        return new WorkbenchPanelRead("platform:Workflow", "createForm", (subject, parameters) -> workflowFormFacts(subject));
    }

    private JSONObject workflowFormFacts(SubjectContext subject) {
        // A denied directory contributes no names or options to the workflow display.
        var directory = authorization.decide(subject, new Management(GovernanceDirectoryController.MEMBERS_READ)).allowed()
                ? subjectRows(subject.identity().domainId(), false) : new JSONArray();
        return JSONObject.of("subjects", directory, "actions", actionNames(subject));
    }

    private JSONObject workflowRecordFacts(SubjectContext subject, Set<String> workflowIds) {
        var facts = workflowFormFacts(subject);
        // Null is the existing unavailable-grants state, distinct from an empty authorized list.
        var visibleGrants = authorization.decide(subject, new Management(READ)).allowed()
                ? grantRows(subject.identity().domainId(), grant -> grant.inForce()
                        && grant.workflowId() != null && workflowIds.contains(grant.workflowId())) : null;
        facts.put("grants", visibleGrants);
        return facts;
    }

    private JSONArray renderWorkflows(List<Workflow> workflows) {
        JSONArray rows = new JSONArray();
        for (var workflow : workflows) rows.add(render(workflow));
        return rows;
    }

    private Workflow requirePanelWorkflow(SubjectContext subject, String id) {
        Workflow workflow = readWorkflow(id, null, subject.identity().domainId());
        if (workflow == null) throw new OwnerRefusal("WORKFLOW_NOT_FOUND", "Workflow not found");
        return workflow;
    }

    @Bean
    WorkbenchPanelRead workflowPanelLifecycleState() {
        return new WorkbenchPanelRead("platform:Workflow", "lifecycleState", (subject, parameters) -> {
            var workflow = requirePanelWorkflow(subject, (String) parameters.get("primaryKey"));
            return JSONObject.of("id", workflow.getId(), "status", workflow.getStatus(), "hasDraft", workflow.getHasDraft());
        });
    }

    @Bean
    WorkbenchPanelRead workflowPanelGrantCaseScopedSteps() {
        return new WorkbenchPanelRead("platform:Workflow", "grantCaseScopedSteps", (subject, parameters) -> {
            management.require(subject, READ);
            return workflowGrantFacts(subject, (String) parameters.get("primaryKey"), false);
        });
    }

    @Bean
    WorkbenchPanelRead workflowPanelGrantInForce() {
        return workflowGrantRows("grantInForce");
    }

    @Bean
    WorkbenchPanelRead workflowPanelGrantSuperseded() {
        return workflowGrantRows("grantSuperseded");
    }

    @Bean
    WorkbenchPanelRead workflowPanelGrantDirect() {
        return new WorkbenchPanelRead("platform:Workflow", "grantDirect", (subject, parameters) -> {
            management.require(subject, READ);
            return workflowGrantFacts(subject, (String) parameters.get("primaryKey"), true);
        });
    }

    private WorkbenchPanelRead workflowGrantRows(String name) {
        return new WorkbenchPanelRead("platform:Workflow", name, (subject, parameters) -> {
            management.require(subject, READ);
            return JSONObject.of("grants", grantRows(subject.identity().domainId()), "actions", actionNames(subject));
        });
    }

    private JSONObject workflowGrantFacts(SubjectContext subject, String id, boolean includeGrants) {
        String domain = subject.identity().domainId();
        Workflow workflow = requirePanelWorkflow(subject, id);
        var facts = JSONObject.of("workflow", render(workflow), "actions", actionNames(subject));
        if (includeGrants) facts.put("grants", grantRows(domain));
        return facts;
    }

    private List<JSONObject> actionNames(SubjectContext subject) {
        return actions.listVisibleDefinitions(subject, null, null).stream()
                .map(action -> JSONObject.of("id", action.getId(), "name", action.getName(), "status", action.getStatus()))
                .toList();
    }

    private Workflow readWorkflow(String id, String status, String domain) {
        return Workflow.STATUS_ACTIVE.equals(status) ? workflowService.queryActiveById(id, domain)
                : workflowService.queryById(id, domain);
    }

    private JSONArray grantRows(String domain) {
        return grantRows(domain, grant -> true);
    }

    private JSONArray grantRows(String domain, Predicate<CapabilityGrantQuery.Grant> includes) {
        JSONArray data = new JSONArray();
        for (CapabilityGrantQuery.Grant grant : grants.grantsInDomain(domain)) {
            if (!includes.test(grant)) continue;
            JSONObject item = new JSONObject();
            item.put("roleId", grant.roleId());
            item.put("roleCode", grant.roleCode());
            item.put("capabilityKind", grant.capabilityKind());
            item.put("capabilityId", grant.capabilityId());
            item.put("capabilityVersion", grant.capabilityVersion());
            item.put("workflowId", grant.workflowId());
            item.put("stepNo", grant.stepNo());
            item.put("scope", grant.scope());
            item.put("inForce", grant.inForce());
            item.put("activatedByWorkflowVersion", grant.activatedByWorkflowVersion());
            data.add(item);
        }
        return data;
    }

    private static boolean countOnly(JSONObject param) {
        return param != null && Boolean.TRUE.equals(param.get("countOnly"));
    }

    private static JSONObject countResult(JSONObject counts) {
        return JSONObject.of("success", true, "data", counts);
    }

    private static String queryStatus(JSONObject param) {
        String status = param.getString("status");
        return status == null ? null : status.trim();
    }

    private Workflow parse(JSONObject param) {
        Workflow workflow = new Workflow();
        workflow.setId(param.getString("id"));
        workflow.setName(param.getString("name"));
        workflow.setDescription(param.getString("description"));
        workflow.setRunClassName(param.getString("runClassName"));
        workflow.setTemporary(param.getBoolean("temporary"));
        workflow.setCaseFormSchema(param.getJSONObject("caseFormSchema"));
        if (param.getJSONObject("runContract") != null) {
            workflow.setRunContract(param.getJSONObject("runContract").to(RunContract.class));
        }
        if (param.getJSONArray("steps") != null) {
            // The request body is bound by the container's own JSON mapper, so the array's elements are
            // plain maps rather than JSONObject; convert before reading them as steps.
            workflow.setSteps(param.getJSONArray("steps").stream()
                    .map(step -> JSONObject.from(step).to(WorkflowStep.class)).toList());
        }
        return workflow;
    }

    private static JSONObject renderDirectoryEntry(Workflow workflow) {
        return JSONObject.of("id", workflow.getId(), "name", workflow.getName(),
                "status", workflow.getStatus(), "version", workflow.getVersion());
    }

    private JSONObject render(Workflow workflow) {
        JSONObject result = renderDirectoryEntry(workflow);
        result.put("description", workflow.getDescription());
        result.put("hasDraft", workflow.getHasDraft());
        result.put("runClassName", workflow.getRunClassName());
        result.put("temporary", workflow.getTemporary());
        result.put("caseFormSchema", workflow.getCaseFormSchema());
        result.put("runContract", workflow.getRunContract());
        // Reported so an operator who just activated learns whether the convenient queries were produced.
        result.put("activationNotes", workflow.getActivationNotes());
        result.put("createdBy", workflow.getCreatedBy());
        result.put("reviewedBy", workflowReviewer(workflow));
        result.put("steps", workflow.getSteps() == null ? new JSONArray() : JSONArray.of(workflow.getSteps().toArray()));
        return result;
    }
    private String workflowReviewer(Workflow workflow) {
        // The latest activation event records the review principal.
        return workflow.getId() == null ? null
                : workflowDao.queryLastEventPrincipal(workflow.getId(), Workflow.EVENT_ACTIVATED);
    }

}
