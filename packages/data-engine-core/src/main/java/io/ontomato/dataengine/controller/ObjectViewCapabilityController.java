package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.ObjectViewCapabilityService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
public class ObjectViewCapabilityController {
    private final ObjectViewCapabilityService service;
    public ObjectViewCapabilityController(ObjectViewCapabilityService service) { this.service = service; }

    @PostMapping("/objectView/contract")
    public ResponseEntity<JSONObject> contract(@RequestBody JSONObject request) { return respond(() -> service.contract(request)); }

    @PostMapping("/objectView/instance/read")
    public ResponseEntity<JSONObject> read(@RequestBody JSONObject request, @RequestHeader(value="Accept-Language", defaultValue="en") String lang) { return respond(() -> service.read(request, lang)); }

    @PostMapping("/objectView/instance/execute")
    public ResponseEntity<JSONObject> execute(@RequestBody JSONObject request, @RequestHeader(value="Accept-Language", defaultValue="en") String lang) { return respond(() -> service.execute(request, lang)); }

    private interface Operation { JSONObject run() throws Exception; }
    private ResponseEntity<JSONObject> respond(Operation operation) {
        try { return ResponseEntity.ok(JSONObject.of("success", true, "data", operation.run())); }
        catch (SecurityException error) { return ResponseEntity.status(403).body(JSONObject.of("success", false, "message", error.getMessage())); }
        catch (Exception error) { return ResponseEntity.badRequest().body(JSONObject.of("success", false, "message", error.getMessage())); }
    }
}
