package io.ontomato.dataengine.util;

import java.util.Set;
import java.util.Map;
import java.util.List;
import java.util.function.Predicate;
import com.alibaba.fastjson2.JSONObject;

/** The write filter contract shared by the public boundary and filter compilers. */
public final class WriteWhereValidator {
    private WriteWhereValidator() {}

    public static JSONObject validate(Object raw, Predicate<String> fieldAllowed) {
        if (!(raw instanceof Map<?, ?> condition) || condition.isEmpty()) {
            throw invalid("must be a non-empty condition object; unconditional writes are forbidden");
        }
        Object operator = condition.get("operator");
        if (condition.containsKey("and") || condition.containsKey("or") || "logic".equals(operator)) {
            String key = condition.containsKey("and") ? "and" : "or";
            if ((operator != null && !"logic".equals(operator))
                    || !Set.of("operator", key).containsAll(condition.keySet())
                    || !(condition.get(key) instanceof List<?> children) || children.isEmpty()) {
                throw invalid("logic requires exactly one non-empty and/or array of conditions");
            }
            for (Object child : children) validate(child, fieldAllowed);
            return JSONObject.from(condition);
        }
        if (!(condition.get("field") instanceof String field) || field.isBlank() || !fieldAllowed.test(field)) {
            throw invalid("field must name an enabled attribute of this class");
        }
        if (!(operator instanceof String op) || !Set.of("=", "!=", ">", ">=", "<", "<=", "like", "between", "in", "is", "is not").contains(op)) {
            throw invalid("unknown or missing operator: " + operator);
        }
        if (!Set.of("field", "operator", "value").containsAll(condition.keySet())) throw invalid("unknown condition structure");
        Object value = condition.get("value");
        switch (op) {
            case "is", "is not" -> {
                if (value != null && !"null".equals(value)) throw invalid("is/is not requires null");
            }
            case "between", "in" -> {
                if (!(value instanceof List<?> values) || values.isEmpty()
                        || (op.equals("between") && values.size() != 2)) throw invalid(op + " requires " + (op.equals("between") ? "two values" : "a non-empty array"));
                for (Object item : values) if (!scalar(item)) throw invalid(op + " requires scalar values");
            }
            case "like" -> { if (!(value instanceof String)) throw invalid("like requires a string value"); }
            default -> { if (!scalar(value)) throw invalid(op + " requires a non-null scalar value"); }
        }
        return JSONObject.from(condition);
    }

    public static void validateStructure(Object raw) {
        validate(raw, field -> true);
    }

    private static boolean scalar(Object value) {
        return value instanceof String || value instanceof Number || value instanceof Boolean;
    }

    private static IllegalArgumentException invalid(String reason) {
        return new IllegalArgumentException("Invalid where: " + reason);
    }
}
