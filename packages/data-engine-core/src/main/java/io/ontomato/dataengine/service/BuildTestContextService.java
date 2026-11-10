package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.dao.JSONRuleDao;
import jakarta.annotation.PostConstruct;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.context.annotation.DependsOn;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Durable owner of temporary build data. Cleanup is attempted once, with no automatic replay. */
@Service
@DependsOn("jdbcInitDb")
public class BuildTestContextService {
  private final java.util.concurrent.ConcurrentHashMap<String,java.util.concurrent.locks.ReentrantReadWriteLock> locks=new java.util.concurrent.ConcurrentHashMap<>();
  public java.util.concurrent.locks.ReentrantReadWriteLock lock(String id) { return locks.computeIfAbsent(id,key->new java.util.concurrent.locks.ReentrantReadWriteLock()); }
  public static final String HEADER = "X-Ontomato-Execution-Context";
  private final JdbcTemplate jdbc;
  private final IdentityService identity;
  private final SandboxService sandbox;
  private final JSONRuleDao schemas;
  private final BusinessConfigService configs;
  private final QueryGrantService grants;
  private final RuntimeCodeClient runtime;

  public BuildTestContextService(JdbcTemplate jdbc, IdentityService identity, SandboxService sandbox,
      JSONRuleDao schemas, BusinessConfigService configs, QueryGrantService grants, RuntimeCodeClient runtime) {
    this.jdbc=jdbc; this.identity=identity; this.sandbox=sandbox; this.schemas=schemas;
    this.configs=configs; this.grants=grants; this.runtime=runtime;
  }
  @PostConstruct public void initialize() {
    jdbc.execute("CREATE TABLE IF NOT EXISTS build_test_contexts (id text PRIMARY KEY, owner_id text NOT NULL, domain_id text NOT NULL, workspace_id text NOT NULL, state text NOT NULL, expires_at bigint NOT NULL, data jsonb NOT NULL, cleanup_attempted boolean NOT NULL DEFAULT false, cleanup_error text)");
    jdbc.execute("CREATE UNIQUE INDEX IF NOT EXISTS build_test_active_workspace ON build_test_contexts(owner_id,domain_id,workspace_id) WHERE state IN ('PREPARING','READY')");
    jdbc.update("UPDATE build_test_contexts SET state='PREPARE_FAILED' WHERE state='PREPARING'");
    jdbc.update("UPDATE build_test_contexts SET cleanup_error='Cleanup interrupted; result unconfirmed' WHERE cleanup_attempted=true AND cleanup_error IS NULL AND state IN ('CLOSED','EXPIRED','PREPARE_FAILED')");
  }
  private ResponseStatusException error(HttpStatus status, String code) { return new ResponseStatusException(status, code); }
  private JSONObject row(String id) {
    var rows=jdbc.queryForList("SELECT row_to_json(c)::text FROM build_test_contexts c WHERE id=?", String.class,id);
    if(rows.isEmpty()) throw error(HttpStatus.NOT_FOUND,"BUILD_TEST_CONTEXT_NOT_FOUND");
    return JSON.parseObject(rows.get(0));
  }
  private void owner(JSONObject row, String user, String domain) {
    if(!Objects.equals(row.getString("owner_id"),user) || !Objects.equals(row.getString("domain_id"),domain))
      throw error(HttpStatus.FORBIDDEN,"BUILD_TEST_FORBIDDEN");
  }
  private String fingerprint(String domain) {
    return io.ontomato.dataengine.service.agent.AgentJson.hash(JSONObject.of("schema",schemas.query(domain),"routing",configs.get(domain)));
  }
  public synchronized JSONObject create(String workspace, JSONObject input, Map<String,byte[]> attachments) throws Exception {
    identity.requireQueryAccess();
    var user=identity.getCurrentUser();
    if(workspace==null || workspace.isBlank()) throw error(HttpStatus.BAD_REQUEST,"BUILD_TEST_SAMPLE_INVALID: workspaceId required");
    JSONObject sample;
    try { sample=sandbox.validateSample(input,attachments,user.getDomainId()); }
    catch(RuntimeException invalid) { throw error(HttpStatus.BAD_REQUEST,"BUILD_TEST_SAMPLE_INVALID: "+invalid.getMessage()); }
    var classes=sample.getJSONArray("objDatas").toJavaList(JSONObject.class).stream().map(o->o.getString("className")).distinct().toList();
    if(classes.isEmpty()) throw error(HttpStatus.BAD_REQUEST,"BUILD_TEST_SAMPLE_INVALID: classes required");
    if(!QueryAccessService.classScope(identity.getCurrentUserDataPermission(),classes).containsAll(classes)) throw error(HttpStatus.FORBIDDEN,"BUILD_TEST_FORBIDDEN");
    var failed=jdbc.queryForList("SELECT id FROM build_test_contexts WHERE owner_id=? AND domain_id=? AND workspace_id=? AND cleanup_attempted=true AND (cleanup_error IS NULL OR cleanup_error <> '')",String.class,user.getId(),user.getDomainId(),workspace);
    if(!failed.isEmpty()) throw error(HttpStatus.CONFLICT,"BUILD_TEST_CLEANUP_FAILED: "+failed.get(0));
    var binding=sandbox.bindSample(sample,user.getDomainId());
    var previous=current(workspace);
    if(previous!=null) close(previous.getString("contextId"));
    String id=UUID.randomUUID().toString(), sandboxId="bt_"+id.replace("-","")+"_";
    long expires=System.currentTimeMillis()+3600000;
    if(identity.getCurrentCredentialExpiresAt()!=null) expires=Math.min(expires,identity.getCurrentCredentialExpiresAt());
    var data=JSONObject.of("sandboxId",sandboxId,"classNames",classes,"sample",sample,"fingerprint",fingerprint(user.getDomainId()),"sampleSha256",io.ontomato.dataengine.service.agent.AgentJson.hash(JSONObject.of("sample",sample,"attachments",attachments)),"binding",binding,"resources",binding.getList("resources",String.class).stream().map(name->name.replace("{sandbox}",sandboxId)).toList());
    jdbc.update("INSERT INTO build_test_contexts(id,owner_id,domain_id,workspace_id,state,expires_at,data) VALUES(?,?,?,?,'PREPARING',?,?::jsonb)",id,user.getId(),user.getDomainId(),workspace,expires,data.toJSONString());
    String stage="BUILD_TEST_SCHEMA_FAILED";
    try {
      sandbox.createSampleStructure(sandboxId,sample,user.getDomainId());
      stage="BUILD_TEST_DATA_FAILED";
      sandbox.loadSample(sandboxId,sample,attachments,user.getDomainId());
      jdbc.update("UPDATE build_test_contexts SET state='READY' WHERE id=?",id);
    } catch(Exception failure) {
      data.put("prepareError",failure.getMessage());
      jdbc.update("UPDATE build_test_contexts SET state='PREPARE_FAILED',data=?::jsonb WHERE id=?",data.toJSONString(),id);
      cleanup(row(id));
      throw error(HttpStatus.UNPROCESSABLE_ENTITY,stage+": contextId="+id+"; "+failure.getMessage());
    }
    return status(id);
  }
  public JSONObject current(String workspace) {
    identity.requireQueryAccess();
    var user=identity.getCurrentUser();
    var ids=jdbc.queryForList("SELECT id FROM build_test_contexts WHERE owner_id=? AND domain_id=? AND workspace_id=? AND state IN ('PREPARING','READY')",String.class,user.getId(),user.getDomainId(),workspace);
    return ids.isEmpty()?null:status(ids.get(0));
  }
  public JSONObject status(String id) {
    identity.requireQueryAccess();
    var r=row(id);var user=identity.getCurrentUser();owner(r,user.getId(),user.getDomainId());
    if("READY".equals(r.getString("state")) && r.getLongValue("expires_at")<=System.currentTimeMillis()) {
      jdbc.update("UPDATE build_test_contexts SET state='EXPIRED' WHERE id=? AND state='READY'",id);r=row(id);
    }
    var data=r.getJSONObject("data");
    return JSONObject.of("contextId",id,"workspaceId",r.getString("workspace_id"),"status",r.getString("state"),"expiresAt",r.getLong("expires_at"),"classNames",data.get("classNames"),"sampleSummary",JSONObject.of("classes",data.getJSONArray("classNames").size(),"sha256",data.getString("sampleSha256")),"prepareError",data.get("prepareError"),"cleanupError",r.get("cleanup_error"),"resources",data.get("resources"));
  }
  public ExecutionTarget resolve(HttpServletRequest request) {
    String header=request.getHeader(HEADER);
    if(header==null) return ExecutionTarget.LIVE;
    JSONObject declaration;
    try { declaration=JSON.parseObject(header); } catch(Exception invalid) { throw error(HttpStatus.BAD_REQUEST,"BUILD_TEST_CONTEXT_REQUIRED"); }
    if(declaration==null || !"build-test".equals(declaration.getString("kind")) || declaration.getString("contextId")==null)
      throw error(HttpStatus.BAD_REQUEST,"BUILD_TEST_CONTEXT_REQUIRED");
    var user=identity.getCurrentUser();
    var target=require(declaration.getString("contextId"),user.getId(),user.getDomainId());
    var expiry=identity.getCurrentCredentialExpiresAt();
    return expiry==null ? target : new ExecutionTarget(target.contextId(),target.sandboxId(),target.classNames(),Math.min(expiry,target.expiresAt()));
  }
  public ExecutionTarget require(String id,String user,String domain) {
    var r=row(id);owner(r,user,domain);
    if(r.getLongValue("expires_at")<=System.currentTimeMillis()) throw error(HttpStatus.GONE,"BUILD_TEST_CONTEXT_EXPIRED");
    if(!"READY".equals(r.getString("state"))) throw error("CLOSED".equals(r.getString("state"))?HttpStatus.GONE:HttpStatus.CONFLICT,"BUILD_TEST_CONTEXT_"+("CLOSED".equals(r.getString("state"))?"CLOSED":"NOT_READY"));
    var data=r.getJSONObject("data");
    if(!fingerprint(domain).equals(data.getString("fingerprint"))) throw error(HttpStatus.CONFLICT,"BUILD_TEST_CONTEXT_CHANGED");
    return new ExecutionTarget(id,data.getString("sandboxId"),data.getList("classNames",String.class),r.getLong("expires_at"));
  }
  public synchronized JSONObject close(String id) {
    identity.requireQueryAccess();
    var r=row(id);var user=identity.getCurrentUser();owner(r,user.getId(),user.getDomainId());
    jdbc.update("UPDATE build_test_contexts SET state='CLOSED' WHERE id=? AND state IN ('READY','PREPARING')",id);
    cleanup(row(id));
    var result=status(id);
    if(result.getString("cleanupError")!=null && !result.getString("cleanupError").isEmpty()) throw error(HttpStatus.INTERNAL_SERVER_ERROR,"BUILD_TEST_CLEANUP_FAILED: "+result.getString("cleanupError"));
    return result;
  }
  public synchronized JSONObject retryCleanup(String id) {
    var r=row(id);var user=identity.getCurrentUser();owner(r,user.getId(),user.getDomainId());
    identity.requireQueryAccess();
    if(List.of("READY","PREPARING").contains(r.getString("state"))) throw error(HttpStatus.CONFLICT,"BUILD_TEST_CONTEXT_NOT_READY: end before cleanup");
    jdbc.update("UPDATE build_test_contexts SET cleanup_attempted=false WHERE id=?",id);
    cleanup(row(id));return status(id);
  }
  private void cleanup(JSONObject r) {
    String id=r.getString("id"),domain=r.getString("domain_id");
    if(jdbc.update("UPDATE build_test_contexts SET cleanup_attempted=true WHERE id=? AND cleanup_attempted=false",id)!=1) return;
    try {
      grants.revokeContext(id);
      var writeLock=lock(id).writeLock();
      writeLock.lock();
      try {
      var executions=grants.revokeContext(id);
      for(String execution:executions) {
        runtime.closeIntent(domain,execution);
        var snapshot=runtime.execution(domain,execution);
        if(!List.of("stopped").contains(snapshot.getString("status")))
          throw new IllegalStateException("Execution has not stopped: "+execution);
      }
      var data=r.getJSONObject("data");
      sandbox.dropSampleStructure(data.getString("sandboxId"),data.getJSONObject("binding"),domain);
      jdbc.update("UPDATE build_test_contexts SET cleanup_error='' WHERE id=?",id);
      } finally { writeLock.unlock(); }
    } catch(Exception failure) { jdbc.update("UPDATE build_test_contexts SET cleanup_error=? WHERE id=?",failure.getMessage(),id); }
  }
  @Scheduled(fixedDelay=30000) public synchronized void expire() {
    jdbc.update("UPDATE build_test_contexts SET state='EXPIRED' WHERE state='READY' AND expires_at<=?",System.currentTimeMillis());
    for(String id:jdbc.queryForList("SELECT id FROM build_test_contexts WHERE state IN ('EXPIRED','PREPARE_FAILED') AND cleanup_attempted=false",String.class)) cleanup(row(id));
  }
}
