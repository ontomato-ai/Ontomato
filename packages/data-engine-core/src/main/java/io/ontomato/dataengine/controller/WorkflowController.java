package io.ontomato.dataengine.controller;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.bean.workflow.WorkflowStep;
import io.ontomato.dataengine.core.bean.User;
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

    @PostMapping("/workflow/save")
    @ResponseBody
    public JSONObject save(@RequestBody JSONObject param) {
        JSONObject ret = new JSONObject();
        try {
            User user = SystemUtils.getCurUser();
            Workflow workflow = parse(param);
            workflow.setDomainId(user.getDomainId());
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
        result.put("steps", workflow.getSteps() == null ? new JSONArray() : JSONArray.of(workflow.getSteps().toArray()));
        return result;
    }
}
