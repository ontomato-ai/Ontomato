package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.core.exception.ServiceException;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DslUtil;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Evaluates an Action's {@code submissionCriteria} before the program runs.
 *
 * <p>These conditions compare stored business state with literal values. Authority over the
 * declared target belongs to capability grants and is checked before evaluating these conditions.</p>
 *
 * <p>Conditions the author declared {@code unrepresentable} stay in the program; they are not evaluated
 * here and never silently treated as satisfied.</p>
 */
@Service
public class ActionPreconditionService {

    /** The criteria of an action whose preconditions hold, or an empty result when it declares none. */
    public record Verdict(boolean satisfied, List<String> violations) {
        static Verdict pass() { return new Verdict(true, List.of()); }
    }

    /** Audience restrictions belong to grants, never to business-state conditions. */
    public static void requireBusinessConditions(JSONObject criteria) {
        if (criteria == null || criteria.getJSONArray("conditions") == null) return;
        var conditions = criteria.getJSONArray("conditions");
        for (int i = 0; i < conditions.size(); i++) {
            var condition = conditions.getJSONObject(i);
            if (hasSubject(condition.get("value")))
                throw new IllegalArgumentException("submissionCriteria.conditions[" + i + "].value (" + condition.getString("field")
                        + "): move the current-user comparison to an Action grant scope");
        }
    }

    private static boolean hasSubject(Object value) {
        if (value instanceof List<?> items) return items.stream().anyMatch(ActionPreconditionService::hasSubject);
        return value instanceof String text && SubjectReference.parse(text) != null;
    }

    private final DslService queries;
    private final OntologyQueryService scopedQueries;
    private final AdminService admin;

    public ActionPreconditionService(
            DslService queries, AdminService admin, OntologyQueryService scopedQueries) {
        this.scopedQueries = scopedQueries;
        this.queries = queries;
        this.admin = admin;
    }

    /**
     * Evaluate every condition of the action against the parameters it was called with.
     *
     * @throws ServiceException when a declared condition cannot be evaluated at all (unknown class or
     *     attribute, unreadable object state); a condition that evaluates to false is a violation, not an
     *     error
     */
    public Verdict evaluate(
            Action action, JSONObject parameters, User user, UserDataPermission permission, ExecutionTarget target) {
        JSONObject criteria = action.getSubmissionCriteria();
        if (criteria == null || criteria.isEmpty()) return Verdict.pass();

        JSONArray conditions = criteria.getJSONArray("conditions");
        if (conditions == null || conditions.isEmpty()) return Verdict.pass();

        String domainId = user.getDomainId();
        Map<String, Object> jsonRule = admin.getJSONRule(domainId);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> classDefs =
                (List<Map<String, Object>>) jsonRule.get("classDef");

        List<String> violations = new ArrayList<>();
        for (Object value : conditions) {
            JSONObject condition = JSONObject.from(value);
            if (!holds(condition, parameters, user, permission, classDefs, target)) {
                violations.add(message(condition));
            }
        }
        return new Verdict(violations.isEmpty(), List.copyOf(violations));
    }

    /**
     * Whether one condition holds. Any unreadable state counts as not holding: a precondition that cannot
     * be proved must not let the action through.
     */
    private boolean holds(
            JSONObject condition,
            JSONObject parameters,
            User user,
            UserDataPermission permission,
            List<Map<String, Object>> classDefs,
            ExecutionTarget target) {
        String objectParameter = condition.getString("objectParameter");
        String className = normalize(condition.getString("className"), classDefs);
        String field = condition.getString("field");
        String operator = operator(condition.getString("operator"));
        if (className == null || field == null || operator == null) return false;

        Object expected = condition.get("value");
        Object identification = parameters == null ? null : parameters.get(objectParameter);
        if (identification == null) return false;

        Map<String, Object> classDef = classDef(classDefs, className);
        if (classDef == null) {
            throw new ServiceException(
                    "Precondition names an unknown class: " + condition.getString("className"));
        }
        String primaryKey = DslUtil.getPrimaryKey(classDef);

        List<Object> rows =
                readState(className, primaryKey, identification, field, permission, user, target);
        if (rows.isEmpty()) return false;
        Object actual = rows.get(0);
        return compare(actual, operator, expected);
    }

    /** The object state the condition compares against, read through the same permission as any query. */
    private List<Object> readState(
            String className,
            String primaryKey,
            Object identification,
            String field,
            UserDataPermission permission,
            User user,
            ExecutionTarget target) {
        JSONObject dsl = selection(className, primaryKey, identification, field);
        Map<String, Object> result = target.testing()
                ? scopedQueries.execute(dsl, new QueryAccessService.Access(user, permission, null, null, null).withTarget(target))
                : queries.executeInternal(dsl, permission, user);
        JSONArray data = JSON.parseObject(JSON.toJSONString(result)).getJSONArray("data");
        if (data == null || data.isEmpty()) return List.of();
        JSONArray answer = data.getJSONObject(0).getJSONArray("answer");
        if (answer == null) return List.of();
        List<Object> values = new ArrayList<>(answer.size());
        for (Object row : answer) {
            JSONObject object = JSONObject.from(row);
            values.add(object.get(field));
        }
        return values;
    }

    private JSONObject selection(
            String className, String primaryKey, Object identification, String field) {
        JSONObject object = new JSONObject();
        object.put("idx", 0);
        object.put("variable", "o");
        object.put("class", className);
        object.put(
                "conditions",
                JSONObject.of(
                        "properties",
                        JSONObject.of(
                                "field", primaryKey, "operator", "=", "value", identification)));

        JSONObject pattern = new JSONObject();
        pattern.put("objects", JSONArray.of(object));
        pattern.put("pattern_logic", "and");

        JSONObject output = new JSONObject();
        output.put("to_user", true);
        output.put(
                "fields",
                JSONArray.of(JSONObject.of("variable", "o", "field", field, "as", field)));

        JSONObject step = new JSONObject();
        step.put(
                "graph",
                JSONObject.of("patterns", JSONArray.of(pattern), "pattern_logic", "and"));
        step.put("output", output);

        return JSONObject.of(
                "problem",
                "",
                "answer",
                JSONObject.of("steps", JSONArray.of(step)));
    }

    /**
     * Compare one object attribute with the expected value under SQL's three-valued logic: a null on
     * either side satisfies only {@code is} / {@code is not}, exactly as a NULL does in a query.
     */
    private boolean compare(Object actual, String operator, Object expected) {
        if ("is".equals(operator)) return actual == null;
        if ("is not".equals(operator)) return actual != null;
        if (actual == null || expected == null) return false;

        if (expected instanceof List<?> options) {
            boolean contained = options.stream().anyMatch(option -> equal(actual, option));
            if ("in".equals(operator)) return contained;
            if ("not in".equals(operator)) return !contained;
            return false;
        }

        return switch (operator) {
            case "=" -> equal(actual, expected);
            case "!=" -> !equal(actual, expected);
            case ">", ">=", "<", "<=" -> ordered(actual, operator, expected);
            case "like" -> like(actual, expected);
            default -> false;
        };
    }

    /** Text-or-number equality; a number compares numerically with a numeric string. */
    private boolean equal(Object actual, Object expected) {
        if (actual == null || expected == null) return false;
        if (actual.equals(expected)) return true;
        Double left = number(actual);
        Double right = number(expected);
        return left != null && right != null && left.doubleValue() == right.doubleValue();
    }

    private boolean ordered(Object actual, String operator, Object expected) {
        Double left = number(actual);
        Double right = number(expected);
        if (left != null && right != null) {
            return switch (operator) {
                case ">" -> left > right;
                case ">=" -> left >= right;
                case "<" -> left < right;
                case "<=" -> left <= right;
                default -> false;
            };
        }
        int comparison = String.valueOf(actual).compareTo(String.valueOf(expected));
        return switch (operator) {
            case ">" -> comparison > 0;
            case ">=" -> comparison >= 0;
            case "<" -> comparison < 0;
            case "<=" -> comparison <= 0;
            default -> false;
        };
    }

    private boolean like(Object actual, Object expected) {
        String pattern = String.valueOf(expected);
        StringBuilder regex = new StringBuilder();
        for (char c : pattern.toCharArray()) {
            if (c == '%') regex.append(".*");
            else if (c == '_') regex.append('.');
            else regex.append(java.util.regex.Pattern.quote(String.valueOf(c)));
        }
        return String.valueOf(actual).matches(regex.toString());
    }

    private Double number(Object value) {
        if (value instanceof Number number) return number.doubleValue();
        if (value instanceof String text && !text.isBlank()) {
            try {
                return Double.valueOf(text.trim());
            } catch (NumberFormatException invalid) {
                return null;
            }
        }
        return null;
    }

    /** The message a violation reports; the author supplies it, otherwise it names the failed check. */
    private String message(JSONObject condition) {
        String declared = condition.getString("message");
        if (declared != null && !declared.isBlank()) return declared;
        return "Precondition failed: "
                + condition.getString("className")
                + "."
                + condition.getString("field")
                + " "
                + condition.getString("operator")
                + " "
                + condition.get("value");
    }

    /** The declared operator in DSL spelling; unknown spellings never silently pass. */
    private String operator(String declared) {
        if (declared == null) return null;
        String normalized = declared.trim().toLowerCase(java.util.Locale.ROOT);
        return switch (normalized) {
            case "=", "==", "eq", "is" -> normalized.equals("is") ? "is" : "=";
            case "!=", "<>", "ne", "is not" -> normalized.equals("is not") ? "is not" : "!=";
            case ">", ">=", "<", "<=" -> normalized;
            case "in" -> "in";
            case "not in" -> "not in";
            case "like" -> "like";
            default -> null;
        };
    }

    private String normalize(String className, List<Map<String, Object>> classDefs) {
        if (className == null) return null;
        return io.ontomato.dataengine.util.DBSchemaUtil.normalizeClassName(className, classDefs);
    }

    private Map<String, Object> classDef(
            List<Map<String, Object>> classDefs, String className) {
        if (classDefs == null) return null;
        for (Map<String, Object> classDef : classDefs) {
            if (className != null && className.equals(classDef.get("className"))) return classDef;
        }
        return null;
    }
}
