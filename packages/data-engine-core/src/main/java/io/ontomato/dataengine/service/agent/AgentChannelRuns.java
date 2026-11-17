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
  public static JSONObject authority(OntologyAgentAccess.Context context) {
    var access=context.access();
    var result=JSONObject.of("classNames",access==null?List.of():access.classNames(),"executionKind",access!=null && access.target().testing()?"build-test":"live");
    if (access!=null && access.target().testing()) result.put("executionContextId",access.target().contextId());
    return result;
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
  public JSONObject send(String agentId,String session,String run,JSONObject input,JSONObject parameters,OntologyAgentAccess.Context context) throws Exception {
    return send(agentId,session,run,input,parameters,context,null);
  }
  public JSONObject send(String agentId,String session,String run,JSONObject input,JSONObject parameters,OntologyAgentAccess.Context context,String sourceRun) throws Exception {
    var actor=callers.open(UUID.randomUUID().toString(),context);
    var agent=JSONObject.of("providerId","ontology","agentId",agentId);
    String domain=context.owner().domainId();
    runtime.json(domain,run,"/v1/channel/sessions/"+session+"/bind","POST",JSONObject.of("agent",agent,"actor",actor),null);
    var source=JSONObject.of("session",JSONObject.of("providerId","ontology","sessionId",session),"runId",run);
    var request=JSONObject.of("language",context.language(),"input",input,"channel",JSONObject.of("agent",agent,"actor",actor,"authority",authority(context),"requestedBy",null,"root",source));
    if(sourceRun==null) admissionCredential(request,context);
    else request.put("credentialFrom",sourceRun);
    if (parameters!=null) request.put("context",parameters);
    return runtime.json(domain,run,"/v1/channel/sessions/"+session+"/runs","POST",request,run);
  }
}
