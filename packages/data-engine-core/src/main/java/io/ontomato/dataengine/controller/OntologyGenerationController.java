package io.ontomato.dataengine.controller;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.service.agent.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/ontology/ai/generation")
public class OntologyGenerationController {
  private final OntologyGenerationService generation;
  private final GenerationOperations operations;
  private final OntologyAgentAccess access;
  private final OntologyAgentStore store;
  private final AgentRuntimeClient runtime;

  public OntologyGenerationController(
      OntologyGenerationService generation,
      GenerationOperations operations,
      OntologyAgentAccess access,
      OntologyAgentStore store,
      AgentRuntimeClient runtime) {
    this.generation = generation;
    this.operations = operations;
    this.access = access;
    this.store = store;
    this.runtime = runtime;
  }

  @PostMapping("/gates")
  public Object open(@RequestBody JSONObject body, HttpServletRequest request) {
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
            : new Owner(grant.getString("userId"), grant.getString("domainId"));
    if (grant != null
        && (!"ontology-generation".equals(grant.getString("purpose"))
            || !run.equals(grant.getString("runId")))) throw AgentHttpException.missing();
    var row = store.one("SELECT * FROM ontology_agent_runs WHERE id=?", uuid(run));
    store.run(row.getString("session_id"), run, owner);
    if (!row.getBooleanValue("external")) {
      var snapshot = runtime.run(owner.domainId(), run);
      if (!"running".equals(snapshot.getJSONObject("run").getString("status"))) {
        store.update("UPDATE ontology_agent_runs SET open=false WHERE id=?", uuid(run));
        throw closed();
      }
    }
    return owner;
  }

  @GetMapping("/{run}/source")
  public Object source(@PathVariable String run, HttpServletRequest request) throws Exception {
    return JSONObject.of("source", operations.source(run, owner(run, request)));
  }

  @PostMapping("/{run}/test")
  public Object test(
      @PathVariable String run, @RequestBody JSONObject body, HttpServletRequest request)
      throws Exception {
    AgentJson.fields(body, "code", "parameterDefs");
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
