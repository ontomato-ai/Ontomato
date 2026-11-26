package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.service.agent.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@Owned
@RequestMapping("/ontology/ai/knowledge-governance")
public class KnowledgeGovernanceController {
  private final KnowledgeGovernanceService governance;
  private final OntologyAgentAccess access;
  public KnowledgeGovernanceController(KnowledgeGovernanceService governance,OntologyAgentAccess access) {
    this.governance=governance;this.access=access;
  }
  @PostMapping("/skill-package")
  public AgentRuntimeClient.SkillVersion publishSkill(HttpServletRequest request) throws Exception {
    access.service(request);
    return governance.publishSkill();
  }
  @PostMapping("/platform-windows")
  public Object register(@RequestBody java.util.Map<String,Object> input,HttpServletRequest request) {
    access.service(request);
    return governance.registerPlatform(JSONObject.from(input),access.authenticated(request));
  }
  @PostMapping("/platform-windows/{run}/close")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void closePlatform(@PathVariable String run,HttpServletRequest request) {
    governance.closePlatform(AgentJson.id(run),access.serviceDomain(request));
  }
  @PostMapping("/skill-runs")
  @ResponseStatus(HttpStatus.CREATED)
  public Object begin(@RequestHeader("Idempotency-Key") String key,@RequestBody JSONObject input,
      HttpServletRequest request) throws Exception {
    return governance.begin(AgentJson.id(key),input,access.authenticated(request));
  }
  @PostMapping("/{id}/skill-runs/{run}/close")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void close(@PathVariable String id,@PathVariable String run,HttpServletRequest request) throws Exception {
    governance.closeExternal(AgentJson.id(id),AgentJson.id(run),access.authenticated(request).owner());
  }
  @PostMapping("/{id}/runs/{run}/actions/{action}")
  public Object action(@PathVariable String id,@PathVariable String run,@PathVariable String action,
      @RequestBody JSONObject input,@RequestHeader(value="Accept-Language",defaultValue="en") String language,
      HttpServletRequest request) throws Exception {
    AgentJson.id(id);AgentJson.id(run);
    if (!run.equals(request.getHeader("X-Ontomato-Run-Id")))
      throw AgentHttpException.invalid("Run identity mismatch");
    var grant=(JSONObject)request.getAttribute(QueryGrantService.ATTRIBUTE);
    if (grant!=null) return governance.delegatedAction(id,run,action,input,grant,language);
    return governance.action(id,run,action,input,access.authenticated(request).owner(),language);
  }
}
