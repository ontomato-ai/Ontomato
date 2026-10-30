package io.ontomato.dataengine.util;

import java.util.List;
import java.util.Map;

public final class InstanceNameUtil {
    private InstanceNameUtil() {}

    public static String businessKey(Map<String, Object> definition) {
        String first = null;
        if (definition.get("attrs") instanceof List<?> attributes) for (Object raw : attributes) {
            Map<?, ?> attribute = (Map<?, ?>) raw;
            if (Boolean.FALSE.equals(attribute.get("enable")) || !Boolean.TRUE.equals(attribute.get("bizzkey"))) continue;
            String name = (String) attribute.get("name");
            if (first == null) first = name;
            if (name.matches("(?:.*_)?(?:name|title)")) return name;
        }
        return first;
    }

    public static String display(String field, String value) {
        return field == null || value == null || value.isBlank() ? "—" : value;
    }
}
