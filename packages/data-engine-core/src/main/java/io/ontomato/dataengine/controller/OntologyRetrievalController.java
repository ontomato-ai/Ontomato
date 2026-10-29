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

  public OntologyRetrievalController(
      OntologyRetrievalService retrieval, OntologyAgentStore store, OntologyAgentAccess access) {
    this.retrieval = retrieval;
    this.store = store;
    this.access = access;
  }

  @PostMapping("/ontology/retrievals")
  @ResponseStatus(HttpStatus.ACCEPTED)
  public Object start(
      @RequestHeader("Idempotency-Key") String key,
      @RequestBody JSONObject body,
      HttpServletRequest req)
      throws Exception {
    return retrieval.start(AgentJson.id(key), body, access.current(req));
  }

  @GetMapping("/ontology/retrievals/{id}")
  public Object get(@PathVariable String id, HttpServletRequest req) throws Exception {
    return retrieval.get(AgentJson.id(id), access.reader(req, id, null));
  }

  @PostMapping("/ontology/retrievals/{id}/answers")
  @ResponseStatus(HttpStatus.ACCEPTED)
  public Object answer(
      @PathVariable String id,
      @RequestHeader("Idempotency-Key") String key,
      @RequestBody JSONObject body,
      HttpServletRequest req)
      throws Exception {
    return retrieval.answer(AgentJson.id(id), AgentJson.id(key), body, access.current(req));
  }

  @PostMapping("/ontology/retrievals/{id}/cancel")
  public Object cancel(@PathVariable String id, HttpServletRequest req) throws Exception {
    var owner = access.current(req).owner();
    return retrieval.cancel(
        AgentJson.id(id), store.retrieval(id, owner).getString("current_run_id"), owner);
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
    return retrieval.begin(AgentJson.id(key), body, access.current(req));
  }

  @PostMapping("/ontology/retrievals/{id}/skill-runs/{run}/close")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void close(@PathVariable String id, @PathVariable String run, HttpServletRequest req)
      throws Exception {
    var owner = access.current(req).owner();
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
    return retrieval.prepareOutput(
        AgentJson.id(id), AgentJson.id(run), AgentJson.id(key), body, access.current(req));
  }

  @GetMapping("/ontology/retrievals/{id}/runs/{run}/outputs/{key}")
  public Object outputStatus(
      @PathVariable String id,
      @PathVariable String run,
      @PathVariable String key,
      HttpServletRequest req) {
    return retrieval.output(
        AgentJson.id(id), AgentJson.id(run), AgentJson.id(key), access.current(req).owner());
  }

  @GetMapping("/ontology/retrievals/{id}/runs/{run}/outputs/{key}/content")
  public ResponseEntity<String> outputBytes(
      @PathVariable String id,
      @PathVariable String run,
      @PathVariable String key,
      HttpServletRequest req) {
    var output =
        retrieval.output(
            AgentJson.id(id), AgentJson.id(run), AgentJson.id(key), access.current(req).owner());
    if (output.getJSONObject("dataset") == null)
      throw new AgentHttpException(409, "OUTPUT_NOT_READY", "Dataset is not ready");
    return ResponseEntity.ok()
        .contentType(MediaType.APPLICATION_JSON)
        .body(AgentJson.json(output.get("dataset")));
  }

  @PostMapping("/ontology/retrieval-callers")
  @ResponseStatus(HttpStatus.CREATED)
  public Object caller(
      @RequestHeader("Idempotency-Key") String key,
      @RequestBody JSONObject body,
      HttpServletRequest req) {
    access.service(req);
    var context = access.current(req);
    AgentJson.fields(body, "classNames", "continuationIds", "deadlineAt");
    for (String field : List.of("classNames", "continuationIds"))
      if (!(body.get(field) instanceof java.util.List<?> array)
          || array.stream().anyMatch(v -> !(v instanceof String)))
        throw AgentHttpException.invalid(field + " must be an array");
    Instant.parse(AgentJson.text(body, "deadlineAt"));
    for (String id : body.getList("continuationIds", String.class)) AgentJson.id(id);
    return store.openCaller(AgentJson.id(key), context.owner(), body);
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

  @PostMapping("/ontology/retrieval-callers/{id}/close")
  public Object closeCaller(@PathVariable String id, HttpServletRequest req) throws Exception {
    // A not-yet-open intent uses the verified original user, not an asserted body owner.
    io.ontomato.dataengine.service.agent.OntologyAgentStore.Owner owner;
    if (req.getHeader("tk") != null && !req.getHeader("tk").isBlank()
        || req.getHeader("X-API-Key") != null) owner = access.current(req).owner();
    else
      try {
        owner = access.callerOwner(req, AgentJson.id(id));
      } catch (AgentHttpException missing) {
        if (missing.status() != 404) throw missing;
        owner = access.current(req).owner();
      }
    access.service(req);
    retrieval.closeCaller(AgentJson.id(id), owner);
    return JSONObject.of("id", id, "closed", true);
  }
}
