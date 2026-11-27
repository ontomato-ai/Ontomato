package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import jakarta.annotation.PostConstruct;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import com.alibaba.fastjson2.JSONException;
import io.ontomato.dataengine.config.ServiceConst;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.DependsOn;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * Grant signing, verification and revocation. Independent of request identity and permission
 * services.
 */
@Service
@DependsOn("jdbcInitDb")
public class QueryGrantService {
  private static final int VERSION = 3;
  private static final String ACTION_EXECUTION = "action-execution";
  public static final String ATTRIBUTE = QueryGrantService.class.getName();
  private final JdbcTemplate jdbc;
  private final String signingKey;
  private final WorkbenchServiceAuthentication serviceAuthentication;

  public QueryGrantService(
      JdbcTemplate jdbc,
      @Value("${ONTOMATO_QUERY_SIGNING_KEY:}") String signingKey,
      WorkbenchServiceAuthentication serviceAuthentication) {
    this.jdbc = jdbc;
    this.signingKey = signingKey;
    this.serviceAuthentication = serviceAuthentication;
  }

  @PostConstruct
  public void initialize() {
    jdbc.execute(
        "CREATE TABLE IF NOT EXISTS query_runtime_grants (id varchar(64) PRIMARY KEY, run_id"
            + " varchar(128) NOT NULL, domain_id varchar(128) NOT NULL, expires_at bigint NOT NULL,"
            + " revoked boolean NOT NULL DEFAULT false, query_error text)");
    jdbc.execute("ALTER TABLE query_runtime_grants ADD COLUMN IF NOT EXISTS context_id text");
    jdbc.execute("ALTER TABLE query_runtime_grants ADD COLUMN IF NOT EXISTS package_input jsonb");
    jdbc.execute("ALTER TABLE query_runtime_grants ADD COLUMN IF NOT EXISTS package_partial jsonb");
  }

  @org.springframework.beans.factory.annotation.Autowired @org.springframework.context.annotation.Lazy
  private DataSandboxService contexts;

  public java.util.List<String> revokeContext(String contextId) {
    var executions=jdbc.queryForList("SELECT run_id FROM query_runtime_grants WHERE context_id=?",String.class,contextId);
    jdbc.update("UPDATE query_runtime_grants SET revoked=true WHERE context_id=?",contextId);
    return executions;
  }
  public String issueExecution(PythonAuthority authority, String execution, long expiresAt) {
    return issueDerived(authority, execution, expiresAt, executionBinding(authority));
  }

  private JSONObject executionBinding(PythonAuthority authority) {
    var target = authority.target();
    var binding = JSONObject.of("executionUserId", authority.executionUserId(),
        "initiatorUserId", authority.initiatorUserId());
    if (target.contextId() != null) {
      binding.put("contextId", target.contextId());
      binding.put("executionKind", "action-trial");
      binding.put("contextSandboxId", target.sandboxId());
    }
    return binding;
  }

  private String issueDerived(PythonAuthority authority, String run, long expiresAt, JSONObject binding) {
    var sandbox = sandboxId(authority.sandboxId());
    var classes = authority.classNames();
    var target = authority.target();
    var action = authority.action();
    String purpose = action == null ? authority.purpose() : ACTION_EXECUTION;
    var operations = operations(purpose, binding);
    if (action != null) {
      if (!"sandbox-write".equals(authority.purpose()) || authority.parentGrant() != null
          || !authority.userId().equals(action.userId()) || !authority.domainId().equals(action.domainId())
          || !Objects.equals(sandbox, target.sandboxId()) || (sandbox != null && !target.testing())
          || (action.workflowStep() != null && (target.mode() != ExecutionTarget.Mode.LIVE
              || (action.target() != null && !action.target().equals(action.workflowStep().target())))))
        throw forbidden();
      binding.put("actionExecution", action);
    }
    if (target.expiresAt() != null) expiresAt = Math.min(expiresAt, target.expiresAt());
    if (target.contextId() != null)
      expiresAt = Math.min(expiresAt, requireContext(binding, authority.userId(), authority.domainId(), classes).expiresAt());
    if (authority.parentGrant() != null) {
      var reference = authority.parentGrant();
      var parent = verify(reference.token(), reference.runId());
      if (!allowsDelegation(parent, authority.purpose())
          || !authority.userId().equals(parent.getString("userId"))
          || !authority.domainId().equals(parent.getString("domainId"))
          || !Objects.equals(authority.executionUserId(), parent.getString("executionUserId"))
          || !Objects.equals(authority.initiatorUserId(), parent.getString("initiatorUserId"))
          || !Objects.equals(sandbox, parent.getString("sandboxId"))
          || !Objects.equals(binding.getString("contextId"), parent.getString("contextId")))
        throw forbidden();
      var parentClasses = parent.getList("classNames", String.class);
      classes = intersectClasses(parentClasses, classes);
      operations.retainAll(operationKeys(parent));
      if (operations.isEmpty()) throw forbidden();
      expiresAt = Math.min(expiresAt, parent.getLongValue("expiresAt"));
      var ancestors = new ArrayList<>(parent.getList("ancestors", String.class));
      ancestors.add(parent.getString("jti"));
      binding.put("ancestors", ancestors);
      binding.put("requiresQueryAccess", parent.getBooleanValue("requiresQueryAccess"));
    }
    return issue(authority.userId(), authority.domainId(), purpose, run, expiresAt,
        classes, sandbox, binding, operations, true);
  }

  static List<String> intersectClasses(List<String> ceiling, List<String> requested) {
    if (ceiling.isEmpty()) return requested;
    if (requested.isEmpty()) return ceiling;
    var intersection = requested.stream().filter(ceiling::contains).toList();
    if (intersection.isEmpty()) throw forbidden();
    return intersection;
  }

  public void requireWorkbench(HttpServletRequest request) {
    serviceAuthentication.authenticate(request);
  }

  private static boolean equal(String a, String b) {
    return MessageDigest.isEqual(
        a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
  }

  private String sign(String encoded) {
    if (signingKey.isBlank())
      throw new ResponseStatusException(
          HttpStatus.SERVICE_UNAVAILABLE, "Ontology query signing key is not configured");
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(signingKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      return Base64.getUrlEncoder()
          .withoutPadding()
          .encodeToString(mac.doFinal(encoded.getBytes(StandardCharsets.UTF_8)));
    } catch (java.security.GeneralSecurityException e) {
      throw new IllegalStateException("Cannot sign query grant", e);
    }
  }

  public String issue(
      String userId,
      String domainId,
      String purpose,
      String runId,
      long expiresAt,
      List<String> classNames,
      String sandboxId) {
    return issue(userId, domainId, purpose, runId, expiresAt, classNames, sandboxId, null);
  }

  public String issue(
      String userId,
      String domainId,
      String purpose,
      String runId,
      long expiresAt,
      List<String> classNames,
      String sandboxId,
      JSONObject binding) {
    if (ACTION_EXECUTION.equals(purpose)) throw forbidden();
    var claims = binding == null ? new JSONObject() : binding;
    return issue(userId, domainId, purpose, runId, expiresAt, classNames, sandboxId(sandboxId),
        claims, operations(purpose, claims), true);
  }

  public String issueForTarget(String purpose, String runId, long expiresAt,
      QueryAccessService.Access access, JSONObject binding) {
    if (ACTION_EXECUTION.equals(purpose)) throw forbidden();
    var target = access.target();
    if (target.expiresAt() != null) expiresAt = Math.min(expiresAt, target.expiresAt());
    if (target.contextId() != null) {
      binding.put("contextId", target.contextId());
      binding.put("contextSandboxId", target.sandboxId());
      binding.put("executionKind", "action-trial");
      expiresAt = Math.min(expiresAt, requireContext(
          binding, access.user().getId(), access.user().getDomainId(), access.classNames()).expiresAt());
    }
    return issue(access.user().getId(), access.user().getDomainId(), purpose, runId,
        expiresAt, access.classNames(), target.sandboxId(), binding, operations(purpose, binding), false);
  }

  /** The authoring owner binds the child to its actual write sandbox before issuing the parent. */
  public String issueAuthoringParent(PythonAuthority authority, String runId, long expiresAt) {
    if (authority.action() != null) throw forbidden();
    var binding = executionBinding(authority);
    var target = authority.target();
    if (target.contextId() != null)
      expiresAt = Math.min(expiresAt, Math.min(target.expiresAt(),
          requireContext(binding, authority.userId(), authority.domainId(), authority.classNames()).expiresAt()));
    binding.put("delegatedPurpose", authority.purpose());
    return issue(authority.userId(), authority.domainId(), "authoring-test", runId, expiresAt,
        authority.classNames(), sandboxId(authority.sandboxId()), binding,
        operations(authority.purpose(), binding), false);
  }

  private String issue(String userId, String domainId, String purpose, String runId,
      long expiresAt, List<String> classNames, String sandboxId, JSONObject binding,
      Set<QueryGrantOperation> operations, boolean codeExecution) {
    if (userId == null || domainId == null || runId == null || expiresAt <= System.currentTimeMillis())
      throw new IllegalArgumentException("Query grant requires a valid subject, domain, run and deadline");
    String id = UUID.randomUUID().toString();
    JSONObject claims = new JSONObject(binding);
    claims.put("version", VERSION);
    claims.put("iss", "ontology");
    claims.put("aud", "ontology-query");
    claims.put("jti", id);
    claims.put("userId", userId);
    claims.put("domainId", domainId);
    claims.put("purpose", purpose);
    claims.put("runId", runId);
    claims.put("issuedAt", System.currentTimeMillis());
    claims.put("expiresAt", expiresAt);
    if (sandboxId != null) operations.retainAll(QueryGrantOperation.SANDBOX);
    claims.put("operations", operations.stream().map(Enum::name).sorted().toList());
    if ("retrieval-exploration".equals(purpose))
      claims.put("requiresQueryAccess", true);
    claims.putIfAbsent("ancestors", List.of());
    claims.put("target", sandboxId == null ? "live" : "sandbox");
    claims.put("classNames", classNames == null ? List.of() : classNames);
    claims.put("sandboxId", sandboxId);
    String encoded =
        Base64.getUrlEncoder().withoutPadding().encodeToString(JSON.toJSONBytes(claims));
    String token = "oq." + encoded + "." + sign(encoded);
    jdbc.update(
        "DELETE FROM query_runtime_grants WHERE expires_at < ?",
        System.currentTimeMillis() - 86400000L);
    jdbc.update(
        "INSERT INTO query_runtime_grants(id,run_id,domain_id,expires_at) VALUES (?,?,?,?)",
        id,
        runId,
        domainId,
        expiresAt);
    if (codeExecution && binding.getString("contextId") != null)
      jdbc.update("UPDATE query_runtime_grants SET context_id=? WHERE id=?",binding.getString("contextId"),id);
    return token;
  }

  public JSONObject verifyRequest(String token, String runId, String method, String path) {
    return verifyRequest(token, runId, QueryGrantOperation.resolve(method, path));
  }

  /** Resolve an admitted HTTP operation before publishing a grant to downstream handlers. */
  public JSONObject verifyRequest(String token, String runId, QueryGrantOperation.Call call) {
    var claims = verify(token, runId);
    if (call == null || "authoring-test".equals(claims.getString("purpose"))
        || !operationKeys(claims).contains(call.operation()) || !call.matches(claims)
        || (ACTION_EXECUTION.equals(claims.getString("purpose")) || "action-trial".equals(claims.getString("executionKind")))
            && claims.getList("classNames", String.class).isEmpty())
      throw forbidden();
    return claims;
  }

  /** Check a parent internally without giving it an HTTP capability. */
  public JSONObject verify(String token, String runId) {
    var claims = decode(token);
    long now = System.currentTimeMillis();
    if (!Integer.valueOf(VERSION).equals(claims.getInteger("version"))
        || !"ontology".equals(claims.getString("iss")) || !"ontology-query".equals(claims.getString("aud"))
        || !runIdMatches(runId, claims) || claims.getLongValue("expiresAt") <= now)
      throw invalid();
    String domain = claims.getString("domainId");
    Integer count = jdbc.queryForObject(
        "SELECT count(*) FROM query_runtime_grants WHERE id=? AND run_id=? AND domain_id=?"
            + " AND expires_at>? AND revoked=false",
        Integer.class, claims.getString("jti"), runId, domain, now);
    if (count == null || count != 1) throw invalid();
    for (String id : claims.getList("ancestors", String.class)) {
      Integer active = jdbc.queryForObject(
          "SELECT count(*) FROM query_runtime_grants WHERE id=? AND domain_id=? AND expires_at>? AND revoked=false",
          Integer.class, id, domain, now);
      if (active == null || active != 1) throw invalid();
    }

    if (claims.getString("executionKind") != null && (claims.getString("contextId") == null
        || !"sandbox".equals(claims.getString("target")))) throw invalid();
    if (claims.getString("contextId") != null)
      requireContext(claims, claims.getString("userId"), domain, claims.getList("classNames", String.class));
    return claims;
  }

  private JSONObject decode(String token) {
    String[] parts = token.split("\\.");
    if (parts.length != 3 || !parts[0].equals("oq") || !equal(sign(parts[1]), parts[2])) throw invalid();
    try {
      return JSON.parseObject(Base64.getUrlDecoder().decode(parts[1]));
    } catch (IllegalArgumentException | JSONException error) {
      throw invalid();
    }
  }

  private static boolean runIdMatches(String runId, JSONObject claims) {
    return runId != null && runId.equals(claims.getString("runId"));
  }

  private ExecutionTarget requireContext(JSONObject binding, String user, String domain, List<String> classes) {
    String context = binding.getString("contextId");
    boolean trial = "action-trial".equals(binding.getString("executionKind"));
    if (!trial) throw forbidden();
    var initiator = binding.getString("initiatorUserId");
    var target = contexts.requireActionTrial(context, initiator == null ? user : initiator, domain);
    if (!classes.isEmpty()) target.requireClasses(classes);
    if (!target.sandboxId().equals(binding.getString("contextSandboxId"))) throw forbidden();
    return target;
  }

  private static String sandboxId(String sandbox) {
    return ServiceConst.NOT_SANDBOX.equals(sandbox) ? null : sandbox;
  }

  private static Set<QueryGrantOperation> operationKeys(JSONObject claims) {
    var keys = new HashSet<QueryGrantOperation>();
    for (String key : claims.getList("operations", String.class)) keys.add(QueryGrantOperation.valueOf(key));
    return keys;
  }

  private static boolean allowsDelegation(JSONObject parent, String childPurpose) {
    return switch (parent.getString("purpose")) {
      case "package-read", "knowledge-governance", ACTION_EXECUTION -> false;
      case "authoring-test" -> childPurpose.equals(parent.getString("delegatedPurpose"))
          || "user-read".equals(parent.getString("delegatedPurpose")) && "package-read".equals(childPurpose);
      case "retrieval-exploration", "ontology-generation", "user-read", "sandbox-write" ->
          "user-read".equals(childPurpose) || "package-read".equals(childPurpose);
      default -> false;
    };
  }

  private static Set<QueryGrantOperation> operations(String purpose, JSONObject binding) {
    var operations = new HashSet<QueryGrantOperation>();
    switch (purpose) {
      case "retrieval-exploration" -> {
        operations.addAll(QueryGrantOperation.QUERY);
        operations.addAll(QueryGrantOperation.RETRIEVAL);
      }
      case "user-read" -> operations.addAll(QueryGrantOperation.QUERY);
      case "package-read" -> operations.add(QueryGrantOperation.DATA_QUERY);
      case ACTION_EXECUTION -> {
        operations.addAll(QueryGrantOperation.WRITE);
        operations.add(QueryGrantOperation.ATTACH_VECTOR_RESOURCE);
        operations.add(QueryGrantOperation.DETACH_VECTOR_RESOURCE);
        operations.add(QueryGrantOperation.DATA_QUERY);
        operations.add(QueryGrantOperation.DATA_DISTINCT);
      }
      case "sandbox-write" -> {
        operations.addAll(QueryGrantOperation.WRITE);
        if ("action-trial".equals(binding.getString("executionKind"))) {
          operations.add(QueryGrantOperation.DATA_QUERY);
          operations.add(QueryGrantOperation.DATA_DISTINCT);
        } else operations.addAll(QueryGrantOperation.QUERY);
      }
      case "ontology-generation" -> {
        operations.addAll(QueryGrantOperation.QUERY);
        operations.addAll(QueryGrantOperation.GENERATION);
      }
      case "knowledge-governance" -> operations.add(QueryGrantOperation.GOVERNANCE_ACTION);
      default -> throw new IllegalArgumentException("Invalid grant purpose");
    }
    return operations;
  }

  public static boolean isActionExecution(JSONObject claims) {
    return ACTION_EXECUTION.equals(claims.getString("purpose"));
  }

  /** Invoked after verifyRequest and edition-specific restoration of the credential's current caller. */
  public void requireActionOwner(JSONObject claims, User user, ActionRuntimeGrant.Owner owner) throws Exception {
    var action = claims.getJSONObject("actionExecution").toJavaObject(ActionRuntimeGrant.class);
    if (!action.domainId().equals(user.getDomainId()) || !action.userId().equals(user.getId()))
      throw new OwnerRefusal("ACTION_SUBJECT_MISMATCH", "The current user does not match the action execution.");
    owner.requireCurrent(user, action, target(claims));
  }

  static boolean readsThroughWriteProgram(JSONObject claims) {
    return "sandbox-write".equals(claims.getString("purpose")) || isActionExecution(claims);
  }

  public static ExecutionTarget target(JSONObject claims) {
    return new ExecutionTarget(claims.getString("contextId"), claims.getString("sandboxId"),
        claims.getList("classNames", String.class), claims.getLong("expiresAt"),
        claims.getString("executionUserId"), claims.getString("initiatorUserId"),
        "action-trial".equals(claims.getString("executionKind")));
  }

  /** Adapt scope at a trusted request boundary; ordinary identities are still resolved by their owner. */
  public static AuthorizationService.CredentialLimit limit(HttpServletRequest request) {
    return limit((JSONObject) request.getAttribute(ATTRIBUTE));
  }

  static AuthorizationService.CredentialLimit limit(JSONObject claims) {
    if (claims == null) return AuthorizationService.CredentialLimit.UNRESTRICTED;
    var target = target(claims);
    var operations = operationKeys(claims);
    return operation -> operation instanceof AuthorizationService.Data data
        && (operations.stream().anyMatch(QueryGrantOperation.QUERY::contains)
            || operations.stream().anyMatch(QueryGrantOperation.WRITE::contains))
        && target.expiresAt() > System.currentTimeMillis()
        && (!target.testing() && target.classNames().isEmpty()
            || !data.classes().isEmpty() && target.classNames().containsAll(data.classes()));
  }

  private static ResponseStatusException invalid() {
    return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid, expired or revoked query grant");
  }

  private static ResponseStatusException forbidden() {
    return new ResponseStatusException(HttpStatus.FORBIDDEN, "This grant cannot call this operation");
  }

  public String issuePackage(PythonAuthority authority, String execution, long expiresAt) {
    var input = authority.packageInput();
    QueryPackage.validate(input.getJSONObject("package"));
    var binding = executionBinding(authority);
    binding.put("packageInputSha256", OntologyQueryService.digest(input));
    String token = issueDerived(authority, execution, expiresAt, binding);
    String grantId = JSON.parseObject(Base64.getUrlDecoder().decode(token.split("\\.")[1])).getString("jti");
    jdbc.update("UPDATE query_runtime_grants SET package_input=?::jsonb WHERE id=? AND run_id=? AND domain_id=? AND revoked=false",
        JSON.toJSONString(input, com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue), grantId, execution, authority.domainId());
    return token;
  }

  public JSONObject packageInput(JSONObject grant) {
    if (grant == null || !"package-read".equals(grant.getString("purpose")))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "A package execution grant is required");
    String text = jdbc.queryForObject("SELECT package_input::text FROM query_runtime_grants WHERE id=? AND run_id=? AND domain_id=? AND revoked=false AND expires_at>?",
        String.class, grant.getString("jti"), grant.getString("runId"), grant.getString("domainId"), System.currentTimeMillis());
    JSONObject input = JSON.parseObject(text);
    if (input == null || !OntologyQueryService.digest(input).equals(grant.getString("packageInputSha256")))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Package execution input differs");
    return input;
  }

  public void recordPackagePartial(JSONObject grant, JSONObject partial) {
    jdbc.update("UPDATE query_runtime_grants SET package_partial=?::jsonb WHERE id=? AND package_partial IS NULL AND revoked=false",
        partial.toJSONString(), grant.getString("jti"));
  }

  public JSONObject packagePartial(String domain, String execution) {
    var values = jdbc.queryForList("SELECT package_partial::text FROM query_runtime_grants WHERE domain_id=? AND run_id=? AND package_partial IS NOT NULL LIMIT 1", String.class, domain, execution);
    return values.isEmpty() ? null : JSON.parseObject(values.get(0));
  }

  public void revoke(String domainId, String runId) {
    jdbc.update(
        "UPDATE query_runtime_grants SET revoked=true WHERE domain_id=? AND run_id=?",
        domainId,
        runId);
  }

  /** Only the query executor writes this already classified error, never the Python process. */
  public void recordQueryError(JSONObject grant, String message) {
    jdbc.update("UPDATE query_runtime_grants SET query_error=? WHERE id=? AND run_id=? AND domain_id=? AND revoked=false AND expires_at>?",
        message, grant.getString("jti"), grant.getString("runId"), grant.getString("domainId"), System.currentTimeMillis());
  }

  public String queryError(String domainId, String runId) {
    var errors = jdbc.queryForList("SELECT query_error FROM query_runtime_grants WHERE domain_id=? AND run_id=? AND query_error IS NOT NULL ORDER BY expires_at DESC LIMIT 1",
        String.class, domainId, runId);
    return errors.isEmpty() ? null : errors.get(0);
  }
}
