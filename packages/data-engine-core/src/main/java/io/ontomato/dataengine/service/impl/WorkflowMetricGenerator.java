package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.service.WorkflowRunQueries;
import io.ontomato.dataengine.bean.metricView.MetricView.WorkflowSource;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.workflow.RunContract;
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.MetricViewService;

/**
 * Turns a workflow's declared run contract into the queries its participants need.
 *
 * <p>Without this, every answer to "what are my pending items" is a query an agent improvises from the
 * schema. Improvised queries fail quietly: a misspelt field matches nothing, and "nothing" reads as "you
 * have no pending items". Generating the query once, from a contract the platform verified, removes the
 * improvisation — the agent retrieves a published specification instead of writing one.</p>
 *
 * <p>These are <em>read</em> capabilities, not authority: they convey nothing, and a workflow that stops
 * being active keeps them. They are regenerated on every activation so their steps and statuses follow
 * the revision in force; a stale query naming a step the process no longer has would be worse than none.</p>
 */
@Component
public class WorkflowMetricGenerator {

    /** The locale used for stored labels; the labels themselves are supplied explicitly. */
    private static final String LANG = "zh-CN";

    /** The only pointer shape this generator produces: the first object's first condition value. */
    private static final String CONDITION_VALUE_POINTER =
            "/answer/steps/0/graph/patterns/0/objects/0/conditions/properties/value";

    private final MetricViewService metrics;
    private final AdminService admin;

    public WorkflowMetricGenerator(MetricViewService metrics, AdminService admin) {
        this.metrics = metrics;
        this.admin = admin;
    }

    /** What generation produced, and what it could not. Warnings never stop an activation. */
    public record Generated(List<String> names, List<String> warnings) {}

    /**
     * Generate (or refresh) this workflow's read capabilities.
     *
     * <p>Idempotent by workflow and purpose: activating again updates the same two metrics instead of accumulating a new
     * pair every time. A failure for one metric is reported and the other still proceeds, because losing
     * a convenience query must not cost the process its authority.</p>
     */
    public Generated generate(Workflow workflow) {
        List<String> names = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        RunContract contract = workflow.getRunContract();
        if (contract == null) return new Generated(names, warnings);
        contract.normalized();
        if (contract.getClassName() == null) {
            warnings.add("运行契约未声明类名，未生成查询");
            return new Generated(names, warnings);
        }

        Map<String, String> labels = labels(workflow.getDomainId(), contract);
        List<MetricView> existing = metrics.queryList(null, null, null, workflow.getDomainId());

        try {
            names.add(upsert(existing, myPending(workflow, contract, labels)));
        } catch (Exception error) {
            warnings.add("「我的待办」生成失败: " + error.getMessage());
        }
        try {
            names.add(upsert(existing, runById(workflow, contract, labels)));
        } catch (Exception error) {
            warnings.add("「单据详情」生成失败: " + error.getMessage());
        }
        return new Generated(names, warnings);
    }

    // ---------------------------------------------------------------- the two definitions

    private MetricView myPending(Workflow workflow, RunContract contract, Map<String, String> labels) {
        // A standalone copy of the package has no authenticated workflow grant context.
        var bundle = WorkflowRunQueries.pendingPackage(contract);
        var pendingLabels = new LinkedHashMap<String, String>();
        for (String field : List.of(contract.getIdField(), contract.getStepField(), contract.getStatusField()))
            pendingLabels.put(field, labels.get(field));
        var metric = metric(workflow.getDomainId(), "我的待办 · " + workflow.getName(),
                "当前用户在本流程有权处理的开放单据。", "我有什么待办",
                List.of("我有什么待办", "我的待办", "待办列表", workflow.getName()), bundle, pendingLabels);
        metric.setWorkflowSource(new WorkflowSource(workflow.getId(), workflow.getVersion(), WorkflowSource.Purpose.pending));
        return metric;
    }

    private MetricView runById(Workflow workflow, RunContract contract, Map<String, String> labels) {
        JSONObject dsl = WorkflowRunQueries.dsl(contract, JSONArray.of(condition(contract.getIdField(), "=", "{{runId}}")), true);
        JSONObject packageBundle =
                packageBundle(contract, "runId", "", "单据主键", CONDITION_VALUE_POINTER, dsl);

        var metric = metric(
                workflow.getDomainId(),
                "单据详情 · " + workflow.getName(),
                "按主键查看" + workflow.getName() + "的一张单据的当前节点与状态。",
                "这张单现在到哪一步了",
                List.of("这张单到什么状态了", "查单据进度", "单据详情", workflow.getName()),
                packageBundle,
                labels);
        metric.setWorkflowSource(new WorkflowSource(workflow.getId(), workflow.getVersion(), WorkflowSource.Purpose.detail));
        return metric;
    }

    /** One DSL step over the run class, projected to the contract's four readable fields. */
    /** The detail query binds the caller-supplied object key into its only condition. */
    private JSONObject packageBundle(
            RunContract contract,
            String parameterName,
            String initialValue,
            String description,
            String pointer,
            JSONObject dsl) {
        JSONObject parameterDefinition = JSONObject.of(
                "name", parameterName,
                "type", Parameter.TYPE_STRING,
                "value", initialValue,
                "description", description,
                "classNames", JSONArray.of(contract.getClassName()));
        JSONObject manifest = JSONObject.of(
                "schema", "ontomato.query-package.v1",
                "entry", JSONObject.of("kind", "dsl", "query", "main"),
                "queries", JSONObject.of("main", "query.json"),
                "modules", new JSONArray(),
                "parameterDefs", JSONArray.of(parameterDefinition),
                "parameterBindings", JSONArray.of(
                        JSONObject.of("parameter", parameterName, "query", "main", "pointer", pointer)),
                "computation", null);
        return JSONObject.of(
                "manifest", manifest,
                "files", JSONArray.of(
                        JSONObject.of("path", "query.json", "content", JSONObject.toJSONString(dsl))));
    }

    /** A condition the pointer can target: the leaf is {@code value} on an object that has an operator. */
    private JSONObject condition(String field, String operator, String value) {
        return JSONObject.of("field", field, "operator", operator, "value", value);
    }

    private MetricView metric(
            String domainId,
            String name,
            String description,
            String originQuestion,
            List<String> matchQuestions,
            JSONObject packageBundle,
            Map<String, String> labels) {
        Function function = new Function();
        function.setName(name);
        function.setOperation(Function.OPERATION_READ);
        function.setOrigin(Function.ORIGIN_USER);
        function.setDescription(description);
        function.setQueryPackage(packageBundle);
        ReturnDef returns = new ReturnDef();
        returns.setColumnLabels(new JSONObject(new LinkedHashMap<>(labels)));
        returns.setIsVoid(false);
        function.setReturnDef(returns);

        MetricView metric = new MetricView();
        metric.setDomainId(domainId);
        metric.setName(name);
        metric.setDescription(description);
        metric.setOriginQuestion(originQuestion);
        metric.setStatus(MetricView.STATUS_PUBLISHED);
        metric.setMatchQuestions(new LinkedHashSet<>(matchQuestions));
        metric.setFunction(function);
        metric.setBindings(new ArrayList<>());
        return metric;
    }

    private String upsert(List<MetricView> existing, MetricView metric) throws Exception {
        MetricView same = existing.stream()
                .filter(candidate -> candidate.getWorkflowSource() != null
                        && candidate.getWorkflowSource().workflowId().equals(metric.getWorkflowSource().workflowId())
                        && candidate.getWorkflowSource().purpose() == metric.getWorkflowSource().purpose())
                .findFirst()
                .orElse(null);
        if (same != null) {
            metric.setId(same.getId());
            if (same.getFunction() != null) metric.getFunction().setId(same.getFunction().getId());
        }
        MetricView saved = metrics.publishWorkflowMetric(metric, LANG);
        return saved == null ? metric.getName() : saved.getName();
    }

    /**
     * Readable labels for the projected fields only.
     *
     * <p>The label map must describe exactly the query's output columns: an extra entry fails the
     * package contract, and a missing one leaves a column unlabelled for the agent to guess at.</p>
     */
    private Map<String, String> labels(String domainId, RunContract contract) {
        String className = contract.getClassName();
        Map<String, String> declared = declaredLabels(domainId, className);
        Map<String, String> labels = new LinkedHashMap<>();
        for (String field : List.of(
                contract.getIdField(), contract.getStepField(), contract.getStatusField(),
                contract.getAssigneeField() == null ? contract.getStepField() : contract.getAssigneeField())) {
            if (field == null) continue;
            labels.put(field, declared.getOrDefault(field, field));
        }
        return labels;
    }

    /** Every attribute label the class definition declares. */
    private Map<String, String> declaredLabels(String domainId, String className) {
        Map<String, String> labels = new LinkedHashMap<>();
        Map<String, Object> rule = admin.getJSONRule(domainId);
        if (rule == null || !(rule.get("classDef") instanceof List<?> definitions)) return labels;
        for (Object definition : definitions) {
            if (!(definition instanceof Map<?, ?> candidate)) continue;
            if (!className.equals(candidate.get("className"))) continue;
            if (candidate.get("attrs") instanceof List<?> attrs) {
                for (Object attr : attrs) {
                    if (!(attr instanceof Map<?, ?> field) || field.get("name") == null) continue;
                    Object show = field.get("showName");
                    labels.put(String.valueOf(field.get("name")),
                            show == null ? String.valueOf(field.get("name")) : String.valueOf(show));
                }
            }
            break;
        }
        return labels;
    }
}
