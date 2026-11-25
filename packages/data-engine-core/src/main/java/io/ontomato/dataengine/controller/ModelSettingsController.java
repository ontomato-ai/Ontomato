package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import io.ontomato.dataengine.service.agent.*;
import io.ontomato.dataengine.service.authorization.ManagementOperations;
import io.ontomato.dataengine.service.authorization.ManagementOperations.Operation;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.context.request.async.DeferredResult;
import org.springframework.web.server.ResponseStatusException;

/** Owns configuration of the model library and ontology agent model selections. */
@lombok.extern.slf4j.Slf4j
@RestController
public class ModelSettingsController {

  private static final String READ = "settings.models.read";
  private static final String CHANGE = "settings.models.change";
  private static final String DISCOVER = "settings.models.discover";
  private static final String TEST = "settings.models.test";
  private static final String AGENTS_READ = "settings.agent-models.read";
  private static final String AGENTS_CHANGE = "settings.agent-models.change";

  @Component
  public static final class Operations implements ManagementOperations.Contributor {
      @Override
      public List<Operation> managementOperations() {
          return List.of(
              new Operation(READ, ManagementOperations.Access.READ),
              new Operation(CHANGE, ManagementOperations.Access.CHANGE),
              new Operation(DISCOVER, ManagementOperations.Access.CHANGE),
              new Operation(TEST, ManagementOperations.Access.CHANGE),
              new Operation(AGENTS_READ, ManagementOperations.Access.READ),
              new Operation(AGENTS_CHANGE, ManagementOperations.Access.CHANGE));
      }
  }

  private final ManagementRequestAccess management;

  private final AgentRuntimeClient runtime;
  private final OntologyAgentAccess access;
  private final OntologyAgentModelSettings agents;
  private final RetrieverAccess retrieverAccess;

  public ModelSettingsController(AgentRuntimeClient runtime, OntologyAgentAccess access, OntologyAgentModelSettings agents, RetrieverAccess retrieverAccess,
      ManagementRequestAccess management) {
    this.runtime = runtime;
    this.access = access;
    this.agents = agents;
    this.retrieverAccess = retrieverAccess;
    this.management = management;
  }

  private String domain(HttpServletRequest request) {
    return access.authenticated(request).owner().domainId();
  }

  private JSONObject success(Object data) { return JSONObject.of("success", true, "data", data); }

  @GetMapping("/model-settings")
  @Owned
  public Object read() throws Exception {
    return success(runtime.json(management.require(READ).getDomainId(), "model-settings", "/v1/models/settings", "GET", null, null));
  }

  @org.springframework.beans.factory.annotation.Autowired
  private io.ontomato.dataengine.service.vector.VectorRebuildService vectors;

  @PostMapping("/model-settings/discover")
  @Owned
  public Object discover(@RequestBody JSONObject body) throws Exception {
    return success(runtime.json(management.require(DISCOVER).getDomainId(), "model-discovery", "/v1/models/discover", "POST", body, null));
  }

  @PostMapping("/model-settings/save")
  @Owned
  public Object save(@RequestBody JSONObject body) throws Exception {
    String domain = management.require(CHANGE).getDomainId();
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
  @Owned
  public DeferredResult<Object> test(@RequestBody JSONObject body) {
    var upstream = runtime.testModel(management.require(TEST).getDomainId(), body);
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
  @Owned
  public Object agents(HttpServletRequest request) {
    management.require(AGENTS_READ);
    var caller = access.authenticated(request).owner();
    boolean retrieverVisible = retrieverAccess.decide(retrieverAccess.subject(caller), Verb.VIEW).allowed();
    return success(agents.list(caller.domainId(), retrieverVisible));
  }

  @GetMapping("/ontology/ai/agent-models/{id}")
  @Owned
  public Object agent(@PathVariable String id, HttpServletRequest request) {
    if (!OntologyAgentStore.RETRIEVER.equals(id))
      return success(agents.read(management.require(AGENTS_READ).getDomainId(), id));
    var owner = access.authenticated(request).owner();
    var subject = retrieverAccess.subject(owner);
    retrieverAccess.require(subject, Verb.VIEW);
    var model = agents.read(owner.domainId(), id);
    model.put("editable", retrieverAccess.decide(subject, Verb.EDIT).allowed());
    return success(model);
  }

  @PutMapping("/ontology/ai/agent-models/{id}")
  @Owned
  public Object agent(@PathVariable String id, @RequestBody JSONObject body, HttpServletRequest request) throws Exception {
    if (!OntologyAgentStore.RETRIEVER.equals(id))
      return success(agents.save(management.require(AGENTS_CHANGE).getDomainId(), id, body));
    var owner = access.authenticated(request).owner();
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
    } else if (error instanceof ResponseStatusException refusal) {
      status = refusal.getStatusCode().value();
      code = status == 401 ? "UNAUTHENTICATED" : HttpStatus.valueOf(status).name();
      message = refusal.getReason();
    } else if (status == 503) {
      // The generic answer hides the cause from the caller; keep it in the service log.
      log.warn("Model configuration request failed", error);
    }
    return ResponseEntity.status(status).body(JSONObject.of("success", false, "code", code, "message", message));
  }
}
