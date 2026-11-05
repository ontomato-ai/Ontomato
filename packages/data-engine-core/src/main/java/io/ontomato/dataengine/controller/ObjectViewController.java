package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.ObjectViewStore;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ObjectViewController {
    private final ObjectViewStore store;
    private final IdentityService identity;
    public ObjectViewController(ObjectViewStore store, IdentityService identity) {
        this.store = store;
        this.identity = identity;
    }

    @PostMapping("/objectView/read")
    public ResponseEntity<JSONObject> read(@RequestBody JSONObject input) {
        return respond(() -> store.read(identity.getCurrentUser().getDomainId(), input.getString("className"), input.getString("form"), false));
    }

    @PostMapping("/objectView/edit")
    public ResponseEntity<JSONObject> edit(@RequestBody JSONObject input) {
        return respond(() -> store.read(identity.getCurrentUser().getDomainId(), input.getString("className"), input.getString("form"), true));
    }

    @PostMapping("/objectView/save")
    public ResponseEntity<JSONObject> save(@RequestBody JSONObject input) {
        return respond(() -> store.save(identity.getCurrentUser().getDomainId(), identity.getCurrentUserId(), input.getString("className"), input.getString("form"),
                input.getIntValue("expectedRevision"), input.getJSONObject("document"), input.getString("description")));
    }

    @PostMapping("/objectView/publish")
    public ResponseEntity<JSONObject> publish(@RequestBody JSONObject input) {
        return respond(() -> store.publish(identity.getCurrentUser().getDomainId(), input.getString("className"), input.getString("form"),
                input.getIntValue("revision"), input.getIntValue("expectedRevision")));
    }

    private ResponseEntity<JSONObject> respond(java.util.function.Supplier<JSONObject> operation) {
        try { return ResponseEntity.ok(JSONObject.of("success", true, "data", operation.get())); }
        catch (ObjectViewStore.ViewConflictException error) { return ResponseEntity.status(409).body(JSONObject.of("success", false, "message", error.getMessage())); }
        catch (IllegalArgumentException error) { return ResponseEntity.badRequest().body(JSONObject.of("success", false, "message", error.getMessage())); }
    }
}
