package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.concurrent.Callable;
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
    if (access.grant() != null)
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Exploration requires an authenticated caller");
    var scoped = new Access(access.user(), access.permission(), null, null, access.expiresAt(),
        QueryGrantService.intersectClasses(access.classNames(),
            classScope(access.permission(), body.getList("classNames", String.class))), access.target(),
        access.executionUserId(), access.initiatorUserId());
    return grants.issueForTarget(
        "retrieval-exploration", body.getString("runtimeRunId"), expiresAt, scoped,
        JSONObject.of(
            "servicePrincipal",
            "ontology",
            "retrievalId",
            body.getString("retrievalId"),
            "sessionId",
            body.getString("runtimeSessionId"), "executionUserId", access.executionUserId(), "initiatorUserId", access.initiatorUserId()));
  }

  public Access access(HttpServletRequest request) {
    JSONObject grant = (JSONObject) request.getAttribute(QueryGrantService.ATTRIBUTE);
    if (grant != null) {
      String userId = grant.getString("userId"), domain = grant.getString("domainId");
      if ("retrieval-exploration".equals(grant.getString("purpose")))
        identity.requireQueryAccess(userId, domain);
      User user = new GrantUser(userId, domain);
      return new Access(
          user,
          permissions.getDataPermission(userId, domain),
          grant,
          request.getHeader("tk"),
          grant.getLong("expiresAt")).withExecution(grant.getString("executionUserId"), grant.getString("initiatorUserId"));
    }
    return userAccess(request, true);
  }

  public Access forRetrievalAdmission(HttpServletRequest request) {
    if (request.getAttribute(QueryGrantService.ATTRIBUTE) != null)
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "A current user credential is required");
    return userAccess(request, false);
  }

  private Access userAccess(HttpServletRequest request, boolean query) {
    User user = identity.getCurrentUser();
    if (user == null || !user.isEnable())
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authentication is required");
    if (query) identity.requireQueryAccess();
    return new Access(
        user, identity.getCurrentUserDataPermission(), null, null,
        identity.getCurrentCredentialExpiresAt());
  }

  /** Load the ordinary query facts for a verified viewer within the originating request's authorization scope. */
  public Access captureLivePanelAccess(User viewer, Callable<UserDataPermission> livePermission) throws Exception {
    identity.requireQueryAccess(viewer.getId(), viewer.getDomainId());
    var permission = livePermission.call();
    return new Access(viewer, permission, null, null, identity.getCurrentCredentialExpiresAt());
  }

  public static java.util.List<String> classScope(UserDataPermission permission, java.util.List<String> requested) {
    java.util.List<String> selected = requested == null ? java.util.List.of() : requested;
    if (permission.isFullData()) return java.util.List.copyOf(selected);
    var available = permission.getFieldPermissions().stream().filter(p -> !p.isEmpty())
        .map(p -> p.getClassName()).distinct().filter(name -> selected.isEmpty() || selected.contains(name)).toList();
    if (available.isEmpty()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "No authorized classes in the requested scope");
    return available;
  }

  /** Request authority is captured once; neither source beans nor accessor results can mutate it. */
  public record Access(
      User user, UserDataPermission permission, JSONObject grant, String credential, Long expiresAt,
      java.util.List<String> classNames, ExecutionTarget target, String executionUserId, String initiatorUserId) {
    public Access(User user, UserDataPermission permission, JSONObject grant, String credential, Long expiresAt, java.util.List<String> classNames, ExecutionTarget target) {
      this(user,permission,grant,credential,expiresAt,classNames,target,grant==null?null:grant.getString("executionUserId"),grant==null?null:grant.getString("initiatorUserId"));
    }
    public AuthorizationService.VerifiedIdentity verifiedIdentity() {
      return new AuthorizationService.VerifiedIdentity(
          user.getDomainId(), user.getId(), QueryGrantService.limit(grant));
    }

    public Access withExecution(String userId, String initiator) {
      return new Access(user,permission,grant,credential,expiresAt,classNames,target,userId,initiator);
    }
    public Access(User user, UserDataPermission permission, JSONObject grant, String credential, Long expiresAt, java.util.List<String> classNames) {
      this(user,permission,grant,credential,expiresAt,classNames,ExecutionTarget.LIVE);
    }
    public Access withTarget(ExecutionTarget value) {
      return new Access(user,permission,grant,credential,expiresAt,!value.classNames().isEmpty()?value.classNames():classNames,value,
          value.initiatorUserId()!=null?value.executionUserId():executionUserId,value.initiatorUserId()!=null?value.initiatorUserId():initiatorUserId);
    }
    public Access(User user, UserDataPermission permission, JSONObject grant, String credential, Long expiresAt) {
      this(user, permission, grant, credential, expiresAt,
          grant == null ? java.util.List.of() : grant.getList("classNames", String.class),
          grant == null ? ExecutionTarget.LIVE : QueryGrantService.target(grant));
    }
    public Access {
      user = new CapturedUser(
          user.getId(), user.getLoginCode(), user.getUserName(), user.isEnable(), user.getDomainId());
      permission = copyPermission(permission);
      grant = copyGrant(grant);
      classNames = classNames == null ? java.util.List.of() : java.util.List.copyOf(classNames);
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
