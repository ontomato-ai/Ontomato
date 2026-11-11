package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.workflow.RunContract;
import io.ontomato.dataengine.util.DslPermissionUtil;
import java.util.LinkedHashSet;
import java.util.Set;

/** The stored projections of a workflow run; the pending projection alone is inert without an actor. */
public final class WorkflowRunQueries {
    private WorkflowRunQueries() {}
    public static JSONObject pendingPackage(RunContract contract) {
        return QueryPackage.fromDsl(dsl(contract, JSONArray.of(DslPermissionUtil.alwaysFalse(contract.getIdField())), false)
                .toJSONString(com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue));
    }

    public static JSONObject dsl(RunContract contract, JSONArray conditions, boolean includeAssignee) {
        JSONObject properties = conditions.size() == 1
                ? JSONObject.of("properties", conditions.getJSONObject(0))
                : JSONObject.of("properties", JSONObject.of("operator", "logic", "and", conditions));
        JSONObject object = JSONObject.of(
                "idx", 0,
                "variable", "r",
                "class", contract.getClassName(),
                "conditions", properties);
        JSONObject pattern = JSONObject.of(
                "objects", JSONArray.of(object),
                "pattern_logic", "and");
        JSONObject step = JSONObject.of(
                "graph", JSONObject.of("patterns", JSONArray.of(pattern), "pattern_logic", "and"),
                "output", JSONObject.of(
                        "to_user", true,
                        "fields", fields(contract, includeAssignee),
                        "limit", JSONObject.of("offset", 0, "count", 200)));
        return JSONObject.of(
                "problem", "",
                "answer", JSONObject.of("steps", JSONArray.of(step)));
    }

    /** The projected fields, in reading order and without duplicates. */
    private static JSONArray fields(RunContract contract, boolean includeAssignee) {
        Set<String> names = new LinkedHashSet<>();
        names.add(contract.getIdField());
        names.add(contract.getStepField());
        names.add(contract.getStatusField());
        if (includeAssignee && contract.getAssigneeField() != null) names.add(contract.getAssigneeField());

        JSONArray fields = new JSONArray();
        for (String name : names) {
            if (name == null) continue;
            fields.add(JSONObject.of("variable", "r", "field", name, "as", name));
        }
        return fields;
    }

}
