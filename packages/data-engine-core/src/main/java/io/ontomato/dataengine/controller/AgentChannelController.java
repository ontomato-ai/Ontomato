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
  private final OntologyAgentAccess access;
  private final AgentCaller callers;
  private final AgentDirectory directory;
  private final KnowledgeGovernanceService governance;
  private final OntologyRetrievalService retrieval;
  private final RetrievalTasks retrievalTasks;
  private final ActionCreationService actions;
  private final OntologyGenerationService generation;
  private final OntologyAgentStore store;
  private final AgentRuntimeClient runtime;
  private final WorkbenchServiceAuthentication services;
  public AgentChannelController(AgentCaller callers,AgentDirectory directory,KnowledgeGovernanceService governance,OntologyAgentStore store,AgentRuntimeClient runtime,WorkbenchServiceAuthentication services,OntologyRetrievalService retrieval,RetrievalTasks retrievalTasks,ActionCreationService actions,OntologyGenerationService generation,OntologyAgentAccess access) {
    this.access=access;
    this.retrieval=retrieval;this.retrievalTasks=retrievalTasks;this.actions=actions;this.generation=generation;
    this.callers=callers; this.directory=directory; this.governance=governance; this.store=store; this.runtime=runtime; this.services=services;
  }
  private JSONObject body(Map<String,Object> body) { return JSONObject.from(body); }
  private String domain(HttpServletRequest request) {
    services.authenticate(request);
    String domain=request.getHeader("X-Domain-Id");
    if (domain==null || domain.isBlank()) throw AgentHttpException.invalid("Domain is required");
    return domain;
  }
  private JSONObject taskActor(String task,OntologyAgentAccess.Context context) throws Exception {
    var ref=runtime.json(context.owner().domainId(),task,"/v1/channel/tasks/"+AgentJson.id(task)+"/actor","GET",null,null).getJSONObject("actor");
    callers.authorize(ref,context.owner());return ref;
  }
  private JSONObject sessionActor(JSONObject session,OntologyAgentAccess.Context context) throws Exception {
    AgentJson.fields(session,"providerId","sessionId");
    String provider=AgentJson.text(session,"providerId"),id=AgentJson.id(session.getString("sessionId"));
    var ref=runtime.json(context.owner().domainId(),id,"/v1/channel/providers/"+java.net.URLEncoder.encode(provider,java.nio.charset.StandardCharsets.UTF_8)+"/sessions/"+id+"/actor","GET",null,null).getJSONObject("actor");
    callers.authorize(ref,context.owner());return ref;
  }
  private String validateCommand(JSONObject command) {
    String op=AgentJson.text(command,"op");
    switch(op) {
      case "list" -> AgentJson.fields(command,"op","query");
      case "start" -> { AgentJson.fields(command,"op","agent","message","title","context");
        if(!(command.get("agent") instanceof Map)) throw AgentHttpException.invalid("agent must be an object");
        var ref=command.getJSONObject("agent");AgentJson.fields(ref,"providerId","agentId");AgentJson.text(ref,"providerId");AgentJson.text(ref,"agentId");AgentJson.text(command,"message"); }
      case "send" -> { AgentJson.fields(command,"op","session","message","steer","needsInput","replyTo","defaultAssumption");
        if(!(command.get("session") instanceof Map)) throw AgentHttpException.invalid("An external caller must name a provider/sessionId");
        var ref=command.getJSONObject("session");AgentJson.fields(ref,"providerId","sessionId");AgentJson.text(ref,"providerId");AgentJson.id(ref.getString("sessionId"));AgentJson.text(command,"message");
        if(command.containsKey("replyTo")) AgentJson.id(command.getString("replyTo"));
        if(command.getBooleanValue("needsInput")) AgentJson.text(command,"defaultAssumption"); }
      case "read" -> { AgentJson.fields(command,"op","taskId","view","cursor","limit","files");AgentJson.id(command.getString("taskId")); }
      case "cancel" -> { AgentJson.fields(command,"op","taskId");AgentJson.id(command.getString("taskId")); }
      default -> throw AgentHttpException.invalid("Unknown agent command");
    }
    return op;
  }
  @PostMapping("/commands")
  public Object commands(@RequestBody Map<String,Object> input,HttpServletRequest request) throws Exception {
    var command=body(input);String op=validateCommand(command);var context=access.authenticated(request);
    JSONObject actor;
    if(op.equals("read") || op.equals("cancel")) actor=taskActor(command.getString("taskId"),context);
    else {
      if(op.equals("send")) sessionActor(command.getJSONObject("session"),context);
      actor=callers.open(UUID.randomUUID().toString(),context);
    }
    return runtime.json(context.owner().domainId(),actor.getString("id"),"/v1/channel/commands","POST",JSONObject.of("actor",actor,"authority",JSONObject.of("classNames",List.of(),"executionKind","live"),"language",context.language(),"command",command),null);
  }
  @GetMapping("/tasks/{task}/events")
  public org.springframework.http.ResponseEntity<org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody> events(@PathVariable String task,HttpServletRequest request) throws Exception {
    var context=access.authenticated(request);var actor=taskActor(AgentJson.id(task),context);
    var upstream=runtime.stream(context.owner().domainId(),task,"/v1/channel/tasks/"+task+"/events?actorId="+actor.getString("id"));
    return org.springframework.http.ResponseEntity.ok().contentType(org.springframework.http.MediaType.TEXT_EVENT_STREAM).header("Cache-Control","no-cache, no-transform").header("X-Accel-Buffering","no")
      .body(output -> { try(var body=upstream.body()) {body.transferTo(output);} });
  }
  @GetMapping("/tasks/{task}/files/{file}")
  public org.springframework.http.ResponseEntity<org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody> file(@PathVariable String task,@PathVariable String file,HttpServletRequest request) throws Exception {
    var context=access.authenticated(request);var actor=taskActor(AgentJson.id(task),context);
    var upstream=runtime.stream(context.owner().domainId(),task,"/v1/channel/tasks/"+task+"/files/"+AgentJson.id(file)+"?actorId="+actor.getString("id"));
    return org.springframework.http.ResponseEntity.ok().contentType(org.springframework.http.MediaType.parseMediaType(upstream.headers().firstValue("content-type").orElse("application/octet-stream")))
      .body(output -> {try(var body=upstream.body()) {body.transferTo(output);} });
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
    var ref=body.getJSONObject("agent");
    if(!"ontology".equals(ref.getString("providerId"))) throw AgentHttpException.missing();
    String agent=ref.getString("agentId"),session=AgentJson.id(body.getString("sessionId")),run=AgentJson.id(body.getString("runId"));
    String kind=OntologyGenerationService.kindForAgent(agent);
    if(!KnowledgeGovernanceService.AGENT.equals(agent) && !OntologyAgentStore.RETRIEVER.equals(agent) && !ActionCreationService.AGENT.equals(agent) && kind==null) throw AgentHttpException.missing();
    var authority=body.getJSONObject("authority");
    if("build-test".equals(authority.getString("executionKind")) && (body.getJSONObject("requestedBy")!=null || kind==null)) throw new AgentHttpException(422,"BUILD_TEST_UNSUPPORTED","The agent channel is not available in a build-test execution");
    var actor=body.getJSONObject("actor");String language=body.getString("language");
    OntologyAgentAccess.Context context=KnowledgeGovernanceService.AGENT.equals(agent)?callers.governance(actor,domain,language):
      kind!=null?callers.generation(actor,domain,language,authority,body.getJSONObject("requestedBy"),body.getJSONObject("root")):
      callers.query(actor,domain,language,authority,body.getJSONObject("requestedBy"),body.getJSONObject("root"));
    boolean steer="steer".equals(body.getString("mode"));
    JSONObject prepared;
    if(OntologyAgentStore.RETRIEVER.equals(agent)) {
      if(steer) return retrieval.prepareSteer(session,run,body.getJSONObject("input"),context);
      prepared=retrieval.prepareRun(session,run,body.getJSONObject("input"),body.getJSONObject("context"),body.getJSONObject("root").getString("runId"),context);
    } else if(ActionCreationService.AGENT.equals(agent)) {
      if(steer) {store.run(session,run,context.owner());return JSONObject.of("accepted",true);}
      actions.authorize(context.owner());actions.create(session,context.owner());prepared=actions.prepare(session,run,body.getJSONObject("input"),context);
    } else if(kind!=null) {
      if(steer) {store.run(session,run,context.owner());return JSONObject.of("accepted",true);}
      prepared=generation.prepare(session,run,kind,body.getJSONObject("input"),body.getJSONObject("context"),context);
    } else {
      if(steer) {store.run(session,run,context.owner());return JSONObject.of("accepted",true);}
      governance.create(session,context.owner(),false);prepared=governance.prepare(session,run,body.getJSONObject("input"),context);
    }
    var narrowed=AgentJson.copy(authority);
    if(context.access()!=null) {
      narrowed.put("classNames",context.access().classNames());
      if(context.access().target().testing()) narrowed.put("executionContextId",context.access().target().contextId());
    }
    prepared.put("authority",narrowed);return prepared;
  }
  private void validatePrepare(JSONObject body) {
    AgentJson.fields(body,"mode","language","agent","sessionId","runId","actor","input","authority","requestedBy","root","context");
    String mode=AgentJson.text(body,"mode");
    AgentJson.text(body,"language");
    if (!List.of("run","steer").contains(mode)) throw AgentHttpException.invalid("Unknown prepare mode");
    for (String field:List.of("agent","actor","input","authority","root")) if (!(body.get(field) instanceof Map)) throw AgentHttpException.invalid(field+" must be an object");
    var input=body.getJSONObject("input");
    String role=AgentJson.text(input,"role");
    if (!List.of("user","notification").contains(role)) throw AgentHttpException.invalid("Unknown input role");
    String content=AgentJson.text(input,"content");
    String agent=body.getJSONObject("agent").getString("agentId");
    if(KnowledgeGovernanceService.AGENT.equals(agent) || ActionCreationService.AGENT.equals(agent)) KnowledgeGovernanceService.validateMessage(content);
    if (role.equals("notification")) {
      if (!List.of("agent-message","agent-result","agent-question","agent-answer").contains(input.getString("kind"))) throw AgentHttpException.invalid("Unknown notification kind");
      if (input.containsKey("replyTo")) AgentJson.id(input.getString("replyTo"));
    }
  }
  private record Execution(String session,String run,String agent,AgentCaller.Actor actor) {}
  private Execution execution(JSONObject body,HttpServletRequest request) {
    var actor=callers.restore(body.getJSONObject("actor"),domain(request),false);
    var execution=body.getJSONObject("execution"); var session=execution.getJSONObject("session");
    if (!"ontology".equals(session.getString("providerId"))) throw AgentHttpException.missing();
    String id=AgentJson.id(session.getString("sessionId")),run=AgentJson.id(execution.getString("runId"));
    var record=store.session(id,actor.owner());
    store.run(id,run,actor.owner());
    return new Execution(id,run,record.getString("agent_id"),actor);
  }
  @PostMapping("/settle")
  public JSONObject settle(@RequestBody Map<String,Object> input,HttpServletRequest request) throws Exception {
    var execution=execution(body(input),request);
    store.run(execution.session(),execution.run(),execution.actor().owner());
    if(OntologyAgentStore.RETRIEVER.equals(execution.agent())) {
      store.update("UPDATE ontology_agent_runs SET runtime_admitted=true WHERE id=?",UUID.fromString(execution.run()));
      retrieval.reconcile(execution.session(),execution.run(),execution.actor().owner(),runtime.run(execution.actor().owner().domainId(),execution.run()));
    } else if(ActionCreationService.AGENT.equals(execution.agent())) actions.settle(execution.run());
    else if(KnowledgeGovernanceService.AGENT.equals(execution.agent())) governance.settle(execution.run());
    else generation.settleProvider(execution.session(),execution.run(),execution.actor().owner());
    return JSONObject.of("accepted",true);
  }
  @PostMapping("/cancel")
  public JSONObject cancel(@RequestBody Map<String,Object> input,HttpServletRequest request) {
    var execution=execution(body(input),request);
    if(OntologyAgentStore.RETRIEVER.equals(execution.agent())) retrieval.cancelProvider(execution.session(),execution.run(),execution.actor().owner());
    else if(ActionCreationService.AGENT.equals(execution.agent())) actions.cancelProvider(execution.session(),execution.run(),execution.actor().owner());
    else if(KnowledgeGovernanceService.AGENT.equals(execution.agent())) store.closeRun(execution.session(),execution.run(),execution.actor().owner());
    else generation.cancelProvider(execution.session(),execution.run(),execution.actor().owner());
    return JSONObject.of("accepted",true);
  }
  @PostMapping("/read")
  public Object read(@RequestBody Map<String,Object> input,HttpServletRequest request) throws Exception {
    var execution=execution(body(input),request); var owner=execution.actor().owner();
    if(KnowledgeGovernanceService.AGENT.equals(execution.agent())) callers.governance(body(input).getJSONObject("actor"),owner.domainId(),"en",false);
    else if(OntologyAgentStore.RETRIEVER.equals(execution.agent()) || ActionCreationService.AGENT.equals(execution.agent())) callers.requireQuery(execution.actor());
    String fileId=body(input).getString("fileId");
    if(fileId!=null) {
      AgentJson.id(fileId);
      if(OntologyAgentStore.RETRIEVER.equals(execution.agent())) {
        boolean delivered=retrieval.deliveries(execution.session(),execution.run(),owner).stream().anyMatch(delivery -> delivery.getJSONObject("data").getJSONArray("datasets").stream().map(JSONObject::from).anyMatch(dataset -> fileId.equals(dataset.getString("id"))));
        if(!delivered) throw AgentHttpException.missing();
        return org.springframework.http.ResponseEntity.ok().contentType(org.springframework.http.MediaType.APPLICATION_JSON).body(retrieval.datasetContent(execution.session(),fileId,owner));
      }
      var files=runtime.json(owner.domainId(),execution.run(),"/v1/runs/"+execution.run()+"/artifacts","GET",null,null).getJSONArray("artifacts");
      var artifact=files.stream().map(JSONObject::from).filter(file -> fileId.equals(file.getString("id")) && execution.run().equals(file.getString("runId")) && file.getString("path").startsWith("outputs/")).findFirst().orElseThrow(AgentHttpException::missing);
      return org.springframework.http.ResponseEntity.ok().contentType(org.springframework.http.MediaType.parseMediaType(artifact.getString("mediaType"))).body(runtime.bytes(owner.domainId(),execution.run(),"/v1/artifacts/"+fileId+"/content"));
    }
    if(OntologyAgentStore.RETRIEVER.equals(execution.agent())) {
      var projection=retrievalTasks.read(execution.session(),execution.run(),owner);
      String summary=projection.getString("status");
      for(var delivery:retrieval.deliveries(execution.session(),execution.run(),owner)) {
        var answer=delivery.getJSONObject("data").getString("answer");if(answer!=null && !answer.isBlank()) summary=answer;
      }
      var files=new ArrayList<JSONObject>();
      for(var delivery:retrieval.deliveries(execution.session(),execution.run(),owner)) for(Object item:delivery.getJSONObject("data").getJSONArray("datasets")) {
        String id=JSONObject.from(item).getString("id");
        files.add(JSONObject.of("id",id,"name","dataset.json","mediaType","application/json","href","/platform/agent-channel/tasks/"+execution.run()+"/files/"+id));
      }
      boolean admitted=store.run(execution.session(),execution.run(),owner).getBooleanValue("runtime_admitted");
      Object process=admitted?JSONObject.of("mode","inline","runtimeSessionId",execution.session(),"runtimeRunId",execution.run()):JSONObject.of("mode","none");
      return JSONObject.of("status",projection.getString("status"),"summary",summary,"process",process,"results",List.of(),"retrieval",projection.get("retrieval"),"quality",projection.get("quality"),"files",files);
    }
    var status=runtime.status(owner.domainId(),execution.run());
    String state="running".equals(status.getString("status"))?"running":"aborted".equals(status.getString("stopReason"))?"cancelled":"stop".equals(status.getString("stopReason"))?"completed":"failed";
    String summary=state;
    if("completed".equals(state)) {
      var reply=runtime.json(owner.domainId(),execution.run(),"/v1/runs/"+execution.run()+"/final-reply","GET",null,null);
      if(reply!=null) {StringBuilder text=new StringBuilder();for(Object item:reply.getJSONArray("content")){var block=JSONObject.from(item);if("text".equals(block.getString("type")))text.append(block.getString("text"));}summary=text.toString();}
    }
    Object process=JSONObject.of("mode","inline","runtimeSessionId",execution.session(),"runtimeRunId",execution.run());
    var results=new ArrayList<JSONObject>();
    if(KnowledgeGovernanceService.AGENT.equals(execution.agent())) {
      var work=store.one("SELECT work FROM ontology_governance_work WHERE run_id=?",UUID.fromString(execution.run())).getJSONObject("work");
      summary=work.getString("summary");String href="/governance/chat/"+execution.session();
      process=JSONObject.of("mode","page","href",href);results.add(JSONObject.of("kind","page","href",href,"title","Governance record"));
    }
    var files=new ArrayList<JSONObject>();
    for(Object item:runtime.json(owner.domainId(),execution.run(),"/v1/runs/"+execution.run()+"/artifacts","GET",null,null).getJSONArray("artifacts")) {
      var file=JSONObject.from(item);String path=file.getString("path");
      if(execution.run().equals(file.getString("runId")) && path.startsWith("outputs/")) files.add(JSONObject.of("id",file.getString("id"),"name",path.substring(path.lastIndexOf('/')+1),"mediaType",file.getString("mediaType"),"href","/platform/agent-channel/tasks/"+execution.run()+"/files/"+file.getString("id")));
    }
    return JSONObject.of("status",state,"summary",summary,"process",process,"results",results,"quality",List.of(),"files",files);
  }
}
