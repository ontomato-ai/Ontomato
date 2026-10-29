package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.service.agent.*;
import io.ontomato.dataengine.service.agent.OntologyAgentStore.Owner;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/ontology/ai/knowledge-governance")
public class KnowledgeGovernanceController {
  private final KnowledgeGovernanceService governance;
  private final OntologyAgentAccess access;
  public KnowledgeGovernanceController(KnowledgeGovernanceService governance,OntologyAgentAccess access) {
    this.governance=governance;this.access=access;
  }
  @GetMapping("/{id}/work")
  public Object work(@PathVariable String id,HttpServletRequest request) {
    return governance.work(AgentJson.id(id),access.governance(request).owner());
  }
  @GetMapping("/{id}/sources/{source}")
  public Object source(@PathVariable String id,@PathVariable String source,
      @RequestParam(defaultValue="0") int offset,HttpServletRequest request) throws Exception {
    return governance.readSource(AgentJson.id(id),source,offset,access.governance(request).owner());
  }
  @PostMapping("/skill-runs")
  @ResponseStatus(HttpStatus.CREATED)
  public Object begin(@RequestHeader("Idempotency-Key") String key,@RequestBody JSONObject input,
      HttpServletRequest request) throws Exception {
    return governance.begin(AgentJson.id(key),input,access.governance(request));
  }
  @PostMapping("/{id}/skill-runs/{run}/close")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void close(@PathVariable String id,@PathVariable String run,HttpServletRequest request) throws Exception {
    governance.cancel(AgentJson.id(id),AgentJson.id(run),access.governance(request).owner());
  }
  @PostMapping("/{id}/runs/{run}/actions/{action}")
  public Object action(@PathVariable String id,@PathVariable String run,@PathVariable String action,
      @RequestBody JSONObject input,HttpServletRequest request) throws Exception {
    AgentJson.id(id);AgentJson.id(run);
    if (!id.equals(request.getHeader("X-Ontomato-Session-Id")) || !run.equals(request.getHeader("X-Ontomato-Run-Id")))
      throw AgentHttpException.invalid("Run identity mismatch");
    var grant=(JSONObject)request.getAttribute(QueryGrantService.ATTRIBUTE);
    Owner owner;
    if (grant==null) owner=access.governance(request).owner();
    else {
      if (!"knowledge-governance".equals(grant.getString("purpose")) || !run.equals(grant.getString("runId")))
        throw AgentHttpException.missing();
      owner=new Owner(grant.getString("userId"),grant.getString("domainId"));
    }
    return governance.action(id,run,action,input,owner);
  }
}
