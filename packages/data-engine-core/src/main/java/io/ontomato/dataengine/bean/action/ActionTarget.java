package io.ontomato.dataengine.bean.action;

import java.util.List;
import java.util.Map;
import io.ontomato.dataengine.bean.function.Parameter;

/** One existing object identified by an explicit string parameter of the write function. */
public record ActionTarget(String className, String keyParameter) {
    public void validate(Action action, Map<String, Object> rule) {
        var definition = definition(rule);
        var attrs = (List<Map<String, Object>>) definition.get("attrs");
        if (attrs.stream().filter(a -> !Boolean.FALSE.equals(a.get("enable")) && Boolean.TRUE.equals(a.get("primaryKey"))).count() != 1)
            throw new IllegalArgumentException("Action.target.className requires one primary key: " + className);
        var parameters = action.getFunction().getParameters();
        if (parameters == null || parameters.stream().noneMatch(p -> p.getName().equals(keyParameter) && Parameter.TYPE_STRING.equals(p.getType())))
            throw new IllegalArgumentException("Action.target.keyParameter must name a string parameter: " + keyParameter);
    }

    public Map<String, Object> definition(Map<String, Object> rule) {
        return ((List<Map<String, Object>>) rule.get("classDef")).stream().filter(c -> c.get("className").equals(className))
                .findFirst().orElseThrow(() -> new IllegalArgumentException("Unknown Action.target.className: " + className));
    }

    public String key(Map<String, Object> parameters) {
        if (parameters == null || !(parameters.get(keyParameter) instanceof String key) || key.isBlank())
            throw new IllegalArgumentException("Action.target requires an explicit string value for " + keyParameter);
        return key;
    }
}
