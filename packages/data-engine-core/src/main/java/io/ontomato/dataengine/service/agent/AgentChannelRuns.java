package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.JSONObject;
import java.util.*;
import org.springframework.stereotype.Service;

/** Host entry points reserve through the runtime; provider preparation never calls this entry again. */
@Service
public class AgentChannelRuns {
  private final AgentCaller callers;
  private final AgentRuntimeClient runtime;
  public AgentChannelRuns(AgentCaller callers,AgentRuntimeClient runtime) { this.callers=callers; this.runtime=runtime; }
  private static JSONObject authority(OntologyAgentAccess.Context context,boolean preview) {
    var access=context.access();
    return JSONObject.of("classNames",access==null?List.of():access.classNames(),"executionKind",preview?"preview":"live");
  }
  /** The credential is transport data, never stored with a caller, intent or binding. */
  public static JSONObject credential(OntologyAgentAccess.Context context) {
    return JSONObject.of("token",context.token(),"apiKey",context.apiKey());
  }
  public static void admissionCredential(JSONObject request,OntologyAgentAccess.Context context) {
    var grant=context.access()==null?null:context.access().grant();
    if(grant!=null) request.put("credentialFrom",grant.getString("runId"));
    else if(context.callerId()!=null)request.put("credentialFrom",context.callerId());
    else request.put("credential",credential(context));
  }
  /** `preview` starts the run as the preview's: what it executes is refused where it would run, as for its delegates. */
  public JSONObject send(String agentId,String session,String run,JSONObject input,JSONObject parameters,OntologyAgentAccess.Context context,String sourceRun,boolean human,boolean preview) throws Exception {
    var actor=callers.open(UUID.randomUUID().toString(),context);
    var agent=JSONObject.of("providerId","ontology","agentId",agentId);
    String domain=context.owner().domainId();
    runtime.json(domain,run,"/v1/channel/sessions/"+session+"/bind","POST",JSONObject.of("agent",agent,"actor",actor),null);
    var source=JSONObject.of("session",JSONObject.of("providerId","ontology","sessionId",session),"runId",run);
    var request=JSONObject.of("language",context.language(),"input",input,"channel",JSONObject.of("agent",agent,"actor",actor,"authority",authority(context,preview),"requestedBy",null,"root",source));
    if(sourceRun==null) admissionCredential(request,context);
    else request.put("credentialFrom",sourceRun);
    var channelContext=request.getJSONObject("channel");
    channelContext.put("userRecipient",human && request.containsKey("credential") ? JSONObject.of("session",source.getJSONObject("session"),"actor",actor) : null);
    if("agent-answer".equals(input.getString("kind"))) input.put("respondent",actor);
    if (parameters!=null) request.put("context",parameters);
    return runtime.json(domain,run,"/v1/channel/sessions/"+session+"/runs","POST",request,run);
  }
}
