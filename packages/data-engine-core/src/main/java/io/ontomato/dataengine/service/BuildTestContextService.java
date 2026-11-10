package io.ontomato.dataengine.service;

import io.ontomato.dataengine.service.agent.AgentJson;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.dao.VectorResourceDao.ResourceDirectoryException;
import jakarta.annotation.PostConstruct;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import java.util.concurrent.locks.ReentrantLock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.DependsOn;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/** Durable owner of temporary build data. Cleanup is attempted once, with no automatic replay.
 * Execution/cleanup locks assume a single data-engine instance; they do not coordinate JVMs.
 */
@Service
@DependsOn("jdbcInitDb")
public class BuildTestContextService {
  private final ConcurrentHashMap<String,ReentrantReadWriteLock> locks=new ConcurrentHashMap<>();
  public ReentrantReadWriteLock lock(String id) { return locks.computeIfAbsent(id,key->new ReentrantReadWriteLock()); }
  private record WorkspaceKey(String owner, String domain, String workspace) {}
  private final ConcurrentHashMap<WorkspaceKey, ReentrantLock> workspaces = new ConcurrentHashMap<>();
  private ReentrantLock workspaceLock(String owner, String domain, String workspace) {
    return workspaces.computeIfAbsent(new WorkspaceKey(owner,domain,workspace), key -> new ReentrantLock());
  }
  private ReentrantLock workspaceLock(JSONObject row) {
    return workspaceLock(row.getString("owner_id"), row.getString("domain_id"), row.getString("workspace_id"));
  }
  @Value("${ontomato.build-test.ttl-minutes:60}")
  private long ttlMinutes = 60;
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
    if(ttlMinutes<=0) throw new IllegalArgumentException("ontomato.build-test.ttl-minutes must be positive");
    jdbc.execute("CREATE TABLE IF NOT EXISTS build_test_contexts (id text PRIMARY KEY, owner_id text NOT NULL, domain_id text NOT NULL, workspace_id text NOT NULL, state text NOT NULL, expires_at bigint NOT NULL, data jsonb NOT NULL, cleanup_attempted boolean NOT NULL DEFAULT false, cleanup_error text)");
    jdbc.execute("ALTER TABLE build_test_contexts ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()");
    jdbc.execute("CREATE UNIQUE INDEX IF NOT EXISTS build_test_active_workspace ON build_test_contexts(owner_id,domain_id,workspace_id) WHERE state IN ('PREPARING','READY')");
    jdbc.update("UPDATE build_test_contexts SET state='PREPARE_FAILED' WHERE state='PREPARING'");
    jdbc.update("UPDATE build_test_contexts SET cleanup_error='Cleanup interrupted; result unconfirmed' WHERE cleanup_attempted=true AND cleanup_error IS NULL AND state IN ('CLOSED','EXPIRED','PREPARE_FAILED')");
  }
  private BuildTestException error(HttpStatus status, String code) { return new BuildTestException(status, code); }
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
    return AgentJson.hash(JSONObject.of("schema",schemas.query(domain),"routing",configs.get(domain)));
  }
  public JSONObject create(String workspace, JSONObject input, Map<String,byte[]> attachments) throws Exception {
    return create(workspace,input,attachments,"sample.json");
  }
  public JSONObject create(String workspace, JSONObject input, Map<String,byte[]> attachments, String sampleName) throws Exception {
    identity.requireQueryAccess();
    var user=identity.getCurrentUser();
    if(workspace==null || workspace.isBlank()) throw error(HttpStatus.BAD_REQUEST,"BUILD_TEST_SAMPLE_INVALID: workspaceId required");
    var workspaceLock=workspaceLock(user.getId(),user.getDomainId(),workspace);
    workspaceLock.lock();
    try {
    JSONObject sample;
    try { sample=sandbox.validateSample(input,attachments,user.getDomainId()); }
    catch(RuntimeException invalid) { throw error(HttpStatus.BAD_REQUEST,"BUILD_TEST_SAMPLE_INVALID: "+invalid.getMessage()); }
    var classes=sample.getJSONArray("objDatas").toJavaList(JSONObject.class).stream().map(o->o.getString("className")).distinct().toList();
    if(classes.isEmpty()) throw error(HttpStatus.BAD_REQUEST,"BUILD_TEST_SAMPLE_INVALID: classes required");
    if(!QueryAccessService.classScope(identity.getCurrentUserDataPermission(),classes).containsAll(classes)) throw error(HttpStatus.FORBIDDEN,"BUILD_TEST_FORBIDDEN");
    for(String stale:jdbc.queryForList("SELECT id FROM build_test_contexts WHERE owner_id=? AND domain_id=? AND workspace_id=? AND state IN ('EXPIRED','PREPARE_FAILED') AND cleanup_attempted=false",String.class,user.getId(),user.getDomainId(),workspace)) cleanup(row(stale));
    var failed=jdbc.queryForList("SELECT id FROM build_test_contexts WHERE owner_id=? AND domain_id=? AND workspace_id=? AND cleanup_attempted=true AND (cleanup_error IS NULL OR cleanup_error <> '')",String.class,user.getId(),user.getDomainId(),workspace);
    if(!failed.isEmpty()) throw error(HttpStatus.CONFLICT,"BUILD_TEST_CLEANUP_FAILED: "+failed.get(0));
    var binding=sandbox.bindSample(sample,user.getDomainId());
    var previous=current(workspace);
    if(previous!=null) close(previous.getString("contextId"));
    String id=UUID.randomUUID().toString(), sandboxId="bt_"+id.replace("-","")+"_";
    long expires=System.currentTimeMillis()+ttlMinutes*60000L;
    if(identity.getCurrentCredentialExpiresAt()!=null) expires=Math.min(expires,identity.getCurrentCredentialExpiresAt());
    var data=JSONObject.of("sandboxId",sandboxId,"classNames",classes,"sample",sample,"sampleName",sampleName,"fingerprint",fingerprint(user.getDomainId()),"sampleSha256",AgentJson.hash(JSONObject.of("sample",sample,"attachments",attachments)),"binding",binding,"resources",new JSONArray());
    jdbc.update("INSERT INTO build_test_contexts(id,owner_id,domain_id,workspace_id,state,expires_at,data) VALUES(?,?,?,?,'PREPARING',?,?::jsonb)",id,user.getId(),user.getDomainId(),workspace,expires,data.toJSONString());
    String stage="BUILD_TEST_SCHEMA_FAILED";
    try {
      sandbox.createSampleStructure(sandboxId,sample,user.getDomainId(),resources->{
        data.put("resources",resources);
        jdbc.update("UPDATE build_test_contexts SET data=?::jsonb WHERE id=?",data.toJSONString(),id);
      });
      stage="BUILD_TEST_DATA_FAILED";
      sandbox.loadSample(sandboxId,sample,attachments,user.getDomainId());
      jdbc.update("UPDATE build_test_contexts SET state='READY' WHERE id=?",id);
    } catch(Exception failure) {
      if(failure instanceof ResourceDirectoryException) stage="BUILD_TEST_DATA_FAILED";
      data.put("prepareError",failure.getMessage());
      jdbc.update("UPDATE build_test_contexts SET state='PREPARE_FAILED',data=?::jsonb WHERE id=?",data.toJSONString(),id);
      cleanup(row(id));
      throw error(HttpStatus.UNPROCESSABLE_ENTITY,stage+": contextId="+id+"; "+failure.getMessage());
    }
    return status(id);
    } finally { workspaceLock.unlock(); }
  }

  public JSONObject current(String workspace) {
    identity.requireQueryAccess();
    var user=identity.getCurrentUser();
    var ids=jdbc.queryForList("SELECT id FROM build_test_contexts WHERE owner_id=? AND domain_id=? AND workspace_id=? ORDER BY CASE WHEN state IN ('PREPARING','READY') THEN 0 ELSE 1 END,created_at DESC,id DESC LIMIT 1",String.class,user.getId(),user.getDomainId(),workspace);
    return ids.isEmpty()?null:status(ids.get(0));
  }
  public JSONObject status(String id) {
    identity.requireQueryAccess();
    var r=row(id);var user=identity.getCurrentUser();owner(r,user.getId(),user.getDomainId());
    if("READY".equals(r.getString("state")) && r.getLongValue("expires_at")<=System.currentTimeMillis()) {
      jdbc.update("UPDATE build_test_contexts SET state='EXPIRED' WHERE id=? AND state='READY'",id);r=row(id);
    }
    var data=r.getJSONObject("data");
    return JSONObject.of("contextId",id,"workspaceId",r.getString("workspace_id"),"status",r.getString("state"),"expiresAt",r.getLong("expires_at"),"classNames",data.get("classNames"),"sampleSummary",JSONObject.of("name",data.getString("sampleName"),"classes",data.getJSONArray("classNames").size(),"sha256",data.getString("sampleSha256")),"prepareError",data.get("prepareError"),"cleanupError",r.get("cleanup_error"),"resources",data.get("resources"));
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
  public JSONObject close(String id) {
    identity.requireQueryAccess();
    var captured=row(id);var user=identity.getCurrentUser();owner(captured,user.getId(),user.getDomainId());
    var workspaceLock=workspaceLock(captured);workspaceLock.lock();
    try {
    var r=row(id);
    jdbc.update("UPDATE build_test_contexts SET state='CLOSED' WHERE id=? AND state IN ('READY','PREPARING')",id);
    cleanup(row(id));
    var result=status(id);
    if(result.getString("cleanupError")!=null && !result.getString("cleanupError").isEmpty()) throw error(HttpStatus.INTERNAL_SERVER_ERROR,"BUILD_TEST_CLEANUP_FAILED: "+result.getString("cleanupError"));
    return result;
    } finally { workspaceLock.unlock(); }
  }

  public JSONObject retryCleanup(String id) {
    identity.requireQueryAccess();
    var captured=row(id);var user=identity.getCurrentUser();owner(captured,user.getId(),user.getDomainId());
    var workspaceLock=workspaceLock(captured);workspaceLock.lock();
    try {
    var r=row(id);
    if(List.of("READY","PREPARING").contains(r.getString("state"))) throw error(HttpStatus.CONFLICT,"BUILD_TEST_CONTEXT_NOT_READY: end before cleanup");
    jdbc.update("UPDATE build_test_contexts SET cleanup_attempted=false WHERE id=?",id);
    cleanup(row(id));return status(id);
    } finally { workspaceLock.unlock(); }
  }

  private void cleanup(JSONObject r) {
    String id=r.getString("id"),domain=r.getString("domain_id");
    var writeLock=lock(id).writeLock();writeLock.lock();
    try {
      if(jdbc.update("UPDATE build_test_contexts SET cleanup_attempted=true WHERE id=? AND cleanup_attempted=false",id)!=1) return;
      var executions=grants.revokeContext(id);
      for(String execution:executions) {
        runtime.closeIntent(domain,execution);
        var snapshot=runtime.execution(domain,execution);
        if(!List.of("stopped").contains(snapshot.getString("status")))
          throw new IllegalStateException("Execution has not stopped: "+execution);
      }
      var data=r.getJSONObject("data");
      sandbox.dropSampleStructure(data.getJSONObject("binding"),data.getJSONArray("resources"),domain,resources->{
        data.put("resources",resources);
        jdbc.update("UPDATE build_test_contexts SET data=?::jsonb WHERE id=?",data.toJSONString(),id);
      });
      jdbc.update("UPDATE build_test_contexts SET cleanup_error='' WHERE id=?",id);
    } catch(Exception failure) { jdbc.update("UPDATE build_test_contexts SET cleanup_error=? WHERE id=?",failure.getMessage(),id); }
    finally { writeLock.unlock(); }
  }
  @Scheduled(fixedDelay=30000) public void expire() {
    for(String id:jdbc.queryForList("SELECT id FROM build_test_contexts WHERE (state='READY' AND expires_at<=?) OR (state IN ('EXPIRED','PREPARE_FAILED') AND cleanup_attempted=false)",String.class,System.currentTimeMillis())) {
      var lock=lock(id).writeLock();lock.lock();
      try {
        jdbc.update("UPDATE build_test_contexts SET state='EXPIRED' WHERE id=? AND state='READY' AND expires_at<=?",id,System.currentTimeMillis());
        cleanup(row(id));
      } finally { lock.unlock(); }
    }
  }
}
