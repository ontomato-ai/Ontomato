package io.ontomato.dataengine.service.impl;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.applications.*;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.IdentityService;
import java.util.Set;
import org.springframework.stereotype.Component;
@Component
public class AnonymousApplicationAccess implements ApplicationAccess {
    private final IdentityService identity;
    public AnonymousApplicationAccess(IdentityService identity) { this.identity = identity; }
    public User entryUser(String credential) { return identity.getCurrentUser(); }
    public boolean administrator(User user) { return true; }
    public void requireConnectedRegistration(User user) {}
    public boolean canMaintain(JSONObject application, User user) { return true; }
    public void initialOpenEntries(User user, Set<String> targetKeys) {}
    public void requestDomainEntryOpening(User user, String targetKey, boolean open) {}
    public void retireEntries(String domainId, Set<String> targetKeys) {}
}
