package io.ontomato.dataengine.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.http.MediaType;
import com.alibaba.fastjson2.JSON;
import org.springframework.web.server.ResponseStatusException;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.BuildTestContextService;
import java.util.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/ontology/build-tests")
public class BuildTestController {
  private final BuildTestContextService contexts;
  public BuildTestController(BuildTestContextService contexts) { this.contexts=contexts; }
  @ExceptionHandler(ResponseStatusException.class)
  public ResponseEntity<JSONObject> failure(ResponseStatusException failure) {
    String message=failure.getReason();
    String code=message==null?"BUILD_TEST_DATA_FAILED":message.split(":",2)[0];
    return ResponseEntity.status(failure.getStatusCode()).body(JSONObject.of("code",code,"message",message));
  }
  @ExceptionHandler(IllegalArgumentException.class)
  public ResponseEntity<JSONObject> invalid(IllegalArgumentException failure) {
    return ResponseEntity.badRequest().body(JSONObject.of("code","BUILD_TEST_SAMPLE_INVALID","message",failure.getMessage()));
  }
  @PostMapping(consumes="multipart/form-data")
  public JSONObject create(@RequestParam String workspaceId,@RequestParam(defaultValue="sample.json") String sampleName,@RequestPart("sample") JSONObject sample,
      @RequestParam Map<String,MultipartFile> files) throws Exception {
    Map<String,byte[]> attachments=new HashMap<>();
    for(var file:files.entrySet()) if(!file.getKey().equals("sample")) attachments.put(file.getKey(),file.getValue().getBytes());
    return contexts.create(workspaceId,sample,attachments,sampleName);
  }
  @GetMapping("/current") public ResponseEntity<String> current(@RequestParam String workspaceId) { return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(JSON.toJSONString(contexts.current(workspaceId))); }
  @GetMapping("/{id}") public JSONObject status(@PathVariable String id) { return contexts.status(id); }
  @PostMapping("/{id}/cleanup") public JSONObject cleanup(@PathVariable String id) { return contexts.retryCleanup(id); }
  @DeleteMapping("/{id}") public JSONObject close(@PathVariable String id) { return contexts.close(id); }
}
