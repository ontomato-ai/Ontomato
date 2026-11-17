package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.service.agent.*;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
public class OntologyRetrievalController {
  private final OntologyRetrievalService retrieval;
  private final OntologyAgentStore store;
  private final OntologyAgentAccess access;
  private final RetrievalTasks tasks;

  public OntologyRetrievalController(
      OntologyRetrievalService retrieval, OntologyAgentStore store, OntologyAgentAccess access,RetrievalTasks tasks) {
    this.retrieval = retrieval;
    this.store = store;
    this.access = access;this.tasks=tasks;
  }

  @GetMapping("/ontology/retrievals/{id}")
  public Object get(@PathVariable String id, @RequestParam(required = false) String runId, HttpServletRequest req) throws Exception {
    id = AgentJson.id(id);
    if (runId != null) runId = AgentJson.id(runId);
    var owner = access.reader(req, id, runId);
    return runId == null ? retrieval.get(id, owner) : retrieval.get(id, runId, owner);
  }

  @PostMapping("/ontology/retrievals/{id}/retriever/cancel")
  public Object cancelRetriever(@PathVariable String id,@RequestBody JSONObject body,HttpServletRequest req) throws Exception {
    if(req.getHeader("X-Ontomato-Query-Service-Token")!=null) {access.service(req);store.requireCallerResource(AgentJson.id(req.getHeader("X-Ontomato-Retrieval-Caller-Id")),AgentJson.id(id),AgentJson.id(body.getString("expectedRoundId")));}
    return retrieval.cancelRetriever(AgentJson.id(id),AgentJson.id(body.getString("expectedRoundId")),access.authenticated(req).owner());
  }

  @GetMapping("/ontology/retrievals/{id}/datasets/{artifact}/content")
  public ResponseEntity<byte[]> datasetContent(@PathVariable String id,@PathVariable String artifact,HttpServletRequest req) throws Exception {
    return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(retrieval.datasetContent(AgentJson.id(id),AgentJson.id(artifact),access.reader(req,id,null)));
  }

  @DeleteMapping("/ontology/retrievals/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void delete(@PathVariable String id, HttpServletRequest req) throws Exception {
    retrieval.delete(AgentJson.id(id), access.reader(req, id, null));
  }

  @GetMapping("/ontology/retrievals/{id}/datasets/{artifact}")
  public Object dataset(
      @PathVariable String id, @PathVariable String artifact, HttpServletRequest req)
      throws Exception {
    return retrieval.dataset(
        AgentJson.id(id), AgentJson.id(artifact), access.reader(req, id, null));
  }

  @GetMapping("/ontology/retrievals/{id}/runs/{run}/quality")
  public Object quality(@PathVariable String id,@PathVariable String run,HttpServletRequest request) {
    return JSONObject.of("quality",tasks.qualityEvidence(AgentJson.id(id),AgentJson.id(run),access.reader(request,id,run)));
  }
  @GetMapping("/ontology/retrievals/{id}/runs/{run}/evidence")
  public Object evidence(@PathVariable String id, @PathVariable String run, HttpServletRequest req)
      throws Exception {
    return retrieval.evidence(AgentJson.id(id), AgentJson.id(run), access.reader(req, id, run));
  }

  @PostMapping("/ontology/retrievals/skill-runs")
  @ResponseStatus(HttpStatus.CREATED)
  public Object begin(
      @RequestHeader("Idempotency-Key") String key,
      @RequestBody JSONObject body,
      HttpServletRequest req) {
    return retrieval.begin(AgentJson.id(key), body, access.executionContext(req));
  }

  @PostMapping("/ontology/retrievals/{id}/skill-runs/{run}/close")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void close(@PathVariable String id, @PathVariable String run, HttpServletRequest req)
      throws Exception {
    var owner = access.authenticated(req).owner();
    if(req.getHeader("X-Ontomato-Query-Service-Token")!=null) {access.service(req);store.requireCallerResource(AgentJson.id(req.getHeader("X-Ontomato-Retrieval-Caller-Id")),AgentJson.id(id),AgentJson.id(run));}
    store.closeRun(AgentJson.id(id), AgentJson.id(run), owner);
    retrieval.cancelWork(id, run, owner);
  }

  @PostMapping("/ontology/retrievals/{id}/runs/{run}/outputs")
  @ResponseStatus(HttpStatus.ACCEPTED)
  public Object output(
      @PathVariable String id,
      @PathVariable String run,
      @RequestHeader("Idempotency-Key") String key,
      @RequestBody JSONObject body,
      HttpServletRequest req) {
    if (!run.equals(req.getHeader("X-Ontomato-Run-Id")))
      throw AgentHttpException.invalid("Run identity mismatch");
    if(req.getHeader("X-Ontomato-Query-Service-Token")!=null) {access.service(req);store.requireCallerResource(AgentJson.id(req.getHeader("X-Ontomato-Retrieval-Caller-Id")),AgentJson.id(id),AgentJson.id(run));}
    return retrieval.prepareOutput(
        AgentJson.id(id), AgentJson.id(run), AgentJson.id(key), body, access.executionContext(req));
  }

  private OntologyAgentStore.Owner outputOwner(HttpServletRequest request,String id,String run) {
    return request.getHeader("X-Ontomato-Query-Service-Token")==null ? access.current(request).owner() : access.reader(request,id,run);
  }

  @GetMapping("/ontology/retrievals/{id}/runs/{run}/outputs/{key}")
  public Object outputStatus(
      @PathVariable String id,
      @PathVariable String run,
      @PathVariable String key,
      HttpServletRequest req) {
    return retrieval.output(
        AgentJson.id(id), AgentJson.id(run), AgentJson.id(key), outputOwner(req,id,run));
  }

  @GetMapping("/ontology/retrievals/{id}/runs/{run}/outputs/{key}/content")
  public ResponseEntity<String> outputBytes(
      @PathVariable String id,
      @PathVariable String run,
      @PathVariable String key,
      HttpServletRequest req) {
    var output =
        retrieval.output(
            AgentJson.id(id), AgentJson.id(run), AgentJson.id(key), outputOwner(req,id,run));
    if (output.getJSONObject("dataset") == null)
      throw new AgentHttpException(409, "OUTPUT_NOT_READY", "Dataset is not ready");
    return ResponseEntity.ok()
        .contentType(MediaType.APPLICATION_JSON)
        .body(AgentJson.json(output.get("dataset")));
  }

  @org.springframework.beans.factory.annotation.Autowired
  private AgentExecutionAccess executions;

  @PostMapping("/ontology/retrieval-callers")
  @ResponseStatus(HttpStatus.CREATED)
  public Object caller(
      @RequestHeader("Idempotency-Key") String key,
      @RequestBody JSONObject body,
      HttpServletRequest req) {
    access.service(req);
    var context = access.authenticated(req);
    AgentJson.fields(body, "classNames", "continuationIds", "deadlineAt", "recentUserMessages", "executionUserId");
    String executionUserId=body.getString("executionUserId");
    if(executionUserId!=null) executions.require(context.owner().domainId(),executionUserId);
    body.putIfAbsent("recentUserMessages", new JSONArray());
    for (String field : List.of("classNames", "continuationIds", "recentUserMessages"))
      if (!(body.get(field) instanceof java.util.List<?> array)
          || array.stream().anyMatch(v -> !(v instanceof String)))
        throw AgentHttpException.invalid(field + " must be an array");
    Instant.parse(AgentJson.text(body, "deadlineAt"));
    for (String id : body.getList("continuationIds", String.class)) AgentJson.id(id);
    return store.openCaller(AgentJson.id(key), context.owner(), body);
  }

  @PutMapping("/ontology/retrieval-callers/{id}/user-quotes")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void userQuotes(@PathVariable String id,@RequestBody Map<String,Object> body,HttpServletRequest req) {
    access.service(req);var context=access.authenticated(req);
    AgentJson.fields(JSONObject.from(body),"recentUserMessages");
    if(!(body.get("recentUserMessages") instanceof List<?> quotes) || quotes.stream().anyMatch(value -> !(value instanceof String))) throw AgentHttpException.invalid("recentUserMessages must be a string array");
    store.updateUserQuotes(AgentJson.id(id),context.owner(),new JSONArray(quotes));
  }

  @GetMapping("/ontology/retrieval-callers/{id}")
  public Object callerStatus(@PathVariable String id, HttpServletRequest req) {
    var owner = access.callerOwner(req, AgentJson.id(id));
    var caller = store.caller(id, owner, false);
    return JSONObject.of(
        "id",
        id,
        "closed",
        caller.getBooleanValue("closed"),
        "retrievals",
        store.callerRuns(id, owner));
  }

  @PostMapping("/ontology/retrieval-callers/{id}/close-scope")
  public Object closeScope(@PathVariable String id, HttpServletRequest req) throws Exception {
    // A not-yet-open intent uses the verified original user, not an asserted body owner.
    io.ontomato.dataengine.service.agent.OntologyAgentStore.Owner owner;
    if (req.getHeader("tk") != null && !req.getHeader("tk").isBlank()
        || req.getHeader("X-API-Key") != null) owner = access.authenticated(req).owner();
    else
      try {
        owner = access.callerOwner(req, AgentJson.id(id));
      } catch (AgentHttpException missing) {
        if (missing.status() != 404) throw missing;
        // Without a user there is no one to record a tombstone for: a caller that was never opened has
        // nothing to close. The workbench's background settlement closes such turns this way.
        access.service(req);
        return JSONObject.of("id", id, "closed", true);
      }
    access.service(req);
    store.closeScope(AgentJson.id(id),owner);
    return JSONObject.of("id", id, "closed", true);
  }
}
