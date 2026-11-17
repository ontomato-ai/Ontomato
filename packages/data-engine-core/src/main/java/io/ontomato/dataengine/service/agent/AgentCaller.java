package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.schedules.ScheduleIdentity;
import io.ontomato.dataengine.service.IdentityService;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Owns caller identity and expiry. Retrieval-specific context remains with the retrieval host. */
@Service
public class AgentCaller {
  private final JdbcTemplate jdbc;
  private final ScheduleIdentity identities;
  private final IdentityService identity;
  @org.springframework.beans.factory.annotation.Autowired
  private io.ontomato.dataengine.service.BuildTestContextService contexts;

  @org.springframework.beans.factory.annotation.Autowired
  private AgentExecutionAccess executions;

  public AgentCaller(JdbcTemplate jdbc, ScheduleIdentity identities, IdentityService identity) {
    this.jdbc=jdbc; this.identities=identities; this.identity=identity;
  }
  public record Actor(String id, io.ontomato.dataengine.core.bean.User user, long expiresAt) {
    public OntologyAgentStore.Owner owner() { return new OntologyAgentStore.Owner(user.getId(),user.getDomainId()); }
  }
  public JSONObject open(String id, String deadline) {
    var user=identity.getCurrentUser();
    if (user==null || !user.isEnable() || user.getDomainId()==null) throw new AgentHttpException(401,"UNAUTHENTICATED","A current domain member is required");
    Long credentialExpiry=identity.getCurrentCredentialExpiresAt();
    long expires=Instant.parse(deadline).toEpochMilli();
    return capture(id,user,credentialExpiry==null?expires:Math.min(expires,credentialExpiry));
  }
  public JSONObject open(String id,OntologyAgentAccess.Context context) {
    var user=identities.creator(context.owner().domainId(),context.owner().userId());
    long expires=context.expiresAt()==null?System.currentTimeMillis()+600_000:context.expiresAt();
    return capture(id,user,expires);
  }
  private JSONObject capture(String id,io.ontomato.dataengine.core.bean.User user,long expires) {
    if (user==null || !user.isEnable() || user.getDomainId()==null) throw new AgentHttpException(403,"CALLER_INVALID","Agent caller is no longer an enabled domain member");
    if (expires<=System.currentTimeMillis()) throw new AgentHttpException(403,"CALLER_EXPIRED","The initiating credential has expired; please start again");
    jdbc.update("INSERT INTO ontology_retrieval_callers(id,user_id,domain_id,input_hash,input,closed,deadline) VALUES(?,?,?,'','{}',false,?::timestamptz) ON CONFLICT DO NOTHING", UUID.fromString(id),user.getId(),user.getDomainId(),Instant.ofEpochMilli(expires).toString());
    var existing=jdbc.queryForMap("SELECT user_id,domain_id FROM ontology_retrieval_callers WHERE id=?",UUID.fromString(id));
    if (!user.getId().equals(existing.get("user_id")) || !user.getDomainId().equals(existing.get("domain_id"))) throw new AgentHttpException(403,"FORBIDDEN","Caller belongs to another identity");
    return JSONObject.of("id",id,"domainId",user.getDomainId());
  }
  public Actor restore(JSONObject ref,String domain) { return restore(ref,domain,true); }
  public Actor restore(JSONObject ref,String domain,boolean execution) {
    if (!domain.equals(ref.getString("domainId"))) throw new AgentHttpException(403,"CROSS_DOMAIN","Cross-domain agent calls are forbidden");
    var rows=jdbc.queryForList("SELECT user_id,domain_id,deadline FROM ontology_retrieval_callers WHERE id=? AND domain_id=?",UUID.fromString(AgentJson.id(ref.getString("id"))),domain);
    if (rows.isEmpty()) throw AgentHttpException.missing();
    var row=rows.getFirst();
    long expires=((java.sql.Timestamp)row.get("deadline")).getTime();
    if (execution && expires<=System.currentTimeMillis()) throw new AgentHttpException(403,"CALLER_EXPIRED","The initiating credential has expired; please start again");
    var user=execution?identity.getCurrentUser():identities.creator(domain,(String)row.get("user_id"));
    if (execution && (user==null || !row.get("user_id").equals(user.getId()) || !domain.equals(user.getDomainId()))) throw new AgentHttpException(401,"CALLER_CREDENTIAL_INVALID","The initiating credential is invalid or expired; please start again");
    if (user==null || !user.isEnable() || !domain.equals(user.getDomainId())) throw new AgentHttpException(403,"CALLER_INVALID","Agent caller is no longer an enabled domain member");
    return new Actor(ref.getString("id"),user,expires);
  }
  public JSONObject workbench(JSONObject ref,String domain,boolean readOnly) {
    var actor=restore(ref,domain,!readOnly);
    return JSONObject.of("userId",identities.hostOwner(actor.user().getId()),"domainId",domain,"expiresAt",actor.expiresAt());
  }
  public OntologyAgentAccess.Context governance(JSONObject ref,String domain,String language) { return governance(ref,domain,language,true); }
  public OntologyAgentAccess.Context governance(JSONObject ref,String domain,String language,boolean execution) {
    var actor=restore(ref,domain,execution);
    if (!identity.hasKnowledgeGovernanceAccess(actor.user().getId(),domain)) throw new AgentHttpException(403,"FORBIDDEN","Business knowledge permission is required");
    return new OntologyAgentAccess.Context(actor.owner(),null,null,null,language,actor.expiresAt(),ref.getString("id"));
  }
  public void requireQuery(Actor actor) { identity.requireQueryAccess(actor.user().getId(),actor.user().getDomainId()); }
  public OntologyAgentAccess.Context query(JSONObject ref,String domain,String language,JSONObject authority,JSONObject requestedBy,JSONObject root) { return execution(ref,domain,language,authority,requestedBy,root,null,true); }
  public OntologyAgentAccess.Context generation(JSONObject ref,String domain,String language,JSONObject authority,JSONObject requestedBy,JSONObject root) { return execution(ref,domain,language,authority,requestedBy,root,null,false); }
  public OntologyAgentAccess.Context query(JSONObject ref,String domain,String language,JSONObject authority,JSONObject requestedBy,JSONObject root,JSONObject executionActor) { return execution(ref,domain,language,authority,requestedBy,root,executionActor,true); }
  public OntologyAgentAccess.Context generation(JSONObject ref,String domain,String language,JSONObject authority,JSONObject requestedBy,JSONObject root,JSONObject executionActor) { return execution(ref,domain,language,authority,requestedBy,root,executionActor,false); }
  public io.ontomato.dataengine.core.bean.User executionUser(Actor actor,JSONObject executionActor) {
    if(executionActor==null) return actor.user();
    if(!actor.owner().domainId().equals(executionActor.getString("domainId"))) throw new AgentHttpException(403,"CROSS_DOMAIN","Execution user belongs to another domain");
    return executions.require(actor.owner().domainId(), AgentJson.text(executionActor,"userId"));
  }
  private OntologyAgentAccess.Context execution(JSONObject ref,String domain,String language,JSONObject authority,JSONObject requestedBy,JSONObject root,JSONObject executionActor,boolean query) {
    var actor=restore(ref,domain);
    var executor=executionUser(actor,executionActor);
    if(query) identity.requireQueryAccess(executor.getId(),domain);
    var permission=identities.dataPermission(domain,executor.getId());
    var classes=query?io.ontomato.dataengine.service.QueryAccessService.classScope(permission,authority.getList("classNames",String.class)):authority.getList("classNames",String.class);
    var target=io.ontomato.dataengine.service.ExecutionTarget.LIVE;
    if ("build-test".equals(authority.getString("executionKind"))) {
      if (authority.getString("executionContextId")!=null) target=contexts.require(authority.getString("executionContextId"),actor.user().getId(),domain);
      else throw new AgentHttpException(403,"BUILD_TEST_CONTEXT_REQUIRED","Build-test delegation requires its execution context");
      if (classes.isEmpty()) classes=target.classNames();
      target.requireClasses(classes);
    }
    long expires=target.testing()?Math.min(actor.expiresAt(),target.expiresAt()):actor.expiresAt();
    var access=new io.ontomato.dataengine.service.QueryAccessService.Access(executor,permission,null,null,expires,classes,target,executionActor==null?null:executor.getId(),actor.owner().userId());
    String scope=null;
    for (String candidate:query?new LinkedHashSet<>(requestedBy==null?List.of(root.getString("runId")):List.of(root.getString("runId"),requestedBy.getString("runId"))):List.<String>of()) {
      var rows=jdbc.queryForList("SELECT id FROM ontology_retrieval_callers WHERE id=? AND user_id=? AND domain_id=? AND input_hash<>''",UUID.fromString(AgentJson.id(candidate)),actor.user().getId(),domain);
      if (!rows.isEmpty()) { scope=candidate; break; }
    }
    return new OntologyAgentAccess.Context(actor.owner(),access,null,null,language,expires,scope,executionActor==null?null:executor.getId());
  }
  public OntologyAgentAccess.Context ownerContext(OntologyAgentStore.Owner owner,io.ontomato.dataengine.service.QueryAccessService.Access access,String language,long deadline) {
    if(access.expiresAt()!=null) deadline=Math.min(deadline,access.expiresAt());
    String token=null,key=null,caller=null;
    var request=org.springframework.web.context.request.RequestContextHolder.getRequestAttributes();
    if (request instanceof org.springframework.web.context.request.ServletRequestAttributes servlet) {
      caller=servlet.getRequest().getHeader("X-Ontomato-Retrieval-Caller-Id");
      if(caller!=null)authorize(JSONObject.of("id",caller),owner);
      var current=identity.getCurrentUser();
      if (current!=null && current.getId().equals(owner.userId()) && owner.domainId().equals(current.getDomainId())) {
        token=servlet.getRequest().getHeader("tk"); key=servlet.getRequest().getHeader("X-API-Key");
        Long expiry=identity.getCurrentCredentialExpiresAt();
        if(expiry!=null) deadline=Math.min(deadline,expiry);
        if(servlet.getRequest().getHeader(io.ontomato.dataengine.service.BuildTestContextService.HEADER)!=null) access=access.withTarget(contexts.resolve(servlet.getRequest()));
      }
    }
    return new OntologyAgentAccess.Context(owner,access,token,key,language,deadline,caller,access.executionUserId());
  }

  public void authorize(JSONObject ref,OntologyAgentStore.Owner owner) {
    var rows=jdbc.queryForList("SELECT user_id,domain_id FROM ontology_retrieval_callers WHERE id=?",UUID.fromString(AgentJson.id(ref.getString("id"))));
    if(rows.isEmpty() || !owner.userId().equals(rows.getFirst().get("user_id")) || !owner.domainId().equals(rows.getFirst().get("domain_id"))) throw AgentHttpException.missing();
  }

}
