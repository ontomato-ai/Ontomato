package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.ObjectViewStore;
import io.ontomato.dataengine.service.MetricViewService;
import io.ontomato.dataengine.service.ActionService;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ObjectViewController {
    private final ObjectViewStore store;
    private final IdentityService identity;
    private final MetricViewService metrics;
    private final ActionService actions;
    public ObjectViewController(ObjectViewStore store, IdentityService identity, MetricViewService metrics, ActionService actions) {
        this.store = store;
        this.identity = identity;
        this.metrics = metrics;
        this.actions = actions;
    }

    @PostMapping("/objectView/read")
    public ResponseEntity<JSONObject> read(@RequestBody Map<String, Object> body) {
        JSONObject input = JSONObject.from(body);
        return respond(() -> store.read(identity.getCurrentUser().getDomainId(), input.getString("className"), input.getString("form"), false));
    }

    @PostMapping("/objectView/edit")
    public ResponseEntity<JSONObject> edit(@RequestBody Map<String, Object> body) {
        JSONObject input = JSONObject.from(body);
        return respond(() -> store.read(identity.getCurrentUser().getDomainId(), input.getString("className"), input.getString("form"), true));
    }

    @PostMapping("/objectView/save")
    public ResponseEntity<JSONObject> save(@RequestBody Map<String, Object> body) {
        JSONObject input = JSONObject.from(body);
        return respond(() -> {
            validateCapabilities(input.getJSONObject("document"));
            return store.save(identity.getCurrentUser().getDomainId(), identity.getCurrentUserId(), input.getString("className"), input.getString("form"),
                input.getIntValue("expectedRevision"), input.getJSONObject("document"), input.getString("description"));
        });
    }

    @PostMapping("/objectView/publish")
    public ResponseEntity<JSONObject> publish(@RequestBody Map<String, Object> body) {
        JSONObject input = JSONObject.from(body);
        return respond(() -> {
        JSONObject state = store.read(identity.getCurrentUser().getDomainId(), input.getString("className"), input.getString("form"), true);
        for (Object value : state.getJSONArray("versions")) {
            JSONObject version = (JSONObject) value;
            if (version.getIntValue("revision") == input.getIntValue("revision")) validateCapabilities(version.getJSONObject("document"));
        }
        return store.publish(identity.getCurrentUser().getDomainId(), input.getString("className"), input.getString("form"),
                input.getIntValue("revision"), input.getIntValue("expectedRevision"));
        });
    }

    private void validateCapabilities(JSONObject document) {
        if (document == null) throw new IllegalArgumentException("Missing object view document");
        ObjectViewStore.validateDocument(document.getString("className"), document);
        for (Object tabValue : document.getJSONArray("tabs")) {
            JSONObject tab = (JSONObject) tabValue;
            for (Object sectionValue : tab.getJSONArray("sections")) {
                JSONObject section = (JSONObject) sectionValue;
                for (Object widgetValue : section.getJSONArray("widgets")) {
                    JSONObject widget = (JSONObject) widgetValue;
                    String id = widget.getString("resourceId");
                    if (id == null || id.isBlank()) continue;
                    if ("action".equals(widget.getString("kind"))) {
                        var action = actions.queryById(id);
                        if (action == null || !identity.getCurrentUser().getDomainId().equals(action.getDomainId()) || !"PUBLISHED".equals(action.getStatus()))
                            throw new IllegalArgumentException("Action unavailable or unpublished");
                    } else if (java.util.Set.of("properties", "links", "metric", "table", "chart").contains(widget.getString("kind"))) {
                        metrics.requireExecutable(id, identity.getCurrentUser());
                    }
                }
            }
        }
    }

    private ResponseEntity<JSONObject> respond(java.util.function.Supplier<JSONObject> operation) {
        try { return ResponseEntity.ok(JSONObject.of("success", true, "data", operation.get())); }
        catch (ObjectViewStore.ViewConflictException error) { return ResponseEntity.status(409).body(JSONObject.of("success", false, "message", error.getMessage())); }
        catch (IllegalArgumentException error) { return ResponseEntity.badRequest().body(JSONObject.of("success", false, "message", error.getMessage())); }
    }
}
