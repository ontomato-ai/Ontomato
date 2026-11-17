package io.ontomato.dataengine.service.impl;

import java.util.List;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.sys.bean.UserDetail;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

/**
 * Open-source edition (no users) identity implementation: returns a fixed anonymous user, and all data permissions are allowed through.
 */
@Component
public class AnonymousIdentityService implements IdentityService {
    @Override public Long getCurrentCredentialExpiresAt() { var scoped=io.ontomato.dataengine.service.AgentPrincipalService.currentUserExecution();if(scoped!=null)return scoped.expiresAt();var agent=io.ontomato.dataengine.service.AgentPrincipalService.current();return agent==null?null:agent.expiresAt(); }
    @Override public void requireQueryAccess() { if(io.ontomato.dataengine.service.AgentPrincipalService.current()!=null)throw io.ontomato.dataengine.service.AgentPrincipalService.denied("Agent roles require a role-aware identity implementation"); }
    @Override public void requireActionExecutionAccess(String userId, String domainId) { requireQueryAccess(); }
    @Override public boolean hasKnowledgeGovernanceAccess() { return true; }

    private static final UserDetail ANONYMOUS_USER = createAnonymousUser();

    private static UserDetail createAnonymousUser() {
        UserDetail user = new UserDetail();
        user.setId("admin");
        user.setLoginCode("admin");
        user.setUserName("admin");
        user.setEnable(true);
        user.setRoles(List.of());
        user.setMenuPermissions(List.of());
        user.setApiPermissions(List.of());
        // Open-source edition single domain: fixed domainId="1", no multi-tenant isolation.
        user.setDomainId("1");
        return user;
    }

    @Override
    public User getCurrentUser() {
        var scoped=io.ontomato.dataengine.service.AgentPrincipalService.currentUserExecution();if(scoped!=null)return scoped.user();
        var agent=io.ontomato.dataengine.service.AgentPrincipalService.current();
        if(agent!=null)return agent.principal();
        return ANONYMOUS_USER;
    }

    @Override
    public String getCurrentUserId() {
        return getCurrentUser().getId();
    }

    @Override
    public UserDataPermission getCurrentUserDataPermission() {
        requireQueryAccess();
        // fullData=true: row permissions and field permissions are not intercepted at all
        UserDataPermission permission = new UserDataPermission();
        permission.setFullData(true);
        return permission;
    }
}
