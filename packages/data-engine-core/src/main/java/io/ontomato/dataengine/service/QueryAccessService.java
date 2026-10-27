package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** HTTP query authorization composes identity/permissions above the grant lifecycle. */
@Service
public class QueryAccessService {
  private final IdentityService identity;
  private final DataPermissionLookup permissions;
  private final QueryGrantService grants;

  public QueryAccessService(
      IdentityService identity, DataPermissionLookup permissions, QueryGrantService grants) {
    this.identity = identity;
    this.permissions = permissions;
    this.grants = grants;
  }

  public String issueExploration(Access access, JSONObject body) {
    long expiresAt = java.time.Instant.parse(body.getString("expiresAt")).toEpochMilli();
    Long userExpiry = identity.getCurrentCredentialExpiresAt();
    if (userExpiry != null) expiresAt = Math.min(expiresAt, userExpiry);
    return grants.issue(
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

  public Access access(HttpServletRequest request) {
    JSONObject grant = (JSONObject) request.getAttribute(QueryGrantService.ATTRIBUTE);
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
