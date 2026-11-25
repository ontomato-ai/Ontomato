package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import io.ontomato.dataengine.service.agent.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.context.request.async.DeferredResult;

/** Verifies domain identity and authorizes agent model settings through product Grants. */
@lombok.extern.slf4j.Slf4j
@RestController
public class ModelSettingsController {
  private final AgentRuntimeClient runtime;
  private final OntologyAgentAccess access;
  private final OntologyAgentModelSettings agents;
  private final RetrieverAccess retrieverAccess;

  public ModelSettingsController(AgentRuntimeClient runtime, OntologyAgentAccess access, OntologyAgentModelSettings agents, RetrieverAccess retrieverAccess) {
    this.runtime = runtime;
    this.access = access;
    this.agents = agents;
    this.retrieverAccess = retrieverAccess;
  }

  private String domain(HttpServletRequest request) {
    return access.authenticated(request).owner().domainId();
  }

  private JSONObject success(Object data) { return JSONObject.of("success", true, "data", data); }

  @GetMapping("/model-settings")
  public Object read(HttpServletRequest request) throws Exception {
    return success(runtime.json(domain(request), "model-settings", "/v1/models/settings", "GET", null, null));
  }

  @org.springframework.beans.factory.annotation.Autowired
  private io.ontomato.dataengine.service.vector.VectorRebuildService vectors;

  @PostMapping("/model-settings/discover")
  public Object discover(@RequestBody JSONObject body, HttpServletRequest request) throws Exception {
    return success(runtime.json(domain(request), "model-discovery", "/v1/models/discover", "POST", body, null));
  }

  @PostMapping("/model-settings/save")
  public Object save(@RequestBody JSONObject body, HttpServletRequest request) throws Exception {
    String domain = domain(request);
    var saved = runtime.json(domain, "model-settings", "/v1/models/settings", "PUT", body, null);
    if (saved.getString("embeddingModel") != null) vectors.modelSettingsChanged(domain);
    return success(saved);
  }

  @BuildTestAccess(BuildTestAccess.Access.NO_BUSINESS_DATA)
  @GetMapping("/model-options")
  public Object options(HttpServletRequest request) throws Exception {
    return success(runtime.json(domain(request), "model-options", "/v1/models/options", "GET", null, null));
  }

  @PostMapping("/model-settings/test")
  public DeferredResult<Object> test(@RequestBody JSONObject body, HttpServletRequest request) {
    var upstream = runtime.testModel(domain(request), body);
    var result = new DeferredResult<Object>(0L);
    result.onCompletion(() -> upstream.cancel(true));
    result.onError(error -> upstream.cancel(true));
    upstream.whenComplete((value, error) -> {
      if (error == null) result.setResult(success(value));
      else result.setResult(failure(error));
    });
    return result;
  }

  @GetMapping("/ontology/ai/agent-models")
  public Object agents(HttpServletRequest request) {
    var caller = access.authenticated(request).owner();
    boolean retrieverVisible = retrieverAccess.decide(retrieverAccess.subject(caller), Verb.VIEW).allowed();
    return success(agents.list(caller.domainId(), retrieverVisible));
  }

  @GetMapping("/ontology/ai/agent-models/{id}")
  public Object agent(@PathVariable String id, HttpServletRequest request) {
    var owner = access.authenticated(request).owner();
    if (!OntologyAgentStore.RETRIEVER.equals(id)) return success(agents.read(owner.domainId(), id));
    var subject = retrieverAccess.subject(owner);
    retrieverAccess.require(subject, Verb.VIEW);
    var model = agents.read(owner.domainId(), id);
    model.put("editable", retrieverAccess.decide(subject, Verb.EDIT).allowed());
    return success(model);
  }

  @PutMapping("/ontology/ai/agent-models/{id}")
  public Object agent(@PathVariable String id, @RequestBody JSONObject body, HttpServletRequest request) throws Exception {
    var owner = access.authenticated(request).owner();
    if (OntologyAgentStore.RETRIEVER.equals(id))
      retrieverAccess.require(retrieverAccess.subject(owner), Verb.EDIT);
    return success(agents.save(owner.domainId(), id, body));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<Object> failure(Exception error) { return failure((Throwable) error); }

  private ResponseEntity<Object> failure(Throwable error) {
    while (error instanceof java.util.concurrent.CompletionException && error.getCause() != null) error = error.getCause();
    int status = 503;
    String code = "DEPENDENCY_UNAVAILABLE", message = "Model configuration service is unavailable";
    if (error instanceof org.springframework.http.converter.HttpMessageNotReadableException) {
      status = 400; code = "INVALID_REQUEST"; message = "Expected a JSON object";
    }
    if (error instanceof AgentHttpException known) {
      status = known.status(); code = known.code(); message = known.getMessage();
    } else if (status == 503) {
      // The generic answer hides the cause from the caller; keep it in the service log.
      log.warn("Model configuration request failed", error);
    }
    return ResponseEntity.status(status).body(JSONObject.of("success", false, "code", code, "message", message));
  }
}
