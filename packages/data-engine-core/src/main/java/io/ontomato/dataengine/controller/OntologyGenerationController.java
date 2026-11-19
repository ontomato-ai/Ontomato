package io.ontomato.dataengine.controller;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.ControllerConst;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.service.agent.*;
import io.ontomato.dataengine.service.impl.ActionDraftService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/ontology/ai/generation")
public class OntologyGenerationController {
  @org.springframework.beans.factory.annotation.Autowired
  private io.ontomato.dataengine.service.agent.AgentExecutionAccess executions;

  @org.springframework.beans.factory.annotation.Autowired
  private PlatformAuthoringService platform;

  private final OntologyGenerationService generation;
  private final GenerationOperations operations;
  private final OntologyAgentAccess access;
  private final OntologyAgentStore store;
  private final AgentRuntimeClient runtime;
  private final ActionDraftService drafts;

  public OntologyGenerationController(
      OntologyGenerationService generation,
      GenerationOperations operations,
      OntologyAgentAccess access,
      OntologyAgentStore store,
      AgentRuntimeClient runtime,
      ActionDraftService drafts) {
    this.generation = generation;
    this.operations = operations;
    this.access = access;
    this.store = store;
    this.runtime = runtime;
    this.drafts = drafts;
  }

  @PostMapping("/platform/{kind}/{operation}")
  public Object authoring(@PathVariable String kind, @PathVariable String operation,
      @RequestBody Map<String, Object> requestBody,
      @RequestHeader(value = "Accept-Language", defaultValue = "en") String language,
      HttpServletRequest request) throws Exception {
    access.service(request);
    var body = JSONObject.from(requestBody);
    AgentJson.fields(body, "run", "input");
    if (!(body.get("run") instanceof Map<?, ?>) || !(body.get("input") instanceof Map<?, ?>))
      throw AgentHttpException.invalid("run and input must be objects");
    return platform.operate(kind, operation, PlatformAuthoringService.Run.parse(body.getJSONObject("run")),
        body.getJSONObject("input"), language);
  }

  @PostMapping("/platform/{run}/close")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void closeAuthoring(@PathVariable String run, @RequestBody Map<String, Object> requestBody,
      HttpServletRequest request) throws Exception {
    access.service(request);
    var body = JSONObject.from(requestBody);
    AgentJson.fields(body, "domainId", "ownerId", "sessionId", "outcome");
    platform.close(AgentJson.id(run), AgentJson.id(body.getString("sessionId")),
        new Owner(AgentJson.text(body, "ownerId"), AgentJson.text(body, "domainId")), AgentJson.text(body, "outcome"));
  }

  @PostMapping("/{run}/authoring/{kind}/{operation}")
  public Object externalAuthoring(@PathVariable String run, @PathVariable String kind,
      @PathVariable String operation, @RequestBody Map<String, Object> input,
      HttpServletRequest request) throws Exception {
    access.authenticated(request);
    return platform.operateExternal(AgentJson.id(run), kind, operation, JSONObject.from(input), access.current(request));
  }

  @GetMapping("/{run}/helpers")
  public Object helpers(@PathVariable String run, HttpServletRequest request) throws Exception {
    owner(run, request);
    return JSONObject.of("markdown", PythonHelperDocs.markdown());
  }

  @PostMapping("/gates")
  public Object open(@RequestBody JSONObject body, HttpServletRequest request) {
    access.authenticated(request);
    AgentJson.fields(body, "kind", "source");
    return generation.open(
        AgentJson.text(body, "kind"),
        UUID.randomUUID().toString(),
        body.getString("source"),
        access.current(request).owner(),
        true);
  }

  private Owner owner(String run, HttpServletRequest request) throws Exception {
    AgentJson.id(run);
    var grant = (JSONObject) request.getAttribute(QueryGrantService.ATTRIBUTE);
    Owner owner =
        grant == null
            ? access.current(request).owner()
            : new Owner(grant.getString("initiatorUserId")==null?grant.getString("userId"):grant.getString("initiatorUserId"), grant.getString("domainId"));
    if (grant != null
        && (!"ontology-generation".equals(grant.getString("purpose"))
            || !run.equals(grant.getString("runId")))) throw AgentHttpException.missing();
    var row = store.one("SELECT * FROM ontology_agent_runs WHERE id=?", uuid(run));
    store.run(row.getString("session_id"), run, owner);
    if(grant==null && row.getJSONObject("request").getString("executionUserId")!=null)
      executions.require(owner.domainId(),row.getJSONObject("request").getString("executionUserId"));
    // A skill callback writes only while its run is running; the lifecycle view is enough to tell.
    if (!row.getBooleanValue("external")
        && !"running".equals(runtime.status(owner.domainId(), run).getString("status"))) {
      store.update("UPDATE ontology_agent_runs SET open=false WHERE id=? AND open", uuid(run));
      throw closed();
    }
    return owner;
  }

  @GetMapping("/{run}/source")
  public Object source(@PathVariable String run, HttpServletRequest request) throws Exception {
    return JSONObject.of("source", operations.source(run, owner(run, request)));
  }

  /**
   * Re-runs the explain agent for the current conversation's newest draft. This is a tool of the
   * action-creation agent, so chat can refresh the right-hand structured definition without
   * changing the action code.
   */
  @PostMapping("/{run}/explainDraft")
  public Object explainDraft(@PathVariable String run, HttpServletRequest request) throws Exception {
    Owner owner = owner(run, request);
    var row = store.one("SELECT session_id FROM ontology_agent_runs WHERE id=?", uuid(run));
    String lang = request.getHeader(ControllerConst.LANG_HEADER_KEY);
    if (lang == null || lang.isBlank()) {
      JSONObject snapshot = runtime.run(owner.domainId(), run);
      lang = snapshot.getJSONObject("run").getString("language");
    }
    return drafts.explainLatest(row.getString("session_id"), lang, owner);
  }

  @PostMapping("/{run}/test")
  public Object test(
      @PathVariable String run, @RequestBody JSONObject body, HttpServletRequest request)
      throws Exception {
    AgentJson.fields(body, "code", "sourceAnalysis", "parameterDefs", "queryPackage", "columnLabels");
    return operations.test(run, owner(run, request), body);
  }

  @PostMapping("/{run}/prepare")
  public Object prepare(
      @PathVariable String run, @RequestBody JSONObject body, HttpServletRequest request)
      throws Exception {
    AgentJson.fields(body, "objDatas", "relDatas", "vectorDatas");
    return operations.prepare(run, owner(run, request), body);
  }

  @PostMapping("/{run}/reset")
  public Object reset(@PathVariable String run, HttpServletRequest request) throws Exception {
    return operations.reset(run, owner(run, request));
  }

  @PostMapping("/{run}/query")
  public Object query(
      @PathVariable String run, @RequestBody JSONObject body, HttpServletRequest request)
      throws Exception {
    AgentJson.fields(body, "dsl");
    return operations.query(run, owner(run, request), body);
  }

  @PostMapping("/{run}/close")
  public Object close(@PathVariable String run, HttpServletRequest request) throws Exception {
    Owner owner = owner(run, request);
    var row = store.one("SELECT session_id FROM ontology_agent_runs WHERE id=?", uuid(run));
    generation.close(row.getString("session_id"), run, owner);
    return JSONObject.of("closed", true);
  }
}
