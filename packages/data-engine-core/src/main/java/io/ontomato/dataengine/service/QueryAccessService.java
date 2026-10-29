package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
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
    Long userExpiry = access.expiresAt();
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
            "ontology",
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
          request.getHeader("tk"),
          grant.getLong("expiresAt"));
    }
    User user = identity.getCurrentUser();
    if (user == null || !user.isEnable())
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authentication is required");
    identity.requireQueryAccess();
    return new Access(
        user, identity.getCurrentUserDataPermission(), null, null,
        identity.getCurrentCredentialExpiresAt());
  }

  /** Request authority is captured once; neither source beans nor accessor results can mutate it. */
  public record Access(
      User user, UserDataPermission permission, JSONObject grant, String credential, Long expiresAt) {
    public Access {
      user = new CapturedUser(
          user.getId(), user.getLoginCode(), user.getUserName(), user.isEnable(), user.getDomainId());
      permission = copyPermission(permission);
      grant = copyGrant(grant);
    }

    @Override
    public UserDataPermission permission() {
      return copyPermission(permission);
    }

    @Override
    public JSONObject grant() {
      return copyGrant(grant);
    }

    private static UserDataPermission copyPermission(UserDataPermission value) {
      return value == null ? null : JSON.parseObject(
          JSON.toJSONString(value, Feature.WriteMapNullValue), UserDataPermission.class);
    }

    private static JSONObject copyGrant(JSONObject value) {
      return value == null ? null : JSON.parseObject(JSON.toJSONString(value, Feature.WriteMapNullValue));
    }
  }

  private record CapturedUser(
      String id, String loginCode, String userName, boolean enable, String domainId) implements User {
    public String getId() { return id; }
    public String getLoginCode() { return loginCode; }
    public String getUserName() { return userName; }
    public boolean isEnable() { return enable; }
    public String getDomainId() { return domainId; }
  }

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
