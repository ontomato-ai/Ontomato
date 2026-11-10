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
 * <p>The criteria are the whole-action preconditions: conditions over the parameters and the state of
 * the object they identify, evaluated once at the top of the action. They are the only place an action
 * states <em>when</em> it may run, so a caller that passes an object id it does not own is rejected
 * here rather than inside the program.</p>
 *
 * <p>Each condition compares one attribute of the object its {@code objectParameter} names against a
 * value. The value may stay literal, or reference the acting subject as {@code {{account.<field>}}} or
 * {@code {{principal.<attribute>}}} — that reference is what makes "only my own report" expressible,
 * because it reads the subject from the authenticated request and never from the caller's parameters.</p>
 *
 * <p>Conditions the author declared {@code unrepresentable} stay in the program; they are not evaluated
 * here and never silently treated as satisfied.</p>
 */
@Service
public class ActionPreconditionService {

    /** The criteria of an action whose preconditions hold, or an empty result when it declares none. */
    public record Verdict(boolean satisfied, List<String> violations, List<Proven> proven) {
        static Verdict pass() {
            return new Verdict(true, List.of(), List.of());
        }

        /** A verdict that carries no proof: every caller that only asks "held or not" keeps working. */
        public Verdict(boolean satisfied, List<String> violations) {
            this(satisfied, violations, List.of());
        }
    }

    /**
     * One object this evaluation actually read and found in the state the action declared.
     *
     * <p>This is the server's own reading, not the caller's claim: the identification came from the
     * parameters, but every condition the author declared about it had to hold against stored state.
     * That is what lets a program be told "this is the run you are working on" without trusting a
     * parameter it could have made up — the pair is recorded only when the row proved out.</p>
     */
    public record Proven(String className, String objectId) {}

    private final DslService queries;
    private final AdminService admin;
    private final SubjectAttributeLookup subjects;

    public ActionPreconditionService(
            DslService queries, AdminService admin, SubjectAttributeLookup subjects) {
        this.queries = queries;
        this.admin = admin;
        this.subjects = subjects;
    }

    /**
     * Evaluate every condition of the action against the parameters it was called with.
     *
     * @throws ServiceException when a declared condition cannot be evaluated at all (unknown class or
     *     attribute, unreadable object state); a condition that evaluates to false is a violation, not an
     *     error
     */
    public Verdict evaluate(
            Action action, JSONObject parameters, User user, UserDataPermission permission) {
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
        List<Proven> proven = new ArrayList<>();
        for (Object value : conditions) {
            JSONObject condition = JSONObject.from(value);
            if (!holds(condition, parameters, user, permission, classDefs, domainId)) {
                violations.add(message(condition));
                continue;
            }
            proven.add(proven(condition, parameters, classDefs));
        }
        if (!violations.isEmpty()) return new Verdict(false, List.copyOf(violations));
        List<Proven> distinct = new ArrayList<>();
        for (Proven item : proven) {
            if (item != null && !distinct.contains(item)) distinct.add(item);
        }
        return new Verdict(true, List.of(), List.copyOf(distinct));
    }

    /** The object one satisfied condition was about, or null when it names none this evaluation read. */
    private Proven proven(
            JSONObject condition, JSONObject parameters, List<Map<String, Object>> classDefs) {
        String className = normalize(condition.getString("className"), classDefs);
        Object identification =
                parameters == null ? null : parameters.get(condition.getString("objectParameter"));
        if (className == null || identification == null) return null;
        return new Proven(className, String.valueOf(identification));
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
            String domainId) {
        String objectParameter = condition.getString("objectParameter");
        String className = normalize(condition.getString("className"), classDefs);
        String field = condition.getString("field");
        String operator = operator(condition.getString("operator"));
        if (className == null || field == null || operator == null) return false;

        Object expected = subjectValue(condition.get("value"), user);
        Object identification = parameters == null ? null : parameters.get(objectParameter);
        if (identification == null) return false;

        Map<String, Object> classDef = classDef(classDefs, className);
        if (classDef == null) {
            throw new ServiceException(
                    "Precondition names an unknown class: " + condition.getString("className"));
        }
        String primaryKey = DslUtil.getPrimaryKey(classDef);

        List<Object> rows =
                readState(className, primaryKey, identification, field, permission, user, domainId);
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
            String domainId) {
        JSONObject dsl = selection(className, primaryKey, identification, field);
        Map<String, Object> result = queries.executeInternal(dsl, permission, user);
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

    /** A declared value, with subject references resolved from the authenticated request. */
    private Object subjectValue(Object declared, User user) {
        if (declared instanceof String text) {
            return isSubjectReference(text) ? resolveReference(text, user) : text;
        }
        if (declared instanceof List<?> items) {
            List<Object> resolved = new ArrayList<>(items.size());
            for (Object item : items) resolved.add(subjectValue(item, user));
            return resolved;
        }
        return declared;
    }

    /**
     * Whether a value is exactly one {@code {{source.attribute}}} reference. A reference inside longer
     * text is a template, not a subject value; comparing a template is never what "only my own report"
     * means, so it stays literal.
     */
    private boolean isSubjectReference(String text) {
        return SubjectReference.parse(text) != null;
    }

    /**
     * Resolve a subject reference. A subject that has no such attribute or has cleared it yields null,
     * which can never equal an object value: an unresolvable reference must not turn into a match.
     */
    private Object resolveReference(String text, User user) {
        SubjectReference.Parsed reference = SubjectReference.parse(text);
        return reference == null ? text : subjects.attribute(user, reference.source(), reference.attribute());
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
