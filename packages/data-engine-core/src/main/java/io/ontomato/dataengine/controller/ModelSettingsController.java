package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.panelreads.WorkbenchPanelRead;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationPolicies;
import io.ontomato.dataengine.service.authorization.AuthorizationService.Create;
import io.ontomato.dataengine.service.authorization.AuthorizationService.ObjectAccess;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.DefinitionState;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Kind;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.ObjectTarget;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.OwnerFacts;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import io.ontomato.dataengine.service.agent.*;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.ManagementOperations;
import io.ontomato.dataengine.service.authorization.ManagementOperations.Operation;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;
import io.ontomato.dataengine.service.identity.AgentExecutionSettings;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletionException;
import org.springframework.context.annotation.Bean;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.context.request.async.DeferredResult;
import org.springframework.web.server.ResponseStatusException;

/** Owns configuration of the model library and ontology agent model selections. */
@lombok.extern.slf4j.Slf4j
@RestController
@Owned
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
              new Operation(READ, "Read model library settings", ManagementOperations.Access.READ),
              new Operation(CHANGE, "Change model library settings", ManagementOperations.Access.CHANGE),
              new Operation(DISCOVER, "Discover models", ManagementOperations.Access.CHANGE),
              new Operation(TEST, "Test a model connection", ManagementOperations.Access.CHANGE),
              new Operation(AGENTS_READ, "Read agent model selections", ManagementOperations.Access.READ),
              new Operation(AGENTS_CHANGE, "Change agent model selections", ManagementOperations.Access.CHANGE));
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
    return success(readSettings(management.require(READ).getDomainId()));
  }

  private JSONObject readSettings(String domain) throws Exception {
    return runtime.json(domain, "model-settings", "/v1/models/settings", "GET", null, null);
  }

  @Bean
  WorkbenchPanelRead modelSettingsPanelFacts() {
    return new WorkbenchPanelRead("platform:ModelConnection", "settings", (subject, parameters) -> {
      management.require(subject, READ);
      return panelSettings(subject.identity().domainId());
    });
  }

  private JSONObject panelSettings(String domain) {
    return panelRuntimeFacts(() -> readSettings(domain));
  }

  private static JSONObject panelRuntimeFacts(Callable<JSONObject> readFacts) {
    try {
      return readFacts.call();
    } catch (Exception failure) {
      if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
      throw new CompletionException(failure);
    }
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
    return success(vectors.saveModelSettings(domain,
        () -> runtime.json(domain, "model-settings", "/v1/models/settings", "PUT", body, null)));
  }
  @PreviewAccess
  @GetMapping("/model-options")
  public Object options(HttpServletRequest request) throws Exception {
    return success(readModelOptions(domain(request)));
  }

  private JSONObject readModelOptions(String domain) throws Exception {
    return runtime.json(domain, "model-options", "/v1/models/options", "GET", null, null);
  }

  @Bean
  WorkbenchPanelRead modelOptionPanelOptions() {
    return modelOptionPanelRead("options");
  }

  @Bean
  WorkbenchPanelRead modelOptionPanelResolve() {
    return modelOptionPanelRead("resolve");
  }

  private WorkbenchPanelRead modelOptionPanelRead(String name) {
    return new WorkbenchPanelRead("platform:ModelOption", name,
        (subject, parameters) -> panelRuntimeFacts(() -> readModelOptions(subject.identity().domainId())));
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
    return success(readAgentModels(retrieverAccess.subject(caller)));
  }

  private JSONObject readAgentModels(SubjectContext subject) {
    boolean retrieverVisible = retrieverAccess.decide(subject, Verb.VIEW).allowed();
    return agents.list(subject.identity().domainId(), retrieverVisible);
  }

  @Bean
  WorkbenchPanelRead modelUsagePanelFacts() {
    return new WorkbenchPanelRead("platform:ModelUsage", "settingsAndAgents", (subject, parameters) -> {
      management.require(subject, READ);
      management.require(subject, AGENTS_READ);
      return JSONObject.of("settings", panelSettings(subject.identity().domainId()), "agentModels", readAgentModels(subject));
    });
  }

  @Bean
  WorkbenchPanelRead agentDefinitionPanelCount() {
    // Workbench counts its own definitions. Java contributes the one definition it owns.
    return new WorkbenchPanelRead("platform:AgentDefinition", "count", (subject, parameters) ->
        retrieverAccess.decide(subject, Verb.VIEW).allowed() ? 1 : 0);
  }

  @Bean
  WorkbenchPanelRead agentDefinitionPanelList() {
    return new WorkbenchPanelRead("platform:AgentDefinition", "list", (subject, parameters) ->
        JSONObject.of("retriever", retrieverAccess.decide(subject, Verb.VIEW).allowed() ? readVisibleRetriever(subject) : null));
  }

  private JSONObject readVisibleRetriever(SubjectContext subject) {
    var model = agents.read(subject.identity().domainId(), OntologyAgentStore.RETRIEVER);
    model.put("editable", retrieverAccess.decide(subject, Verb.EDIT).allowed());
    return model;
  }

  @Bean
  WorkbenchPanelRead agentDefinitionPanelRecord(AuthorizationService authorization, AuthorizationPolicies policies) {
    return new WorkbenchPanelRead("platform:AgentDefinition", "record", (subject, parameters) -> {
      var definition = agentDefinitionFacts(subject, parameters);
      var target = definition.target();
      var facts = definition.ownerFacts();
      if (OntologyAgentStore.RETRIEVER.equals(target.id())) {
        retrieverAccess.require(subject, Verb.VIEW);
        var model = readVisibleRetriever(subject);
        var result = JSONObject.of("retriever", model);
        if (model.getBooleanValue("editable"))
          result.put("shared", policies.agentAccess(subject, target, facts).shared());
        return result;
      }
      boolean editable = agentDefinitionEditable(authorization, subject, definition);
      var result = JSONObject.of("editable", editable);
      if (editable) result.put("shared", policies.agentAccess(subject, target, facts).shared());
      return result;
    });
  }

  @Bean
  WorkbenchPanelRead agentDefinitionPanelForm(AuthorizationService authorization, AgentExecutionSettings execution) {
    return new WorkbenchPanelRead("platform:AgentDefinition", "form", (subject, parameters) -> {
      var definition = agentDefinitionFacts(subject, parameters);
      if (OntologyAgentStore.RETRIEVER.equals(definition.target().id())) {
        retrieverAccess.require(subject, Verb.VIEW);
        return JSONObject.of("retriever", readVisibleRetriever(subject));
      }
      var facts = JSONObject.of("editable", agentDefinitionEditable(authorization, subject, definition),
          "canSetExecutionUser", AgentExecutionSettings.canSetExecutionUser(subject));
      addAgentFormValidation(facts, subject, parameters, execution);
      return facts;
    });
  }

  @Bean
  WorkbenchPanelRead agentDefinitionPanelCreateForm(AuthorizationService authorization, AgentExecutionSettings execution) {
    return new WorkbenchPanelRead("platform:AgentDefinition", "createForm", (subject, parameters) -> {
      var create = authorization.decide(subject, new Create(Kind.AGENT));
      if (!create.allowed()) throw new AgentHttpException(403, create.code(), create.reason());
      var facts = JSONObject.of("canSetExecutionUser", AgentExecutionSettings.canSetExecutionUser(subject));
      addAgentFormValidation(facts, subject, parameters, execution);
      return facts;
    });
  }

  private void addAgentFormValidation(JSONObject facts, SubjectContext subject, Map<String, Object> parameters, AgentExecutionSettings execution) {
    if (!parameters.containsKey("validation")) return;
    if (!(parameters.get("validation") instanceof Map<?, ?> validation))
      throw AgentHttpException.invalid("Invalid agent form validation");
    String previous = nullableFormValue(validation, "oldExecutionUserId");
    String selected = nullableFormValue(validation, "executionUserId");
    String modelId = nullableFormValue(validation, "modelId");
    try {
      execution.validate(subject, previous, selected);
    } catch (AgentHttpException refusal) {
      if (refusal.status() != 400 && refusal.status() != 403) throw refusal;
      facts.put("executionError", refusal.getMessage());
      return;
    }
    if (modelId != null)
      facts.put("modelOptions", panelRuntimeFacts(() -> readModelOptions(subject.identity().domainId())));
  }

  private static String nullableFormValue(Map<?, ?> validation, String key) {
    var value = validation.get(key);
    if (!validation.containsKey(key) || value != null && !(value instanceof String))
      throw AgentHttpException.invalid("Invalid agent form validation: " + key);
    return (String) value;
  }

  private static boolean agentDefinitionEditable(AuthorizationService authorization, SubjectContext subject,
      AgentDefinitionFacts definition) {
    var target = definition.target();
    var facts = definition.ownerFacts();
    var view = authorization.decide(subject, new ObjectAccess(target, Verb.VIEW, facts));
    if (!view.allowed()) throw new AgentHttpException(403, view.code(), view.reason());
    return authorization.decide(subject, new ObjectAccess(target, Verb.EDIT, facts)).allowed();
  }

  @Bean
  WorkbenchPanelRead agentDefinitionDeleteAvailability(AuthorizationService authorization) {
    return new WorkbenchPanelRead("platform:AgentDefinition", "deleteAvailability", (subject, parameters) -> {
      var definition = agentDefinitionFacts(subject, parameters);
      var facts = definition.ownerFacts();
      if (facts.ownerId() != null && facts.ownerId().isBlank())
        throw AgentHttpException.invalid("Invalid object owner facts.");
      return authorization.decide(subject, new ObjectAccess(definition.target(), Verb.EDIT, facts)).allowed();
    });
  }

  @Bean
  WorkbenchPanelRead agentDefinitionPanelGrantRows(AuthorizationPolicies policies) {
    return new WorkbenchPanelRead("platform:AgentDefinition", "grantRows", (subject, parameters) -> {
      var definition = agentDefinitionFacts(subject, parameters);
      if (OntologyAgentStore.RETRIEVER.equals(definition.target().id()))
        retrieverAccess.require(subject, Verb.VIEW);
      return policies.agentAccess(subject, definition.target(), definition.ownerFacts());
    });
  }

  private record AgentDefinitionFacts(ObjectTarget target, OwnerFacts ownerFacts) {}

  private static AgentDefinitionFacts agentDefinitionFacts(SubjectContext subject, Map<String, Object> parameters) {
    if (!(parameters.get("primaryKey") instanceof String id) || id.isBlank())
      throw AgentHttpException.invalid("An agent definition ID is required");
    var target = new ObjectTarget(subject.identity().domainId(), Kind.AGENT, id);
    if (OntologyAgentStore.RETRIEVER.equals(id))
      return new AgentDefinitionFacts(target, new OwnerFacts(null, DefinitionState.PUBLISHED));
    var ownerId = parameters.get("ownerId");
    if (!parameters.containsKey("ownerId") || ownerId != null && !(ownerId instanceof String))
      throw AgentHttpException.invalid("The agent definition owner is required");
    return new AgentDefinitionFacts(target, new OwnerFacts((String) ownerId, DefinitionState.PUBLISHED));
  }

  @GetMapping("/ontology/ai/agent-models/{id}")
  @Owned
  public Object agent(@PathVariable String id, HttpServletRequest request) {
    if (!OntologyAgentStore.RETRIEVER.equals(id))
      return success(agents.read(management.require(AGENTS_READ).getDomainId(), id));
    var owner = access.authenticated(request).owner();
    var subject = retrieverAccess.subject(owner);
    retrieverAccess.require(subject, Verb.VIEW);
    return success(readVisibleRetriever(subject));
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
