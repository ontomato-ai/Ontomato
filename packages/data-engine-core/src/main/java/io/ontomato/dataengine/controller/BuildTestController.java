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
