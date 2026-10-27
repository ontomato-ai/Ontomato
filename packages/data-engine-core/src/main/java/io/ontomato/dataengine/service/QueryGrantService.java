package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import jakarta.annotation.PostConstruct;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.DependsOn;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Ontology-owned run grants. No model-supplied identity or permission mode is accepted. */
@Service
@DependsOn("jdbcInitDb")
public class QueryGrantService {
  public static final String ATTRIBUTE = QueryGrantService.class.getName();
  private final JdbcTemplate jdbc;
  private final DataPermissionLookup permissions;
  private final IdentityService identity;
  private final String signingKey;
  private final String serviceToken;

  public QueryGrantService(
      JdbcTemplate jdbc,
      DataPermissionLookup permissions,
      IdentityService identity,
      @Value("${ONTOMATO_QUERY_SIGNING_KEY:}") String signingKey,
      @Value("${ONTOMATO_QUERY_SERVICE_TOKEN:}") String serviceToken) {
    this.jdbc = jdbc;
    this.permissions = permissions;
    this.identity = identity;
    this.signingKey = signingKey;
    this.serviceToken = serviceToken;
  }

  @PostConstruct
  public void initialize() {
    jdbc.execute(
        "CREATE TABLE IF NOT EXISTS query_runtime_grants (id varchar(64) PRIMARY KEY, run_id"
            + " varchar(128) NOT NULL, domain_id varchar(128) NOT NULL, expires_at bigint NOT NULL,"
            + " revoked boolean NOT NULL DEFAULT false)");
  }

  public void requireWorkbench(HttpServletRequest request) {
    String supplied = request.getHeader("X-Ontomato-Query-Service-Token");
    if (serviceToken.isBlank() || supplied == null || !equal(serviceToken, supplied))
      throw new ResponseStatusException(
          HttpStatus.FORBIDDEN, "Workbench service authorization is required");
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

  public String issueExploration(Access access, JSONObject body) {
    long expiresAt = java.time.Instant.parse(body.getString("expiresAt")).toEpochMilli();
    Long userExpiry = identity.getCurrentCredentialExpiresAt();
    if (userExpiry != null) expiresAt = Math.min(expiresAt, userExpiry);
    return issue(
        access.user().getId(),
        access.user().getDomainId(),
        "retrieval-exploration",
        body.getString("runtimeRunId"),
        expiresAt,
        body.getList("classNames", String.class),
        null,
        JSONObject.of(
            "servicePrincipal",
            "workbench",
            "retrievalId",
            body.getString("retrievalId"),
            "sessionId",
            body.getString("runtimeSessionId")));
  }

  private String issue(
      String userId,
      String domainId,
      String purpose,
      String runId,
      long expiresAt,
      List<String> classNames,
      String sandboxId,
      JSONObject binding) {
    if (userId == null
        || domainId == null
        || runId == null
        || expiresAt <= System.currentTimeMillis())
      throw new IllegalArgumentException(
          "Query grant requires a valid subject, domain, run and deadline");
    if (!List.of("retrieval-exploration", "user-read", "sandbox-write").contains(purpose))
      throw new IllegalArgumentException("Invalid grant purpose");
    String id = UUID.randomUUID().toString();
    JSONObject claims = new JSONObject();
    claims.put("iss", "ontology");
    claims.put("aud", "ontology-query");
    claims.put("jti", id);
    claims.put("userId", userId);
    claims.put("domainId", domainId);
    claims.put("purpose", purpose);
    claims.put("runId", runId);
    claims.put("issuedAt", System.currentTimeMillis());
    claims.put("expiresAt", expiresAt);
    if (binding != null) claims.putAll(binding);
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
    return token;
  }

  public JSONObject verify(String token, String runId, String path) {
    try {
      String[] parts = token.split("\\.");
      if (parts.length != 3 || !parts[0].equals("oq") || !equal(sign(parts[1]), parts[2]))
        throw new IllegalArgumentException();
      JSONObject claims = JSON.parseObject(Base64.getUrlDecoder().decode(parts[1]));
      if (!"ontology".equals(claims.getString("iss"))
          || !"ontology-query".equals(claims.getString("aud"))
          || !claims.getString("runId").equals(runId)
          || claims.getLongValue("expiresAt") <= System.currentTimeMillis())
        throw new IllegalArgumentException();
      Integer count =
          jdbc.queryForObject(
              "SELECT count(*) FROM query_runtime_grants WHERE id=? AND run_id=? AND domain_id=?"
                  + " AND expires_at>? AND revoked=false",
              Integer.class,
              claims.getString("jti"),
              runId,
              claims.getString("domainId"),
              System.currentTimeMillis());
      if (count == null || count != 1) throw new IllegalArgumentException();
      boolean read =
          List.of(
                  "/ontology/query/overview",
                  "/ontology/query/schema",
                  "/ontology/query/dsl-reference",
                  "/ontology/query/distinct-values",
                  "/ontology/query/execute-dsl",
                  "/ontology/query/metrics/search",
                  "/ontology/query/metrics/execute",
                  "/ontology/query/knowledge/search")
              .contains(path);
      boolean write =
          path.startsWith("/writeFunctionOperation/")
              && "sandbox-write".equals(claims.getString("purpose"));
      if (!read && !write)
        throw new ResponseStatusException(
            HttpStatus.FORBIDDEN, "This grant cannot call this operation");
      return claims;
    } catch (ResponseStatusException e) {
      throw e;
    } catch (Exception e) {
      throw new ResponseStatusException(
          HttpStatus.UNAUTHORIZED, "Invalid, expired or revoked query grant");
    }
  }

  public void revoke(String domainId, String runId) {
    jdbc.update(
        "UPDATE query_runtime_grants SET revoked=true WHERE domain_id=? AND run_id=?",
        domainId,
        runId);
  }

  public Access access(HttpServletRequest request) {
    JSONObject grant = (JSONObject) request.getAttribute(ATTRIBUTE);
    if (grant != null) {
      String userId = grant.getString("userId"), domain = grant.getString("domainId");
      User user = new GrantUser(userId, domain);
      boolean explore = "retrieval-exploration".equals(grant.getString("purpose"));
      return new Access(
          user,
          explore ? new UserDataPermission() : permissions.getDataPermission(userId, domain),
          grant,
          request.getHeader("Authorization").substring(7));
    }
    User user = identity.getCurrentUser();
    if (user == null || !user.isEnable())
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authentication is required");
    identity.requireQueryAccess();
    return new Access(user, identity.getCurrentUserDataPermission(), null, null);
  }

  public record Access(
      User user, UserDataPermission permission, JSONObject grant, String credential) {}

  public record GrantUser(String id, String domainId) implements User {
    public String getId() {
      return id;
    }

    public String getDomainId() {
      return domainId;
    }

    public String getLoginCode() {
      return id;
    }

    public String getUserName() {
      return id;
    }

    public boolean isEnable() {
      return true;
    }
  }
}
