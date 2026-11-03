package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.core.bean.User;
import java.util.*;
import org.springframework.stereotype.Service;

/** Published view capabilities shared by embedded and native application consumers. */
@Service
public class ObjectViewCapabilityService {
    private final ObjectViewStore store;
    private final IdentityService identity;
    private final DataService data;
    private final MetricViewService metrics;
    private final ActionService actions;
    private final BusinessConfigService config;

    public ObjectViewCapabilityService(ObjectViewStore store, IdentityService identity, DataService data, MetricViewService metrics, ActionService actions, BusinessConfigService config) {
        this.store = store; this.identity = identity; this.data = data; this.metrics = metrics; this.actions = actions; this.config = config;
    }

    private JSONObject resolve(JSONObject request) {
        JSONObject view = request.getJSONObject("view");
        if (view == null) throw new IllegalArgumentException("Missing view reference");
        return store.resolve(identity.getCurrentUser().getDomainId(), view.getString("className"), view.getString("form") == null ? "full" : view.getString("form"),
            view.get("revision") == null || "published".equals(view.getString("revision")) ? null : view.getInteger("revision"));
    }

    static Map<String, JSONObject> widgets(JSONObject document) {
        Map<String, JSONObject> result = new LinkedHashMap<>();
        for (Object t : document.getJSONArray("tabs")) for (Object s : ((JSONObject)t).getJSONArray("sections")) for (Object w : ((JSONObject)s).getJSONArray("widgets")) {
            JSONObject widget = (JSONObject)w;
            String key = widget.getString("key") == null ? widget.getString("id") : widget.getString("key");
            result.put(key, widget);
        }
        return result;
    }

    public JSONObject contract(JSONObject request) {
        JSONObject resolved = resolve(request), document = resolved.getJSONObject("document");
        JSONArray regions = new JSONArray(), operations = new JSONArray();
        for (var entry : widgets(document).entrySet()) {
            JSONObject widget = entry.getValue();
            String kind = widget.getString("kind");
            JSONObject item = JSONObject.of("key", entry.getKey(), "label", widget.getString("title"), "kind", kind,
                "fields", widget.getJSONArray("fields"), "fieldLabels", widget.getJSONObject("fieldLabels"), "valueField", widget.getString("valueField"));
            boolean interactive = false;
            JSONObject bindingsForSupport = widget.getJSONObject("parameters");
            if (bindingsForSupport != null) for (String name : bindingsForSupport.keySet()) if ("variable".equals(bindingsForSupport.getJSONObject(name).getString("source"))) interactive = true;
            if (widget.getJSONObject("binding") != null && "variable".equals(widget.getJSONObject("binding").getString("source"))) interactive = true;
            if (widget.getJSONObject("visibleWhen") != null && "variable".equals(widget.getJSONObject("visibleWhen").getJSONObject("binding").getString("source"))) interactive = true;
            item.put("requiresInteractiveState", interactive);
            if ("action".equals(kind)) {
                identity.requireApiPermission("/action/queryById");
                Action action = action(widget.getString("resourceId"));
                JSONArray parameters = new JSONArray();
                JSONObject bindings = widget.getJSONObject("parameters");
                for (Parameter parameter : action.getFunction().getParameters()) {
                    parameters.add(JSONObject.of("name", parameter.getName(), "type", parameter.getType(), "description", parameter.getDescription(),
                        "bound", widget.getJSONArray("readOnlyParameters") != null && widget.getJSONArray("readOnlyParameters").contains(parameter.getName())));
                }
                item.put("parameters", parameters);
                item.put("fieldOptions", widget.getJSONObject("fieldOptions"));
                operations.add(item);
            } else if (Set.of("properties", "metric", "table", "chart", "text").contains(kind)) {
                regions.add(item);
            }
        }
        return JSONObject.of("className", resolved.getString("className"), "form", resolved.getString("form"), "revision", resolved.getInteger("revision"),
            "title", document.getString("title"), "inputs", document.getJSONObject("inputs") == null ? new JSONObject() : document.getJSONObject("inputs"), "regions", regions, "operations", operations);
    }

    private JSONObject object(JSONObject request, JSONObject document, String lang) {
        identity.requireApiPermission("/data/queryInfoByNode");
        JSONObject reference = request.getJSONObject("object");
        String key = reference == null ? null : reference.getString("primaryKey");
        if (key == null || key.isBlank() || key.length() > 2000) throw new IllegalArgumentException("Missing object key");
        String className = document.getString("className");
        JSONObject result = data.queryInfoByNode(JSONObject.of("id", className + ":" + key, "class", className), lang, identity.getCurrentUserDataPermission(), identity.getCurrentUser().getDomainId());
        if (!Boolean.TRUE.equals(result.getBoolean("success"))) throw new IllegalArgumentException(result.getString("message"));
        JSONObject info = result.getJSONObject("data"), object = info.getJSONObject("data");
        JSONArray attrs = info.getJSONObject("classDef").getJSONArray("attrs");
        for (Object raw : attrs) {
            JSONObject attr = (JSONObject)raw;
            if (Boolean.TRUE.equals(attr.getBoolean("primaryKey"))) object.put(attr.getString("name"), key);
        }
        return object;
    }

    static Object path(Object value, String path) {
        if (path == null || path.isEmpty()) return value;
        for (String key : path.split("\\.")) {
            if (Set.of("__proto__", "prototype", "constructor").contains(key)) throw new IllegalArgumentException("Invalid binding path");
            if (value instanceof Map<?, ?> map) value = map.get(key);
            else if (value instanceof List<?> list && key.matches("[0-9]+")) { int index = Integer.parseInt(key); value = index < list.size() ? list.get(index) : null; }
            else return null;
        }
        return value;
    }

    static JSONObject inputs(JSONObject document, JSONObject supplied) {
        JSONObject definitions = document.getJSONObject("inputs"), result = new JSONObject();
        if (definitions == null) definitions = new JSONObject();
        if (supplied == null) supplied = new JSONObject();
        for (String key : supplied.keySet()) if (!definitions.containsKey(key)) throw new IllegalArgumentException("Unknown view input: " + key);
        for (String key : definitions.keySet()) {
            JSONObject definition = definitions.getJSONObject(key);
            Object value = supplied.containsKey(key) ? supplied.get(key) : definition.get("default");
            if (value == null && Boolean.TRUE.equals(definition.getBoolean("required"))) throw new IllegalArgumentException("Missing view input: " + key);
            if (value != null && !("string".equals(definition.getString("type")) && value instanceof String || "number".equals(definition.getString("type")) && value instanceof Number || "boolean".equals(definition.getString("type")) && value instanceof Boolean)) throw new IllegalArgumentException("Invalid view input: " + key);
            if (value != null && definition.getJSONArray("enum") != null && !definition.getJSONArray("enum").contains(value)) throw new IllegalArgumentException("Invalid view input: " + key);
            result.put(key, value);
        }
        return result;
    }

    static Object binding(JSONObject binding, JSONObject object, JSONObject inputs) {
        if (binding == null) return null;
        return switch (binding.getString("source")) {
            case "literal" -> binding.get("value");
            case "object" -> path(object, binding.getString("path"));
            case "input" -> path(inputs, binding.getString("path"));
            default -> throw new IllegalArgumentException("This capability requires interactive view state");
        };
    }

    static JSONObject parameters(JSONObject widget, JSONObject object, JSONObject inputs, JSONObject supplied) {
        JSONObject result = new JSONObject(), bindings = widget.getJSONObject("parameters");
        JSONArray lockedNames = widget.getJSONArray("readOnlyParameters");
        if (lockedNames != null) for (Object name : lockedNames) if (bindings == null || !bindings.containsKey(String.valueOf(name))) throw new IllegalArgumentException("Read-only parameter has no binding: " + name);
        if (supplied != null) result.putAll(supplied);
        if (bindings != null) for (String key : bindings.keySet()) {
            boolean locked = widget.getJSONArray("readOnlyParameters") != null && widget.getJSONArray("readOnlyParameters").contains(key);
            if (result.containsKey(key) && locked) throw new IllegalArgumentException("Cannot override a bound parameter: " + key);
            if (!result.containsKey(key)) result.put(key, binding(bindings.getJSONObject(key), object, inputs));
        }
        return result;
    }

    static void visible(JSONObject widget, JSONObject object, JSONObject inputs) {
        JSONObject condition = widget.getJSONObject("visibleWhen");
        if (condition == null) return;
        Object value = binding(condition.getJSONObject("binding"), object, inputs);
        boolean empty = value == null || "".equals(value);
        String actual = value == null ? "" : String.valueOf(value), expected = condition.getString("value") == null ? "" : condition.getString("value");
        boolean visible = switch (condition.getString("operator")) {
            case "present" -> !empty;
            case "empty" -> empty;
            case "eq" -> actual.equals(expected);
            case "ne" -> !actual.equals(expected);
            default -> false;
        };
        if (!visible) throw new IllegalArgumentException("Capability is not visible for this context");
    }

    private int timeout(User user) { return Math.max(1, (int)(config.get(user.getDomainId()).getDslCookerTimeout() / 60000)); }

    public JSONObject read(JSONObject request, String lang) throws Exception {
        JSONObject resolved = resolve(request), document = resolved.getJSONObject("document"), suppliedInputs = inputs(document, request.getJSONObject("inputs"));
        JSONObject object = object(request, document, lang);
        JSONArray keys = request.getJSONArray("regions");
        if (keys == null || keys.isEmpty() || keys.size() > 30) throw new IllegalArgumentException("Request between 1 and 30 region keys");
        Map<String, JSONObject> widgets = widgets(document);
        JSONObject results = new JSONObject();
        Map<String, JSONObject> cache = new HashMap<>();
        for (Object raw : keys) {
            String key = String.valueOf(raw);
            JSONObject widget = widgets.get(key);
            if (widget == null || "action".equals(widget.getString("kind"))) throw new IllegalArgumentException("Unknown read region: " + key);
            try {
                visible(widget, object, suppliedInputs);
                JSONObject result = new JSONObject();
                String kind = widget.getString("kind");
                if ("properties".equals(kind)) {
                    JSONObject values = new JSONObject();
                    JSONArray fields = widget.getJSONArray("fields");
                    if (fields == null || fields.isEmpty()) values.putAll(object);
                    else for (Object field : fields) if (object.containsKey(String.valueOf(field))) values.put(String.valueOf(field), object.get(String.valueOf(field)));
                    result.put("value", values);
                } else if (Set.of("metric", "table", "chart").contains(kind) && widget.getString("resourceId") != null && !widget.getString("resourceId").isBlank()) {
                    identity.requireApiPermission("/metricView/execute");
                    String id = widget.getString("resourceId");
                    MetricView metric = metrics.queryById(id);
                    if (metric == null || !identity.getCurrentUser().getDomainId().equals(metric.getDomainId()) || !MetricView.STATUS_PUBLISHED.equals(metric.getStatus())) throw new IllegalArgumentException("MetricView is unavailable");
                    JSONObject params = parameters(widget, object, suppliedInputs, null);
                    String cacheKey = id + params.toJSONString();
                    JSONObject execution = cache.get(cacheKey);
                    if (execution == null) {
                        Object[] executed = metrics.execute(id, params, lang, identity.getCurrentUser(), identity.getCurrentUserDataPermission(), timeout(identity.getCurrentUser()));
                        execution = JSONObject.of("value", executed[0]);
                        ((PythonExecuteResult)executed[1]).markCompleteness(execution);
                        cache.put(cacheKey, execution);
                    }
                    result.putAll(execution);
                    result.put("value", path(execution.get("value"), widget.getString("resultPath")));
                } else if ("text".equals(kind)) result.put("value", widget.getJSONObject("binding") == null ? widget.getString("text") : binding(widget.getJSONObject("binding"), object, suppliedInputs));
                else throw new IllegalArgumentException("This region requires the interactive runtime");
                result.put("success", true);
                results.put(key, result);
            } catch (Exception error) { results.put(key, JSONObject.of("success", false, "message", error.getMessage())); }
        }
        return JSONObject.of("revision", resolved.getInteger("revision"), "regions", results);
    }

    private Action action(String id) {
        Action action = actions.queryById(id);
        if (action == null || !identity.getCurrentUser().getDomainId().equals(action.getDomainId()) || !Action.STATUS_PUBLISHED.equals(action.getStatus())) throw new IllegalArgumentException("Action is unavailable");
        return action;
    }

    public JSONObject execute(JSONObject request, String lang) throws Exception {
        identity.requireApiPermission("/action/execute");
        JSONObject resolved = resolve(request), document = resolved.getJSONObject("document"), object = object(request, document, lang);
        JSONObject widget = widgets(document).get(request.getString("operation"));
        if (widget == null || !"action".equals(widget.getString("kind"))) throw new IllegalArgumentException("Unknown operation");
        Action action = action(widget.getString("resourceId"));
        JSONObject suppliedInputs = inputs(document, request.getJSONObject("inputs"));
        visible(widget, object, suppliedInputs);
        JSONObject params = parameters(widget, object, suppliedInputs, request.getJSONObject("parameters"));
        Set<String> names = new HashSet<>();
        for (Parameter parameter : action.getFunction().getParameters()) {
            names.add(parameter.getName());
            if (Parameter.TYPE_VECTOR.equals(parameter.getType())) throw new IllegalArgumentException("File operations require the interactive runtime");
            if (!params.containsKey(parameter.getName())) throw new IllegalArgumentException("Missing parameter: " + parameter.getName());
        }
        if (!names.containsAll(params.keySet())) throw new IllegalArgumentException("Unknown operation parameter");
        JSONObject options = widget.getJSONObject("fieldOptions");
        if (options != null) for (String name : options.keySet()) if (params.containsKey(name)) {
            boolean matched = false;
            for (Object raw : options.getJSONArray(name)) if (Objects.equals(((JSONObject)raw).get("value"), params.get(name))) matched = true;
            if (!matched) throw new IllegalArgumentException("Invalid parameter option: " + name);
        }
        PythonExecuteResult result = actions.execute(action.getId(), params, lang, identity.getCurrentUser(), identity.getCurrentUserDataPermission(), timeout(identity.getCurrentUser()));
        if (result.getError() != null && !result.getError().isBlank()) throw new IllegalArgumentException(result.getError());
        return JSONObject.of("revision", resolved.getInteger("revision"), "operation", request.getString("operation"), "result", result);
    }
}
