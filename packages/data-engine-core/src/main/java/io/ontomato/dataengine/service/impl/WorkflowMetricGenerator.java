package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewBinding;
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

    /** The same pointer when the query has more than one condition, which nests them under {@code and}. */
    private static final String FIRST_OF_AND_POINTER =
            "/answer/steps/0/graph/patterns/0/objects/0/conditions/properties/and/0/value";

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
     * <p>Idempotent by name: activating again updates the same two metrics instead of accumulating a new
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

        if (contract.getAssigneeField() == null) {
            // Without an owner field there is no "mine"; generating one would query everyone's work.
            warnings.add("运行契约未声明 assigneeField，未生成「我的待办」");
        } else {
            try {
                names.add(upsert(existing, myPending(workflow, contract, labels)));
            } catch (Exception error) {
                warnings.add("「我的待办」生成失败: " + error.getMessage());
            }
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
        // Owner and state together: the owner alone would also list runs already finished.
        JSONArray conditions = JSONArray.of(
                condition(contract.getAssigneeField(), "=", "{{account.id}}"),
                JSONObject.of(
                        "field", contract.getStatusField(),
                        "operator", "in",
                        "value", JSONArray.of(contract.getStatusOpen().toArray())));
        JSONObject dsl = dsl(contract, conditions);
        JSONObject packageBundle = packageBundle(
                contract, "assignee", "{{account.id}}", "当前登录人", FIRST_OF_AND_POINTER, dsl);

        return metric(
                workflow.getDomainId(),
                "我的待办 · " + workflow.getName(),
                "当前登录人名下仍处于待办状态的" + workflow.getName() + "，按当前节点与状态列出。",
                "我有什么待办",
                List.of("我有什么待办", "我的待办", "待办列表", "我还有哪些要处理", workflow.getName()),
                packageBundle,
                labels,
                binding("我的待办", "assignee", "{{account.id}}"));
    }

    private MetricView runById(Workflow workflow, RunContract contract, Map<String, String> labels) {
        JSONObject dsl = dsl(contract, JSONArray.of(condition(contract.getIdField(), "=", "{{runId}}")));
        JSONObject packageBundle =
                packageBundle(contract, "runId", "", "单据主键", CONDITION_VALUE_POINTER, dsl);

        return metric(
                workflow.getDomainId(),
                "单据详情 · " + workflow.getName(),
                "按主键查看" + workflow.getName() + "的一张单据的当前节点与状态。",
                "这张单现在到哪一步了",
                List.of("这张单到什么状态了", "查单据进度", "单据详情", workflow.getName()),
                packageBundle,
                labels,
                // No binding: the caller supplies the id, and no subject value is involved.
                null);
    }

    /** One DSL step over the run class, projected to the contract's four readable fields. */
    private JSONObject dsl(RunContract contract, JSONArray conditions) {
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
                        "fields", fields(contract),
                        "limit", JSONObject.of("offset", 0, "count", 200)));
        return JSONObject.of(
                "problem", "",
                "answer", JSONObject.of("steps", JSONArray.of(step)));
    }

    /**
     * The query package: a DSL file plus one parameter bound into its condition value.
     *
     * <p>The bound value is either a literal the caller supplies ({@code runId}) or a subject reference
     * the server fills ({@code {{account.id}}}). Either way it arrives as a parameter, because that is
     * the only path the platform substitutes — and a subject reference there is resolved by the server,
     * never by the caller.</p>
     */
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

    /** The projected fields, in reading order and without duplicates. */
    private JSONArray fields(RunContract contract) {
        Set<String> names = new LinkedHashSet<>();
        names.add(contract.getIdField());
        names.add(contract.getStepField());
        names.add(contract.getStatusField());
        if (contract.getAssigneeField() != null) names.add(contract.getAssigneeField());

        JSONArray fields = new JSONArray();
        for (String name : names) {
            if (name == null) continue;
            fields.add(JSONObject.of("variable", "r", "field", name, "as", name));
        }
        return fields;
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
            Map<String, String> labels,
            MetricViewBinding binding) {
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
        metric.setBindings(binding == null ? new ArrayList<>() : new ArrayList<>(List.of(binding)));
        return metric;
    }

    private MetricViewBinding binding(String name, String parameter, String value) {
        MetricViewBinding binding = new MetricViewBinding();
        binding.setName(name);
        binding.setParameters(JSONObject.of(parameter, value));
        binding.setMatchQuestions(new LinkedHashSet<>(List.of(name)));
        return binding;
    }

    /** Update the same metric when it exists, so activation is idempotent rather than additive. */
    private String upsert(List<MetricView> existing, MetricView metric) throws Exception {
        MetricView same = existing.stream()
                .filter(candidate -> metric.getName().equals(candidate.getName()))
                .findFirst()
                .orElse(null);
        if (same != null) {
            metric.setId(same.getId());
            if (same.getFunction() != null) metric.getFunction().setId(same.getFunction().getId());
            if (!metric.getBindings().isEmpty()
                    && same.getBindings() != null
                    && !same.getBindings().isEmpty()) {
                metric.getBindings().get(0).setId(same.getBindings().get(0).getId());
            }
        }
        MetricView saved = metrics.save(metric, LANG);
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
