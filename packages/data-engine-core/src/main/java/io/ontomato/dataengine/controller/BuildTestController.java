package io.ontomato.dataengine.controller;

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
  @ExceptionHandler(org.springframework.web.server.ResponseStatusException.class)
  public org.springframework.http.ResponseEntity<JSONObject> failure(org.springframework.web.server.ResponseStatusException failure) {
    String message=failure.getReason();
    String code=message==null?"BUILD_TEST_DATA_FAILED":message.split(":",2)[0];
    return org.springframework.http.ResponseEntity.status(failure.getStatusCode()).body(JSONObject.of("code",code,"message",message));
  }
  @ExceptionHandler(IllegalArgumentException.class)
  public org.springframework.http.ResponseEntity<JSONObject> invalid(IllegalArgumentException failure) {
    return org.springframework.http.ResponseEntity.badRequest().body(JSONObject.of("code","BUILD_TEST_SAMPLE_INVALID","message",failure.getMessage()));
  }
  @PostMapping(consumes="multipart/form-data")
  public JSONObject create(@RequestParam String workspaceId,@RequestPart("sample") JSONObject sample,
      @RequestParam Map<String,MultipartFile> files) throws Exception {
    Map<String,byte[]> attachments=new HashMap<>();
    for(var file:files.entrySet()) if(!file.getKey().equals("sample")) attachments.put(file.getKey(),file.getValue().getBytes());
    return contexts.create(workspaceId,sample,attachments);
  }
  @GetMapping("/current") public JSONObject current(@RequestParam String workspaceId) { return contexts.current(workspaceId); }
  @GetMapping("/{id}") public JSONObject status(@PathVariable String id) { return contexts.status(id); }
  @PostMapping("/{id}/cleanup") public JSONObject cleanup(@PathVariable String id) { return contexts.retryCleanup(id); }
  @DeleteMapping("/{id}") public JSONObject close(@PathVariable String id) { return contexts.close(id); }
}
