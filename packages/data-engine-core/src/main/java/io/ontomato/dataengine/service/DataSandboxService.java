package io.ontomato.dataengine.service;

import io.ontomato.dataengine.service.agent.AgentJson;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.dataAdapter.*;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.util.*;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.context.event.EventListener;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import lombok.extern.slf4j.Slf4j;
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

/** Owns the registered business data used by application previews and action trials. */
@Slf4j
@Service
@DependsOn("jdbcInitDb")
public class DataSandboxService {
  private final ConcurrentHashMap<String,ReentrantReadWriteLock> locks=new ConcurrentHashMap<>();
  public ReentrantReadWriteLock lock(String id) { return locks.computeIfAbsent(id,key->new ReentrantReadWriteLock()); }
  private record WorkspaceKey(String owner, String domain, String workspace) {}
  private final ConcurrentHashMap<WorkspaceKey, ReentrantLock> workspaces = new ConcurrentHashMap<>();
  private ReentrantLock workspaceLock(String owner, String domain, String workspace) {
    return workspaces.computeIfAbsent(new WorkspaceKey(owner,domain,workspace), key -> new ReentrantLock());
  }
  private ReentrantLock workspaceLock(JSONObject row) {
    return workspaceLock(row.getString("owner_id"), row.getString("domain_id"), row.getString("scope_key"));
  }
  @Value("${ontomato.build-test.ttl-minutes:60}")
  private long ttlMinutes = 60;
  public static final String HEADER = "X-Ontomato-Execution-Context";
  private final JdbcTemplate jdbc;
  private final IdentityService identity;
  private final JSONRuleDao schemas;
  private final BusinessConfigService configs;
  private final QueryGrantService grants;
  private final RuntimeCodeClient runtime;

  private final SandboxDeployment deployment;
  private final String nodeId = UUID.randomUUID().toString();

  @Autowired private DataAdapterRegistry dataAdapterRegistry;
  @Autowired private VectorResourceDao vectorResourceDao;
  @Autowired @Lazy private WriteFunctionOperationService writes;

  public DataSandboxService(JdbcTemplate jdbc, IdentityService identity,
      JSONRuleDao schemas, BusinessConfigService configs, QueryGrantService grants, RuntimeCodeClient runtime,
      SandboxDeployment deployment) {
    this.jdbc=jdbc; this.identity=identity; this.schemas=schemas; this.deployment=deployment;
    this.configs=configs; this.grants=grants; this.runtime=runtime;
  }
  @PostConstruct
  public void initialize() {
    if (ttlMinutes <= 0) throw new IllegalArgumentException("ontomato.build-test.ttl-minutes must be positive");
    jdbc.execute("""
        CREATE TABLE IF NOT EXISTS data_sandboxes (
          id text PRIMARY KEY, short_id text NOT NULL UNIQUE CHECK (short_id ~ '^[a-z0-9]{8}$'),
          domain_id text NOT NULL, owner_id text NOT NULL, purpose text NOT NULL, scope_key text NOT NULL,
          state text NOT NULL, expires_at bigint NOT NULL, cleanup_attempted boolean NOT NULL DEFAULT false,
          cleanup_error text, node_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
          data jsonb NOT NULL
        )
        """);
    jdbc.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS data_sandbox_active_scope
        ON data_sandboxes (owner_id,domain_id,purpose,scope_key) WHERE state IN ('PREPARING','READY')
        """);
  }

  private BuildTestException error(HttpStatus status, String code) { return new BuildTestException(status, code); }
  private JSONObject row(String id) {
    var rows=jdbc.queryForList("SELECT row_to_json(c)::text FROM data_sandboxes c WHERE id=?", String.class,id);
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
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  public JSONObject create(String workspace, JSONObject input, Map<String, byte[]> attachments) {
    return create(workspace, input, attachments, "sample.json");
  }

  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  public JSONObject create(String workspace, JSONObject input, Map<String, byte[]> attachments, String sampleName) {
    identity.requireQueryAccess();
    var user = identity.getCurrentUser();
    if (workspace == null || workspace.isBlank())
      throw error(HttpStatus.BAD_REQUEST, "BUILD_TEST_SAMPLE_INVALID: workspaceId required");
    JSONObject sample;
    try {
      sample = validateSample(input, attachments, user.getDomainId());
    } catch (RuntimeException invalid) {
      throw error(HttpStatus.BAD_REQUEST, "BUILD_TEST_SAMPLE_INVALID: " + invalid.getMessage());
    }
    var classes = sample.getJSONArray("objDatas").toJavaList(JSONObject.class).stream()
        .map(item -> item.getString("className")).distinct().toList();
    if (classes.isEmpty()) throw error(HttpStatus.BAD_REQUEST, "BUILD_TEST_SAMPLE_INVALID: classes required");
    if (!QueryAccessService.classScope(identity.getCurrentUserDataPermission(), classes).containsAll(classes))
      throw error(HttpStatus.FORBIDDEN, "BUILD_TEST_FORBIDDEN");

    var workspaceLock = workspaceLock(user.getId(), user.getDomainId(), workspace);
    workspaceLock.lock();
    try {
      var previous = current(workspace);
      if (previous != null) close(previous.getString("contextId"));
      var failure = jdbc.queryForList("""
          SELECT id FROM data_sandboxes WHERE owner_id=? AND domain_id=? AND scope_key=?
          AND purpose='build-test' AND cleanup_attempted=true AND (cleanup_error IS NULL OR cleanup_error<>'')
          """, String.class, user.getId(), user.getDomainId(), workspace);
      if (!failure.isEmpty()) throw error(HttpStatus.CONFLICT, "BUILD_TEST_CLEANUP_FAILED: " + failure.getFirst());
      long expires = System.currentTimeMillis() + ttlMinutes * 60000L;
      if (identity.getCurrentCredentialExpiresAt() != null)
        expires = Math.min(expires, identity.getCurrentCredentialExpiresAt());
      return status(open(user.getDomainId(), user.getId(), "build-test", workspace, expires,
          classes, sample, sampleName, attachments, true));
    } finally {
      workspaceLock.unlock();
    }
  }

  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  public String open(String domain, String owner, String run, long expiresAt, List<String> classes) {
    return open(domain, owner, "action-trial", run, expiresAt, classes, null, null, Map.of(), false);
  }

  private String open(String domain, String owner, String purpose, String scope, long expiresAt,
      List<String> classes, JSONObject sample, String sampleName, Map<String, byte[]> attachments, boolean load) {
    var operation = deployment.operationLock();
    operation.lock();
    try {
      String id = UUID.randomUUID().toString();
      String shortId = SandboxTarget.randomTag(8);
      var data = plan(id, shortId, domain, classes, sample, sampleName, attachments);
      jdbc.update("""
          INSERT INTO data_sandboxes (id,short_id,domain_id,owner_id,purpose,scope_key,state,expires_at,node_id,data)
          VALUES (?,?,?,?,?,?,'PREPARING',?,?,?::jsonb)
          """, id, shortId, domain, owner, purpose, scope, expiresAt, nodeId, data.toJSONString());
      prepare(id, shortId, domain, data, attachments, load);
      return id;
    } finally {
      operation.unlock();
    }
  }

  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  public void replaceClasses(String id, List<String> classes, JSONObject sample, String domain) {
    var operation = deployment.operationLock();
    operation.lock();
    try {
      var record = active(id, domain);
      var before = record.getJSONObject("data");
      var after = plan(id, record.getString("short_id"), domain, classes, sample, null, Map.of());
      if (before.getList("classNames", String.class).equals(classes)) {
        before.put("sample", sample);
        before.put("sampleSha256", after.get("sampleSha256"));
        save(id, before);
        return;
      }
      rebuild(record, after, false);
    } finally {
      operation.unlock();
    }
  }

  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  public void reset(String id, String domain) {
    var operation = deployment.operationLock();
    operation.lock();
    try {
      var record = active(id, domain);
      var data = record.getJSONObject("data");
      if (data.getJSONObject("sample") == null) throw AgentHttpException.invalid("Prepare test data first");
      rebuild(record, data, true);
    } finally {
      operation.unlock();
    }
  }

  private void rebuild(JSONObject record, JSONObject data, boolean load) {
    String id = record.getString("id"), domain = record.getString("domain_id");
    jdbc.update("UPDATE data_sandboxes SET state='PREPARING' WHERE id=?", id);
    var writeLock = lock(id).writeLock();
    writeLock.lock();
    try {
      var previous = record.getJSONObject("data");
      dropSampleStructure(previous.getJSONObject("binding"), previous.getJSONArray("resources"), domain,
          resources -> save(id, previous));
    } catch (RuntimeException failure) {
      jdbc.update("UPDATE data_sandboxes SET state='PREPARE_FAILED',cleanup_error=? WHERE id=?", failure.getMessage(), id);
      throw failure;
    } finally {
      writeLock.unlock();
    }
    data.put("resources", new JSONArray());
    save(id, data);
    prepare(id, record.getString("short_id"), domain, data, Map.of(), load);
  }

  private void save(String id, JSONObject data) {
    jdbc.update("UPDATE data_sandboxes SET data=?::jsonb WHERE id=?", data.toJSONString(), id);
  }

  @SuppressWarnings("unchecked")
  private JSONObject plan(String id, String shortId, String domain, List<String> classes,
      JSONObject sample, String sampleName, Map<String, byte[]> attachments) {
    var binding = bindClasses(classes, domain);
    var rule = binding.getJSONObject("rule");
    var classMap = new JSONObject();
    var edgeMap = new JSONObject();
    var vectorMap = new JSONObject();
    String prefix = SandboxTarget.deploymentPrefix(deployment.tag()) + shortId;
    for (String name : classes) {
      classMap.put(name, physicalName(prefix, 'c', classMap.size() + 1));
    }
    for (var cls : (List<Map<String, Object>>) rule.get("classDef")) {
      String name = (String) cls.get("className");
      if (!classMap.containsKey(name)) continue;
      for (String attr : getVectorAttrNames(cls)) {
        vectorMap.put(SandboxTarget.vectorKey(name, attr), physicalName(prefix, 'v', vectorMap.size() + 1));
      }
    }
    rule.getJSONObject("relationship_rule").forEach((name, rel) -> {
      var relation = OntologyRelation.of(name, rel, "relationship_rule[" + name + "]");
      if (OntologyRelation.KIND_NN.equals(relation.kind()) && classMap.containsKey(relation.fromClass()) && classMap.containsKey(relation.toClass()))
        edgeMap.put(name, physicalName(prefix, 'r', edgeMap.size() + 1));
    });
    return JSONObject.of("classMap", classMap, "edgeMap", edgeMap, "vectorMap", vectorMap,
        "classNames", classes, "sample", sample, "sampleName", sampleName,
        "sampleSha256", AgentJson.hash(JSONObject.of("sample", sample, "attachments", attachments)),
        "fingerprint", fingerprint(domain), "binding", binding, "resources", new JSONArray());
  }

  private static String physicalName(String prefix, char kind, int position) {
    return prefix + "_" + kind + String.format(Locale.ROOT, "%02d", position);
  }

  private void prepare(String id, String shortId, String domain, JSONObject data,
      Map<String, byte[]> attachments, boolean load) {
    String stage = "BUILD_TEST_SCHEMA_FAILED";
    try {
      createSampleStructure(target(id, shortId, data), data, domain, () -> save(id, data));
      stage = "BUILD_TEST_DATA_FAILED";
      if (load) loadSample(id, data.getJSONObject("sample"), attachments, domain);
      jdbc.update("UPDATE data_sandboxes SET state='READY' WHERE id=?", id);
    } catch (Exception failure) {
      if (failure instanceof ResourceDirectoryException) stage = "BUILD_TEST_DATA_FAILED";
      data.put("prepareError", failure.getMessage());
      jdbc.update("UPDATE data_sandboxes SET state='PREPARE_FAILED',data=?::jsonb WHERE id=?", data.toJSONString(), id);
      cleanup(row(id));
      throw error(HttpStatus.UNPROCESSABLE_ENTITY, stage + ": contextId=" + id + "; " + failure.getMessage());
    }
  }

  public SandboxTarget resolveTarget(String id) {
    var record = row(id);
    return target(id, record.getString("short_id"), record.getJSONObject("data"));
  }

  public SandboxTarget resolveTarget(String id, String domain) {
    var record = active(id, domain);
    return target(id, record.getString("short_id"), record.getJSONObject("data"));
  }

  private SandboxTarget target(String id, String shortId, JSONObject data) {
    return new SandboxTarget(id, deployment.tag(), shortId, stringMap(data, "classMap"),
        stringMap(data, "edgeMap"), stringMap(data, "vectorMap"));
  }

  private static Map<String, String> stringMap(JSONObject data, String name) {
    var values = new HashMap<String, String>();
    data.getJSONObject(name).forEach((key, value) -> values.put(key, (String) value));
    return values;
  }

  private JSONObject active(String id, String domain) {
    var record = row(id);
    if (!domain.equals(record.getString("domain_id"))) throw error(HttpStatus.FORBIDDEN, "BUILD_TEST_FORBIDDEN");
    if (record.getLongValue("expires_at") <= System.currentTimeMillis())
      throw error(HttpStatus.GONE, "BUILD_TEST_CONTEXT_EXPIRED");
    if (!List.of("READY", "PREPARING").contains(record.getString("state")))
      throw error(HttpStatus.CONFLICT, "BUILD_TEST_CONTEXT_NOT_READY");
    if (!fingerprint(domain).equals(record.getJSONObject("data").getString("fingerprint")))
      throw error(HttpStatus.CONFLICT, "BUILD_TEST_CONTEXT_CHANGED");
    return record;
  }

  private void buildOwner(JSONObject row, String user, String domain) {
    owner(row, user, domain);
    if (!"build-test".equals(row.getString("purpose")))
      throw error(HttpStatus.NOT_FOUND, "BUILD_TEST_CONTEXT_NOT_FOUND");
  }

  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  public void close(String id, String domain) {
    var operation = deployment.operationLock();
    operation.lock();
    try {
      var record = row(id);
      if (!domain.equals(record.getString("domain_id")) || !"action-trial".equals(record.getString("purpose")))
        throw error(HttpStatus.FORBIDDEN, "BUILD_TEST_FORBIDDEN");
      jdbc.update("UPDATE data_sandboxes SET state='CLOSED' WHERE id=? AND state IN ('READY','PREPARING')", id);
      cleanup(row(id));
      var cleaned = row(id);
      String failure = cleaned.getString("cleanup_error");
      if (failure != null && !failure.isEmpty()) throw new IllegalStateException(failure);
    } finally {
      operation.unlock();
    }
  }

  public JSONObject current(String workspace) {
    identity.requireQueryAccess();
    var user=identity.getCurrentUser();
    var ids=jdbc.queryForList("SELECT id FROM data_sandboxes WHERE owner_id=? AND domain_id=? AND scope_key=? AND purpose='build-test' ORDER BY CASE WHEN state IN ('PREPARING','READY') THEN 0 ELSE 1 END,created_at DESC,id DESC LIMIT 1",String.class,user.getId(),user.getDomainId(),workspace);
    return ids.isEmpty()?null:status(ids.get(0));
  }
  public JSONObject status(String id) {
    identity.requireQueryAccess();
    var r=row(id);var user=identity.getCurrentUser();buildOwner(r,user.getId(),user.getDomainId());
    if("READY".equals(r.getString("state")) && r.getLongValue("expires_at")<=System.currentTimeMillis()) {
      jdbc.update("UPDATE data_sandboxes SET state='EXPIRED' WHERE id=? AND state='READY'",id);r=row(id);
    }
    var data=r.getJSONObject("data");
    return JSONObject.of("contextId",id,"workspaceId",r.getString("scope_key"),"status",r.getString("state"),"expiresAt",r.getLong("expires_at"),"classNames",data.get("classNames"),"sampleSummary",JSONObject.of("name",data.getString("sampleName"),"classes",data.getJSONArray("classNames").size(),"sha256",data.getString("sampleSha256")),"prepareError",data.get("prepareError"),"cleanupError",r.get("cleanup_error"),"resources",data.get("resources"));
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
    var r=row(id);buildOwner(r,user,domain);
    // An ended test stays ended after its deadline passes: the reader is told what they did, as the status reports it.
    if("CLOSED".equals(r.getString("state"))) throw error(HttpStatus.GONE,"BUILD_TEST_CONTEXT_CLOSED");
    if(r.getLongValue("expires_at")<=System.currentTimeMillis()) throw error(HttpStatus.GONE,"BUILD_TEST_CONTEXT_EXPIRED");
    if(!"READY".equals(r.getString("state"))) throw error(HttpStatus.CONFLICT,"BUILD_TEST_CONTEXT_NOT_READY");
    var data=r.getJSONObject("data");
    if(!fingerprint(domain).equals(data.getString("fingerprint"))) throw error(HttpStatus.CONFLICT,"BUILD_TEST_CONTEXT_CHANGED");
    return new ExecutionTarget(id,id,data.getList("classNames",String.class),r.getLong("expires_at"));
  }
  public JSONObject close(String id) {
    identity.requireQueryAccess();
    var captured = row(id);
    var user = identity.getCurrentUser();
    buildOwner(captured, user.getId(), user.getDomainId());
    closeContext(captured);
    return status(id);
  }

  public void closeWorkspace(String domainId, String workspaceId) {
    var ids = jdbc.queryForList(
        "SELECT id FROM data_sandboxes WHERE domain_id=? AND purpose='build-test' AND scope_key=? "
            + "AND (state IN ('READY','PREPARING') OR NOT cleanup_attempted OR cleanup_error <> '')",
        String.class, domainId, workspaceId);
    for (String id : ids) closeContext(row(id));
  }

  private void closeContext(JSONObject captured) {
    String id = captured.getString("id");
    var workspaceLock = workspaceLock(captured);
    workspaceLock.lock();
    try {
      jdbc.update("UPDATE data_sandboxes SET state='CLOSED' WHERE id=? AND state IN ('READY','PREPARING')", id);
      cleanup(row(id));
      var result = status(id);
      if (result.getString("cleanupError") != null && !result.getString("cleanupError").isEmpty()) {
        throw error(HttpStatus.INTERNAL_SERVER_ERROR, "BUILD_TEST_CLEANUP_FAILED: " + result.getString("cleanupError"));
      }
    } finally {
      workspaceLock.unlock();
    }
  }

  public JSONObject retryCleanup(String id) {
    identity.requireQueryAccess();
    var captured=row(id);var user=identity.getCurrentUser();buildOwner(captured,user.getId(),user.getDomainId());
    var workspaceLock=workspaceLock(captured);workspaceLock.lock();
    try {
    var r=row(id);
    if(List.of("READY","PREPARING").contains(r.getString("state"))) throw error(HttpStatus.CONFLICT,"BUILD_TEST_CONTEXT_NOT_READY: end before cleanup");
    jdbc.update("UPDATE data_sandboxes SET cleanup_attempted=false WHERE id=?",id);
    cleanup(row(id));return status(id);
    } finally { workspaceLock.unlock(); }
  }

  private void cleanup(JSONObject r) {
    String id=r.getString("id"),domain=r.getString("domain_id");
    var writeLock=lock(id).writeLock();writeLock.lock();
    try {
      if(jdbc.update("UPDATE data_sandboxes SET cleanup_attempted=true WHERE id=? AND cleanup_attempted=false",id)!=1) return;
      var executions=grants.revokeContext(id);
      for(String execution:executions) {
        runtime.closeIntent(domain,execution);
        var snapshot=runtime.execution(domain,execution);
        if(!List.of("stopped").contains(snapshot.getString("status")))
          throw new IllegalStateException("Execution has not stopped: "+execution);
      }
      var data=r.getJSONObject("data");
      dropSampleStructure(data.getJSONObject("binding"),data.getJSONArray("resources"),domain,resources->{
        data.put("resources",resources);
        save(id, data);
      });
      jdbc.update("UPDATE data_sandboxes SET cleanup_error='' WHERE id=?",id);
    } catch(Exception failure) { jdbc.update("UPDATE data_sandboxes SET cleanup_error=? WHERE id=?",failure.getMessage(),id); }
    finally { writeLock.unlock(); }
  }
  @EventListener(ApplicationReadyEvent.class)
  public void recoverInterruptedSandboxes() {
    jdbc.update("UPDATE data_sandboxes SET state='PREPARE_FAILED' WHERE state='PREPARING' AND node_id<>?", nodeId);
    cleanupExpired();
    cleanupOrphans();
  }

  @Scheduled(fixedDelay = 30000)
  public void cleanupExpired() {
    long now = System.currentTimeMillis();
    jdbc.update("UPDATE data_sandboxes SET state='EXPIRED' WHERE state IN ('READY','PREPARING') AND expires_at<=?", now);
    for (String id : jdbc.queryForList("""
        SELECT id FROM data_sandboxes WHERE state IN ('CLOSED','EXPIRED','PREPARE_FAILED') AND cleanup_attempted=false
        """, String.class)) cleanup(row(id));
  }

  @Scheduled(fixedDelay = 600_000, initialDelay = 600_000)
  public void cleanupOrphans() {
    String prefix = SandboxTarget.deploymentPrefix(deployment.tag());
    var operation = deployment.scanLock();
    for (String domain : jdbc.queryForList("SELECT id FROM business_config", String.class)) {
      try {
        var config = configs.get(domain);
        if (config == null || config.getDataAdapter() == null || config.getDataAdapter().isBlank()
            || !dataAdapterRegistry.supportsSandbox(config)) continue;
        operation.lock();
        try {
          var activeIds = activeSandboxShortIds();
          var adapter = dataAdapterRegistry.create(config, null);
          for (var artifact : adapter.listSandboxArtifacts(prefix)) {
            String name = artifact.getString("name");
            if (!name.matches(prefix + "[a-z0-9]{8}_v[0-9]{2,}") && orphan(prefix, activeIds, name)) {
              adapter.dropRecordedResource(artifact);
            }
          }
        } finally {
          operation.unlock();
        }
      } catch (RuntimeException failure) {
        log.warn("Sandbox orphan cleanup failed for domain {}", domain, failure);
      }
    }

    operation.lock();
    try {
      var activeIds = activeSandboxShortIds();
      vectorResourceDao.cleanupSandboxOrphans(prefix, name -> orphan(prefix, activeIds, name));
    } finally {
      operation.unlock();
    }
  }

  private Set<String> activeSandboxShortIds() {
    // Short ids are unique across this platform database, including domains sharing a physical source.
    return Set.copyOf(jdbc.queryForList("""
        SELECT short_id FROM data_sandboxes
        WHERE state IN ('PREPARING','READY') AND expires_at>?
        """, String.class, System.currentTimeMillis()));
  }

  static boolean orphan(String prefix, Set<String> activeIds, String artifact) {
    String name = artifact.startsWith("/") ? artifact.substring(1) : artifact;
    if (!name.startsWith(prefix)) return false;
    String suffix = name.substring(prefix.length());
    if (suffix.matches("p_[a-z0-9]{8}")) return true;
    if (!suffix.matches("[a-z0-9]{8}(?:_[crv][0-9]{2,}|/c[0-9]{2,})?")) return false;
    return !activeIds.contains(suffix.substring(0, 8));
  }

    @SuppressWarnings("unchecked")
    JSONObject bindSample(JSONObject sample, String domain) {
      return bindClasses(sample.getJSONArray("objDatas").toJavaList(JSONObject.class).stream()
          .map(row -> row.getString("className")).toList(), domain);
    }

    private JSONObject bindClasses(List<String> classes, String domain) {
      var config = com.alibaba.fastjson2.JSON.parseObject(com.alibaba.fastjson2.JSON.toJSONString(configs.get(domain)));
      var adapter=getDataAdapter(domain);
      if(!adapter.supportsSandbox(classes)) throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.UNPROCESSABLE_ENTITY,"BUILD_TEST_UNSUPPORTED");
      var hashes = new JSONObject();
      var connections=config.getJSONObject("dataAdapterConnections");
      connections.forEach((name,connection)->hashes.put(name,connectionHash(connection)));
      config.remove("dataAdapterConnections");
      var multi=config.getJSONObject("multiDataSource");
      if(multi!=null) for(var source:multi.getJSONArray("dataSources").toJavaList(JSONObject.class)) {
        hashes.put("source:"+source.getString("id"),connectionHash(source.get("connection")));
        source.remove("connection");
      }
      return JSONObject.of("config",config,"connectionHashes",hashes,"rule",schemas.query(domain),"classNames",classes);
    }

    /**
     * Match the serialized connection representation stored by existing bindings. A null map value
     * means an unset field; retain every actual value, including credentials, in the fingerprint.
     */
    private String connectionHash(Object connection) {
      return AgentJson.hash(JSON.parseObject(JSON.toJSONString(connection)));
    }

    public void dropSampleStructure(JSONObject binding, JSONArray resources, String domain, java.util.function.Consumer<JSONArray> save) {
      var config=com.alibaba.fastjson2.JSON.parseObject(binding.getJSONObject("config").toJSONString(),BusinessConfig.class);
      var current=configs.get(domain);
      var hashes=binding.getJSONObject("connectionHashes");
      if("multi".equals(config.getDataAdapter())) {
        for(var source:config.getMultiDataSource().getDataSources()) {
          var present=current.getMultiDataSource()==null ? null : current.getMultiDataSource().source(source.getId());
          if(present==null || !java.util.Objects.equals(source.getAdapterType(),present.getAdapterType()) || !java.util.Objects.equals(hashes.getString("source:"+source.getId()),connectionHash(present.getConnection())))
            throw new IllegalStateException("Original source unavailable: "+source.getId());
          source.setConnection(present.getConnection());
        }
      } else {
        var connection=current.getDataAdapterConnections().get(config.getDataAdapter());
        if(!java.util.Objects.equals(hashes.getString(config.getDataAdapter()),connectionHash(connection)))
          throw new IllegalStateException("Original source unavailable: "+config.getDataAdapter());
        config.setDataAdapterConnections(current.getDataAdapterConnections());
      }
      var adapter=dataAdapterRegistry.create(config,binding.getJSONObject("rule"));
      for(int index=resources.size()-1;index>=0;index--) {
        var resource=resources.getJSONObject(index);
        if("DELETED".equals(resource.getString("cleanupStatus"))) continue;
        try {
          if("vector".equals(resource.getString("kind"))) vectorResourceDao.dropRecordedVector(resource);
          else adapter.dropRecordedResource(resource);
          resource.put("cleanupStatus","DELETED");save.accept(resources);
        } catch(RuntimeException failure) { resource.put("cleanupStatus","FAILED");save.accept(resources);throw failure; }
      }
    }

    @SuppressWarnings("unchecked")
    protected void createSampleStructure(SandboxTarget target, JSONObject data, String domain, Runnable save) {
      var adapter = getDataAdapter(domain).forSandbox(target);
      String namespace = target.namespace();
      var classes = data.getList("classNames", String.class);
      var rule = data.getJSONObject("binding").getJSONObject("rule");
      var resources = data.getJSONArray("resources");
      var definitions = ((List<Map<String,Object>>) rule.get("classDef")).stream()
          .filter(cls -> classes.contains(cls.get("className"))).toList();
      adapter.validateSandboxClasses(namespace, definitions);
      adapter.createRecordedNamespaces(namespace, classes, resource -> {
        resources.add(resource);
        save.run();
      });
      for (var definition : definitions) {
        var resource = adapter.sandboxClassArtifact(namespace, (String) definition.get("className"));
        resource.put("logicalName", resource.getString("name"));
        resources.add(resource);
        save.run();
        resource.putAll(adapter.createRecordedClass(namespace, definition));
        save.run();
      }
      rule.getJSONObject("relationship_rule").forEach((name, item) -> {
        var relation = OntologyRelation.of(name, item, "relationship_rule[" + name + "]");
        if (!classes.contains(relation.fromClass()) || !classes.contains(relation.toClass())
            || !adapter.supportsSandboxRelationship(name)) return;
        if (target.edgeTables().containsKey(name)) {
          var resource = adapter.sandboxEdgeArtifact(name);
          if (resource != null) {
            resources.add(resource);
            save.run();
          }
        }
        adapter.createEdgeType(namespace, name);
      });
      for (String table : target.vectorTables().values()) {
        var resource = vectorResourceDao.planSandboxVector(table);
        resources.add(resource);
        save.run();
        vectorResourceDao.createSandboxVector(resource);
      }
    }

    private List<?> sampleArray(Object value,String path) {
      if(!(value instanceof List<?> entries)) throw AgentHttpException.invalid(path+": expected an array");
      return entries;
    }
    private void sampleText(Object value,String path) {
      if(!(value instanceof String text) || text.isBlank()) throw AgentHttpException.invalid(path+": expected a nonempty string");
    }

    @SuppressWarnings("unchecked")
    public JSONObject validateSample(JSONObject body, Map<String, byte[]> attachments, String domainId) {
    // Samples are external JSON. Validate container shapes before converting or consulting metadata.
    for(String group:List.of("objDatas","relDatas","vectorDatas")) {
      if(group.equals("vectorDatas") && !body.containsKey(group)) continue;
      var entries=sampleArray(body.get(group),"$."+group);
      for(int index=0;index<entries.size();index++) {
        String path="$."+group+"["+index+"]";
        if(!(entries.get(index) instanceof Map<?,?> entry)) throw AgentHttpException.invalid(path+": expected an object");
        if(group.equals("objDatas")) {
          sampleText(entry.get("className"),path+".className");
          var rows=sampleArray(entry.get("rows"),path+".rows");
          for(int row=0;row<rows.size();row++)
            if(!(rows.get(row) instanceof Map<?,?>)) throw AgentHttpException.invalid(path+".rows["+row+"]: expected a row object");
        } else {
          for(String field:group.equals("relDatas") ? List.of("relationName","sourceObjId","targetObjId") : List.of("className","objectId","attrName","text"))
            sampleText(entry.get(field),path+"."+field);
          if(group.equals("vectorDatas") && entry.get("file") != null) sampleText(entry.get("file"),path+".file");
        }
      }
    }
    List<Map> objDatas = body.getList("objDatas", Map.class),
        relDatas = body.getList("relDatas", Map.class),
        vectorDatas = body.getList("vectorDatas", Map.class);
    // Check the object data
    Map<String, Object> jsonRule = schemas.query(domainId);
    List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
    Map<String, Map<String, Object>> classDefMap = new HashMap<String, Map<String, Object>>();
    for (Map<String, Object> classDef : classDefs) {
      classDefMap.put((String) classDef.get("className"), classDef);
    }
    Map<String, Set<String>> classIdsMap = new HashMap<String, Set<String>>();
    for (Map<String, Object> objData : objDatas) {
      // ABC and DSL accept both "/orders" and "orders"; fixtures must normalize too, otherwise
      // reset() later stores a class name that the sandbox class map cannot resolve.
      String className =
          DBSchemaUtil.normalizeClassName((String) objData.get("className"), classDefs);
      objData.put("className", className);
      if(classIdsMap.containsKey(className)) throw AgentHttpException.invalid("Duplicate sample class: "+className);
      Map<String, Object> classDef = classDefMap.get(className);
      if (classDef != null) {
        Set<String> attrNameSet = new HashSet<String>();
        String pk = DslUtil.getPrimaryKey(classDef);
        List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
        for (Map<String, Object> attrDef : attrDefs) {
          if (attrDef.get("enable") == null || (Boolean) attrDef.get("enable")) {
            attrNameSet.add((String) attrDef.get("name"));
          }
        }
        Set<String> ids = new HashSet<String>();
        List<Map<String, Object>> rows = (List<Map<String, Object>>) objData.get("rows");
        for (Map<String, Object> row : rows) {
          for (String key : row.keySet()) {
            if (attrDefs.stream().anyMatch(attr -> key.equals(attr.get("name")) && "vector".equals(attr.get("type"))))
              throw AgentHttpException.invalid("Vector fields must be loaded through vectorDatas");
            if (!attrNameSet.contains(key)) {
              throw AgentHttpException.invalid(
                  "The row of Class["
                      + className
                      + "] has a property["
                      + key
                      + "], but that property does not belong to Class["
                      + className
                      + "].");
            }
          }
          Object key = row.get(pk);
          if (key instanceof Number || key instanceof Boolean || key instanceof String text && !text.isBlank()) {
            String id = String.valueOf(key);
            for (String cn : classIdsMap.keySet()) {
              if (classIdsMap.get(cn).contains(id)) {
                throw AgentHttpException.invalid("Property[" + pk + "]: " + id + ", is duplicated.");
              }
            }
            if (ids.contains(id)) {
              throw AgentHttpException.invalid("Property[" + pk + "]: " + id + ", is duplicated.");
            }
            ids.add(id);
          } else {
            throw AgentHttpException.invalid(
                "The row of Class["
                    + className
                    + "] has not primary key property["
                    + pk
                    + "], or the value of primary key property["
                    + pk
                    + "] is null or empty string.");
          }
        }
        classIdsMap.put(className, ids);
      } else {
        throw AgentHttpException.invalid("Class[" + className + "] is not exist.");
      }
    }

    // Check the relationship data
    List<Map<String, Object>> newRelDatas = new ArrayList<Map<String, Object>>();
    Map<String, Object> relationship_rule = (Map<String, Object>) jsonRule.get("relationship_rule");
    for (Map<String, Object> relData : relDatas) {
      String relationName = (String) relData.get("relationName");
      String sourceObjId = (String) relData.get("sourceObjId");
      String targetObjId = (String) relData.get("targetObjId");

      if (relationship_rule.get(relationName) != null) {
        Map<String, String> relationDef = (Map<String, String>) relationship_rule.get(relationName);
        String fromClass = relationDef.get("fromclass");
        String toClass = relationDef.get("toclass");
        Set<String> fromIds = classIdsMap.get(fromClass);
        if (fromIds == null || !fromIds.contains(sourceObjId)) {
          throw AgentHttpException.invalid(
              "The relation data: {relationName:"
                  + relationName
                  + ", sourceObjId: "
                  + sourceObjId
                  + ", targetObjId: "
                  + targetObjId
                  + "}, sourceObjId["
                  + sourceObjId
                  + "] is not in Class["
                  + fromClass
                  + "].");
        }
        Set<String> toIds = classIdsMap.get(toClass);
        if (toIds == null || !toIds.contains(targetObjId)) {
          throw AgentHttpException.invalid(
              "The relation data: {relationName:"
                  + relationName
                  + ", sourceObjId: "
                  + sourceObjId
                  + ", targetObjId: "
                  + targetObjId
                  + "}, targetObjId["
                  + targetObjId
                  + "] is not in Class["
                  + toClass
                  + "].");
        }
        Map<String, Object> newRelData = new HashMap<String, Object>();
        newRelData.put("relationName", relationName);
        newRelData.put("sourceClassName", fromClass);
        newRelData.put("sourceObjId", sourceObjId);
        newRelData.put("targetClassName", toClass);
        newRelData.put("targetObjId", targetObjId);
        newRelDatas.add(newRelData);
      } else {
        throw AgentHttpException.invalid("Relation[" + relationName + "] is not exist.");
      }
    }

    // Check the vector data
    List<Map<String, Object>> newVectorDatas = new ArrayList<Map<String, Object>>();
    if (vectorDatas != null) {
      for (Map<String, Object> vectorData : vectorDatas) {
        String className =
            DBSchemaUtil.normalizeClassName((String) vectorData.get("className"), classDefs);
        String objectId = (String) vectorData.get("objectId");
        String attrName = (String) vectorData.get("attrName");
        String text = (String) vectorData.get("text");
        String file = (String) vectorData.get("file");
        if (vectorData.containsKey("fileId")) throw AgentHttpException.invalid("Use file with uploaded bytes; fileId is not sample data");
        if (file != null && (file.startsWith("/") || file.contains("..") || file.contains("\\") || !attachments.containsKey(file)))
          throw AgentHttpException.invalid("Missing or invalid sample attachment: " + file);
        if(file!=null && !VectorResourceDao.isValidSuffix(file.substring(file.lastIndexOf('.')+1)))
          throw AgentHttpException.invalid("Invalid attachment suffix: "+file);
        Map<String, Object> classDef = classDefMap.get(className);
        if (classDef == null) {
          throw AgentHttpException.invalid("The vector data: Class[" + className + "] is not exist.");
        }
        Set<String> ids = classIdsMap.get(className);
        if (ids == null || !ids.contains(objectId)) {
          throw AgentHttpException.invalid(
              "The vector data: objectId[" + objectId + "] is not in Class[" + className + "].");
        }
        boolean isVectorAttr = false;
        List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
        for (Map<String, Object> attrDef : attrDefs) {
          if (attrName.equals(attrDef.get("name")) && "vector".equals(attrDef.get("type")) && !Boolean.FALSE.equals(attrDef.get("enable"))) {
            isVectorAttr = true;
            break;
          }
        }
        if (!isVectorAttr) {
          throw AgentHttpException.invalid(
              "The vector data: attrName["
                  + attrName
                  + "] is not a vector attribute of Class["
                  + className
                  + "].");
        }
        Map<String, Object> newVectorData = new HashMap<String, Object>();
        newVectorData.put("className", className);
        newVectorData.put("objectId", objectId);
        newVectorData.put("attrName", attrName);
        newVectorData.put("text", text);
        newVectorData.put("file", file);
        newVectorDatas.add(newVectorData);
      }
    }

    return
        JSONObject.of("objDatas", objDatas, "relDatas", newRelDatas, "vectorDatas", newVectorDatas);
    }

    @SuppressWarnings("unchecked")
    private void loadSample(String sandboxId, JSONObject data, Map<String, byte[]> attachments, String domainId) throws Exception {
      Map<String, Object> jsonRule = schemas.query(domainId);
      List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
      Map<String, Map<String, Object>> classDefMap = new HashMap<>();
      for (var cls : classDefs) classDefMap.put((String) cls.get("className"), cls);
            JSONArray objDatas = data.getJSONArray("objDatas");
            for (int i = 0; i < objDatas.size(); i++) {
              JSONObject objData = objDatas.getJSONObject(i);
              String className =
                  DBSchemaUtil.normalizeClassName(objData.getString("className"), classDefs);
              objData.put("className", className);
              JSONArray rows = objData.getJSONArray("rows");
              Map<String, Object> classDef = classDefMap.get(className);
              if (!rows.isEmpty()) writes.insert(className, rows, sandboxId, domainId);
            }

            JSONArray relDatas = data.getJSONArray("relDatas");
            if (relDatas != null) {
              for (var rel : relDatas.toJavaList(JSONObject.class)) {
                writes.createEdge(rel.getString("relationName"), rel.getString("sourceClassName"),
                    rel.getString("sourceObjId"), rel.getString("targetClassName"),
                    rel.getString("targetObjId"), sandboxId, domainId);
              }
            }

            JSONArray vectorDatas = data.getJSONArray("vectorDatas");
            if (vectorDatas != null) {
              for (int i = 0; i < vectorDatas.size(); i++) {
                JSONObject vectorData = vectorDatas.getJSONObject(i);
                String className =
                    DBSchemaUtil.normalizeClassName(vectorData.getString("className"), classDefs);
                String objectId = vectorData.getString("objectId");
                String attrName = vectorData.getString("attrName");
                String text = vectorData.getString("text");
                String file = vectorData.getString("file");
                byte[] bytes = file == null ? text.getBytes(StandardCharsets.UTF_8) : attachments.get(file);
                String suffix = file == null ? "txt" : file.substring(file.lastIndexOf('.') + 1);
                writes.appendVector(className, attrName, objectId, text,
                    new ByteArrayInputStream(bytes), suffix, sandboxId, domainId);
              }
            }
    }
	private List<String> getVectorAttrNames(Map<String, Object> classDef) {
		List<String> attrNames = new ArrayList<String>();
		List<Map<String, Object>> attrDefs = (List<Map<String, Object>>)classDef.get("attrs");
		for (Map<String, Object> attrDef : attrDefs) {
			if (attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) {
				if ("vector".equals(attrDef.get("type"))) {
					attrNames.add((String)attrDef.get("name"));
				}
			}
		}
		return attrNames;
	}
		/** The domain's adapter with its ontomap: writing an edge needs the relationship definitions. */
	private DataAdapter getDataAdapter(String domainId) {
		BusinessConfig businessConfig = configs.get(domainId);
		return dataAdapterRegistry.create(businessConfig, schemas.query(domainId));
	}

}
