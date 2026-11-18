package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.bean.workflow.RunContract;
import io.ontomato.dataengine.bean.workflow.WorkflowStep;

class WorkflowPendingQueryTest {

    @Test
    void statusAsStepFieldDoesNotAnchorOnStepName() {
        RunContract contract = contract("status", "status");
        WorkflowStep step = step(1, "院系负责人审批");

        JSONObject predicate = WorkflowPendingQuery.pendingPredicate(
                contract, null, List.of(step), Map.of(1, CapabilityGrantLookup.Admission.ALL));

        String json = predicate.toJSONString();
        assertFalse(json.contains("院系负责人审批"), json);
        assertTrue(json.contains("离职审批中"), json);
    }

    @Test
    void distinctStepFieldStillAnchorsOnStepName() {
        RunContract contract = contract("current_node", "status");
        WorkflowStep step = step(1, "院系负责人审批");

        JSONObject predicate = WorkflowPendingQuery.pendingPredicate(
                contract, null, List.of(step), Map.of(1, CapabilityGrantLookup.Admission.ALL));

        String json = predicate.toJSONString();
        assertTrue(json.contains("院系负责人审批"), json);
        assertTrue(json.contains("离职审批中"), json);
    }

    @Test
    void noAdmissionStaysInert() {
        RunContract contract = contract("status", "status");
        WorkflowStep step = step(1, "院系负责人审批");

        JSONObject predicate = WorkflowPendingQuery.pendingPredicate(
                contract, null, List.of(step), Map.of());

        String json = predicate.toJSONString();
        assertTrue(json.contains("\"operator\":\"is\""), json);
        assertTrue(json.contains("\"operator\":\"is not\""), json);
    }

    private static RunContract contract(String stepField, String statusField) {
        RunContract contract = new RunContract();
        contract.setClassName("person");
        contract.setIdField("id");
        contract.setStepField(stepField);
        contract.setStatusField(statusField);
        contract.setStatusOpen(List.of("在职", "离职审批中", "待人事确认"));
        return contract;
    }

    private static WorkflowStep step(int no, String name) {
        WorkflowStep step = new WorkflowStep();
        step.setStepNo(no);
        step.setName(name);
        return step;
    }
}
