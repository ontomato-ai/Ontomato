package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
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

/**
 * Grant signing, verification and revocation. Independent of request identity and permission
 * services.
 */
@Service
@DependsOn("jdbcInitDb")
public class QueryGrantService {
  public static final String ATTRIBUTE = QueryGrantService.class.getName();
  private final JdbcTemplate jdbc;
  private final String signingKey;
  private final String serviceToken;

  public QueryGrantService(
      JdbcTemplate jdbc,
      @Value("${ONTOMATO_QUERY_SIGNING_KEY:}") String signingKey,
      @Value("${ONTOMATO_QUERY_SERVICE_TOKEN:}") String serviceToken) {
    this.jdbc = jdbc;
    this.signingKey = signingKey;
    this.serviceToken = serviceToken;
  }

  @PostConstruct
  public void initialize() {
    jdbc.execute(
        "CREATE TABLE IF NOT EXISTS query_runtime_grants (id varchar(64) PRIMARY KEY, run_id"
            + " varchar(128) NOT NULL, domain_id varchar(128) NOT NULL, expires_at bigint NOT NULL,"
            + " revoked boolean NOT NULL DEFAULT false, query_error text)");
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

  String issue(
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
    if (!List.of("retrieval-exploration", "user-read", "sandbox-write", "ontology-generation", "knowledge-governance")
        .contains(purpose)) throw new IllegalArgumentException("Invalid grant purpose");
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
      if (!allows(claims, runId, path))
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

  /** The one place that maps a grant purpose to the paths it may call. */
  private static boolean allows(JSONObject claims, String runId, String path) {
    String purpose = claims.getString("purpose");
    if (purpose == null) return false;
    return switch (purpose) {
      case "retrieval-exploration" ->
          read(path)
              || (claims.getString("retrievalId") != null
                  && path.matches("/ontology/retrievals/" + claims.getString("retrievalId")
                      + "/runs/" + runId + "/outputs(?:/[^/]+(?:/content)?)?"));
      // Sandbox and saved read programs query through the same protocol, which applies the owner's
      // row and column permissions; only the sandbox one may also write through its own grant.
      case "sandbox-write" -> read(path) || path.startsWith("/writeFunctionOperation/");
      // A generation agent reads the ontology as its owner so that it can author valid definitions;
      // it never reaches final output delivery or another run's actions.
      case "user-read", "ontology-generation" ->
          read(path) || ("ontology-generation".equals(purpose)
              && path.startsWith("/ontology/ai/generation/" + runId + "/"));
      case "knowledge-governance" ->
          path.matches("/ontology/ai/knowledge-governance/[^/]+/runs/" + runId + "/actions/[^/]+");
      default -> false;
    };
  }

  /** Query reads; final output delivery always needs the end user credential. */
  private static boolean read(String path) {
    return path.startsWith("/ontology/query/") && !path.startsWith("/ontology/query/outputs");
  }

  /** Whether this path needs a scoped write grant rather than an ordinary credential. */
  public static boolean requiresWriteGrant(String path) {
    return path.startsWith("/writeFunctionOperation/");
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
