package io.ontomato.dataengine.service.impl;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.applications.*;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import java.util.Set;
import org.springframework.stereotype.Component;
@Component
public class AnonymousApplicationAccess implements ApplicationAccess {
    private final IdentityService identity;
    private final AuthorizationStore authorization;

    public AnonymousApplicationAccess(IdentityService identity, AuthorizationStore authorization) {
        this.identity = identity;
        this.authorization = authorization;
    }
    public User entryUser(String credential) { return identity.getCurrentUser(); }
    public void retire(JSONObject app) {
        authorization.retireObject(ApplicationCatalog.applicationTarget(app));
    }
    public void initialOpenEntries(User user, Set<String> targetKeys) {}
    public void requestDomainEntryOpening(User user, String targetKey, boolean open) {}
    public void retireEntries(String domainId, Set<String> targetKeys) {}
}
