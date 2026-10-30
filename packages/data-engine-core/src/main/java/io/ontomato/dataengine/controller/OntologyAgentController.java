package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.agent.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.context.request.async.WebAsyncUtils;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

@RestController
@RequestMapping("/ontology/ai")
public class OntologyAgentController {
  private final OntologyAgentHost host;
  private final OntologyAgentAccess access;
  private final AgentRuntimeClient runtime;
  private final OntologyRetrievalService retrieval;

  public OntologyAgentController(
      OntologyAgentHost host,
      OntologyAgentAccess access,
      AgentRuntimeClient runtime,
      OntologyRetrievalService retrieval) {
    this.host = host;
    this.access = access;
    this.runtime = runtime;
    this.retrieval = retrieval;
  }

  @GetMapping("/agents")
  public Object agents(HttpServletRequest req) {
    access.authenticated(req);
    return host.agents(access.governanceAllowed());
  }

  @PostMapping("/sessions")
  @ResponseStatus(HttpStatus.CREATED)
  public Object create(
      @RequestHeader("Idempotency-Key") String key,
      @RequestBody JSONObject body,
      HttpServletRequest req)
      throws Exception {
    AgentJson.fields(body, "agentId");
    return host.create(
        AgentJson.id(key), AgentJson.id(body.getString("agentId")), access.forAgent(req,body.getString("agentId")).owner());
  }

  @GetMapping("/sessions")
  public Object list(
      @RequestParam String agentId,
      @RequestParam(defaultValue = "30") int limit,
      @RequestParam(required = false) String cursor,
      HttpServletRequest req)
      throws Exception {
    return host.list(agentId, limit, cursor, access.forAgent(req,agentId).owner());
  }

  @GetMapping("/sessions/{id}/history")
  public Object history(@PathVariable String id,
      @RequestParam(required = false) String before,
      @RequestParam(required = false) String after,
      @RequestParam(required = false) String through,
      @RequestParam(required = false) String runId,
      HttpServletRequest req) throws Exception {
    return host.history(AgentJson.id(id), JSONObject.of("before", before, "after", after, "through", through, "runId", runId), access.reader(req, id, null));
  }

  @GetMapping("/sessions/{id}")
  public Object session(@PathVariable String id, HttpServletRequest req) throws Exception {
    return host.snapshot(AgentJson.id(id), access.reader(req, id, null));
  }

  @DeleteMapping("/sessions/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void delete(@PathVariable String id, HttpServletRequest req) throws Exception {
    host.delete(AgentJson.id(id), access.reader(req, id, null));
  }

  @PostMapping("/sessions/{id}/runs")
  @ResponseStatus(HttpStatus.ACCEPTED)
  public Object start(
      @PathVariable String id,
      @RequestHeader("Idempotency-Key") String key,
      @RequestBody JSONObject body,
      HttpServletRequest req)
      throws Exception {
    AgentJson.fields(body, "message");
    return host.start(
        AgentJson.id(id), AgentJson.id(key), AgentJson.text(body, "message"), access.forSession(req,id));
  }

  @GetMapping("/sessions/{id}/runs/{run}")
  public Object run(@PathVariable String id, @PathVariable String run, HttpServletRequest req)
      throws Exception {
    return host.run(AgentJson.id(id), AgentJson.id(run), access.reader(req, id, run));
  }

  @PostMapping("/sessions/{id}/runs/{run}/cancel")
  public Object cancel(@PathVariable String id, @PathVariable String run, HttpServletRequest req)
      throws Exception {
    return host.cancel(AgentJson.id(id), AgentJson.id(run), access.forSession(req,id).owner());
  }

  @GetMapping("/sessions/{id}/runs/{run}/events")
  public ResponseEntity<StreamingResponseBody> events(
      @PathVariable String id,
      @PathVariable String run,
      @RequestParam long afterSeq,
      @RequestParam String streamId,
      HttpServletRequest req)
      throws Exception {
    if (afterSeq < 0) throw AgentHttpException.invalid("Invalid cursor");
    var owner = access.reader(req, id, run);
    host.run(AgentJson.id(id), AgentJson.id(run), owner);
    // This subscription ends with the run or connection, not the servlet's async deadline.
    WebAsyncUtils.getAsyncManager(req).getAsyncWebRequest().setTimeout(0L);
    var response =
        runtime.stream(
            owner.domainId(),
            run,
            "/v1/runs/"
                + run
                + "/events?afterSeq="
                + afterSeq
                + "&streamId="
                + java.net.URLEncoder.encode(streamId, java.nio.charset.StandardCharsets.UTF_8));
    StreamingResponseBody body =
        out -> {
          try (var in = response.body()) {
            byte[] chunk = new byte[8192];
            int size;
            while ((size = in.read(chunk)) != -1) {
              out.write(chunk, 0, size);
              out.flush();
            }
          }
        };
    return ResponseEntity.ok()
        .contentType(MediaType.TEXT_EVENT_STREAM)
        .header("Cache-Control", "no-cache, no-transform")
        .header("X-Accel-Buffering", "no")
        .body(body);
  }

  @GetMapping("/sessions/{id}/runs/{run}/artifacts/resolve")
  public Object resolve(
      @PathVariable String id,
      @PathVariable String run,
      @RequestParam String path,
      HttpServletRequest req)
      throws Exception {
    return host.resolve(AgentJson.id(id), AgentJson.id(run), path, access.reader(req, id, run));
  }

  @GetMapping("/sessions/{id}/artifacts/{artifact}")
  public Object artifact(
      @PathVariable String id, @PathVariable String artifact, HttpServletRequest req)
      throws Exception {
    return host.artifact(AgentJson.id(id), AgentJson.id(artifact), access.reader(req, id, null));
  }

  @GetMapping("/sessions/{id}/artifacts/{artifact}/content")
  public ResponseEntity<byte[]> content(
      @PathVariable String id,
      @PathVariable String artifact,
      @RequestParam(defaultValue = "0") int download,
      HttpServletRequest req)
      throws Exception {
    var owner = access.reader(req, id, null);
    var metadata = host.artifact(AgentJson.id(id), AgentJson.id(artifact), owner);
    String name = metadata.getString("path");
    name = name.substring(name.lastIndexOf('/') + 1);
    boolean attach = download == 1 || metadata.getString("mediaType").startsWith("text/html");
    return ResponseEntity.ok()
        .contentType(MediaType.parseMediaType(metadata.getString("mediaType")))
        .eTag(metadata.getString("sha256"))
        .header("X-Content-Type-Options", "nosniff")
        .header(
            "Content-Disposition",
            (attach ? ContentDisposition.attachment() : ContentDisposition.inline())
                .filename(name, java.nio.charset.StandardCharsets.UTF_8)
                .build()
                .toString())
        .body(runtime.bytes(owner.domainId(), artifact, "/v1/artifacts/" + artifact + "/content"));
  }
}
