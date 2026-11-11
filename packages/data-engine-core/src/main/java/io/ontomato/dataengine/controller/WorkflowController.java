package io.ontomato.dataengine.controller;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.bean.workflow.RunContract;
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.bean.workflow.WorkflowStep;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.WorkflowDao;
import io.ontomato.dataengine.service.CapabilityGrantQuery;
import io.ontomato.dataengine.service.PlatformAccessQuery;
import io.ontomato.dataengine.service.SubjectDirectory;
import io.ontomato.dataengine.service.WorkflowService;
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
public class WorkflowController {

    @Autowired
    private WorkflowService workflowService;

    @Autowired
    private WorkflowDao workflowDao;

    @Autowired
    private CapabilityGrantQuery grants;

    @Autowired
    private PlatformAccessQuery platformAccess;

    @Autowired
    private SubjectDirectory subjects;

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
        } catch (Exception e) {
            log.error(e.getMessage(), e);
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }

    @PostMapping("/workflow/activate")
    @ResponseBody
    public JSONObject activate(@RequestBody JSONObject param) {
        JSONObject ret = new JSONObject();
        try {
            User user = SystemUtils.getCurUser();
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
        JSONObject ret = new JSONObject();
        try {
            User user = SystemUtils.getCurUser();
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
        } catch (Exception e) {
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
    @PostMapping("/workflow/subjects")
    @ResponseBody
    public JSONObject subjects() {
        JSONObject ret = new JSONObject();
        try {
            User user = SystemUtils.getCurUser();
            JSONArray data = new JSONArray();
            for (SubjectDirectory.Subject subject : subjects.subjectsInDomain(user.getDomainId())) {
                JSONObject item = new JSONObject();
                item.put("id", subject.id());
                item.put("loginCode", subject.loginCode());
                item.put("displayName", subject.displayName());
                item.put("roleIds", JSONArray.of(subject.roleIds().toArray()));
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
     * Which roles may perform platform operations here, and which operations.
     *
     * <p>Answers "which role may create a workflow" from the same chain the request interceptor
     * enforces, so the cross-layer graph can draw role-to-workflow authority without claiming a
     * permission the platform does not actually check.</p>
     */
    @PostMapping("/workflow/platform-access")
    @ResponseBody
    public JSONObject platformAccess() {
        JSONObject ret = new JSONObject();
        try {
            User user = SystemUtils.getCurUser();
            JSONArray data = new JSONArray();
            for (PlatformAccessQuery.RoleAccess role : platformAccess.rolesInDomain(user.getDomainId())) {
                JSONObject item = new JSONObject();
                item.put("roleId", role.roleId());
                item.put("roleCode", role.roleCode());
                item.put("apiPermissions", JSONArray.of(role.apiPermissions().toArray()));
                // A management role holds every enabled operation by rule, so its listed paths are empty
                // by design; the flag is what lets a reader know it may still author.
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
    public JSONObject grants() {
        JSONObject ret = new JSONObject();
        try {
            User user = SystemUtils.getCurUser();
            JSONArray data = new JSONArray();
            for (CapabilityGrantQuery.Grant grant : grants.grantsInDomain(user.getDomainId())) {
                JSONObject item = new JSONObject();
                item.put("roleId", grant.roleId());
                item.put("roleCode", grant.roleCode());
                item.put("capabilityKind", grant.capabilityKind());
                item.put("capabilityId", grant.capabilityId());
                item.put("capabilityVersion", grant.capabilityVersion());
                item.put("workflowId", grant.workflowId());
                item.put("stepNo", grant.stepNo());
                item.put("scope", grant.scope());
                item.put("activatedByWorkflowVersion", grant.activatedByWorkflowVersion());
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

    @PostMapping("/workflow/query")
    @ResponseBody
    public JSONObject query(@RequestBody JSONObject param) {
        JSONObject ret = new JSONObject();
        try {
            User user = SystemUtils.getCurUser();
            if (param.getString("id") != null) {
                Workflow workflow = workflowService.queryById(param.getString("id"), user.getDomainId());
                ret.put("success", true);
                ret.put("data", workflow == null ? null : render(workflow));
            } else {
                List<Workflow> workflows =
                        workflowService.queryList(param.getString("status"), user.getDomainId());
                JSONArray data = new JSONArray();
                for (Workflow workflow : workflows) data.add(render(workflow));
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

    private Workflow parse(JSONObject param) {
        Workflow workflow = new Workflow();
        workflow.setId(param.getString("id"));
        workflow.setName(param.getString("name"));
        workflow.setDescription(param.getString("description"));
        workflow.setRunClassName(param.getString("runClassName"));
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

    private JSONObject render(Workflow workflow) {
        JSONObject result = new JSONObject();
        result.put("id", workflow.getId());
        result.put("name", workflow.getName());
        result.put("description", workflow.getDescription());
        result.put("status", workflow.getStatus());
        result.put("version", workflow.getVersion());
        result.put("runClassName", workflow.getRunClassName());
        result.put("runContract", workflow.getRunContract());
        // Reported so an operator who just activated learns whether the convenient queries were produced.
        result.put("activationNotes", workflow.getActivationNotes());
        result.put("createdBy", workflow.getCreatedBy());
        // Activation is this object's review moment and the events are its record, so the reviewer is
        // the principal on the most recent Activated row rather than a second stored copy.
        result.put("reviewedBy", workflow.getId() == null
                ? null
                : workflowDao.queryLastEventPrincipal(workflow.getId(), Workflow.EVENT_ACTIVATED));
        result.put("steps", workflow.getSteps() == null ? new JSONArray() : JSONArray.of(workflow.getSteps().toArray()));
        return result;
    }
}
