package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.agent.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/platform/agent-channel")
public class AgentChannelController {
  private final AgentCaller callers;
  private final AgentDirectory directory;
  private final KnowledgeGovernanceService governance;
  private final OntologyAgentStore store;
  private final AgentRuntimeClient runtime;
  private final WorkbenchServiceAuthentication services;
  public AgentChannelController(AgentCaller callers,AgentDirectory directory,KnowledgeGovernanceService governance,OntologyAgentStore store,AgentRuntimeClient runtime,WorkbenchServiceAuthentication services) {
    this.callers=callers; this.directory=directory; this.governance=governance; this.store=store; this.runtime=runtime; this.services=services;
  }
  private JSONObject body(Map<String,Object> body) { return JSONObject.from(body); }
  private String domain(HttpServletRequest request) {
    services.authenticate(request);
    String domain=request.getHeader("X-Domain-Id");
    if (domain==null || domain.isBlank()) throw AgentHttpException.invalid("Domain is required");
    return domain;
  }
  @PostMapping("/callers")
  public JSONObject open(@RequestBody Map<String,Object> input) {
    var body=body(input); AgentJson.fields(body,"id","deadlineAt");
    return callers.open(AgentJson.id(body.getString("id")),body.getString("deadlineAt"));
  }
  @PostMapping("/restore")
  public JSONObject restore(@RequestBody Map<String,Object> input,HttpServletRequest request) {
    var body=body(input); return callers.workbench(body.getJSONObject("actor"),domain(request),body.getBooleanValue("readOnly"));
  }
  @PostMapping("/list")
  public JSONObject list(@RequestBody Map<String,Object> input,HttpServletRequest request) {
    var body=body(input); AgentJson.fields(body,"providerId","actor");
    if (!"ontology".equals(AgentJson.text(body,"providerId"))) throw AgentHttpException.missing();
    return directory.list(body.getJSONObject("actor"),domain(request));
  }
  @PostMapping("/prepare")
  public JSONObject prepare(@RequestBody Map<String,Object> input,HttpServletRequest request) throws Exception {
    var body=body(input); validatePrepare(body); String domain=domain(request);
    var context=callers.governance(body.getJSONObject("actor"),domain,body.getString("language"));
    var ref=body.getJSONObject("agent");
    if (!"ontology".equals(ref.getString("providerId")) || !KnowledgeGovernanceService.AGENT.equals(ref.getString("agentId"))) throw AgentHttpException.missing();
    if (!"live".equals(body.getJSONObject("authority").getString("executionKind"))) throw new AgentHttpException(403,"BUILD_TEST_FORBIDDEN","A build-test execution cannot delegate to a live governance agent");
    String session=AgentJson.id(body.getString("sessionId")),run=AgentJson.id(body.getString("runId"));
    String mode=body.getString("mode");
    if ("steer".equals(mode)) { store.run(session,run,context.owner()); return JSONObject.of("accepted",true); }
    if (!"run".equals(mode)) throw AgentHttpException.invalid("Unknown prepare mode");
    governance.create(session,context.owner(),false);
    return governance.prepare(session,run,body.getJSONObject("input"),context);
  }
  private void validatePrepare(JSONObject body) {
    AgentJson.fields(body,"mode","language","agent","sessionId","runId","actor","input","authority","context");
    String mode=AgentJson.text(body,"mode");
    AgentJson.text(body,"language");
    if (!List.of("run","steer").contains(mode)) throw AgentHttpException.invalid("Unknown prepare mode");
    for (String field:List.of("agent","actor","input","authority")) if (!(body.get(field) instanceof Map)) throw AgentHttpException.invalid(field+" must be an object");
    var input=body.getJSONObject("input");
    String role=AgentJson.text(input,"role");
    if (!List.of("user","notification").contains(role)) throw AgentHttpException.invalid("Unknown input role");
    KnowledgeGovernanceService.validateMessage(AgentJson.text(input,"content"));
    if (role.equals("notification")) {
      if (!List.of("agent-message","agent-result","agent-question","agent-answer").contains(input.getString("kind"))) throw AgentHttpException.invalid("Unknown notification kind");
      if (input.containsKey("replyTo")) AgentJson.id(input.getString("replyTo"));
    }
  }
  private record Execution(String session,String run,AgentCaller.Actor actor) {}
  private Execution execution(JSONObject body,HttpServletRequest request) {
    var actor=callers.restore(body.getJSONObject("actor"),domain(request),false);
    var execution=body.getJSONObject("execution"); var session=execution.getJSONObject("session");
    if (!"ontology".equals(session.getString("providerId"))) throw AgentHttpException.missing();
    String id=AgentJson.id(session.getString("sessionId")),run=AgentJson.id(execution.getString("runId"));
    var record=store.session(id,actor.owner());
    if (!KnowledgeGovernanceService.AGENT.equals(record.getString("agent_id"))) throw AgentHttpException.missing();
    return new Execution(id,run,actor);
  }
  @PostMapping("/settle")
  public JSONObject settle(@RequestBody Map<String,Object> input,HttpServletRequest request) {
    var execution=execution(body(input),request);
    store.run(execution.session(),execution.run(),execution.actor().owner());
    governance.settle(execution.run());
    return JSONObject.of("accepted",true);
  }
  @PostMapping("/cancel")
  public JSONObject cancel(@RequestBody Map<String,Object> input,HttpServletRequest request) {
    var execution=execution(body(input),request);
    store.closeRun(execution.session(),execution.run(),execution.actor().owner());
    return JSONObject.of("accepted",true);
  }
  @PostMapping("/read")
  public JSONObject read(@RequestBody Map<String,Object> input,HttpServletRequest request) throws Exception {
    var execution=execution(body(input),request); var owner=execution.actor().owner();
    callers.governance(body(input).getJSONObject("actor"),owner.domainId(),"en",false);
    store.run(execution.session(),execution.run(),owner);
    var status=runtime.status(owner.domainId(),execution.run());
    String state="running".equals(status.getString("status"))?"running":
      "aborted".equals(status.getString("stopReason"))?"cancelled":"stop".equals(status.getString("stopReason"))?"completed":"failed";
    var work=store.one("SELECT work FROM ontology_governance_work WHERE run_id=?",UUID.fromString(execution.run())).getJSONObject("work");
    String href="/governance/chat/"+execution.session();
    return JSONObject.of("status",state,"summary",work.getString("summary"),"process",JSONObject.of("mode","page","href",href),
      "results",List.of(JSONObject.of("kind","page","href",href,"title","Governance record")));
  }
}
