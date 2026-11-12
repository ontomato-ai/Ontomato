package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.schedules.ScheduleIdentity;
import io.ontomato.dataengine.schedules.TaskCredentials;
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
  private final TaskCredentials credentials;
  private final IdentityService identity;

  public AgentCaller(JdbcTemplate jdbc, ScheduleIdentity identities, TaskCredentials credentials, IdentityService identity) {
    this.jdbc=jdbc; this.identities=identities; this.credentials=credentials; this.identity=identity;
  }
  public record Actor(String id, io.ontomato.dataengine.core.bean.User user, long expiresAt) {
    public OntologyAgentStore.Owner owner() { return new OntologyAgentStore.Owner(user.getId(),user.getDomainId()); }
  }
  public JSONObject open(String id, String deadline) {
    var user=identity.getCurrentUser();
    if (user==null || !user.isEnable() || user.getDomainId()==null) throw new AgentHttpException(401,"UNAUTHENTICATED","A current domain member is required");
    Long credentialExpiry=identity.getCurrentCredentialExpiresAt();
    long expires=Instant.parse(deadline).toEpochMilli();
    return capture(id,user,credentialExpiry==null?expires:Math.min(expires,credentialExpiry),true);
  }
  public JSONObject open(String id,OntologyAgentAccess.Context context) {
    var user=identities.creator(context.owner().domainId(),context.owner().userId());
    long expires=context.expiresAt()==null?System.currentTimeMillis()+600_000:context.expiresAt();
    return capture(id,user,expires,context.token()!=null || context.apiKey()!=null);
  }
  private JSONObject capture(String id,io.ontomato.dataengine.core.bean.User user,long expires,boolean ensureKey) {
    if (expires<=System.currentTimeMillis()) throw new AgentHttpException(403,"CALLER_EXPIRED","Agent caller has expired");
    if (ensureKey) credentials.prepareForSetup(user);
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
    if (execution && expires<=System.currentTimeMillis()) throw new AgentHttpException(403,"CALLER_EXPIRED","Agent caller has expired");
    var user=identities.creator(domain,(String)row.get("user_id"));
    if (user==null || !user.isEnable() || !domain.equals(user.getDomainId())) throw new AgentHttpException(403,"CALLER_INVALID","Agent caller is no longer an enabled domain member");
    return new Actor(ref.getString("id"),user,expires);
  }
  public JSONObject workbench(JSONObject ref,String domain,boolean readOnly) {
    var actor=restore(ref,domain,!readOnly);
    String key;
    try { key=credentials.forOwner(domain,actor.user().getId()); }
    catch (TaskCredentials.Invalid failure) { throw new AgentHttpException(403,"CALLER_CREDENTIAL_INVALID","The caller's internal credential is invalid"); }
    return JSONObject.of("userId",identities.hostOwner(actor.user().getId()),"domainId",domain,"apiKey",key,"expiresAt",actor.expiresAt());
  }
  public OntologyAgentAccess.Context governance(JSONObject ref,String domain,String language) { return governance(ref,domain,language,true); }
  public OntologyAgentAccess.Context governance(JSONObject ref,String domain,String language,boolean execution) {
    var actor=restore(ref,domain,execution);
    if (!identity.hasKnowledgeGovernanceAccess(actor.user().getId(),domain)) throw new AgentHttpException(403,"FORBIDDEN","Business knowledge permission is required");
    return new OntologyAgentAccess.Context(actor.owner(),null,null,null,language,actor.expiresAt(),ref.getString("id"));
  }
}
